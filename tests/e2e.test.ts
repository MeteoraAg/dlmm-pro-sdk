import { BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  derivePosition,
  deriveReserve,
  DlmmProClient,
  getAmountsFromLiquidity,
  getDeltaAmountX,
  getDeltaAmountY,
  getLiquidityFromAmounts,
  getNextSqrtPriceFromInput,
  Rounding,
} from "../src";
import {
  accountExists,
  addLiquidity,
  big,
  claimFee,
  closePosition,
  createFundedMarket,
  createSvmConnection,
  DEFAULT_TICK_RANGES,
  DEFAULT_TICK_SPACING,
  getPositionTotalLiquidity,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  openPosition,
  removeLiquidity,
  swap,
} from "./helpers";

describe("e2e", () => {
  const svm = initializeSVM();
  const client = DlmmProClient.create(createSvmConnection(svm));
  const tickRanges = DEFAULT_TICK_RANGES;
  const tickSpacing = DEFAULT_TICK_SPACING;
  const tickLowerId = tickRanges[0].tickLowerId;
  const tickUpperId = tickRanges[0].tickUpperId;

  let market: Awaited<ReturnType<typeof createFundedMarket>>;
  let pool: PublicKey;
  let nftMint: PublicKey;

  it("creates a pool", async () => {
    market = await createFundedMarket({ svm, client });
    const initialized = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    pool = initialized.pool;
    expect(accountExists(svm, pool)).toBe(true);
    expect(accountExists(svm, initialized.oracle)).toBe(true);
    await expect(
      client.state.fetchPool(market.payer.publicKey),
    ).rejects.toThrow(/not owned by the DLMM Pro program/);
    await expect(
      client.accessRegistry.fetchTokenBadge(market.payer.publicKey),
    ).rejects.toThrow(/not owned by the access-registry program/);
  });

  it("opens a position", async () => {
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges,
      tickSpacing,
    });
    nftMint = opened.nftMint;
    expect(accountExists(svm, opened.position)).toBe(true);
    expect(accountExists(svm, nftMint)).toBe(true);
  });

  it("adds liquidity", async () => {
    const maxToken = new BN(50_000);
    await addLiquidity(svm, client, {
      pool,
      nftMint,
      signer: market.lpOwner,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      tickSpacing,
      deposits: [
        { positionIndex: 0, maxTokenX: maxToken, maxTokenY: maxToken },
      ],
    });

    const poolState = await client.state.fetchPool(pool);
    const liquidity = getLiquidityFromAmounts({
      maxTokenX: maxToken,
      maxTokenY: maxToken,
      tickLowerId,
      tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const amounts = getAmountsFromLiquidity({
      liquidity,
      tickLowerId,
      tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });

    expect(
      getTokenAmount(svm, deriveReserve(market.tokenXMint, pool)).toString(),
    ).toBe(amounts.amountX.toString());
    expect(
      getTokenAmount(svm, deriveReserve(market.tokenYMint, pool)).toString(),
    ).toBe(amounts.amountY.toString());
    expect(amounts.amountX.toString()).toBe(maxToken.toString());
    expect(amounts.amountY.toString()).toBe(maxToken.toString());
  });

  it("swaps Y to X", async () => {
    const xBefore = getTokenAmount(svm, market.swapperTokenX);
    const yBefore = getTokenAmount(svm, market.swapperTokenY);
    const inputAmount = new BN(5_000);
    const poolBefore = await client.state.fetchPool(pool);

    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenY,
      userTokenOut: market.swapperTokenX,
      inputAmount,
    });

    expect(
      yBefore.sub(getTokenAmount(svm, market.swapperTokenY)).eq(inputAmount),
    ).toBe(true);

    const noFeeSqrtPrice = getNextSqrtPriceFromInput(
      poolBefore.sqrtPrice,
      poolBefore.liquidity,
      inputAmount,
      false,
    );
    const noFeeOutput = getDeltaAmountX(
      poolBefore.sqrtPrice,
      noFeeSqrtPrice,
      poolBefore.liquidity,
      Rounding.Down,
    );
    const output = getTokenAmount(svm, market.swapperTokenX).sub(xBefore);
    expect(big(output)).toBeGreaterThan(0n);
    expect(big(output)).toBeLessThanOrEqual(big(noFeeOutput));
  });

  it("swaps X to Y", async () => {
    const xBefore = getTokenAmount(svm, market.swapperTokenX);
    const yBefore = getTokenAmount(svm, market.swapperTokenY);
    const inputAmount = new BN(5_000);
    const poolBefore = await client.state.fetchPool(pool);

    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenX,
      userTokenOut: market.swapperTokenY,
      inputAmount,
    });

    expect(
      xBefore.sub(getTokenAmount(svm, market.swapperTokenX)).eq(inputAmount),
    ).toBe(true);

    const noFeeSqrtPrice = getNextSqrtPriceFromInput(
      poolBefore.sqrtPrice,
      poolBefore.liquidity,
      inputAmount,
      true,
    );
    const noFeeOutput = getDeltaAmountY(
      noFeeSqrtPrice,
      poolBefore.sqrtPrice,
      poolBefore.liquidity,
      Rounding.Down,
    );
    const output = getTokenAmount(svm, market.swapperTokenY).sub(yBefore);
    expect(big(output)).toBeGreaterThan(0n);
    expect(big(output)).toBeLessThanOrEqual(big(noFeeOutput));
  });

  it("claims swap fees", async () => {
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const poolState = await client.state.fetchPool(pool);
    const liquidity = await getPositionTotalLiquidity(client, nftMint);

    // The sole position spans the active range and its fee checkpoints are
    // zero, so its fee growth inside equals the pool's global fee growth and
    // the claim is exactly liquidity * feeGrowthGlobal >> 64.
    const expectedX = poolState.feeGrowthGlobalX.mul(liquidity).shrn(64);
    const expectedY = poolState.feeGrowthGlobalY.mul(liquidity).shrn(64);

    await claimFee(svm, client, {
      pool,
      nftMint,
      signer: market.lpOwner,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      tickSpacing,
    });

    expect(big(expectedX)).toBeGreaterThan(0n);
    expect(big(expectedY)).toBeGreaterThan(0n);
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      expectedX.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      expectedY.toString(),
    );
  });

  it("removes liquidity", async () => {
    const liquidity = await getPositionTotalLiquidity(client, nftMint);
    expect(big(liquidity)).toBeGreaterThan(0n);

    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const poolState = await client.state.fetchPool(pool);
    const expected = getAmountsFromLiquidity({
      liquidity: liquidity.neg(),
      tickLowerId,
      tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });

    await removeLiquidity(svm, client, {
      pool,
      nftMint,
      signer: market.lpOwner,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: market.lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges,
      tickSpacing,
      withdrawals: [{ positionIndex: 0, liquidity }],
    });

    expect((await getPositionTotalLiquidity(client, nftMint)).isZero()).toBe(
      true,
    );
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      expected.amountX.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      expected.amountY.toString(),
    );
  });

  it("closes the position", async () => {
    const position = derivePosition(nftMint);
    const nftAccount = getAssociatedTokenAddressSync(
      nftMint,
      market.lpOwner.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID,
    );
    const lamportsBefore = svm.getBalance(market.lpOwner.publicKey) ?? 0n;

    await closePosition(svm, client, {
      pool,
      nftMint,
      owner: market.lpOwner,
      rentReceiver: market.lpOwner.publicKey,
      tickRanges,
      tickSpacing,
    });

    expect(accountExists(svm, position)).toBe(false);
    expect(accountExists(svm, nftMint)).toBe(false);
    expect(accountExists(svm, nftAccount)).toBe(false);
    expect(
      (svm.getBalance(market.lpOwner.publicKey) ?? 0n) > lamportsBefore,
    ).toBe(true);
  });
});
