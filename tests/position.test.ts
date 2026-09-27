import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildLiquidityShape,
  customWeightsFromGrid,
  delegatePermissionMask,
  deriveReserve,
  deriveTickArrayBitmapExtension,
  DlmmProClient,
  encodeAddLiquidityByWeight,
  liquidityBitmap,
  MAX_VESTING_DURATION,
  multiplierFromAmounts,
  PoolErrorCode,
  PositionDelegatePermission,
  StrategyType,
} from "../src";
import {
  addLiquidity,
  big,
  createFundedMarket,
  createSvmConnection,
  getPositionTotalLiquidity,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  openPosition,
  removeLiquidity,
  sendTransaction,
  sendTransactionExpectingError,
} from "./helpers";

const RANGE_0 = { tickLowerId: -20, tickUpperId: 20 };
const RANGE_1 = { tickLowerId: 128, tickUpperId: 138 };
const RANGE_2 = { tickLowerId: 256, tickUpperId: 266 };

describe("position instructions", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const tickSpacing = 1;

  let market: Awaited<ReturnType<typeof createFundedMarket>>;
  let pool: PublicKey;

  beforeAll(async () => {
    market = await createFundedMarket({ svm, client });
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

  it("expands and then removes an empty range", async () => {
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE_0],
      tickSpacing,
    });
    const sizeBefore = svm.getAccount(opened.position)!.data.length;

    const expand = await client.position.expandPosition({
      pool,
      signer: market.lpOwner.publicKey,
      payer: market.payer.publicKey,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      tickRanges: [RANGE_1],
      tickSpacing,
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
      tickSpacing,
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
      tickSpacing,
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
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      tickSpacing,
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
      tickSpacing,
    });

    const { tx } = await client.position.addLiquidityImbalance({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges: [range],
      tickSpacing,
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
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE_0],
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
      tickRanges: [RANGE_0],
      tickSpacing,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(50_000),
          maxTokenY: new BN(50_000),
        },
      ],
    });
    const before = await getPositionTotalLiquidity(client, opened.nftMint);

    const { tx } = await client.position.removeLiquidityByBps({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges: [RANGE_0],
      tickSpacing,
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
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE_0],
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
      tickRanges: [RANGE_0],
      tickSpacing,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(80_000),
          maxTokenY: new BN(80_000),
        },
      ],
    });

    const { tx: vestTx } = await client.position.lockVestingPosition({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
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
      signer: market.lpOwner.publicKey,
      bps: 2_500,
    });
    sendTransaction(svm, lockTx, [market.lpOwner]);

    const [position] = await client.state.decodePositions(opened.position);
    expect(big(position.vestingLiquidity)).toBeGreaterThan(0n);
    expect(big(position.permanentLockedLiquidity)).toBeGreaterThan(0n);
  });

  it("refreshes fees and rewards", async () => {
    const tickRanges = [{ tickLowerId: -128, tickUpperId: 128 }];
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
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
      tickRanges,
      tickSpacing,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(50_000),
          maxTokenY: new BN(50_000),
        },
      ],
    });

    const { tx } = await client.position.refreshFeesAndRewards({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      bitmap: liquidityBitmap([0]),
      tickRanges,
      tickSpacing,
    });
    sendTransaction(svm, tx, [market.lpOwner]);

    const decoded = await client.state.decodePositions(opened.position);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].tickLowerId).toBe(-128);
    expect(decoded[0].tickUpperId).toBe(128);
  });

  it("updates position delegate permission", async () => {
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE_0],
      tickSpacing,
    });
    const permission = delegatePermissionMask([
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

  it.each([
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
      name: "Custom",
      strategy: StrategyType.Custom,
      minTickId: -20,
      maxTickId: 20,
      weights: customWeightsFromGrid(-20, 10, [4, 3, 2, 1, 1]),
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
      weights: customWeightsFromGrid(-20, 10, [3, 2, 0, 2, 3]),
    },
  ])(
    "adds and withdraws $name liquidity by weight",
    async ({ strategy, minTickId, maxTickId, weights }) => {
      const shape = buildLiquidityShape({
        strategy,
        minTickId,
        maxTickId,
        tickSpacing: 10,
        currentTickId: 0,
        weights,
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
        tickSpacing,
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
        pool,
        nftMint: opened.nftMint,
        owner: market.lpOwner.publicKey,
        signer: market.lpOwner.publicKey,
        tokenXMint: market.tokenXMint,
        tokenYMint: market.tokenYMint,
        userTokenX: market.lpTokenX,
        userTokenY: market.lpTokenY,
        tickRanges,
        tickSpacing,
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
        pool,
        nftMint: opened.nftMint,
        owner: market.lpOwner.publicKey,
        signer: market.lpOwner.publicKey,
        tokenXMint: market.tokenXMint,
        tokenYMint: market.tokenYMint,
        userTokenX: market.lpTokenX,
        userTokenY: market.lpTokenY,
        tickRanges,
        tickSpacing,
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

  it("adds across multiple ranges and withdraws only one", async () => {
    const tickRanges = [RANGE_0, RANGE_1];
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
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
      tickRanges,
      tickSpacing,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(40_000),
          maxTokenY: new BN(40_000),
        },
        {
          positionIndex: 1,
          maxTokenX: new BN(40_000),
          maxTokenY: new BN(40_000),
        },
      ],
    });

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
      tickSpacing,
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
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
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
      tickRanges,
      tickSpacing,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(40_000),
          maxTokenY: new BN(40_000),
        },
        {
          positionIndex: 2,
          maxTokenX: new BN(40_000),
          maxTokenY: new BN(40_000),
        },
      ],
    });

    const { tx: refreshTx } = await client.position.refreshFeesAndRewards({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      bitmap: liquidityBitmap([0, 2]),
      tickRanges: [RANGE_0, RANGE_2],
      tickSpacing,
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
      tickSpacing,
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
      tickSpacing,
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

  it("rejects removing a range that still has liquidity", async () => {
    const tickRanges = [RANGE_0, RANGE_1];
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
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
      tickRanges,
      tickSpacing,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(20_000),
          maxTokenY: new BN(20_000),
        },
      ],
    });

    const { tx } = await client.position.removePosition({
      pool,
      signer: market.lpOwner.publicKey,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      rentReceiver: market.lpOwner.publicKey,
      tickRanges,
      tickSpacing,
      parameters: {
        bitmap: liquidityBitmap([0]),
        expectedLayoutVersion: null,
      },
    });
    sendTransactionExpectingError(
      svm,
      tx,
      [market.lpOwner],
      "PositionIsNotEmpty",
    );
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
      tickSpacing,
    });
    const xBefore = getTokenAmount(svm, reserveX);
    const yBeforeAsk = getTokenAmount(svm, reserveY);
    const { tx: askTx } = await client.position.addLiquidityImbalance({
      pool,
      nftMint: ask.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges: [askRange],
      tickSpacing,
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
      tickSpacing,
    });
    const xBeforeBid = getTokenAmount(svm, reserveX);
    const yBefore = getTokenAmount(svm, reserveY);
    const { tx: bidTx } = await client.position.addLiquidityImbalance({
      pool,
      nftMint: bid.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges: [bidRange],
      tickSpacing,
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
      tickSpacing,
    });
    const { tx } = await client.position.addLiquidityImbalance({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      tickSpacing,
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

  it("adds liquidity on an outer tick range through the bitmap extension", async () => {
    const tickRanges = [{ tickLowerId: 65536, tickUpperId: 65664 }];
    const { tx: extTx, tickArrayBitmapExtension } =
      await client.pool.initializeTickBitmapExtension({
        pool,
        funder: market.payer.publicKey,
      });
    sendTransaction(svm, extTx, [market.payer]);
    expect(tickArrayBitmapExtension.toBase58()).toBe(
      deriveTickArrayBitmapExtension(pool).toBase58(),
    );

    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
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
      tickRanges,
      tickSpacing,
      tickArrayBitmapExtension,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(50_000),
          maxTokenY: new BN(50_000),
        },
      ],
    });

    expect(
      (await getPositionTotalLiquidity(client, opened.nftMint)).gt(new BN(0)),
    ).toBe(true);
    expect(await client.state.getBitmapSetIndices(pool)).not.toContain(512);
    expect(
      await client.state.getExtensionBitmapSetIndices(tickArrayBitmapExtension),
    ).toEqual([512, 513]);
  });

  it("rejects a permanent lock bps outside 1..=10000", async () => {
    const base = {
      pool,
      nftMint: PublicKey.unique(),
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
    };
    await expect(
      client.position.lockPermanentPosition({ ...base, bps: 0 }),
    ).rejects.toThrow("Invalid parameters");
    await expect(
      client.position.lockPermanentPosition({ ...base, bps: 10_001 }),
    ).rejects.toThrow("Invalid parameters");
  });

  it("validates a vesting schedule with the program's codes", async () => {
    const base = {
      pool,
      nftMint: PublicKey.unique(),
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
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
    // u16 product overflow trips `safe_mul` before the bps-sum comparison.
    await expect(
      client.position.lockVestingPosition({
        ...base,
        parameters: { ...schedule, numberOfPeriod: 100 },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.MathOverflow });
    await expect(
      client.position.lockVestingPosition({
        ...base,
        parameters: {
          ...schedule,
          periodFrequency: MAX_VESTING_DURATION.divn(10).addn(1),
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
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
        permission: 1 << 9,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidPermission });
    await expect(
      client.position.updatePositionDelegatePermission({
        ...base,
        permission: -1,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidPermission });
  });

  it("rejects invalid ranges and caller-supplied pool spacing", async () => {
    const base = {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
    };
    await expect(
      openPosition(svm, client, {
        ...base,
        tickRanges: [],
        tickSpacing,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      openPosition(svm, client, {
        ...base,
        tickRanges: [{ tickLowerId: 20, tickUpperId: -20 }],
        tickSpacing,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      openPosition(svm, client, {
        ...base,
        tickRanges: [RANGE_0],
        tickSpacing: tickSpacing + 1,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
  });
});
