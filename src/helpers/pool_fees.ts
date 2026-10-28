import { validateBaseFeeConfig } from "../base_fee";
import { MAX_BASIS_POINT, MAX_FEE_NUMERATOR } from "../constants";
import { PoolError } from "../errors";
import { calculateTradingFeeNumerator } from "../math/dynamic_fee_math";
import type { DynamicFeeParameters, PoolFeeParameters } from "../types";
import { assertNonZeroU16, assertU24, isIntegerIn } from "./validation";

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

export function validatePoolFeeParameters(poolFees: PoolFeeParameters): void {
  validateBaseFeeConfig(poolFees.baseFeeParameter);
  if (poolFees.dynamicFeeParameter) {
    validateDynamicFeeParameters(poolFees.dynamicFeeParameter);
  }
}
