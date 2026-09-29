import BN from "bn.js";
import { PoolError } from "../errors";
import { Rounding } from "../types";
import {
  divCeil,
  downScaleCeil,
  safeAdd,
  safeDiv,
  safeMul,
  safeShl,
  safeSub,
  tryCastU64,
  tryCastU128,
  U128_MAX,
  U256_MAX,
  U320_MAX,
} from "./safe_math";

// Δx = L * (√P_upper - √P_lower) / (√P_upper * √P_lower)
export function getDeltaAmountXUnchecked(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  liquidity: BN,
  round: Rounding,
): BN {
  tryCastU128(lowerSqrtPrice);
  tryCastU128(upperSqrtPrice);
  tryCastU128(liquidity);
  if (lowerSqrtPrice.lte(new BN(0))) {
    throw PoolError.mathOverflow();
  }
  // (L << 64) * (√P_upper - √P_lower) passes 2^256 at the per-tick liquidity cap.
  const numerator1 = safeShl(liquidity, 64, U320_MAX);
  const numerator2 = safeSub(upperSqrtPrice, lowerSqrtPrice, U128_MAX);
  const prod = safeMul(numerator1, numerator2, U320_MAX);
  const denominator = safeMul(lowerSqrtPrice, upperSqrtPrice, U320_MAX);

  if (round === Rounding.Up) {
    return divCeil(prod, denominator);
  }
  return safeDiv(prod, denominator, U320_MAX);
}

export function getDeltaAmountX(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  liquidity: BN,
  round: Rounding,
): BN {
  return tryCastU64(
    getDeltaAmountXUnchecked(lowerSqrtPrice, upperSqrtPrice, liquidity, round),
  );
}

// Δy = L * (√P_upper - √P_lower)
export function getDeltaAmountYUnchecked(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  liquidity: BN,
  round: Rounding,
): BN {
  tryCastU128(lowerSqrtPrice);
  tryCastU128(upperSqrtPrice);
  tryCastU128(liquidity);
  const deltaSqrtPrice = safeSub(upperSqrtPrice, lowerSqrtPrice, U128_MAX);
  // u128 liquidity * Q64.64 delta overflows U192 at the per-tick liquidity cap.
  const prod = safeMul(liquidity, deltaSqrtPrice, U256_MAX);

  if (round === Rounding.Up) {
    return downScaleCeil(prod, 64);
  }
  return prod.shrn(64);
}

export function getDeltaAmountY(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  liquidity: BN,
  round: Rounding,
): BN {
  return tryCastU64(
    getDeltaAmountYUnchecked(lowerSqrtPrice, upperSqrtPrice, liquidity, round),
  );
}

export function getNextSqrtPriceFromInput(
  sqrtPrice: BN,
  liquidity: BN,
  amountIn: BN,
  swapForY: boolean,
): BN {
  tryCastU128(sqrtPrice);
  tryCastU128(liquidity);
  tryCastU64(amountIn);
  if (amountIn.isZero()) {
    return sqrtPrice;
  }

  if (swapForY) {
    return getNextSqrtPriceFromAmountInXRoundingUp(
      sqrtPrice,
      liquidity,
      amountIn,
    );
  }
  return getNextSqrtPriceFromAmountInYRoundingDown(
    sqrtPrice,
    liquidity,
    amountIn,
  );
}

/** `√P' = √P × L / (L + Δx × √P)`, rounded up. */
function getNextSqrtPriceFromAmountInXRoundingUp(
  sqrtPrice: BN,
  liquidity: BN,
  amount: BN,
): BN {
  const shiftedLiquidity = safeShl(liquidity, 64, U320_MAX);
  const product = safeMul(amount, sqrtPrice, U320_MAX);
  const denominator = safeAdd(shiftedLiquidity, product, U320_MAX);
  const result = divCeil(
    safeMul(shiftedLiquidity, sqrtPrice, U320_MAX),
    denominator,
  );
  return tryCastU128(result);
}

/** `√P' = √P + Δy / L`, rounded down. */
function getNextSqrtPriceFromAmountInYRoundingDown(
  sqrtPrice: BN,
  liquidity: BN,
  amount: BN,
): BN {
  const quotient = safeDiv(safeShl(amount, 64, U128_MAX), liquidity, U128_MAX);
  const result = sqrtPrice.add(quotient);

  if (result.gt(U128_MAX)) {
    return U128_MAX.clone();
  }
  return result;
}

// L = Δx * √P_lower * √P_upper / (√P_upper - √P_lower); null when there is no X side.
export function getLiquidityFromAmountX(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  amountX: BN,
): BN | null {
  tryCastU128(lowerSqrtPrice);
  tryCastU128(upperSqrtPrice);
  tryCastU64(amountX);
  if (lowerSqrtPrice.gte(upperSqrtPrice)) {
    return null;
  }

  const prod = safeMul(
    safeMul(amountX, lowerSqrtPrice, U320_MAX),
    upperSqrtPrice,
    U320_MAX,
  );
  const denominator = safeSub(upperSqrtPrice, lowerSqrtPrice, U128_MAX);
  return safeDiv(prod, denominator, U320_MAX).shrn(64);
}

// L = (Δy << 64) / (√P_upper - √P_lower); null when there is no Y side.
export function getLiquidityFromAmountY(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  amountY: BN,
): BN | null {
  tryCastU128(lowerSqrtPrice);
  tryCastU128(upperSqrtPrice);
  tryCastU64(amountY);
  if (lowerSqrtPrice.gte(upperSqrtPrice)) {
    return null;
  }
  const deltaSqrtPrice = safeSub(upperSqrtPrice, lowerSqrtPrice, U128_MAX);
  const prod = safeShl(amountY, 64, U128_MAX);
  return safeDiv(prod, deltaSqrtPrice, U128_MAX);
}
