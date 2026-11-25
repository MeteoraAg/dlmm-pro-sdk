import {
  ExtensionType,
  TRANSFER_FEE_CONFIG_SIZE,
  TransferFeeConfigLayout,
  type Mint,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  amountsFromShape,
  buildLiquidityShape,
  encodeAddLiquidityByWeight,
  getSqrtPriceFromTickId,
  LIMIT_ORDER_MAX_TICK,
  limitOrderTicksFromShape,
  LiquidityLayout,
  LiquiditySide,
  MAX_TICK_ID,
  MIN_TICK_ID,
  multiplierFromAmounts,
  PoolErrorCode,
  POSITION_MAX_RANGE,
  StrategyType,
  tickPrice,
  tickUiPrice,
  type LiquidityRange,
} from "../src";
import { U64_MAX } from "../src/math";
import {
  quantizeWeights,
  stackWeightLevels,
  toWeightsByStrategy,
} from "../src/strategy";
import { transferFeeIncludedAmountWithinU64 } from "../src/quote/transfer_fee";
import {
  big,
  debugLiquidityChart,
  gridWeights,
  SQRT_PRICE_ONE,
} from "./helpers";

const invalidParameters = expect.objectContaining({
  code: PoolErrorCode.InvalidParameters,
});

function transferFeeMint(transferFeeBasisPoints: number): Mint {
  const transferFee = {
    epoch: 0n,
    maximumFee: 1_000_000_000n,
    transferFeeBasisPoints,
  };
  const config = Buffer.alloc(TRANSFER_FEE_CONFIG_SIZE);
  TransferFeeConfigLayout.encode(
    {
      transferFeeConfigAuthority: PublicKey.default,
      withdrawWithheldAuthority: PublicKey.default,
      withheldAmount: 0n,
      olderTransferFee: transferFee,
      newerTransferFee: transferFee,
    },
    config,
  );
  const header = Buffer.alloc(4);
  header.writeUInt16LE(ExtensionType.TransferFeeConfig, 0);
  header.writeUInt16LE(TRANSFER_FEE_CONFIG_SIZE, 2);
  return {
    address: PublicKey.default,
    mintAuthority: null,
    supply: 0n,
    decimals: 6,
    isInitialized: true,
    freezeAuthority: null,
    tlvData: Buffer.concat([header, config]),
  };
}

function weightAt(ranges: LiquidityRange[], tickId: number): number {
  return ranges
    .filter(
      (range) => range.tickLowerId <= tickId && tickId < range.tickUpperId,
    )
    .reduce((sum, range) => sum + range.weight, 0);
}

