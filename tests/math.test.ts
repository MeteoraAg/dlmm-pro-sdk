import { BN } from "@coral-xyz/anchor";
import { describe, expect, it } from "vitest";
import {
  calculateSharedAmounts,
  getLiquidityFromAmounts,
  getLiquidityFromAmountX,
  getLiquidityFromAmountY,
  getSqrtPriceFromTickId,
  MAX_SQRT_PRICE,
  MAX_TICK_ID,
  MIN_SQRT_PRICE,
  MIN_TICK_ID,
  Rounding,
  splitFees,
  tickIdFromSqrtPrice,
} from "../src";
import { big, SQRT_PRICE_ONE } from "./helpers";

// [tick, sqrtPrice(tick), sqrtPrice(-tick)].
const EXACT_BIT_VALUES: [number, string, string][] = [
  [0, "18446744073709551616", "18446744073709551616"],
  [1, "18447666387855959850", "18445821805675392311"],
  [2, "18448588748116922571", "18444899583751176498"],
  [4, "18450433606991734263", "18443055278223354162"],
  [8, "18454123878217468680", "18439367220385604838"],
  [16, "18461506635090006701", "18431993317065449817"],
  [32, "18476281010653910144", "18417254355718160513"],
  [64, "18505865242158250041", "18387811781193591352"],
  [128, "18565175891880433522", "18329067761203520168"],
  [256, "18684368066214940582", "18212142134806087854"],
  [512, "18925053041275764671", "17980523815641551639"],
  [1024, "19415764168677886926", "17526086738831147013"],
  [2048, "20435687552633177494", "16651378430235024244"],
  [4096, "22639080592224303007", "15030750278693429944"],
  [8192, "27784196929998399742", "12247334978882834399"],
  [16384, "41848122137994986128", "8131365268884726200"],
  [32768, "94936283578220370716", "3584323654723342297"],
  [65536, "488590176327622479860", "696457651847595233"],
  [131072, "12941056668319229769860", "26294789957452057"],
  [262144, "9078618265828848800676189", "37481735321082"],
];

describe("tick math", () => {
  it("round-trips tick 0 at Q64.64 one", () => {
    expect(getSqrtPriceFromTickId(0).toString()).toBe(
      SQRT_PRICE_ONE.toString(),
    );
    expect(tickIdFromSqrtPrice(SQRT_PRICE_ONE)).toBe(0);
  });

  it("rounds down between ticks", () => {
    expect(tickIdFromSqrtPrice(SQRT_PRICE_ONE.addn(1))).toBe(0);
    expect(tickIdFromSqrtPrice(SQRT_PRICE_ONE.subn(1))).toBe(-1);
  });

  it("rejects prices outside the supported range", () => {
    expect(() => tickIdFromSqrtPrice(MIN_SQRT_PRICE.subn(1))).toThrow();
    expect(() => tickIdFromSqrtPrice(MAX_SQRT_PRICE.addn(1))).toThrow();
  });

  it("is monotonic around zero", () => {
    const minusOne = getSqrtPriceFromTickId(-1);
    const zero = getSqrtPriceFromTickId(0);
    const plusOne = getSqrtPriceFromTickId(1);
    expect(big(minusOne)).toBeLessThan(big(zero));
    expect(big(zero)).toBeLessThan(big(plusOne));
    expect(tickIdFromSqrtPrice(minusOne)).toBe(-1);
    expect(tickIdFromSqrtPrice(plusOne)).toBe(1);
  });

  it("matches known boundary ticks", () => {
    expect(tickIdFromSqrtPrice(MIN_SQRT_PRICE)).toBe(MIN_TICK_ID);
    expect(tickIdFromSqrtPrice(MAX_SQRT_PRICE)).toBe(MAX_TICK_ID);
  });

  it("matches the program's exact per-bit sqrt prices", () => {
    for (const [tick, expectedPositive, expectedNegative] of EXACT_BIT_VALUES) {
      expect(getSqrtPriceFromTickId(tick).toString()).toBe(expectedPositive);
      expect(getSqrtPriceFromTickId(-tick).toString()).toBe(expectedNegative);
    }
  });

  it("round-trips tickIdFromSqrtPrice at the per-bit boundaries", () => {
    for (const [boundary] of EXACT_BIT_VALUES) {
      for (const tick of boundary === 0 ? [0] : [boundary, -boundary]) {
        const sqrtPrice = getSqrtPriceFromTickId(tick);
        expect(tickIdFromSqrtPrice(sqrtPrice)).toBe(tick);
        expect(tickIdFromSqrtPrice(sqrtPrice.addn(1))).toBe(tick);
        expect(tickIdFromSqrtPrice(sqrtPrice.subn(1))).toBe(tick - 1);
      }
    }
  });
});

