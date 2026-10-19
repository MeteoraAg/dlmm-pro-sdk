import BN from "bn.js";
import { PoolError } from "../errors";
import { encodePodU16, encodePodU64, toPodBuffer } from "../helpers/pod";
import { assertZeroPadding } from "../helpers/validation";
import { baseFeeNumeratorByPeriod } from "../math/base_fee_math";
import { safeDiv, safeSub, tryCastU16, U64_MAX } from "../math/safe_math";
import { BaseFeeMode, type BaseFeeConfig } from "../types";
import { validateFeeBounds } from "./fee_bounds";

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
  const data = toPodBuffer(baseFee.data, 31);
  return {
    baseFeeMode: baseFee.baseFeeMode,
    cliffFeeNumerator: new BN(data.subarray(0, 8), "le"),
    periodFrequency: new BN(data.subarray(8, 16), "le"),
    reductionFactor: new BN(data.subarray(16, 24), "le"),
    numberOfPeriod: data.readUInt16LE(24),
    padding: [...data.subarray(26, 31)],
  };
}

export type TimeSchedulerParams = {
  cliffFeeNumerator: BN | number;
  periodFrequency: BN | number;
  reductionFactor: BN | number;
  numberOfPeriod: number;
};

export function encodeTimeSchedulerBaseFeeData(
  params: TimeSchedulerParams,
): number[] {
  const buf = Buffer.alloc(31, 0);
  buf.set(encodePodU64(params.cliffFeeNumerator, "cliffFeeNumerator"), 0);
  buf.set(encodePodU64(params.periodFrequency, "periodFrequency"), 8);
  buf.set(encodePodU64(params.reductionFactor, "reductionFactor"), 16);
  buf.set(encodePodU16(params.numberOfPeriod, "numberOfPeriod"), 24);
  return Array.from(buf);
}

function validateScheduler(inner: PodAlignedFeeTimeScheduler): void {
  if (inner.numberOfPeriod === 0) {
    throw PoolError.invalidParameters("numberOfPeriod must be non-zero");
  }
  if (inner.periodFrequency.isZero()) {
    throw PoolError.invalidParameters("periodFrequency must be non-zero");
  }
  if (inner.reductionFactor.isZero()) {
    throw PoolError.invalidParameters("reductionFactor must be non-zero");
  }
  assertZeroPadding(inner.padding);
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

export class FeeTimeScheduler {
  readonly inner: PodAlignedFeeTimeScheduler;

  constructor(inner: PodAlignedFeeTimeScheduler) {
    this.inner = inner;
  }

  static fromBaseFeeConfig(baseFee: BaseFeeConfig): FeeTimeScheduler {
    return new FeeTimeScheduler(decodePodAlignedFeeTimeScheduler(baseFee));
  }

  getBaseFeeNumeratorByPeriod(period: number): BN {
    return baseFeeNumeratorByPeriod(
      this.inner.baseFeeMode === BaseFeeMode.TimeSchedulerLinear,
      this.inner.cliffFeeNumerator,
      this.inner.reductionFactor,
      period,
    );
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
    _initSqrtPrice: BN,
    _currentSqrtPrice: BN,
  ): BN {
    const period = getPassedPeriod(this.inner, currentPoint, activationPoint);
    return this.getBaseFeeNumeratorByPeriod(period);
  }
}
