import BN from "bn.js";
import { PoolError } from "../errors";
import { encodePodU64, toPodBuffer } from "../helpers/pod";
import type { BaseFeeConfig } from "../types";
import { validateFeeBounds } from "./fee_fraction";

export type PodAlignedFixedFee = {
  baseFeeMode: number;
  cliffFeeNumerator: BN;
  padding: number[];
};

export function decodePodAlignedFixedFee(
  baseFee: BaseFeeConfig,
): PodAlignedFixedFee {
  const data = toPodBuffer(baseFee.data, 31);
  return {
    baseFeeMode: baseFee.baseFeeMode,
    cliffFeeNumerator: new BN(data.subarray(0, 8), "le"),
    padding: [...data.subarray(8, 31)],
  };
}

export function encodeFixedBaseFeeData(
  cliffFeeNumerator: BN | number,
): number[] {
  const buf = Buffer.alloc(31, 0);
  buf.set(encodePodU64(cliffFeeNumerator), 0);
  return Array.from(buf);
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
    validateFeeBounds(
      this.inner.cliffFeeNumerator,
      this.inner.cliffFeeNumerator,
    );
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
