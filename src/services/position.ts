import {
  Transaction,
  type AccountMeta,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  MAX_BASIS_POINT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  POSITION_MAX_RANGE,
} from "../constants";
import { PoolError } from "../errors";
import {
  bitmapExtensionForTickArrays,
  derivePoolAuthority,
  derivePosition,
  deriveReserve,
  findNftAccount,
  getFeeGrowthInside,
  getPendingFees,
  getTokenProgram,
  isSupportExtension,
  liquidityBitmap,
  MAX_POSITION_DELEGATE_PERMISSION,
  positionIndexesFromBitmap,
  positionTotalLiquidity,
  readClock,
  readTransferFeeMint,
  resolveInstructionHooks,
  tickArrayIndexesForTickIds,
  tickArrayRemainingAccounts,
  tickArraysForTickIds,
  validateAddLiquidityByWeightParameters,
  validateBitmapLiquidities,
} from "../helpers";
import {
  assertOptionalU16,
  assertU8,
  assertU16,
  assertU64,
  assertU128,
} from "../helpers/validation";
import { U64_MAX, safeAdd } from "../math";
import { calculateTransferFeeExcludedAmount } from "../quote";
import {
  PoolExtension,
  type AddLiquidityByWeightParameters,
  type AddLiquidityImbalanceParameters,
  type AddLiquidityImbalanceSlippage,
  type AddLiquidityParameters,
  type DecodedTick,
  type LockVestingPositionParameters,
  type Pool,
  type RemoveLiquidityByBpsParameters,
  type RemoveLiquidityParameters,
  type RemovePositionParameters,
  type TickRange,
} from "../types";
import { DlmmProProgram } from "./program";

export type PositionTokenAccounts = {
  pool: PublicKey;
  nftMint: PublicKey;
  owner: PublicKey;
  /**
   * Owner or an approved delegate. A delegate withdraws only to the owner's
   * associated token accounts.
   */
  signer: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  userTokenX: PublicKey;
  userTokenY: PublicKey;
  tokenXProgram?: PublicKey;
  tokenYProgram?: PublicKey;
  nftAccount?: PublicKey;
  /** Defaults to the extension when the pool has one and a range's tick array lies outside the inline bitmap. */
  tickArrayBitmapExtension?: PublicKey | null;
  tickRanges: TickRange[];
  transferHookX?: AccountMeta[];
  transferHookY?: AccountMeta[];
};

export type OpenPositionParams = {
  pool: PublicKey;
  owner: PublicKey;
  payer: PublicKey;
  nftMint: PublicKey;
  tickRanges: TickRange[];
  nftAccount?: PublicKey;
};

export type AddLiquidityParams = PositionTokenAccounts & {
  parameters: AddLiquidityParameters;
};

export type AddLiquidityByWeightParams = PositionTokenAccounts & {
  parameters: AddLiquidityByWeightParameters;
};

export type AddLiquidityImbalanceParams = PositionTokenAccounts & {
  parameters: AddLiquidityImbalanceParameters;
};

export type RemoveLiquidityParams = PositionTokenAccounts & {
  parameters: RemoveLiquidityParameters;
};

export type RemoveLiquidityByBpsParams = PositionTokenAccounts & {
  parameters: RemoveLiquidityByBpsParameters;
};

export type ClaimFeeParams = Omit<
  PositionTokenAccounts,
  "tickArrayBitmapExtension"
> & {
  /**
   * Position slots to refresh before claiming. `tickRanges` must cover every
   * selected slot that holds liquidity; the refresh skips the others. Fees
   * only become claimable once refreshed.
   */
  bitmap: BN;
  /** Minimum token X to receive after transfer fees; defaults to no minimum. */
  minAmountX?: BN;
  /** Minimum token Y to receive after transfer fees; defaults to no minimum. */
  minAmountY?: BN;
};

export type ClosePositionParams = {
  pool: PublicKey;
  owner: PublicKey;
  nftMint: PublicKey;
  rentReceiver: PublicKey;
  tickRanges: TickRange[];
  nftAccount?: PublicKey;
};

export type ExpandPositionParams = {
  pool: PublicKey;
  signer: PublicKey;
  payer: PublicKey;
  nftMint: PublicKey;
  owner: PublicKey;
  tickRanges: TickRange[];
  nftAccount?: PublicKey;
};

