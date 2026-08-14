import BN from "bn.js";
import { PoolError } from "../errors";
import { Rounding } from "../types";
import {
  divCeil,
  safeAdd,
  safeDiv,
  safeMul,
  safeShl,
  safeSub,
  tryCastU64,
  tryCastU128,
  U128_MAX,
  U192_MAX,
  U256_MAX,
  U320_MAX,
} from "./safe_math";

/// Gets the delta amount_x for given liquidity and price range
///
/// # Formula
///
/// * `Δx = L * (1 / √P_lower - 1 / √P_upper)`
/// * i.e. `L * (√P_upper - √P_lower) / (√P_upper * √P_lower)`
export function getDeltaAmountXUnchecked(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  liquidity: BN,
  round: Rounding,
): BN {
  if (lowerSqrtPrice.lte(new BN(0))) {
    throw PoolError.mathOverflow();
  }
  const numerator1 = liquidity.clone();
  const numerator2 = safeSub(upperSqrtPrice, lowerSqrtPrice, U128_MAX);
  const prod = safeMul(numerator1, numerator2, U256_MAX);
  const denominator = safeMul(lowerSqrtPrice, upperSqrtPrice, U256_MAX);

  if (round === Rounding.Up) {
    return divCeil(prod, denominator);
  }
  return safeDiv(prod, denominator, U256_MAX);
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

/// Gets the delta amount_y for given liquidity and price range
/// Δy = L * (√P_upper - √P_lower)
export function getDeltaAmountYUnchecked(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  liquidity: BN,
  round: Rounding,
): BN {
  const deltaSqrtPrice = safeSub(upperSqrtPrice, lowerSqrtPrice, U128_MAX);
  const prod = safeMul(liquidity, deltaSqrtPrice, U256_MAX);

  if (round === Rounding.Up) {
    const denominator = safeShl(new BN(1), 128, U256_MAX);
    return divCeil(prod, denominator);
  }
  return prod.shrn(128);
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

/// Gets the next sqrt price given an input amount of token X or token Y
/// Throws if price or liquidity are 0, or if the next price overflow q64.64
export function getNextSqrtPriceFromInput(
  sqrtPrice: BN,
  liquidity: BN,
  amountIn: BN,
  swapForY: boolean,
): BN {
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

/// Gets the next sqrt price √P' given a delta of token_x
///
/// Always round up because
/// 1. In the exact output case, token_x supply decreases leading to price increase.
/// Move price up so that exact output is met.
/// 2. In the exact input case, token_x supply increases leading to price decrease.
/// Do not round down to minimize price impact. We only need to meet input
/// change and not guarantee exact output.
///
/// Use function for exact input or exact output swaps for token_x
///
/// # Formula
///
/// * `√P' = √P * L / (L + Δx * √P)`
/// * If Δx * √P overflows, use alternate form `√P' = L / (L/√P + Δx)`
function getNextSqrtPriceFromAmountInXRoundingUp(
  sqrtPrice: BN,
  liquidity: BN,
  amount: BN,
): BN {
  const product = safeMul(amount, sqrtPrice, U256_MAX);
  const denominator = safeAdd(liquidity, product, U256_MAX);
  const result = divCeil(safeMul(liquidity, sqrtPrice, U256_MAX), denominator);
  return tryCastU128(result);
}

/// Gets the next sqrt price given a delta of token_y
///
/// Always round down because
/// 1. In the exact output case, token_y supply decreases leading to price decrease.
/// Move price down by rounding down so that exact output of token_a is met.
/// 2. In the exact input case, token_y supply increases leading to price increase.
/// Do not round down to minimize price impact. We only need to meet input
/// change and not guarantee exact output for token_x.
///
/// # Formula
///
/// * `√P' = √P + Δy / L`
function getNextSqrtPriceFromAmountInYRoundingDown(
  sqrtPrice: BN,
  liquidity: BN,
  amount: BN,
): BN {
  const quotient = safeDiv(
    safeShl(amount, 128, U256_MAX),
    liquidity,
    U256_MAX,
  );
  const result = safeAdd(sqrtPrice, quotient, U256_MAX);

  if (result.gt(U128_MAX)) {
    return U128_MAX.clone();
  }
  return tryCastU128(result);
}

/// Gets the liquidity for a given amount_x and price range.
///
/// Inverse of [`getDeltaAmountX`].
///
/// # Formula
///
/// From `Δx = L * (√P_upper - √P_lower) / (√P_lower * √P_upper)`:
///
/// * `L = Δx * (√P_lower * √P_upper) / (√P_upper - √P_lower)`
/// return null if √P_upper <= √P_lower, indicate no X side
export function getLiquidityFromAmountX(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  amountX: BN,
): BN | null {
  if (lowerSqrtPrice.gte(upperSqrtPrice)) {
    return null;
  }

  const prod = safeMul(
    safeMul(amountX, lowerSqrtPrice, U320_MAX),
    upperSqrtPrice,
    U320_MAX,
  );
  const denominator = safeSub(upperSqrtPrice, lowerSqrtPrice, U128_MAX);
  return safeDiv(prod, denominator, U320_MAX);
}

/// Gets the liquidity for a given amount_y and price range.
///
/// Inverse of [`getDeltaAmountY`].
///
/// # Formula
///
/// From `Δy = L * (√P_upper - √P_lower) / 2^128`:
///
/// * `L = (Δy << 128) / (√P_upper - √P_lower)`
/// return null if √P_upper <= √P_lower, indicate no Y side
export function getLiquidityFromAmountY(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  amountY: BN,
): BN | null {
  if (lowerSqrtPrice.gte(upperSqrtPrice)) {
    return null;
  }
  const deltaSqrtPrice = safeSub(upperSqrtPrice, lowerSqrtPrice, U128_MAX);
  const prod = safeShl(amountY, 128, U192_MAX);
  return safeDiv(prod, deltaSqrtPrice, U192_MAX);
}
