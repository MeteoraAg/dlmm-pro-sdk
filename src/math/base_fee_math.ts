import BN from "bn.js";
import { MAX_BASIS_POINT } from "../constants";
import { PoolError } from "../errors";
import { MAX_EXPONENTIAL, Q64, SCALE_OFFSET } from "./constants_math";
import {
  checkedDiv,
  checkedMul,
  safeDiv,
  safeMul,
  safeShl,
  safeSub,
  tryCastU64,
  U128_MAX,
} from "./safe_math";

// cliff_fee_numerator * (1-reduction_factor/10_000)^passed_period
export function getFeeInPeriod(
  cliffFeeNumerator: BN,
  reductionFactor: BN,
  passedPeriod: number,
): BN {
  if (reductionFactor.isZero()) {
    return cliffFeeNumerator;
  }
  const bps = safeDiv(
    safeShl(reductionFactor, SCALE_OFFSET, U128_MAX),
    new BN(MAX_BASIS_POINT),
    U128_MAX,
  );
  const base = safeSub(Q64, bps, U128_MAX);
  const result = pow(base, passedPeriod);
  if (result === null) {
    throw PoolError.mathOverflow();
  }

  const fee = safeMul(result, cliffFeeNumerator, U128_MAX).shrn(SCALE_OFFSET);
  return tryCastU64(fee);
}

export function pow(base: BN, exp: number): BN | null {
  if (exp === -2147483648) {
    return null;
  }

  let invert = exp < 0;

  if (exp === 0) {
    return new BN(1).shln(64);
  }

  const absExp = invert ? Math.abs(exp) : exp;

  if (absExp >= MAX_EXPONENTIAL) {
    return null;
  }

  let squaredBase = base.clone();
  let result = Q64.clone();

  if (squaredBase.gte(result)) {
    const inverted = checkedDiv(U128_MAX, squaredBase, U128_MAX);
    if (inverted === null) {
      return null;
    }
    squaredBase = inverted;
    invert = !invert;
  }

  const applyBit = (bit: number): boolean => {
    if ((absExp & bit) > 0) {
      const product = checkedMul(result, squaredBase, U128_MAX);
      if (product === null) {
        return false;
      }
      result = product.shrn(SCALE_OFFSET);
    }
    return true;
  };

  const squareBase = (): boolean => {
    const product = checkedMul(squaredBase, squaredBase, U128_MAX);
    if (product === null) {
      return false;
    }
    squaredBase = product.shrn(SCALE_OFFSET);
    return true;
  };

  if (!applyBit(0x1)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x2)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x4)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x8)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x10)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x20)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x40)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x80)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x100)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x200)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x400)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x800)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x1000)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x2000)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x4000)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x8000)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x10000)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x20000)) return null;

  if (!squareBase()) return null;
  if (!applyBit(0x40000)) return null;

  if (result.isZero()) {
    return null;
  }

  if (invert) {
    const inverted = checkedDiv(U128_MAX, result, U128_MAX);
    if (inverted === null) {
      return null;
    }
    result = inverted;
  }

  return result;
}
