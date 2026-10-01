import { BN } from "@coral-xyz/anchor";
import {
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  ExtensionType,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  AccessRegistryOperatorPermission,
  calculateTransferFeeExcludedAmount,
  CollectFeeMode,
  DlmmProClient,
  getFeeSetting,
  getLiquidityFromAmounts,
  liquidityBitmap,
  multiplierFromAmounts,
  PoolErrorCode,
  quoteExactIn,
  tickArraysForSwap,
  type DecodedTick,
  type DynamicFeeParameters,
  type QuoteExactInParams,
  type QuoteExactInResult,
  type QuoteTickArray,
  type TickRange,
} from "../src";
import {
  addLiquidity,
  createAccessRegistryOperator,
  createAndFundWallet,
  createDynamicConfig,
  createFundedMarket,
  createSvmConnection,
  createTokenBadge,
  defaultDynamicPoolParameters,
  defaultStaticConfigArgs,
  getOrCreateAssociatedTokenAccount,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  mintSplTokenTo,
  openPosition,
  randomID,
  sendTransaction,
  SQRT_PRICE_ONE,
  warpToTime,
} from "./helpers";
import type { LiteSVM } from "litesvm";

const SEED_RANGES: TickRange[] = [
  { tickLowerId: -120, tickUpperId: 120 },
  { tickLowerId: -256, tickUpperId: -128 },
];
const TICK_SPACING = 1;

type Market = Awaited<ReturnType<typeof createFundedMarket>>;

async function seedLiquidity(
  svm: LiteSVM,
  client: DlmmProClient,
  market: Market,
  pool: PublicKey,
): Promise<void> {
  const opened = await openPosition(svm, client, {
    pool,
    owner: market.lpOwner.publicKey,
    payer: market.payer,
    tickRanges: SEED_RANGES,
    tickSpacing: TICK_SPACING,
  });
  await addLiquidity(svm, client, {
    pool,
    nftMint: opened.nftMint,
    signer: market.lpOwner,
    tokenXMint: market.tokenXMint,
    tokenYMint: market.tokenYMint,
    userTokenX: market.lpTokenX,
    userTokenY: market.lpTokenY,
    tickRanges: SEED_RANGES,
    tickSpacing: TICK_SPACING,
    deposits: [
      {
        positionIndex: 0,
        maxTokenX: new BN(10_000),
        maxTokenY: new BN(10_000),
      },
      { positionIndex: 1, maxTokenX: new BN(0), maxTokenY: new BN(200_000) },
    ],
  });
}

/**
 * Quote, swap, and compare user transfers, pool price state and the fee split
 * (protocol, partner, host) against the quote. `referral`, when given, must be
 * a token account of the mint the pool collects fees in.
 */
