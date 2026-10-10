import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ActivationType,
  DlmmProClient,
  MAX_VESTING_DURATION,
  MAX_VESTING_DURATION_SLOT,
  PoolErrorCode,
  type LockVestingPositionParameters,
  type TickRange,
} from "../src";
import { createDlmmProProgram } from "../src/helpers/create_program";
import {
  addLiquidity,
  big,
  createFundedMarket,
  createSvmConnection,
  defaultStaticConfigArgs,
  initializeStaticPool,
  initializeSVM,
  openPosition,
  sendTransaction,
  sendTransactionExpectingError,
} from "./helpers";

const RANGE: TickRange = { tickLowerId: -20, tickUpperId: 20 };

function schedule(duration: BN): LockVestingPositionParameters {
  return {
    cliffPoint: null,
    cliffUnlockBps: 0,
    bpsPerPeriod: 10_000,
    periodFrequency: duration,
    numberOfPeriod: 1,
    bps: 10_000,
    expectedLayoutVersion: null,
  };
}

describe("vesting duration cap", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const tickSpacing = 1;
  const betweenCaps = MAX_VESTING_DURATION.addn(1);

  let market: Awaited<ReturnType<typeof createFundedMarket>>;

  beforeAll(async () => {
    market = await createFundedMarket({ svm, client });
  });

  async function fundedPosition(activationType: ActivationType) {
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      configArgs: { ...defaultStaticConfigArgs(), activationType },
    });
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE],
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
      tickRanges: [RANGE],
      tickSpacing,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(50_000),
          maxTokenY: new BN(50_000),
        },
      ],
    });
    expect((await client.state.fetchPool(pool)).activationType).toBe(
      activationType,
    );
    return { pool, ...opened };
  }

  async function rawLockVesting(
    pool: PublicKey,
    position: PublicKey,
    nftAccount: PublicKey,
    parameters: LockVestingPositionParameters,
  ) {
    const tx = await createDlmmProProgram(client.connection)
      .methods.lockVestingPosition(parameters)
      .accountsPartial({
        pool,
        position,
        nftAccount,
        signer: market.lpOwner.publicKey,
      })
      .transaction();
    tx.feePayer = market.lpOwner.publicKey;
    return tx;
  }

  it("allows slot pools four times the timestamp duration", () => {
    expect(MAX_VESTING_DURATION_SLOT.eq(MAX_VESTING_DURATION.muln(4))).toBe(
      true,
    );
  });

  it("locks a schedule past the timestamp cap on a slot pool", async () => {
    const opened = await fundedPosition(ActivationType.Slot);
    const { tx } = await client.position.lockVestingPosition({
      pool: opened.pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      parameters: schedule(betweenCaps),
    });
    sendTransaction(svm, tx, [market.lpOwner]);

    const [position] = await client.state.decodePositions(opened.position);
    expect(big(position.vestingLiquidity)).toBeGreaterThan(0n);
    expect(position.unlockedLiquidity.isZero()).toBe(true);
  });

  it("locks a schedule exactly at the slot cap", async () => {
    const opened = await fundedPosition(ActivationType.Slot);
    const { tx } = await client.position.lockVestingPosition({
      pool: opened.pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      parameters: schedule(MAX_VESTING_DURATION_SLOT),
    });
    sendTransaction(svm, tx, [market.lpOwner]);
    const [position] = await client.state.decodePositions(opened.position);
    expect(big(position.vestingLiquidity)).toBeGreaterThan(0n);
  });

  it("rejects the same schedule on a timestamp pool", async () => {
    const opened = await fundedPosition(ActivationType.Timestamp);
    await expect(
      client.position.lockVestingPosition({
        pool: opened.pool,
        nftMint: opened.nftMint,
        owner: market.lpOwner.publicKey,
        parameters: schedule(betweenCaps),
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });

    sendTransactionExpectingError(
      svm,
      await rawLockVesting(
        opened.pool,
        opened.position,
        opened.nftAccount,
        schedule(betweenCaps),
      ),
      [market.lpOwner],
      "InvalidParameters",
    );

    const { tx } = await client.position.lockVestingPosition({
      pool: opened.pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      parameters: schedule(MAX_VESTING_DURATION),
    });
    sendTransaction(svm, tx, [market.lpOwner]);
    const [position] = await client.state.decodePositions(opened.position);
    expect(big(position.vestingLiquidity)).toBeGreaterThan(0n);
  });

  it("rejects a schedule past the slot cap without reading the pool", async () => {
    await expect(
      client.position.lockVestingPosition({
        pool: PublicKey.unique(),
        nftMint: PublicKey.unique(),
        owner: market.lpOwner.publicKey,
        parameters: schedule(MAX_VESTING_DURATION_SLOT.addn(1)),
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });

    const opened = await fundedPosition(ActivationType.Slot);
    sendTransactionExpectingError(
      svm,
      await rawLockVesting(
        opened.pool,
        opened.position,
        opened.nftAccount,
        schedule(MAX_VESTING_DURATION_SLOT.addn(1)),
      ),
      [market.lpOwner],
      "InvalidParameters",
    );
  });
});
