import BN from "bn.js";
import { FEE_DENOMINATOR } from "../constants";
import { PoolError } from "../errors";
import { tryCastBaseFeeMode } from "../math/safe_math";
import { BaseFeeMode, type BaseFeeConfig } from "../types";
import { FixedBaseFeeHandler } from "./fixed_base_fee";
import {
  FeeMarketCapSchedulerExponential,
  FeeMarketCapSchedulerLinear,
} from "./market_cap_scheduler_base_fee";
import {
  FeeTimeSchedulerExponential,
  FeeTimeSchedulerLinear,
} from "./time_scheduler_base_fee";

export * from "./fixed_base_fee";
export * from "./time_scheduler_base_fee";
export * from "./market_cap_scheduler_base_fee";

export interface BaseFeeHandler {
  validate(): void;
  getBaseFeeNumerator(
    currentPoint: BN,
    activationPoint: BN,
    initSqrtPrice: BN,
    currentSqrtPrice: BN,
  ): BN;
}

export function getBaseFeeHandler(baseFee: BaseFeeConfig): BaseFeeHandler {
  const baseFeeMode = tryCastBaseFeeMode(baseFee.baseFeeMode);

  switch (baseFeeMode) {
    case BaseFeeMode.Fixed:
      return FixedBaseFeeHandler.fromBaseFeeConfig(baseFee);
    case BaseFeeMode.TimeSchedulerLinear:
      return FeeTimeSchedulerLinear.fromBaseFeeConfig(baseFee);
    case BaseFeeMode.TimeSchedulerExponential:
      return FeeTimeSchedulerExponential.fromBaseFeeConfig(baseFee);
    case BaseFeeMode.MarketCapSchedulerLinear:
      return FeeMarketCapSchedulerLinear.fromBaseFeeConfig(baseFee);
    case BaseFeeMode.MarketCapSchedulerExponential:
      return FeeMarketCapSchedulerExponential.fromBaseFeeConfig(baseFee);
  }
}

export function getBaseFeeNumerator(
  baseFee: BaseFeeConfig,
  currentPoint: BN,
  activationPoint: BN,
  initSqrtPrice: BN,
  currentSqrtPrice: BN,
): BN {
  return getBaseFeeHandler(baseFee).getBaseFeeNumerator(
    currentPoint,
    activationPoint,
    initSqrtPrice,
    currentSqrtPrice,
  );
}

export function validateBaseFeeConfig(baseFee: BaseFeeConfig): void {
  getBaseFeeHandler(baseFee).validate();
}

export function validateFeeFraction(numerator: BN, denominator: BN): void {
  if (denominator.isZero() || numerator.gte(denominator)) {
    throw PoolError.invalidParameters();
  }
}
