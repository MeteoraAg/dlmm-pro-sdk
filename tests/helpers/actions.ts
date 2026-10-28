import { BN } from "@coral-xyz/anchor";
import { AccountLayout } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import type { LiteSVM, TransactionMetadata } from "litesvm";
import {
  derivePosition,
  deriveTickArrayBitmapExtension,
  DlmmProClient,
  getLiquidityFromAmounts,
  liquidityBitmap,
  OperatorPermission,
  positionTotalLiquidity,
  tickArraysForSwap,
  type StaticConfigParameters,
  type TickRange,
} from "../../src";
import { DEFAULT_TICK_RANGES, SQRT_PRICE_ONE } from "./constants";
import { createStaticConfig, createWhitelistOperator } from "./operator";
import { nextConfigIndex } from "./setup";
import { createAndFundWallet, sendTransaction } from "./svm";
import { createToken, mintSplTokenTo } from "./token";

/** Wallets and token accounts for one pair of SPL mints. */
export type Market = {
  admin: Keypair;
  operator: Keypair;
  payer: Keypair;
  creator: Keypair;
  lpOwner: Keypair;
  swapper: Keypair;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  lpTokenX: PublicKey;
  lpTokenY: PublicKey;
  swapperTokenX: PublicKey;
  swapperTokenY: PublicKey;
  operatorPda: PublicKey;
};

const SEED_AMOUNT = new BN(1_000_000_000);
const FUNDED_AMOUNT = new BN(5_000_000);
const FEE_ACCRUAL_SWAP = new BN(200_000);

export type Deposit = {
  positionIndex: number;
  maxTokenX: BN;
  maxTokenY: BN;
};

export async function openPosition(
  svm: LiteSVM,
  client: DlmmProClient,
  args: {
    pool: PublicKey;
    owner: PublicKey;
    payer: Keypair;
    tickRanges: TickRange[];
  },
): Promise<{
  nftMint: PublicKey;
  nftMintKp: Keypair;
  position: PublicKey;
  nftAccount: PublicKey;
}> {
  const nftMintKp = Keypair.generate();
  const { tx, position, nftAccount } = await client.position.openPosition({
    pool: args.pool,
    owner: args.owner,
    payer: args.payer.publicKey,
    nftMint: nftMintKp.publicKey,
    tickRanges: args.tickRanges,
  });
  sendTransaction(svm, tx, [args.payer, nftMintKp]);
  return {
    nftMint: nftMintKp.publicKey,
    nftMintKp,
    position,
    nftAccount,
  };
}

export async function addLiquidity(
  svm: LiteSVM,
  client: DlmmProClient,
  args: {
    pool: PublicKey;
    nftMint: PublicKey;
    signer: Keypair;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    userTokenX: PublicKey;
    userTokenY: PublicKey;
    tickRanges: TickRange[];
    deposits: Deposit[];
  },
): Promise<Transaction> {
  const poolState = await client.state.fetchPool(args.pool);
  let maxAmountX = new BN(0);
  let maxAmountY = new BN(0);
  const liquidities: BN[] = [];
  const indexes: number[] = [];

  const sorted = [...args.deposits].sort(
    (a, b) => a.positionIndex - b.positionIndex,
  );
  for (const deposit of sorted) {
    const range = args.tickRanges[deposit.positionIndex];
    liquidities.push(
      getLiquidityFromAmounts({
        maxTokenX: deposit.maxTokenX,
        maxTokenY: deposit.maxTokenY,
        tickLowerId: range.tickLowerId,
        tickUpperId: range.tickUpperId,
        tickCurrentId: poolState.tickCurrentId,
        currentSqrtPrice: poolState.sqrtPrice,
      }),
    );
    indexes.push(deposit.positionIndex);
    maxAmountX = maxAmountX.add(deposit.maxTokenX);
    maxAmountY = maxAmountY.add(deposit.maxTokenY);
  }

  const { tx } = await client.position.addLiquidity({
    pool: args.pool,
    nftMint: args.nftMint,
    owner: args.signer.publicKey,
    signer: args.signer.publicKey,
    tokenXMint: args.tokenXMint,
    tokenYMint: args.tokenYMint,
    userTokenX: args.userTokenX,
    userTokenY: args.userTokenY,
    tickRanges: args.tickRanges,
    parameters: {
      maxAmountX,
      maxAmountY,
      expectedLayoutVersion: null,
      bitmap: liquidityBitmap(indexes),
      liquidities,
    },
  });
  sendTransaction(svm, tx, [args.signer]);
  return tx;
}

