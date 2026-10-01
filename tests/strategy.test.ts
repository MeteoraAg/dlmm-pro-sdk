import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { PoolError } from "../src/errors";
import {
  amountsFromShape,
  buildLiquidityShape,
  checkRanges,
  compressRanges,
  customWeightsFromGrid,
  encodeAddLiquidityByWeight,
  LIMIT_ORDER_MAX_TICK,
  limitOrderTicksFromShape,
  LiquiditySide,
  MAX_TICK_ID,
  multiplierFromAmounts,
  PoolErrorCode,
  StrategyType,
  toWeightCurve,
} from "../src";
import { big } from "./helpers/bn";

function debugLiquidityChart(_caption: string, _input: unknown): void {}

describe("liquidity shapes", () => {
  const minTickId = -20;
  const maxTickId = 20;
  const tickSpacing = 10;
  const currentTickId = 0;

  it("plots Spot as equal-height columns and one merged range", () => {
    const result = buildLiquidityShape({
      strategy: StrategyType.Spot,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
    });
    debugLiquidityChart("Spot", result);

    expect(result.columns.map((column) => column.weight)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(result.columns.map((column) => column.tickId)).toEqual([
      -20, -10, 0, 10, 20,
    ]);
    expect(result.columns[0].side).toBe(LiquiditySide.Bid);
    expect(result.columns[2].side).toBe(LiquiditySide.Active);
    expect(result.columns[4].side).toBe(LiquiditySide.Ask);
    expect(result.ranges).toEqual([
      { tickLowerId: -20, tickUpperId: 30, weight: 1 },
    ]);
  });

  it("plots Curve peaking at the active tick", () => {
    const result = buildLiquidityShape({
      strategy: StrategyType.Curve,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
    });
    debugLiquidityChart("Curve", result);

    expect(result.columns.map((column) => column.weight)).toEqual([
      1, 2, 3, 2, 1,
    ]);
    expect(result.ranges).toHaveLength(5);
  });

  it("plots BidAsk peaking at the edges", () => {
    const result = buildLiquidityShape({
      strategy: StrategyType.BidAsk,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
    });
    debugLiquidityChart("BidAsk", result);

    expect(result.columns.map((column) => column.weight)).toEqual([
      3, 2, 1, 2, 3,
    ]);
  });

  it("keeps a Custom stair-step like the terminal grid", () => {
    const result = buildLiquidityShape({
      strategy: StrategyType.Custom,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
      weights: customWeightsFromGrid(minTickId, tickSpacing, [8, 7, 6, 5, 0]),
    });
    debugLiquidityChart("Custom", result);

    expect(result.columns.map((column) => column.weight)).toEqual([
      8, 7, 6, 5, 0,
    ]);
    expect(result.columns[0].priceLower.lt(result.columns[0].priceUpper)).toBe(
      true,
    );
    expect(result.ranges.map((range) => range.weight)).toEqual([8, 7, 6, 5]);
  });

  it("encodes add_liquidity_by_weight params from a shape", () => {
    const result = buildLiquidityShape({
      strategy: StrategyType.Custom,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
      weights: [
        { tickId: -20, weight: 8 },
        { tickId: -10, weight: 7 },
        { tickId: 0, weight: 6 },
      ],
    });
    const parameters = encodeAddLiquidityByWeight({
      ranges: result.ranges,
      maxAmountX: new BN(1_000_000),
      maxAmountY: new BN(1_000_000),
      multiplier: new BN(1000),
    });

    expect(Buffer.from(parameters.liquidities)).toEqual(Buffer.from([8, 7, 6]));
    expect(parameters.bitmap.toNumber()).toBe(0b111);
    expect(
      amountsFromShape({
        ranges: result.ranges,
        currentTickId,
        currentSqrtPrice: new BN("18446744073709551616"),
        multiplier: parameters.multiplier,
      }).every((item) => item.liquidity.gt(new BN(0))),
    ).toBe(true);
  });

  it("sizes the multiplier exactly to the budgets", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Spot,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
    });
    const currentSqrtPrice = new BN("18446744073709551616");
    const amountX = new BN(1_000_000_000);
    const amountY = new BN(1_000_000_000);

    const totals = (multiplier: BN) =>
      amountsFromShape({
        ranges: shape.ranges,
        currentTickId,
        currentSqrtPrice,
        multiplier,
      }).reduce(
        (acc, item) => ({
          x: acc.x.add(item.amountX),
          y: acc.y.add(item.amountY),
        }),
        { x: new BN(0), y: new BN(0) },
      );

    const multiplier = multiplierFromAmounts({
      ranges: shape.ranges,
      tickSpacing,
      currentTickId,
      currentSqrtPrice,
      amountX,
      amountY,
      mintX: null,
      mintY: null,
      epoch: 0n,
    });

    const deployed = totals(multiplier);
    expect(big(deployed.x)).toBeLessThanOrEqual(big(amountX));
    expect(big(deployed.y)).toBeLessThanOrEqual(big(amountY));
    const threshold = amountX.muln(999).divn(1000);
    expect(big(BN.max(deployed.x, deployed.y))).toBeGreaterThanOrEqual(
      big(threshold),
    );

    const overshoot = totals(multiplier.addn(1));
    expect(
      overshoot.x.gt(amountX) || overshoot.y.gt(amountY),
      `multiplier+1 must exceed a budget: x ${overshoot.x} vs ${amountX}, y ${overshoot.y} vs ${amountY}`,
    ).toBe(true);
  });

  it("rejects Custom weights that are not tick-spacing aligned", () => {
    expect(() =>
      buildLiquidityShape({
        strategy: StrategyType.Custom,
        minTickId,
        maxTickId,
        tickSpacing,
        currentTickId,
        weights: [{ tickId: -19, weight: 1 }],
      }),
    ).toThrow(PoolError);
  });

  it("builds wide 21-column Spot, Curve, BidAsk, and Custom shapes", () => {
    const wide = {
      minTickId: -100,
      maxTickId: 100,
      tickSpacing: 10,
      currentTickId: 0,
    };

    const spot = buildLiquidityShape({ strategy: StrategyType.Spot, ...wide });
    const curve = buildLiquidityShape({
      strategy: StrategyType.Curve,
      ...wide,
    });
    const bidAsk = buildLiquidityShape({
      strategy: StrategyType.BidAsk,
      ...wide,
    });
    const custom = buildLiquidityShape({
      strategy: StrategyType.Custom,
      ...wide,
      weights: customWeightsFromGrid(
        wide.minTickId,
        wide.tickSpacing,
        [8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ),
    });

    debugLiquidityChart("Spot", spot);
    debugLiquidityChart("Curve", curve);
    debugLiquidityChart("BidAsk", bidAsk);
    debugLiquidityChart("Custom", custom);

    expect(spot.columns).toHaveLength(21);
    expect(curve.columns.map((column) => column.weight)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
    expect(bidAsk.columns.map((column) => column.weight)).toEqual([
      11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(custom.columns.map((column) => column.weight)).toEqual([
      8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("peaks Curve and dips BidAsk at the aligned current tick for asymmetric ranges", () => {
    const asymmetric = {
      minTickId: -10,
      maxTickId: 100,
      tickSpacing: 10,
      currentTickId: 4,
    };

    const curve = buildLiquidityShape({
      strategy: StrategyType.Curve,
      ...asymmetric,
    });
    debugLiquidityChart("Curve (asymmetric, current tick 4)", curve);
    const curveWeights = curve.columns.map((column) => column.weight);
    const peak = Math.max(...curveWeights);
    expect(curve.columns[1].tickId).toBe(0);
    expect(curve.columns[1].weight).toBe(peak);
    expect(curveWeights.filter((weight) => weight === peak)).toHaveLength(1);
    expect(curveWeights[0]).toBe(1);
    expect(curveWeights[curveWeights.length - 1]).toBe(1);
    expect(
      curveWeights.every(
        (weight) => Number.isInteger(weight) && weight >= 1 && weight <= 255,
      ),
    ).toBe(true);

    const bidAsk = buildLiquidityShape({
      strategy: StrategyType.BidAsk,
      ...asymmetric,
    });
    debugLiquidityChart("BidAsk (asymmetric, current tick 4)", bidAsk);
    const bidAskWeights = bidAsk.columns.map((column) => column.weight);
    const edge = Math.max(...bidAskWeights);
    expect(bidAsk.columns[1].tickId).toBe(0);
    expect(bidAsk.columns[1].weight).toBe(1);
    expect(Math.min(...bidAskWeights)).toBe(1);
    expect(bidAskWeights[0]).toBe(edge);
    expect(bidAskWeights[bidAskWeights.length - 1]).toBe(edge);
    expect(
      bidAskWeights.every(
        (weight) => Number.isInteger(weight) && weight >= 1 && weight <= 255,
      ),
    ).toBe(true);
  });

  it("caps Curve weights at 255 for wide ranges", () => {
    const weights = toWeightCurve(-3000, 3000, 0, 10);
    debugLiquidityChart("Curve (clipped flat at the 255 cap)", weights);
    expect(weights).toHaveLength(601);
    expect(weights[300].tickId).toBe(0);
    expect(weights[300].weight).toBe(255);
    expect(
      weights.every(
        (entry) =>
          Number.isInteger(entry.weight) &&
          entry.weight >= 1 &&
          entry.weight <= 255,
      ),
    ).toBe(true);
  });

  it("normalizes Custom weights above 255 at shape construction", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Custom,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
      weights: customWeightsFromGrid(
        minTickId,
        tickSpacing,
        [510, 255, 0, 51, 510],
      ),
    });
    debugLiquidityChart("Custom (normalized from 510/255/0/51/510)", shape);
    expect(shape.columns.map((column) => column.weight)).toEqual([
      255, 128, 0, 26, 255,
    ]);

    const parameters = encodeAddLiquidityByWeight({
      ranges: shape.ranges,
      maxAmountX: new BN(1),
      maxAmountY: new BN(1),
      multiplier: new BN(1),
    });
    expect(Buffer.from(parameters.liquidities)).toEqual(
      Buffer.from([255, 128, 26, 255]),
    );
  });

  it("validates encoded weights instead of rescaling them", () => {
    const encode = (weight: number) =>
      encodeAddLiquidityByWeight({
        ranges: [{ tickLowerId: -20, tickUpperId: 0, weight }],
        maxAmountX: new BN(1),
        maxAmountY: new BN(1),
        multiplier: new BN(1),
      });

    expect(() => encode(0)).toThrow(PoolError);
    expect(() => encode(256)).toThrow(PoolError);
    expect(() => encode(1.5)).toThrow(PoolError);
    expect(Buffer.from(encode(255).liquidities)).toEqual(Buffer.from([255]));
    expect(() =>
      encodeAddLiquidityByWeight({
        ranges: [{ tickLowerId: -20, tickUpperId: 0, weight: 1 }],
        maxAmountX: new BN(1),
        maxAmountY: new BN(1),
        multiplier: new BN(1).shln(127),
      }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.LiquidityIsTooHigh }),
    );
  });

  it("encodes non-contiguous position slots in bitmap order", () => {
    const parameters = encodeAddLiquidityByWeight({
      ranges: [
        { tickLowerId: -20, tickUpperId: 0, weight: 2 },
        { tickLowerId: 0, tickUpperId: 20, weight: 3 },
      ],
      positionIndexes: [0, 2],
      maxAmountX: new BN(1_000),
      maxAmountY: new BN(1_000),
      multiplier: new BN(100),
    });

    expect(parameters.bitmap.toString(2)).toBe("101");
    expect(Buffer.from(parameters.liquidities)).toEqual(Buffer.from([2, 3]));
    const reordered = encodeAddLiquidityByWeight({
      ranges: [
        { tickLowerId: -20, tickUpperId: 0, weight: 2 },
        { tickLowerId: 0, tickUpperId: 20, weight: 3 },
      ],
      positionIndexes: [2, 0],
      maxAmountX: new BN(1_000),
      maxAmountY: new BN(1_000),
      multiplier: new BN(100),
    });
    expect(Buffer.from(reordered.liquidities)).toEqual(Buffer.from([3, 2]));
    expect(() =>
      encodeAddLiquidityByWeight({
        ranges: [
          { tickLowerId: -20, tickUpperId: 0, weight: 2 },
          { tickLowerId: 0, tickUpperId: 20, weight: 3 },
        ],
        positionIndexes: [2, 2],
        maxAmountX: new BN(1_000),
        maxAmountY: new BN(1_000),
        multiplier: new BN(100),
      }),
    ).toThrow(PoolError);
  });

  it("rejects shapes whose top column exceeds MAX_TICK_ID", () => {
    expect(() =>
      buildLiquidityShape({
        strategy: StrategyType.Spot,
        minTickId: MAX_TICK_ID - 6,
        maxTickId: MAX_TICK_ID,
        tickSpacing: 2,
        currentTickId: MAX_TICK_ID - 4,
      }),
    ).toThrow(PoolError);

    const boundary = buildLiquidityShape({
      strategy: StrategyType.Spot,
      minTickId: MAX_TICK_ID - 6,
      maxTickId: MAX_TICK_ID - 2,
      tickSpacing: 2,
      currentTickId: MAX_TICK_ID - 4,
    });
    expect(boundary.columns[boundary.columns.length - 1].tickUpperId).toBe(
      MAX_TICK_ID,
    );
  });

  it("rejects shapes spanning more ranges than a position supports", () => {
    expect(() =>
      buildLiquidityShape({
        strategy: StrategyType.Curve,
        minTickId: -460,
        maxTickId: 460,
        tickSpacing: 10,
        currentTickId: 0,
      }),
    ).toThrow(/at most 45/);
  });

  it("builds one-sided Curve weights when price is outside the range", () => {
    const above = buildLiquidityShape({
      strategy: StrategyType.Curve,
      minTickId: 20,
      maxTickId: 60,
      tickSpacing: 10,
      currentTickId: 0,
    });
    debugLiquidityChart("Curve (one-sided ask, price below range)", above);
    expect(above.columns.map((column) => column.weight)).toEqual([
      5, 4, 3, 2, 1,
    ]);
    expect(
      above.columns.every((column) => column.side === LiquiditySide.Ask),
    ).toBe(true);

    const below = buildLiquidityShape({
      strategy: StrategyType.Curve,
      minTickId: -60,
      maxTickId: -20,
      tickSpacing: 10,
      currentTickId: 0,
    });
    debugLiquidityChart("Curve (one-sided bid, price above range)", below);
    expect(below.columns.map((column) => column.weight)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(
      below.columns.every((column) => column.side === LiquiditySide.Bid),
    ).toBe(true);
  });

  it("splits a shape into bid and ask limit-order ticks", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Curve,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
    });
    const unitAmount = new BN(1_000);

    const ask = limitOrderTicksFromShape({
      shape,
      side: "ask",
      unitAmount,
      poolTickSpacing: 1,
    });
    const bid = limitOrderTicksFromShape({
      shape,
      side: "bid",
      unitAmount,
      poolTickSpacing: 1,
    });

    expect(ask.resolvedTickIds).toEqual([10, 20]);
    expect(ask.ticks.map((tick) => tick.amount.toNumber())).toEqual([
      2_000, 1_000,
    ]);
    expect(bid.resolvedTickIds).toEqual([-20, -10]);
    expect(bid.ticks.map((tick) => tick.amount.toNumber())).toEqual([
      1_000, 2_000,
    ]);

    const relativeAsk = limitOrderTicksFromShape({
      shape,
      side: "ask",
      unitAmount,
      relative: true,
      poolTickSpacing: 1,
    });
    expect(relativeAsk.ticks.map((tick) => tick.id)).toEqual([10, 20]);
    expect(relativeAsk.resolvedTickIds).toEqual([10, 20]);

    // asks must sit strictly above the active tick on-chain, so
    // includeActiveTick never adds the active column on the ask side
    const askAtMarket = limitOrderTicksFromShape({
      shape,
      side: "ask",
      unitAmount,
      includeActiveTick: true,
      poolTickSpacing: 1,
    });
    expect(askAtMarket.resolvedTickIds).toEqual([10, 20]);
    expect(askAtMarket.ticks.map((tick) => tick.amount.toNumber())).toEqual([
      2_000, 1_000,
    ]);
  });

  it("controls bid active-column inclusion for unaligned pool ticks", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Spot,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId: 5,
    });
    const unitAmount = new BN(1_000);

    const excluded = limitOrderTicksFromShape({
      shape,
      side: "bid",
      unitAmount,
    });
    expect(excluded.resolvedTickIds).toEqual([-20, -10]);

    const included = limitOrderTicksFromShape({
      shape,
      side: "bid",
      unitAmount,
      includeActiveTick: true,
    });
    expect(included.resolvedTickIds).toEqual([-20, -10, 0]);
  });

  it("skips zero-weight Custom columns on limit-order ticks", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Custom,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
      weights: customWeightsFromGrid(minTickId, tickSpacing, [3, 0, 2, 0, 1]),
    });
    const ask = limitOrderTicksFromShape({
      shape,
      side: "ask",
      unitAmount: new BN(100),
    });
    expect(ask.resolvedTickIds).toEqual([20]);
    expect(ask.ticks.map((tick) => tick.amount.toNumber())).toEqual([100]);
  });

  it("rejects empty, oversized, and zero-amount limit-order shapes", () => {
    const allAsk = buildLiquidityShape({
      strategy: StrategyType.Spot,
      minTickId: 20,
      maxTickId: 60,
      tickSpacing: 10,
      currentTickId: 0,
    });
    expect(() =>
      limitOrderTicksFromShape({
        shape: allAsk,
        side: "bid",
        unitAmount: new BN(1),
      }),
    ).toThrow(PoolError);

    const tooWide = buildLiquidityShape({
      strategy: StrategyType.Spot,
      minTickId: 0,
      maxTickId: LIMIT_ORDER_MAX_TICK * 10,
      tickSpacing: 10,
      currentTickId: -1,
    });
    expect(tooWide.columns.length).toBe(LIMIT_ORDER_MAX_TICK + 1);
    expect(() =>
      limitOrderTicksFromShape({
        shape: tooWide,
        side: "ask",
        unitAmount: new BN(1),
      }),
    ).toThrow(PoolError);

    expect(() =>
      limitOrderTicksFromShape({
        shape: allAsk,
        side: "ask",
        unitAmount: new BN(0),
      }),
    ).toThrow(PoolError);
  });
});

