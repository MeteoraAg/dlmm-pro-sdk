import { unpackMint, type Mint } from "@solana/spl-token";
import { PublicKey, Transaction, type AccountMeta } from "@solana/web3.js";
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
  tickIndexFromId,
  resolveTokenProgram,
  readTokenAccountMint,
  readClock,
  readMintAccount,
  validateInitializePoolWithDynamicParameters,
} from "../helpers";
import { tickIdFromSqrtPrice } from "../math";
import { assertU64 } from "../helpers/validation";
import {
  quoteExactIn,
  tickArraysForSwap,
  type QuoteExactInResult,
} from "../quote";
import type {
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
  swapForY: boolean;
  /** In the program's traversal order — take these from `quoteExactIn`. */
  tickArrays: PublicKey[];
  parameters: SwapParameters;
  tokenXProgram?: PublicKey;
  tokenYProgram?: PublicKey;
  /** Defaults to the extension when the pool has one. */
  tickArrayBitmapExtension?: PublicKey | null;
  referral?: PublicKey | null;
  transferHookX?: AccountMeta[];
  transferHookY?: AccountMeta[];
  transferHookReferral?: AccountMeta[];
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
   * A result with `amountLeft` greater than zero is a partial fill; `swap`
   * reverts on that input. Pass accounts you already have to `quoteExactIn`.
   */
  async quoteExactIn(
    params: QuoteExactInRequest,
  ): Promise<QuoteExactInResponse> {
    const { swapForY } = params;
    const { pool, extensions } = await this.state.fetchPoolWithExtensions(
      params.pool,
    );
    const extensionAddress = deriveTickArrayBitmapExtension(
      params.pool,
      this.programId,
    );
    const extensionState =
      pool.isBitmapExtensionInitialized === 1
        ? await this.state.fetchTickArrayBitmapExtension(extensionAddress)
        : null;
    const selection = tickArraysForSwap({
      pool: params.pool,
      poolState: pool,
      extensionState,
      swapForY,
      maxTickArrays: params.maxTickArrays,
      programId: this.programId,
    });
    const [tickArrays, inputMint, outputMint, clock] = await Promise.all([
      this.state.fetchTickArraysWithTicks(selection.tickArrays, {
        withReward: extensions.hasLiquidityMining,
      }),
      this.unpackMintAccount(
        swapForY ? pool.tokenXMint : pool.tokenYMint,
        swapForY ? pool.tokenXFlag : pool.tokenYFlag,
      ),
      this.unpackMintAccount(
        swapForY ? pool.tokenYMint : pool.tokenXMint,
        swapForY ? pool.tokenYFlag : pool.tokenXFlag,
      ),
      readClock(this.connection, this.commitment),
    ]);

    return {
      quote: quoteExactIn({
        poolAddress: params.pool,
        pool,
        poolActivation: extensions.activation ?? null,
        tickArrays: tickArrays.map(({ tickArray, ticks }) => ({
          pool: tickArray.pool,
          tickIndex: tickArray.tickIndex,
          ticks,
        })),
        bitmapExtension: extensionState,
        inputAmount: params.inputAmount,
        swapForY,
        hasReferral: params.hasReferral ?? false,
        swapper: params.swapper ?? null,
        currentSlot: clock.slot,
        currentTimestamp: clock.timestamp,
        epoch: clock.epoch,
        inputMint,
        outputMint,
      }),
      tickArrays: selection.tickArrays,
      tickArrayBitmapExtension: selection.requiresBitmapExtension
        ? extensionAddress
        : null,
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

    const pool = derivePool(
      params.config,
      params.tokenXMint,
      params.tokenYMint,
      this.programId,
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

    const pool = derivePool(
      params.config,
      params.tokenXMint,
      params.tokenYMint,
      this.programId,
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

    const pool = deriveLaunchPool(
      params.tokenXMint,
      params.tokenYMint,
      this.programId,
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
    const tickArray = deriveTickArray(
      params.pool,
      params.index,
      this.programId,
    );
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
      this.programId,
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
    const poolAuthority = derivePoolAuthority(this.programId);
    const reserveX = deriveReserve(
      params.tokenXMint,
      params.pool,
      this.programId,
    );
    const reserveY = deriveReserve(
      params.tokenYMint,
      params.pool,
      this.programId,
    );
    const xIsInput = params.swapForY;
    const referral = params.referral;
    const referralMint =
      referral && params.transferHookReferral === undefined
        ? await readTokenAccountMint(this.connection, referral, this.commitment)
        : null;
    const [pool, hooks] = await Promise.all([
      this.state.fetchPool(params.pool),
      resolveInstructionHooks(
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
          },
          transferHookY: {
            mint: params.tokenYMint,
            source: xIsInput ? reserveY : params.userTokenIn,
            destination: xIsInput ? params.userTokenOut : reserveY,
            authority: xIsInput ? poolAuthority : params.user,
          },
          transferHookReferral:
            referral && referralMint
              ? {
                  mint: referralMint,
                  source: deriveReserve(
                    referralMint,
                    params.pool,
                    this.programId,
                  ),
                  destination: referral,
                  authority: poolAuthority,
                }
              : undefined,
        },
      ),
    ]);
    const tickArrayBitmapExtension =
      params.tickArrayBitmapExtension !== undefined
        ? params.tickArrayBitmapExtension
        : pool.isBitmapExtensionInitialized === 1
          ? deriveTickArrayBitmapExtension(params.pool, this.programId)
          : null;

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
        tickArrayBitmapExtension,
        reserveX,
        reserveY,
        userTokenIn: params.userTokenIn,
        userTokenOut: params.userTokenOut,
        referral: referral ?? null,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        oracle: deriveOracle(params.pool, this.programId),
        user: params.user,
        tokenXProgram: params.tokenXProgram ?? getTokenProgram(pool.tokenXFlag),
        tokenYProgram: params.tokenYProgram ?? getTokenProgram(pool.tokenYFlag),
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

    const oracle = deriveOracle(params.pool, this.programId);
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
    const poolAuthority = derivePoolAuthority(this.programId);
    const reserveX = deriveReserve(
      params.tokenXMint,
      params.pool,
      this.programId,
    );
    const reserveY = deriveReserve(
      params.tokenYMint,
      params.pool,
      this.programId,
    );
    const [hooks, tokenXProgram, tokenYProgram] = await Promise.all([
      resolveInstructionHooks(
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
            source: reserveX,
            destination: params.receiverTokenX,
            authority: poolAuthority,
          },
          transferHookY: {
            mint: params.tokenYMint,
            source: reserveY,
            destination: params.receiverTokenY,
            authority: poolAuthority,
          },
        },
      ),
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
        reserveX,
        reserveY,
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

  private assertDistinctMints(tokenXMint: PublicKey, tokenYMint: PublicKey) {
    if (tokenXMint.equals(tokenYMint)) {
      throw PoolError.invalidParameters();
    }
  }

  private async unpackMintAccount(
    address: PublicKey,
    tokenProgramFlag: number,
  ): Promise<Mint> {
    const info = await readMintAccount(
      this.connection,
      address,
      this.commitment,
    );
    return unpackMint(address, info, getTokenProgram(tokenProgramFlag));
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
        ? deriveTickArrayBitmapExtension(params.pool, this.programId)
        : null);

    return {
      pool: params.pool,
      oracle: deriveOracle(params.pool, this.programId),
      reserveX: deriveReserve(params.tokenXMint, params.pool, this.programId),
      reserveY: deriveReserve(params.tokenYMint, params.pool, this.programId),
      tickArrayBitmapExtension,
      tokenXProgram,
      tokenYProgram,
      tokenBadgeX: params.tokenBadgeX ?? null,
      tokenBadgeY: params.tokenBadgeY ?? null,
    };
  }
}
