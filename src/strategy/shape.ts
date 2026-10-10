import type { Mint } from "@solana/spl-token";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
  MAX_LIQUIDITY_WEIGHT,
  MAX_TICK_SPACING,
  MAX_TICK_ID,
  POSITION_MAX_RANGE,
} from "../constants";
import { PoolError, PoolErrorCode } from "../errors";
import {
  getLiquidityFromAmountX,
  getLiquidityFromAmountY,
} from "../math/curve_math";
import { getAmountsFromLiquidity, liquidityBitmap } from "../helpers/liquidity";
import { isUsableTickId } from "../helpers/tick_array";
import {
  I128_MAX,
  U128_MAX,
  safeMul,
  tryCastU64,
  tryCastU128,
} from "../math/safe_math";
import { getSqrtPriceFromTickId } from "../math/tick_math";
import { calculateTransferFeeIncludedAmount } from "../quote/transfer_fee";
import {
  LiquiditySide,
  StrategyType,
  type AddLiquidityByWeightParameters,
  type TickRange,
} from "../types";
import { compressRanges } from "./ranges";
import { toWeightsByStrategy, type TickWeight } from "./weights";

export type LiquidityColumn = {
  tickId: number;
  tickUpperId: number;
  weight: number;
  side: LiquiditySide;
  sqrtPriceLower: BN;
  sqrtPriceUpper: BN;
  priceLower: Decimal;
  priceUpper: Decimal;
};

export type LiquidityRange = TickRange & {
  weight: number;
};

export type LiquidityShape = {
  strategy: StrategyType;
  tickSpacing: number;
  currentTickId: number;
  columns: LiquidityColumn[];
  ranges: LiquidityRange[];
};

export type LiquidityAmounts = {
  tickId: number;
  tickUpperId: number;
  liquidity: BN;
  amountX: BN;
  amountY: BN;
};

function q64ToDecimal(value: BN): Decimal {
  return new Decimal(value.toString()).div(new Decimal(2).pow(64));
}

export function tickPrice(tickId: number): Decimal {
  const sqrtPrice = getSqrtPriceFromTickId(tickId);
  return q64ToDecimal(sqrtPrice.mul(sqrtPrice).shrn(64));
}

export function tickUiPrice(
  tickId: number,
  decimalsX: number,
  decimalsY: number,
): Decimal {
  return tickPrice(tickId).mul(new Decimal(10).pow(decimalsY - decimalsX));
}

function sideOfTick(
  tickId: number,
  tickUpperId: number,
  currentTickId: number,
): LiquiditySide {
  if (currentTickId < tickId) {
    return LiquiditySide.Ask;
  }
  if (currentTickId >= tickUpperId) {
    return LiquiditySide.Bid;
  }
  return LiquiditySide.Active;
}

export function toLiquidityColumns(
  weights: TickWeight[],
  tickSpacing: number,
  currentTickId: number,
): LiquidityColumn[] {
  return weights.map((entry) => {
    const tickUpperId = entry.tickId + tickSpacing;
    return {
      tickId: entry.tickId,
      tickUpperId,
      weight: entry.weight,
      side: sideOfTick(entry.tickId, tickUpperId, currentTickId),
      sqrtPriceLower: getSqrtPriceFromTickId(entry.tickId),
      sqrtPriceUpper: getSqrtPriceFromTickId(tickUpperId),
      priceLower: tickPrice(entry.tickId),
      priceUpper: tickPrice(tickUpperId),
    };
  });
}

export function mergeEqualWeightRanges(
  weights: TickWeight[],
  tickSpacing: number,
): LiquidityRange[] {
  const funded = weights.filter((entry) => entry.weight > 0);
  if (funded.length === 0) {
    throw PoolError.invalidParameters();
  }

  const ranges: LiquidityRange[] = [];
  let start = funded[0];
  let previous = funded[0];

  for (let i = 1; i < funded.length; i++) {
    const current = funded[i];
    const adjacent =
      current.tickId === previous.tickId + tickSpacing &&
      current.weight === previous.weight;
    if (adjacent) {
      previous = current;
      continue;
    }
    ranges.push({
      tickLowerId: start.tickId,
      tickUpperId: previous.tickId + tickSpacing,
      weight: start.weight,
    });
    start = current;
    previous = current;
  }

  ranges.push({
    tickLowerId: start.tickId,
    tickUpperId: previous.tickId + tickSpacing,
    weight: start.weight,
  });
  return ranges;
}

function normalizeWeights(weights: TickWeight[]): TickWeight[] {
  let maxWeight = 0;
  for (const entry of weights) {
    if (entry.weight > maxWeight) {
      maxWeight = entry.weight;
    }
  }
  if (maxWeight <= 0) {
    throw PoolError.invalidParameters();
  }
  if (maxWeight <= MAX_LIQUIDITY_WEIGHT) {
    return weights;
  }
  return weights.map((entry) => ({
    tickId: entry.tickId,
    weight:
      entry.weight === 0
        ? 0
        : Math.max(
            1,
            Math.round((entry.weight / maxWeight) * MAX_LIQUIDITY_WEIGHT),
          ),
  }));
}

