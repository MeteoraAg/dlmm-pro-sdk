import BN from "bn.js";
import { MAX_BASIS_POINT } from "../constants";
import { PoolError } from "../errors";
import {
  encodePodU16,
  encodePodU32,
  encodePodU64,
  toPodBuffer,
} from "../helpers/pod";
import { getFeeInPeriod } from "../math/base_fee_math";
import {
  safeAdd,
  safeDiv,
  safeMul,
  safeSub,
  tryCastU16,
  U64_MAX,
  U256_MAX,
} from "../math/safe_math";
import { BaseFeeMode, type BaseFeeConfig } from "../types";
import { validateFeeBounds } from "./fee_bounds";

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
  const data = toPodBuffer(baseFee.data, 31);
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

export type MarketCapSchedulerParams = {
  cliffFeeNumerator: BN | number;
  reductionFactor: BN | number;
  sqrtPriceStepBps: number;
  schedulerExpirationDuration: number;
  numberOfPeriod: number;
};

export function encodeMarketCapSchedulerBaseFeeData(
  params: MarketCapSchedulerParams,
): number[] {
  const buf = Buffer.alloc(31, 0);
  buf.set(encodePodU64(params.cliffFeeNumerator), 0);
  buf.set(encodePodU64(params.reductionFactor), 8);
  buf.set(encodePodU32(params.sqrtPriceStepBps), 16);
  buf.set(encodePodU32(params.schedulerExpirationDuration), 20);
  buf.set(encodePodU16(params.numberOfPeriod), 24);
  return Array.from(buf);
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

  if (
    currentPoint.gt(schedulerExpirationPoint) ||
    currentPoint.lt(activationPoint)
  ) {
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

  return tryCastU16(passedPeriod);
}

export class FeeMarketCapScheduler {
  readonly inner: PodAlignedFeeMarketCapScheduler;

  constructor(inner: PodAlignedFeeMarketCapScheduler) {
    this.inner = inner;
  }

  static fromBaseFeeConfig(baseFee: BaseFeeConfig): FeeMarketCapScheduler {
    return new FeeMarketCapScheduler(
      decodePodAlignedFeeMarketCapScheduler(baseFee),
    );
  }

  getBaseFeeNumeratorByPeriod(period: number): BN {
    const { cliffFeeNumerator, reductionFactor } = this.inner;
    if (this.inner.baseFeeMode === BaseFeeMode.MarketCapSchedulerLinear) {
      return safeSub(
        cliffFeeNumerator,
        safeMul(reductionFactor, new BN(period), U64_MAX),
        U64_MAX,
      );
    }
    return getFeeInPeriod(cliffFeeNumerator, reductionFactor, period);
  }

  validate(): void {
    validateScheduler(this.inner);
    validateFeeBounds(
      this.getBaseFeeNumeratorByPeriod(this.inner.numberOfPeriod),
      this.inner.cliffFeeNumerator,
    );
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
