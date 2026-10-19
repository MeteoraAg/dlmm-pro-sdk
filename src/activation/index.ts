import type { Commitment, Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PoolError } from "../errors";
import { readClock } from "../helpers/account_reads";
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

export type ActivationInitializeContext = {
  activationPoint: BN;
  currentPoint: BN;
  activationType: ActivationType;
  initSqrtPrice: BN;
  tickSpacing: number;
  whitelistedAddLiquidity: PublicKey;
};

export type ActivationHandler =
  | ActivationOpenHandler
  | ActivationBondingCurveHandler
  | ActivationTimeBasedHandler;

export function getCurrentPoint(
  activationType: number,
  slot: BN,
  timestamp: BN,
): BN {
  return tryCastActivationType(activationType) === ActivationType.Slot
    ? slot
    : timestamp;
}

export async function getCurrentPointNumber(
  connection: Connection,
  activationType: number,
  commitment?: Commitment,
): Promise<BN> {
  const clock = await readClock(connection, commitment);
  return getCurrentPoint(activationType, clock.slot, clock.timestamp);
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

export function validateActivationCombination(
  activationModes: ActivationMode[],
  activationPoint: BN,
  currentPoint: BN,
): void {
  const [first, second] = activationModes;
  const allowed =
    (first === ActivationMode.Open && second === ActivationMode.Open) ||
    (first === ActivationMode.Open && second === ActivationMode.BondingCurve) ||
    (first === ActivationMode.Open && second === ActivationMode.TimeBased) ||
    (first === ActivationMode.BondingCurve &&
      second === ActivationMode.TimeBased);

  if (!allowed) {
    throw PoolError.invalidParameters(
      "activationModes must be an allowed combination",
    );
  }

  if (!activationModes.includes(ActivationMode.TimeBased)) {
    if (!activationPoint.eq(currentPoint)) {
      throw PoolError.invalidParameters(
        "activationPoint must equal currentPoint without a TimeBased mode",
      );
    }
  }
}