describe("range cap", () => {
  function columns(
    weights: number[],
    tickSpacing = 10,
  ): {
    tickLowerId: number;
    tickUpperId: number;
    weight: number;
  }[] {
    return weights.map((weight, index) => ({
      tickLowerId: index * tickSpacing,
      tickUpperId: (index + 1) * tickSpacing,
      weight,
    }));
  }

  it("counts one-bin ranges as vertical", () => {
    const ranges = [
      ...columns([4, 4]),
      { tickLowerId: 20, tickUpperId: 50, weight: 1 },
    ];
    expect(checkRanges(ranges, 10)).toEqual({
      ranges: 3,
      vertical: 2,
      horizontal: 1,
    });
  });

  it("rejects more ranges than a position can hold", () => {
    expect(() => checkRanges(columns(Array(46).fill(1)), 10)).toThrow(
      /at most 45/,
    );
    expect(() => checkRanges(columns([1, 0]), 10)).toThrow(PoolError);
    expect(() =>
      checkRanges(
        [
          { tickLowerId: 0, tickUpperId: 20, weight: 1 },
          { tickLowerId: 10, tickUpperId: 30, weight: 1 },
        ],
        10,
      ),
    ).toThrow(PoolError);
  });

  it("leaves a shape that already fits unchanged", () => {
    const ranges = columns([1, 2, 3]);
    expect(compressRanges(ranges, 10, 0)).toEqual(ranges);
  });

  it("merges the closest weights and keeps a gap", () => {
    const ranges = [
      ...columns([1, 2, 100, 101]),
      { tickLowerId: 100, tickUpperId: 110, weight: 7 },
    ];
    expect(compressRanges(ranges, 10, 0, 3)).toEqual([
      { tickLowerId: 0, tickUpperId: 20, weight: 1 },
      { tickLowerId: 20, tickUpperId: 40, weight: 100 },
      { tickLowerId: 100, tickUpperId: 110, weight: 7 },
    ]);
  });

  it("merges the closest weights even when they hold the active tick", () => {
    expect(compressRanges(columns([100, 101, 1]), 10, 0, 2)).toEqual([
      { tickLowerId: 0, tickUpperId: 20, weight: 100 },
      { tickLowerId: 20, tickUpperId: 30, weight: 1 },
    ]);
  });

  it("keeps the bins nearest the active tick when two merges are equally close", () => {
    const ranges = columns([10, 11, 21, 20]);
    expect(compressRanges(ranges, 10, -40, 3)).toEqual([
      { tickLowerId: 0, tickUpperId: 10, weight: 10 },
      { tickLowerId: 10, tickUpperId: 20, weight: 11 },
      { tickLowerId: 20, tickUpperId: 40, weight: 20 },
    ]);
    expect(compressRanges(ranges, 10, 100, 3)).toEqual([
      { tickLowerId: 0, tickUpperId: 20, weight: 10 },
      { tickLowerId: 20, tickUpperId: 30, weight: 21 },
      { tickLowerId: 30, tickUpperId: 40, weight: 20 },
    ]);
    expect(compressRanges(ranges, 10, 19, 3)).toEqual([
      { tickLowerId: 0, tickUpperId: 10, weight: 10 },
      { tickLowerId: 10, tickUpperId: 20, weight: 11 },
      { tickLowerId: 20, tickUpperId: 40, weight: 20 },
    ]);
    expect(compressRanges(ranges, 10, 20, 3)).toEqual([
      { tickLowerId: 0, tickUpperId: 20, weight: 10 },
      { tickLowerId: 20, tickUpperId: 30, weight: 21 },
      { tickLowerId: 30, tickUpperId: 40, weight: 20 },
    ]);
  });

  it("spends the extra merge on the farthest of three equal steps", () => {
    const ranges = columns([10, 11, 40, 80, 10, 11, 40, 10, 11]);
    expect(compressRanges(ranges, 10, 15, 8)).toEqual([
      { tickLowerId: 0, tickUpperId: 10, weight: 10 },
      { tickLowerId: 10, tickUpperId: 20, weight: 11 },
      { tickLowerId: 20, tickUpperId: 30, weight: 40 },
      { tickLowerId: 30, tickUpperId: 40, weight: 80 },
      { tickLowerId: 40, tickUpperId: 50, weight: 10 },
      { tickLowerId: 50, tickUpperId: 60, weight: 11 },
      { tickLowerId: 60, tickUpperId: 70, weight: 40 },
      { tickLowerId: 70, tickUpperId: 90, weight: 10 },
    ]);
    expect(compressRanges(ranges, 10, 85, 8)).toEqual([
      { tickLowerId: 0, tickUpperId: 20, weight: 10 },
      { tickLowerId: 20, tickUpperId: 30, weight: 40 },
      { tickLowerId: 30, tickUpperId: 40, weight: 80 },
      { tickLowerId: 40, tickUpperId: 50, weight: 10 },
      { tickLowerId: 50, tickUpperId: 60, weight: 11 },
      { tickLowerId: 60, tickUpperId: 70, weight: 40 },
      { tickLowerId: 70, tickUpperId: 80, weight: 10 },
      { tickLowerId: 80, tickUpperId: 90, weight: 11 },
    ]);
  });

  it("compresses the island farther from the active tick", () => {
    const ranges = [
      { tickLowerId: 0, tickUpperId: 10, weight: 10 },
      { tickLowerId: 10, tickUpperId: 20, weight: 11 },
      { tickLowerId: 100, tickUpperId: 110, weight: 10 },
      { tickLowerId: 110, tickUpperId: 120, weight: 11 },
    ];
    expect(compressRanges(ranges, 10, 0, 3)).toEqual([
      { tickLowerId: 0, tickUpperId: 10, weight: 10 },
      { tickLowerId: 10, tickUpperId: 20, weight: 11 },
      { tickLowerId: 100, tickUpperId: 120, weight: 10 },
    ]);
    expect(compressRanges(ranges, 10, 115, 3)).toEqual([
      { tickLowerId: 0, tickUpperId: 20, weight: 10 },
      { tickLowerId: 100, tickUpperId: 110, weight: 10 },
      { tickLowerId: 110, tickUpperId: 120, weight: 11 },
    ]);
  });

  it("collapses equal bins to one range", () => {
    const fitted = compressRanges(columns(Array(46).fill(5)), 10, 0);
    expect(fitted).toEqual([{ tickLowerId: 0, tickUpperId: 460, weight: 5 }]);
    expect(checkRanges(fitted, 10)).toEqual({
      ranges: 1,
      vertical: 0,
      horizontal: 1,
    });
  });

  it("fits a wide curve into 45 ranges without moving the peak", () => {
    const weights = toWeightCurve(-500, 500, 0, 10);
    const ranges = weights.map((entry) => ({
      tickLowerId: entry.tickId,
      tickUpperId: entry.tickId + 10,
      weight: entry.weight,
    }));
    expect(ranges.length).toBeGreaterThan(45);
    const peakWeight = Math.max(...ranges.map((range) => range.weight));
    const fitted = compressRanges(ranges, 10, 0);
    expect(fitted.length).toBeLessThanOrEqual(45);
    expect(fitted[0].tickLowerId).toBe(-500);
    expect(fitted[fitted.length - 1].tickUpperId).toBe(510);
    const peak = Math.max(...fitted.map((range) => range.weight));
    expect(peak).toBeLessThan(peakWeight);
    expect(
      fitted.some(
        (range) =>
          range.weight === peak &&
          range.tickLowerId <= 0 &&
          range.tickUpperId > 0,
      ),
    ).toBe(true);
    expect(checkRanges(fitted, 10).ranges).toBe(fitted.length);
  });

  it("refuses to bridge more gaps than the cap", () => {
    const ranges = Array.from({ length: 46 }, (_, index) => ({
      tickLowerId: index * 20,
      tickUpperId: index * 20 + 10,
      weight: 1,
    }));
    expect(() => compressRanges(ranges, 10, 0)).toThrow(/cannot fit/);
  });

  it("rejects an active tick the pool cannot hold", () => {
    expect(() => compressRanges(columns([1, 2]), 10, 1.5)).toThrow(PoolError);
    expect(() => compressRanges(columns([1, 2]), 10, MAX_TICK_ID + 1)).toThrow(
      PoolError,
    );
  });
});
