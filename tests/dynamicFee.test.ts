import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DlmmProClient,
  MAX_BASIS_POINT,
  MAX_REFERENCE_AGE,
  type Pool,
  type TickRange,
} from "../src";
import {
  createFundedMarket,
  createSvmConnection,
  defaultStaticConfigArgs,
  DYNAMIC_FEE_PARAMETERS,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  openFundedPosition,
  sendTransaction,
  warpToTime,
  type Market,
} from "./helpers";

const T0 = 1_755_000_000n;
const RANGE: TickRange = { tickLowerId: -300, tickUpperId: 300 };
const SIGNIFICANT_SWAP = new BN(100_000);
const NEGLIGIBLE_SWAP = new BN(1_000);

type References = {
  sqrtPriceReference: string;
  lastReferenceTimestamp: bigint;
  lastSignificantSwapTimestamp: bigint;
  volatilityReference: number;
};

function references(pool: Pool): References {
  return {
    sqrtPriceReference: pool.variableFee.sqrtPriceReference.toString(),
    lastReferenceTimestamp: BigInt(
      pool.variableFee.lastReferenceTimestamp.toString(),
    ),
    lastSignificantSwapTimestamp: BigInt(
      pool.variableFee.lastSignificantSwapTimestamp.toString(),
    ),
    volatilityReference: pool.variableFee.volatilityReference,
  };
}

