import { BN } from "@coral-xyz/anchor";
import {
  createApproveInstruction,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  calculateTransferFeeExcludedAmount,
  deriveTickArray,
  DlmmProClient,
  findNftAccount,
  getAmountsFromLiquidity,
  getLiquidityFromAmounts,
  getSqrtPriceFromTickId,
  liquidityBitmap,
  PoolErrorCode,
  PositionDelegatePermission,
  positionDelegatePermissionMask,
  positionTotalLiquidity,
  type TickRange,
} from "../src";
import { readTransferFeeMint } from "../src/helpers/account_reads";
import { U64_MAX } from "../src/math";
import {
  accrueFees,
  approveNftDelegate,
  big,
  createAndFundWallet,
  createFundedMarket,
  createSvmConnection,
  createToken2022Mint,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  lpAccounts,
  mintSplTokenTo,
  openFundedPosition,
  openPosition,
  pushPrice,
  sendTransaction,
  sendTransactionExpectingError,
  type Market,
} from "./helpers";

const RANGE_A: TickRange = { tickLowerId: -64, tickUpperId: 64 };
const RANGE_B: TickRange = { tickLowerId: -16, tickUpperId: 16 };
const RANGE_ABOVE: TickRange = { tickLowerId: 200, tickUpperId: 264 };
const RANGE_HIGH: TickRange = { tickLowerId: 64, tickUpperId: 192 };
const RANGE_LOW: TickRange = { tickLowerId: -192, tickUpperId: -64 };
// A fresh pool opens at tick 0's exact sqrt price.
const RANGE_AT_PRICE: TickRange = { tickLowerId: 0, tickUpperId: 64 };
// A funded RANGE_A position holds 5M of each token, so this swap moves the
// price out of RANGE_A and into the range beyond it.
const CLEAR_RANGE_A = new BN(7_000_000);