export async function removeLiquidity(
  svm: LiteSVM,
  client: DlmmProClient,
  args: {
    pool: PublicKey;
    nftMint: PublicKey;
    signer: Keypair;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    userTokenX: PublicKey;
    userTokenY: PublicKey;
    tickRanges: TickRange[];
    withdrawals: { positionIndex: number; liquidity: BN }[];
  },
): Promise<void> {
  const sorted = [...args.withdrawals].sort(
    (a, b) => a.positionIndex - b.positionIndex,
  );
  const { tx } = await client.position.removeLiquidity({
    pool: args.pool,
    nftMint: args.nftMint,
    owner: args.signer.publicKey,
    signer: args.signer.publicKey,
    tokenXMint: args.tokenXMint,
    tokenYMint: args.tokenYMint,
    userTokenX: args.userTokenX,
    userTokenY: args.userTokenY,
    tickRanges: args.tickRanges,
    parameters: {
      minAmountX: new BN(0),
      minAmountY: new BN(0),
      expectedLayoutVersion: null,
      bitmap: liquidityBitmap(sorted.map((item) => item.positionIndex)),
      liquidities: sorted.map((item) => item.liquidity),
    },
  });
  sendTransaction(svm, tx, [args.signer]);
}

export async function swap(
  svm: LiteSVM,
  client: DlmmProClient,
  args: {
    pool: PublicKey;
    user: Keypair;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    userTokenIn: PublicKey;
    userTokenOut: PublicKey;
    inputAmount: BN;
    minimumOutputAmount?: BN;
  },
): Promise<TransactionMetadata> {
  const poolState = await client.state.fetchPool(args.pool);
  const extensionState =
    poolState.isBitmapExtensionInitialized === 1
      ? await client.state.fetchTickArrayBitmapExtension(
          deriveTickArrayBitmapExtension(args.pool),
        )
      : null;
  const outAccount = svm.getAccount(args.userTokenOut);
  if (!outAccount) {
    throw new Error(`token account not found: ${args.userTokenOut.toBase58()}`);
  }
  const swapForY = AccountLayout.decode(
    Buffer.from(outAccount.data),
  ).mint.equals(args.tokenYMint);
  const { tickArrays } = tickArraysForSwap({
    pool: args.pool,
    poolState,
    extensionState,
    swapForY,
  });

  const { tx } = await client.pool.swap({
    pool: args.pool,
    tokenXMint: args.tokenXMint,
    tokenYMint: args.tokenYMint,
    userTokenIn: args.userTokenIn,
    userTokenOut: args.userTokenOut,
    user: args.user.publicKey,
    swapForY,
    parameters: {
      inputAmount: args.inputAmount,
      minimumOutputAmount: args.minimumOutputAmount ?? new BN(0),
    },
    tickArrays,
  });
  return sendTransaction(svm, tx, [args.user]);
}