describe("liquidity math", () => {
  it("uses the binding side when the current tick is in range", () => {
    const maxTokenX = new BN(50_000);
    const maxTokenY = new BN(30_000);
    const tickLowerId = -128;
    const tickUpperId = 128;

    const liquidityX = getLiquidityFromAmountX(
      SQRT_PRICE_ONE,
      getSqrtPriceFromTickId(tickUpperId),
      maxTokenX,
    );
    const liquidityY = getLiquidityFromAmountY(
      getSqrtPriceFromTickId(tickLowerId),
      SQRT_PRICE_ONE,
      maxTokenY,
    );
    const liquidity = getLiquidityFromAmounts({
      maxTokenX,
      maxTokenY,
      tickLowerId,
      tickUpperId,
      tickCurrentId: 0,
      currentSqrtPrice: SQRT_PRICE_ONE,
    });

    expect(liquidityX).not.toBeNull();
    expect(liquidityY).not.toBeNull();
    expect(big(liquidityY!)).toBeLessThan(big(liquidityX!));
    expect(liquidity.toString()).toBe(liquidityY!.toString());
  });
});

describe("fee sharing math", () => {
  it("splits an amount by numerator/denominator", () => {
    const [fee, remainder] = calculateSharedAmounts(
      new BN(10_000),
      new BN(1_000),
      new BN(10_000),
      Rounding.Down,
    );
    expect(fee.toNumber()).toBe(1_000);
    expect(remainder.toNumber()).toBe(9_000);
  });

  it("rounds a non-divisible split toward the requested direction", () => {
    const amount = new BN(1_000);
    const numerator = new BN(333);
    const denominator = new BN(10_000);

    const [downFee, downRemainder] = calculateSharedAmounts(
      amount,
      numerator,
      denominator,
      Rounding.Down,
    );
    expect(downFee.toNumber()).toBe(33);
    expect(downRemainder.toNumber()).toBe(967);

    const [upFee, upRemainder] = calculateSharedAmounts(
      amount,
      numerator,
      denominator,
      Rounding.Up,
    );
    expect(upFee.toNumber()).toBe(34);
    expect(upRemainder.toNumber()).toBe(966);
  });

  // The mm/limit-order split rounds up in favor of the mm; both protocol cuts round down.
  it("splits fees up for the mm share and down for the protocol cuts", () => {
    const split = splitFees(
      new BN(101),
      {
        feesOnInput: true,
        feesOnTokenX: true,
        hasReferral: false,
        hasPartner: false,
        mmProtocolFeeBps: 1_000,
        limitOrderProtocolFeeBps: 5_000,
        partnerFeeBps: 0,
      },
      {
        amountIn: new BN(3),
        amountLeft: new BN(0),
        outAmount: new BN(0),
        mmAmountIn: new BN(1),
        mmAmountOut: new BN(0),
        processedOrderAmountOut: new BN(0),
        openOrderAmountOut: new BN(0),
        nextSqrtPrice: SQRT_PRICE_ONE,
      },
    );

    // totalMmFee = ceil(101 * 1 / 3) = 34, totalLimitOrderFee = 67
    // protocolOnMm = floor(34 * 10%) = 3, protocolOnLimitOrder = floor(67 * 50%) = 33
    expect(split.protocolFeeOnMmFee.toNumber()).toBe(3);
    expect(split.mmFee.toNumber()).toBe(31);
    expect(split.protocolFeeOnLimitOrderFee.toNumber()).toBe(33);
    expect(split.limitOrderFee.toNumber()).toBe(34);
  });

  // A fee numerator high enough to consume the whole input leaves nothing
  // filled to share against, and the program hands the fee to the protocol.
  it("gives the whole fee to the protocol when nothing was filled", () => {
    const split = splitFees(
      new BN(101),
      {
        feesOnInput: false,
        feesOnTokenX: true,
        hasReferral: false,
        hasPartner: false,
        mmProtocolFeeBps: 1_000,
        limitOrderProtocolFeeBps: 5_000,
        partnerFeeBps: 0,
      },
      {
        amountIn: new BN(101),
        amountLeft: new BN(0),
        outAmount: new BN(0),
        mmAmountIn: new BN(101),
        mmAmountOut: new BN(0),
        processedOrderAmountOut: new BN(0),
        openOrderAmountOut: new BN(0),
        nextSqrtPrice: SQRT_PRICE_ONE,
      },
    );

    expect(split.protocolFeeOnMmFee.toNumber()).toBe(101);
    expect(split.mmFee.toNumber()).toBe(0);
    expect(split.protocolFeeOnLimitOrderFee.toNumber()).toBe(0);
    expect(split.limitOrderFee.toNumber()).toBe(0);
  });
});
