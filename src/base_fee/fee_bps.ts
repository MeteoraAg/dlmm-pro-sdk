import BN from "bn.js";
import { FEE_DENOMINATOR, MAX_BASIS_POINT } from "../constants";
import { PoolError } from "../errors";
import {
  assertBps,
  assertNonZeroU16,
  isIntegerIn,
} from "../helpers/validation";
import { baseFeeNumeratorByPeriod } from "../math/base_fee_math";

export function bpsToFeeNumerator(bps: number): BN {
  if (!isIntegerIn(bps, 0, MAX_BASIS_POINT)) {
    throw PoolError.invalidParameters(
      "bps must be an integer in 0..=MAX_BASIS_POINT",
    );
  }
  return new BN(bps).mul(FEE_DENOMINATOR).divn(MAX_BASIS_POINT);
}

export function getSchedulerFeeNumerators(
  linear: boolean,
  startingBaseFeeBps: number,
  endingBaseFeeBps: number,
  numberOfPeriod: number,
): { cliffFeeNumerator: BN; reductionFactor: BN } {
  assertBps(startingBaseFeeBps, "startingBaseFeeBps");
  assertBps(endingBaseFeeBps, "endingBaseFeeBps");
  assertNonZeroU16(numberOfPeriod, "numberOfPeriod");
  if (startingBaseFeeBps <= endingBaseFeeBps) {
    throw PoolError.invalidParameters(
      "startingBaseFeeBps must be greater than endingBaseFeeBps; use fixedBaseFeeParameters for a constant fee",
    );
  }

  const cliffFeeNumerator = bpsToFeeNumerator(startingBaseFeeBps);
  const minFeeNumerator = bpsToFeeNumerator(endingBaseFeeBps);

  let reductionFactor = linear
    ? cliffFeeNumerator.sub(minFeeNumerator).divn(numberOfPeriod)
    : new BN(
        Math.floor(
          MAX_BASIS_POINT *
            (1 -
              Math.pow(
                endingBaseFeeBps / startingBaseFeeBps,
                1 / numberOfPeriod,
              )),
        ),
      );

  // Float rounding and the program's Q64 pow can leave the settled fee a unit
  // under the ending fee, which fails on chain when the ending fee is 1 bps.
  while (
    !reductionFactor.isZero() &&
    baseFeeNumeratorByPeriod(
      linear,
      cliffFeeNumerator,
      reductionFactor,
      numberOfPeriod,
    ).lt(minFeeNumerator)
  ) {
    reductionFactor = reductionFactor.subn(1);
  }

  if (reductionFactor.isZero()) {
    throw PoolError.invalidParameters(
      "numberOfPeriod is too large for the fee range: reductionFactor rounds to zero",
    );
  }
  return { cliffFeeNumerator, reductionFactor };
}
