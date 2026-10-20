import type BN from "bn.js";
import { MAX_FEE_NUMERATOR, MIN_FEE_NUMERATOR } from "../constants";
import { PoolError } from "../errors";
import { assertZeroPadding } from "../helpers/validation";

export function validateFeeBounds(
  minFeeNumerator: BN,
  maxFeeNumerator: BN,
): void {
  if (
    minFeeNumerator.lt(MIN_FEE_NUMERATOR) ||
    maxFeeNumerator.gt(MAX_FEE_NUMERATOR)
  ) {
    throw PoolError.invalidParameters(
      "fee numerators must be in MIN_FEE_NUMERATOR..=MAX_FEE_NUMERATOR",
    );
  }
}

export function validateSchedulerFields(inner: {
  reductionFactor: BN;
  numberOfPeriod: number;
  padding: number[];
}): void {
  if (inner.reductionFactor.isZero()) {
    throw PoolError.invalidParameters("reductionFactor must be non-zero");
  }
  if (inner.numberOfPeriod === 0) {
    throw PoolError.invalidParameters("numberOfPeriod must be non-zero");
  }
  assertZeroPadding(inner.padding);
}
