import type { Commitment, Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { NUMBER_OF_ACTIVATION_MODES } from "../constants";
import { PoolError } from "../errors";
import {
  tryCastActivationMode,
  tryCastActivationType,
} from "../math/safe_math";
import {
  ActivationMode,
  ActivationType,
  type PoolActivationInfoParameters,
} from "../types";
import { ActivationBondingCurveHandler } from "./activation_bonding_curve";
import { ActivationOpenHandler } from "./activation_open";
import { ActivationTimeBasedHandler } from "./activation_time_based";

export * from "./activation_bonding_curve";
export * from "./activation_open";
export * from "./activation_time_based";

export type ActivationHandler =
  | ActivationOpenHandler
  | ActivationBondingCurveHandler
  | ActivationTimeBasedHandler;

export async function getCurrentPointNumber(
  connection: Connection,
  activationType: number,
  commitment?: Commitment,
): Promise<BN> {
  let type: ActivationType;
  try {
    type = tryCastActivationType(activationType);
  } catch {
    throw PoolError.invalidActivationType();
  }
  const slot = await connection.getSlot(commitment);

  if (type === ActivationType.Slot) {
    return new BN(slot);
  }

  const blockTime = await connection.getBlockTime(slot);
  if (blockTime === null) {
    throw PoolError.undeterminedError();
  }
  return new BN(blockTime);
}

export function getActivationHandler(
  info: PoolActivationInfoParameters,
): ActivationHandler {
  const activationMode = tryCastActivationMode(info.activationMode);
  switch (activationMode) {
    case ActivationMode.Open:
      return ActivationOpenHandler.fromPoolActivationInfo(info);
    case ActivationMode.BondingCurve:
      return ActivationBondingCurveHandler.fromPoolActivationInfo(info);
    case ActivationMode.TimeBased:
      return ActivationTimeBasedHandler.fromPoolActivationInfo(info);
  }
}

export function validateActivationInitialize(
  info: PoolActivationInfoParameters,
  activationPoint: BN,
  currentPoint: BN,
  activationType: ActivationType,
  initSqrtPrice: BN,
  tickSpacing: number,
  whitelistedAddLiquidity: PublicKey,
): void {
  const handler = getActivationHandler(info);
  if (handler instanceof ActivationTimeBasedHandler) {
    handler.validateInitialize(
      activationPoint,
      currentPoint,
      activationType,
      initSqrtPrice,
    );
    return;
  }
  if (handler instanceof ActivationBondingCurveHandler) {
    handler.validateInitialize(
      activationPoint,
      currentPoint,
      initSqrtPrice,
      tickSpacing,
      whitelistedAddLiquidity,
    );
    return;
  }
  handler.validateInitialize(activationPoint, currentPoint, initSqrtPrice);
}

export function validateActivationCombination(
  activationModes: ActivationMode[],
  activationPoint: BN,
  currentPoint: BN,
): void {
  if (activationModes.length !== NUMBER_OF_ACTIVATION_MODES) {
    throw PoolError.invalidParameters();
  }

  const [first, second] = activationModes;
  const allowed =
    (first === ActivationMode.Open && second === ActivationMode.Open) ||
    (first === ActivationMode.Open && second === ActivationMode.BondingCurve) ||
    (first === ActivationMode.Open && second === ActivationMode.TimeBased) ||
    (first === ActivationMode.BondingCurve &&
      second === ActivationMode.TimeBased);

  if (!allowed) {
    throw PoolError.invalidParameters();
  }

  if (!activationModes.includes(ActivationMode.TimeBased)) {
    if (!activationPoint.eq(currentPoint)) {
      throw PoolError.invalidParameters();
    }
  }
}
