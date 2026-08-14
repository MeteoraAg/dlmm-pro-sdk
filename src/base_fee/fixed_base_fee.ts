import BN from "bn.js";
import {
  FEE_DENOMINATOR,
  MAX_FEE_NUMERATOR,
  MIN_FEE_NUMERATOR,
} from "../constants";
import { PoolError } from "../errors";
import type { BaseFeeConfig } from "../types";

export type PodAlignedFixedFee = {
  baseFeeMode: number;
  cliffFeeNumerator: BN;
  padding: number[];
};

export function decodePodAlignedFixedFee(
  baseFee: BaseFeeConfig,
): PodAlignedFixedFee {
  const data = Buffer.from(baseFee.data);
  return {
    baseFeeMode: baseFee.baseFeeMode,
    cliffFeeNumerator: new BN(data.subarray(0, 8), "le"),
    padding: [...data.subarray(8, 31)],
  };
}

export class FixedBaseFeeHandler {
  readonly inner: PodAlignedFixedFee;

  constructor(inner: PodAlignedFixedFee) {
    this.inner = inner;
  }

  static fromBaseFeeConfig(baseFee: BaseFeeConfig): FixedBaseFeeHandler {
    return new FixedBaseFeeHandler(decodePodAlignedFixedFee(baseFee));
  }

  validate(): void {
    validateFixedFeeFraction(this.inner.cliffFeeNumerator);
    if (
      this.inner.cliffFeeNumerator.lt(MIN_FEE_NUMERATOR) ||
      this.inner.cliffFeeNumerator.gt(MAX_FEE_NUMERATOR)
    ) {
      throw PoolError.invalidParameters();
    }
    if (this.inner.padding.some((byte) => byte !== 0)) {
      throw PoolError.invalidParameters();
    }
  }

  getBaseFeeNumerator(
    _currentPoint: BN,
    _activationPoint: BN,
    _initSqrtPrice: BN,
    _currentSqrtPrice: BN,
  ): BN {
    return this.inner.cliffFeeNumerator;
  }
}

function validateFixedFeeFraction(numerator: BN): void {
  if (FEE_DENOMINATOR.isZero() || numerator.gte(FEE_DENOMINATOR)) {
    throw PoolError.invalidParameters();
  }
}
