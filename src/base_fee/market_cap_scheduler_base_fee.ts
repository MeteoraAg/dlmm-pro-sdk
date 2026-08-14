import BN from "bn.js";
import {
  FEE_DENOMINATOR,
  MAX_BASIS_POINT,
  MAX_FEE_NUMERATOR,
  MIN_FEE_NUMERATOR,
} from "../constants";
import { PoolError } from "../errors";
import { getFeeInPeriod } from "../math/base_fee_math";
import {
  safeAdd,
  safeDiv,
  safeMul,
  safeSub,
  U64_MAX,
  U256_MAX,
} from "../math/safe_math";
import type { BaseFeeConfig } from "../types";

export type PodAlignedFeeMarketCapScheduler = {
  baseFeeMode: number;
  cliffFeeNumerator: BN;
  reductionFactor: BN;
  sqrtPriceStepBps: number;
  schedulerExpirationDuration: number;
  numberOfPeriod: number;
  padding: number[];
};

export function decodePodAlignedFeeMarketCapScheduler(
  baseFee: BaseFeeConfig,
): PodAlignedFeeMarketCapScheduler {
  const data = Buffer.from(baseFee.data);
  return {
    baseFeeMode: baseFee.baseFeeMode,
    cliffFeeNumerator: new BN(data.subarray(0, 8), "le"),
    reductionFactor: new BN(data.subarray(8, 16), "le"),
    sqrtPriceStepBps: data.readUInt32LE(16),
    schedulerExpirationDuration: data.readUInt32LE(20),
    numberOfPeriod: data.readUInt16LE(24),
    padding: [...data.subarray(26, 31)],
  };
}

function validateScheduler(inner: PodAlignedFeeMarketCapScheduler): void {
  if (inner.reductionFactor.isZero()) {
    throw PoolError.invalidParameters();
  }
  if (inner.sqrtPriceStepBps === 0) {
    throw PoolError.invalidParameters();
  }
  if (inner.schedulerExpirationDuration === 0) {
    throw PoolError.invalidParameters();
  }
  if (inner.numberOfPeriod === 0) {
    throw PoolError.invalidParameters();
  }
  if (inner.padding.some((byte) => byte !== 0)) {
    throw PoolError.invalidParameters();
  }
}

function getPassedPeriod(
  inner: PodAlignedFeeMarketCapScheduler,
  currentPoint: BN,
  activationPoint: BN,
  initSqrtPrice: BN,
  currentSqrtPrice: BN,
): number {
  const schedulerExpirationPoint = safeAdd(
    activationPoint,
    new BN(inner.schedulerExpirationDuration),
    U64_MAX,
  );

  if (currentPoint.gt(schedulerExpirationPoint) || currentPoint.lt(activationPoint)) {
    return inner.numberOfPeriod;
  }

  if (currentSqrtPrice.lte(initSqrtPrice)) {
    return 0;
  }

  const passedPeriod = safeDiv(
    safeDiv(
      safeMul(
        safeSub(currentSqrtPrice, initSqrtPrice, U256_MAX),
        new BN(MAX_BASIS_POINT),
        U256_MAX,
      ),
      initSqrtPrice,
      U256_MAX,
    ),
    new BN(inner.sqrtPriceStepBps),
    U256_MAX,
  );

  if (passedPeriod.gt(new BN(inner.numberOfPeriod))) {
    return inner.numberOfPeriod;
  }

  try {
    const period = passedPeriod.toNumber();
    if (!Number.isInteger(period) || period < 0 || period > 0xffff) {
      throw PoolError.undeterminedError();
    }
    return period;
  } catch (err) {
    if (err instanceof PoolError) {
      throw err;
    }
    throw PoolError.undeterminedError();
  }
}

function validateFeeBounds(minFeeNumerator: BN, maxFeeNumerator: BN): void {
  if (
    FEE_DENOMINATOR.isZero() ||
    minFeeNumerator.gte(FEE_DENOMINATOR) ||
    maxFeeNumerator.gte(FEE_DENOMINATOR)
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    minFeeNumerator.lt(MIN_FEE_NUMERATOR) ||
    maxFeeNumerator.gt(MAX_FEE_NUMERATOR)
  ) {
    throw PoolError.invalidParameters();
  }
}

export class FeeMarketCapSchedulerLinear {
  readonly inner: PodAlignedFeeMarketCapScheduler;

  constructor(inner: PodAlignedFeeMarketCapScheduler) {
    this.inner = inner;
  }

  static fromBaseFeeConfig(
    baseFee: BaseFeeConfig,
  ): FeeMarketCapSchedulerLinear {
    return new FeeMarketCapSchedulerLinear(
      decodePodAlignedFeeMarketCapScheduler(baseFee),
    );
  }

  getBaseFeeNumeratorByPeriod(period: number): BN {
    return safeSub(
      this.inner.cliffFeeNumerator,
      safeMul(this.inner.reductionFactor, new BN(period), U64_MAX),
      U64_MAX,
    );
  }

  getMinFeeNumerator(): BN {
    return this.getBaseFeeNumeratorByPeriod(this.inner.numberOfPeriod);
  }

  getMaxFeeNumerator(): BN {
    return this.inner.cliffFeeNumerator;
  }

  validate(): void {
    validateScheduler(this.inner);
    validateFeeBounds(this.getMinFeeNumerator(), this.getMaxFeeNumerator());
  }

  getBaseFeeNumerator(
    currentPoint: BN,
    activationPoint: BN,
    initSqrtPrice: BN,
    currentSqrtPrice: BN,
  ): BN {
    const period = getPassedPeriod(
      this.inner,
      currentPoint,
      activationPoint,
      initSqrtPrice,
      currentSqrtPrice,
    );
    return this.getBaseFeeNumeratorByPeriod(period);
  }
}

export class FeeMarketCapSchedulerExponential {
  readonly inner: PodAlignedFeeMarketCapScheduler;

  constructor(inner: PodAlignedFeeMarketCapScheduler) {
    this.inner = inner;
  }

  static fromBaseFeeConfig(
    baseFee: BaseFeeConfig,
  ): FeeMarketCapSchedulerExponential {
    return new FeeMarketCapSchedulerExponential(
      decodePodAlignedFeeMarketCapScheduler(baseFee),
    );
  }

  getBaseFeeNumeratorByPeriod(period: number): BN {
    return getFeeInPeriod(
      this.inner.cliffFeeNumerator,
      this.inner.reductionFactor,
      period,
    );
  }

  getMinFeeNumerator(): BN {
    return this.getBaseFeeNumeratorByPeriod(this.inner.numberOfPeriod);
  }

  getMaxFeeNumerator(): BN {
    return this.inner.cliffFeeNumerator;
  }

  validate(): void {
    validateScheduler(this.inner);
    validateFeeBounds(this.getMinFeeNumerator(), this.getMaxFeeNumerator());
  }

  getBaseFeeNumerator(
    currentPoint: BN,
    activationPoint: BN,
    initSqrtPrice: BN,
    currentSqrtPrice: BN,
  ): BN {
    const period = getPassedPeriod(
      this.inner,
      currentPoint,
      activationPoint,
      initSqrtPrice,
      currentSqrtPrice,
    );
    return this.getBaseFeeNumeratorByPeriod(period);
  }
}