export async function claimFee(
  svm: LiteSVM,
  client: DlmmProClient,
  args: {
    pool: PublicKey;
    nftMint: PublicKey;
    signer: Keypair;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    userTokenX: PublicKey;
    userTokenY: PublicKey;
    /** All ranges of the position array; `positionIndexes` selects which to refresh. */
    tickRanges: TickRange[];
    positionIndexes?: number[];
  },
): Promise<void> {
  const indexes =
    args.positionIndexes ?? args.tickRanges.map((_, index) => index);
  const { tx } = await client.position.claimFee({
    pool: args.pool,
    nftMint: args.nftMint,
    owner: args.signer.publicKey,
    signer: args.signer.publicKey,
    tokenXMint: args.tokenXMint,
    tokenYMint: args.tokenYMint,
    userTokenX: args.userTokenX,
    userTokenY: args.userTokenY,
    bitmap: liquidityBitmap(indexes),
    tickRanges: indexes.map((index) => args.tickRanges[index]),
  });
  sendTransaction(svm, tx, [args.signer]);
}

export async function closePosition(
  svm: LiteSVM,
  client: DlmmProClient,
  args: {
    pool: PublicKey;
    nftMint: PublicKey;
    owner: Keypair;
    rentReceiver: PublicKey;
    tickRanges: TickRange[];
  },
): Promise<void> {
  const { tx } = await client.position.closePosition({
    pool: args.pool,
    nftMint: args.nftMint,
    owner: args.owner.publicKey,
    rentReceiver: args.rentReceiver,
    tickRanges: args.tickRanges,
  });
  sendTransaction(svm, tx, [args.owner]);
}

export async function getPositionTotalLiquidity(
  client: DlmmProClient,
  nftMint: PublicKey,
): Promise<BN> {
  const positions = await client.state.decodePositions(derivePosition(nftMint));
  return positions.reduce(
    (sum, position) => sum.add(positionTotalLiquidity(position)),
    new BN(0),
  );
}

/** A pool for the market's mints on a fresh static config. */
export async function initializeStaticPool(
  svm: LiteSVM,
  client: DlmmProClient,
  market: Market,
  options: {
    initialSqrtPrice?: BN;
    configArgs?: StaticConfigParameters;
    tokenBadgeY?: PublicKey;
  } = {},
): Promise<PublicKey> {
  const config = await createStaticConfig(
    svm,
    client.connection,
    market.operator,
    market.payer,
    nextConfigIndex(),
    options.configArgs,
  );
  const { tx, pool } = await client.pool.initializePoolWithStaticConfig({
    config,
    tokenXMint: market.tokenXMint,
    tokenYMint: market.tokenYMint,
    creator: market.creator.publicKey,
    payer: market.payer.publicKey,
    initialSqrtPrice: options.initialSqrtPrice ?? SQRT_PRICE_ONE,
    tokenBadgeY: options.tokenBadgeY,
  });
  sendTransaction(svm, tx, [market.payer]);
  return pool;
}

/** Opens a position for the market's LP and deposits into the funded ranges. */
export async function openFundedPosition(
  svm: LiteSVM,
  client: DlmmProClient,
  market: Market,
  pool: PublicKey,
  tickRanges: TickRange[],
  {
    maxAmount = FUNDED_AMOUNT,
    fundedIndexes = tickRanges.map((_, index) => index),
  }: { maxAmount?: BN; fundedIndexes?: number[] } = {},
): Promise<Awaited<ReturnType<typeof openPosition>>> {
  const opened = await openPosition(svm, client, {
    pool,
    owner: market.lpOwner.publicKey,
    payer: market.payer,
    tickRanges,
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
    deposits: fundedIndexes.map((positionIndex) => ({
      positionIndex,
      maxTokenX: maxAmount,
      maxTokenY: maxAmount,
    })),
  });
  return opened;
}

/**
 * Two-sided liquidity around tick 0 and Y-only liquidity below it, so selling
 * X walks the price across tick-array boundaries at tick spacing 1.
 */
export const CROSS_ARRAY_RANGES: TickRange[] = [
  { tickLowerId: -120, tickUpperId: 120 },
  { tickLowerId: -256, tickUpperId: -128 },
];

