import BN from "bn.js";
import {
  FEE_DENOMINATOR,
  MAX_FEE_NUMERATOR,
  MIN_FEE_NUMERATOR,
} from "../constants";
import { PoolError } from "../errors";
import { getFeeInPeriod } from "../math/base_fee_math";
import { safeDiv, safeMul, safeSub, tryCastU16, U64_MAX } from "../math/safe_math";
import type { BaseFeeConfig } from "../types";

export type PodAlignedFeeTimeScheduler = {
  baseFeeMode: number;
  cliffFeeNumerator: BN;
  periodFrequency: BN;
  reductionFactor: BN;
  numberOfPeriod: number;
  padding: number[];
};

export function decodePodAlignedFeeTimeScheduler(
  baseFee: BaseFeeConfig,
): PodAlignedFeeTimeScheduler {
  const data = Buffer.from(baseFee.data);
  return {
    baseFeeMode: baseFee.baseFeeMode,
    cliffFeeNumerator: new BN(data.subarray(0, 8), "le"),
    periodFrequency: new BN(data.subarray(8, 16), "le"),
    reductionFactor: new BN(data.subarray(16, 24), "le"),
    numberOfPeriod: data.readUInt16LE(24),
    padding: [...data.subarray(26, 31)],
  };
}

function validateInternal(inner: PodAlignedFeeTimeScheduler): void {
  if (
    inner.numberOfPeriod === 0 ||
    inner.periodFrequency.isZero() ||
    inner.reductionFactor.isZero()
  ) {
    throw PoolError.invalidParameters();
  }
  if (inner.padding.some((byte) => byte !== 0)) {
    throw PoolError.invalidParameters();
  }
}

function getPassedPeriod(
  inner: PodAlignedFeeTimeScheduler,
  currentPoint: BN,
  activationPoint: BN,
): number {
  if (currentPoint.lt(activationPoint)) {
    return inner.numberOfPeriod;
  }

  const period = safeDiv(
    safeSub(currentPoint, activationPoint, U64_MAX),
    inner.periodFrequency,
    U64_MAX,
  );
  if (period.gt(new BN(inner.numberOfPeriod))) {
    return inner.numberOfPeriod;
  }
  return tryCastU16(period);
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

export class FeeTimeSchedulerLinear {
  readonly inner: PodAlignedFeeTimeScheduler;

  constructor(inner: PodAlignedFeeTimeScheduler) {
    this.inner = inner;
  }

  static fromBaseFeeConfig(baseFee: BaseFeeConfig): FeeTimeSchedulerLinear {
    return new FeeTimeSchedulerLinear(decodePodAlignedFeeTimeScheduler(baseFee));
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
    validateInternal(this.inner);
    validateFeeBounds(this.getMinFeeNumerator(), this.getMaxFeeNumerator());
  }

  getBaseFeeNumerator(
    currentPoint: BN,
    activationPoint: BN,
    _initSqrtPrice: BN,
    _currentSqrtPrice: BN,
  ): BN {
    const period = getPassedPeriod(this.inner, currentPoint, activationPoint);
    return this.getBaseFeeNumeratorByPeriod(period);
  }
}

export class FeeTimeSchedulerExponential {
  readonly inner: PodAlignedFeeTimeScheduler;

  constructor(inner: PodAlignedFeeTimeScheduler) {
    this.inner = inner;
  }

  static fromBaseFeeConfig(
    baseFee: BaseFeeConfig,
  ): FeeTimeSchedulerExponential {
    return new FeeTimeSchedulerExponential(
      decodePodAlignedFeeTimeScheduler(baseFee),
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
    validateInternal(this.inner);
    validateFeeBounds(this.getMinFeeNumerator(), this.getMaxFeeNumerator());
  }

  getBaseFeeNumerator(
    currentPoint: BN,
    activationPoint: BN,
    _initSqrtPrice: BN,
    _currentSqrtPrice: BN,
  ): BN {
    const period = getPassedPeriod(this.inner, currentPoint, activationPoint);
    return this.getBaseFeeNumeratorByPeriod(period);
  }
}
