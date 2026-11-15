import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildLiquidityShape,
  deriveReserve,
  deriveTickArrayBitmapExtension,
  DlmmProClient,
  encodeAddLiquidityByWeight,
  liquidityBitmap,
  LiquidityLayout,
  multiplierFromAmounts,
  PoolErrorCode,
  PositionDelegatePermission,
  positionDelegatePermissionMask,
  StrategyType,
  tickArraysForTickIds,
} from "../src";
import {
  getFeeGrowthInside,
  getPendingFees,
} from "../src/helpers/position_fees";
import {
  addLiquidity,
  big,
  createFundedMarket,
  createSvmConnection,
  getBitmapSetIndicesFromPool,
  getExtensionBitmapSetIndicesFromState,
  getPositionTotalLiquidity,
  getTokenAmount,
  gridWeights,
  initializeStaticPool,
  initializeSVM,
  lpAccounts,
  openFundedPosition,
  openPosition,
  pushPrice,
  removeLiquidity,
  sendTransaction,
  type Market,
} from "./helpers";

const RANGE_0 = { tickLowerId: -20, tickUpperId: 20 };
const RANGE_1 = { tickLowerId: 128, tickUpperId: 138 };
const RANGE_2 = { tickLowerId: 256, tickUpperId: 266 };
// Tick arrays 512 and 513, past the inline bitmap at tick spacing 1.
const OUTER_RANGE = { tickLowerId: 65536, tickUpperId: 65664 };

