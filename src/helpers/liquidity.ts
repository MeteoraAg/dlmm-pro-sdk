import BN from "bn.js";
import { MAX_LIQUIDITY_WEIGHT, POSITION_MAX_RANGE } from "../constants";
import { PoolError } from "../errors";
import {
  getDeltaAmountX,
  getDeltaAmountY,
  getLiquidityFromAmountX,
  getLiquidityFromAmountY,
} from "../math/curve_math";
import { I128_MAX, U128_MAX, safeMul } from "../math/safe_math";
import { getSqrtPriceFromTickId } from "../math/tick_math";
import { Rounding, type AddLiquidityByWeightParameters } from "../types";
import {
  assertOptionalU16,
  assertU64,
  assertU128,
  isIntegerIn,
} from "./validation";

/**
 * Liquidity for depositing at most `maxTokenX`/`maxTokenY` into the range at
 * the current price. The budgets are pool-side amounts: for a Token-2022
 * transfer-fee mint pass what the pool receives
 * (`calculateTransferFeeExcludedAmount`), since `addLiquidity` compares its
 * fee-inclusive `maxAmount*` against the deposit plus fee.
 * `multiplierFromAmounts` does this when given the mints.
 */
export function getLiquidityFromAmounts(args: {
  maxTokenX: BN;
  maxTokenY: BN;
  tickLowerId: number;
  tickUpperId: number;
  tickCurrentId: number;
  currentSqrtPrice: BN;
}): BN {
  const sqrtPriceLower = getSqrtPriceFromTickId(args.tickLowerId);
  const sqrtPriceUpper = getSqrtPriceFromTickId(args.tickUpperId);

  // Same branches as calculate_liquidity_token_deltas: the side of the range
  // the current tick is on decides which token funds the deposit.
  if (args.tickCurrentId < args.tickLowerId) {
    return requireLiquidity(
      getLiquidityFromAmountX(sqrtPriceLower, sqrtPriceUpper, args.maxTokenX),
    );
  }
  if (args.tickCurrentId >= args.tickUpperId) {
    return requireLiquidity(
      getLiquidityFromAmountY(sqrtPriceLower, sqrtPriceUpper, args.maxTokenY),
    );
  }
  const liquidityX = getLiquidityFromAmountX(
    args.currentSqrtPrice,
    sqrtPriceUpper,
    args.maxTokenX,
  );
  const liquidityY = getLiquidityFromAmountY(
    sqrtPriceLower,
    args.currentSqrtPrice,
    args.maxTokenY,
  );
  if (liquidityX !== null && liquidityY !== null) {
    return requireLiquidity(BN.min(liquidityX, liquidityY));
  }
  return requireLiquidity(liquidityX ?? liquidityY);
}

export function getAmountsFromLiquidity(args: {
  tickCurrentId: number;
  tickLowerId: number;
  tickUpperId: number;
  currentSqrtPrice: BN;
  liquidity: BN;
}): { amountX: BN; amountY: BN } {
  const sqrtPriceLower = getSqrtPriceFromTickId(args.tickLowerId);
  const sqrtPriceUpper = getSqrtPriceFromTickId(args.tickUpperId);
  const round = args.liquidity.isNeg() ? Rounding.Down : Rounding.Up;
  const liquidity = args.liquidity.abs();

  if (args.tickCurrentId < args.tickLowerId) {
    return {
      amountX: getDeltaAmountX(
        sqrtPriceLower,
        sqrtPriceUpper,
        liquidity,
        round,
      ),
      amountY: new BN(0),
    };
  }
  if (args.tickCurrentId >= args.tickUpperId) {
    return {
      amountX: new BN(0),
      amountY: getDeltaAmountY(
        sqrtPriceLower,
        sqrtPriceUpper,
        liquidity,
        round,
      ),
    };
  }
  return {
    amountX: getDeltaAmountX(
      args.currentSqrtPrice,
      sqrtPriceUpper,
      liquidity,
      round,
    ),
    amountY: getDeltaAmountY(
      sqrtPriceLower,
      args.currentSqrtPrice,
      liquidity,
      round,
    ),
  };
}

export function liquidityBitmap(positionIndexes: number[]): BN {
  if (positionIndexes.length === 0) {
    throw PoolError.invalidParameters("positionIndexes must not be empty");
  }
  let bitmap = new BN(0);
  const seen = new Set<number>();
  for (const index of positionIndexes) {
    if (!isIntegerIn(index, 0, POSITION_MAX_RANGE - 1) || seen.has(index)) {
      throw PoolError.invalidParameters(
        "positionIndexes must be unique integers in 0..POSITION_MAX_RANGE",
      );
    }
    seen.add(index);
    bitmap = bitmap.or(new BN(1).shln(index));
  }
  return bitmap;
}

export function positionIndexesFromBitmap(bitmap: BN): number[] {
  if (
    bitmap.isNeg() ||
    bitmap.isZero() ||
    bitmap.bitLength() > POSITION_MAX_RANGE
  ) {
    throw PoolError.invalidParameters(
      "bitmap must select at least one position below POSITION_MAX_RANGE",
    );
  }
  const indexes: number[] = [];
  for (let index = 0; index < POSITION_MAX_RANGE; index++) {
    if (bitmap.testn(index)) {
      indexes.push(index);
    }
  }
  return indexes;
}

/** Whether a position range can take `weight`: an integer in `1..=MAX_LIQUIDITY_WEIGHT`. */
export function isLiquidityWeight(weight: number): boolean {
  return isIntegerIn(weight, 1, MAX_LIQUIDITY_WEIGHT);
}

function assertOnePerSlot(bitmap: BN, length: number): void {
  if (positionIndexesFromBitmap(bitmap).length !== length) {
    throw PoolError.invalidParameters(
      "liquidities must have one entry per bitmap slot",
    );
  }
}

export function validateBitmapLiquidities(bitmap: BN, liquidities: BN[]): void {
  assertOnePerSlot(bitmap, liquidities.length);
  for (const liquidity of liquidities) {
    assertU128(liquidity, "liquidities");
    if (liquidity.isZero()) {
      throw PoolError.liquidityIsZero();
    }
    if (liquidity.gt(I128_MAX)) {
      throw PoolError.liquidityIsTooHigh();
    }
  }
}

export function validateAddLiquidityByWeightParameters(
  parameters: AddLiquidityByWeightParameters,
): void {
  const { multiplier, liquidities: weights } = parameters;
  assertU64(parameters.maxAmountX, "maxAmountX");
  assertU64(parameters.maxAmountY, "maxAmountY");
  assertOptionalU16(parameters.expectedLayoutVersion, "expectedLayoutVersion");
  assertU128(multiplier, "multiplier");
  if (multiplier.isZero()) {
    throw PoolError.liquidityIsZero();
  }
  assertOnePerSlot(parameters.bitmap, weights.length);
  for (const weight of weights) {
    if (!isLiquidityWeight(weight)) {
      throw PoolError.invalidParameters(
        "liquidities must be weights in 1..=MAX_LIQUIDITY_WEIGHT",
      );
    }
    if (safeMul(multiplier, new BN(weight), U128_MAX).gt(I128_MAX)) {
      throw PoolError.liquidityIsTooHigh();
    }
  }
}

function requireLiquidity(liquidity: BN | null): BN {
  if (!liquidity || liquidity.isZero()) {
    throw PoolError.liquidityIsZero();
  }
  return liquidity;
}
