import BN from "bn.js";
import { PoolError } from "../errors";
import { toPodBuffer } from "../helpers/pod";
import { ActivationMode, type PoolActivationInfoParameters } from "../types";
import type { ActivationInitializeContext } from ".";

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

  validateInitialize(_context: ActivationInitializeContext): void {
    if (this.inner.padding.some((byte) => byte !== 0)) {
      throw PoolError.invalidParameters("padding must be zero");
    }
  }

  canSwap(_currentPoint: BN): boolean {
    return true;
  }
}

export function openActivationParameters(): PoolActivationInfoParameters {
  return {
    activationMode: ActivationMode.Open,
    data: Array.from(Buffer.alloc(15, 0)),
  };
}
