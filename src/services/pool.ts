import { unpackMint, type Mint } from "@solana/spl-token";
import {
  PublicKey,
  Transaction,
  type AccountMeta,
  type Commitment,
  type Connection,
} from "@solana/web3.js";
import BN from "bn.js";
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "../constants";
import { PoolError } from "../errors";
import {
  deriveLaunchPool,
  deriveOracle,
  derivePool,
  derivePoolAuthority,
  deriveReserve,
  deriveTickArray,
  deriveTickArrayBitmapExtension,
  getTokenProgram,
  LIQUIDITY_HOOKS,
  overflowsDefaultTickArrayBitmap,
  resolveInstructionHooks,
  SWAP_HOOKS,
  type TransferHookAmount,
  type TransferHookLeg,
  tickArraysForSwap,
  tickIndexFromId,
  resolveTokenProgram,
  readTokenAccountMint,
  assertQuoteTokenBadge,
  validateInitializePoolWithDynamicParameters,
} from "../helpers";
import { tickIdFromSqrtPrice } from "../math";
import { assertU64 } from "../helpers/validation";
import {
  getFeeSetting,
  quoteExactIn,
  type QuoteExactInParams,
  type QuoteExactInResult,
  type QuoteTickArray,
} from "../quote";
import type {
  DecodedTick,
  InitializePoolWithDynamicParameters,
  SwapParameters,
} from "../types";
import { DlmmProProgram } from "./program";

export type InitializePoolAccounts = {
  pool: PublicKey;
  oracle: PublicKey;
  reserveX: PublicKey;
  reserveY: PublicKey;
  tickArrayBitmapExtension: PublicKey | null;
  tokenXProgram: PublicKey;
  tokenYProgram: PublicKey;
  tokenBadgeX: PublicKey | null;
  tokenBadgeY: PublicKey | null;
};

export type InitializePoolResult = InitializePoolAccounts & {
  tx: Transaction;
};

export type InitializeLaunchPoolResult = InitializePoolResult & {
  userTokenX: PublicKey;
  userTokenY: PublicKey;
};

export type QuoteExactInRequest = {
  pool: PublicKey;
  /** Input amount before the input mint's transfer fee. */
  inputAmount: BN;
  swapForY: boolean;
  hasReferral?: boolean;
  /** The swapping wallet, for the whitelisted-swap bypass pre-activation. */
  swapper?: PublicKey | null;
  maxTickArrays?: number;
};

export type QuoteExactInResponse = {
  quote: QuoteExactInResult;
  /** Tick arrays to pass to the swap instruction, already in traversal order. */
  tickArrays: PublicKey[];
  /** Bitmap extension account to pass to the swap instruction, when needed. */
  tickArrayBitmapExtension: PublicKey | null;
};

export type SwapParams = {
  pool: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  userTokenIn: PublicKey;
  userTokenOut: PublicKey;
  user: PublicKey;
  /** In the program's traversal order — take these from `quoteExactIn`. */
  tickArrays: PublicKey[];
  parameters: SwapParameters;
  tokenXProgram?: PublicKey;
  tokenYProgram?: PublicKey;
  tickArrayBitmapExtension?: PublicKey | null;
  referral?: PublicKey | null;
  transferHookX?: AccountMeta[];
  transferHookY?: AccountMeta[];
  transferHookReferral?: AccountMeta[];
  /**
   * Pool-side output (`quote.outAmount`) for an output-mint transfer hook.
   * Omit it and the builder quotes the swap's tick arrays when that mint has
   * a hook.
   */
  quotedOutAmount?: BN;
  /**
   * Host fee (`quote.hostFee`) for a referral transfer hook. Omit it and the
   * builder uses the same quote as `quotedOutAmount` when the referral mint
   * has a hook.
   */
  quotedHostFee?: BN;
};

type InitializePoolAccountParams = {
  pool: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  initialSqrtPrice: BN;
  tickSpacing: number;
  tokenXProgram?: PublicKey;
  tokenYProgram?: PublicKey;
  tokenBadgeX?: PublicKey | null;
  tokenBadgeY?: PublicKey | null;
  tickArrayBitmapExtension?: PublicKey | null;
};

