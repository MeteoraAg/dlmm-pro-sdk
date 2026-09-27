import BN from "bn.js";
import {
  FEE_DENOMINATOR,
  MAX_FEE_NUMERATOR,
  MIN_FEE_NUMERATOR,
} from "../constants";
import { PoolError } from "../errors";
import { U64_MAX } from "../math/safe_math";

export function validateFeeFraction(numerator: BN, denominator: BN): void {
  if (
    numerator.isNeg() ||
    denominator.lten(0) ||
    numerator.gt(U64_MAX) ||
    denominator.gt(U64_MAX) ||
    numerator.gte(denominator)
  ) {
    throw PoolError.invalidParameters();
  }
}

export function validateFeeBounds(
  minFeeNumerator: BN,
  maxFeeNumerator: BN,
): void {
  validateFeeFraction(minFeeNumerator, FEE_DENOMINATOR);
  validateFeeFraction(maxFeeNumerator, FEE_DENOMINATOR);
  if (
    minFeeNumerator.lt(MIN_FEE_NUMERATOR) ||
    maxFeeNumerator.gt(MAX_FEE_NUMERATOR)
  ) {
    throw PoolError.invalidParameters();
  }
}
