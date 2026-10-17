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

function activeIndexOf(
  minTickId: number,
  currentTickId: number,
  tickSpacing: number,
): number {
  return Math.floor((currentTickId - minTickId) / tickSpacing);
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

function toWeightDescending(
  minTickId: number,
  maxTickId: number,
  tickSpacing: number,
): TickWeight[] {
  const tickIds = tickIdsInRange(minTickId, maxTickId, tickSpacing);
  const last = tickIds.length - 1;
  const maxWeight = Math.min(tickIds.length, MAX_LIQUIDITY_WEIGHT);
  return tickIds.map((tickId, index) => ({
    tickId,
    weight: fallWeight(index, last, maxWeight),
  }));
}

function toWeightAscending(
  minTickId: number,
  maxTickId: number,
  tickSpacing: number,
): TickWeight[] {
  const tickIds = tickIdsInRange(minTickId, maxTickId, tickSpacing);
  const last = tickIds.length - 1;
  const maxWeight = Math.min(tickIds.length, MAX_LIQUIDITY_WEIGHT);
  return tickIds.map((tickId, index) => ({
    tickId,
    weight: riseWeight(index, last, maxWeight),
  }));
}

function toWeightCurve(
  minTickId: number,
  maxTickId: number,
  currentTickId: number,
  tickSpacing: number,
): TickWeight[] {
  if (currentTickId < minTickId) {
    return toWeightDescending(minTickId, maxTickId, tickSpacing);
  }
  if (currentTickId > maxTickId) {
    return toWeightAscending(minTickId, maxTickId, tickSpacing);
  }
  const tickIds = tickIdsInRange(minTickId, maxTickId, tickSpacing);
  const last = tickIds.length - 1;
  const peakIndex = activeIndexOf(minTickId, currentTickId, tickSpacing);
  const peak = Math.min(
    Math.max(peakIndex, last - peakIndex) + 1,
    MAX_LIQUIDITY_WEIGHT,
  );
  return tickIds.map((tickId, index) => {
    const span = index <= peakIndex ? peakIndex : last - peakIndex;
    return {
      tickId,
      weight: fallWeight(Math.abs(index - peakIndex), span, peak),
    };
  });
}

function toWeightBidAsk(
  minTickId: number,
  maxTickId: number,
  currentTickId: number,
  tickSpacing: number,
): TickWeight[] {
  if (currentTickId < minTickId) {
    return toWeightAscending(minTickId, maxTickId, tickSpacing);
  }
  if (currentTickId > maxTickId) {
    return toWeightDescending(minTickId, maxTickId, tickSpacing);
  }
  const tickIds = tickIdsInRange(minTickId, maxTickId, tickSpacing);
  const last = tickIds.length - 1;
  const valleyIndex = activeIndexOf(minTickId, currentTickId, tickSpacing);
  const maxWeight = Math.min(
    Math.max(valleyIndex, last - valleyIndex) + 1,
    MAX_LIQUIDITY_WEIGHT,
  );
  return tickIds.map((tickId, index) => {
    const span = index <= valleyIndex ? valleyIndex : last - valleyIndex;
    return {
      tickId,
      weight: riseWeight(Math.abs(index - valleyIndex), span, maxWeight),
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
    throw PoolError.invalidParameters();
  }
  let maxWeight = 0;
  for (const entry of weights) {
    if (entry.weight > maxWeight) {
      maxWeight = entry.weight;
    }
  }
  if (maxWeight <= 0) {
    throw PoolError.invalidParameters();
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
    throw PoolError.invalidParameters();
  }

  const sorted = [...weights].sort((a, b) => a.tickId - b.tickId);
  for (let i = 0; i < sorted.length; i++) {
    if (!Number.isInteger(sorted[i].weight) || sorted[i].weight < 0) {
      throw PoolError.invalidParameters();
    }
    if (i > 0 && sorted[i].tickId === sorted[i - 1].tickId) {
      throw PoolError.invalidParameters();
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
      return toWeightCurve(
        args.minTickId,
        args.maxTickId,
        currentTickId,
        args.tickSpacing,
      );
    case StrategyType.BidAsk:
      return toWeightBidAsk(
        args.minTickId,
        args.maxTickId,
        currentTickId,
        args.tickSpacing,
      );
    case StrategyType.Custom:
      if (!args.weights) {
        throw PoolError.invalidParameters();
      }
      return toWeightCustom(args.weights);
  }
}
