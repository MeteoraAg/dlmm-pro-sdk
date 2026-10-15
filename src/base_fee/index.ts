import BN from "bn.js";
import { PoolError } from "../errors";
import { BaseFeeMode, type BaseFeeConfig } from "../types";
import { FixedBaseFeeHandler } from "./fixed_base_fee";
import { FeeMarketCapScheduler } from "./market_cap_scheduler_base_fee";
import { FeeTimeScheduler } from "./time_scheduler_base_fee";

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
  switch (baseFee.baseFeeMode) {
    case BaseFeeMode.Fixed:
      return FixedBaseFeeHandler.fromBaseFeeConfig(baseFee);
    case BaseFeeMode.TimeSchedulerLinear:
    case BaseFeeMode.TimeSchedulerExponential:
      return FeeTimeScheduler.fromBaseFeeConfig(baseFee);
    case BaseFeeMode.MarketCapSchedulerLinear:
    case BaseFeeMode.MarketCapSchedulerExponential:
      return FeeMarketCapScheduler.fromBaseFeeConfig(baseFee);
    default:
      throw PoolError.invalidBaseFeeMode();
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
