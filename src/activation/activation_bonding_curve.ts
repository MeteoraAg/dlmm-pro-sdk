import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { MAX_BASIS_POINT, MAX_TICK_ID } from "../constants";
import { PoolError } from "../errors";
import { encodePodU8, encodePodU64, toPodBuffer } from "../helpers/codec";
import { getSqrtPriceFromTickId } from "../math/tick_math";
import { safeDiv, safeMul, tryCastU128, U192_MAX } from "../math/safe_math";
import { ActivationMode, type PoolActivationInfoParameters } from "../types";

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
  isReachTarget?: number;
};

export function encodeBondingCurveActivationData(
  params: BondingCurveActivationParams,
): number[] {
  const buf = Buffer.alloc(15, 0);
  buf.set(encodePodU8(params.isReachTarget ?? 0), 0);
  buf.set(encodePodU64(params.targetIncreaseBps), 7);
  return Array.from(buf);
}

function targetSqrtPrice(initSqrtPrice: BN, targetIncreaseBps: BN): BN {
  return tryCastU128(
    safeDiv(
      safeMul(initSqrtPrice, targetIncreaseBps, U192_MAX),
      new BN(MAX_BASIS_POINT),
      U192_MAX,
    ),
  );
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

  isReachTarget(): boolean {
    return this.inner.isReachTarget === 1;
  }

  validateInitialize(
    _activationPoint: BN,
    _currentPoint: BN,
    initSqrtPrice: BN,
    tickSpacing: number,
    whitelistedAddLiquidity: PublicKey,
  ): void {
    if (this.inner.isReachTarget !== 0) {
      throw PoolError.invalidParameters();
    }
    if (this.inner.padding.some((byte) => byte !== 0)) {
      throw PoolError.invalidParameters();
    }
    // Without a whitelisted depositor the pool can never be seeded, so it can
    // never reach the target price that opens up public deposits.
    if (whitelistedAddLiquidity.equals(PublicKey.default)) {
      throw PoolError.invalidParameters();
    }
    if (this.inner.targetIncreaseBps.lte(new BN(MAX_BASIS_POINT))) {
      throw PoolError.invalidParameters();
    }
    if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
      throw PoolError.invalidParameters();
    }

    const nextSqrtPrice = targetSqrtPrice(
      initSqrtPrice,
      this.inner.targetIncreaseBps,
    );
    // floor-align, same as on-chain `align_id_to_spacing` for positive ids
    const alignedMaxTickId =
      Math.floor(MAX_TICK_ID / tickSpacing) * tickSpacing;
    if (nextSqrtPrice.gt(getSqrtPriceFromTickId(alignedMaxTickId))) {
      throw PoolError.invalidParameters();
    }
  }

  canSwap(_currentPoint: BN): boolean {
    return true;
  }

  canAddLiquidity(_currentPoint: BN): boolean {
    return this.isReachTarget();
  }

  canRemoveLiquidity(_currentPoint: BN): boolean {
    return this.isReachTarget();
  }

  updatePostSwap(initialSqrtPrice: BN, currentSqrtPrice: BN): void {
    if (this.isReachTarget()) {
      return;
    }
    const nextSqrtPrice = targetSqrtPrice(
      initialSqrtPrice,
      this.inner.targetIncreaseBps,
    );
    if (currentSqrtPrice.gte(nextSqrtPrice)) {
      this.inner.isReachTarget = 1;
    }
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
