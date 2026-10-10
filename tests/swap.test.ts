import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { DlmmProClient, tickArraysForRanges } from "../src";
import {
  addLiquidity,
  big,
  createFundedMarket,
  createSvmConnection,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  openPosition,
  sendTransactionExpectingError,
  swap,
} from "./helpers";

describe("swap tick array traversal", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const tickSpacing = 1;
  const tickRanges = [
    { tickLowerId: -120, tickUpperId: 120 },
    { tickLowerId: -256, tickUpperId: -128 },
  ];
  const inputAmount = new BN(50_000);

  let market: Awaited<ReturnType<typeof createFundedMarket>>;
  let pool: PublicKey;

  it("seeds liquidity across two tick arrays below the current price", async () => {
    market = await createFundedMarket({ svm, client });
    ({ pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    }));

    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
      tickSpacing,
    });
    await addLiquidity(svm, client, {
      pool,
      nftMint: opened.nftMint,
      signer: market.lpOwner,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      tickSpacing,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(10_000),
          maxTokenY: new BN(10_000),
        },
        {
          positionIndex: 1,
          maxTokenX: new BN(0),
          maxTokenY: new BN(200_000),
        },
      ],
    });

    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBe(0);
  });

  it("fails on-chain when tick arrays are ordered against the traversal", async () => {
    const { tx } = await client.pool.swap({
      pool,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenX,
      userTokenOut: market.swapperTokenY,
      user: market.swapper.publicKey,
      parameters: {
        inputAmount,
        minimumOutputAmount: new BN(0),
      },
      tickArrays: tickArraysForRanges(pool, tickRanges, tickSpacing),
    });
    sendTransactionExpectingError(
      svm,
      tx,
      [market.swapper],
      "NotConsumingFullAmountIn",
    );
  });

  it("swaps X for Y across a tick array boundary with tickArraysForSwap", async () => {
    const xBefore = getTokenAmount(svm, market.swapperTokenX);
    const yBefore = getTokenAmount(svm, market.swapperTokenY);

    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenX,
      userTokenOut: market.swapperTokenY,
      inputAmount,
    });

    expect(
      xBefore.sub(getTokenAmount(svm, market.swapperTokenX)).eq(inputAmount),
    ).toBe(true);
    expect(big(getTokenAmount(svm, market.swapperTokenY))).toBeGreaterThan(
      big(yBefore),
    );

    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBeLessThan(-128);
  });
});