export type RemovePositionRangesParams = {
  pool: PublicKey;
  signer: PublicKey;
  nftMint: PublicKey;
  owner: PublicKey;
  rentReceiver: PublicKey;
  tickRanges: TickRange[];
  parameters: RemovePositionParameters;
  nftAccount?: PublicKey;
};

export type LockPermanentPositionParams = {
  pool: PublicKey;
  nftMint: PublicKey;
  owner: PublicKey;
  bps: number;
  /**
   * Position layout version the caller expects, guarding against a delegate
   * reordering the position ranges in between; defaults to no check.
   */
  expectedLayoutVersion?: number;
  nftAccount?: PublicKey;
};

export type LockVestingPositionParams = {
  pool: PublicKey;
  nftMint: PublicKey;
  owner: PublicKey;
  parameters: LockVestingPositionParameters;
  nftAccount?: PublicKey;
};

export type RefreshFeesAndRewardsParams = {
  pool: PublicKey;
  nftMint: PublicKey;
  owner: PublicKey;
  signer: PublicKey;
  /**
   * Position slots to refresh, as a bitmap over the position array — build it
   * with `liquidityBitmap`.
   */
  bitmap: BN;
  /** Tick ranges of every slot selected by `bitmap` that holds liquidity. */
  tickRanges: TickRange[];
  nftAccount?: PublicKey;
};

export type ClaimableFeesParams = {
  pool: PublicKey;
  nftMint: PublicKey;
  /** Slots to refresh before claiming; defaults to every slot. */
  bitmap?: BN;
};

export type ClaimableFeeSlot = {
  index: number;
  tickLowerId: number;
  tickUpperId: number;
  feeX: BN;
  feeY: BN;
};

export type ClaimableFees = {
  layoutVersion: number;
  /** Slots the refresh leg touches. */
  bitmap: BN;
  /** Ranges of the selected slots holding liquidity, the only ones whose ticks the refresh reads. */
  tickRanges: TickRange[];
  slots: ClaimableFeeSlot[];
  /** Totals `claimFee` transfers, before Token-2022 transfer fees. */
  feeX: BN;
  feeY: BN;
};

export type CompoundFeesParams = Omit<PositionTokenAccounts, "tickRanges"> & {
  /** Slots to refresh before claiming; defaults to every slot. */
  bitmap?: BN;
  /** Slot that receives the redeposit. */
  index: number;
  /**
   * Redeposit caps, transfer-fee inclusive as in the program. Default to what
   * the claim delivers after its transfer fee, so balances already in the
   * wallet stay put, or to `null` when nothing arrives on that side. `null`
   * skips the side, which the program accepts only when the slot needs none
   * of that token at the current price; pass a wallet-funded cap to compound
   * into a slot that needs both tokens when one side earned nothing.
   */
  maxAmountX?: BN | null;
  maxAmountY?: BN | null;
  slippage?: AddLiquidityImbalanceSlippage;
  /** Defaults to the fetched layout version; `null` skips the check. */
  expectedLayoutVersion?: number | null;
  /** Minimums for the claim leg after transfer fees; default to none. */
  minAmountX?: BN;
  minAmountY?: BN;
};

function requireTick(
  ticks: Map<number, DecodedTick>,
  tickId: number,
): DecodedTick {
  const tick = ticks.get(tickId);
  if (!tick) {
    throw PoolError.cannotFindTickFromId();
  }
  return tick;
}

export class PositionService extends DlmmProProgram {
  /** The `nftMint` keypair must co-sign the transaction; the program initializes it as a new mint. */
  async openPosition(params: OpenPositionParams): Promise<{
    tx: Transaction;
    position: PublicKey;
    nftAccount: PublicKey;
  }> {
    const { tickSpacing } = await this.state.fetchPool(params.pool);
    const position = derivePosition(params.nftMint, this.programId);
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);

    const tx = await this.program.methods
      .openPosition({ tickRanges: params.tickRanges })
      .accountsPartial({
        pool: params.pool,
        nftMint: params.nftMint,
        nftAccount,
        position,
        owner: params.owner,
        payer: params.payer,
      })
      .remainingAccounts(
        tickArrayRemainingAccounts(
          params.pool,
          params.tickRanges,
          tickSpacing,
          true,
          this.programId,
        ),
      )
      .transaction();