function validateU8Weights(weights: number[]): number[] {
  for (const weight of weights) {
    if (
      !Number.isInteger(weight) ||
      weight < 1 ||
      weight > MAX_LIQUIDITY_WEIGHT
    ) {
      throw PoolError.invalidParameters();
    }
  }
  return weights;
}

export function encodeAddLiquidityByWeight(args: {
  ranges: LiquidityRange[];
  /**
   * Position slots corresponding to `ranges`. Defaults to contiguous slots
   * starting at zero.
   */
  positionIndexes?: number[];
  maxAmountX: BN;
  maxAmountY: BN;
  multiplier: BN;
  /**
   * Position layout version the caller expects, guarding against a delegate
   * reordering the position ranges in between; defaults to no check.
   */
  expectedLayoutVersion?: number;
}): AddLiquidityByWeightParameters {
  if (args.ranges.length === 0 || args.ranges.length > POSITION_MAX_RANGE) {
    throw PoolError.invalidParameters();
  }
  if (args.multiplier.lte(new BN(0))) {
    throw PoolError.invalidParameters();
  }
  tryCastU64(args.maxAmountX);
  tryCastU64(args.maxAmountY);
  tryCastU128(args.multiplier);
  if (
    args.expectedLayoutVersion !== undefined &&
    (!Number.isInteger(args.expectedLayoutVersion) ||
      args.expectedLayoutVersion < 0 ||
      args.expectedLayoutVersion > 0xffff)
  ) {
    throw PoolError.invalidParameters();
  }

  const positionIndexes =
    args.positionIndexes ??
    Array.from({ length: args.ranges.length }, (_, index) => index);
  if (positionIndexes.length !== args.ranges.length) {
    throw PoolError.invalidParameters();
  }
  const bitmap = liquidityBitmap(positionIndexes);
  const weights = positionIndexes
    .map((positionIndex, index) => ({
      positionIndex,
      weight: args.ranges[index].weight,
    }))
    .sort((a, b) => a.positionIndex - b.positionIndex)
    .map(({ weight }) => weight);
  const validatedWeights = validateU8Weights(weights);
  for (const weight of validatedWeights) {
    const liquidity = safeMul(args.multiplier, new BN(weight), U128_MAX);
    if (liquidity.gt(I128_MAX)) {
      throw PoolError.liquidityIsTooHigh();
    }
  }

  return {
    maxAmountX: args.maxAmountX,
    maxAmountY: args.maxAmountY,
    expectedLayoutVersion: args.expectedLayoutVersion ?? null,
    bitmap,
    multiplier: args.multiplier,
    liquidities: Buffer.from(validatedWeights),
  };
}

export function amountsFromShape(args: {
  ranges: LiquidityRange[];
  currentTickId: number;
  currentSqrtPrice: BN;
  multiplier: BN;
}): LiquidityAmounts[] {
  return args.ranges.map((range) => {
    // convert_to_liquidity_delta caps per-range liquidity at i128::MAX on-chain
    const liquidity = safeMul(args.multiplier, new BN(range.weight), I128_MAX);
    const amounts = getAmountsFromLiquidity({
      tickCurrentId: args.currentTickId,
      tickLowerId: range.tickLowerId,
      tickUpperId: range.tickUpperId,
      currentSqrtPrice: args.currentSqrtPrice,
      liquidity,
    });
    return {
      tickId: range.tickLowerId,
      tickUpperId: range.tickUpperId,
      liquidity,
      amountX: amounts.amountX,
      amountY: amounts.amountY,
    };
  });
}

/**
 * Returns the largest multiplier whose exact ceil-rounded deposits
 * (`amountsFromShape`) fit within both budgets.
 * Assumes the boundary ticks hold no prior gross liquidity; existing
 * liquidity tightens the on-chain per-tick cap.
 */