export type InitializePoolWithStaticConfigParams = {
  config: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  creator: PublicKey;
  payer: PublicKey;
  initialSqrtPrice: BN;
  tokenXProgram?: PublicKey;
  tokenYProgram?: PublicKey;
  tokenBadgeX?: PublicKey | null;
  tokenBadgeY?: PublicKey | null;
  tickArrayBitmapExtension?: PublicKey | null;
};

export type InitializePoolWithDynamicConfigParams = {
  config: PublicKey;
  poolCreatorAuthority: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  creator: PublicKey;
  payer: PublicKey;
  parameters: InitializePoolWithDynamicParameters;
  tokenXProgram?: PublicKey;
  tokenYProgram?: PublicKey;
  tokenBadgeX?: PublicKey | null;
  tokenBadgeY?: PublicKey | null;
  tickArrayBitmapExtension?: PublicKey | null;
};

export type InitializeLaunchPoolParams = {
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  creator: PublicKey;
  payer: PublicKey;
  parameters: InitializePoolWithDynamicParameters;
  userTokenX: PublicKey;
  userTokenY: PublicKey;
  tokenXProgram?: PublicKey;
  tokenYProgram?: PublicKey;
  tokenBadgeX?: PublicKey | null;
  tokenBadgeY?: PublicKey | null;
  tickArrayBitmapExtension?: PublicKey | null;
};

export class PoolService extends DlmmProProgram {
  /**
   * Fetch every account an exact-in quote needs and run `quoteExactIn` —
   * amounts match what the `swap` instruction produces for the same accounts
   * and clock. For hot paths, fetch accounts yourself and call `quoteExactIn`
   * from the package root directly.
   */
  async quoteExactIn(
    params: QuoteExactInRequest,
  ): Promise<QuoteExactInResponse> {
    const loaded = await this.loadQuoteAccounts(params);
    return {
      quote: quoteExactIn(loaded.quoteParams),
      tickArrays: loaded.tickArrayAddresses,
      tickArrayBitmapExtension: loaded.tickArrayBitmapExtension,
    };
  }

  /** A non-default authority stored in the config must co-sign the transaction. */
  async initializePoolWithStaticConfig(
    params: InitializePoolWithStaticConfigParams,
  ): Promise<InitializePoolResult> {
    this.assertDistinctMints(params.tokenXMint, params.tokenYMint);
    if (
      params.initialSqrtPrice.lt(MIN_SQRT_PRICE) ||
      params.initialSqrtPrice.gt(MAX_SQRT_PRICE)
    ) {
      throw PoolError.invalidParameters();
    }
    const staticConfig = await this.state.fetchStaticConfig(params.config);
    assertQuoteTokenBadge(
      staticConfig.collectFeeMode,
      params.tokenYMint,
      params.tokenBadgeY,
    );

    const pool = derivePool(
      params.config,
      params.tokenXMint,
      params.tokenYMint,
    );
    const accounts = await this.initializePoolAccounts({
      pool,
      tokenXMint: params.tokenXMint,
      tokenYMint: params.tokenYMint,
      initialSqrtPrice: params.initialSqrtPrice,
      tickSpacing: staticConfig.tickSpacing,
      tokenXProgram: params.tokenXProgram,
      tokenYProgram: params.tokenYProgram,
      tokenBadgeX: params.tokenBadgeX,
      tokenBadgeY: params.tokenBadgeY,
      tickArrayBitmapExtension: params.tickArrayBitmapExtension,
    });
    const poolCreatorAuthority = staticConfig.poolCreatorAuthority;

    const ix = await this.program.methods
      .initializePoolWithStaticConfig(params.initialSqrtPrice)
      .accountsPartial({
        pool,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        config: params.config,
        tickArrayBitmapExtension: accounts.tickArrayBitmapExtension,
        oracle: accounts.oracle,
        reserveX: accounts.reserveX,
        reserveY: accounts.reserveY,
        tokenBadgeX: accounts.tokenBadgeX,
        tokenBadgeY: accounts.tokenBadgeY,
        creator: params.creator,
        payer: params.payer,
        poolCreatorAuthority,
        tokenXProgram: accounts.tokenXProgram,
        tokenYProgram: accounts.tokenYProgram,
      })
      .instruction();

    if (!poolCreatorAuthority.equals(PublicKey.default)) {
      for (const key of ix.keys) {
        if (key.pubkey.equals(poolCreatorAuthority)) {
          key.isSigner = true;
        }
      }
    }

    const tx = new Transaction().add(ix);
    tx.feePayer = params.payer;
    return { tx, ...accounts };
  }