describe("position instructions", () => {
  const svm = initializeSVM();
  const client = new DlmmProClient(createSvmConnection(svm));
  const tickSpacing = 1;

  let market: Market;
  let pool: PublicKey;

  beforeAll(async () => {
    market = await createFundedMarket({ svm, client });
    pool = await initializeStaticPool(svm, client, market);
  });

  it("expands and then removes an empty range", async () => {
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE_0],
    });
    const sizeBefore = svm.getAccount(opened.position)!.data.length;

    const expand = await client.position.expandPosition({
      pool,
      signer: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      tickRanges: [RANGE_1],
    });
    sendTransaction(svm, expand.tx, [market.payer, market.lpOwner]);
    expect(svm.getAccount(opened.position)!.data.length).toBeGreaterThan(
      sizeBefore,
    );

    const decoded = await client.state.decodePositions(opened.position);
    expect(decoded).toHaveLength(2);

    const remove = await client.position.removePosition({
      pool,
      signer: market.lpOwner.publicKey,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      rentReceiver: market.lpOwner.publicKey,
      tickRanges: [RANGE_1],
      parameters: {
        bitmap: liquidityBitmap([1]),
        expectedLayoutVersion: null,
      },
    });
    sendTransaction(svm, remove.tx, [market.lpOwner]);
    expect(await client.state.decodePositions(opened.position)).toHaveLength(1);
  });

  it("adds liquidity by weight", async () => {
    const shape = buildLiquidityShape({
      strategy: StrategyType.Spot,
      minTickId: -20,
      maxTickId: 20,
      tickSpacing: 10,
      currentTickId: 0,
    });
    const tickRanges = shape.ranges.map((range) => ({
      tickLowerId: range.tickLowerId,
      tickUpperId: range.tickUpperId,
    }));
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
    });

    const poolState = await client.state.fetchPool(pool);
    const parameters = encodeAddLiquidityByWeight({
      ranges: shape.ranges,
      maxAmountX: new BN(100_000),
      maxAmountY: new BN(100_000),
      multiplier: multiplierFromAmounts({
        ranges: shape.ranges,
        tickSpacing: poolState.tickSpacing,
        currentTickId: poolState.tickCurrentId,
        currentSqrtPrice: poolState.sqrtPrice,
        amountX: new BN(100_000),
        amountY: new BN(100_000),
        mintX: null,
        mintY: null,
        epoch: 0n,
      }),
    });

    const { tx } = await client.position.addLiquidityByWeight({
      ...lpAccounts(market, pool, opened.nftMint),
      tickRanges,
      parameters,
    });
    sendTransaction(svm, tx, [market.lpOwner]);
    expect(
      (await getPositionTotalLiquidity(client, opened.nftMint)).gt(new BN(0)),
    ).toBe(true);
  });

  it("adds imbalanced liquidity spanning the current tick", async () => {
    const range = { tickLowerId: -100, tickUpperId: 100 };
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [range],
    });

    const { tx } = await client.position.addLiquidityImbalance({
      ...lpAccounts(market, pool, opened.nftMint),
      tickRanges: [range],
      parameters: {
        maxAmountX: new BN(100_000),
        maxAmountY: new BN(40_000),
        slippage: { sqrtPriceSlippage: null, minLiquidity: null },
        index: 0,
        expectedLayoutVersion: null,
      },
    });
    sendTransaction(svm, tx, [market.lpOwner]);
    expect(
      (await getPositionTotalLiquidity(client, opened.nftMint)).gt(new BN(0)),
    ).toBe(true);
  });

  it("removes liquidity by bps", async () => {
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_0,
    ]);
    const before = await getPositionTotalLiquidity(client, opened.nftMint);

    const { tx } = await client.position.removeLiquidityByBps({
      ...lpAccounts(market, pool, opened.nftMint),
      tickRanges: [RANGE_0],
      parameters: {
        minAmountX: new BN(0),
        minAmountY: new BN(0),
        expectedLayoutVersion: null,
        bps: 5_000,
        bitmap: null,
      },
    });
    sendTransaction(svm, tx, [market.lpOwner]);

    const after = await getPositionTotalLiquidity(client, opened.nftMint);
    expect(big(after)).toBeLessThan(big(before));
    expect(big(after)).toBeGreaterThan(0n);
  });

  it("locks liquidity permanently and with vesting", async () => {
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_0,
    ]);

    const { tx: vestTx } = await client.position.lockVestingPosition({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      parameters: {
        cliffPoint: null,
        cliffUnlockBps: 5_000,
        bpsPerPeriod: 1_000,
        periodFrequency: new BN(1),
        numberOfPeriod: 5,
        bps: 2_500,
        expectedLayoutVersion: null,
      },
    });
    sendTransaction(svm, vestTx, [market.lpOwner]);

    const { tx: lockTx } = await client.position.lockPermanentPosition({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      bps: 2_500,
    });
    sendTransaction(svm, lockTx, [market.lpOwner]);

    const [position] = await client.state.decodePositions(opened.position);
    expect(big(position.vestingLiquidity)).toBeGreaterThan(0n);
    expect(big(position.permanentLockedLiquidity)).toBeGreaterThan(0n);
  });

  it("refreshes a slot's pending fees and fee checkpoints after swaps", async () => {
    const swapPool = await initializeStaticPool(svm, client, market);
    const range = { tickLowerId: -128, tickUpperId: 128 };
    const tickRanges = [range];
    const opened = await openFundedPosition(
      svm,
      client,
      market,
      swapPool,
      tickRanges,
    );

    await pushPrice(svm, client, market, swapPool, "down", new BN(20_000));
    await pushPrice(svm, client, market, swapPool, "up", new BN(20_000));

    const poolState = await client.state.fetchPool(swapPool);
    const ticks = (
      await client.state.fetchTickArraysWithTicks(
        tickArraysForTickIds(
          swapPool,
          [range.tickLowerId, range.tickUpperId],
          tickSpacing,
        ),
        { withReward: false },
      )
    ).flatMap((array) => array.ticks);
    const tickById = (tickId: number) =>
      ticks.find((tick) => tick.tickId === tickId)!;
    const inside = getFeeGrowthInside({
      tickCurrentId: poolState.tickCurrentId,
      tickLower: tickById(range.tickLowerId),
      tickLowerId: range.tickLowerId,
      tickUpper: tickById(range.tickUpperId),
      tickUpperId: range.tickUpperId,
      feeGrowthGlobalX: poolState.feeGrowthGlobalX,
      feeGrowthGlobalY: poolState.feeGrowthGlobalY,
    });
    const [stale] = await client.state.decodePositions(opened.position);
    const pending = getPendingFees(stale, inside);
    expect(big(pending.feeX)).toBeGreaterThan(big(stale.feePendingX));
    expect(big(pending.feeY)).toBeGreaterThan(big(stale.feePendingY));

    const { tx } = await client.position.refreshFeesAndRewards({
      pool: swapPool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      bitmap: liquidityBitmap([0]),
      tickRanges,
    });
    sendTransaction(svm, tx, [market.lpOwner]);

    const decoded = await client.state.decodePositions(opened.position);
    expect(decoded).toHaveLength(1);
    expect({
      tickLowerId: decoded[0].tickLowerId,
      tickUpperId: decoded[0].tickUpperId,
      feePendingX: decoded[0].feePendingX.toString(),
      feePendingY: decoded[0].feePendingY.toString(),
      feeGrowthCheckpointX: decoded[0].feeGrowthCheckpointX.toString(),
      feeGrowthCheckpointY: decoded[0].feeGrowthCheckpointY.toString(),
    }).toEqual({
      ...range,
      feePendingX: pending.feeX.toString(),
      feePendingY: pending.feeY.toString(),
      feeGrowthCheckpointX: inside.feeGrowthInsideX.toString(),
      feeGrowthCheckpointY: inside.feeGrowthInsideY.toString(),
    });
  });

  it("updates position delegate permission", async () => {
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE_0],
    });
    const permission = positionDelegatePermissionMask([
      PositionDelegatePermission.AddLiquidity,
      PositionDelegatePermission.ClaimFee,
    ]);
    const { tx } = await client.position.updatePositionDelegatePermission({
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      permission,
    });
    sendTransaction(svm, tx, [market.lpOwner]);

    const header = await client.state.fetchPositionArray(opened.position);
    expect(header.delegatePermission).toBe(permission);
  });

  it.each(
    [
      {
        name: "Spot",
        strategy: StrategyType.Spot,
        minTickId: -20,
        maxTickId: 20,
      },
      {
        name: "Curve",
        strategy: StrategyType.Curve,
        minTickId: -20,
        maxTickId: 20,
      },
      {
        name: "BidAsk",
        strategy: StrategyType.BidAsk,
        minTickId: -20,
        maxTickId: 20,
      },
      {
        name: "Wave",
        strategy: StrategyType.Wave,
        minTickId: -80,
        maxTickId: 80,
      },
      {
        name: "Custom",
        strategy: StrategyType.Custom,
        minTickId: -20,
        maxTickId: 20,
        weights: gridWeights(-20, 10, [4, 3, 2, 1, 1]),
      },
      {
        name: "Curve above the market",
        strategy: StrategyType.Curve,
        minTickId: 20,
        maxTickId: 60,
      },
      {
        name: "Curve below the market",
        strategy: StrategyType.Curve,
        minTickId: -60,
        maxTickId: -20,
      },
      {
        name: "Custom with a zero gap",
        strategy: StrategyType.Custom,
        minTickId: -20,
        maxTickId: 20,
        weights: gridWeights(-20, 10, [3, 2, 0, 2, 3]),
      },
    ].flatMap((entry) =>
      [LiquidityLayout.Vertical, LiquidityLayout.Horizontal].map((layout) => ({
        ...entry,
        layout,
        layoutName: LiquidityLayout[layout],
      })),
    ),
  )(
    "adds and withdraws $layoutName $name liquidity by weight",
    async ({ strategy, minTickId, maxTickId, weights, layout }) => {
      const shape = buildLiquidityShape({
        strategy,
        minTickId,
        maxTickId,
        tickSpacing: 10,
        currentTickId: 0,
        weights,
        layout,
      });
      const tickRanges = shape.ranges.map((range) => ({
        tickLowerId: range.tickLowerId,
        tickUpperId: range.tickUpperId,
      }));
      const opened = await openPosition(svm, client, {
        pool,
        owner: market.lpOwner.publicKey,
        payer: market.payer,
        tickRanges,
      });

      const poolState = await client.state.fetchPool(pool);
      const multiplier = multiplierFromAmounts({
        ranges: shape.ranges,
        tickSpacing,
        currentTickId: poolState.tickCurrentId,
        currentSqrtPrice: poolState.sqrtPrice,
        amountX: new BN(200_000),
        amountY: new BN(200_000),
        mintX: null,
        mintY: null,
        epoch: 0n,
      });
      const { tx: addTx } = await client.position.addLiquidityByWeight({
        ...lpAccounts(market, pool, opened.nftMint),
        tickRanges,
        parameters: encodeAddLiquidityByWeight({
          ranges: shape.ranges,
          maxAmountX: new BN(200_000),
          maxAmountY: new BN(200_000),
          multiplier,
        }),
      });
      sendTransaction(svm, addTx, [market.lpOwner]);

      const funded = await client.state.decodePositions(opened.position);
      expect(funded).toHaveLength(shape.ranges.length);
      for (let index = 0; index < shape.ranges.length; index++) {
        expect(
          funded[index].unlockedLiquidity.eq(
            multiplier.mul(new BN(shape.ranges[index].weight)),
          ),
        ).toBe(true);
        expect(funded[index].tickLowerId).toBe(shape.ranges[index].tickLowerId);
        expect(funded[index].tickUpperId).toBe(shape.ranges[index].tickUpperId);
      }

      const { tx: removeTx } = await client.position.removeLiquidityByBps({
        ...lpAccounts(market, pool, opened.nftMint),
        tickRanges,
        parameters: {
          minAmountX: new BN(0),
          minAmountY: new BN(0),
          expectedLayoutVersion: null,
          bps: 10_000,
          bitmap: null,
        },
      });
      sendTransaction(svm, removeTx, [market.lpOwner]);
      expect(
        (await getPositionTotalLiquidity(client, opened.nftMint)).isZero(),
      ).toBe(true);
    },
  );

  it("adds the same active liquidity in both layouts", async () => {
    const before = await client.state.fetchPool(pool);
    const shapes = [LiquidityLayout.Vertical, LiquidityLayout.Horizontal].map(
      (layout) =>
        buildLiquidityShape({
          strategy: StrategyType.Curve,
          minTickId: -20,
          maxTickId: 20,
          tickSpacing: 10,
          currentTickId: before.tickCurrentId,
          layout,
        }),
    );
    const multiplier = shapes
      .map((shape) =>
        multiplierFromAmounts({
          ranges: shape.ranges,
          tickSpacing,
          currentTickId: before.tickCurrentId,
          currentSqrtPrice: before.sqrtPrice,
          amountX: new BN(200_000),
          amountY: new BN(200_000),
          mintX: null,
          mintY: null,
          epoch: 0n,
        }),
      )
      .reduce((low, next) => BN.min(low, next));
    const activeColumn = shapes[0].columns.find(
      (column) =>
        column.tickId <= before.tickCurrentId &&
        before.tickCurrentId < column.tickUpperId,
    );
    expect(activeColumn).toBeDefined();

    const deposits: { liquidity: BN; x: BN; y: BN; ranges: number }[] = [];
    for (const shape of shapes) {
      const tickRanges = shape.ranges.map((range) => ({
        tickLowerId: range.tickLowerId,
        tickUpperId: range.tickUpperId,
      }));
      const opened = await openPosition(svm, client, {
        pool,
        owner: market.lpOwner.publicKey,
        payer: market.payer,
        tickRanges,
      });
      const poolBefore = await client.state.fetchPool(pool);
      const xBefore = getTokenAmount(svm, market.lpTokenX);
      const yBefore = getTokenAmount(svm, market.lpTokenY);
      const { tx } = await client.position.addLiquidityByWeight({
        ...lpAccounts(market, pool, opened.nftMint),
        tickRanges,
        parameters: encodeAddLiquidityByWeight({
          ranges: shape.ranges,
          maxAmountX: new BN(200_000),
          maxAmountY: new BN(200_000),
          multiplier,
        }),
      });
      sendTransaction(svm, tx, [market.lpOwner]);
      const poolAfter = await client.state.fetchPool(pool);
      deposits.push({
        liquidity: poolAfter.liquidity.sub(poolBefore.liquidity),
        x: xBefore.sub(getTokenAmount(svm, market.lpTokenX)),
        y: yBefore.sub(getTokenAmount(svm, market.lpTokenY)),
        ranges: shape.ranges.length,
      });
    }

    const [vertical, horizontal] = deposits;
    const expected = multiplier.muln(activeColumn!.weight);
    expect(vertical.liquidity.eq(expected)).toBe(true);
    expect(horizontal.liquidity.eq(expected)).toBe(true);
    expect(horizontal.ranges).toBeLessThan(vertical.ranges);
    const tolerance = vertical.ranges + horizontal.ranges;
    expect(vertical.x.sub(horizontal.x).abs().toNumber()).toBeLessThanOrEqual(
      tolerance,
    );
    expect(vertical.y.sub(horizontal.y).abs().toNumber()).toBeLessThanOrEqual(
      tolerance,
    );
  });

  it("adds across multiple ranges and withdraws only one", async () => {
    const tickRanges = [RANGE_0, RANGE_1];
    const opened = await openFundedPosition(
      svm,
      client,
      market,
      pool,
      tickRanges,
    );

    const before = await client.state.decodePositions(opened.position);
    expect(big(before[0].unlockedLiquidity)).toBeGreaterThan(0n);
    expect(big(before[1].unlockedLiquidity)).toBeGreaterThan(0n);

    await removeLiquidity(svm, client, {
      pool,
      nftMint: opened.nftMint,
      signer: market.lpOwner,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      withdrawals: [
        { positionIndex: 1, liquidity: before[1].unlockedLiquidity },
      ],
    });

    const after = await client.state.decodePositions(opened.position);
    expect(after[0].unlockedLiquidity.eq(before[0].unlockedLiquidity)).toBe(
      true,
    );
    expect(after[1].unlockedLiquidity.toString()).toBe("0");
  });

  it("refreshes and removes non-contiguous position slots", async () => {
    const tickRanges = [RANGE_0, RANGE_1, RANGE_2];
    const opened = await openFundedPosition(
      svm,
      client,
      market,
      pool,
      tickRanges,
      { fundedIndexes: [0, 2] },
    );

    const { tx: refreshTx } = await client.position.refreshFeesAndRewards({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      bitmap: liquidityBitmap([0, 2]),
      tickRanges: [RANGE_0, RANGE_2],
    });
    sendTransaction(svm, refreshTx, [market.lpOwner]);

    const positions = await client.state.decodePositions(opened.position);
    await removeLiquidity(svm, client, {
      pool,
      nftMint: opened.nftMint,
      signer: market.lpOwner,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      withdrawals: [
        { positionIndex: 0, liquidity: positions[0].unlockedLiquidity },
        { positionIndex: 2, liquidity: positions[2].unlockedLiquidity },
      ],
    });

    const positionArrayBefore = await client.state.fetchPositionArray(
      opened.position,
    );
    const { tx: removeTx } = await client.position.removePosition({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      rentReceiver: market.lpOwner.publicKey,
      tickRanges: [RANGE_0, RANGE_2],
      parameters: {
        bitmap: liquidityBitmap([0, 2]),
        expectedLayoutVersion: positionArrayBefore.layoutVersion,
      },
    });
    sendTransaction(svm, removeTx, [market.lpOwner]);

    const remaining = await client.state.decodePositions(opened.position);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tickLowerId).toBe(RANGE_1.tickLowerId);
    expect(remaining[0].tickUpperId).toBe(RANGE_1.tickUpperId);
    expect(
      (await client.state.fetchPositionArray(opened.position)).layoutVersion,
    ).toBe(positionArrayBefore.layoutVersion + 1);
  });

  it("deposits single-sided X above and Y below the current tick", async () => {
    const askRange = { tickLowerId: 100, tickUpperId: 200 };
    const bidRange = { tickLowerId: -200, tickUpperId: -100 };
    const reserveX = deriveReserve(market.tokenXMint, pool);
    const reserveY = deriveReserve(market.tokenYMint, pool);

    const ask = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [askRange],
    });
    const xBefore = getTokenAmount(svm, reserveX);
    const yBeforeAsk = getTokenAmount(svm, reserveY);
    const { tx: askTx } = await client.position.addLiquidityImbalance({
      ...lpAccounts(market, pool, ask.nftMint),
      tickRanges: [askRange],
      parameters: {
        maxAmountX: new BN(100_000),
        maxAmountY: null,
        slippage: { sqrtPriceSlippage: null, minLiquidity: null },
        index: 0,
        expectedLayoutVersion: null,
      },
    });
    sendTransaction(svm, askTx, [market.lpOwner]);
    expect(big(getTokenAmount(svm, reserveX))).toBeGreaterThan(big(xBefore));
    expect(getTokenAmount(svm, reserveY).toString()).toBe(
      yBeforeAsk.toString(),
    );

    const bid = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [bidRange],
    });
    const xBeforeBid = getTokenAmount(svm, reserveX);
    const yBefore = getTokenAmount(svm, reserveY);
    const { tx: bidTx } = await client.position.addLiquidityImbalance({
      ...lpAccounts(market, pool, bid.nftMint),
      tickRanges: [bidRange],
      parameters: {
        maxAmountX: null,
        maxAmountY: new BN(100_000),
        slippage: { sqrtPriceSlippage: null, minLiquidity: null },
        index: 0,
        expectedLayoutVersion: null,
      },
    });
    sendTransaction(svm, bidTx, [market.lpOwner]);
    expect(getTokenAmount(svm, reserveX).toString()).toBe(
      xBeforeBid.toString(),
    );
    expect(big(getTokenAmount(svm, reserveY))).toBeGreaterThan(big(yBefore));
  });

  it("deposits imbalanced liquidity into one range of a multi-range position", async () => {
    const tickRanges = [
      { tickLowerId: -300, tickUpperId: -200 },
      { tickLowerId: -100, tickUpperId: 100 },
      { tickLowerId: 200, tickUpperId: 300 },
    ];
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
    });
    const { tx } = await client.position.addLiquidityImbalance({
      ...lpAccounts(market, pool, opened.nftMint),
      tickRanges,
      parameters: {
        maxAmountX: new BN(80_000),
        maxAmountY: new BN(80_000),
        slippage: { sqrtPriceSlippage: null, minLiquidity: null },
        index: 1,
        expectedLayoutVersion: null,
      },
    });
    sendTransaction(svm, tx, [market.lpOwner]);

    const decoded = await client.state.decodePositions(opened.position);
    expect(decoded[0].unlockedLiquidity.toString()).toBe("0");
    expect(big(decoded[1].unlockedLiquidity)).toBeGreaterThan(0n);
    expect(decoded[2].unlockedLiquidity.toString()).toBe("0");
  });

  it("leaves out the bitmap extension of a pool that has none", async () => {
    const bare = await initializeStaticPool(svm, client, market);
    const tickRanges = [RANGE_0, OUTER_RANGE];
    const opened = await openPosition(svm, client, {
      pool: bare,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
    });
    const tx = await addLiquidity(svm, client, {
      pool: bare,
      nftMint: opened.nftMint,
      signer: market.lpOwner,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(50_000),
          maxTokenY: new BN(50_000),
        },
      ],
    });

    expect(
      tx.instructions[0].keys.map((key) => key.pubkey.toBase58()),
    ).not.toContain(deriveTickArrayBitmapExtension(bare).toBase58());
    const decoded = await client.state.decodePositions(opened.position);
    expect(big(decoded[0].unlockedLiquidity)).toBeGreaterThan(0n);
    expect(decoded[1].unlockedLiquidity.toString()).toBe("0");
  });

  it("adds and fully removes liquidity on an outer tick range through the bitmap extension", async () => {
    const outerPool = await initializeStaticPool(svm, client, market);
    const tickRanges = [OUTER_RANGE];
    const { tx: extTx, tickArrayBitmapExtension } =
      await client.pool.initializeTickBitmapExtension({
        pool: outerPool,
        funder: market.payer.publicKey,
      });
    sendTransaction(svm, extTx, [market.payer]);
    expect(tickArrayBitmapExtension.toBase58()).toBe(
      deriveTickArrayBitmapExtension(outerPool).toBase58(),
    );

    const opened = await openFundedPosition(
      svm,
      client,
      market,
      outerPool,
      tickRanges,
    );

    expect(
      (await getPositionTotalLiquidity(client, opened.nftMint)).gt(new BN(0)),
    ).toBe(true);
    expect(
      getBitmapSetIndicesFromPool(await client.state.fetchPool(outerPool)),
    ).not.toContain(512);
    expect(
      getExtensionBitmapSetIndicesFromState(
        await client.state.fetchTickArrayBitmapExtension(
          tickArrayBitmapExtension,
        ),
      ),
    ).toEqual([512, 513]);

    const { tx } = await client.position.removeLiquidityByBps({
      ...lpAccounts(market, outerPool, opened.nftMint),
      tickRanges,
      parameters: {
        minAmountX: new BN(0),
        minAmountY: new BN(0),
        expectedLayoutVersion: null,
        bps: 10_000,
        bitmap: null,
      },
    });
    sendTransaction(svm, tx, [market.lpOwner]);

    expect(
      (await getPositionTotalLiquidity(client, opened.nftMint)).isZero(),
    ).toBe(true);
    expect(
      getExtensionBitmapSetIndicesFromState(
        await client.state.fetchTickArrayBitmapExtension(
          tickArrayBitmapExtension,
        ),
      ),
    ).toEqual([]);
  });

  it("rejects a permanent lock bps outside 1..=10000", async () => {
    const base = {
      pool,
      nftMint: PublicKey.unique(),
      owner: market.lpOwner.publicKey,
    };
    await expect(
      client.position.lockPermanentPosition({ ...base, bps: 0 }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      client.position.lockPermanentPosition({ ...base, bps: 10_001 }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
  });

  it("rejects a vesting schedule that does not release exactly 10000 bps", async () => {
    const base = {
      pool,
      nftMint: PublicKey.unique(),
      owner: market.lpOwner.publicKey,
    };
    const schedule = {
      cliffPoint: null,
      cliffUnlockBps: 0,
      bpsPerPeriod: 1_000,
      periodFrequency: new BN(1),
      numberOfPeriod: 10,
      bps: 10_000,
      expectedLayoutVersion: null,
    };
    await expect(
      client.position.lockVestingPosition({
        ...base,
        parameters: { ...schedule, cliffUnlockBps: 1_000 },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
  });

  it("rejects a delegate permission outside the bitmask range", async () => {
    const base = {
      nftMint: PublicKey.unique(),
      owner: market.lpOwner.publicKey,
    };
    await expect(
      client.position.updatePositionDelegatePermission({
        ...base,
        permission: 1 << 5,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidPermission });
    await expect(
      client.position.updatePositionDelegatePermission({
        ...base,
        permission: -1,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidPermission });
  });

  it("rejects invalid ranges", async () => {
    const base = {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
    };
    await expect(
      openPosition(svm, client, {
        ...base,
        tickRanges: [],
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      openPosition(svm, client, {
        ...base,
        tickRanges: [{ tickLowerId: 20, tickUpperId: -20 }],
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
  });
});