describe("fee compounding", () => {
  const svm = initializeSVM();
  const client = new DlmmProClient(createSvmConnection(svm));

  let market: Market;

  beforeAll(async () => {
    market = await createFundedMarket({ svm, client });
  });

  it("previews claimable fees that match the on-chain claim", async () => {
    const pool = await initializeStaticPool(svm, client, market);
    await openFundedPosition(svm, client, market, pool, [RANGE_A]);
    await accrueFees(svm, client, market, pool);
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_A,
      RANGE_B,
    ]);
    await accrueFees(svm, client, market, pool);

    const { tx: refresh } = await client.position.refreshFeesAndRewards({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      bitmap: liquidityBitmap([1]),
      tickRanges: [RANGE_B],
    });
    sendTransaction(svm, refresh, [market.lpOwner]);

    // Push the price above RANGE_B so slot 1 stops earning and its upper tick
    // sits below the current tick when the growth inside is evaluated.
    await pushPrice(svm, client, market, pool, "up", new BN(10_000_000));
    expect(
      (await client.state.fetchPool(pool)).tickCurrentId,
    ).toBeGreaterThanOrEqual(RANGE_B.tickUpperId);
    await accrueFees(svm, client, market, pool);

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
      ...lpAccounts(market, pool, opened.nftMint),
      bitmap: liquidityBitmap([0]),
      tickRanges: [RANGE_A],
    });
    sendTransaction(svm, claimOne, [market.lpOwner]);
    expect(getTokenAmount(svm, market.lpTokenX).sub(xBefore).toString()).toBe(
      partial.feeX.toString(),
    );
    expect(getTokenAmount(svm, market.lpTokenY).sub(yBefore).toString()).toBe(
      partial.feeY.toString(),
    );

    await accrueFees(svm, client, market, pool);
    const full = await client.position.getClaimableFees({
      pool,
      nftMint: opened.nftMint,
    });
    expect(full.bitmap.eq(liquidityBitmap([0, 1]))).toBe(true);
    xBefore = getTokenAmount(svm, market.lpTokenX);
    yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx: claimAll } = await client.position.claimFee({
      ...lpAccounts(market, pool, opened.nftMint),
      bitmap: full.bitmap,
      tickRanges: [RANGE_A, RANGE_B],
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
    const pool = await initializeStaticPool(svm, client, market);
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_A,
      RANGE_B,
    ]);
    await accrueFees(svm, client, market, pool);

    const poolState = await client.state.fetchPool(pool);
    const before = await client.state.decodePositions(opened.position);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);

    const { tx, claimable, parameters } = await client.position.compoundFees({
      ...lpAccounts(market, pool, opened.nftMint),
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

  it("lets a delegate compound once the owner approves both token accounts", async () => {
    const pool = await initializeStaticPool(svm, client, market);
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_A,
    ]);
    await accrueFees(svm, client, market, pool);
    const delegate = createAndFundWallet(svm);
    const { tx: permissionTx } =
      await client.position.updatePositionDelegatePermission({
        nftMint: opened.nftMint,
        owner: market.lpOwner.publicKey,
        permission: positionDelegatePermissionMask([
          PositionDelegatePermission.ClaimFee,
          PositionDelegatePermission.AddLiquidity,
        ]),
      });
    sendTransaction(svm, permissionTx, [market.lpOwner]);
    approveNftDelegate(svm, {
      nftAccount: findNftAccount(opened.nftMint, market.lpOwner.publicKey),
      owner: market.lpOwner,
      delegate: delegate.publicKey,
    });
    const compound = {
      ...lpAccounts(market, pool, opened.nftMint),
      signer: delegate.publicKey,
      index: 0,
    };

    // The claim pays the owner's accounts and the deposit spends them with the
    // delegate as transfer authority.
    const { tx: unapproved } = await client.position.compoundFees(compound);
    sendTransactionExpectingError(
      svm,
      unapproved,
      [delegate],
      "owner does not match",
    );

    sendTransaction(
      svm,
      new Transaction().add(
        createApproveInstruction(
          market.lpTokenX,
          delegate.publicKey,
          market.lpOwner.publicKey,
          BigInt(U64_MAX.toString()),
        ),
        createApproveInstruction(
          market.lpTokenY,
          delegate.publicKey,
          market.lpOwner.publicKey,
          BigInt(U64_MAX.toString()),
        ),
      ),
      [market.lpOwner],
    );
    const before = await client.state.decodePositions(opened.position);
    const { tx } = await client.position.compoundFees(compound);
    sendTransaction(svm, tx, [delegate]);
    const after = await client.state.decodePositions(opened.position);
    expect(
      positionTotalLiquidity(after[0]).gt(positionTotalLiquidity(before[0])),
    ).toBe(true);
  });

  it("redeposits one side into a different slot above the price", async () => {
    const pool = await initializeStaticPool(svm, client, market);
    const opened = await openFundedPosition(
      svm,
      client,
      market,
      pool,
      [RANGE_A, RANGE_ABOVE],
      { fundedIndexes: [0] },
    );
    await accrueFees(svm, client, market, pool);

    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBeLessThan(RANGE_ABOVE.tickLowerId);
    const before = await client.state.decodePositions(opened.position);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);

    const { tx, claimable, parameters } = await client.position.compoundFees({
      ...lpAccounts(market, pool, opened.nftMint),
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
    // Slot 1 holds no liquidity yet, so the refresh leg reads none of its ticks.
    expect(claimable.tickRanges).toEqual([RANGE_A]);
    const refreshAccounts = tx.instructions[0].keys.map((key) =>
      key.pubkey.toBase58(),
    );
    expect(refreshAccounts).not.toContain(deriveTickArray(pool, 1).toBase58());
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

  it("rejects an empty claim and a slot outside the position", async () => {
    const pool = await initializeStaticPool(svm, client, market);
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_A,
    ]);

    await expect(
      client.position.compoundFees({
        ...lpAccounts(market, pool, opened.nftMint),
        index: 0,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.AmountIsZero });

    await accrueFees(svm, client, market, pool);
    await expect(
      client.position.compoundFees({
        ...lpAccounts(market, pool, opened.nftMint),
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
    const pool = await initializeStaticPool(svm, client, market);
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_A,
    ]);
    await accrueFees(svm, client, market, pool);

    const preview = await client.position.getClaimableFees({
      pool,
      nftMint: opened.nftMint,
    });
    const { tx } = await client.position.compoundFees({
      ...lpAccounts(market, pool, opened.nftMint),
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
    const pool = await initializeStaticPool(svm, client, market);
    await openFundedPosition(svm, client, market, pool, [RANGE_HIGH]);
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_A,
    ]);
    await accrueFees(svm, client, market, pool);
    await pushPrice(svm, client, market, pool, "up", CLEAR_RANGE_A);

    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBeGreaterThanOrEqual(RANGE_A.tickUpperId);
    const before = await client.state.decodePositions(opened.position);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx, claimable } = await client.position.compoundFees({
      ...lpAccounts(market, pool, opened.nftMint),
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
    const pool = await initializeStaticPool(svm, client, market);
    const opened = await openFundedPosition(svm, client, market, pool, [
      RANGE_A,
      RANGE_LOW,
    ]);
    await accrueFees(svm, client, market, pool);
    await pushPrice(svm, client, market, pool, "down", CLEAR_RANGE_A);

    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBeLessThan(RANGE_A.tickLowerId);
    const before = await client.state.decodePositions(opened.position);
    const xBefore = getTokenAmount(svm, market.lpTokenX);
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const { tx, claimable } = await client.position.compoundFees({
      ...lpAccounts(market, pool, opened.nftMint),
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

  it("skips token Y for a slot whose lower tick is the current price", async () => {
    const pool = await initializeStaticPool(svm, client, market);
    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickCurrentId).toBe(RANGE_AT_PRICE.tickLowerId);
    expect(poolState.sqrtPrice.toString()).toBe(
      getSqrtPriceFromTickId(RANGE_AT_PRICE.tickLowerId).toString(),
    );
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE_AT_PRICE],
    });
    const yBefore = getTokenAmount(svm, market.lpTokenY);
    const maxAmountX = new BN(1_000);

    const { tx } = await client.position.compoundFees({
      ...lpAccounts(market, pool, opened.nftMint),
      index: 0,
      maxAmountX,
      maxAmountY: null,
    });
    sendTransaction(svm, tx, [market.lpOwner]);

    const liquidity = getLiquidityFromAmounts({
      maxTokenX: maxAmountX,
      maxTokenY: new BN(0),
      tickLowerId: RANGE_AT_PRICE.tickLowerId,
      tickUpperId: RANGE_AT_PRICE.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const [slot] = await client.state.decodePositions(opened.position);
    expect(positionTotalLiquidity(slot).toString()).toBe(liquidity.toString());
    expect(getTokenAmount(svm, market.lpTokenY).eq(yBefore)).toBe(true);
  });

  it("caps a transfer-fee redeposit at what the claim delivers", async () => {
    const tokenXMint = createToken2022Mint(svm, market.payer, [
      {
        type: ExtensionType.TransferFeeConfig,
        transferFeeBasisPoints: 100,
        maximumFee: 1_000_000_000n,
      },
    ]);
    const [lpTokenX, swapperTokenX] = [market.lpOwner, market.swapper].map(
      (owner) =>
        mintSplTokenTo(
          svm,
          market.payer,
          tokenXMint,
          owner.publicKey,
          TOKEN_2022_PROGRAM_ID,
        ),
    );
    const feeMarket = { ...market, tokenXMint, lpTokenX, swapperTokenX };
    const pool = await initializeStaticPool(svm, client, feeMarket);
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: [RANGE_A, RANGE_ABOVE],
    });
    const accounts = lpAccounts(feeMarket, pool, opened.nftMint);
    const { tx: depositTx } = await client.position.addLiquidityImbalance({
      ...accounts,
      tickRanges: [RANGE_A],
      parameters: {
        maxAmountX: new BN(5_000_000),
        maxAmountY: new BN(5_000_000),
        slippage: { sqrtPriceSlippage: null, minLiquidity: null },
        expectedLayoutVersion: null,
        index: 0,
      },
    });
    sendTransaction(svm, depositTx, [market.lpOwner]);
    await pushPrice(svm, client, feeMarket, pool, "down", new BN(2_000_000));
    await pushPrice(svm, client, feeMarket, pool, "up", new BN(2_000_000));

    const poolState = await client.state.fetchPool(pool);
    const xBefore = getTokenAmount(svm, lpTokenX);
    const { tx, claimable, parameters } = await client.position.compoundFees({
      ...accounts,
      index: 1,
      maxAmountY: null,
    });
    const mintX = await readTransferFeeMint(client.connection, tokenXMint);
    const epoch = BigInt(svm.getClock().epoch);
    const claimedX = calculateTransferFeeExcludedAmount(
      mintX,
      epoch,
      claimable.feeX,
    ).amount;
    expect(big(claimedX)).toBeLessThan(big(claimable.feeX));
    expect(parameters.maxAmountX?.toString()).toBe(claimedX.toString());
    sendTransaction(svm, tx, [market.lpOwner]);

    // The deposit leg pays the transfer fee again on its way into the pool.
    const liquidity = getLiquidityFromAmounts({
      maxTokenX: calculateTransferFeeExcludedAmount(mintX, epoch, claimedX)
        .amount,
      maxTokenY: new BN(0),
      tickLowerId: RANGE_ABOVE.tickLowerId,
      tickUpperId: RANGE_ABOVE.tickUpperId,
      tickCurrentId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
    });
    const [, slot] = await client.state.decodePositions(opened.position);
    expect(positionTotalLiquidity(slot).toString()).toBe(liquidity.toString());
    expect(big(getTokenAmount(svm, lpTokenX))).toBeGreaterThanOrEqual(
      big(xBefore),
    );
  });
});