async function assertQuoteMatchesExecution(
  svm: LiteSVM,
  client: DlmmProClient,
  market: Market,
  pool: PublicKey,
  inputAmount: BN,
  swapForY: boolean,
  referral?: PublicKey,
): Promise<QuoteExactInResult> {
  const { quote, tickArrays, tickArrayBitmapExtension } =
    await client.pool.quoteExactIn({
      pool,
      inputAmount,
      swapForY,
      swapper: market.swapper.publicKey,
      hasReferral: referral !== undefined,
    });
  expect(quote.amountLeft.toString()).toBe("0");
  expect(quote.outAmount.gtn(0)).toBe(true);

  const [inAccount, outAccount] = swapForY
    ? [market.swapperTokenX, market.swapperTokenY]
    : [market.swapperTokenY, market.swapperTokenX];
  const inBefore = getTokenAmount(svm, inAccount);
  const outBefore = getTokenAmount(svm, outAccount);
  const referralBefore = referral ? getTokenAmount(svm, referral) : null;
  const poolBefore = await client.state.fetchPool(pool);
  const { feesOnTokenX } = getFeeSetting(
    poolBefore,
    swapForY,
    referral !== undefined,
  );

  const { tx } = await client.pool.swap({
    pool,
    tokenXMint: market.tokenXMint,
    tokenYMint: market.tokenYMint,
    userTokenIn: inAccount,
    userTokenOut: outAccount,
    user: market.swapper.publicKey,
    referral,
    parameters: {
      inputAmount,
      minimumOutputAmount: quote.transferFeeExcludedOutAmount,
    },
    tickArrays,
    tickArrayBitmapExtension,
  });
  sendTransaction(svm, tx, [market.swapper]);

  const paid = inBefore.sub(getTokenAmount(svm, inAccount));
  const received = getTokenAmount(svm, outAccount).sub(outBefore);
  const poolAfter = await client.state.fetchPool(pool);

  // Compared as one object so a mismatch shows the whole quote-vs-chain diff.
  expect({
    paid: paid.toString(),
    received: received.toString(),
    sqrtPrice: poolAfter.sqrtPrice.toString(),
    tickCurrentId: poolAfter.tickCurrentId,
    liquidity: poolAfter.liquidity.toString(),
  }).toEqual({
    paid: inputAmount.toString(),
    received: quote.transferFeeExcludedOutAmount.toString(),
    sqrtPrice: quote.nextSqrtPrice.toString(),
    tickCurrentId: quote.nextTickId,
    liquidity: quote.nextLiquidity.toString(),
  });

  const zero = new BN(0);
  const [protocolX, protocolY] = feesOnTokenX
    ? [quote.protocolFee, zero]
    : [zero, quote.protocolFee];
  const [partnerX, partnerY] = feesOnTokenX
    ? [quote.partnerFee, zero]
    : [zero, quote.partnerFee];
  expect({
    protocolFeeX: poolAfter.protocolFeeX
      .sub(poolBefore.protocolFeeX)
      .toString(),
    protocolFeeY: poolAfter.protocolFeeY
      .sub(poolBefore.protocolFeeY)
      .toString(),
    partnerFeeX: poolAfter.poolPartner.pendingFeeX
      .sub(poolBefore.poolPartner.pendingFeeX)
      .toString(),
    partnerFeeY: poolAfter.poolPartner.pendingFeeY
      .sub(poolBefore.poolPartner.pendingFeeY)
      .toString(),
    untouchedFeeGrowth: feesOnTokenX
      ? poolAfter.feeGrowthGlobalY.eq(poolBefore.feeGrowthGlobalY)
      : poolAfter.feeGrowthGlobalX.eq(poolBefore.feeGrowthGlobalX),
  }).toEqual({
    protocolFeeX: protocolX.toString(),
    protocolFeeY: protocolY.toString(),
    partnerFeeX: partnerX.toString(),
    partnerFeeY: partnerY.toString(),
    untouchedFeeGrowth: true,
  });

  if (referral && referralBefore) {
    // The host fee leaves the reserve as a transfer, so the referral receives
    // it net of that mint's transfer fee.
    const feeMint = feesOnTokenX ? market.tokenXMint : market.tokenYMint;
    const feeMintInfo = await client.connection.getAccountInfo(feeMint);
    const expectedHostFee = calculateTransferFeeExcludedAmount(
      unpackMint(feeMint, feeMintInfo!, feeMintInfo!.owner),
      BigInt(svm.getClock().epoch),
      quote.hostFee,
    ).amount;
    expect(quote.hostFee.gtn(0), "swap too small to produce a host fee").toBe(
      true,
    );
    expect(getTokenAmount(svm, referral).sub(referralBefore).toString()).toBe(
      expectedHostFee.toString(),
    );
  } else {
    expect(quote.hostFee.toString()).toBe("0");
  }
  return quote;
}

