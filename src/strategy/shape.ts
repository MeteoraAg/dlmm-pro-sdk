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
import {
  getAmountsFromLiquidity,
  isLiquidityWeight,
  liquidityBitmap,
  validateAddLiquidityByWeightParameters,
} from "../helpers/liquidity";
import { isUsableTickId } from "../helpers/tick_array";
import { I128_MAX, U64_MAX, U128_MAX, safeMul } from "../math/safe_math";
import { getSqrtPriceFromTickId } from "../math/tick_math";
import { transferFeeIncludedAmountWithinU64 } from "../quote/transfer_fee";
import {
  LiquidityLayout,
  LiquiditySide,
  StrategyType,
  type AddLiquidityByWeightParameters,
  type TickRange,
} from "../types";
import { stackWeightLevels } from "./layers";
import {
  quantizeWeights,
  toWeightsByStrategy,
  type TickWeight,
} from "./weights";

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
  layout: LiquidityLayout;
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
  return tickPrice(tickId).mul(new Decimal(10).pow(decimalsX - decimalsY));
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
    const extendsRun =
      current.tickId === previous.tickId + tickSpacing &&
      current.weight === previous.weight;
    if (extendsRun) {
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
  if (!weights.every(isLiquidityWeight)) {
    throw PoolError.invalidParameters();
  }
  const parameters = {
    maxAmountX: args.maxAmountX,
    maxAmountY: args.maxAmountY,
    expectedLayoutVersion: args.expectedLayoutVersion ?? null,
    bitmap,
    multiplier: args.multiplier,
    liquidities: Buffer.from(weights),
  };
  validateAddLiquidityByWeightParameters(parameters);
  return parameters;
}

export function amountsFromShape(args: {
  ranges: LiquidityRange[];
  currentTickId: number;
  currentSqrtPrice: BN;
  multiplier: BN;
}): LiquidityAmounts[] {
  return args.ranges.map((range) => {
    // convert_to_liquidity_delta rejects liquidity above i128::MAX.
    const liquidity = safeMul(args.multiplier, new BN(range.weight), U128_MAX);
    if (liquidity.gt(I128_MAX)) {
      throw PoolError.liquidityIsTooHigh();
    }
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
      !isLiquidityWeight(range.weight) ||
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
    // add_liquidity sums the deposits, and adds their transfer fees, in u64.
    if (totalX.gt(U64_MAX) || totalY.gt(U64_MAX)) {
      return false;
    }
    const requiredX = transferFeeIncludedAmountWithinU64(
      args.mintX,
      args.epoch,
      totalX,
    );
    const requiredY = transferFeeIncludedAmountWithinU64(
      args.mintY,
      args.epoch,
      totalY,
    );
    return (
      requiredX !== null &&
      requiredY !== null &&
      requiredX.amount.lte(args.amountX) &&
      requiredY.amount.lte(args.amountY)
    );
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

  if (low.isZero()) {
    throw PoolError.invalidParameters();
  }
  return low;
}

/**
 * `layout` sets how the per-tick weights become position ranges: side by side
 * with one weight each (`Vertical`, the default), or overlapping and stacked by
 * weight level (`Horizontal`, see `stackWeightLevels`). In both, the weights of
 * the ranges covering a tick add up to its column's weight.
 *
 * `maxRanges` caps the range count by reducing the weights with
 * `quantizeWeights` until the ranges fit; `columns` show the reduced weights.
 * Without it a shape over `POSITION_MAX_RANGE` ranges is rejected.
 */
export function buildLiquidityShape(args: {
  strategy: StrategyType;
  minTickId: number;
  maxTickId: number;
  tickSpacing: number;
  currentTickId: number;
  weights?: TickWeight[];
  layout?: LiquidityLayout;
  maxRanges?: number;
}): LiquidityShape {
  const layout = args.layout ?? LiquidityLayout.Vertical;
  if (
    layout !== LiquidityLayout.Vertical &&
    layout !== LiquidityLayout.Horizontal
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    args.maxRanges !== undefined &&
    (!Number.isInteger(args.maxRanges) ||
      args.maxRanges < 1 ||
      args.maxRanges > POSITION_MAX_RANGE)
  ) {
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

  const weights = quantizeWeights(
    toWeightsByStrategy(args),
    MAX_LIQUIDITY_WEIGHT,
  );
  if (weights[weights.length - 1].tickId + args.tickSpacing > MAX_TICK_ID) {
    throw PoolError.invalidParameters();
  }

  const toRanges = (entries: TickWeight[]) =>
    layout === LiquidityLayout.Horizontal
      ? stackWeightLevels(entries, args.tickSpacing)
      : mergeEqualWeightRanges(entries, args.tickSpacing);
  let fitted = weights;
  let ranges = toRanges(weights);
  if (args.maxRanges === undefined) {
    if (ranges.length > POSITION_MAX_RANGE) {
      throw new PoolError(
        PoolErrorCode.InvalidParameters,
        `Liquidity shape spans ${ranges.length} weight ranges; positions support at most ${POSITION_MAX_RANGE}. Pass maxRanges, widen the tick spacing, or narrow the tick range.`,
      );
    }
  } else {
    const maxWeight = weights.reduce(
      (max, entry) => Math.max(max, entry.weight),
      0,
    );
    for (
      let levels = Math.min(maxWeight - 1, args.maxRanges);
      levels >= 1 && ranges.length > args.maxRanges;
      levels--
    ) {
      fitted = quantizeWeights(weights, levels);
      ranges = toRanges(fitted);
    }
    if (ranges.length > args.maxRanges) {
      throw new PoolError(
        PoolErrorCode.InvalidParameters,
        `Liquidity shape cannot fit into ${args.maxRanges} ranges`,
      );
    }
  }
  return {
    strategy: args.strategy,
    layout,
    tickSpacing: args.tickSpacing,
    currentTickId: args.currentTickId,
    columns: toLiquidityColumns(fitted, args.tickSpacing, args.currentTickId),
    ranges,
  };
}
