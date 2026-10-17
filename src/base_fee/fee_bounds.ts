import type BN from "bn.js";
import { MAX_FEE_NUMERATOR, MIN_FEE_NUMERATOR } from "../constants";
import { PoolError } from "../errors";

export function validateFeeBounds(
  minFeeNumerator: BN,
  maxFeeNumerator: BN,
): void {
  if (
    minFeeNumerator.lt(MIN_FEE_NUMERATOR) ||
    maxFeeNumerator.gt(MAX_FEE_NUMERATOR)
  ) {
    throw PoolError.invalidParameters();
  }
}
