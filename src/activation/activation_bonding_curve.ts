import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { MAX_BASIS_POINT, MAX_TICK_ID } from "../constants";
import { PoolError } from "../errors";
import { encodePodU64, toPodBuffer } from "../helpers/pod";
import { assertZeroPadding } from "../helpers/validation";
import { alignTickDown } from "../helpers/tick_array";
import { getSqrtPriceFromTickId } from "../math/tick_math";
import { mulDivU192 } from "../math/safe_math";
import { ActivationMode, type PoolActivationInfoParameters } from "../types";
import type { ActivationInitializeContext } from ".";

export type PodAlignedActivationBondingCurve = {
  activationMode: number;
  isReachTarget: number;
  padding: number[];
  targetIncreaseBps: BN;
};

export function decodePodAlignedActivationBondingCurve(
  info: PoolActivationInfoParameters,
): PodAlignedActivationBondingCurve {
  const data = toPodBuffer(info.data, 15);
  return {
    activationMode: info.activationMode,
    isReachTarget: data.readUInt8(0),
    padding: [...data.subarray(1, 7)],
    targetIncreaseBps: new BN(data.subarray(7, 15), "le"),
  };
}

export type BondingCurveActivationParams = {
  targetIncreaseBps: BN | number;
};

export function encodeBondingCurveActivationData(
  params: BondingCurveActivationParams,
): number[] {
  const buf = Buffer.alloc(15);
  buf.set(encodePodU64(params.targetIncreaseBps, "targetIncreaseBps"), 7);
  return Array.from(buf);
}

export class ActivationBondingCurveHandler {
  readonly inner: PodAlignedActivationBondingCurve;

  constructor(inner: PodAlignedActivationBondingCurve) {
    this.inner = inner;
  }

  static fromPoolActivationInfo(
    info: PoolActivationInfoParameters,
  ): ActivationBondingCurveHandler {
    return new ActivationBondingCurveHandler(
      decodePodAlignedActivationBondingCurve(info),
    );
  }

  validateInitialize({
    initSqrtPrice,
    tickSpacing,
    whitelistedAddLiquidity,
  }: ActivationInitializeContext): void {
    if (this.inner.isReachTarget !== 0) {
      throw PoolError.invalidParameters("isReachTarget must be 0");
    }
    assertZeroPadding(this.inner.padding);
    // Without a whitelisted depositor the pool can never be seeded, so it can
    // never reach the target price that opens up public deposits.
    if (whitelistedAddLiquidity.equals(PublicKey.default)) {
      throw PoolError.invalidParameters(
        "whitelistedAddLiquidity must not be the default public key",
      );
    }
    if (this.inner.targetIncreaseBps.lte(new BN(MAX_BASIS_POINT))) {
      throw PoolError.invalidParameters(
        "targetIncreaseBps must be above MAX_BASIS_POINT",
      );
    }

    const target = mulDivU192(
      initSqrtPrice,
      this.inner.targetIncreaseBps,
      new BN(MAX_BASIS_POINT),
    );
    const alignedMaxTickId = alignTickDown(MAX_TICK_ID, tickSpacing);
    if (target.gt(getSqrtPriceFromTickId(alignedMaxTickId))) {
      throw PoolError.invalidParameters(
        "initSqrtPrice * targetIncreaseBps must not exceed the aligned max tick price",
      );
    }
  }

  canSwap(_currentPoint: BN): boolean {
    return true;
  }
}

export function bondingCurveActivationParameters(
  params: BondingCurveActivationParams,
): PoolActivationInfoParameters {
  return {
    activationMode: ActivationMode.BondingCurve,
    data: encodeBondingCurveActivationData(params),
  };
}
