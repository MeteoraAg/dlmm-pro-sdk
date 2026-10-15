import { BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { DlmmProClient, PoolErrorCode } from "../src";
import {
  big,
  createFundedMarket,
  createSvmConnection,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  pushPrice,
  seedCrossArrayLiquidity,
  seedPoolLiquidity,
  sendTransaction,
  type Market,
} from "./helpers";

describe("swap", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const inputAmount = new BN(50_000);

  let market: Market;
  let pool: PublicKey;

  beforeAll(async () => {
    market = await createFundedMarket({ svm, client });
    pool = await initializeStaticPool(svm, client, market);
    await seedCrossArrayLiquidity(svm, client, market, pool);
  });

  it("swaps X for Y across a tick array boundary with tickArraysForSwap", async () => {
    const xBefore = getTokenAmount(svm, market.swapperTokenX);
    const yBefore = getTokenAmount(svm, market.swapperTokenY);

    await pushPrice(svm, client, market, pool, "down", inputAmount);

    expect(
      xBefore.sub(getTokenAmount(svm, market.swapperTokenX)).eq(inputAmount),
    ).toBe(true);
    expect(big(getTokenAmount(svm, market.swapperTokenY))).toBeGreaterThan(
      big(yBefore),
    );
    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBeLessThan(-128);
  });

  it("passes the pool's bitmap extension unless told not to", async () => {
    const extended = await initializeStaticPool(svm, client, market);
    await seedPoolLiquidity(svm, client, market, extended);
    const { tx: extensionTx, tickArrayBitmapExtension } =
      await client.pool.initializeTickBitmapExtension({
        pool: extended,
        funder: market.payer.publicKey,
      });
    sendTransaction(svm, extensionTx, [market.payer]);
    const { quote, tickArrays } = await client.pool.quoteExactIn({
      pool: extended,
      inputAmount,
      swapForY: false,
    });
    const swapArgs = {
      pool: extended,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenY,
      userTokenOut: market.swapperTokenX,
      user: market.swapper.publicKey,
      swapForY: false,
      parameters: {
        inputAmount,
        minimumOutputAmount: quote.transferFeeExcludedOutAmount,
      },
      tickArrays,
    };
    const accounts = (tx: Transaction) =>
      tx.instructions[tx.instructions.length - 1].keys.map((key) =>
        key.pubkey.toBase58(),
      );

    const { tx: omitted } = await client.pool.swap({
      ...swapArgs,
      tickArrayBitmapExtension: null,
    });
    expect(accounts(omitted)).not.toContain(
      tickArrayBitmapExtension.toBase58(),
    );

    const { tx } = await client.pool.swap(swapArgs);
    expect(accounts(tx)).toContain(tickArrayBitmapExtension.toBase58());
    sendTransaction(svm, tx, [market.swapper]);
  });

  it("rejects an input amount that does not fit in a u64", async () => {
    await expect(
      client.pool.swap({
        pool,
        tokenXMint: market.tokenXMint,
        tokenYMint: market.tokenYMint,
        userTokenIn: market.swapperTokenX,
        userTokenOut: market.swapperTokenY,
        user: market.swapper.publicKey,
        swapForY: true,
        parameters: {
          inputAmount: new BN(-1),
          minimumOutputAmount: new BN(0),
        },
        tickArrays: [],
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.TypeCastFailed });
  });
});
