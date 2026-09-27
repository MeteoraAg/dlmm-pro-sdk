import BN from "bn.js";
import { PoolError } from "../errors";
import { toPodBuffer } from "../helpers/codec";
import { ActivationMode, type PoolActivationInfoParameters } from "../types";

export type PodAlignedActivationOpen = {
  activationMode: number;
  padding: number[];
};

export function decodePodAlignedActivationOpen(
  info: PoolActivationInfoParameters,
): PodAlignedActivationOpen {
  return {
    activationMode: info.activationMode,
    padding: [...toPodBuffer(info.data, 15)],
  };
}

export function encodeOpenActivationData(): number[] {
  return Array.from(Buffer.alloc(15, 0));
}

export class ActivationOpenHandler {
  readonly inner: PodAlignedActivationOpen;

  constructor(inner: PodAlignedActivationOpen) {
    this.inner = inner;
  }

  static fromPoolActivationInfo(
    info: PoolActivationInfoParameters,
  ): ActivationOpenHandler {
    return new ActivationOpenHandler(decodePodAlignedActivationOpen(info));
  }

  validateInitialize(
    _activationPoint: BN,
    _currentPoint: BN,
    _initSqrtPrice: BN,
  ): void {
    if (this.inner.padding.some((byte) => byte !== 0)) {
      throw PoolError.invalidParameters();
    }
  }

  canSwap(_currentPoint: BN): boolean {
    return true;
  }

  canAddLiquidity(_currentPoint: BN): boolean {
    return true;
  }

  canRemoveLiquidity(_currentPoint: BN): boolean {
    return true;
  }

  updatePostSwap(_initialSqrtPrice: BN, _currentSqrtPrice: BN): void {}
}

export function openActivationParameters(): PoolActivationInfoParameters {
  return {
    activationMode: ActivationMode.Open,
    data: encodeOpenActivationData(),
  };
}
