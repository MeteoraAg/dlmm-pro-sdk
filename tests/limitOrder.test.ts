import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildLiquidityShape,
  customWeightsFromGrid,
  delegatePermissionMask,
  deriveLimitOrder,
  deriveReserve,
  DlmmProClient,
  getSqrtPriceFromTickId,
  LimitOrderDelegatePermission,
  limitOrderTicksFromShape,
  StrategyType,
  tickArraysForRanges,
} from "../src";
import {
  accountExists,
  big,
  createFundedMarket,
  createSvmConnection,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  seedPoolLiquidity,
  sendTransaction,
  sendTransactionExpectingError,
  swap,
} from "./helpers";

describe("limit orders", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const tickSpacing = 1;
  const askTickId = 2;
  const bidTickId = -2;
  const orderAmount = new BN(100_000);

  let market: Awaited<ReturnType<typeof createFundedMarket>>;

  beforeAll(async () => {
    market = await createFundedMarket({ svm, client });
  });

  async function newPool() {
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
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
    return { pool, seeded };
  }

  async function openOrder(args: {
    pool: PublicKey;
    isAskSide: boolean;
    ticks: { id: number; amount: BN }[];
    maxAmount?: BN;
    relativeTick?: { minSqrtPrice: BN; maxSqrtPrice: BN } | null;
    resolvedTickIds?: number[];
  }) {
    const nftMintKp = Keypair.generate();
    const tickIds = args.resolvedTickIds ?? args.ticks.map((tick) => tick.id);
    const tickArrays = tickArraysForRanges(
      args.pool,
      tickIds.map((id) => ({ tickLowerId: id, tickUpperId: id })),
      tickSpacing,
    );
    const opened = await client.limitOrder.openLimitOrder({
      pool: args.pool,
      nftMint: nftMintKp.publicKey,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: args.isAskSide ? market.tokenXMint : market.tokenYMint,
      userToken: args.isAskSide ? market.lpTokenX : market.lpTokenY,
      parameters: {
        isAskSide: args.isAskSide,
        maxAmount:
          args.maxAmount ??
          args.ticks.reduce((sum, tick) => sum.add(tick.amount), new BN(0)),
        relativeTick: args.relativeTick ?? null,
        ticks: args.ticks,
      },
      tickArrays,
    });
    sendTransaction(svm, opened.tx, [market.payer, market.lpOwner, nftMintKp]);
    return {
      nftMintKp,
      tickArrays,
      tickIds,
      limitOrder: opened.limitOrder,
      nftAccount: opened.nftAccount,
    };
  }

  async function cancelAndClose(args: {
    pool: PublicKey;
    nftMint: PublicKey;
    tickIds: number[];
    tickArrays: PublicKey[];
    limitOrder: PublicKey;
  }) {
    const { tx: cancelTx } = await client.limitOrder.cancelLimitOrder({
      pool: args.pool,
      nftMint: args.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickIds: args.tickIds,
      tickArrays: args.tickArrays,
    });
    sendTransaction(svm, cancelTx, [market.lpOwner]);

    const { tx: closeTx } = await client.limitOrder.closeLimitOrder({
      pool: args.pool,
      nftMint: args.nftMint,
      owner: market.lpOwner.publicKey,
      rentReceiver: market.lpOwner.publicKey,
      tickArrays: args.tickArrays,
    });
    sendTransaction(svm, closeTx, [market.lpOwner]);
    expect(accountExists(svm, args.limitOrder)).toBe(false);
  }

  async function swapThroughTicks(
    pool: PublicKey,
    args: { buyX: boolean; inputAmount: BN },
  ) {
    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: args.buyX ? market.swapperTokenY : market.swapperTokenX,
      userTokenOut: args.buyX ? market.swapperTokenX : market.swapperTokenY,
      inputAmount: args.inputAmount,
    });
  }

  it("opens, updates permission, cancels, and closes an unfilled ask", async () => {
    const { pool } = await newPool();
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
      deriveLimitOrder(opened.nftMintKp.publicKey).toBase58(),
    );
    expect(accountExists(svm, opened.limitOrder)).toBe(true);
    expect(
      getTokenAmount(svm, deriveReserve(market.tokenXMint, pool)).gt(
        reserveBefore,
      ),
    ).toBe(true);

    const permission = delegatePermissionMask([
      LimitOrderDelegatePermission.CancelLimitOrder,
    ]);
    const { tx: permTx } =
      await client.limitOrder.updateLimitOrderDelegatePermission({
        limitOrder: opened.limitOrder,
        nftAccount: opened.nftAccount,
        owner: market.lpOwner.publicKey,
        permission,
      });
    sendTransaction(svm, permTx, [market.lpOwner]);
    expect(
      (await client.state.fetchLimitOrder(opened.limitOrder))
        .delegatePermission,
    ).toBe(permission);

    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    await cancelAndClose({
      pool,
      nftMint: opened.nftMintKp.publicKey,
      tickIds: opened.tickIds,
      tickArrays: opened.tickArrays,
      limitOrder: opened.limitOrder,
    });
    expect(
      getTokenAmount(svm, market.lpTokenX).sub(xBefore).eq(orderAmount),
    ).toBe(true);
    expect(getTokenAmount(svm, market.lpTokenY).toString()).toBe(
      yBefore.toString(),
    );
  });

  it("opens, cancels, and closes an unfilled bid", async () => {
    const { pool } = await newPool();
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

    const yBefore = getTokenAmount(svm, market.lpTokenY);
    await cancelAndClose({
      pool,
      nftMint: opened.nftMintKp.publicKey,
      tickIds: opened.tickIds,
      tickArrays: opened.tickArrays,
      limitOrder: opened.limitOrder,
    });
    expect(
      getTokenAmount(svm, market.lpTokenY).sub(yBefore).eq(orderAmount),
    ).toBe(true);
  });

  it("fills an ask via swap then collects Y on cancel", async () => {
    const { pool, seeded } = await newPool();
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: askTickId, amount: orderAmount }],
    });
    await swapThroughTicks(pool, {
      buyX: true,
      inputAmount: new BN(1_000_000_000),
    });

    const yBefore = getTokenAmount(svm, market.lpTokenY);
    await cancelAndClose({
      pool,
      nftMint: opened.nftMintKp.publicKey,
      tickIds: opened.tickIds,
      tickArrays: opened.tickArrays,
      limitOrder: opened.limitOrder,
    });
    expect(big(getTokenAmount(svm, market.lpTokenY))).toBeGreaterThan(
      big(yBefore),
    );
  });

  it("fills a bid via swap then collects X on cancel", async () => {
    const { pool, seeded } = await newPool();
    const opened = await openOrder({
      pool,
      isAskSide: false,
      ticks: [{ id: bidTickId, amount: orderAmount }],
    });
    await swapThroughTicks(pool, {
      buyX: false,
      inputAmount: new BN(1_000_000_000),
    });

    const xBefore = getTokenAmount(svm, market.lpTokenX);
    await cancelAndClose({
      pool,
      nftMint: opened.nftMintKp.publicKey,
      tickIds: opened.tickIds,
      tickArrays: opened.tickArrays,
      limitOrder: opened.limitOrder,
    });
    expect(big(getTokenAmount(svm, market.lpTokenX))).toBeGreaterThan(
      big(xBefore),
    );
  });

  it("cancels a partially filled ask for leftover X and filled Y", async () => {
    const { pool, seeded } = await newPool();
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: askTickId, amount: new BN(1_000_000_000) }],
    });
    await swapThroughTicks(pool, {
      buyX: true,
      inputAmount: new BN(100_000_000),
    });

    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    await cancelAndClose({
      pool,
      nftMint: opened.nftMintKp.publicKey,
      tickIds: opened.tickIds,
      tickArrays: opened.tickArrays,
      limitOrder: opened.limitOrder,
    });
    expect(big(getTokenAmount(svm, market.lpTokenX))).toBeGreaterThan(
      big(xBefore),
    );
    expect(big(getTokenAmount(svm, market.lpTokenY))).toBeGreaterThan(
      big(yBefore),
    );
  });

  it("opens, fills, and cancels a multi-tick ask", async () => {
    const { pool, seeded } = await newPool();
    const tickIds = [2, 3, 4];
    const perTick = new BN(100_000);
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: tickIds.map((id) => ({ id, amount: perTick })),
    });
    expect(
      (await client.state.decodeLimitOrderData(opened.limitOrder)).length,
    ).toBe(tickIds.length);

    await swapThroughTicks(pool, {
      buyX: true,
      inputAmount: new BN(1_000_000_000),
    });

    const yBefore = getTokenAmount(svm, market.lpTokenY);
    await cancelAndClose({
      pool,
      nftMint: opened.nftMintKp.publicKey,
      tickIds,
      tickArrays: opened.tickArrays,
      limitOrder: opened.limitOrder,
    });
    expect(big(getTokenAmount(svm, market.lpTokenY))).toBeGreaterThan(
      big(yBefore),
    );
  });

  it("opens an ask from a relative tick offset", async () => {
    const { pool, seeded } = await newPool();
    const opened = await openOrder({
      pool,
      isAskSide: true,
      ticks: [{ id: 2, amount: orderAmount }],
      relativeTick: {
        minSqrtPrice: getSqrtPriceFromTickId(-10),
        maxSqrtPrice: getSqrtPriceFromTickId(10),
      },
    });
    const legs = await client.state.decodeLimitOrderData(opened.limitOrder);
    expect(legs[0].tickId).toBe(2);

    await swapThroughTicks(pool, {
      buyX: true,
      inputAmount: new BN(1_000_000_000),
    });

    const yBefore = getTokenAmount(svm, market.lpTokenY);
    await cancelAndClose({
      pool,
      nftMint: opened.nftMintKp.publicKey,
      tickIds: [2],
      tickArrays: opened.tickArrays,
      limitOrder: opened.limitOrder,
    });
    expect(big(getTokenAmount(svm, market.lpTokenY))).toBeGreaterThan(
      big(yBefore),
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
        weights: customWeightsFromGrid(-20, 10, [4, 3, 2, 1, 1]),
      },
      {
        name: "Custom with a zero gap",
        strategy: StrategyType.Custom,
        weights: customWeightsFromGrid(-20, 10, [3, 2, 0, 2, 3]),
      },
    ])(
      "opens bid and ask ladders from a $name shape",
      async ({ strategy, weights }) => {
        const { pool } = await newPool();
        const shape = buildLiquidityShape({
          strategy,
          ...shapeArgs,
          weights,
        });
        const ask = limitOrderTicksFromShape({
          shape,
          side: "ask",
          unitAmount,
          poolTickSpacing: tickSpacing,
        });
        const bid = limitOrderTicksFromShape({
          shape,
          side: "bid",
          unitAmount,
          poolTickSpacing: tickSpacing,
        });

        const openedAsk = await openOrder({
          pool,
          isAskSide: true,
          ticks: ask.ticks,
          resolvedTickIds: ask.resolvedTickIds,
        });
        const openedBid = await openOrder({
          pool,
          isAskSide: false,
          ticks: bid.ticks,
          resolvedTickIds: bid.resolvedTickIds,
        });

        const askLegs = await client.state.decodeLimitOrderData(
          openedAsk.limitOrder,
        );
        const bidLegs = await client.state.decodeLimitOrderData(
          openedBid.limitOrder,
        );
        expect(askLegs.map((leg) => leg.tickId)).toEqual(ask.resolvedTickIds);
        expect(askLegs.map((leg) => leg.amount.toString())).toEqual(
          ask.ticks.map((tick) => tick.amount.toString()),
        );
        expect(bidLegs.map((leg) => leg.tickId)).toEqual(bid.resolvedTickIds);
        expect(bidLegs.map((leg) => leg.amount.toString())).toEqual(
          bid.ticks.map((tick) => tick.amount.toString()),
        );

        await cancelAndClose({
          pool,
          nftMint: openedAsk.nftMintKp.publicKey,
          tickIds: ask.resolvedTickIds,
          tickArrays: openedAsk.tickArrays,
          limitOrder: openedAsk.limitOrder,
        });
        await cancelAndClose({
          pool,
          nftMint: openedBid.nftMintKp.publicKey,
          tickIds: bid.resolvedTickIds,
          tickArrays: openedBid.tickArrays,
          limitOrder: openedBid.limitOrder,
        });
      },
    );

    it("opens a relative Curve ask from the same shape columns", async () => {
      const { pool } = await newPool();
      const shape = buildLiquidityShape({
        strategy: StrategyType.Curve,
        ...shapeArgs,
      });
      const ask = limitOrderTicksFromShape({
        shape,
        side: "ask",
        unitAmount,
        relative: true,
        poolTickSpacing: tickSpacing,
      });
      expect(ask.ticks.map((tick) => tick.id)).toEqual([10, 20]);

      const opened = await openOrder({
        pool,
        isAskSide: true,
        ticks: ask.ticks,
        resolvedTickIds: ask.resolvedTickIds,
        relativeTick: {
          minSqrtPrice: getSqrtPriceFromTickId(-20),
          maxSqrtPrice: getSqrtPriceFromTickId(20),
        },
      });
      const legs = await client.state.decodeLimitOrderData(opened.limitOrder);
      expect(legs.map((leg) => leg.tickId)).toEqual([10, 20]);
      expect(legs.map((leg) => leg.amount.toString())).toEqual(
        ask.ticks.map((tick) => tick.amount.toString()),
      );

      await cancelAndClose({
        pool,
        nftMint: opened.nftMintKp.publicKey,
        tickIds: ask.resolvedTickIds,
        tickArrays: opened.tickArrays,
        limitOrder: opened.limitOrder,
      });
    });

    it("opens a one-sided Curve ask above the market", async () => {
      const { pool } = await newPool();
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
          poolTickSpacing: tickSpacing,
        }),
      ).toThrow();

      const ask = limitOrderTicksFromShape({
        shape,
        side: "ask",
        unitAmount,
        poolTickSpacing: tickSpacing,
      });
      expect(ask.resolvedTickIds[0]).toBeGreaterThanOrEqual(0);

      const opened = await openOrder({
        pool,
        isAskSide: true,
        ticks: ask.ticks,
        resolvedTickIds: ask.resolvedTickIds,
      });
      expect(
        (await client.state.decodeLimitOrderData(opened.limitOrder)).map(
          (leg) => leg.tickId,
        ),
      ).toEqual(ask.resolvedTickIds);

      await cancelAndClose({
        pool,
        nftMint: opened.nftMintKp.publicKey,
        tickIds: ask.resolvedTickIds,
        tickArrays: opened.tickArrays,
        limitOrder: opened.limitOrder,
      });
    });

    it("opens a one-sided Curve bid below the market", async () => {
      const { pool } = await newPool();
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
          poolTickSpacing: tickSpacing,
        }),
      ).toThrow();

      const bid = limitOrderTicksFromShape({
        shape,
        side: "bid",
        unitAmount,
        poolTickSpacing: tickSpacing,
      });
      expect(
        bid.resolvedTickIds[bid.resolvedTickIds.length - 1],
      ).toBeLessThanOrEqual(0);

      const opened = await openOrder({
        pool,
        isAskSide: false,
        ticks: bid.ticks,
        resolvedTickIds: bid.resolvedTickIds,
      });
      expect(
        (await client.state.decodeLimitOrderData(opened.limitOrder)).map(
          (leg) => leg.tickId,
        ),
      ).toEqual(bid.resolvedTickIds);

      await cancelAndClose({
        pool,
        nftMint: opened.nftMintKp.publicKey,
        tickIds: bid.resolvedTickIds,
        tickArrays: opened.tickArrays,
        limitOrder: opened.limitOrder,
      });
    });

    it("rests a bid on the active tick but rejects an ask there", async () => {
      const { pool } = await newPool();
      const shape = buildLiquidityShape({
        strategy: StrategyType.Curve,
        ...shapeArgs,
      });
      // asks must sit strictly above the active tick on-chain, so
      // includeActiveTick never adds the active column on the ask side
      const ask = limitOrderTicksFromShape({
        shape,
        side: "ask",
        unitAmount,
        includeActiveTick: true,
        poolTickSpacing: tickSpacing,
      });
      expect(ask.resolvedTickIds).toEqual([10, 20]);

      const askNft = Keypair.generate();
      const askOnActiveTick = await client.limitOrder.openLimitOrder({
        pool,
        nftMint: askNft.publicKey,
        owner: market.lpOwner.publicKey,
        payer: market.payer.publicKey,
        tokenMint: market.tokenXMint,
        userToken: market.lpTokenX,
        parameters: {
          isAskSide: true,
          maxAmount: unitAmount,
          relativeTick: null,
          ticks: [{ id: 0, amount: unitAmount }],
        },
        tickArrays: tickArraysForRanges(
          pool,
          [{ tickLowerId: 0, tickUpperId: 0 }],
          tickSpacing,
        ),
      });
      sendTransactionExpectingError(
        svm,
        askOnActiveTick.tx,
        [market.payer, market.lpOwner, askNft],
        "InvalidParameters",
      );

      const bid = limitOrderTicksFromShape({
        shape,
        side: "bid",
        unitAmount,
        includeActiveTick: true,
        poolTickSpacing: tickSpacing,
      });
      expect(bid.resolvedTickIds[bid.resolvedTickIds.length - 1]).toBe(0);

      const openedBid = await openOrder({
        pool,
        isAskSide: false,
        ticks: bid.ticks,
        resolvedTickIds: bid.resolvedTickIds,
      });
      expect(
        (await client.state.decodeLimitOrderData(openedBid.limitOrder)).map(
          (leg) => leg.tickId,
        ),
      ).toEqual(bid.resolvedTickIds);

      await cancelAndClose({
        pool,
        nftMint: openedBid.nftMintKp.publicKey,
        tickIds: bid.resolvedTickIds,
        tickArrays: openedBid.tickArrays,
        limitOrder: openedBid.limitOrder,
      });
    });
  });

  it("rejects ask ticks below the active tick and bids above it", async () => {
    const { pool } = await newPool();

    const askNft = Keypair.generate();
    const askBelow = await client.limitOrder.openLimitOrder({
      pool,
      nftMint: askNft.publicKey,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: market.tokenXMint,
      userToken: market.lpTokenX,
      parameters: {
        isAskSide: true,
        maxAmount: orderAmount,
        relativeTick: null,
        ticks: [{ id: -2, amount: orderAmount }],
      },
      tickArrays: tickArraysForRanges(
        pool,
        [{ tickLowerId: -2, tickUpperId: -2 }],
        tickSpacing,
      ),
    });
    sendTransactionExpectingError(
      svm,
      askBelow.tx,
      [market.payer, market.lpOwner, askNft],
      "InvalidParameters",
    );

    const bidNft = Keypair.generate();
    const bidAbove = await client.limitOrder.openLimitOrder({
      pool,
      nftMint: bidNft.publicKey,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: market.tokenYMint,
      userToken: market.lpTokenY,
      parameters: {
        isAskSide: false,
        maxAmount: orderAmount,
        relativeTick: null,
        ticks: [{ id: 2, amount: orderAmount }],
      },
      tickArrays: tickArraysForRanges(
        pool,
        [{ tickLowerId: 2, tickUpperId: 2 }],
        tickSpacing,
      ),
    });
    sendTransactionExpectingError(
      svm,
      bidAbove.tx,
      [market.payer, market.lpOwner, bidNft],
      "InvalidParameters",
    );
  });

  it("rejects empty, unsorted, zero-amount, and slipped relative ticks", async () => {
    const { pool } = await newPool();
    const tickArrays = tickArraysForRanges(
      pool,
      [{ tickLowerId: 2, tickUpperId: 4 }],
      tickSpacing,
    );

    const openArgs = {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: market.tokenXMint,
      userToken: market.lpTokenX,
      tickArrays,
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();

    const slipNft = Keypair.generate();
    const slipped = await client.limitOrder.openLimitOrder({
      pool,
      nftMint: slipNft.publicKey,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tokenMint: market.tokenXMint,
      userToken: market.lpTokenX,
      parameters: {
        isAskSide: true,
        maxAmount: orderAmount,
        relativeTick: {
          minSqrtPrice: getSqrtPriceFromTickId(49),
          maxSqrtPrice: getSqrtPriceFromTickId(51),
        },
        ticks: [{ id: 2, amount: orderAmount }],
      },
      tickArrays,
    });
    sendTransactionExpectingError(
      svm,
      slipped.tx,
      [market.payer, market.lpOwner, slipNft],
      "ExceededSlippage",
    );
  });

  it("rejects non-increasing cancel tick ids client-side", async () => {
    const cancelArgs = {
      pool: Keypair.generate().publicKey,
      nftMint: Keypair.generate().publicKey,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickArrays: [],
    };
    await expect(
      client.limitOrder.cancelLimitOrder({ ...cancelArgs, tickIds: [] }),
    ).rejects.toThrow();
    await expect(
      client.limitOrder.cancelLimitOrder({ ...cancelArgs, tickIds: [4, 2] }),
    ).rejects.toThrow();
    await expect(
      client.limitOrder.cancelLimitOrder({ ...cancelArgs, tickIds: [2, 2] }),
    ).rejects.toThrow();
  });

  it("rejects an off-side transfer hook on open client-side", async () => {
    const hook = [
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: false,
      },
    ];
    const openArgs = {
      pool: Keypair.generate().publicKey,
      nftMint: Keypair.generate().publicKey,
      owner: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      tickArrays: [],
    };
    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        tokenMint: market.tokenXMint,
        userToken: market.lpTokenX,
        parameters: {
          isAskSide: true,
          maxAmount: orderAmount,
          relativeTick: null,
          ticks: [{ id: askTickId, amount: orderAmount }],
        },
        transferHookY: hook,
      }),
    ).rejects.toThrow();
    await expect(
      client.limitOrder.openLimitOrder({
        ...openArgs,
        tokenMint: market.tokenYMint,
        userToken: market.lpTokenY,
        parameters: {
          isAskSide: false,
          maxAmount: orderAmount,
          relativeTick: null,
          ticks: [{ id: bidTickId, amount: orderAmount }],
        },
        transferHookX: hook,
      }),
    ).rejects.toThrow();
  });
});
