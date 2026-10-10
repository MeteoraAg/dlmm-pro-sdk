import { BN } from "@coral-xyz/anchor";
import { AccountLayout } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { LiteSVM } from "litesvm";
import {
  derivePosition,
  DlmmProClient,
  getLiquidityFromAmounts,
  liquidityBitmap,
  OperatorPermission,
  tickArraysForSwap,
  type TickRange,
} from "../../src";
import {
  DEFAULT_TICK_RANGES,
  DEFAULT_TICK_SPACING,
  SQRT_PRICE_ONE,
} from "./constants";
import {
  createStaticConfig,
  createWhitelistOperator,
  defaultStaticConfigArgs,
  randomID,
} from "./setup";
import { createAndFundWallet, sendTransaction } from "./svm";
import { createToken, mintSplTokenTo } from "./token";

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
    tickSpacing: number;
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
    tickSpacing: args.tickSpacing,
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
    tickSpacing: number;
    deposits: Deposit[];
    tickArrayBitmapExtension?: PublicKey | null;
  },
): Promise<void> {
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
    tickSpacing: args.tickSpacing,
    tickArrayBitmapExtension: args.tickArrayBitmapExtension ?? null,
    parameters: {
      maxAmountX,
      maxAmountY,
      expectedLayoutVersion: null,
      bitmap: liquidityBitmap(indexes),
      liquidities,
    },
  });
  sendTransaction(svm, tx, [args.signer]);
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
    tickSpacing: number;
    withdrawals: { positionIndex: number; liquidity: BN }[];
    tickArrayBitmapExtension?: PublicKey | null;
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
    tickSpacing: args.tickSpacing,
    tickArrayBitmapExtension: args.tickArrayBitmapExtension ?? null,
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
    tickArrayBitmapExtension?: PublicKey | null;
  },
): Promise<void> {
  const poolState = await client.state.fetchPool(args.pool);
  const extensionState = args.tickArrayBitmapExtension
    ? await client.state.fetchTickArrayBitmapExtension(
        args.tickArrayBitmapExtension,
      )
    : null;
  const outAccount = svm.getAccount(args.userTokenOut);
  if (!outAccount) {
    throw new Error(`token account not found: ${args.userTokenOut.toBase58()}`);
  }
  const outMint = AccountLayout.decode(Buffer.from(outAccount.data)).mint;
  const { tickArrays } = tickArraysForSwap({
    pool: args.pool,
    poolState,
    extensionState,
    swapForY: outMint.equals(args.tokenYMint),
  });

  const { tx } = await client.pool.swap({
    pool: args.pool,
    tokenXMint: args.tokenXMint,
    tokenYMint: args.tokenYMint,
    userTokenIn: args.userTokenIn,
    userTokenOut: args.userTokenOut,
    user: args.user.publicKey,
    parameters: {
      inputAmount: args.inputAmount,
      minimumOutputAmount: args.minimumOutputAmount ?? new BN(0),
    },
    tickArrays,
    tickArrayBitmapExtension: args.tickArrayBitmapExtension ?? null,
  });
  sendTransaction(svm, tx, [args.user]);
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
    tickSpacing: number;
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
    tickSpacing: args.tickSpacing,
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
    tickSpacing: number;
  },
): Promise<void> {
  const { tx } = await client.position.closePosition({
    pool: args.pool,
    nftMint: args.nftMint,
    owner: args.owner.publicKey,
    rentReceiver: args.rentReceiver,
    tickRanges: args.tickRanges,
    tickSpacing: args.tickSpacing,
  });
  sendTransaction(svm, tx, [args.owner]);
}

export async function getPositionTotalLiquidity(
  client: DlmmProClient,
  nftMint: PublicKey,
): Promise<BN> {
  const positions = await client.state.decodePositions(derivePosition(nftMint));
  return positions.reduce(
    (sum, position) =>
      sum
        .add(position.unlockedLiquidity)
        .add(position.permanentLockedLiquidity)
        .add(position.vestingLiquidity),
    new BN(0),
  );
}

export async function initializeStaticPool(
  svm: LiteSVM,
  client: DlmmProClient,
  args: {
    operator: Keypair;
    payer: Keypair;
    creator: PublicKey;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    initialSqrtPrice?: BN;
    configArgs?: ReturnType<typeof defaultStaticConfigArgs>;
    tokenBadgeY?: PublicKey;
  },
): Promise<{ config: PublicKey; pool: PublicKey; oracle: PublicKey }> {
  const config = await createStaticConfig(
    svm,
    client.connection,
    args.operator,
    args.payer,
    randomID(),
    args.configArgs ?? defaultStaticConfigArgs(),
  );
  const { tx, pool, oracle } = await client.pool.initializePoolWithStaticConfig(
    {
      config,
      tokenXMint: args.tokenXMint,
      tokenYMint: args.tokenYMint,
      creator: args.creator,
      payer: args.payer.publicKey,
      initialSqrtPrice: args.initialSqrtPrice ?? SQRT_PRICE_ONE,
      tokenBadgeY: args.tokenBadgeY,
    },
  );
  sendTransaction(svm, tx, [args.payer]);
  return { config, pool, oracle };
}

export async function seedPoolLiquidity(
  svm: LiteSVM,
  client: DlmmProClient,
  args: {
    pool: PublicKey;
    lpOwner: Keypair;
    payer: Keypair;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    lpTokenX: PublicKey;
    lpTokenY: PublicKey;
    tickRanges?: TickRange[];
    tickSpacing?: number;
    liquidity?: BN;
  },
): Promise<{
  nftMint: PublicKey;
  position: PublicKey;
  nftAccount: PublicKey;
  tickRanges: TickRange[];
  tickSpacing: number;
}> {
  const tickRanges = args.tickRanges ?? DEFAULT_TICK_RANGES;
  const tickSpacing = args.tickSpacing ?? DEFAULT_TICK_SPACING;
  const liquidity = args.liquidity ?? new BN(1_000_000_000);
  const opened = await openPosition(svm, client, {
    pool: args.pool,
    owner: args.lpOwner.publicKey,
    payer: args.payer,
    tickRanges,
    tickSpacing,
  });
  await addLiquidity(svm, client, {
    pool: args.pool,
    nftMint: opened.nftMint,
    signer: args.lpOwner,
    tokenXMint: args.tokenXMint,
    tokenYMint: args.tokenYMint,
    userTokenX: args.lpTokenX,
    userTokenY: args.lpTokenY,
    tickRanges,
    tickSpacing,
    deposits: [
      { positionIndex: 0, maxTokenX: liquidity, maxTokenY: liquidity },
    ],
  });
  return { ...opened, tickRanges, tickSpacing };
}

export async function createFundedMarket(args: {
  svm: LiteSVM;
  client: DlmmProClient;
  permissions?: OperatorPermission[];
}): Promise<{
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
}> {
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
