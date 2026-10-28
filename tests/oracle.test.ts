import { BN } from "@coral-xyz/anchor";
import { describe, expect, it } from "vitest";
import { deriveOracle, DlmmProClient } from "../src";
import {
  createFundedMarket,
  createSvmConnection,
  initializeStaticPool,
  initializeSVM,
  pushPrice,
  seedPoolLiquidity,
  sendTransaction,
  warpToTime,
} from "./helpers";

describe("oracle", () => {
  const svm = initializeSVM();
  const client = new DlmmProClient(createSvmConnection(svm));

  it("grows the observation buffer and records samples after swaps", async () => {
    warpToTime(svm, 1_700_000_000n);

    const market = await createFundedMarket({ svm, client });
    const pool = await initializeStaticPool(svm, client, market);
    await seedPoolLiquidity(svm, client, market, pool);

    const oracle = deriveOracle(pool);
    const header = await client.state.fetchOracle(oracle);
    expect(header.pool.toBase58()).toBe(pool.toBase58());
    expect(header.idx).toBe(0);

    await pushPrice(svm, client, market, pool, "up", new BN(5_000));

    warpToTime(svm, 1_700_000_020n);
    await pushPrice(svm, client, market, pool, "down", new BN(5_000));

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