  async initializePoolWithDynamicConfig(
    params: InitializePoolWithDynamicConfigParams,
  ): Promise<InitializePoolResult> {
    this.assertDistinctMints(params.tokenXMint, params.tokenYMint);
    await validateInitializePoolWithDynamicParameters(
      this.connection,
      params.parameters,
      this.commitment,
    );
    assertQuoteTokenBadge(
      params.parameters.collectFeeMode,
      params.tokenYMint,
      params.tokenBadgeY,
    );

    const pool = derivePool(
      params.config,
      params.tokenXMint,
      params.tokenYMint,
    );
    const accounts = await this.initializePoolAccounts({
      pool,
      tokenXMint: params.tokenXMint,
      tokenYMint: params.tokenYMint,
      initialSqrtPrice: params.parameters.initialSqrtPrice,
      tickSpacing: params.parameters.tickSpacing,
      tokenXProgram: params.tokenXProgram,
      tokenYProgram: params.tokenYProgram,
      tokenBadgeX: params.tokenBadgeX,
      tokenBadgeY: params.tokenBadgeY,
      tickArrayBitmapExtension: params.tickArrayBitmapExtension,
    });

    const tx = await this.program.methods
      .initializePoolWithDynamicConfig(params.parameters)
      .accountsPartial({
        pool,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        config: params.config,
        tickArrayBitmapExtension: accounts.tickArrayBitmapExtension,
        oracle: accounts.oracle,
        reserveX: accounts.reserveX,
        reserveY: accounts.reserveY,
        tokenBadgeX: accounts.tokenBadgeX,
        tokenBadgeY: accounts.tokenBadgeY,
        creator: params.creator,
        payer: params.payer,
        poolCreatorAuthority: params.poolCreatorAuthority,
        tokenXProgram: accounts.tokenXProgram,
        tokenYProgram: accounts.tokenYProgram,
      })
      .transaction();

    tx.feePayer = params.payer;
    return { tx, ...accounts };
  }

  async initializeLaunchPool(
    params: InitializeLaunchPoolParams,
  ): Promise<InitializeLaunchPoolResult> {
    this.assertDistinctMints(params.tokenXMint, params.tokenYMint);
    await validateInitializePoolWithDynamicParameters(
      this.connection,
      params.parameters,
      this.commitment,
    );
    assertQuoteTokenBadge(
      params.parameters.collectFeeMode,
      params.tokenYMint,
      params.tokenBadgeY,
    );

    const pool = deriveLaunchPool(params.tokenXMint, params.tokenYMint);
    const accounts = await this.initializePoolAccounts({
      pool,
      tokenXMint: params.tokenXMint,
      tokenYMint: params.tokenYMint,
      initialSqrtPrice: params.parameters.initialSqrtPrice,
      tickSpacing: params.parameters.tickSpacing,
      tokenXProgram: params.tokenXProgram,
      tokenYProgram: params.tokenYProgram,
      tokenBadgeX: params.tokenBadgeX,
      tokenBadgeY: params.tokenBadgeY,
      tickArrayBitmapExtension: params.tickArrayBitmapExtension,
    });

    const tx = await this.program.methods
      .initializeLaunchPool(params.parameters)
      .accountsPartial({
        pool,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        tickArrayBitmapExtension: accounts.tickArrayBitmapExtension,
        oracle: accounts.oracle,
        reserveX: accounts.reserveX,
        reserveY: accounts.reserveY,
        tokenBadgeX: accounts.tokenBadgeX,
        tokenBadgeY: accounts.tokenBadgeY,
        creator: params.creator,
        payer: params.payer,
        tokenXProgram: accounts.tokenXProgram,
        tokenYProgram: accounts.tokenYProgram,
        userTokenX: params.userTokenX,
        userTokenY: params.userTokenY,
      })
      .transaction();

    tx.feePayer = params.payer;
    return {
      tx,
      ...accounts,
      userTokenX: params.userTokenX,
      userTokenY: params.userTokenY,
    };
  }

  async initializeTickArray(params: {
    pool: PublicKey;
    index: number;
    funder: PublicKey;
  }): Promise<{ tx: Transaction; tickArray: PublicKey }> {
    const tickArray = deriveTickArray(params.pool, params.index);
    const tx = await this.program.methods
      .initializeTickArray(params.index)
      .accountsPartial({
        pool: params.pool,
        tickArray,
        funder: params.funder,
      })
      .transaction();

    tx.feePayer = params.funder;
    return { tx, tickArray };
  }

