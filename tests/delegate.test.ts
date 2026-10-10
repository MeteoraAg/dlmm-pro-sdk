import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  delegatePermissionMask,
  DlmmProClient,
  encodePoolExtensions,
  LimitOrderDelegatePermission,
  liquidityBitmap,
  PoolErrorCode,
  PoolExtension,
  PositionDelegatePermission,
  tickArraysForRanges,
  type TickRange,
} from "../src";
import {
  addLiquidity,
  approveNftDelegate,
  big,
  createAndFundWallet,
  createFundedMarket,
  createSvmConnection,
  createToken,
  defaultStaticConfigArgs,
  getOrCreateAssociatedTokenAccount,
  getPositionTotalLiquidity,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  mintSplTokenTo,
  openPosition,
  seedPoolLiquidity,
  sendTransaction,
  sendTransactionExpectingError,
  swap,
  warpToTime,
} from "./helpers";

const RANGE: TickRange = { tickLowerId: -64, tickUpperId: 64 };
const RANGE_ABOVE: TickRange = { tickLowerId: 128, tickUpperId: 192 };

describe("NFT delegates", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const tickSpacing = 1;

  let market: Awaited<ReturnType<typeof createFundedMarket>>;
  let pool: PublicKey;
  let delegate: Keypair;

  beforeAll(async () => {
    warpToTime(svm, 1_755_000_000n);
    market = await createFundedMarket({ svm, client });
    delegate = createAndFundWallet(svm);
    pool = (
      await initializeStaticPool(svm, client, {
        operator: market.operator,
        payer: market.payer,
        creator: market.creator.publicKey,
        tokenXMint: market.tokenXMint,
        tokenYMint: market.tokenYMint,
      })
    ).pool;
  });

  async function openFundedPosition(
    poolAddress: PublicKey,
    tickRanges: TickRange[],
    fundedIndexes = [0],
  ) {
    const opened = await openPosition(svm, client, {
      pool: poolAddress,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
      tickSpacing,
    });
    await addLiquidity(svm, client, {
      pool: poolAddress,
      nftMint: opened.nftMint,
      signer: market.lpOwner,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      tickSpacing,
      deposits: fundedIndexes.map((positionIndex) => ({
        positionIndex,
        maxTokenX: new BN(5_000_000),
        maxTokenY: new BN(5_000_000),
      })),
    });
    return opened;
  }

  async function grant(
    nftMint: PublicKey,
    permissions: PositionDelegatePermission[],
  ) {
    const { tx } = await client.position.updatePositionDelegatePermission({
      nftMint,
      owner: market.lpOwner.publicKey,
      permission: delegatePermissionMask(permissions),
    });
    sendTransaction(svm, tx, [market.lpOwner]);
  }

  function delegateAccounts(poolAddress: PublicKey, nftMint: PublicKey) {
    return {
      pool: poolAddress,
      nftMint,
      owner: market.lpOwner.publicKey,
      signer: delegate.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
    };
  }

  async function accrueFees(poolAddress: PublicKey) {
    for (const buyX of [false, true]) {
      await swap(svm, client, {
        pool: poolAddress,
        user: market.swapper,
        tokenXMint: market.tokenXMint,
        tokenYMint: market.tokenYMint,
        userTokenIn: buyX ? market.swapperTokenY : market.swapperTokenX,
        userTokenOut: buyX ? market.swapperTokenX : market.swapperTokenY,
        inputAmount: new BN(200_000),
      });
    }
  }

  it("removes liquidity to the owner's token accounts", async () => {
    const opened = await openFundedPosition(pool, [RANGE]);
    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    await grant(opened.nftMint, [PositionDelegatePermission.RemoveLiquidity]);
    const [position] = await client.state.decodePositions(opened.position);
    const withdrawal = {
      ...delegateAccounts(pool, opened.nftMint),
      tickRanges: [RANGE],
      tickSpacing,
      parameters: {
        minAmountX: new BN(0),
        minAmountY: new BN(0),
        expectedLayoutVersion: null,
        bitmap: liquidityBitmap([0]),
        liquidities: [position.unlockedLiquidity],
      },
    };

    await expect(
      client.position.removeLiquidity({
        ...withdrawal,
        userTokenX: market.swapperTokenX,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.IncorrectATA });
    await expect(
      client.position.removeLiquidityByBps({
        ...withdrawal,
        userTokenY: market.swapperTokenY,
        parameters: {
          minAmountX: new BN(0),
          minAmountY: new BN(0),
          expectedLayoutVersion: null,
          bps: 10_000,
          bitmap: null,
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.IncorrectATA });

    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx } = await client.position.removeLiquidity(withdrawal);
    sendTransaction(svm, tx, [delegate]);

    expect(big(getTokenAmount(svm, market.lpTokenX))).toBeGreaterThan(
      big(xBefore),
    );
    expect(big(getTokenAmount(svm, market.lpTokenY))).toBeGreaterThan(
      big(yBefore),
    );
    expect(
      (await getPositionTotalLiquidity(client, opened.nftMint)).isZero(),
    ).toBe(true);
  });

  it("claims fees to the owner's token accounts", async () => {
    const opened = await openFundedPosition(pool, [RANGE]);
    await accrueFees(pool);
    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    await grant(opened.nftMint, [PositionDelegatePermission.ClaimFee]);
    const claim = {
      ...delegateAccounts(pool, opened.nftMint),
      bitmap: liquidityBitmap([0]),
      tickRanges: [RANGE],
      tickSpacing,
    };

    await expect(
      client.position.claimFee({ ...claim, userTokenY: market.swapperTokenY }),
    ).rejects.toMatchObject({ code: PoolErrorCode.IncorrectATA });

    const claimable = await client.position.getClaimableFees({
      pool,
      nftMint: opened.nftMint,
    });
    expect(big(claimable.feeX)).toBeGreaterThan(0n);
    expect(big(claimable.feeY)).toBeGreaterThan(0n);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx } = await client.position.claimFee(claim);
    sendTransaction(svm, tx, [delegate]);

    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      claimable.feeX.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      claimable.feeY.toString(),
    );
  });

  it("cancels a limit order to the owner's token accounts", async () => {
    const { pool: orderPool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    await seedPoolLiquidity(svm, client, {
      pool: orderPool,
      lpOwner: market.lpOwner,
      payer: market.payer,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      lpTokenX: market.lpTokenX,
      lpTokenY: market.lpTokenY,
    });
    const tickId = 2;
    const orderAmount = new BN(100_000);
    const tickArrays = tickArraysForRanges(
      orderPool,
      [{ tickLowerId: tickId, tickUpperId: tickId }],
      tickSpacing,
    );
    const nftMintKp = Keypair.generate();
    const opened = await client.limitOrder.openLimitOrder({
      pool: orderPool,
      nftMint: nftMintKp.publicKey,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: market.tokenXMint,
      userToken: market.lpTokenX,
      parameters: {
        isAskSide: true,
        maxAmount: orderAmount,
        relativeTick: null,
        ticks: [{ id: tickId, amount: orderAmount }],
      },
      tickArrays,
    });
    sendTransaction(svm, opened.tx, [market.payer, market.lpOwner, nftMintKp]);

    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    const { tx: permissionTx } =
      await client.limitOrder.updateLimitOrderDelegatePermission({
        limitOrder: opened.limitOrder,
        nftAccount: opened.nftAccount,
        owner: market.lpOwner.publicKey,
        permission: delegatePermissionMask([
          LimitOrderDelegatePermission.CancelLimitOrder,
        ]),
      });
    sendTransaction(svm, permissionTx, [market.lpOwner]);

    const cancel = {
      ...delegateAccounts(orderPool, nftMintKp.publicKey),
      tickIds: [tickId],
      tickArrays,
    };
    await expect(
      client.limitOrder.cancelLimitOrder({
        ...cancel,
        userTokenX: market.swapperTokenX,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.IncorrectATA });

    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const { tx } = await client.limitOrder.cancelLimitOrder(cancel);
    sendTransaction(svm, tx, [delegate]);
    expect(
      getTokenAmount(svm, market.lpTokenX).sub(xBefore).eq(orderAmount),
    ).toBe(true);
  });

  it("claims a reward to the owner's token account", async () => {
    const rewardMint = createToken(svm, market.payer);
    const funderToken = mintSplTokenTo(
      svm,
      market.payer,
      rewardMint,
      market.creator.publicKey,
    );
    const ownerReward = getOrCreateAssociatedTokenAccount(
      svm,
      market.payer,
      rewardMint,
      market.lpOwner.publicKey,
    );
    const { pool: rewardPool } = await initializeStaticPool(svm, client, {
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
    const opened = await openFundedPosition(rewardPool, [RANGE]);

    const { tx: initTx } = await client.reward.initializeReward({
      pool: rewardPool,
      rewardMint,
      rewardAuthority: market.creator.publicKey,
      creator: market.creator.publicKey,
      payer: market.payer.publicKey,
    });
    sendTransaction(svm, initTx, [market.payer, market.creator]);
    const now = new BN(svm.getClock().unixTimestamp.toString());
    const openTime = now.addn(10);
    const endTime = openTime.addn(86_400 + 60);
    const emissionPerSecond = new BN(1).shln(64);
    const { tx: emitTx } = await client.reward.setRewardEmission({
      pool: rewardPool,
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
    warpToTime(svm, BigInt(now.addn(610).toString()));

    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    await grant(opened.nftMint, [PositionDelegatePermission.ClaimReward]);
    const claim = {
      pool: rewardPool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: delegate.publicKey,
      rewardMint,
      userTokenAccount: ownerReward,
      rewardIndex: 0,
      bitmap: liquidityBitmap([0]),
      tickRanges: [RANGE],
      tickSpacing,
    };
    await expect(
      client.reward.claimReward({ ...claim, userTokenAccount: funderToken }),
    ).rejects.toMatchObject({ code: PoolErrorCode.IncorrectATA });

    const before = getTokenAmount(svm, ownerReward);
    const { tx } = await client.reward.claimReward(claim);
    sendTransaction(svm, tx, [delegate]);
    expect(big(getTokenAmount(svm, ownerReward))).toBeGreaterThan(big(before));
  });

  it("rejects a withdrawal the permission mask does not grant", async () => {
    const opened = await openFundedPosition(pool, [RANGE]);
    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    await grant(opened.nftMint, [PositionDelegatePermission.ClaimFee]);
    const [position] = await client.state.decodePositions(opened.position);

    const { tx } = await client.position.removeLiquidity({
      ...delegateAccounts(pool, opened.nftMint),
      tickRanges: [RANGE],
      tickSpacing,
      parameters: {
        minAmountX: new BN(0),
        minAmountY: new BN(0),
        expectedLayoutVersion: null,
        bitmap: liquidityBitmap([0]),
        liquidities: [position.unlockedLiquidity],
      },
    });
    sendTransactionExpectingError(svm, tx, [delegate], "InvalidPermission");
  });

  it("expands and removes ranges with the owner as rent receiver", async () => {
    const opened = await openFundedPosition(pool, [RANGE]);
    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    await grant(opened.nftMint, [
      PositionDelegatePermission.UpdatePositionRange,
    ]);

    const expand = await client.position.expandPosition({
      pool,
      signer: delegate.publicKey,
      payer: delegate.publicKey,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      tickRanges: [RANGE_ABOVE],
      tickSpacing,
    });
    sendTransaction(svm, expand.tx, [delegate]);
    expect(await client.state.decodePositions(opened.position)).toHaveLength(2);

    const removal = {
      pool,
      signer: delegate.publicKey,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      rentReceiver: market.lpOwner.publicKey,
      tickRanges: [RANGE_ABOVE],
      tickSpacing,
      parameters: { bitmap: liquidityBitmap([1]), expectedLayoutVersion: null },
    };
    await expect(
      client.position.removePosition({
        ...removal,
        rentReceiver: delegate.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidPermission });

    const { tx: redirected } = await client.position.removePosition(removal);
    for (const key of redirected.instructions[0].keys) {
      if (key.pubkey.equals(market.lpOwner.publicKey)) {
        key.pubkey = delegate.publicKey;
      }
    }
    sendTransactionExpectingError(
      svm,
      redirected,
      [delegate],
      "InvalidPermission",
    );

    const { tx } = await client.position.removePosition(removal);
    sendTransaction(svm, tx, [delegate]);
    const remaining = await client.state.decodePositions(opened.position);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tickLowerId).toBe(RANGE.tickLowerId);
  });

  it("refreshes fees and rewards without any permission bit", async () => {
    const opened = await openFundedPosition(pool, [RANGE]);
    const refresh = {
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: delegate.publicKey,
      bitmap: liquidityBitmap([0]),
      tickRanges: [RANGE],
      tickSpacing,
    };
    const { tx: unapproved } =
      await client.position.refreshFeesAndRewards(refresh);
    sendTransactionExpectingError(
      svm,
      unapproved,
      [delegate],
      "InvalidAuthority",
    );

    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    expect(
      (await client.state.fetchPositionArray(opened.position))
        .delegatePermission,
    ).toBe(0);
    const { tx } = await client.position.refreshFeesAndRewards(refresh);
    sendTransaction(svm, tx, [delegate]);
  });
});