describe("quoteExactIn matches on-chain swap", () => {
  it("across tick arrays in both directions", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    await seedLiquidity(svm, client, market, pool);

    await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(50_000),
      true,
    );
    await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(30_000),
      false,
    );
    await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(1_234),
      true,
    );
  });

  it("with dynamic fee enabled", async () => {
    const svm = initializeSVM();
    // LiteSVM's clock starts at unix_timestamp 0; the dynamic-fee reference
    // update assumes elapsed time since the epoch exceeds the filter period.
    warpToTime(svm, 1_755_000_000n);
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });

    const dynamicFeeParameter: DynamicFeeParameters = {
      maxVolatilityAccumulator: 350_000,
      variableFeeControl: 2_000_000,
      filterPeriod: 30,
      decayPeriod: 600,
      reductionFactor: 5_000,
    };
    const configArgs = defaultStaticConfigArgs();
    configArgs.poolFees.dynamicFeeParameter = dynamicFeeParameter;
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      configArgs,
    });
    await seedLiquidity(svm, client, market, pool);

    // consecutive swaps so the volatility accumulator kicks in
    await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(50_000),
      true,
    );
    await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(20_000),
      true,
    );
    await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(40_000),
      false,
    );
  });

  it("binds only the tick arrays the traversal reaches to the pool", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    await seedLiquidity(svm, client, market, pool);

    const poolState = await client.state.fetchPool(pool);
    const selection = tickArraysForSwap({ pool, poolState, swapForY: true });
    const tickArrays: QuoteTickArray[] = (
      await client.state.fetchTickArraysWithTicks(selection.tickArrays, {
        withReward: false,
      })
    ).map(({ tickArray, ticks }) => ({
      pool: tickArray.pool,
      tickIndex: tickArray.tickIndex,
      ticks: ticks as DecodedTick[],
    }));
    const clock = svm.getClock();
    const params: QuoteExactInParams = {
      poolAddress: pool,
      pool: poolState,
      tickArrays,
      inputAmount: new BN(1_000),
      swapForY: true,
      hasReferral: false,
      currentSlot: new BN(clock.slot.toString()),
      currentTimestamp: new BN(clock.unixTimestamp.toString()),
      epoch: clock.epoch,
    };
    const baseline = quoteExactIn(params);
    expect(baseline.postSwapActivations).toEqual([]);
    const foreign = Keypair.generate().publicKey;

    // An array at an index the bitmap walk never visits is skipped unread.
    const unreached = quoteExactIn({
      ...params,
      tickArrays: [...tickArrays, { pool: foreign, tickIndex: 999, ticks: [] }],
    });
    expect(unreached.outAmount.toString()).toBe(baseline.outAmount.toString());

    expect(() =>
      quoteExactIn({
        ...params,
        tickArrays: [
          { ...tickArrays[0], pool: foreign },
          ...tickArrays.slice(1),
        ],
      }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidTickArray }),
    );
  });

  it("accepts a referral account equal to the output token account", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    await seedLiquidity(svm, client, market, pool);

    const inputAmount = new BN(50_000);
    const outBefore = getTokenAmount(svm, market.swapperTokenY);
    const { quote, tickArrays, tickArrayBitmapExtension } =
      await client.pool.quoteExactIn({
        pool,
        inputAmount,
        swapForY: true,
        hasReferral: true,
        swapper: market.swapper.publicKey,
      });
    const { tx: swapTx } = await client.pool.swap({
      pool,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenX,
      userTokenOut: market.swapperTokenY,
      user: market.swapper.publicKey,
      referral: market.swapperTokenY,
      parameters: {
        inputAmount,
        minimumOutputAmount: new BN(0),
      },
      tickArrays,
      tickArrayBitmapExtension,
    });
    sendTransaction(svm, swapTx, [market.swapper]);
    expect(getTokenAmount(svm, market.swapperTokenY).gt(outBefore)).toBe(true);
    expect(quote.outAmount.gtn(0)).toBe(true);
  });

  it("splits fees to the partner and referral", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });

    // The dynamic config's creator authority becomes the pool partner.
    const config = await createDynamicConfig(
      svm,
      client.connection,
      market.operator,
      market.payer,
      randomID(),
      market.creator.publicKey,
      { permission: new BN(0), partnerFeeBps: 2_500 },
    );
    const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
      config,
      poolCreatorAuthority: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      creator: market.creator.publicKey,
      payer: market.payer.publicKey,
      parameters: defaultDynamicPoolParameters(SQRT_PRICE_ONE),
    });
    sendTransaction(svm, tx, [market.payer, market.creator]);
    await seedLiquidity(svm, client, market, pool);

    // Fees are collected in the output token, so the referral holds that mint.
    const sold = await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(100_000),
      true,
      market.lpTokenY,
    );
    expect(sold.partnerFee.gtn(0)).toBe(true);
    const bought = await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(60_000),
      false,
      market.lpTokenX,
    );
    expect(bought.partnerFee.gtn(0)).toBe(true);
  });

  it("with fees collected on token Y only", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });

    // A non-whitelisted quote mint needs a token badge for OnlyY.
    const registryOperator = createAndFundWallet(svm);
    await createAccessRegistryOperator(
      svm,
      client.connection,
      market.admin,
      registryOperator.publicKey,
      [AccessRegistryOperatorPermission.CreateTokenBadge],
    );
    const tokenBadgeY = await createTokenBadge(svm, client.connection, {
      tokenMint: market.tokenYMint,
      signer: registryOperator,
      payer: market.payer,
    });
    const configArgs = defaultStaticConfigArgs();
    configArgs.collectFeeMode = CollectFeeMode.OnlyY;
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      configArgs,
      tokenBadgeY,
    });
    await seedLiquidity(svm, client, market, pool);

    // X -> Y takes the fee from the Y output, Y -> X from the Y input.
    await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(50_000),
      true,
    );
    await assertQuoteMatchesExecution(
      svm,
      client,
      market,
      pool,
      new BN(30_000),
      false,
    );
  });

  it("with a token-2022 transfer-fee mint on both swap directions", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });

    // token X: token-2022 mint with a 1% transfer fee
    const mintKp = Keypair.generate();
    const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
    const lamports = svm.minimumBalanceForRentExemption(BigInt(mintLen));
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: market.payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        lamports: Number(lamports),
        space: mintLen,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mintKp.publicKey,
        market.payer.publicKey,
        market.payer.publicKey,
        100,
        1_000_000_000n,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMint2Instruction(
        mintKp.publicKey,
        6,
        market.payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    sendTransaction(svm, tx, [market.payer, mintKp]);
    const tokenXMint = mintKp.publicKey;

    const lpTokenX = mintSplTokenTo(
      svm,
      market.payer,
      tokenXMint,
      market.lpOwner.publicKey,
      TOKEN_2022_PROGRAM_ID,
    );
    const swapperTokenX = mintSplTokenTo(
      svm,
      market.payer,
      tokenXMint,
      market.swapper.publicKey,
      TOKEN_2022_PROGRAM_ID,
    );
    getOrCreateAssociatedTokenAccount(
      svm,
      market.payer,
      tokenXMint,
      market.swapper.publicKey,
      TOKEN_2022_PROGRAM_ID,
    );

    const feeMarket = {
      ...market,
      tokenXMint,
      lpTokenX,
      swapperTokenX,
    };

    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint,
      tokenYMint: market.tokenYMint,
    });

    // Seed with explicit liquidity so the transfer-fee-included deposit
    // amounts stay within the max bounds.
    const opened = await openPosition(svm, client, {
      pool,
      owner: market.lpOwner.publicKey,
      payer: market.payer,
      tickRanges: SEED_RANGES,
      tickSpacing: TICK_SPACING,
    });
    const poolState = await client.state.fetchPool(pool);
    const mintAccount = await client.connection.getAccountInfo(tokenXMint);
    const mintX = unpackMint(tokenXMint, mintAccount!, TOKEN_2022_PROGRAM_ID);
    const sizingArgs = {
      ranges: [{ ...SEED_RANGES[0], weight: 1 }],
      tickSpacing: TICK_SPACING,
      currentTickId: poolState.tickCurrentId,
      currentSqrtPrice: poolState.sqrtPrice,
      amountX: new BN(100_000),
      amountY: new BN(100_000),
      mintY: null,
      epoch: BigInt(svm.getClock().epoch),
    };
    expect(
      multiplierFromAmounts({ ...sizingArgs, mintX }).lt(
        multiplierFromAmounts({ ...sizingArgs, mintX: null }),
      ),
    ).toBe(true);
    const liquidities = [
      getLiquidityFromAmounts({
        maxTokenX: new BN(10_000),
        maxTokenY: new BN(10_000),
        tickLowerId: SEED_RANGES[0].tickLowerId,
        tickUpperId: SEED_RANGES[0].tickUpperId,
        tickCurrentId: poolState.tickCurrentId,
        currentSqrtPrice: poolState.sqrtPrice,
      }),
      getLiquidityFromAmounts({
        maxTokenX: new BN(0),
        maxTokenY: new BN(200_000),
        tickLowerId: SEED_RANGES[1].tickLowerId,
        tickUpperId: SEED_RANGES[1].tickUpperId,
        tickCurrentId: poolState.tickCurrentId,
        currentSqrtPrice: poolState.sqrtPrice,
      }),
    ];
    const { tx: addTx } = await client.position.addLiquidity({
      pool,
      nftMint: opened.nftMint,
      owner: market.lpOwner.publicKey,
      signer: market.lpOwner.publicKey,
      tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenX: lpTokenX,
      userTokenY: market.lpTokenY,
      tickRanges: SEED_RANGES,
      tickSpacing: TICK_SPACING,
      tickArrayBitmapExtension: null,
      parameters: {
        // headroom for the 1% transfer fee on the X deposit
        maxAmountX: new BN(11_000),
        maxAmountY: new BN(210_000),
        expectedLayoutVersion: null,
        bitmap: liquidityBitmap([0, 1]),
        liquidities,
      },
    });
    sendTransaction(svm, addTx, [market.lpOwner]);

    // X -> Y: transfer fee reduces the pool-side input
    await assertQuoteMatchesExecution(
      svm,
      client,
      feeMarket,
      pool,
      new BN(50_000),
      true,
    );
    // Y -> X: transfer fee reduces what the user receives
    await assertQuoteMatchesExecution(
      svm,
      client,
      feeMarket,
      pool,
      new BN(30_000),
      false,
    );
  });
});