    tx.feePayer = params.payer;
    return { tx, position, nftAccount };
  }

  async addLiquidity(params: AddLiquidityParams) {
    assertU64(params.parameters.maxAmountX);
    assertU64(params.parameters.maxAmountY);
    assertOptionalU16(params.parameters.expectedLayoutVersion);
    validateBitmapLiquidities(
      params.parameters.bitmap,
      params.parameters.liquidities,
    );
    const ctx = await this.liquidityAccounts(params, "deposit");
    const tx = await this.program.methods
      .addLiquidity(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return { tx, position: ctx.position };
  }

  async addLiquidityByWeight(params: AddLiquidityByWeightParams) {
    validateAddLiquidityByWeightParameters(params.parameters);
    const ctx = await this.liquidityAccounts(params, "deposit");
    const tx = await this.program.methods
      .addLiquidityByWeight(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return { tx, position: ctx.position };
  }

  async addLiquidityImbalance(params: AddLiquidityImbalanceParams) {
    this.validateAddLiquidityImbalance(params.parameters);
    const ctx = await this.liquidityAccounts(params, "deposit");
    const tx = await this.program.methods
      .addLiquidityImbalance(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return { tx, position: ctx.position };
  }

  async removeLiquidity(params: RemoveLiquidityParams) {
    assertU64(params.parameters.minAmountX);
    assertU64(params.parameters.minAmountY);
    assertOptionalU16(params.parameters.expectedLayoutVersion);
    validateBitmapLiquidities(
      params.parameters.bitmap,
      params.parameters.liquidities,
    );
    const ctx = await this.liquidityAccounts(params, "withdraw");
    const tx = await this.program.methods
      .removeLiquidity(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return { tx, position: ctx.position };
  }

  async removeLiquidityByBps(params: RemoveLiquidityByBpsParams) {
    assertU64(params.parameters.minAmountX);
    assertU64(params.parameters.minAmountY);
    assertOptionalU16(params.parameters.expectedLayoutVersion);
    if (
      !Number.isInteger(params.parameters.bps) ||
      params.parameters.bps <= 0 ||
      params.parameters.bps > MAX_BASIS_POINT
    ) {
      throw PoolError.invalidParameters();
    }
    if (params.parameters.bitmap !== null) {
      positionIndexesFromBitmap(params.parameters.bitmap);
    }
    const ctx = await this.liquidityAccounts(params, "withdraw");
    const tx = await this.program.methods
      .removeLiquidityByBps(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return { tx, position: ctx.position };
  }

  async claimFee(params: ClaimFeeParams): Promise<{ tx: Transaction }> {
    const tx = new Transaction().add(...(await this.claimFeeIxs(params)));
    tx.feePayer = params.signer;
    return { tx };
  }

  /**
   * Fees `claimFee` would transfer for `bitmap`, from the current pool and
   * tick state: refreshed slots accrue growth since their checkpoint, the
   * rest contribute what is already pending.
   */
  async getClaimableFees(params: ClaimableFeesParams): Promise<ClaimableFees> {
    const pool = await this.state.fetchPool(params.pool);
    return this.claimableFees(params.pool, pool, params.nftMint, params.bitmap);
  }

  /**
   * Refresh, claim and redeposit fees in one transaction. The claim leg is
   * `claimFee`; the deposit leg is `addLiquidityImbalance` into slot `index`,
   * so the program sizes the deposit from the wallet balance at execution.
   */
  async compoundFees(params: CompoundFeesParams): Promise<{
    tx: Transaction;
    position: PublicKey;
    claimable: ClaimableFees;
    parameters: AddLiquidityImbalanceParameters;
  }> {
    const pool = await this.state.fetchPool(params.pool);
    const claimable = await this.claimableFees(
      params.pool,
      pool,
      params.nftMint,
      params.bitmap,
    );
    const target = claimable.slots[params.index];
    if (!target) {
      throw PoolError.invalidParameters();
    }
    let { maxAmountX, maxAmountY } = params;
    if (maxAmountX === undefined || maxAmountY === undefined) {
      // What the claim delivers to the wallet, net of each mint's transfer fee.
      const [mintX, mintY, { epoch }] = await Promise.all([
        readTransferFeeMint(
          this.connection,
          params.tokenXMint,
          this.commitment,
        ),
        readTransferFeeMint(
          this.connection,
          params.tokenYMint,
          this.commitment,
        ),
        readClock(this.connection, this.commitment),
      ]);
      const claimedX = calculateTransferFeeExcludedAmount(
        mintX,
        epoch,
        claimable.feeX,
      ).amount;
      const claimedY = calculateTransferFeeExcludedAmount(
        mintY,
        epoch,
        claimable.feeY,
      ).amount;
      if (
        maxAmountX === undefined &&
        maxAmountY === undefined &&
        claimedX.isZero() &&
        claimedY.isZero()
      ) {
        throw PoolError.amountIsZero();
      }
      if (maxAmountX === undefined) {
        maxAmountX = claimedX.isZero() ? null : claimedX;
      }
      if (maxAmountY === undefined) {
        maxAmountY = claimedY.isZero() ? null : claimedY;
      }
    }
    const parameters: AddLiquidityImbalanceParameters = {
      maxAmountX,
      maxAmountY,
      slippage: params.slippage ?? {
        sqrtPriceSlippage: null,
        minLiquidity: null,
      },
      expectedLayoutVersion:
        params.expectedLayoutVersion === undefined
          ? claimable.layoutVersion
          : params.expectedLayoutVersion,
      index: params.index,
    };
    this.validateAddLiquidityImbalance(parameters);

    const accounts = {
      pool: params.pool,
      nftMint: params.nftMint,
      owner: params.owner,
      signer: params.signer,
      nftAccount: params.nftAccount,
      tokenXMint: params.tokenXMint,
      tokenYMint: params.tokenYMint,
      userTokenX: params.userTokenX,
      userTokenY: params.userTokenY,
      tokenXProgram: params.tokenXProgram,
      tokenYProgram: params.tokenYProgram,
      transferHookX: params.transferHookX,
      transferHookY: params.transferHookY,
    };
    const [claimIxs, deposit] = await Promise.all([
      this.claimFeeIxs(
        {
          ...accounts,
          bitmap: claimable.bitmap,
          tickRanges: claimable.tickRanges,
          minAmountX: params.minAmountX,
          minAmountY: params.minAmountY,
        },
        pool,
      ),
      this.liquidityAccounts(
        {
          ...accounts,
          tickRanges: [
            {
              tickLowerId: target.tickLowerId,
              tickUpperId: target.tickUpperId,
            },
          ],
          tickArrayBitmapExtension: params.tickArrayBitmapExtension,
        },
        "deposit",
        pool,
      ),
    ]);
    const depositIx = await this.program.methods
      .addLiquidityImbalance(parameters, deposit.remainingAccountsInfo)
      .accountsPartial(deposit.accounts)
      .remainingAccounts(deposit.remainingAccounts)
      .instruction();

    const tx = new Transaction().add(...claimIxs, depositIx);
    tx.feePayer = params.signer;
    return { tx, position: deposit.position, claimable, parameters };
  }

  async closePosition(params: ClosePositionParams): Promise<{
    tx: Transaction;
    position: PublicKey;
  }> {
    const { tickSpacing } = await this.state.fetchPool(params.pool);
    const position = derivePosition(params.nftMint, this.programId);
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);

    const tx = await this.program.methods
      .closePosition()
      .accountsPartial({
        nftMint: params.nftMint,
        nftAccount,
        pool: params.pool,
        position,
        rentReceiver: params.rentReceiver,
        owner: params.owner,
      })
      .remainingAccounts(
        tickArrayRemainingAccounts(
          params.pool,
          params.tickRanges,
          tickSpacing,
          true,
          this.programId,
        ),
      )
      .transaction();

    tx.feePayer = params.owner;
    return { tx, position };
  }

  async expandPosition(params: ExpandPositionParams): Promise<{
    tx: Transaction;
    position: PublicKey;
  }> {
    const { tickSpacing } = await this.state.fetchPool(params.pool);
    const position = derivePosition(params.nftMint, this.programId);
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);

    const tx = await this.program.methods
      .expandPosition({ tickRanges: params.tickRanges })
      .accountsPartial({
        pool: params.pool,
        position,
        nftAccount,
        signer: params.signer,
        payer: params.payer,
      })
      .remainingAccounts(
        tickArrayRemainingAccounts(
          params.pool,
          params.tickRanges,
          tickSpacing,
          true,
          this.programId,
        ),
      )
      .transaction();

    tx.feePayer = params.payer;
    return { tx, position };
  }

  /**
   * `tickRanges` must be exactly the tick arrays of the ranges selected by
   * `parameters.bitmap`. A delegate must name the owner as `rentReceiver`.
   */
  async removePosition(
    params: RemovePositionRangesParams,
  ): Promise<{ tx: Transaction; position: PublicKey }> {
    positionIndexesFromBitmap(params.parameters.bitmap);
    assertOptionalU16(params.parameters.expectedLayoutVersion);
    if (
      !params.signer.equals(params.owner) &&
      !params.rentReceiver.equals(params.owner)
    ) {
      throw PoolError.invalidPermission();
    }
    const { tickSpacing } = await this.state.fetchPool(params.pool);
    const position = derivePosition(params.nftMint, this.programId);
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);

    const tx = await this.program.methods
      .removePosition(params.parameters)
      .accountsPartial({
        pool: params.pool,
        position,
        nftAccount,
        signer: params.signer,
        rentReceiver: params.rentReceiver,
      })
      .remainingAccounts(
        tickArrayRemainingAccounts(
          params.pool,
          params.tickRanges,
          tickSpacing,
          true,
          this.programId,
        ),
      )
      .transaction();

    tx.feePayer = params.signer;
    return { tx, position };
  }

  async lockPermanentPosition(
    params: LockPermanentPositionParams,
  ): Promise<{ tx: Transaction }> {
    if (
      !Number.isInteger(params.bps) ||
      params.bps <= 0 ||
      params.bps > MAX_BASIS_POINT
    ) {
      throw PoolError.invalidParameters();
    }
    const expectedLayoutVersion = params.expectedLayoutVersion ?? null;
    assertOptionalU16(expectedLayoutVersion);

    const tx = await this.program.methods
      .lockPermanentPosition({ bps: params.bps, expectedLayoutVersion })
      .accountsPartial({
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount:
          params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
        signer: params.owner,
      })
      .transaction();

    tx.feePayer = params.owner;
    return { tx };
  }

  async lockVestingPosition(
    params: LockVestingPositionParams,
  ): Promise<{ tx: Transaction }> {
    this.validateLockVesting(params.parameters);
    const tx = await this.program.methods
      .lockVestingPosition(params.parameters)
      .accountsPartial({
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount:
          params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
        signer: params.owner,
      })
      .transaction();

    tx.feePayer = params.owner;
    return { tx };
  }

  async refreshFeesAndRewards(
    params: RefreshFeesAndRewardsParams,
  ): Promise<{ tx: Transaction }> {
    positionIndexesFromBitmap(params.bitmap);
    const { tickSpacing } = await this.state.fetchPool(params.pool);
    const ix = await this.refreshFeesAndRewardsIx({
      pool: params.pool,
      nftMint: params.nftMint,
      nftAccount:
        params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
      signer: params.signer,
      bitmap: params.bitmap,
      tickRanges: params.tickRanges,
      tickSpacing,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = params.signer;
    return { tx };
  }

  async updatePositionDelegatePermission(params: {
    nftMint: PublicKey;
    owner: PublicKey;
    permission: number;
    nftAccount?: PublicKey;
  }): Promise<{ tx: Transaction }> {
    if (
      !Number.isInteger(params.permission) ||
      params.permission < 0 ||
      params.permission > MAX_POSITION_DELEGATE_PERMISSION
    ) {
      throw PoolError.invalidPermission();
    }

    const tx = await this.program.methods
      .updatePositionDelegatePermission(params.permission)
      .accountsPartial({
        position: derivePosition(params.nftMint, this.programId),
        nftAccount:
          params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
        owner: params.owner,
      })
      .transaction();

    tx.feePayer = params.owner;
    return { tx };
  }

  /** `compoundFees` passes the pool it already read. */
  private async claimFeeIxs(
    params: ClaimFeeParams,
    pool?: Pool,
  ): Promise<TransactionInstruction[]> {
    const minAmountX = params.minAmountX ?? new BN(0);
    const minAmountY = params.minAmountY ?? new BN(0);
    assertU64(minAmountX);
    assertU64(minAmountY);
    positionIndexesFromBitmap(params.bitmap);
    const ctx = await this.tokenAccounts(params, "withdraw", pool);
    const refresh = await this.refreshFeesAndRewardsIx({
      pool: params.pool,
      nftMint: params.nftMint,
      nftAccount: ctx.accounts.nftAccount,
      signer: params.signer,
      bitmap: params.bitmap,
      tickRanges: params.tickRanges,
      tickSpacing: ctx.pool.tickSpacing,
    });
    const claim = await this.program.methods
      .claimFee(minAmountX, minAmountY, ctx.hooks.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.hooks.remainingAccounts)
      .instruction();
    return [refresh, claim];
  }

  /** Accounts and hook metas of an instruction moving X and Y between the user and the reserves. */
  private async tokenAccounts(
    params: Omit<
      PositionTokenAccounts,
      "tickRanges" | "tickArrayBitmapExtension"
    >,
    flow: "deposit" | "withdraw",
    pool?: Pool,
  ) {
    const deposit = flow === "deposit";
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
    const authority = deposit
      ? params.signer
      : derivePoolAuthority(this.programId);
    const [poolState, hooks] = await Promise.all([
      pool ?? this.state.fetchPool(params.pool),
      resolveInstructionHooks(this.connection, this.commitment, {
        transferHookX: {
          metas: params.transferHookX,
          leg: {
            mint: params.tokenXMint,
            source: deposit ? params.userTokenX : reserveX,
            destination: deposit ? reserveX : params.userTokenX,
            authority,
          },
        },
        transferHookY: {
          metas: params.transferHookY,
          leg: {
            mint: params.tokenYMint,
            source: deposit ? params.userTokenY : reserveY,
            destination: deposit ? reserveY : params.userTokenY,
            authority,
          },
        },
      }),
    ]);
    return {
      pool: poolState,
      hooks,
      accounts: {
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount:
          params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
        userTokenX: params.userTokenX,
        userTokenY: params.userTokenY,
        reserveX,
        reserveY,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        signer: params.signer,
        tokenXProgram:
          params.tokenXProgram ?? getTokenProgram(poolState.tokenXFlag),
        tokenYProgram:
          params.tokenYProgram ?? getTokenProgram(poolState.tokenYFlag),
      },
    };
  }

  private async liquidityAccounts(
    params: PositionTokenAccounts,
    flow: "deposit" | "withdraw",
    pool?: Pool,
  ) {
    const ctx = await this.tokenAccounts(params, flow, pool);
    const { tickSpacing, isBitmapExtensionInitialized } = ctx.pool;
    return {
      position: ctx.accounts.position,
      remainingAccountsInfo: ctx.hooks.remainingAccountsInfo,
      remainingAccounts: [
        ...ctx.hooks.remainingAccounts,
        ...tickArrayRemainingAccounts(
          params.pool,
          params.tickRanges,
          tickSpacing,
          true,
          this.programId,
        ),
      ],
      accounts: {
        ...ctx.accounts,
        tickArrayBitmapExtension:
          params.tickArrayBitmapExtension !== undefined
            ? params.tickArrayBitmapExtension
            : bitmapExtensionForTickArrays(
                params.pool,
                isBitmapExtensionInitialized,
                tickArrayIndexesForTickIds(
                  params.tickRanges.flatMap((range) => [
                    range.tickLowerId,
                    range.tickUpperId,
                  ]),
                  tickSpacing,
                ),
                this.programId,
              ),
      },
    };
  }

  private async claimableFees(
    poolAddress: PublicKey,
    pool: Pool,
    nftMint: PublicKey,
    bitmap: BN | undefined,
  ): Promise<ClaimableFees> {
    const withReward = isSupportExtension(
      pool.extensions,
      PoolExtension.LiquidityMining,
    );
    const positionAddress = derivePosition(nftMint, this.programId);
    const { positionArray, positions } =
      await this.state.fetchPositionArrayWithPositions(positionAddress, {
        withReward,
      });
    if (!positionArray.pool.equals(poolAddress)) {
      throw new Error(
        `Position ${positionAddress.toBase58()} does not belong to pool ${poolAddress.toBase58()}`,
      );
    }

    const selected =
      bitmap === undefined
        ? positions.map((_, index) => index)
        : positionIndexesFromBitmap(bitmap);
    if (selected.some((index) => index >= positions.length)) {
      throw PoolError.invalidParameters();
    }
    // The refresh updates only the selected slots that hold liquidity.
    const refreshed = selected.filter(
      (index) => !positionTotalLiquidity(positions[index]).isZero(),
    );
    const tickRanges = refreshed.map((index) => ({
      tickLowerId: positions[index].tickLowerId,
      tickUpperId: positions[index].tickUpperId,
    }));
    const tickArrays = await this.state.fetchTickArraysWithTicks(
      tickArraysForTickIds(
        poolAddress,
        tickRanges.flatMap((range) => [range.tickLowerId, range.tickUpperId]),
        pool.tickSpacing,
        this.programId,
      ),
      { withReward },
    );
    const ticks = new Map(
      tickArrays.flatMap((array) =>
        array.ticks.map((tick) => [tick.tickId, tick] as const),
      ),
    );

    const slots = positions.map((position, index): ClaimableFeeSlot => {
      const fees = refreshed.includes(index)
        ? getPendingFees(
            position,
            getFeeGrowthInside({
              tickCurrentId: pool.tickCurrentId,
              tickLower: requireTick(ticks, position.tickLowerId),
              tickLowerId: position.tickLowerId,
              tickUpper: requireTick(ticks, position.tickUpperId),
              tickUpperId: position.tickUpperId,
              feeGrowthGlobalX: pool.feeGrowthGlobalX,
              feeGrowthGlobalY: pool.feeGrowthGlobalY,
            }),
          )
        : { feeX: position.feePendingX, feeY: position.feePendingY };
      return {
        index,
        tickLowerId: position.tickLowerId,
        tickUpperId: position.tickUpperId,
        ...fees,
      };
    });

    return {
      layoutVersion: positionArray.layoutVersion,
      bitmap: bitmap ?? liquidityBitmap(selected),
      tickRanges,
      slots,
      feeX: slots.reduce(
        (sum, slot) => safeAdd(sum, slot.feeX, U64_MAX),
        new BN(0),
      ),
      feeY: slots.reduce(
        (sum, slot) => safeAdd(sum, slot.feeY, U64_MAX),
        new BN(0),
      ),
    };
  }

  private validateAddLiquidityImbalance(
    parameters: AddLiquidityImbalanceParameters,
  ): void {
    if (parameters.maxAmountX === null && parameters.maxAmountY === null) {
      throw PoolError.invalidParameters();
    }
    for (const amount of [parameters.maxAmountX, parameters.maxAmountY]) {
      if (amount !== null) {
        assertU64(amount);
        if (amount.isZero()) {
          throw PoolError.amountIsZero();
        }
      }
    }
    const sqrtPriceSlippage = parameters.slippage.sqrtPriceSlippage;
    if (sqrtPriceSlippage) {
      assertU128(sqrtPriceSlippage.minSqrtPrice);
      assertU128(sqrtPriceSlippage.maxSqrtPrice);
      if (
        sqrtPriceSlippage.minSqrtPrice.lt(MIN_SQRT_PRICE) ||
        sqrtPriceSlippage.maxSqrtPrice.gt(MAX_SQRT_PRICE) ||
        sqrtPriceSlippage.minSqrtPrice.gt(sqrtPriceSlippage.maxSqrtPrice)
      ) {
        throw PoolError.invalidParameters();
      }
    }
    if (parameters.slippage.minLiquidity !== null) {
      assertU128(parameters.slippage.minLiquidity);
    }
    assertOptionalU16(parameters.expectedLayoutVersion);
    assertU8(parameters.index);
    if (parameters.index >= POSITION_MAX_RANGE) {
      throw PoolError.invalidParameters();
    }
  }

  private validateLockVesting(parameters: LockVestingPositionParameters): void {
    if (parameters.cliffPoint !== null) {
      assertU64(parameters.cliffPoint);
    }
    assertU16(parameters.cliffUnlockBps);
    assertU16(parameters.bpsPerPeriod);
    assertU64(parameters.periodFrequency);
    assertU16(parameters.numberOfPeriod);
    assertU16(parameters.bps);
    assertOptionalU16(parameters.expectedLayoutVersion);

    // The periodic schedule is all set or all unset, and with the cliff it
    // releases exactly the whole position.
    const periodic = [
      !parameters.periodFrequency.isZero(),
      parameters.bpsPerPeriod > 0,
      parameters.numberOfPeriod > 0,
    ];
    if (
      periodic.some(Boolean) !== periodic.every(Boolean) ||
      parameters.cliffUnlockBps +
        parameters.bpsPerPeriod * parameters.numberOfPeriod !==
        MAX_BASIS_POINT ||
      parameters.bps === 0 ||
      parameters.bps > MAX_BASIS_POINT
    ) {
      throw PoolError.invalidParameters();
    }
  }
}
