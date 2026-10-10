import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DlmmProClient,
  getAmountsFromLiquidity,
  getLiquidityFromAmounts,
  liquidityBitmap,
  PoolErrorCode,
  positionTotalLiquidity,
  type TickRange,
} from "../src";
import {
  addLiquidity,
  big,
  createFundedMarket,
  createSvmConnection,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  openPosition,
  sendTransaction,
  sendTransactionExpectingError,
  swap,
} from "./helpers";

const RANGE_A: TickRange = { tickLowerId: -64, tickUpperId: 64 };
const RANGE_B: TickRange = { tickLowerId: -16, tickUpperId: 16 };
const RANGE_ABOVE: TickRange = { tickLowerId: 200, tickUpperId: 264 };
const RANGE_HIGH: TickRange = { tickLowerId: 64, tickUpperId: 192 };
const RANGE_LOW: TickRange = { tickLowerId: -192, tickUpperId: -64 };

describe("fee compounding", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const tickSpacing = 1;

  let market: Awaited<ReturnType<typeof createFundedMarket>>;
  let pool: PublicKey;

  async function pushPrice(
    direction: "up" | "down",
    amount: BN,
  ): Promise<void> {
    const up = direction === "up";
    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: up ? market.swapperTokenY : market.swapperTokenX,
      userTokenOut: up ? market.swapperTokenX : market.swapperTokenY,
      inputAmount: amount,
    });
  }

  async function pushPriceUntil(
    direction: "up" | "down",
    reached: (tickCurrentId: number) => boolean,
  ): Promise<number> {
    let amount = 50_000;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const tickCurrentId = (await client.state.fetchPool(pool)).tickCurrentId;
      if (reached(tickCurrentId)) {
        return tickCurrentId;
      }
      try {
        await pushPrice(direction, new BN(amount));
        amount = Math.min(amount * 2, 500_000);
      } catch (error) {
        if (amount <= 100) {
          throw error;
        }
        amount = Math.floor(amount / 2);
      }
    }
    throw new Error(`price did not move ${direction} far enough`);
  }

  async function accrueFees(): Promise<void> {
    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenX,
      userTokenOut: market.swapperTokenY,
      inputAmount: new BN(200_000),
    });
    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenY,
      userTokenOut: market.swapperTokenX,
      inputAmount: new BN(200_000),
    });
  }

  async function openFundedPosition(
    tickRanges: TickRange[],
    fundedIndexes = tickRanges.map((_, index) => index),
  ) {
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
      deposits: fundedIndexes.map((positionIndex) => ({
        positionIndex,
        maxTokenX: new BN(5_000_000),
        maxTokenY: new BN(5_000_000),
      })),
    });
    return opened;
  }

  function positionAccounts(nftMint: PublicKey) {
    return {
      pool,
      nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
    };
  }

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
    await openFundedPosition([RANGE_A]);
  });

  it("previews claimable fees that match the on-chain claim", async () => {
    await accrueFees();
    const opened = await openFundedPosition([RANGE_A, RANGE_B]);
    await accrueFees();

    const { tx: refresh } = await client.position.refreshFeesAndRewards({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      bitmap: liquidityBitmap([1]),
      tickRanges: [RANGE_B],
      tickSpacing,
    });
    sendTransaction(svm, refresh, [market.lpOwner]);

    // Push the price above RANGE_B so slot 1 stops earning and its upper tick
    // sits below the current tick when the growth inside is evaluated.
    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenY,
      userTokenOut: market.swapperTokenX,
      inputAmount: new BN(10_000_000),
    });
    expect(
      (await client.state.fetchPool(pool)).tickCurrentId,
    ).toBeGreaterThanOrEqual(RANGE_B.tickUpperId);
    await accrueFees();

    const partial = await client.position.getClaimableFees({
      pool,
      nftMint: opened.nftMint,
      bitmap: liquidityBitmap([0]),
    });
    const stale = await client.state.decodePositions(opened.position);
    expect(partial.slots[1].feeX.eq(stale[1].feePendingX)).toBe(true);
    expect(partial.slots[1].feeY.eq(stale[1].feePendingY)).toBe(true);
    expect(big(partial.slots[0].feeX)).toBeGreaterThan(0n);
    expect(big(partial.slots[1].feeX)).toBeGreaterThan(0n);

    let xBefore = getTokenAmount(svm, market.lpTokenX);
    let yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx: claimOne } = await client.position.claimFee({
      ...positionAccounts(opened.nftMint),
      bitmap: liquidityBitmap([0]),
      tickRanges: [RANGE_A],
      tickSpacing,
    });
    sendTransaction(svm, claimOne, [market.lpOwner]);
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      partial.feeX.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      partial.feeY.toString(),
    );

    await accrueFees();
    const full = await client.position.getClaimableFees({
      pool,
      nftMint: opened.nftMint,
    });
    expect(full.bitmap.eq(liquidityBitmap([0, 1]))).toBe(true);
    xBefore = getTokenAmount(svm, market.lpTokenX);
    yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx: claimAll } = await client.position.claimFee({
      ...positionAccounts(opened.nftMint),
      bitmap: full.bitmap,
      tickRanges: [RANGE_A, RANGE_B],
      tickSpacing,
    });
    sendTransaction(svm, claimAll, [market.lpOwner]);
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      full.feeX.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      full.feeY.toString(),
    );
  });

  it("claims and redeposits fees into one slot", async () => {
    const opened = await openFundedPosition([RANGE_A, RANGE_B]);
    await accrueFees();

    const poolState = await client.state.fetchPool(pool);
    const before = await client.state.decodePositions(opened.position);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);

    const { tx, claimable, parameters } = await client.position.compoundFees({
      ...positionAccounts(opened.nftMint),
      index: 0,
    });
    expect(tx.instructions).toHaveLength(3);
    expect(parameters.expectedLayoutVersion).toBe(claimable.layoutVersion);
    expect(parameters.maxAmountX?.eq(claimable.feeX)).toBe(true);
    expect(parameters.maxAmountY?.eq(claimable.feeY)).toBe(true);
    sendTransaction(svm, tx, [market.lpOwner]);

    const liquidity = getLiquidityFromAmounts({
      maxTokenX: claimable.feeX,
      maxTokenY: claimable.feeY,
      tickLowerId: RANGE_A.tickLowerId,
      tickUpperId: RANGE_A.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const deposited = getAmountsFromLiquidity({
      liquidity,
      tickLowerId: RANGE_A.tickLowerId,
      tickUpperId: RANGE_A.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });

    const after = await client.state.decodePositions(opened.position);
    expect(
      positionTotalLiquidity(after[0])
        .sub(positionTotalLiquidity(before[0]))
        .toString(),
    ).toBe(liquidity.toString());
    expect(
      positionTotalLiquidity(after[1]).eq(positionTotalLiquidity(before[1])),
    ).toBe(true);
    for (const slot of after) {
      expect(slot.feePendingX.toString()).toBe("0");
      expect(slot.feePendingY.toString()).toBe("0");
    }
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      claimable.feeX.sub(deposited.amountX).toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      claimable.feeY.sub(deposited.amountY).toString(),
    );
  });

  it("redeposits one side into a different slot above the price", async () => {
    const opened = await openFundedPosition([RANGE_A, RANGE_ABOVE], [0]);
    await accrueFees();

    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBeLessThan(RANGE_ABOVE.tickLowerId);
    const before = await client.state.decodePositions(opened.position);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);

    const { tx, claimable, parameters } = await client.position.compoundFees({
      ...positionAccounts(opened.nftMint),
      index: 1,
      maxAmountY: null,
      slippage: {
        sqrtPriceSlippage: {
          minSqrtPrice: poolState.sqrtPrice,
          maxSqrtPrice: poolState.sqrtPrice,
        },
        minLiquidity: new BN(1),
      },
    });
    expect(parameters.maxAmountY).toBeNull();
    expect(big(claimable.feeY)).toBeGreaterThan(0n);
    sendTransaction(svm, tx, [market.lpOwner]);

    const liquidity = getLiquidityFromAmounts({
      maxTokenX: claimable.feeX,
      maxTokenY: new BN(0),
      tickLowerId: RANGE_ABOVE.tickLowerId,
      tickUpperId: RANGE_ABOVE.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const deposited = getAmountsFromLiquidity({
      liquidity,
      tickLowerId: RANGE_ABOVE.tickLowerId,
      tickUpperId: RANGE_ABOVE.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const after = await client.state.decodePositions(opened.position);
    expect(
      positionTotalLiquidity(after[0]).eq(positionTotalLiquidity(before[0])),
    ).toBe(true);
    expect(positionTotalLiquidity(after[1]).toString()).toBe(
      liquidity.toString(),
    );
    expect(deposited.amountY.toString()).toBe("0");
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      claimable.feeX.sub(deposited.amountX).toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      claimable.feeY.toString(),
    );
  });

  it("rejects skipping a side the slot needs at the current price", async () => {
    const opened = await openFundedPosition([RANGE_A]);
    await accrueFees();
    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBeGreaterThanOrEqual(RANGE_A.tickLowerId);
    expect(poolState.tickCurrentId).toBeLessThan(RANGE_A.tickUpperId);

    await expect(
      client.position.compoundFees({
        ...positionAccounts(opened.nftMint),
        index: 0,
        maxAmountY: null,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.ExceededSlippage });

    // The program answers the same for the deposit leg on its own.
    const { tx } = await client.position.addLiquidityImbalance({
      ...positionAccounts(opened.nftMint),
      tickRanges: [RANGE_A],
      tickSpacing,
      parameters: {
        maxAmountX: new BN(1_000),
        maxAmountY: null,
        slippage: { sqrtPriceSlippage: null, minLiquidity: null },
        expectedLayoutVersion: null,
        index: 0,
      },
    });
    sendTransactionExpectingError(
      svm,
      tx,
      [market.lpOwner],
      "ExceededSlippage",
    );
  });

  it("rejects an empty claim and a slot outside the position", async () => {
    const opened = await openFundedPosition([RANGE_A]);

    await expect(
      client.position.compoundFees({
        ...positionAccounts(opened.nftMint),
        index: 0,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.AmountIsZero });

    await accrueFees();
    await expect(
      client.position.compoundFees({
        ...positionAccounts(opened.nftMint),
        index: 1,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    await expect(
      client.position.getClaimableFees({
        pool,
        nftMint: opened.nftMint,
        bitmap: liquidityBitmap([1]),
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
  });

  it("guards the deposit with the position layout version", async () => {
    const opened = await openFundedPosition([RANGE_A]);
    await accrueFees();

    const preview = await client.position.getClaimableFees({
      pool,
      nftMint: opened.nftMint,
    });
    const { tx } = await client.position.compoundFees({
      ...positionAccounts(opened.nftMint),
      index: 0,
      expectedLayoutVersion: preview.layoutVersion + 1,
    });
    sendTransactionExpectingError(
      svm,
      tx,
      [market.lpOwner],
      "InvalidLayoutVersion",
    );
  });

  it("redeposits only token Y once the price is above the slot", async () => {
    await openFundedPosition([RANGE_HIGH]);
    const opened = await openFundedPosition([RANGE_A]);
    await accrueFees();
    await pushPriceUntil("up", (tick) => tick >= RANGE_A.tickUpperId);

    await expect(
      client.position.compoundFees({
        ...positionAccounts(opened.nftMint),
        index: 0,
        maxAmountY: null,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.ExceededSlippage });

    const poolState = await client.state.fetchPool(pool);
    const before = await client.state.decodePositions(opened.position);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx, claimable } = await client.position.compoundFees({
      ...positionAccounts(opened.nftMint),
      index: 0,
    });
    expect(big(claimable.feeX)).toBeGreaterThan(0n);
    expect(big(claimable.feeY)).toBeGreaterThan(0n);
    sendTransaction(svm, tx, [market.lpOwner]);

    const liquidity = getLiquidityFromAmounts({
      maxTokenX: claimable.feeX,
      maxTokenY: claimable.feeY,
      tickLowerId: RANGE_A.tickLowerId,
      tickUpperId: RANGE_A.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const deposited = getAmountsFromLiquidity({
      liquidity,
      tickLowerId: RANGE_A.tickLowerId,
      tickUpperId: RANGE_A.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const after = await client.state.decodePositions(opened.position);
    expect(deposited.amountX.toString()).toBe("0");
    expect(big(deposited.amountY)).toBeGreaterThan(0n);
    expect(
      positionTotalLiquidity(after[0])
        .sub(positionTotalLiquidity(before[0]))
        .toString(),
    ).toBe(liquidity.toString());
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      claimable.feeX.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      claimable.feeY.sub(deposited.amountY).toString(),
    );
  });

  it("redeposits only token X once the price is below the slot", async () => {
    pool = (
      await initializeStaticPool(svm, client, {
        operator: market.operator,
        payer: market.payer,
        creator: market.creator.publicKey,
        tokenXMint: market.tokenXMint,
        tokenYMint: market.tokenYMint,
      })
    ).pool;
    const opened = await openFundedPosition([RANGE_A, RANGE_LOW]);
    await accrueFees();
    await pushPriceUntil("down", (tick) => tick < RANGE_A.tickLowerId);

    await expect(
      client.position.compoundFees({
        ...positionAccounts(opened.nftMint),
        index: 0,
        maxAmountX: null,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.ExceededSlippage });

    const poolState = await client.state.fetchPool(pool);
    const before = await client.state.decodePositions(opened.position);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx, claimable } = await client.position.compoundFees({
      ...positionAccounts(opened.nftMint),
      index: 0,
    });
    expect(big(claimable.feeX)).toBeGreaterThan(0n);
    expect(big(claimable.feeY)).toBeGreaterThan(0n);
    sendTransaction(svm, tx, [market.lpOwner]);

    const liquidity = getLiquidityFromAmounts({
      maxTokenX: claimable.feeX,
      maxTokenY: claimable.feeY,
      tickLowerId: RANGE_A.tickLowerId,
      tickUpperId: RANGE_A.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const deposited = getAmountsFromLiquidity({
      liquidity,
      tickLowerId: RANGE_A.tickLowerId,
      tickUpperId: RANGE_A.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const after = await client.state.decodePositions(opened.position);
    expect(deposited.amountY.toString()).toBe("0");
    expect(big(deposited.amountX)).toBeGreaterThan(0n);
    expect(
      positionTotalLiquidity(after[0])
        .sub(positionTotalLiquidity(before[0]))
        .toString(),
    ).toBe(liquidity.toString());
    expect(
      positionTotalLiquidity(after[1]).eq(positionTotalLiquidity(before[1])),
    ).toBe(true);
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      claimable.feeY.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      claimable.feeX.sub(deposited.amountX).toString(),
    );
  });
});
