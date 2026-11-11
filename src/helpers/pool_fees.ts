import { bpsToFeeNumerator, validateBaseFeeConfig } from "../base_fee";
import {
  MAX_BASIS_POINT,
  MAX_FEE_NUMERATOR,
  MAX_REFERENCE_AGE,
} from "../constants";
import { PoolError } from "../errors";
import {
  calculateTradingFeeNumerator,
  variableFeeControlForCap,
  volatilityAccumulatorForPriceChange,
} from "../math/dynamic_fee_math";
import type { DynamicFeeParameters, PoolFeeParameters } from "../types";
import { assertNonZeroU16, assertU24, isIntegerIn } from "./validation";

export const DYNAMIC_FEE_FILTER_PERIOD = 10;
export const DYNAMIC_FEE_DECAY_PERIOD = 120;
export const DYNAMIC_FEE_REDUCTION_FACTOR = 5_000; // 50%
export const DYNAMIC_FEE_MAX_PRICE_CHANGE_BPS = 1_500; // 15%

export type DynamicFeeParamsOptions = {
  maxPriceChangeBps?: number;
  maxVolatilityAccumulator?: number;
};

export function validateDynamicFeeParameters(
  params: DynamicFeeParameters,
): void {
  assertU24(params.maxVolatilityAccumulator, "maxVolatilityAccumulator");
  assertU24(params.variableFeeControl, "variableFeeControl");
  assertNonZeroU16(params.filterPeriod, "filterPeriod");
  assertNonZeroU16(params.decayPeriod, "decayPeriod");
  if (params.filterPeriod >= params.decayPeriod) {
    throw PoolError.invalidParameters(
      "filterPeriod must be less than decayPeriod",
    );
  }
  // references reset after MAX_REFERENCE_AGE, so a longer decay period is unreachable
  if (params.decayPeriod > MAX_REFERENCE_AGE.toNumber()) {
    throw PoolError.invalidParameters(
      "decayPeriod must be <= MAX_REFERENCE_AGE",
    );
  }
  if (!isIntegerIn(params.reductionFactor, 1, MAX_BASIS_POINT)) {
    throw PoolError.invalidParameters(
      "reductionFactor must be in 1..=MAX_BASIS_POINT",
    );
  }
  assertNonZeroU16(
    params.minDeltaTickForSignificantSwap,
    "minDeltaTickForSignificantSwap",
  );

  const maxVariableFeeNumerator = calculateTradingFeeNumerator(
    params.variableFeeControl,
    params.maxVolatilityAccumulator,
  );
  if (maxVariableFeeNumerator.gt(MAX_FEE_NUMERATOR)) {
    throw PoolError.invalidParameters(
      "variableFeeControl * maxVolatilityAccumulator must not exceed MAX_FEE_NUMERATOR",
    );
  }
}

export function getDynamicFeeParams(
  baseFeeBps: number,
  minDeltaTickForSignificantSwap: number,
  options?: DynamicFeeParamsOptions,
): DynamicFeeParameters {
  const maxVolatilityAccumulator =
    options?.maxVolatilityAccumulator ??
    volatilityAccumulatorForPriceChange(
      options?.maxPriceChangeBps ?? DYNAMIC_FEE_MAX_PRICE_CHANGE_BPS,
    );
  // 20% of baseFeeBps
  const maxDynamicFeeNumerator = bpsToFeeNumerator(baseFeeBps)
    .muln(20)
    .divn(100);
  const params: DynamicFeeParameters = {
    maxVolatilityAccumulator,
    variableFeeControl: variableFeeControlForCap(
      maxDynamicFeeNumerator,
      maxVolatilityAccumulator,
    ),
    filterPeriod: DYNAMIC_FEE_FILTER_PERIOD,
    decayPeriod: DYNAMIC_FEE_DECAY_PERIOD,
    reductionFactor: DYNAMIC_FEE_REDUCTION_FACTOR,
    minDeltaTickForSignificantSwap,
  };
  validateDynamicFeeParameters(params);
  return params;
}

export function validatePoolFeeParameters(poolFees: PoolFeeParameters): void {
  validateBaseFeeConfig(poolFees.baseFeeParameter);
  if (poolFees.dynamicFeeParameter) {
    validateDynamicFeeParameters(poolFees.dynamicFeeParameter);
  }
}