  async initializeTickBitmapExtension(params: {
    pool: PublicKey;
    funder: PublicKey;
  }): Promise<{ tx: Transaction; tickArrayBitmapExtension: PublicKey }> {
    const tickArrayBitmapExtension = deriveTickArrayBitmapExtension(
      params.pool,
    );
    const tx = await this.program.methods
      .initializeTickBitmapExtension()
      .accountsPartial({
        pool: params.pool,
        tickArrayBitmapExtension,
        funder: params.funder,
      })
      .transaction();

    tx.feePayer = params.funder;
    return { tx, tickArrayBitmapExtension };
  }

  /**
   * Exact-in swap. The pool must consume all of `parameters.inputAmount` across
   * the supplied `tickArrays` or the program fails with
   * `NotConsumingFullAmountIn`, so pass the tick arrays from a quote whose
   * `amountLeft` is zero.
   */
  async swap(params: SwapParams): Promise<{ tx: Transaction }> {
    assertU64(params.parameters.inputAmount);
    assertU64(params.parameters.minimumOutputAmount);
    if (params.parameters.inputAmount.isZero()) {
      throw PoolError.amountIsZero();
    }
    const resolved = await this.resolveSwapAccounts(params);
    const tx = await this.program.methods
      .swap(params.parameters, resolved.remainingAccountsInfo)
      .accountsPartial(resolved.accounts)
      .remainingAccounts(resolved.remainingAccounts)
      .transaction();

    tx.feePayer = params.user;
    return { tx };
  }

  private async resolveSwapAccounts(params: SwapParams) {
    const outputMint = await readTokenAccountMint(
      this.connection,
      params.userTokenOut,
      this.commitment,
    );
    const swapForY = outputMint.equals(params.tokenYMint);
    if (!swapForY && !outputMint.equals(params.tokenXMint)) {
      throw PoolError.invalidAccount();
    }
    let quote: Promise<QuoteExactInResult> | undefined;
    const quoted = () => (quote ??= this.quoteSwapTickArrays(params, swapForY));
    const outputAmount =
      params.quotedOutAmount ?? (async () => (await quoted()).outAmount);
    const poolAuthority = derivePoolAuthority();
    const reserveX = deriveReserve(params.tokenXMint, params.pool);
    const reserveY = deriveReserve(params.tokenYMint, params.pool);
    const xIsInput = swapForY;
    const referral = params.referral;
    const referralLeg = referral
      ? await referralHookLeg(
          this.connection,
          this.commitment,
          referral,
          params.tokenXMint,
          params.tokenYMint,
          params.pool,
          poolAuthority,
          (referralMint) => async () => {
            const hostFee = params.quotedHostFee ?? (await quoted()).hostFee;
            if (hostFee.isZero()) {
              return hostFee;
            }
            const pool = await this.state.fetchPool(params.pool);
            const feeMint = getFeeSetting(pool, swapForY, true).feesOnTokenX
              ? params.tokenXMint
              : params.tokenYMint;
            if (!feeMint.equals(referralMint)) {
              throw PoolError.invalidAccount();
            }
            return hostFee;
          },
        )
      : undefined;
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      SWAP_HOOKS,
      {
        transferHookX: params.transferHookX,
        transferHookY: params.transferHookY,
        transferHookReferral: params.transferHookReferral,
      },
      {
        transferHookX: {
          mint: params.tokenXMint,
          source: xIsInput ? params.userTokenIn : reserveX,
          destination: xIsInput ? reserveX : params.userTokenOut,
          authority: xIsInput ? params.user : poolAuthority,
          amount: xIsInput ? params.parameters.inputAmount : outputAmount,
        },
        transferHookY: {
          mint: params.tokenYMint,
          source: xIsInput ? reserveY : params.userTokenIn,
          destination: xIsInput ? params.userTokenOut : reserveY,
          authority: xIsInput ? poolAuthority : params.user,
          amount: xIsInput ? outputAmount : params.parameters.inputAmount,
        },
        transferHookReferral: referralLeg,
      },
    );
    const [tokenXProgram, tokenYProgram] = await Promise.all([
      params.tokenXProgram ??
        resolveTokenProgram(
          this.connection,
          params.tokenXMint,
          this.commitment,
        ),
      params.tokenYProgram ??
        resolveTokenProgram(
          this.connection,
          params.tokenYMint,
          this.commitment,
        ),
    ]);

