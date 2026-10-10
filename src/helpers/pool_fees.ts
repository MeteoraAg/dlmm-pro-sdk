import { validateBaseFeeConfig } from "../base_fee";
import { MAX_BASIS_POINT, MAX_FEE_NUMERATOR } from "../constants";
import { PoolError } from "../errors";
import { calculateTradingFeeNumerator } from "../math/dynamic_fee_math";
import type { DynamicFeeParameters, PoolFeeParameters } from "../types";

const U24_MAX = 0xffffff;
const U16_MAX = 0xffff;

export function validateDynamicFeeParameters(
  params: DynamicFeeParameters,
): void {
  if (
    !Number.isInteger(params.maxVolatilityAccumulator) ||
    params.maxVolatilityAccumulator < 0 ||
    params.maxVolatilityAccumulator > U24_MAX
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    !Number.isInteger(params.variableFeeControl) ||
    params.variableFeeControl < 0 ||
    params.variableFeeControl > U24_MAX
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    !Number.isInteger(params.filterPeriod) ||
    params.filterPeriod <= 0 ||
    params.filterPeriod > U16_MAX ||
    !Number.isInteger(params.decayPeriod) ||
    params.decayPeriod <= 0 ||
    params.decayPeriod > U16_MAX
  ) {
    throw PoolError.invalidParameters();
  }
  if (params.filterPeriod >= params.decayPeriod) {
    throw PoolError.invalidParameters();
  }
  if (
    !Number.isInteger(params.reductionFactor) ||
    params.reductionFactor <= 0 ||
    params.reductionFactor > MAX_BASIS_POINT
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    !Number.isInteger(params.minDeltaTickForSignificantSwap) ||
    params.minDeltaTickForSignificantSwap <= 0 ||
    params.minDeltaTickForSignificantSwap > U16_MAX
  ) {
    throw PoolError.invalidParameters();
  }

  const maxVariableFeeNumerator = calculateTradingFeeNumerator(
    params.variableFeeControl,
    params.maxVolatilityAccumulator,
  );
  if (maxVariableFeeNumerator.gt(MAX_FEE_NUMERATOR)) {
    throw PoolError.invalidParameters();
  }
}

export function validatePoolFeeParameters(poolFees: PoolFeeParameters): void {
  validateBaseFeeConfig(poolFees.baseFeeParameter);
  if (poolFees.dynamicFeeParameter) {
    validateDynamicFeeParameters(poolFees.dynamicFeeParameter);
  }
}