export function multiplierFromAmounts(args: {
  ranges: LiquidityRange[];
  tickSpacing: number;
  currentTickId: number;
  currentSqrtPrice: BN;
  amountX: BN;
  amountY: BN;
  mintX: Mint | null;
  mintY: Mint | null;
  epoch: bigint;
}): BN {
  if (
    args.ranges.length === 0 ||
    !Number.isInteger(args.tickSpacing) ||
    args.tickSpacing < 1 ||
    args.tickSpacing > MAX_TICK_SPACING ||
    args.amountX.isNeg() ||
    args.amountY.isNeg()
  ) {
    throw PoolError.invalidParameters();
  }

  // liquidity_gross per tick is capped on-chain at u128::MAX / tick_count
  // (get_max_gross_liquidity_per_tick)
  const tickCount = 2 * Math.trunc(MAX_TICK_ID / args.tickSpacing) + 1;
  const maxGrossLiquidityPerTick = U128_MAX.div(new BN(tickCount));
  const tickGrossWeights = new Map<number, number>();

  let upperBound = I128_MAX;
  for (const range of args.ranges) {
    if (
      !Number.isInteger(range.weight) ||
      range.weight < 1 ||
      !Number.isInteger(range.tickLowerId) ||
      !Number.isInteger(range.tickUpperId) ||
      range.tickLowerId >= range.tickUpperId ||
      !isUsableTickId(range.tickLowerId, args.tickSpacing) ||
      !isUsableTickId(range.tickUpperId, args.tickSpacing)
    ) {
      throw PoolError.invalidParameters();
    }
    for (const tickId of [range.tickLowerId, range.tickUpperId]) {
      tickGrossWeights.set(
        tickId,
        (tickGrossWeights.get(tickId) ?? 0) + range.weight,
      );
    }
    const weight = new BN(range.weight);
    upperBound = BN.min(upperBound, I128_MAX.div(weight));

    const sqrtPriceLower = getSqrtPriceFromTickId(range.tickLowerId);
    const sqrtPriceUpper = getSqrtPriceFromTickId(range.tickUpperId);

    if (args.currentTickId < range.tickUpperId) {
      const liquidityX = getLiquidityFromAmountX(
        args.currentTickId < range.tickLowerId
          ? sqrtPriceLower
          : args.currentSqrtPrice,
        sqrtPriceUpper,
        args.amountX,
      );
      if (liquidityX !== null) {
        upperBound = BN.min(upperBound, liquidityX.div(weight));
      }
    }
    if (args.currentTickId >= range.tickLowerId) {
      const liquidityY = getLiquidityFromAmountY(
        sqrtPriceLower,
        args.currentTickId >= range.tickUpperId
          ? sqrtPriceUpper
          : args.currentSqrtPrice,
        args.amountY,
      );
      if (liquidityY !== null) {
        upperBound = BN.min(upperBound, liquidityY.div(weight));
      }
    }
  }

  for (const grossWeight of tickGrossWeights.values()) {
    upperBound = BN.min(
      upperBound,
      maxGrossLiquidityPerTick.div(new BN(grossWeight)),
    );
  }

  const fits = (multiplier: BN): boolean => {
    let totalX = new BN(0);
    let totalY = new BN(0);
    for (const item of amountsFromShape({
      ranges: args.ranges,
      currentTickId: args.currentTickId,
      currentSqrtPrice: args.currentSqrtPrice,
      multiplier,
    })) {
      totalX = totalX.add(item.amountX);
      totalY = totalY.add(item.amountY);
    }
    const requiredX = calculateTransferFeeIncludedAmount(
      args.mintX,
      args.epoch,
      totalX,
    ).amount;
    const requiredY = calculateTransferFeeIncludedAmount(
      args.mintY,
      args.epoch,
      totalY,
    ).amount;
    return requiredX.lte(args.amountX) && requiredY.lte(args.amountY);
  };

  let low = new BN(0);
  let high = upperBound;
  for (let i = 0; i < 128 && low.lt(high); i++) {
    const mid = low.add(high.sub(low).addn(1).shrn(1));
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid.subn(1);
    }
  }

  if (low.lte(new BN(0))) {
    throw PoolError.invalidParameters();
  }
  return low;
}

/**
 * `maxRanges` compresses the equal-weight ranges down to that many with
 * `compressRanges`. Without it a shape over `POSITION_MAX_RANGE` ranges is
 * rejected.
 */
export function buildLiquidityShape(args: {
  strategy: StrategyType;
  minTickId: number;
  maxTickId: number;
  tickSpacing: number;
  currentTickId: number;
  weights?: TickWeight[];
  maxRanges?: number;
}): LiquidityShape {
  if (args.tickSpacing <= 0) {
    throw PoolError.invalidParameters();
  }
  if (
    !isUsableTickId(args.minTickId, args.tickSpacing) ||
    !isUsableTickId(args.maxTickId, args.tickSpacing)
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    args.strategy === StrategyType.Custom &&
    args.weights?.some(
      (entry) => !isUsableTickId(entry.tickId, args.tickSpacing),
    )
  ) {
    throw PoolError.invalidParameters();
  }

  const weights = normalizeWeights(toWeightsByStrategy(args));
  if (weights[weights.length - 1].tickId + args.tickSpacing > MAX_TICK_ID) {
    throw PoolError.invalidParameters();
  }
  const merged = mergeEqualWeightRanges(weights, args.tickSpacing);
  let ranges = merged;
  if (args.maxRanges !== undefined) {
    ranges = compressRanges(
      merged,
      args.tickSpacing,
      args.currentTickId,
      args.maxRanges,
    );
  } else if (merged.length > POSITION_MAX_RANGE) {
    throw new PoolError(
      PoolErrorCode.InvalidParameters,
      `Liquidity shape spans ${merged.length} weight ranges; positions support at most ${POSITION_MAX_RANGE}. Pass maxRanges, widen the tick spacing, or narrow the tick range.`,
    );
  }
  return {
    strategy: args.strategy,
    tickSpacing: args.tickSpacing,
    currentTickId: args.currentTickId,
    columns: toLiquidityColumns(weights, args.tickSpacing, args.currentTickId),
    ranges,
  };
}
