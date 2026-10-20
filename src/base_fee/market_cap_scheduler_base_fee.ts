import BN from "bn.js";
import { MAX_BASIS_POINT } from "../constants";
import { PoolError } from "../errors";
import {
  encodePodU16,
  encodePodU32,
  encodePodU64,
  toPodBuffer,
} from "../helpers/pod";
import { baseFeeNumeratorByPeriod } from "../math/base_fee_math";
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
import { validateFeeBounds, validateSchedulerFields } from "./fee_bounds";

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
  const buf = Buffer.alloc(31);
  buf.set(encodePodU64(params.cliffFeeNumerator, "cliffFeeNumerator"), 0);
  buf.set(encodePodU64(params.reductionFactor, "reductionFactor"), 8);
  buf.set(encodePodU32(params.sqrtPriceStepBps, "sqrtPriceStepBps"), 16);
  buf.set(
    encodePodU32(
      params.schedulerExpirationDuration,
      "schedulerExpirationDuration",
    ),
    20,
  );
  buf.set(encodePodU16(params.numberOfPeriod, "numberOfPeriod"), 24);
  return Array.from(buf);
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
    return baseFeeNumeratorByPeriod(
      this.inner.baseFeeMode === BaseFeeMode.MarketCapSchedulerLinear,
      this.inner.cliffFeeNumerator,
      this.inner.reductionFactor,
      period,
    );
  }

  validate(): void {
    validateSchedulerFields(this.inner);
    if (this.inner.sqrtPriceStepBps === 0) {
      throw PoolError.invalidParameters("sqrtPriceStepBps must be non-zero");
    }
    if (this.inner.schedulerExpirationDuration === 0) {
      throw PoolError.invalidParameters(
        "schedulerExpirationDuration must be non-zero",
      );
    }
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
