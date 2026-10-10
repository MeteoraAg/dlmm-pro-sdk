import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  deriveRewardVault,
  DlmmProClient,
  encodePoolExtensions,
  liquidityBitmap,
  NUM_REWARDS,
  PoolExtension,
  PoolErrorCode,
} from "../src";
import {
  createFundedMarket,
  createSvmConnection,
  createToken,
  createToken2022WithFreeze,
  defaultStaticConfigArgs,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  mintSplTokenTo,
  seedPoolLiquidity,
  sendTransaction,
  sendTransactionExpectingError,
  warpToTime,
  getOrCreateAssociatedTokenAccount,
} from "./helpers";

describe("rewards", () => {
  const svm = initializeSVM();
  const connection = createSvmConnection(svm);
  const client = DlmmProClient.create(connection);

  it("initializes a reward, emits, and claims", async () => {
    warpToTime(svm, 1n);

    const market = await createFundedMarket({ svm, client });
    const rewardMint = createToken(svm, market.payer);
    const funderToken = mintSplTokenTo(
      svm,
      market.payer,
      rewardMint,
      market.creator.publicKey,
    );
    const userReward = getOrCreateAssociatedTokenAccount(
      svm,
      market.payer,
      rewardMint,
      market.lpOwner.publicKey,
    );

    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      configArgs: {
        ...defaultStaticConfigArgs(),
        extensions: encodePoolExtensions([PoolExtension.LiquidityMining]),
      },
    });
    const seeded = await seedPoolLiquidity(svm, client, {
      pool,
      lpOwner: market.lpOwner,
      payer: market.payer,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      lpTokenX: market.lpTokenX,
      lpTokenY: market.lpTokenY,
    });
    const decodedPositions = await client.state.decodePositions(
      seeded.position,
    );
    expect(decodedPositions).toHaveLength(seeded.tickRanges.length);
    expect(decodedPositions[0]).toHaveProperty("rewards");

    const { tx: initTx, rewardVault } = await client.reward.initializeReward({
      pool,
      rewardMint,
      rewardAuthority: market.creator.publicKey,
      creator: market.creator.publicKey,
      payer: market.payer.publicKey,
    });
    sendTransaction(svm, initTx, [market.payer, market.creator]);
    expect(rewardVault.toBase58()).toBe(deriveRewardVault(pool, 0).toBase58());
    const { extensions } = await client.state.fetchPoolWithExtensions(pool);
    expect(extensions.rewards?.[0].mint.toBase58()).toBe(rewardMint.toBase58());
    expect(extensions.rewards?.[0].authority.toBase58()).toBe(
      market.creator.publicKey.toBase58(),
    );

    await expect(
      client.reward.initializeReward({
        pool,
        rewardMint,
        rewardAuthority: market.creator.publicKey,
        creator: market.creator.publicKey,
        payer: market.payer.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidRewardState });

    const openTime = new BN(10);
    const endTime = openTime.addn(86_400 + 60);
    const emissionPerSecond = new BN(1).shln(64);
    const { tx: emitTx } = await client.reward.setRewardEmission({
      pool,
      rewardMint,
      funderTokenAccount: funderToken,
      funder: market.creator.publicKey,
      authority: market.creator.publicKey,
      parameters: {
        index: 0,
        openTime,
        endTime,
        emissionPerSecond,
        maxAmount: endTime.sub(openTime).mul(emissionPerSecond).shrn(64),
      },
    });
    sendTransaction(svm, emitTx, [market.creator]);

    await expect(
      client.reward.updateRewardAuthority({
        pool,
        creator: market.creator.publicKey,
        newAuthority: market.creator.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    // Without an operator account the program rejects any non-creator signer.
    await expect(
      client.reward.updateRewardAuthority({
        pool,
        creator: market.lpOwner.publicKey,
        newAuthority: market.lpOwner.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.MissingOperatorAccount });

    const { tx: authorityTx } = await client.reward.updateRewardAuthority({
      pool,
      creator: market.creator.publicKey,
      newAuthority: market.lpOwner.publicKey,
    });
    sendTransaction(svm, authorityTx, [market.creator]);
    expect(
      (
        await client.state.fetchPoolWithExtensions(pool)
      ).extensions.rewards?.[0].authority.toBase58(),
    ).toBe(market.lpOwner.publicKey.toBase58());

    warpToTime(svm, 610n);
    const before = getTokenAmount(svm, userReward);
    const { liquidity } = await client.state.fetchPool(pool);
    const { tx: claimTx } = await client.reward.claimReward({
      pool,
      nftMint: seeded.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      rewardMint,
      userTokenAccount: userReward,
      rewardIndex: 0,
      bitmap: liquidityBitmap([0]),
      tickRanges: seeded.tickRanges,
      tickSpacing: seeded.tickSpacing,
    });
    sendTransaction(svm, claimTx, [market.lpOwner]);

    const seconds = new BN(610).sub(openTime);
    const rewardGrowthDelta = seconds.mul(emissionPerSecond).div(liquidity);
    const expected = liquidity.mul(rewardGrowthDelta).shrn(64);
    expect(getTokenAmount(svm, userReward).sub(before).toString()).toBe(
      expected.toString(),
    );

    // The program only accepts this once emission has fully elapsed. The pool
    // never sat at zero liquidity, so nothing is ineligible and it short-circuits
    // after validating the accounts.
    warpToTime(svm, BigInt(endTime.addn(1).toString()));
    const { tx: withdrawTx } = await client.reward.withdrawIneligibleRewards({
      pool,
      rewardMint,
      receiverTokenAccount: userReward,
      authority: market.lpOwner.publicKey,
      index: 0,
    });
    const afterClaim = getTokenAmount(svm, userReward);
    sendTransaction(svm, withdrawTx, [market.lpOwner]);
    expect(getTokenAmount(svm, userReward).toString()).toBe(
      afterClaim.toString(),
    );
  });

  it("rejects a creator reward mint that has a freeze authority", async () => {
    const market = await createFundedMarket({ svm, client });
    const rewardMint = createToken2022WithFreeze(svm, market.payer);
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      configArgs: {
        ...defaultStaticConfigArgs(),
        extensions: encodePoolExtensions([PoolExtension.LiquidityMining]),
      },
    });
    await expect(
      client.reward.initializeReward({
        pool,
        rewardMint,
        rewardAuthority: market.creator.publicKey,
        creator: market.creator.publicKey,
        payer: market.payer.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.UnsupportedMint });
  });

  it("limits creator reward setup to liquidity-mining pools and the creator", async () => {
    const market = await createFundedMarket({ svm, client });
    const rewardMint = createToken(svm, market.payer);
    const { pool: plainPool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    const base = {
      rewardMint,
      rewardAuthority: market.creator.publicKey,
      payer: market.payer.publicKey,
    };
    await expect(
      client.reward.initializeReward({
        ...base,
        pool: plainPool,
        creator: market.creator.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidPoolType });

    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      configArgs: {
        ...defaultStaticConfigArgs(),
        extensions: encodePoolExtensions([PoolExtension.LiquidityMining]),
      },
    });
    await expect(
      client.reward.initializeReward({
        ...base,
        pool,
        creator: market.lpOwner.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidPermission });
    await expect(
      client.reward.updateRewardAuthority({
        pool,
        creator: market.creator.publicKey,
        newAuthority: market.lpOwner.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.RewardUninitialized });

    const { tx } = await client.reward.initializeReward({
      ...base,
      pool,
      creator: market.creator.publicKey,
    });
    for (const key of tx.instructions[0].keys) {
      if (key.pubkey.equals(market.creator.publicKey)) {
        key.pubkey = market.lpOwner.publicKey;
      }
    }
    sendTransactionExpectingError(
      svm,
      tx,
      [market.payer, market.lpOwner],
      "InvalidPermission",
    );
  });

  it("rejects reward indexes outside NUM_REWARDS client-side", async () => {
    const pool = Keypair.generate().publicKey;
    expect(() => deriveRewardVault(pool, NUM_REWARDS)).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidRewardIndex }),
    );
    await expect(
      client.reward.withdrawIneligibleRewards({
        pool,
        rewardMint: Keypair.generate().publicKey,
        receiverTokenAccount: Keypair.generate().publicKey,
        authority: Keypair.generate().publicKey,
        index: NUM_REWARDS,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidRewardIndex });
  });
});