describe("tick prices", () => {
  it("scales the raw price by the decimals of X over Y", () => {
    expect(tickPrice(0).toString()).toBe("1");
    // One atom of Y per atom of X is 1000 whole Y per whole X for 9/6 decimals.
    expect(tickUiPrice(0, 9, 6).toString()).toBe("1000");
    expect(tickUiPrice(0, 6, 9).toString()).toBe("0.001");
  });

  it("keeps the precision of the sqrt price at the lowest ticks", () => {
    for (const tickId of [MIN_TICK_ID, -400_000, -200_000]) {
      const expected = new Decimal("1.0001").pow(tickId);
      const error = tickPrice(tickId).div(expected).minus(1).abs();
      expect(error.lt("1e-8")).toBe(true);
    }
  });
});

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

  it("plots Wave flat around the active tick, stepping up to twice that at each edge", () => {
    const result = buildLiquidityShape({
      strategy: StrategyType.Wave,
      minTickId: -160,
      maxTickId: 80,
      tickSpacing,
      currentTickId,
    });
    debugLiquidityChart("Wave", result);

    expect(result.columns.map((column) => column.weight)).toEqual([
      8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 6, 7, 8,
    ]);
    expect(result.columns[16].side).toBe(LiquiditySide.Active);
    expect(result.ranges).toHaveLength(9);
  });

  it("keeps each Wave edge at twice the active weight on sides too short for every step", () => {
    const result = buildLiquidityShape({
      strategy: StrategyType.Wave,
      minTickId: -10,
      maxTickId: 40,
      tickSpacing,
      currentTickId,
    });
    debugLiquidityChart("Wave (short sides)", result);

    expect(result.columns.map((column) => column.weight)).toEqual([
      8, 4, 4, 4, 6, 8,
    ]);
  });

  it("keeps Custom column weights and drops zero-weight columns from the ranges", () => {
    const result = buildLiquidityShape({
      strategy: StrategyType.Custom,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
      weights: gridWeights(minTickId, tickSpacing, [8, 7, 6, 5, 0]),
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
        currentSqrtPrice: SQRT_PRICE_ONE,
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
    const currentSqrtPrice = SQRT_PRICE_ONE;
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

  it("finds the largest multiplier for a u64::MAX budget instead of throwing", () => {
    const args = {
      ranges: [
        { tickLowerId: 100, tickUpperId: 110, weight: 1 },
        { tickLowerId: 200, tickUpperId: 210, weight: 1 },
      ],
      currentTickId: 0,
      currentSqrtPrice: getSqrtPriceFromTickId(0),
    };
    const fits = (multiplier: BN, mint: Mint | null) => {
      const deposit = amountsFromShape({ ...args, multiplier }).reduce(
        (sum, item) => sum.add(item.amountX),
        new BN(0),
      );
      if (deposit.gt(U64_MAX)) {
        return false;
      }
      const required = transferFeeIncludedAmountWithinU64(mint, 0n, deposit);
      return required !== null && required.amount.lte(U64_MAX);
    };

    for (const mintX of [null, transferFeeMint(100)]) {
      const multiplier = multiplierFromAmounts({
        ...args,
        tickSpacing: 1,
        amountX: U64_MAX,
        amountY: new BN(0),
        mintX,
        mintY: null,
        epoch: 0n,
      });
      expect(fits(multiplier, mintX)).toBe(true);
      expect(fits(multiplier.addn(1), mintX)).toBe(false);
    }
  });

  it("sizes a smaller multiplier when X charges a transfer fee", () => {
    const mintX = transferFeeMint(100);
    const args = {
      ranges: [{ tickLowerId: -120, tickUpperId: 120, weight: 1 }],
      tickSpacing: 1,
      currentTickId: 0,
      currentSqrtPrice: SQRT_PRICE_ONE,
      amountX: new BN(100_000),
      amountY: new BN(100_000),
      mintY: null,
      epoch: 0n,
    };
    expect(
      multiplierFromAmounts({ ...args, mintX }).lt(
        multiplierFromAmounts({ ...args, mintX: null }),
      ),
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
    ).toThrow(invalidParameters);
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
      weights: gridWeights(
        wide.minTickId,
        wide.tickSpacing,
        [8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ),
    });
    debugLiquidityChart("Spot (21 columns)", spot);
    debugLiquidityChart("Curve (21 columns)", curve);
    debugLiquidityChart("BidAsk (21 columns)", bidAsk);
    debugLiquidityChart("Custom (21 columns)", custom);

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
    const weights = toWeightsByStrategy({
      strategy: StrategyType.Curve,
      minTickId: -3000,
      maxTickId: 3000,
      tickSpacing: 10,
      currentTickId: 0,
    });
    debugLiquidityChart("Curve (weights capped at 255)", weights);
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
      weights: gridWeights(minTickId, tickSpacing, [510, 255, 0, 51, 510]),
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

    expect(() => encode(0)).toThrow(invalidParameters);
    expect(() => encode(256)).toThrow(invalidParameters);
    expect(() => encode(1.5)).toThrow(invalidParameters);
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
    expect(() =>
      encodeAddLiquidityByWeight({
        ranges: [{ tickLowerId: -20, tickUpperId: 0, weight: 1 }],
        maxAmountX: new BN(1),
        maxAmountY: new BN(1),
        multiplier: new BN(0),
      }),
    ).toThrow(expect.objectContaining({ code: PoolErrorCode.LiquidityIsZero }));
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
    ).toThrow(invalidParameters);
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
    ).toThrow(invalidParameters);

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
    ).toThrow(`at most ${POSITION_MAX_RANGE}`);
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

  it("runs one-sided Wave weights up from the edge nearest the price", () => {
    const above = buildLiquidityShape({
      strategy: StrategyType.Wave,
      minTickId: 20,
      maxTickId: 100,
      tickSpacing: 10,
      currentTickId: 0,
    });
    debugLiquidityChart("Wave (one-sided ask, price below range)", above);
    expect(above.columns.map((column) => column.weight)).toEqual([
      4, 4, 4, 4, 4, 5, 6, 7, 8,
    ]);
    expect(above.ranges).toHaveLength(5);

    const below = buildLiquidityShape({
      strategy: StrategyType.Wave,
      minTickId: -100,
      maxTickId: -20,
      tickSpacing: 10,
      currentTickId: 0,
    });
    debugLiquidityChart("Wave (one-sided bid, price above range)", below);
    expect(below.columns.map((column) => column.weight)).toEqual([
      8, 7, 6, 5, 4, 4, 4, 4, 4,
    ]);
    expect(below.ranges).toHaveLength(5);
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

    const ask = limitOrderTicksFromShape({ shape, side: "ask", unitAmount });
    const bid = limitOrderTicksFromShape({ shape, side: "bid", unitAmount });

    expect(ask.ticks.map((tick) => tick.id)).toEqual([10, 20]);
    expect(ask.ticks.map((tick) => tick.amount.toNumber())).toEqual([
      2_000, 1_000,
    ]);
    expect(bid.ticks.map((tick) => tick.id)).toEqual([-20, -10]);
    expect(bid.ticks.map((tick) => tick.amount.toNumber())).toEqual([
      1_000, 2_000,
    ]);

    const relativeAsk = limitOrderTicksFromShape({
      shape,
      side: "ask",
      unitAmount,
      relative: true,
    });
    expect(relativeAsk.ticks.map((tick) => tick.id)).toEqual([1, 2]);

    // asks must sit strictly above the active tick on-chain, so
    // includeActiveTick never adds the active column on the ask side
    const askAtMarket = limitOrderTicksFromShape({
      shape,
      side: "ask",
      unitAmount,
      includeActiveTick: true,
    });
    expect(askAtMarket.ticks.map((tick) => tick.id)).toEqual([10, 20]);
    expect(askAtMarket.ticks.map((tick) => tick.amount.toNumber())).toEqual([
      2_000, 1_000,
    ]);
  });

  it("splits a total budget by the side's weights", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Curve,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
    });
    const ask = limitOrderTicksFromShape({
      shape,
      side: "ask",
      totalAmount: new BN(10_000),
    });
    expect(ask.ticks.map((tick) => tick.id)).toEqual([10, 20]);
    expect(ask.ticks.map((tick) => tick.amount.toNumber())).toEqual([
      6_666, 3_333,
    ]);
    expect(ask.amount.toNumber()).toBe(9_999);

    expect(() =>
      limitOrderTicksFromShape({
        shape,
        side: "ask",
        totalAmount: new BN(2),
      }),
    ).toThrow(invalidParameters);
    expect(() => limitOrderTicksFromShape({ shape, side: "ask" })).toThrow(
      invalidParameters,
    );
    expect(() =>
      limitOrderTicksFromShape({
        shape,
        side: "ask",
        unitAmount: new BN(1),
        totalAmount: new BN(10),
      }),
    ).toThrow(invalidParameters);
  });

  it("places a single-tick order from a one-column shape", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Spot,
      minTickId: 10,
      maxTickId: 10,
      tickSpacing,
      currentTickId,
    });
    const ask = limitOrderTicksFromShape({
      shape,
      side: "ask",
      totalAmount: new BN(5_000),
    });
    expect(ask.ticks.map((tick) => [tick.id, tick.amount.toNumber()])).toEqual([
      [10, 5_000],
    ]);
    expect(ask.amount.toNumber()).toBe(5_000);
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
    expect(excluded.ticks.map((tick) => tick.id)).toEqual([-20, -10]);

    const included = limitOrderTicksFromShape({
      shape,
      side: "bid",
      unitAmount,
      includeActiveTick: true,
    });
    expect(included.ticks.map((tick) => tick.id)).toEqual([-20, -10, 0]);
  });

  it("skips zero-weight Custom columns on limit-order ticks", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Custom,
      minTickId,
      maxTickId,
      tickSpacing,
      currentTickId,
      weights: gridWeights(minTickId, tickSpacing, [3, 0, 2, 0, 1]),
    });
    const ask = limitOrderTicksFromShape({
      shape,
      side: "ask",
      unitAmount: new BN(100),
    });
    expect(ask.ticks.map((tick) => tick.id)).toEqual([20]);
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
    ).toThrow(invalidParameters);

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
    ).toThrow(invalidParameters);

    expect(() =>
      limitOrderTicksFromShape({
        shape: allAsk,
        side: "ask",
        unitAmount: new BN(0),
      }),
    ).toThrow(invalidParameters);
  });
});

