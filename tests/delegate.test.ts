import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DlmmProClient,
  encodePoolExtensions,
  LimitOrderDelegatePermission,
  limitOrderDelegatePermissionMask,
  liquidityBitmap,
  PoolErrorCode,
  PoolExtension,
  PositionDelegatePermission,
  positionDelegatePermissionMask,
  tickArraysForRanges,
  type TickRange,
} from "../src";
import {
  accrueFees,
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
  lpAccounts,
  mintSplTokenTo,
  openFundedPosition,
  seedPoolLiquidity,
  sendTransaction,
  warpToTime,
  type Market,
} from "./helpers";

const RANGE: TickRange = { tickLowerId: -64, tickUpperId: 64 };
const RANGE_ABOVE: TickRange = { tickLowerId: 128, tickUpperId: 192 };

describe("delegate permission masks", () => {
  it("sets one bit per permission", () => {
    expect(
      positionDelegatePermissionMask([
        PositionDelegatePermission.AddLiquidity,
        PositionDelegatePermission.UpdatePositionRange,
      ]),
    ).toBe(0b10001);
    expect(positionDelegatePermissionMask([])).toBe(0);
    expect(
      limitOrderDelegatePermissionMask([
        LimitOrderDelegatePermission.CancelLimitOrder,
      ]),
    ).toBe(1);
  });

  it("rejects bits outside each enum", () => {
    expect(() =>
      positionDelegatePermissionMask([
        (PositionDelegatePermission.UpdatePositionRange + 1) as never,
      ]),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidPermission }),
    );
    expect(() =>
      limitOrderDelegatePermissionMask([
        PositionDelegatePermission.RemoveLiquidity as never,
      ]),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidPermission }),
    );
  });
});

describe("NFT delegates", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const tickSpacing = 1;

  let market: Market;
  let pool: PublicKey;
  let delegate: Keypair;

  beforeAll(async () => {
    warpToTime(svm, 1_755_000_000n);
    market = await createFundedMarket({ svm, client });
    delegate = createAndFundWallet(svm);
    pool = await initializeStaticPool(svm, client, market);
  });

  async function grant(
    nftMint: PublicKey,
    permissions: PositionDelegatePermission[],
  ) {
    const { tx } = await client.position.updatePositionDelegatePermission({
      nftMint,
      owner: market.lpOwner.publicKey,
      permission: positionDelegatePermissionMask(permissions),
    });
    sendTransaction(svm, tx, [market.lpOwner]);
  }

  function delegateAccounts(poolAddress: PublicKey, nftMint: PublicKey) {
    return {
      ...lpAccounts(market, poolAddress, nftMint),
      signer: delegate.publicKey,
    };
  }

  it("removes liquidity to the owner's token accounts", async () => {
    const opened = await openFundedPosition(svm, client, market, pool, [RANGE]);
    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    await grant(opened.nftMint, [PositionDelegatePermission.RemoveLiquidity]);
    const [position] = await client.state.decodePositions(opened.position);

    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx } = await client.position.removeLiquidity({
      ...delegateAccounts(pool, opened.nftMint),
      tickRanges: [RANGE],
      parameters: {
        minAmountX: new BN(0),
        minAmountY: new BN(0),
        expectedLayoutVersion: null,
        bitmap: liquidityBitmap([0]),
        liquidities: [position.unlockedLiquidity],
      },
    });
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
    const opened = await openFundedPosition(svm, client, market, pool, [RANGE]);
    await accrueFees(svm, client, market, pool);
    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    await grant(opened.nftMint, [PositionDelegatePermission.ClaimFee]);

    const claimable = await client.position.getClaimableFees({
      pool,
      nftMint: opened.nftMint,
    });
    expect(big(claimable.feeX)).toBeGreaterThan(0n);
    expect(big(claimable.feeY)).toBeGreaterThan(0n);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx } = await client.position.claimFee({
      ...delegateAccounts(pool, opened.nftMint),
      bitmap: liquidityBitmap([0]),
      tickRanges: [RANGE],
    });
    sendTransaction(svm, tx, [delegate]);

    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      claimable.feeX.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      claimable.feeY.toString(),
    );
  });

  it("cancels a limit order to the owner's token accounts", async () => {
    const orderPool = await initializeStaticPool(svm, client, market);
    await seedPoolLiquidity(svm, client, market, orderPool);
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
        nftMint: nftMintKp.publicKey,
        owner: market.lpOwner.publicKey,
        permission: limitOrderDelegatePermissionMask([
          LimitOrderDelegatePermission.CancelLimitOrder,
        ]),
      });
    sendTransaction(svm, permissionTx, [market.lpOwner]);

    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const { tx } = await client.limitOrder.cancelLimitOrder({
      ...delegateAccounts(orderPool, nftMintKp.publicKey),
      tickIds: [tickId],
      tickArrays,
    });
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
    const rewardPool = await initializeStaticPool(svm, client, market, {
      configArgs: {
        ...defaultStaticConfigArgs(),
        extensions: encodePoolExtensions([PoolExtension.LiquidityMining]),
      },
    });
    const opened = await openFundedPosition(svm, client, market, rewardPool, [
      RANGE,
    ]);

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
    const before = getTokenAmount(svm, ownerReward);
    const { tx } = await client.reward.claimReward({
      pool: rewardPool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: delegate.publicKey,
      rewardMint,
      userTokenAccount: ownerReward,
      rewardIndex: 0,
      bitmap: liquidityBitmap([0]),
      tickRanges: [RANGE],
    });
    sendTransaction(svm, tx, [delegate]);
    expect(big(getTokenAmount(svm, ownerReward))).toBeGreaterThan(big(before));
  });

  it("expands and removes ranges with the owner as rent receiver", async () => {
    const opened = await openFundedPosition(svm, client, market, pool, [RANGE]);
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
      parameters: { bitmap: liquidityBitmap([1]), expectedLayoutVersion: null },
    };
    await expect(
      client.position.removePosition({
        ...removal,
        rentReceiver: delegate.publicKey,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidPermission });

    const { tx } = await client.position.removePosition(removal);
    sendTransaction(svm, tx, [delegate]);
    const remaining = await client.state.decodePositions(opened.position);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tickLowerId).toBe(RANGE.tickLowerId);
  });

  it("refreshes fees and rewards without any permission bit", async () => {
    const opened = await openFundedPosition(svm, client, market, pool, [RANGE]);
    approveNftDelegate(svm, {
      nftAccount: opened.nftAccount,
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    expect(
      (await client.state.fetchPositionArray(opened.position))
        .delegatePermission,
    ).toBe(0);
    const { tx } = await client.position.refreshFeesAndRewards({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: delegate.publicKey,
      bitmap: liquidityBitmap([0]),
      tickRanges: [RANGE],
    });
    sendTransaction(svm, tx, [delegate]);
  });
});