describe("dynamic fee regimes", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));

  let market: Market;
  let pool: PublicKey;
  let now = T0;

  beforeAll(async () => {
    warpToTime(svm, now);
    market = await createFundedMarket({ svm, client });
    const configArgs = defaultStaticConfigArgs();
    configArgs.poolFees.dynamicFeeParameter = DYNAMIC_FEE_PARAMETERS;
    pool = await initializeStaticPool(svm, client, market, { configArgs });
    await openFundedPosition(svm, client, market, pool, [RANGE], {
      maxAmount: new BN(2_000_000),
    });
  });

  function advance(seconds: number) {
    now += BigInt(seconds);
    warpToTime(svm, now);
  }

  async function swapMatchingQuote(inputAmount: BN, swapForY: boolean) {
    const { quote, tickArrays, tickArrayBitmapExtension } =
      await client.pool.quoteExactIn({
        pool,
        inputAmount,
        swapForY,
        swapper: market.swapper.publicKey,
      });
    expect(quote.amountLeft.toString()).toBe("0");

    const [inAccount, outAccount] = swapForY
      ? [market.swapperTokenX, market.swapperTokenY]
      : [market.swapperTokenY, market.swapperTokenX];
    const inBefore = getTokenAmount(svm, inAccount);
    const outBefore = getTokenAmount(svm, outAccount);
    const before = await client.state.fetchPool(pool);

    const { tx } = await client.pool.swap({
      pool,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: inAccount,
      userTokenOut: outAccount,
      user: market.swapper.publicKey,
      swapForY,
      parameters: {
        inputAmount,
        minimumOutputAmount: quote.transferFeeExcludedOutAmount,
      },
      tickArrays,
      tickArrayBitmapExtension,
    });
    sendTransaction(svm, tx, [market.swapper]);
    const after = await client.state.fetchPool(pool);

    expect({
      paid: inBefore.sub(getTokenAmount(svm, inAccount)).toString(),
      received: getTokenAmount(svm, outAccount).sub(outBefore).toString(),
      sqrtPrice: after.sqrtPrice.toString(),
      tickCurrentId: after.tickCurrentId,
      liquidity: after.liquidity.toString(),
      protocolFee: after.protocolFeeX
        .sub(before.protocolFeeX)
        .add(after.protocolFeeY.sub(before.protocolFeeY))
        .toString(),
    }).toEqual({
      paid: inputAmount.toString(),
      received: quote.transferFeeExcludedOutAmount.toString(),
      sqrtPrice: quote.nextSqrtPrice.toString(),
      tickCurrentId: quote.nextTickId,
      liquidity: quote.nextLiquidity.toString(),
      protocolFee: quote.protocolFee.toString(),
    });
    return { quote, before, after };
  }

  it("starts the references on the first swap", async () => {
    const { before, after } = await swapMatchingQuote(SIGNIFICANT_SWAP, true);
    expect(before.variableFee.lastReferenceTimestamp.isZero()).toBe(true);
    expect(before.tickCurrentId - after.tickCurrentId).toBeGreaterThanOrEqual(
      DYNAMIC_FEE_PARAMETERS.minDeltaTickForSignificantSwap,
    );
    expect(references(after)).toEqual({
      sqrtPriceReference: before.sqrtPrice.toString(),
      lastReferenceTimestamp: now,
      lastSignificantSwapTimestamp: now,
      volatilityReference: 0,
    });
    expect(after.variableFee.volatilityAccumulator).toBeGreaterThan(0);
  });

  it("keeps the references for a second swap at the same time", async () => {
    const { quote, before, after } = await swapMatchingQuote(
      SIGNIFICANT_SWAP,
      true,
    );
    expect(references(after)).toEqual(references(before));
    expect(after.variableFee.volatilityAccumulator).toBeGreaterThan(
      before.variableFee.volatilityAccumulator,
    );
    expect(quote.mmFee.gt(new BN(0))).toBe(true);
  });

  it("records only swaps that move the price by the significant delta", async () => {
    advance(DYNAMIC_FEE_PARAMETERS.filterPeriod - 1);

    const negligible = await swapMatchingQuote(NEGLIGIBLE_SWAP, false);
    expect(
      negligible.after.tickCurrentId - negligible.before.tickCurrentId,
    ).toBeLessThan(DYNAMIC_FEE_PARAMETERS.minDeltaTickForSignificantSwap);
    expect(references(negligible.after)).toEqual(references(negligible.before));

    const significant = await swapMatchingQuote(SIGNIFICANT_SWAP, false);
    expect(references(significant.after)).toEqual({
      ...references(significant.before),
      lastSignificantSwapTimestamp: now,
    });
  });

  it("decays the volatility reference once the filter period has passed since the last significant swap", async () => {
    advance(DYNAMIC_FEE_PARAMETERS.filterPeriod + 1);

    const { before, after } = await swapMatchingQuote(SIGNIFICANT_SWAP, true);
    const decayed = Math.floor(
      (before.variableFee.volatilityAccumulator *
        DYNAMIC_FEE_PARAMETERS.reductionFactor) /
        MAX_BASIS_POINT,
    );
    expect(decayed).toBeGreaterThan(0);
    expect(references(after)).toEqual({
      sqrtPriceReference: before.sqrtPrice.toString(),
      lastReferenceTimestamp: now,
      lastSignificantSwapTimestamp: now,
      volatilityReference: decayed,
    });
    expect(after.variableFee.volatilityAccumulator).toBeGreaterThan(decayed);
  });

  it("zeroes the volatility reference once the decay period has passed", async () => {
    advance(DYNAMIC_FEE_PARAMETERS.decayPeriod + 1);

    const { before, after } = await swapMatchingQuote(SIGNIFICANT_SWAP, false);
    expect(before.variableFee.volatilityReference).toBeGreaterThan(0);
    expect(references(after)).toEqual({
      sqrtPriceReference: before.sqrtPrice.toString(),
      lastReferenceTimestamp: now,
      lastSignificantSwapTimestamp: now,
      volatilityReference: 0,
    });
  });

  it("resets the references once they are older than the maximum age", async () => {
    advance(MAX_REFERENCE_AGE.toNumber() + 1);

    const { before, after } = await swapMatchingQuote(SIGNIFICANT_SWAP, true);
    expect(
      now - BigInt(before.variableFee.lastReferenceTimestamp.toString()),
    ).toBe(BigInt(MAX_REFERENCE_AGE.toNumber() + 1));
    expect(references(after)).toEqual({
      sqrtPriceReference: before.sqrtPrice.toString(),
      lastReferenceTimestamp: now,
      lastSignificantSwapTimestamp: now,
      volatilityReference: 0,
    });
  });
});