    return {
      remainingAccountsInfo: hooks.remainingAccountsInfo,
      remainingAccounts: [
        ...hooks.remainingAccounts,
        ...params.tickArrays.map((pubkey) => ({
          pubkey,
          isWritable: true,
          isSigner: false,
        })),
      ],
      accounts: {
        pool: params.pool,
        tickArrayBitmapExtension: params.tickArrayBitmapExtension ?? null,
        reserveX,
        reserveY,
        userTokenIn: params.userTokenIn,
        userTokenOut: params.userTokenOut,
        referral: params.referral ?? null,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        oracle: deriveOracle(params.pool),
        user: params.user,
        tokenXProgram,
        tokenYProgram,
      },
    };
  }

  async increaseOracleLength(params: {
    pool: PublicKey;
    payer: PublicKey;
    lengthToAdd: number;
  }): Promise<{ tx: Transaction; oracle: PublicKey }> {
    if (
      !Number.isInteger(params.lengthToAdd) ||
      params.lengthToAdd <= 0 ||
      params.lengthToAdd > 0xffff
    ) {
      throw PoolError.invalidParameters();
    }

    const oracle = deriveOracle(params.pool);
    const tx = await this.program.methods
      .increaseOracleLength(params.lengthToAdd)
      .accountsPartial({
        oracle,
        payer: params.payer,
      })
      .transaction();

    tx.feePayer = params.payer;
    return { tx, oracle };
  }

  async claimPartnerFee(params: {
    pool: PublicKey;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    receiverTokenX: PublicKey;
    receiverTokenY: PublicKey;
    signer: PublicKey;
    maxAmountX: BN;
    maxAmountY: BN;
    /** Minimum token X to receive after transfer fees; defaults to no minimum. */
    minAmountX?: BN;
    /** Minimum token Y to receive after transfer fees; defaults to no minimum. */
    minAmountY?: BN;
    tokenXProgram?: PublicKey;
    tokenYProgram?: PublicKey;
    transferHookX?: AccountMeta[];
    transferHookY?: AccountMeta[];
  }): Promise<{ tx: Transaction }> {
    assertU64(params.maxAmountX);
    assertU64(params.maxAmountY);
    assertU64(params.minAmountX ?? new BN(0));
    assertU64(params.minAmountY ?? new BN(0));
    const poolAuthority = derivePoolAuthority();
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      LIQUIDITY_HOOKS,
      {
        transferHookX: params.transferHookX,
        transferHookY: params.transferHookY,
      },
      {
        transferHookX: {
          mint: params.tokenXMint,
          source: deriveReserve(params.tokenXMint, params.pool),
          destination: params.receiverTokenX,
          authority: poolAuthority,
          amount: async () => {
            const pool = await this.state.fetchPool(params.pool);
            const pending = pool.poolPartner.pendingFeeX;
            return pending.lt(params.maxAmountX) ? pending : params.maxAmountX;
          },
        },
        transferHookY: {
          mint: params.tokenYMint,
          source: deriveReserve(params.tokenYMint, params.pool),
          destination: params.receiverTokenY,
          authority: poolAuthority,
          amount: async () => {
            const pool = await this.state.fetchPool(params.pool);
            const pending = pool.poolPartner.pendingFeeY;
            return pending.lt(params.maxAmountY) ? pending : params.maxAmountY;
          },
        },
      },
    );
    const [tokenXProgram, tokenYProgram] = await Promise.all([
      params.tokenXProgram ??
        resolveTokenProgram(
          this.connection,
          params.tokenXMint,
          this.commitment,
        ),
      params.tokenYProgram ??
        resolveTokenProgram(
          this.connection,
          params.tokenYMint,
          this.commitment,
        ),
    ]);

    const tx = await this.program.methods
      .claimPartnerFee(
        {
          maxAmountX: params.maxAmountX,
          maxAmountY: params.maxAmountY,
          minAmountX: params.minAmountX ?? new BN(0),
          minAmountY: params.minAmountY ?? new BN(0),
        },
        hooks.remainingAccountsInfo,
      )
      .accountsPartial({
        pool: params.pool,
        reserveX: deriveReserve(params.tokenXMint, params.pool),
        reserveY: deriveReserve(params.tokenYMint, params.pool),
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        receiverTokenX: params.receiverTokenX,
        receiverTokenY: params.receiverTokenY,
        signer: params.signer,
        tokenXProgram,
        tokenYProgram,
      })
      .remainingAccounts(hooks.remainingAccounts)
      .transaction();

    tx.feePayer = params.signer;
    return { tx };
  }

  private async quoteSwapTickArrays(
    params: SwapParams,
    swapForY: boolean,
  ): Promise<QuoteExactInResult> {
    const { pool: poolState, extensions } =
      await this.state.fetchPoolWithExtensions(params.pool);
    let bitmapExtension = null;
    if (poolState.isBitmapExtensionInitialized === 1) {
      if (!params.tickArrayBitmapExtension) {
        throw PoolError.tickArrayBitmapExtensionAccountIsNotProvided();
      }
      bitmapExtension = await this.state.fetchTickArrayBitmapExtension(
        params.tickArrayBitmapExtension,
      );
    }
    const tickArrays: QuoteTickArray[] = (
      await this.state.fetchTickArraysWithTicks(params.tickArrays, {
        withReward: extensions.hasLiquidityMining,
      })
    ).map(({ tickArray, ticks }) => ({
      pool: tickArray.pool,
      tickIndex: tickArray.tickIndex,
      ticks: ticks as DecodedTick[],
    }));
    const [inputMintAddress, outputMintAddress] = swapForY
      ? [poolState.tokenXMint, poolState.tokenYMint]
      : [poolState.tokenYMint, poolState.tokenXMint];
    const unpack = async (
      address: PublicKey,
      tokenProgramFlag: number,
    ): Promise<Mint> => {
      const info = await this.connection.getAccountInfo(
        address,
        this.commitment,
      );
      if (!info) {
        throw new Error(`Mint account not found: ${address.toBase58()}`);
      }
      return unpackMint(address, info, getTokenProgram(tokenProgramFlag));
    };
    const [inputMint, outputMint] = await Promise.all([
      unpack(
        inputMintAddress,
        swapForY ? poolState.tokenXFlag : poolState.tokenYFlag,
      ),
      unpack(
        outputMintAddress,
        swapForY ? poolState.tokenYFlag : poolState.tokenXFlag,
      ),
    ]);
    const epochInfo = await this.connection.getEpochInfo(this.commitment);
    const blockTime = await this.connection.getBlockTime(
      epochInfo.absoluteSlot,
    );
    if (blockTime === null) {
      throw PoolError.undeterminedError();
    }
    const quote = quoteExactIn({
      poolAddress: params.pool,
      pool: poolState,
      poolActivation: extensions.activation ?? null,
      tickArrays,
      bitmapExtension,
      inputAmount: params.parameters.inputAmount,
      swapForY,
      hasReferral: params.referral != null,
      swapper: params.user,
      currentSlot: new BN(epochInfo.absoluteSlot),
      currentTimestamp: new BN(blockTime),
      epoch: BigInt(epochInfo.epoch),
      inputMint,
      outputMint,
    });
    if (!quote.amountLeft.isZero()) {
      throw PoolError.notConsumingFullAmountIn();
    }
    return quote;
  }

  private assertDistinctMints(tokenXMint: PublicKey, tokenYMint: PublicKey) {
    if (tokenXMint.equals(tokenYMint)) {
      throw PoolError.invalidParameters();
    }
  }

  private async loadQuoteAccounts(params: QuoteExactInRequest): Promise<{
    quoteParams: QuoteExactInParams;
    tickArrayAddresses: PublicKey[];
    tickArrayBitmapExtension: PublicKey | null;
  }> {
    const { pool: poolState, extensions } =
      await this.state.fetchPoolWithExtensions(params.pool);

    const extensionAddress = deriveTickArrayBitmapExtension(params.pool);
    const extensionState =
      poolState.isBitmapExtensionInitialized === 1
        ? await this.state.fetchTickArrayBitmapExtension(extensionAddress)
        : null;

    const selection = tickArraysForSwap({
      pool: params.pool,
      poolState,
      extensionState,
      swapForY: params.swapForY,
      maxTickArrays: params.maxTickArrays,
    });

    const tickArrays: QuoteTickArray[] = (
      await this.state.fetchTickArraysWithTicks(selection.tickArrays, {
        withReward: extensions.hasLiquidityMining,
      })
    ).map(({ tickArray, ticks }) => ({
      pool: tickArray.pool,
      tickIndex: tickArray.tickIndex,
      ticks: ticks as DecodedTick[],
    }));

    const [inputMintAddress, outputMintAddress] = params.swapForY
      ? [poolState.tokenXMint, poolState.tokenYMint]
      : [poolState.tokenYMint, poolState.tokenXMint];
    const unpack = async (
      address: PublicKey,
      tokenProgramFlag: number,
    ): Promise<Mint> => {
      const info = await this.connection.getAccountInfo(
        address,
        this.commitment,
      );
      if (!info) {
        throw new Error(`Mint account not found: ${address.toBase58()}`);
      }
      return unpackMint(address, info, getTokenProgram(tokenProgramFlag));
    };
    const [inputMint, outputMint] = await Promise.all([
      unpack(
        inputMintAddress,
        params.swapForY ? poolState.tokenXFlag : poolState.tokenYFlag,
      ),
      unpack(
        outputMintAddress,
        params.swapForY ? poolState.tokenYFlag : poolState.tokenXFlag,
      ),
    ]);

    const epochInfo = await this.connection.getEpochInfo(this.commitment);
    const currentSlot = epochInfo.absoluteSlot;
    const blockTime = await this.connection.getBlockTime(currentSlot);
    if (blockTime === null) {
      throw PoolError.undeterminedError();
    }

    return {
      quoteParams: {
        poolAddress: params.pool,
        pool: poolState,
        poolActivation: extensions.activation ?? null,
        tickArrays,
        bitmapExtension: extensionState,
        inputAmount: params.inputAmount,
        swapForY: params.swapForY,
        hasReferral: params.hasReferral ?? false,
        swapper: params.swapper ?? null,
        currentSlot: new BN(currentSlot),
        currentTimestamp: new BN(blockTime),
        epoch: BigInt(epochInfo.epoch),
        inputMint,
        outputMint,
      },
      tickArrayAddresses: selection.tickArrays,
      tickArrayBitmapExtension: selection.requiresBitmapExtension
        ? extensionAddress
        : null,
    };
  }

  private async initializePoolAccounts(
    params: InitializePoolAccountParams,
  ): Promise<InitializePoolAccounts> {
    const [tokenXProgram, tokenYProgram] = await Promise.all([
      params.tokenXProgram ??
        resolveTokenProgram(
          this.connection,
          params.tokenXMint,
          this.commitment,
        ),
      params.tokenYProgram ??
        resolveTokenProgram(
          this.connection,
          params.tokenYMint,
          this.commitment,
        ),
    ]);

    // The program initializes the extension in-place and requires it whenever
    // the initial tick sits outside the pool's inline bitmap.
    const initialTickIndex = tickIndexFromId(
      tickIdFromSqrtPrice(params.initialSqrtPrice),
      params.tickSpacing,
    );
    const tickArrayBitmapExtension =
      params.tickArrayBitmapExtension ??
      (overflowsDefaultTickArrayBitmap(initialTickIndex)
        ? deriveTickArrayBitmapExtension(params.pool)
        : null);

    return {
      pool: params.pool,
      oracle: deriveOracle(params.pool),
      reserveX: deriveReserve(params.tokenXMint, params.pool),
      reserveY: deriveReserve(params.tokenYMint, params.pool),
      tickArrayBitmapExtension,
      tokenXProgram,
      tokenYProgram,
      tokenBadgeX: params.tokenBadgeX ?? null,
      tokenBadgeY: params.tokenBadgeY ?? null,
    };
  }
}

async function referralHookLeg(
  connection: Connection,
  commitment: Commitment,
  referral: PublicKey,
  tokenXMint: PublicKey,
  tokenYMint: PublicKey,
  pool: PublicKey,
  authority: PublicKey,
  amountFor: (mint: PublicKey) => TransferHookAmount,
): Promise<TransferHookLeg> {
  const mint = await readTokenAccountMint(connection, referral, commitment);
  if (!mint.equals(tokenXMint) && !mint.equals(tokenYMint)) {
    throw PoolError.invalidAccount();
  }
  return {
    mint,
    source: deriveReserve(mint, pool),
    destination: referral,
    authority,
    amount: amountFor(mint),
  };
}
