import { MAX_LIQUIDITY_WEIGHT } from "../constants";
import { PoolError } from "../errors";
import { isLiquidityWeight } from "../helpers/liquidity";
import { alignTickDown, tickIdsInRange } from "../helpers/tick_array";
import { StrategyType } from "../types";

export type TickWeight = {
  tickId: number;
  weight: number;
};

function riseWeight(distance: number, span: number, maxWeight: number): number {
  if (span === 0) {
    return 1;
  }
  return Math.round(1 + ((maxWeight - 1) * distance) / span);
}

function fallWeight(distance: number, span: number, maxWeight: number): number {
  if (span === 0) {
    return maxWeight;
  }
  return Math.round(maxWeight - ((maxWeight - 1) * distance) / span);
}

const WAVE_BASE_WEIGHT = 4;
const WAVE_EDGE_WEIGHT = 8;

/**
 * Spot near the price and BidAsk at the edge: flat at `WAVE_BASE_WEIGHT` over
 * the half of the span nearest the price, then four steps up to
 * `WAVE_EDGE_WEIGHT` at the edge.
 */
function waveWeight(distance: number, span: number): number {
  if (span === 0) {
    return WAVE_BASE_WEIGHT;
  }
  return Math.max(
    WAVE_BASE_WEIGHT,
    Math.ceil((WAVE_EDGE_WEIGHT * distance) / span),
  );
}

function toWeightSpot(
  minTickId: number,
  maxTickId: number,
  tickSpacing: number,
): TickWeight[] {
  return tickIdsInRange(minTickId, maxTickId, tickSpacing).map((tickId) => ({
    tickId,
    weight: 1,
  }));
}

type WeightAt = (distance: number, span: number, maxWeight: number) => number;

/**
 * Weighs each column by its distance from the active one: Curve (`fallWeight`)
 * peaks there, BidAsk (`riseWeight`) and Wave (`waveWeight`) are lowest there.
 * With the price outside the range, the edge column nearest it stands in for
 * the active one, so the profile runs the whole range.
 */
function toWeightAroundActive(
  minTickId: number,
  maxTickId: number,
  currentTickId: number,
  tickSpacing: number,
  weightAt: WeightAt,
): TickWeight[] {
  const tickIds = tickIdsInRange(minTickId, maxTickId, tickSpacing);
  const last = tickIds.length - 1;
  const activeIndex = Math.min(
    Math.max(Math.floor((currentTickId - minTickId) / tickSpacing), 0),
    last,
  );
  const maxWeight = Math.min(
    Math.max(activeIndex, last - activeIndex) + 1,
    MAX_LIQUIDITY_WEIGHT,
  );
  return tickIds.map((tickId, index) => {
    const span = index <= activeIndex ? activeIndex : last - activeIndex;
    return {
      tickId,
      weight: weightAt(Math.abs(index - activeIndex), span, maxWeight),
    };
  });
}

/**
 * Scales weights down so the largest is `levels`, keeping every non-zero weight
 * at least 1. Weights already at most `levels` are returned unchanged.
 */
export function quantizeWeights(
  weights: TickWeight[],
  levels: number,
): TickWeight[] {
  if (!isLiquidityWeight(levels)) {
    throw PoolError.invalidParameters(
      "levels must be an integer in 1..=MAX_LIQUIDITY_WEIGHT",
    );
  }
  const maxWeight = weights.reduce(
    (max, entry) => Math.max(max, entry.weight),
    0,
  );
  if (maxWeight <= 0) {
    throw PoolError.invalidParameters("weights must include a positive weight");
  }
  if (maxWeight <= levels) {
    return weights;
  }
  return weights.map((entry) => ({
    tickId: entry.tickId,
    weight:
      entry.weight === 0
        ? 0
        : Math.max(1, Math.round((entry.weight / maxWeight) * levels)),
  }));
}

function toWeightCustom(weights: TickWeight[]): TickWeight[] {
  if (weights.length === 0) {
    throw PoolError.invalidParameters("weights must not be empty");
  }

  const sorted = [...weights].sort((a, b) => a.tickId - b.tickId);
  for (let i = 0; i < sorted.length; i++) {
    if (!Number.isInteger(sorted[i].weight) || sorted[i].weight < 0) {
      throw PoolError.invalidParameters(
        "weights.weight must be a non-negative integer",
      );
    }
    if (i > 0 && sorted[i].tickId === sorted[i - 1].tickId) {
      throw PoolError.invalidParameters("weights.tickId must be unique");
    }
  }
  return sorted;
}

export function toWeightsByStrategy(args: {
  strategy: StrategyType;
  minTickId: number;
  maxTickId: number;
  tickSpacing: number;
  currentTickId: number;
  weights?: TickWeight[];
}): TickWeight[] {
  const currentTickId = alignTickDown(args.currentTickId, args.tickSpacing);
  switch (args.strategy) {
    case StrategyType.Spot:
      return toWeightSpot(args.minTickId, args.maxTickId, args.tickSpacing);
    case StrategyType.Curve:
      return toWeightAroundActive(
        args.minTickId,
        args.maxTickId,
        currentTickId,
        args.tickSpacing,
        fallWeight,
      );
    case StrategyType.BidAsk:
      return toWeightAroundActive(
        args.minTickId,
        args.maxTickId,
        currentTickId,
        args.tickSpacing,
        riseWeight,
      );
    case StrategyType.Wave:
      return toWeightAroundActive(
        args.minTickId,
        args.maxTickId,
        currentTickId,
        args.tickSpacing,
        waveWeight,
      );
    case StrategyType.Custom:
      if (!args.weights) {
        throw PoolError.invalidParameters(
          "weights is required for the Custom strategy",
        );
      }
      return toWeightCustom(args.weights);
  }
}