describe("horizontal layout", () => {
  const base = {
    minTickId: -20,
    maxTickId: 20,
    tickSpacing: 10,
    currentTickId: 0,
  };

  it("keeps Spot as one range", () => {
    const shape = buildLiquidityShape({
      ...base,
      strategy: StrategyType.Spot,
      layout: LiquidityLayout.Horizontal,
    });
    expect(shape.layout).toBe(LiquidityLayout.Horizontal);
    expect(shape.ranges).toEqual([
      { tickLowerId: -20, tickUpperId: 30, weight: 1 },
    ]);
  });

  it("nests Curve layers on the active tick, widest first", () => {
    const shape = buildLiquidityShape({
      ...base,
      strategy: StrategyType.Curve,
      layout: LiquidityLayout.Horizontal,
    });
    expect(shape.columns.map((column) => column.weight)).toEqual([
      1, 2, 3, 2, 1,
    ]);
    expect(shape.ranges).toEqual([
      { tickLowerId: -20, tickUpperId: 30, weight: 1 },
      { tickLowerId: -10, tickUpperId: 20, weight: 1 },
      { tickLowerId: 0, tickUpperId: 10, weight: 1 },
    ]);
  });

  it("anchors BidAsk layers at both edges over a base range", () => {
    const shape = buildLiquidityShape({
      ...base,
      strategy: StrategyType.BidAsk,
      layout: LiquidityLayout.Horizontal,
    });
    expect(shape.ranges).toEqual([
      { tickLowerId: -20, tickUpperId: 30, weight: 1 },
      { tickLowerId: -20, tickUpperId: 0, weight: 1 },
      { tickLowerId: 10, tickUpperId: 30, weight: 1 },
      { tickLowerId: -20, tickUpperId: -10, weight: 1 },
      { tickLowerId: 20, tickUpperId: 30, weight: 1 },
    ]);
  });

  it("stacks Wave steps at both edges over a base range", () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Wave,
      minTickId: -80,
      maxTickId: 80,
      tickSpacing: 10,
      currentTickId: 0,
      layout: LiquidityLayout.Horizontal,
    });
    expect(shape.ranges).toEqual([
      { tickLowerId: -80, tickUpperId: 90, weight: 4 },
      { tickLowerId: -80, tickUpperId: -40, weight: 1 },
      { tickLowerId: 50, tickUpperId: 90, weight: 1 },
      { tickLowerId: -80, tickUpperId: -50, weight: 1 },
      { tickLowerId: 60, tickUpperId: 90, weight: 1 },
      { tickLowerId: -80, tickUpperId: -60, weight: 1 },
      { tickLowerId: 70, tickUpperId: 90, weight: 1 },
      { tickLowerId: -80, tickUpperId: -70, weight: 1 },
      { tickLowerId: 80, tickUpperId: 90, weight: 1 },
    ]);
  });

  it("puts the shared floor of a Custom stair-step in its base range", () => {
    const shape = buildLiquidityShape({
      ...base,
      strategy: StrategyType.Custom,
      layout: LiquidityLayout.Horizontal,
      weights: gridWeights(-20, 10, [8, 7, 6, 5, 0]),
    });
    expect(shape.ranges).toEqual([
      { tickLowerId: -20, tickUpperId: 20, weight: 5 },
      { tickLowerId: -20, tickUpperId: 10, weight: 1 },
      { tickLowerId: -20, tickUpperId: 0, weight: 1 },
      { tickLowerId: -20, tickUpperId: -10, weight: 1 },
    ]);
  });

  it("keeps a run that spans several levels as one range", () => {
    expect(stackWeightLevels(gridWeights(-20, 10, [2, 0, 1, 3]), 10)).toEqual([
      { tickLowerId: -20, tickUpperId: -10, weight: 2 },
      { tickLowerId: 0, tickUpperId: 20, weight: 1 },
      { tickLowerId: 10, tickUpperId: 20, weight: 2 },
    ]);
  });

  it.each([
    { name: "Spot", strategy: StrategyType.Spot },
    { name: "Curve", strategy: StrategyType.Curve },
    { name: "BidAsk", strategy: StrategyType.BidAsk },
    { name: "Wave", strategy: StrategyType.Wave },
    {
      name: "Custom",
      strategy: StrategyType.Custom,
      weights: gridWeights(-20, 10, [3, 1, 0, 4, 2]),
    },
  ])("matches every $name column in both layouts", ({ strategy, weights }) => {
    for (const layout of [
      LiquidityLayout.Vertical,
      LiquidityLayout.Horizontal,
    ]) {
      const shape = buildLiquidityShape({
        ...base,
        strategy,
        weights,
        layout,
      });
      for (const column of shape.columns) {
        expect(weightAt(shape.ranges, column.tickId)).toBe(column.weight);
      }
    }
  });

  it("defaults to the vertical layout", () => {
    const args = { ...base, strategy: StrategyType.Curve };
    expect(buildLiquidityShape(args)).toEqual(
      buildLiquidityShape({ ...args, layout: LiquidityLayout.Vertical }),
    );
    expect(buildLiquidityShape(args).layout).toBe(LiquidityLayout.Vertical);
  });

  it("quantizes weights down to a level count", () => {
    const weights = gridWeights(0, 10, [0, 1, 50, 100]);
    expect(quantizeWeights(weights, 4).map((entry) => entry.weight)).toEqual([
      0, 1, 2, 4,
    ]);
    expect(quantizeWeights(weights, 255)).toEqual(weights);
    expect(() => quantizeWeights(weights, 0)).toThrow(invalidParameters);
    expect(() => quantizeWeights(gridWeights(0, 10, [0, 0]), 4)).toThrow(
      invalidParameters,
    );
  });

  it("deposits the same amounts in both layouts up to per-range rounding", () => {
    const currentSqrtPrice = SQRT_PRICE_ONE;
    const multiplier = new BN(1_000_000_000);
    const totals = (layout: LiquidityLayout) => {
      const shape = buildLiquidityShape({
        ...base,
        strategy: StrategyType.Curve,
        layout,
      });
      return {
        ranges: shape.ranges.length,
        ...amountsFromShape({
          ranges: shape.ranges,
          currentTickId: base.currentTickId,
          currentSqrtPrice,
          multiplier,
        }).reduce(
          (acc, item) => ({
            x: acc.x.add(item.amountX),
            y: acc.y.add(item.amountY),
          }),
          { x: new BN(0), y: new BN(0) },
        ),
      };
    };
    const vertical = totals(LiquidityLayout.Vertical);
    const horizontal = totals(LiquidityLayout.Horizontal);
    const tolerance = vertical.ranges + horizontal.ranges;
    expect(vertical.x.sub(horizontal.x).abs().toNumber()).toBeLessThanOrEqual(
      tolerance,
    );
    expect(vertical.y.sub(horizontal.y).abs().toNumber()).toBeLessThanOrEqual(
      tolerance,
    );
  });
});

