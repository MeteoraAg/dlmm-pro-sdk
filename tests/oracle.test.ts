import { BN } from "@coral-xyz/anchor";
import { describe, expect, it } from "vitest";
import {
  deriveOracle,
  deriveTickArray,
  DlmmProClient,
  tickIndexFromId,
} from "../src";
import {
  accountExists,
  createFundedMarket,
  createSvmConnection,
  DEFAULT_TICK_RANGES,
  DEFAULT_TICK_SPACING,
  initializeStaticPool,
  initializeSVM,
  seedPoolLiquidity,
  sendTransaction,
  swap,
  warpToTime,
} from "./helpers";

describe("oracle", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));

  it("grows the observation buffer and records samples after swaps", async () => {
    warpToTime(svm, 1_700_000_000n);

    const market = await createFundedMarket({ svm, client });
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    await seedPoolLiquidity(svm, client, {
      pool,
      lpOwner: market.lpOwner,
      payer: market.payer,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      lpTokenX: market.lpTokenX,
      lpTokenY: market.lpTokenY,
    });

    const oracle = deriveOracle(pool);
    const header = await client.state.fetchOracle(oracle);
    expect(header.pool.toBase58()).toBe(pool.toBase58());
    expect(header.idx).toBe(0);

    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenY,
      userTokenOut: market.swapperTokenX,
      inputAmount: new BN(5_000),
    });

    warpToTime(svm, 1_700_000_020n);
    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenX,
      userTokenOut: market.swapperTokenY,
      inputAmount: new BN(5_000),
    });

    const sizeBefore = svm.getAccount(oracle)!.data.length;
    const { tx } = await client.pool.increaseOracleLength({
      pool,
      payer: market.payer.publicKey,
      lengthToAdd: 4,
    });
    sendTransaction(svm, tx, [market.payer]);

    expect(svm.getAccount(oracle)!.data.length).toBeGreaterThan(sizeBefore);

    const observations = await client.state.decodeObservations(oracle);
    expect(observations.length).toBe(5);
    expect(
      observations.some((sample) => !sample.lastUpdatedTimestamp.isZero()),
    ).toBe(true);
  });
});

describe("tick arrays", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));

  it("initializes a tick array and bitmap extension", async () => {
    const market = await createFundedMarket({ svm, client });
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });

    const index = tickIndexFromId(
      DEFAULT_TICK_RANGES[0].tickLowerId,
      DEFAULT_TICK_SPACING,
    );
    const { tx, tickArray } = await client.pool.initializeTickArray({
      pool,
      index,
      funder: market.payer.publicKey,
    });
    sendTransaction(svm, tx, [market.payer]);
    expect(tickArray.toBase58()).toBe(deriveTickArray(pool, index).toBase58());
    expect(accountExists(svm, tickArray)).toBe(true);

    const extension = await client.pool.initializeTickBitmapExtension({
      pool,
      funder: market.payer.publicKey,
    });
    sendTransaction(svm, extension.tx, [market.payer]);
    expect(accountExists(svm, extension.tickArrayBitmapExtension)).toBe(true);

    const tickArrayState = await client.state.fetchTickArray(tickArray);
    expect(tickArrayState.pool.toBase58()).toBe(pool.toBase58());
  });
});
