import { BN, type IdlEvents } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildLiquidityShape,
  deriveLimitOrder,
  deriveReserve,
  deriveTickArrayBitmapExtension,
  DlmmProClient,
  getSqrtPriceFromTickId,
  LimitOrderDelegatePermission,
  limitOrderDelegatePermissionMask,
  limitOrderTicksFromShape,
  PoolErrorCode,
  relativeTickFromSlippage,
  StrategyType,
  tickArraysForTickIds,
  type DlmmProTypes,
} from "../src";
import { getExtensionBitmapSetIndicesFromState } from "../src/helpers/codec";
import {
  accountExists,
  big,
  createFundedMarket,
  createSvmConnection,
  defaultStaticConfigArgs,
  findEvent,
  getOrCreateAssociatedTokenAccount,
  getTokenAmount,
  gridWeights,
  initializeStaticPool,
  initializeSVM,
  lpAccounts,
  pushPrice,
  seedPoolLiquidity,
  sendTransaction,
  type Market,
} from "./helpers";

type CancelEvent = IdlEvents<DlmmProTypes>["evtCancelLimitOrder"];

describe("limit orders", () => {
  const svm = initializeSVM();
  const client = new DlmmProClient(createSvmConnection(svm));
  const tickSpacing = 1;
  const askTickId = 2;
  const bidTickId = -2;
  const orderAmount = new BN(100_000);
  // Large enough to fill every order the tests rest near the opening price.
  const sweepAmount = new BN(1_000_000_000);

  let market: Market;

  beforeAll(async () => {
    market = await createFundedMarket({ svm, client });
  });

  async function seededPool(): Promise<PublicKey> {
    const pool = await initializeStaticPool(svm, client, market);
    await seedPoolLiquidity(svm, client, market, pool);
    return pool;
  }

  async function openOrder(args: {
    pool: PublicKey;
    isAskSide: boolean;
    ticks: { id: number; amount: BN }[];
    relativeTick?: {
      spacingAlignedMinTickId: number;
      spacingAlignedMaxTickId: number;
    } | null;
    referral?: PublicKey;
  }) {
    const nftMintKp = Keypair.generate();
    const opened = await client.limitOrder.openLimitOrder({
      pool: args.pool,
      nftMint: nftMintKp.publicKey,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: args.isAskSide ? market.tokenXMint : market.tokenYMint,
      userToken: args.isAskSide ? market.lpTokenX : market.lpTokenY,
      parameters: {
        isAskSide: args.isAskSide,
        maxAmount: args.ticks.reduce(
          (sum, tick) => sum.add(tick.amount),
          new BN(0),
        ),
        relativeTick: args.relativeTick ?? null,
        ticks: args.ticks,
      },
      referral: args.referral,
    });
    sendTransaction(svm, opened.tx, [market.payer, market.lpOwner, nftMintKp]);
    return {
      nftMint: nftMintKp.publicKey,
      tickIds: args.ticks.map((tick) => tick.id),
      limitOrder: opened.limitOrder,
    };
  }

  /** Cancels and closes the order, checking the owner receives what the event reports. */
  async function cancelAndClose(args: {
    pool: PublicKey;
    nftMint: PublicKey;
    tickIds: number[];
    limitOrder: PublicKey;
    referralToken?: PublicKey;
  }): Promise<CancelEvent> {
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx: cancelTx } = await client.limitOrder.cancelLimitOrder({
      ...lpAccounts(market, args.pool, args.nftMint),
      tickIds: args.tickIds,
      referralToken: args.referralToken,
    });
    const cancelled = findEvent(
      sendTransaction(svm, cancelTx, [market.lpOwner]),
      "evtCancelLimitOrder",
    );
    expect({
      x: getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString(),
      y: getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString(),
      tickIds: cancelled.tickIds,
    }).toEqual({
      x: cancelled.ownerAmountX.toString(),
      y: cancelled.ownerAmountY.toString(),
      tickIds: args.tickIds,
    });

    const { tx: closeTx } = await client.limitOrder.closeLimitOrder({
      pool: args.pool,
      nftMint: args.nftMint,
      owner: market.lpOwner.publicKey,
      rentReceiver: market.lpOwner.publicKey,
    });
    sendTransaction(svm, closeTx, [market.lpOwner]);
    expect(accountExists(svm, args.limitOrder)).toBe(false);
    return cancelled;
  }

  /** A fully filled ask returns no X but its fee share, and Y for the fill. */
  function expectFilledAsk(cancelled: CancelEvent, limitOrderFee: BN) {
    expect(big(limitOrderFee)).toBeGreaterThan(0n);
    expect(cancelled.ownerFeeX.toString()).toBe(limitOrderFee.toString());
    expect(cancelled.ownerAmountX.toString()).toBe(limitOrderFee.toString());
    expect(big(cancelled.ownerAmountY)).toBeGreaterThan(0n);
  }

  it("opens, updates permission, cancels, and closes an unfilled ask", async () => {
    const pool = await seededPool();
    const reserveBefore = getTokenAmount(
      svm,
      deriveReserve(market.tokenXMint, pool),
    );
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: askTickId, amount: orderAmount }],
    });

    expect(opened.limitOrder.toBase58()).toBe(
      deriveLimitOrder(opened.nftMint).toBase58(),
    );
    expect(
      getTokenAmount(svm, deriveReserve(market.tokenXMint, pool))
        .sub(reserveBefore)
        .eq(orderAmount),
    ).toBe(true);

    const permission = limitOrderDelegatePermissionMask([
      LimitOrderDelegatePermission.CancelLimitOrder,
    ]);
    const { tx: permTx } =
      await client.limitOrder.updateLimitOrderDelegatePermission({
        nftMint: opened.nftMint,
        owner: market.lpOwner.publicKey,
        permission,
      });
    sendTransaction(svm, permTx, [market.lpOwner]);
    expect(
      (await client.state.fetchLimitOrder(opened.limitOrder))
        .delegatePermission,
    ).toBe(permission);

    const cancelled = await cancelAndClose({ pool, ...opened });
    expect(cancelled.ownerAmountX.toString()).toBe(orderAmount.toString());
    expect(cancelled.ownerAmountY.toString()).toBe("0");
  });

  it("opens, cancels, and closes an unfilled bid", async () => {
    const pool = await seededPool();
    const reserveBefore = getTokenAmount(
      svm,
      deriveReserve(market.tokenYMint, pool),
    );
    const opened = await openOrder({
      pool,
      isAskSide: false,
      ticks: [{ id: bidTickId, amount: orderAmount }],
    });
    expect(
      getTokenAmount(svm, deriveReserve(market.tokenYMint, pool))
        .sub(reserveBefore)
        .eq(orderAmount),
    ).toBe(true);

    const cancelled = await cancelAndClose({ pool, ...opened });
    expect(cancelled.ownerAmountX.toString()).toBe("0");
    expect(cancelled.ownerAmountY.toString()).toBe(orderAmount.toString());
  });

  it("fills an ask via swap then collects Y on cancel", async () => {
    const pool = await seededPool();
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: askTickId, amount: orderAmount }],
    });
    const { limitOrderFee } = findEvent(
      await pushPrice(svm, client, market, pool, "up", sweepAmount),
      "evtSwap",
    );

    expectFilledAsk(await cancelAndClose({ pool, ...opened }), limitOrderFee);
  });

  it("fills a bid via swap then collects X on cancel", async () => {
    const pool = await seededPool();
    const opened = await openOrder({
      pool,
      isAskSide: false,
      ticks: [{ id: bidTickId, amount: orderAmount }],
    });
    const { limitOrderFee } = findEvent(
      await pushPrice(svm, client, market, pool, "down", sweepAmount),
      "evtSwap",
    );

    const cancelled = await cancelAndClose({ pool, ...opened });
    expect(big(limitOrderFee)).toBeGreaterThan(0n);
    expect(cancelled.ownerFeeY.toString()).toBe(limitOrderFee.toString());
    expect(cancelled.ownerAmountY.toString()).toBe(limitOrderFee.toString());
    expect(big(cancelled.ownerAmountX)).toBeGreaterThan(0n);
  });

  it("cancels a partially filled ask for leftover X and filled Y", async () => {
    const pool = await seededPool();
    const amount = new BN(1_000_000_000);
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: askTickId, amount }],
    });
    const { limitOrderFee } = findEvent(
      await pushPrice(svm, client, market, pool, "up", new BN(100_000_000)),
      "evtSwap",
    );

    const cancelled = await cancelAndClose({ pool, ...opened });
    expect(big(limitOrderFee)).toBeGreaterThan(0n);
    expect(cancelled.ownerFeeX.toString()).toBe(limitOrderFee.toString());
    const leftover = cancelled.ownerAmountX.sub(cancelled.ownerFeeX);
    expect(big(leftover)).toBeGreaterThan(0n);
    expect(big(leftover)).toBeLessThan(big(amount));
    expect(big(cancelled.ownerAmountY)).toBeGreaterThan(0n);
  });

  it("opens, fills, and cancels a multi-tick ask", async () => {
    const pool = await seededPool();
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [2, 3, 4].map((id) => ({ id, amount: orderAmount })),
    });
    expect(
      (await client.state.decodeLimitOrderData(opened.limitOrder)).length,
    ).toBe(opened.tickIds.length);

    const { limitOrderFee } = findEvent(
      await pushPrice(svm, client, market, pool, "up", sweepAmount),
      "evtSwap",
    );

    expectFilledAsk(await cancelAndClose({ pool, ...opened }), limitOrderFee);
  });

  it("opens an ask from a relative tick offset", async () => {
    const pool = await seededPool();
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: askTickId, amount: orderAmount }],
      relativeTick: {
        spacingAlignedMinTickId: -10,
        spacingAlignedMaxTickId: 10,
      },
    });
    const legs = await client.state.decodeLimitOrderData(opened.limitOrder);
    expect(legs[0].tickId).toBe(askTickId);

    const { limitOrderFee } = findEvent(
      await pushPrice(svm, client, market, pool, "up", sweepAmount),
      "evtSwap",
    );

    expectFilledAsk(await cancelAndClose({ pool, ...opened }), limitOrderFee);
  });

  it("cancels every remaining tick and closes without listing ticks", async () => {
    const pool = await seededPool();
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [2, 3, 4].map((id) => ({ id, amount: orderAmount })),
    });
    const cancelArgs = lpAccounts(market, pool, opened.nftMint);

    const { tx: cancelTx } =
      await client.limitOrder.cancelLimitOrder(cancelArgs);
    const cancelled = findEvent(
      sendTransaction(svm, cancelTx, [market.lpOwner]),
      "evtCancelLimitOrder",
    );
    expect(cancelled.tickIds).toEqual(opened.tickIds);
    expect(cancelled.ownerAmountX.toString()).toBe(
      orderAmount.muln(3).toString(),
    );
    await expect(
      client.limitOrder.cancelLimitOrder(cancelArgs),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });

    const { tx: closeTx } = await client.limitOrder.closeLimitOrder({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      rentReceiver: market.lpOwner.publicKey,
    });
    sendTransaction(svm, closeTx, [market.lpOwner]);
    expect(accountExists(svm, opened.limitOrder)).toBe(false);
  });

  it("pays the referral its cut of a filled order's fee on cancel", async () => {
    const pool = await seededPool();
    const referral = Keypair.generate().publicKey;
    const referralToken = getOrCreateAssociatedTokenAccount(
      svm,
      market.payer,
      market.tokenXMint,
      referral,
    );
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: askTickId, amount: orderAmount }],
      referral,
    });
    const { limitOrderFee } = findEvent(
      await pushPrice(svm, client, market, pool, "up", sweepAmount),
      "evtSwap",
    );

    const referralBefore = getTokenAmount(svm, referralToken);
    const cancelled = await cancelAndClose({ pool, ...opened, referralToken });
    expect(big(cancelled.referralFee)).toBeGreaterThan(0n);
    expect(cancelled.referralFeesOnTokenX).toBe(true);
    expect(
      getTokenAmount(svm, referralToken).sub(referralBefore).toString(),
    ).toBe(cancelled.referralFee.toString());
    expect(cancelled.ownerFeeX.add(cancelled.referralFee).toString()).toBe(
      limitOrderFee.toString(),
    );
  });

  it("passes the bitmap extension for an ask outside the inline bitmap", async () => {
    const pool = await seededPool();
    const { tx: extTx } = await client.pool.initializeTickBitmapExtension({
      pool,
      funder: market.payer.publicKey,
    });
    sendTransaction(svm, extTx, [market.payer]);
    const extension = deriveTickArrayBitmapExtension(pool);
    const outerTickId = 65_600;

    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: outerTickId, amount: orderAmount }],
    });
    expect(
      getExtensionBitmapSetIndicesFromState(
        await client.state.fetchTickArrayBitmapExtension(extension),
      ),
    ).toContain(512);

    await cancelAndClose({ pool, ...opened });
    expect(
      getExtensionBitmapSetIndicesFromState(
        await client.state.fetchTickArrayBitmapExtension(extension),
      ),
    ).not.toContain(512);
  });

  it("omits an uninitialized extension when a relative band crosses the inline bitmap", async () => {
    // Tick array 511 is the last inline one; the band reaches into 512.
    const pool = await initializeStaticPool(svm, client, market, {
      initialSqrtPrice: getSqrtPriceFromTickId(65_500),
    });
    const poolState = await client.state.fetchPool(pool);
    expect(poolState.isBitmapExtensionInitialized).toBe(0);

    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: askTickId, amount: orderAmount }],
      relativeTick: {
        spacingAlignedMinTickId: 65_490,
        spacingAlignedMaxTickId: 65_600,
      },
    });
    const legs = await client.state.decodeLimitOrderData(opened.limitOrder);
    expect(legs[0].tickId).toBe(poolState.tickCurrentId + askTickId);
  });

  it("rejects ticks off the pool spacing and accepts an aligned relative band", async () => {
    const spacing = 10;
    const pool = await initializeStaticPool(svm, client, market, {
      configArgs: { ...defaultStaticConfigArgs(), tickSpacing: spacing },
    });
    await seedPoolLiquidity(svm, client, market, pool, [
      { tickLowerId: -200, tickUpperId: 200 },
    ]);
    const openArgs = {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: market.tokenXMint,
      userToken: market.lpTokenX,
    };

    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        nftMint: Keypair.generate().publicKey,
        parameters: {
          isAskSide: true,
          maxAmount: orderAmount,
          relativeTick: {
            spacingAlignedMinTickId: -15,
            spacingAlignedMaxTickId: 20,
          },
          ticks: [{ id: 1, amount: orderAmount }],
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        nftMint: Keypair.generate().publicKey,
        parameters: {
          isAskSide: true,
          maxAmount: orderAmount,
          relativeTick: null,
          ticks: [{ id: 5, amount: orderAmount }],
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });

    const { tickCurrentId } = await client.state.fetchPool(pool);
    const relativeTick = relativeTickFromSlippage({
      currentTickId: tickCurrentId,
      tickSpacing: spacing,
      slippageTicks: 20,
    });
    expect(relativeTick).toEqual({
      spacingAlignedMinTickId: -20,
      spacingAlignedMaxTickId: 20,
    });
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: 1, amount: orderAmount }],
      relativeTick,
    });
    const legs = await client.state.decodeLimitOrderData(opened.limitOrder);
    expect(legs.map((leg) => leg.tickId)).toEqual([spacing]);
  });

  it("requires the relative slippage to be a multiple of the spacing", () => {
    expect(() =>
      relativeTickFromSlippage({
        currentTickId: 0,
        tickSpacing: 10,
        slippageTicks: 15,
      }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });

  describe("strategy shapes", () => {
    const unitAmount = new BN(10_000);
    const shapeArgs = {
      minTickId: -20,
      maxTickId: 20,
      tickSpacing: 10,
      currentTickId: 0,
    };

    it.each([
      { name: "Spot", strategy: StrategyType.Spot },
      { name: "Curve", strategy: StrategyType.Curve },
      { name: "BidAsk", strategy: StrategyType.BidAsk },
      {
        name: "Custom",
        strategy: StrategyType.Custom,
        weights: gridWeights(-20, 10, [4, 3, 2, 1, 1]),
      },
      {
        name: "Custom with a zero gap",
        strategy: StrategyType.Custom,
        weights: gridWeights(-20, 10, [3, 2, 0, 2, 3]),
      },
    ])(
      "opens bid and ask ladders from a $name shape",
      async ({ strategy, weights }) => {
        const pool = await seededPool();
        const shape = buildLiquidityShape({
          strategy,
          ...shapeArgs,
          weights,
        });
        const ask = limitOrderTicksFromShape({
          shape,
          side: "ask",
          unitAmount,
        });
        const bid = limitOrderTicksFromShape({
          shape,
          side: "bid",
          unitAmount,
        });

        const openedAsk = await openOrder({
          pool,
          isAskSide: true,
          ticks: ask.ticks,
        });
        const openedBid = await openOrder({
          pool,
          isAskSide: false,
          ticks: bid.ticks,
        });

        const askLegs = await client.state.decodeLimitOrderData(
          openedAsk.limitOrder,
        );
        const bidLegs = await client.state.decodeLimitOrderData(
          openedBid.limitOrder,
        );
        expect(askLegs.map((leg) => leg.tickId)).toEqual(openedAsk.tickIds);
        expect(askLegs.map((leg) => leg.amount.toString())).toEqual(
          ask.ticks.map((tick) => tick.amount.toString()),
        );
        expect(bidLegs.map((leg) => leg.tickId)).toEqual(openedBid.tickIds);
        expect(bidLegs.map((leg) => leg.amount.toString())).toEqual(
          bid.ticks.map((tick) => tick.amount.toString()),
        );

        await cancelAndClose({ pool, ...openedAsk });
        await cancelAndClose({ pool, ...openedBid });
      },
    );

    it("opens a relative Curve ask from the same shape columns", async () => {
      const pool = await seededPool();
      const shape = buildLiquidityShape({
        strategy: StrategyType.Curve,
        minTickId: -2,
        maxTickId: 2,
        tickSpacing,
        currentTickId: 0,
      });
      const ask = limitOrderTicksFromShape({
        shape,
        side: "ask",
        unitAmount,
        relative: true,
      });
      expect(ask.ticks.map((tick) => tick.id)).toEqual([1, 2]);

      const opened = await openOrder({
        pool,
        isAskSide: true,
        ticks: ask.ticks,
        relativeTick: {
          spacingAlignedMinTickId: -20,
          spacingAlignedMaxTickId: 20,
        },
      });
      const legs = await client.state.decodeLimitOrderData(opened.limitOrder);
      expect(legs.map((leg) => leg.tickId)).toEqual([1, 2]);
      expect(legs.map((leg) => leg.amount.toString())).toEqual(
        ask.ticks.map((tick) => tick.amount.toString()),
      );

      await cancelAndClose({ pool, ...opened });
    });

    it("opens a one-sided Curve ask above the market", async () => {
      const pool = await seededPool();
      const shape = buildLiquidityShape({
        strategy: StrategyType.Curve,
        minTickId: 20,
        maxTickId: 60,
        tickSpacing: 10,
        currentTickId: 0,
      });
      expect(() =>
        limitOrderTicksFromShape({
          shape,
          side: "bid",
          unitAmount,
        }),
      ).toThrow(
        expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
      );

      const ask = limitOrderTicksFromShape({
        shape,
        side: "ask",
        unitAmount,
      });
      expect(ask.ticks[0].id).toBeGreaterThanOrEqual(0);

      const opened = await openOrder({
        pool,
        isAskSide: true,
        ticks: ask.ticks,
      });
      expect(
        (await client.state.decodeLimitOrderData(opened.limitOrder)).map(
          (leg) => leg.tickId,
        ),
      ).toEqual(opened.tickIds);

      await cancelAndClose({ pool, ...opened });
    });

    it("opens a one-sided Curve bid below the market", async () => {
      const pool = await seededPool();
      const shape = buildLiquidityShape({
        strategy: StrategyType.Curve,
        minTickId: -60,
        maxTickId: -20,
        tickSpacing: 10,
        currentTickId: 0,
      });
      expect(() =>
        limitOrderTicksFromShape({
          shape,
          side: "ask",
          unitAmount,
        }),
      ).toThrow(
        expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
      );

      const bid = limitOrderTicksFromShape({
        shape,
        side: "bid",
        unitAmount,
      });
      expect(bid.ticks[bid.ticks.length - 1].id).toBeLessThanOrEqual(0);

      const opened = await openOrder({
        pool,
        isAskSide: false,
        ticks: bid.ticks,
      });
      expect(
        (await client.state.decodeLimitOrderData(opened.limitOrder)).map(
          (leg) => leg.tickId,
        ),
      ).toEqual(opened.tickIds);

      await cancelAndClose({ pool, ...opened });
    });

    it("rests a bid on the active tick when includeActiveTick is set", async () => {
      const pool = await seededPool();
      const shape = buildLiquidityShape({
        strategy: StrategyType.Curve,
        ...shapeArgs,
      });
      const bid = limitOrderTicksFromShape({
        shape,
        side: "bid",
        unitAmount,
        includeActiveTick: true,
      });
      expect(bid.ticks[bid.ticks.length - 1].id).toBe(0);

      const opened = await openOrder({
        pool,
        isAskSide: false,
        ticks: bid.ticks,
      });
      expect(
        (await client.state.decodeLimitOrderData(opened.limitOrder)).map(
          (leg) => leg.tickId,
        ),
      ).toEqual(opened.tickIds);

      await cancelAndClose({ pool, ...opened });
    });
  });

  it("rejects empty, unsorted, and zero-amount ticks", async () => {
    const pool = await initializeStaticPool(svm, client, market);
    const openArgs = {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: market.tokenXMint,
      userToken: market.lpTokenX,
      tickArrays: tickArraysForTickIds(pool, [2, 3, 4], tickSpacing),
    };
    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        nftMint: Keypair.generate().publicKey,
        parameters: {
          isAskSide: true,
          maxAmount: orderAmount,
          relativeTick: null,
          ticks: [],
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        nftMint: Keypair.generate().publicKey,
        parameters: {
          isAskSide: true,
          maxAmount: orderAmount.muln(2),
          relativeTick: null,
          ticks: [
            { id: 4, amount: orderAmount },
            { id: 2, amount: orderAmount },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        nftMint: Keypair.generate().publicKey,
        parameters: {
          isAskSide: true,
          maxAmount: orderAmount,
          relativeTick: null,
          ticks: [{ id: 2, amount: new BN(0) }],
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
  });

  it("rejects non-increasing cancel tick ids client-side", async () => {
    const cancelArgs = {
      ...lpAccounts(
        market,
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
      ),
      tickArrays: [],
    };
    await expect(
      client.limitOrder.cancelLimitOrder({ ...cancelArgs, tickIds: [] }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      client.limitOrder.cancelLimitOrder({ ...cancelArgs, tickIds: [4, 2] }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      client.limitOrder.cancelLimitOrder({ ...cancelArgs, tickIds: [2, 2] }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
  });
});
