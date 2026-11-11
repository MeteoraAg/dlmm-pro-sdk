import { describe, expect, it } from "vitest";
import {
  bpsToFeeNumerator,
  DYNAMIC_FEE_DECAY_PERIOD,
  DYNAMIC_FEE_FILTER_PERIOD,
  DYNAMIC_FEE_REDUCTION_FACTOR,
  getDynamicFeeParams,
  PoolErrorCode,
} from "../src";
import {
  calculateTradingFeeNumerator,
  volatilityAccumulatorForPriceChange,
} from "../src/math";

// Static configs cap volatility one tick under the 15% get_delta_tick result.
const STATIC_CONFIG_VOLATILITY = 14_460_000;
const TIER_CONTROLS: [number, number][] = [
  [1, 9],
  [2, 19],
  [3, 28],
  [4, 38],
  [5, 47],
  [10, 95],
  [15, 143],
  [20, 191],
  [25, 239],
  [30, 286],
  [40, 382],
  [50, 478],
  [60, 573],
  [75, 717],
  [80, 765],
  [100, 956],
  [150, 1434],
  [200, 1913],
  [250, 2391],
  [300, 2869],
  [500, 4782],
  [600, 5739],
];

describe("getDynamicFeeParams", () => {
  it("derives the 15% volatility cap from get_delta_tick", () => {
    expect(volatilityAccumulatorForPriceChange(1_500)).toBe(14_470_000);
  });

  it("caps the variable fee at 20% of the base fee", () => {
    const params = getDynamicFeeParams(600, 256);
    const cap = bpsToFeeNumerator(600).muln(20).divn(100);
    const fee = calculateTradingFeeNumerator(
      params.variableFeeControl,
      params.maxVolatilityAccumulator,
    );
    const next = calculateTradingFeeNumerator(
      params.variableFeeControl + 1,
      params.maxVolatilityAccumulator,
    );
    expect(params.maxVolatilityAccumulator).toBe(14_470_000);
    expect(params.filterPeriod).toBe(DYNAMIC_FEE_FILTER_PERIOD);
    expect(params.decayPeriod).toBe(DYNAMIC_FEE_DECAY_PERIOD);
    expect(params.reductionFactor).toBe(DYNAMIC_FEE_REDUCTION_FACTOR);
    expect(params.minDeltaTickForSignificantSwap).toBe(256);
    expect(fee.lte(cap)).toBe(true);
    expect(next.gt(cap)).toBe(true);
  });

  it("reproduces the static-config controls", () => {
    for (const [baseFeeBps, variableFeeControl] of TIER_CONTROLS) {
      const params = getDynamicFeeParams(baseFeeBps, 1, {
        maxVolatilityAccumulator: STATIC_CONFIG_VOLATILITY,
      });
      expect(params.variableFeeControl).toBe(variableFeeControl);
      const cap = bpsToFeeNumerator(baseFeeBps).muln(20).divn(100);
      const fee = calculateTradingFeeNumerator(
        variableFeeControl,
        STATIC_CONFIG_VOLATILITY,
      );
      expect(fee.lte(cap)).toBe(true);
      expect(
        calculateTradingFeeNumerator(
          variableFeeControl + 1,
          STATIC_CONFIG_VOLATILITY,
        ).gt(cap),
      ).toBe(true);
    }
  });

  it("rejects a price move the u24 accumulator cannot hold", () => {
    expect(() =>
      getDynamicFeeParams(100, 1, { maxPriceChangeBps: 5_000 }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });

  it("rejects a zero significant-swap delta", () => {
    expect(() => getDynamicFeeParams(100, 0)).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });
});
