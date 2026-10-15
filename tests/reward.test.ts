import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  calculateRewardAmount,
  deriveRewardVault,
  DlmmProClient,
  encodePoolExtensions,
  liquidityBitmap,
  NUM_REWARDS,
  PoolExtension,
  PoolErrorCode,
  Rounding,
} from "../src";
import {
  createFundedMarket,
  createSvmConnection,
  createToken,
  DEFAULT_TICK_RANGES,
  defaultStaticConfigArgs,
  getOrCreateAssociatedTokenAccount,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  mintSplTokenTo,
  seedPoolLiquidity,
  sendTransaction,
  warpToTime,
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

    const pool = await initializeStaticPool(svm, client, market, {
      configArgs: {
        ...defaultStaticConfigArgs(),
        extensions: encodePoolExtensions([PoolExtension.LiquidityMining]),
      },
    });
    const seeded = await seedPoolLiquidity(svm, client, market, pool);
    const decodedPositions = await client.state.decodePositions(
      seeded.position,
    );
    expect(decodedPositions).toHaveLength(DEFAULT_TICK_RANGES.length);
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
      tickRanges: DEFAULT_TICK_RANGES,
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
      rewardIndex: 0,
    });
    const afterClaim = getTokenAmount(svm, userReward);
    sendTransaction(svm, withdrawTx, [market.lpOwner]);
    expect(getTokenAmount(svm, userReward).toString()).toBe(
      afterClaim.toString(),
    );
  });

  it("rounds the reward funding amount in the requested direction", () => {
    const emission = new BN(1).shln(63);
    expect(
      calculateRewardAmount(new BN(1), emission, Rounding.Down).isZero(),
    ).toBe(true);
    expect(calculateRewardAmount(new BN(1), emission, Rounding.Up).eqn(1)).toBe(
      true,
    );
  });

  it("rejects a reward index past NUM_REWARDS", async () => {
    expect(() => deriveRewardVault(PublicKey.unique(), NUM_REWARDS)).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidRewardIndex }),
    );
    await expect(
      client.reward.withdrawIneligibleRewards({
        pool: PublicKey.unique(),
        rewardMint: PublicKey.unique(),
        receiverTokenAccount: PublicKey.unique(),
        authority: PublicKey.unique(),
        rewardIndex: NUM_REWARDS,
        tokenProgram: TOKEN_PROGRAM_ID,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidRewardIndex });
  });
});