describe("range cap", () => {
  const wideCurve = {
    strategy: StrategyType.Curve,
    minTickId: -500,
    maxTickId: 500,
    tickSpacing: 10,
    currentTickId: 0,
  };

  it.each([
    { name: "vertical", layout: LiquidityLayout.Vertical, count: 7, peak: 4 },
    {
      name: "horizontal",
      layout: LiquidityLayout.Horizontal,
      count: 8,
      peak: 8,
    },
  ])(
    "reduces the weights of a wide $name Curve to fit maxRanges",
    ({ layout, count, peak }) => {
      expect(() => buildLiquidityShape({ ...wideCurve, layout })).toThrow(
        `at most ${POSITION_MAX_RANGE}`,
      );

      const shape = buildLiquidityShape({ ...wideCurve, layout, maxRanges: 8 });
      expect(shape.ranges).toHaveLength(count);
      expect(
        shape.ranges.every(
          (range) =>
            Number.isInteger(range.weight) &&
            range.weight >= 1 &&
            range.weight <= 255,
        ),
      ).toBe(true);
      expect(Math.min(...shape.ranges.map((range) => range.tickLowerId))).toBe(
        -500,
      );
      expect(Math.max(...shape.ranges.map((range) => range.tickUpperId))).toBe(
        510,
      );
      expect(shape.columns).toHaveLength(101);
      for (const column of shape.columns) {
        expect(column.weight).toBeGreaterThanOrEqual(1);
        expect(weightAt(shape.ranges, column.tickId)).toBe(column.weight);
      }
      expect(weightAt(shape.ranges, 0)).toBe(peak);
      expect(Math.max(...shape.columns.map((column) => column.weight))).toBe(
        peak,
      );
    },
  );

  it("leaves a shape that already fits unchanged", () => {
    const args = { ...wideCurve, minTickId: -20, maxTickId: 20 };
    expect(buildLiquidityShape({ ...args, maxRanges: 5 })).toEqual(
      buildLiquidityShape(args),
    );
  });

  it.each([
    { name: "vertical", layout: LiquidityLayout.Vertical },
    { name: "horizontal", layout: LiquidityLayout.Horizontal },
  ])("rejects a $name cap below the number of separate runs", ({ layout }) => {
    const args = {
      strategy: StrategyType.Custom,
      minTickId: -20,
      maxTickId: 20,
      tickSpacing: 10,
      currentTickId: 0,
      layout,
      weights: gridWeights(-20, 10, [1, 0, 1, 0, 1]),
    };
    expect(() => buildLiquidityShape({ ...args, maxRanges: 2 })).toThrow(
      /cannot fit into 2 ranges/,
    );
    expect(buildLiquidityShape({ ...args, maxRanges: 3 }).ranges).toHaveLength(
      3,
    );
    expect(() => buildLiquidityShape({ ...args, maxRanges: 0 })).toThrow(
      invalidParameters,
    );
  });
});