export async function seedCrossArrayLiquidity(
  svm: LiteSVM,
  client: DlmmProClient,
  market: Market,
  pool: PublicKey,
): Promise<void> {
  const opened = await openPosition(svm, client, {
    pool,
    owner: market.lpOwner.publicKey,
    payer: market.payer,
    tickRanges: CROSS_ARRAY_RANGES,
  });
  await addLiquidity(svm, client, {
    pool,
    nftMint: opened.nftMint,
    signer: market.lpOwner,
    tokenXMint: market.tokenXMint,
    tokenYMint: market.tokenYMint,
    userTokenX: market.lpTokenX,
    userTokenY: market.lpTokenY,
    tickRanges: CROSS_ARRAY_RANGES,
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

/** Deep liquidity, so test swaps stay inside `tickRanges`. */
export function seedPoolLiquidity(
  svm: LiteSVM,
  client: DlmmProClient,
  market: Market,
  pool: PublicKey,
  tickRanges: TickRange[] = DEFAULT_TICK_RANGES,
): ReturnType<typeof openFundedPosition> {
  return openFundedPosition(svm, client, market, pool, tickRanges, {
    maxAmount: SEED_AMOUNT,
  });
}

/** Swaps as the market's swapper: "up" buys X with Y, "down" sells X for Y. */
export function pushPrice(
  svm: LiteSVM,
  client: DlmmProClient,
  market: Market,
  pool: PublicKey,
  direction: "up" | "down",
  inputAmount: BN,
): Promise<TransactionMetadata> {
  const up = direction === "up";
  return swap(svm, client, {
    pool,
    user: market.swapper,
    tokenXMint: market.tokenXMint,
    tokenYMint: market.tokenYMint,
    userTokenIn: up ? market.swapperTokenY : market.swapperTokenX,
    userTokenOut: up ? market.swapperTokenX : market.swapperTokenY,
    inputAmount,
  });
}

/** Swaps down and back up, so in-range positions earn fees in both tokens. */
export async function accrueFees(
  svm: LiteSVM,
  client: DlmmProClient,
  market: Market,
  pool: PublicKey,
): Promise<void> {
  await pushPrice(svm, client, market, pool, "down", FEE_ACCRUAL_SWAP);
  await pushPrice(svm, client, market, pool, "up", FEE_ACCRUAL_SWAP);
}

/** The accounts position builders take when the market's LP acts on its own NFT. */
export function lpAccounts(
  market: Market,
  pool: PublicKey,
  nftMint: PublicKey,
) {
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

export async function createFundedMarket(args: {
  svm: LiteSVM;
  client: DlmmProClient;
  permissions?: OperatorPermission[];
}): Promise<Market> {
  const { svm, client } = args;
  const admin = createAndFundWallet(svm);
  const operator = createAndFundWallet(svm);
  const payer = createAndFundWallet(svm);
  const creator = createAndFundWallet(svm);
  const lpOwner = createAndFundWallet(svm);
  const swapper = createAndFundWallet(svm);

  const operatorPda = await createWhitelistOperator(
    svm,
    client.connection,
    admin,
    operator.publicKey,
    args.permissions ?? [OperatorPermission.CreateConfigKey],
  );

  const tokenXMint = createToken(svm, payer);
  const tokenYMint = createToken(svm, payer);
  const lpTokenX = mintSplTokenTo(svm, payer, tokenXMint, lpOwner.publicKey);
  const lpTokenY = mintSplTokenTo(svm, payer, tokenYMint, lpOwner.publicKey);
  const swapperTokenX = mintSplTokenTo(
    svm,
    payer,
    tokenXMint,
    swapper.publicKey,
  );
  const swapperTokenY = mintSplTokenTo(
    svm,
    payer,
    tokenYMint,
    swapper.publicKey,
  );

  return {
    admin,
    operator,
    payer,
    creator,
    lpOwner,
    swapper,
    tokenXMint,
    tokenYMint,
    lpTokenX,
    lpTokenY,
    swapperTokenX,
    swapperTokenY,
    operatorPda,
  };
}
