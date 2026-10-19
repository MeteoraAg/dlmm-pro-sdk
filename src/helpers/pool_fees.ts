import { validateBaseFeeConfig } from "../base_fee";
import { MAX_BASIS_POINT, MAX_FEE_NUMERATOR } from "../constants";
import { PoolError } from "../errors";
import { calculateTradingFeeNumerator } from "../math/dynamic_fee_math";
import type { DynamicFeeParameters, PoolFeeParameters } from "../types";

const MAX_U24 = 0xffffff;
const MAX_U16 = 0xffff;

export function validateDynamicFeeParameters(
  params: DynamicFeeParameters,
): void {
  if (
    !Number.isInteger(params.maxVolatilityAccumulator) ||
    params.maxVolatilityAccumulator < 0 ||
    params.maxVolatilityAccumulator > MAX_U24
  ) {
    throw PoolError.invalidParameters("maxVolatilityAccumulator must be a u24");
  }
  if (
    !Number.isInteger(params.variableFeeControl) ||
    params.variableFeeControl < 0 ||
    params.variableFeeControl > MAX_U24
  ) {
    throw PoolError.invalidParameters("variableFeeControl must be a u24");
  }
  if (
    !Number.isInteger(params.filterPeriod) ||
    params.filterPeriod <= 0 ||
    params.filterPeriod > MAX_U16
  ) {
    throw PoolError.invalidParameters("filterPeriod must be a non-zero u16");
  }
  if (
    !Number.isInteger(params.decayPeriod) ||
    params.decayPeriod <= 0 ||
    params.decayPeriod > MAX_U16
  ) {
    throw PoolError.invalidParameters("decayPeriod must be a non-zero u16");
  }
  if (params.filterPeriod >= params.decayPeriod) {
    throw PoolError.invalidParameters(
      "filterPeriod must be less than decayPeriod",
    );
  }
  if (
    !Number.isInteger(params.reductionFactor) ||
    params.reductionFactor <= 0 ||
    params.reductionFactor > MAX_BASIS_POINT
  ) {
    throw PoolError.invalidParameters(
      "reductionFactor must be in 1..=MAX_BASIS_POINT",
    );
  }
  if (
    !Number.isInteger(params.minDeltaTickForSignificantSwap) ||
    params.minDeltaTickForSignificantSwap <= 0 ||
    params.minDeltaTickForSignificantSwap > MAX_U16
  ) {
    throw PoolError.invalidParameters(
      "minDeltaTickForSignificantSwap must be a non-zero u16",
    );
  }

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
