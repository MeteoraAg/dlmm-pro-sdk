import { PublicKey, Transaction, type AccountMeta } from "@solana/web3.js";
import BN from "bn.js";
import {
  MAX_BASIS_POINT,
  MAX_SQRT_PRICE,
  MAX_VESTING_DURATION,
  MAX_VESTING_DURATION_SLOT,
  MIN_SQRT_PRICE,
  POSITION_MAX_RANGE,
} from "../constants";
import { PoolError } from "../errors";
import {
  assertDelegateReceiver,
  derivePoolAuthority,
  derivePosition,
  deriveReserve,
  deriveTickArray,
  deriveTickArrayBitmapExtension,
  findNftAccount,
  getFeeGrowthInside,
  getPendingFees,
  isSupportExtension,
  imbalanceTransferAmounts,
  lazy,
  LIQUIDITY_HOOKS,
  liquidityBitmap,
  liquidityTransferAmounts,
  overflowsDefaultTickArrayBitmap,
  positionIndexesFromBitmap,
  positionTotalLiquidity,
  readClock,
  readTokenAccountAmount,
  readTransferFeeMint,
  resolveInstructionHooks,
  resolveTokenProgram,
  type TransferHookAmount,
  unlockedLiquidityForWithdraw,
  bpsWithdrawLiquidity,
  tickArrayRemainingAccounts,
  tickIndexFromId,
} from "../helpers";
import {
  assertOptionalU16,
  assertU8,
  assertU16,
  assertU64,
  assertU128,
} from "../helpers/validation";
import { I128_MAX, U64_MAX, U128_MAX, safeAdd, safeMul } from "../math";
import { calculateTransferFeeExcludedAmount, getCurrentPoint } from "../quote";
import {
  ActivationType,
  PoolExtension,
  PositionDelegatePermission,
  type AddLiquidityByWeightParameters,
  type AddLiquidityImbalanceParameters,
  type AddLiquidityImbalanceSlippage,
  type AddLiquidityParameters,
  type DecodedTick,
  type LockVestingPositionParameters,
  type Pool,
  type RemainingAccountsInfo,
  type RemoveLiquidityByBpsParameters,
  type RemoveLiquidityParameters,
  type RemovePositionParameters,
  type TickRange,
} from "../types";
import { DlmmProProgram } from "./program";

type PositionTokenAccounts = {
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
  tickArrayBitmapExtension?: PublicKey | null;
  tickRanges: TickRange[];
  tickSpacing: number;
  transferHookX?: AccountMeta[];
  transferHookY?: AccountMeta[];
};

export type OpenPositionParams = {
  pool: PublicKey;
  owner: PublicKey;
  payer: PublicKey;
  nftMint: PublicKey;
  tickRanges: TickRange[];
  tickSpacing: number;
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
  /**
   * Balances the program sees when this instruction runs. Omit to read the
   * user token accounts now. `compoundFees` passes the post-claim balances,
   * because the claim and the deposit share one transaction.
   */
  availableAmountX?: BN | (() => Promise<BN>);
  availableAmountY?: BN | (() => Promise<BN>);
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
   * selected slot. Fees only become claimable once refreshed.
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
  tickSpacing: number;
  nftAccount?: PublicKey;
};

export type ExpandPositionParams = {
  pool: PublicKey;
  signer: PublicKey;
  payer: PublicKey;
  nftMint: PublicKey;
  owner: PublicKey;
  tickRanges: TickRange[];
  tickSpacing: number;
  nftAccount?: PublicKey;
};

export type RemovePositionRangesParams = {
  pool: PublicKey;
  signer: PublicKey;
  nftMint: PublicKey;
  owner: PublicKey;
  rentReceiver: PublicKey;
  tickRanges: TickRange[];
  tickSpacing: number;
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
  /** Tick ranges covering every slot selected by `bitmap`. */
  tickRanges: TickRange[];
  tickSpacing: number;
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
  tickSpacing: number;
  /** Slots the refresh leg touches. */
  bitmap: BN;
  slots: ClaimableFeeSlot[];
  /** Totals `claimFee` transfers, before Token-2022 transfer fees. */
  feeX: BN;
  feeY: BN;
};

export type CompoundFeesParams = Omit<
  PositionTokenAccounts,
  "tickRanges" | "tickSpacing"
> & {
  /** Slots to refresh before claiming; defaults to every slot. */
  bitmap?: BN;
  /** Slot that receives the redeposit. */
  index: number;
  /**
   * Redeposit caps, transfer-fee inclusive as in the program. Default to the
   * claimable fees so balances already in the wallet stay put, or to `null`
   * when nothing is claimable on that side. `null` skips the side, which the
   * program accepts only when the slot lies entirely on the other side of the
   * current price; pass a wallet-funded cap to compound into a slot that
   * needs both tokens when one side earned nothing.
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

const MAX_POSITION_DELEGATE_PERMISSION =
  (1 << (PositionDelegatePermission.UpdatePositionRange + 1)) - 1;

function validateBitmapLiquidities(bitmap: BN, liquidities: BN[]): void {
  const selected = positionIndexesFromBitmap(bitmap);
  if (selected.length !== liquidities.length) {
    throw PoolError.invalidParameters();
  }
  for (const liquidity of liquidities) {
    assertU128(liquidity);
    if (liquidity.isZero()) {
      throw PoolError.liquidityIsZero();
    }
    if (liquidity.gt(I128_MAX)) {
      throw PoolError.liquidityIsTooHigh();
    }
  }
}

function validateLiquidityAmounts(
  amountX: BN,
  amountY: BN,
  expectedLayoutVersion: number | null,
): void {
  assertU64(amountX);
  assertU64(amountY);
  assertOptionalU16(expectedLayoutVersion);
}

export class PositionService extends DlmmProProgram {
  /** The `nftMint` keypair must co-sign the transaction; the program initializes it as a new mint. */
  async openPosition(params: OpenPositionParams): Promise<{
    tx: Transaction;
    position: PublicKey;
    nftAccount: PublicKey;
  }> {
    const tickSpacing = await this.resolveTickSpacing(
      params.pool,
      params.tickSpacing,
    );
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
    validateLiquidityAmounts(
      params.parameters.maxAmountX,
      params.parameters.maxAmountY,
      params.parameters.expectedLayoutVersion,
    );
    validateBitmapLiquidities(
      params.parameters.bitmap,
      params.parameters.liquidities,
    );
    const amounts = lazy(() =>
      this.liquidityHookAmounts(
        params,
        params.parameters.bitmap,
        params.parameters.liquidities,
        false,
        params.parameters.maxAmountX,
        params.parameters.maxAmountY,
      ),
    );
    const ctx = await this.liquidityAccounts(
      params,
      "deposit",
      async () => (await amounts()).amountX,
      async () => (await amounts()).amountY,
    );
    const tx = await this.program.methods
      .addLiquidity(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return {
      tx,
      position: ctx.position,
      remainingAccountsInfo: ctx.remainingAccountsInfo,
    };
  }

  async addLiquidityByWeight(params: AddLiquidityByWeightParams) {
    validateLiquidityAmounts(
      params.parameters.maxAmountX,
      params.parameters.maxAmountY,
      params.parameters.expectedLayoutVersion,
    );
    assertU128(params.parameters.multiplier);
    const weights = Array.from(params.parameters.liquidities);
    if (params.parameters.multiplier.isZero()) {
      throw PoolError.liquidityIsZero();
    }
    if (
      positionIndexesFromBitmap(params.parameters.bitmap).length !==
      weights.length
    ) {
      throw PoolError.invalidParameters();
    }
    const liquidities = weights.map((weight) => {
      assertU8(weight);
      if (weight === 0) {
        throw PoolError.liquidityIsZero();
      }
      const liquidity = safeMul(
        params.parameters.multiplier,
        new BN(weight),
        U128_MAX,
      );
      if (liquidity.gt(I128_MAX)) {
        throw PoolError.liquidityIsTooHigh();
      }
      return liquidity;
    });
    const amounts = lazy(() =>
      this.liquidityHookAmounts(
        params,
        params.parameters.bitmap,
        liquidities,
        false,
        params.parameters.maxAmountX,
        params.parameters.maxAmountY,
      ),
    );
    const ctx = await this.liquidityAccounts(
      params,
      "deposit",
      async () => (await amounts()).amountX,
      async () => (await amounts()).amountY,
    );
    const tx = await this.program.methods
      .addLiquidityByWeight(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return {
      tx,
      position: ctx.position,
      remainingAccountsInfo: ctx.remainingAccountsInfo,
    };
  }

  async addLiquidityImbalance(params: AddLiquidityImbalanceParams) {
    this.validateAddLiquidityImbalance(params.parameters);
    const amounts = lazy(() => this.imbalanceHookAmounts(params));
    const ctx = await this.liquidityAccounts(
      params,
      "deposit",
      async () => (await amounts()).amountX,
      async () => (await amounts()).amountY,
    );
    const tx = await this.program.methods
      .addLiquidityImbalance(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return {
      tx,
      position: ctx.position,
      remainingAccountsInfo: ctx.remainingAccountsInfo,
    };
  }

  async removeLiquidity(params: RemoveLiquidityParams) {
    validateLiquidityAmounts(
      params.parameters.minAmountX,
      params.parameters.minAmountY,
      params.parameters.expectedLayoutVersion,
    );
    validateBitmapLiquidities(
      params.parameters.bitmap,
      params.parameters.liquidities,
    );
    const amounts = lazy(() =>
      this.liquidityHookAmounts(
        params,
        params.parameters.bitmap,
        params.parameters.liquidities,
        true,
        params.parameters.minAmountX,
        params.parameters.minAmountY,
      ),
    );
    const ctx = await this.liquidityAccounts(
      params,
      "withdraw",
      async () => (await amounts()).amountX,
      async () => (await amounts()).amountY,
    );
    const tx = await this.program.methods
      .removeLiquidity(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return {
      tx,
      position: ctx.position,
      remainingAccountsInfo: ctx.remainingAccountsInfo,
    };
  }

  async removeLiquidityByBps(params: RemoveLiquidityByBpsParams) {
    validateLiquidityAmounts(
      params.parameters.minAmountX,
      params.parameters.minAmountY,
      params.parameters.expectedLayoutVersion,
    );
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
    const amounts = lazy(() => this.removeByBpsHookAmounts(params));
    const ctx = await this.liquidityAccounts(
      params,
      "withdraw",
      async () => (await amounts()).amountX,
      async () => (await amounts()).amountY,
    );
    const tx = await this.program.methods
      .removeLiquidityByBps(params.parameters, ctx.remainingAccountsInfo)
      .accountsPartial(ctx.accounts)
      .remainingAccounts(ctx.remainingAccounts)
      .transaction();
    tx.feePayer = params.signer;
    return {
      tx,
      position: ctx.position,
      remainingAccountsInfo: ctx.remainingAccountsInfo,
    };
  }

  async claimFee(params: ClaimFeeParams): Promise<{ tx: Transaction }> {
    assertU64(params.minAmountX ?? new BN(0));
    assertU64(params.minAmountY ?? new BN(0));
    const poolAuthority = derivePoolAuthority(this.programId);
    const fees = lazy(() =>
      this.getClaimableFees({
        pool: params.pool,
        nftMint: params.nftMint,
        bitmap: params.bitmap,
      }),
    );
    const { remainingAccountsInfo, remainingAccounts } =
      await resolveInstructionHooks(
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
            source: deriveReserve(
              params.tokenXMint,
              params.pool,
              this.programId,
            ),
            destination: params.userTokenX,
            authority: poolAuthority,
            amount: async () => (await fees()).feeX,
          },
          transferHookY: {
            mint: params.tokenYMint,
            source: deriveReserve(
              params.tokenYMint,
              params.pool,
              this.programId,
            ),
            destination: params.userTokenY,
            authority: poolAuthority,
            amount: async () => (await fees()).feeY,
          },
        },
      );
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);
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
    assertDelegateReceiver({
      owner: params.owner,
      signer: params.signer,
      tokenAccount: params.userTokenX,
      mint: params.tokenXMint,
      tokenProgram: tokenXProgram,
    });
    assertDelegateReceiver({
      owner: params.owner,
      signer: params.signer,
      tokenAccount: params.userTokenY,
      mint: params.tokenYMint,
      tokenProgram: tokenYProgram,
    });

    const refresh = await this.refreshFeesAndRewards({
      pool: params.pool,
      nftMint: params.nftMint,
      owner: params.owner,
      signer: params.signer,
      nftAccount,
      bitmap: params.bitmap,
      tickRanges: params.tickRanges,
      tickSpacing: params.tickSpacing,
    });
    const claim = await this.program.methods
      .claimFee(
        params.minAmountX ?? new BN(0),
        params.minAmountY ?? new BN(0),
        remainingAccountsInfo,
      )
      .accountsPartial({
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount,
        signer: params.signer,
        reserveX: deriveReserve(params.tokenXMint, params.pool, this.programId),
        reserveY: deriveReserve(params.tokenYMint, params.pool, this.programId),
        userTokenX: params.userTokenX,
        userTokenY: params.userTokenY,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        tokenXProgram,
        tokenYProgram,
      })
      .remainingAccounts(remainingAccounts)
      .transaction();

    const tx = new Transaction().add(
      ...refresh.tx.instructions,
      ...claim.instructions,
    );
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
    assertU8(params.index);
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
    if (
      params.maxAmountX === undefined &&
      params.maxAmountY === undefined &&
      claimable.feeX.isZero() &&
      claimable.feeY.isZero()
    ) {
      throw PoolError.amountIsZero();
    }

    const cap = (override: BN | null | undefined, fee: BN): BN | null => {
      if (override !== undefined) {
        return override;
      }
      return fee.isZero() ? null : fee;
    };
    const maxAmountX = cap(params.maxAmountX, claimable.feeX);
    const maxAmountY = cap(params.maxAmountY, claimable.feeY);
    // A skipped side caps the deposit at zero, which the program rejects once
    // the slot needs that token at the current price; both skipped is left to
    // the imbalance validation.
    const skipsX = maxAmountX === null;
    const skipsY = maxAmountY === null;
    if (
      skipsX !== skipsY &&
      ((skipsX && pool.tickCurrentId < target.tickUpperId) ||
        (skipsY && pool.tickCurrentId >= target.tickLowerId))
    ) {
      throw PoolError.exceededSlippage();
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
      tokenXProgram,
      tokenYProgram,
      transferHookX: params.transferHookX,
      transferHookY: params.transferHookY,
      tickSpacing: claimable.tickSpacing,
    };
    const rangeOf = (slot: ClaimableFeeSlot): TickRange => ({
      tickLowerId: slot.tickLowerId,
      tickUpperId: slot.tickUpperId,
    });
    const targetRange = rangeOf(target);

    const claim = await this.claimFee({
      ...accounts,
      bitmap: claimable.bitmap,
      tickRanges: positionIndexesFromBitmap(claimable.bitmap).map((index) =>
        rangeOf(claimable.slots[index]),
      ),
      minAmountX: params.minAmountX,
      minAmountY: params.minAmountY,
    });
    const balancesAfterClaim = lazy(async () => {
      const [mintX, mintY, clock, balanceX, balanceY] = await Promise.all([
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
        readTokenAccountAmount(
          this.connection,
          params.userTokenX,
          tokenXProgram,
          this.commitment,
        ),
        readTokenAccountAmount(
          this.connection,
          params.userTokenY,
          tokenYProgram,
          this.commitment,
        ),
      ]);
      return {
        x: safeAdd(
          balanceX,
          calculateTransferFeeExcludedAmount(mintX, clock.epoch, claimable.feeX)
            .amount,
          U64_MAX,
        ),
        y: safeAdd(
          balanceY,
          calculateTransferFeeExcludedAmount(mintY, clock.epoch, claimable.feeY)
            .amount,
          U64_MAX,
        ),
      };
    });
    const deposit = await this.addLiquidityImbalance({
      ...accounts,
      tickRanges: [targetRange],
      tickArrayBitmapExtension:
        params.tickArrayBitmapExtension !== undefined
          ? params.tickArrayBitmapExtension
          : this.bitmapExtensionFor(
              params.pool,
              targetRange,
              claimable.tickSpacing,
            ),
      parameters,
      availableAmountX: async () => (await balancesAfterClaim()).x,
      availableAmountY: async () => (await balancesAfterClaim()).y,
    });

    const tx = new Transaction().add(
      ...claim.tx.instructions,
      ...deposit.tx.instructions,
    );
    tx.feePayer = params.signer;
    return { tx, position: deposit.position, claimable, parameters };
  }

  async closePosition(params: ClosePositionParams): Promise<{
    tx: Transaction;
    position: PublicKey;
  }> {
    const tickSpacing = await this.resolveTickSpacing(
      params.pool,
      params.tickSpacing,
    );
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
    const tickSpacing = await this.resolveTickSpacing(
      params.pool,
      params.tickSpacing,
    );
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
    const tickSpacing = await this.resolveTickSpacing(
      params.pool,
      params.tickSpacing,
    );
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
    assertOptionalU16(params.expectedLayoutVersion ?? null);

    const tx = await this.program.methods
      .lockPermanentPosition({
        bps: params.bps,
        expectedLayoutVersion: params.expectedLayoutVersion ?? null,
      })
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
    await this.assertScheduleWithinVestingCap(params.pool, params.parameters);
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
    const tickSpacing = await this.resolveTickSpacing(
      params.pool,
      params.tickSpacing,
    );
    const tx = await this.refreshFeesAndRewardsTx({
      pool: params.pool,
      nftMint: params.nftMint,
      nftAccount:
        params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
      signer: params.signer,
      bitmap: params.bitmap,
      tickRanges: params.tickRanges,
      tickSpacing,
    });

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

  private async liquidityHookAmounts(
    params: PositionTokenAccounts,
    bitmap: BN,
    liquidities: BN[],
    withdraw: boolean,
    maxAmountX: BN,
    maxAmountY: BN,
  ): Promise<{ amountX: BN; amountY: BN }> {
    const indexes = positionIndexesFromBitmap(bitmap);
    if (indexes.length !== liquidities.length) {
      throw PoolError.invalidParameters();
    }
    const loaded = await this.positionSlots(params.pool, params.nftMint);
    const ranges = indexes.map((index, slot) => {
      const position = loaded.positions[index];
      if (!position) {
        throw PoolError.invalidParameters();
      }
      return {
        tickLowerId: position.tickLowerId,
        tickUpperId: position.tickUpperId,
        liquidity: liquidities[slot],
      };
    });
    if (withdraw) {
      return liquidityTransferAmounts({
        tickCurrentId: loaded.pool.tickCurrentId,
        currentSqrtPrice: loaded.pool.sqrtPrice,
        ranges,
        withdraw: true,
      });
    }
    const [mintX, mintY, clock] = await Promise.all([
      readTransferFeeMint(this.connection, params.tokenXMint, this.commitment),
      readTransferFeeMint(this.connection, params.tokenYMint, this.commitment),
      readClock(this.connection, this.commitment),
    ]);
    return liquidityTransferAmounts({
      tickCurrentId: loaded.pool.tickCurrentId,
      currentSqrtPrice: loaded.pool.sqrtPrice,
      ranges,
      withdraw: false,
      mintX,
      mintY,
      epoch: clock.epoch,
      maxAmountX,
      maxAmountY,
    });
  }

  private async removeByBpsHookAmounts(
    params: RemoveLiquidityByBpsParams,
  ): Promise<{ amountX: BN; amountY: BN }> {
    const loaded = await this.positionSlots(params.pool, params.nftMint);
    if (params.parameters.bitmap !== null) {
      for (const index of positionIndexesFromBitmap(params.parameters.bitmap)) {
        if (index >= loaded.positions.length) {
          throw PoolError.invalidParameters();
        }
      }
    }
    const clock = await readClock(this.connection, this.commitment);
    const currentPoint = getCurrentPoint(
      loaded.pool.activationType,
      clock.slot,
      clock.timestamp,
    );
    const ranges: {
      tickLowerId: number;
      tickUpperId: number;
      liquidity: BN;
    }[] = [];
    loaded.positions.forEach((position, index) => {
      const selected =
        params.parameters.bitmap === null ||
        params.parameters.bitmap.testn(index);
      if (!selected) {
        return;
      }
      const unlocked = unlockedLiquidityForWithdraw(
        position,
        loaded.positionArray.vesting,
        currentPoint,
      );
      const liquidity = bpsWithdrawLiquidity(unlocked, params.parameters.bps);
      if (liquidity.isZero()) {
        return;
      }
      ranges.push({
        tickLowerId: position.tickLowerId,
        tickUpperId: position.tickUpperId,
        liquidity,
      });
    });
    return liquidityTransferAmounts({
      tickCurrentId: loaded.pool.tickCurrentId,
      currentSqrtPrice: loaded.pool.sqrtPrice,
      ranges,
      withdraw: true,
    });
  }

  private async imbalanceHookAmounts(
    params: AddLiquidityImbalanceParams,
  ): Promise<{ amountX: BN; amountY: BN }> {
    const loaded = await this.positionSlots(params.pool, params.nftMint);
    const position = loaded.positions[params.parameters.index];
    if (!position) {
      throw PoolError.invalidParameters();
    }
    const [mintX, mintY, clock, tokenXProgram, tokenYProgram] =
      await Promise.all([
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
    const [availableX, availableY] = await Promise.all([
      this.availableTokenAmount(
        params.availableAmountX,
        params.userTokenX,
        tokenXProgram,
      ),
      this.availableTokenAmount(
        params.availableAmountY,
        params.userTokenY,
        tokenYProgram,
      ),
    ]);
    return imbalanceTransferAmounts({
      maxAmountX: params.parameters.maxAmountX,
      maxAmountY: params.parameters.maxAmountY,
      availableX,
      availableY,
      mintX,
      mintY,
      epoch: clock.epoch,
      tickCurrentId: loaded.pool.tickCurrentId,
      currentSqrtPrice: loaded.pool.sqrtPrice,
      tickLowerId: position.tickLowerId,
      tickUpperId: position.tickUpperId,
      minLiquidity: params.parameters.slippage.minLiquidity,
    });
  }

  private async availableTokenAmount(
    provided: BN | (() => Promise<BN>) | undefined,
    account: PublicKey,
    tokenProgram: PublicKey,
  ): Promise<BN> {
    if (typeof provided === "function") {
      return provided();
    }
    if (provided !== undefined) {
      return provided;
    }
    return readTokenAccountAmount(
      this.connection,
      account,
      tokenProgram,
      this.commitment,
    );
  }

  private async positionSlots(poolAddress: PublicKey, nftMint: PublicKey) {
    const { pool, extensions } =
      await this.state.fetchPoolWithExtensions(poolAddress);
    const positionAddress = derivePosition(nftMint, this.programId);
    const loaded = await this.state.fetchPositionArrayWithPositions(
      positionAddress,
      { withReward: extensions.hasLiquidityMining },
    );
    if (!loaded.positionArray.pool.equals(poolAddress)) {
      throw new Error(
        `Position ${positionAddress.toBase58()} does not belong to pool ${poolAddress.toBase58()}`,
      );
    }
    return { pool, ...loaded };
  }

  private liquidityRemaining(
    params: PositionTokenAccounts,
    tickSpacing: number,
    hooks: {
      remainingAccountsInfo: RemainingAccountsInfo;
      remainingAccounts: AccountMeta[];
    },
  ): {
    remainingAccountsInfo: RemainingAccountsInfo;
    remainingAccounts: AccountMeta[];
  } {
    return {
      remainingAccountsInfo: hooks.remainingAccountsInfo,
      remainingAccounts: [
        ...hooks.remainingAccounts,
        ...tickArrayRemainingAccounts(
          params.pool,
          params.tickRanges,
          tickSpacing,
          true,
          this.programId,
        ),
      ],
    };
  }

  private async liquidityAccounts(
    params: PositionTokenAccounts,
    flow: "deposit" | "withdraw",
    amountX: TransferHookAmount,
    amountY: TransferHookAmount,
  ) {
    const tickSpacing = await this.resolveTickSpacing(
      params.pool,
      params.tickSpacing,
    );
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
    const authority =
      flow === "deposit" ? params.signer : derivePoolAuthority(this.programId);
    const resolved = await resolveInstructionHooks(
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
          source: flow === "deposit" ? params.userTokenX : reserveX,
          destination: flow === "deposit" ? reserveX : params.userTokenX,
          authority,
          amount: amountX,
        },
        transferHookY: {
          mint: params.tokenYMint,
          source: flow === "deposit" ? params.userTokenY : reserveY,
          destination: flow === "deposit" ? reserveY : params.userTokenY,
          authority,
          amount: amountY,
        },
      },
    );
    const remaining = this.liquidityRemaining(params, tickSpacing, resolved);
    const position = derivePosition(params.nftMint, this.programId);
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);
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
    if (flow === "withdraw") {
      assertDelegateReceiver({
        owner: params.owner,
        signer: params.signer,
        tokenAccount: params.userTokenX,
        mint: params.tokenXMint,
        tokenProgram: tokenXProgram,
      });
      assertDelegateReceiver({
        owner: params.owner,
        signer: params.signer,
        tokenAccount: params.userTokenY,
        mint: params.tokenYMint,
        tokenProgram: tokenYProgram,
      });
    }
    return {
      position,
      ...remaining,
      accounts: {
        pool: params.pool,
        position,
        nftAccount,
        tickArrayBitmapExtension: params.tickArrayBitmapExtension ?? null,
        userTokenX: params.userTokenX,
        userTokenY: params.userTokenY,
        reserveX,
        reserveY,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        signer: params.signer,
        tokenXProgram,
        tokenYProgram,
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
    const refreshBitmap = bitmap ?? liquidityBitmap(selected);
    const refreshed = new Set(
      selected.filter(
        (index) => !positionTotalLiquidity(positions[index]).isZero(),
      ),
    );

    const tickArrayIndexes = new Set<number>();
    for (const index of refreshed) {
      const { tickLowerId, tickUpperId } = positions[index];
      tickArrayIndexes.add(tickIndexFromId(tickLowerId, pool.tickSpacing));
      tickArrayIndexes.add(tickIndexFromId(tickUpperId, pool.tickSpacing));
    }
    const tickArrays = await this.state.fetchTickArraysWithTicks(
      [...tickArrayIndexes].map((index) =>
        deriveTickArray(poolAddress, index, this.programId),
      ),
      { withReward },
    );
    const ticks = new Map<number, DecodedTick>();
    for (const { ticks: decoded } of tickArrays) {
      for (const tick of decoded) {
        ticks.set(tick.tickId, tick);
      }
    }
    const tickAt = (tickId: number): DecodedTick => {
      const tick = ticks.get(tickId);
      if (!tick) {
        throw PoolError.cannotFindTickFromId();
      }
      return tick;
    };

    const slots = positions.map((position, index): ClaimableFeeSlot => {
      const fees = refreshed.has(index)
        ? getPendingFees(
            position,
            getFeeGrowthInside({
              tickCurrentId: pool.tickCurrentId,
              tickLower: tickAt(position.tickLowerId),
              tickLowerId: position.tickLowerId,
              tickUpper: tickAt(position.tickUpperId),
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
      tickSpacing: pool.tickSpacing,
      bitmap: refreshBitmap,
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

  private bitmapExtensionFor(
    pool: PublicKey,
    range: TickRange,
    tickSpacing: number,
  ): PublicKey | null {
    const overflows = [range.tickLowerId, range.tickUpperId].some((tickId) =>
      overflowsDefaultTickArrayBitmap(tickIndexFromId(tickId, tickSpacing)),
    );
    return overflows
      ? deriveTickArrayBitmapExtension(pool, this.programId)
      : null;
  }

  private async resolveTickSpacing(
    pool: PublicKey,
    suppliedTickSpacing: number,
  ): Promise<number> {
    const { tickSpacing } = await this.state.fetchPool(pool);
    if (suppliedTickSpacing !== tickSpacing) {
      throw PoolError.invalidParameters();
    }
    return tickSpacing;
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

  private async assertScheduleWithinVestingCap(
    pool: PublicKey,
    parameters: LockVestingPositionParameters,
  ): Promise<void> {
    const scheduleDuration = parameters.periodFrequency.muln(
      parameters.numberOfPeriod,
    );
    if (scheduleDuration.lte(MAX_VESTING_DURATION)) {
      return;
    }
    if (scheduleDuration.gt(MAX_VESTING_DURATION_SLOT)) {
      throw PoolError.invalidParameters();
    }
    const state = await this.state.fetchPool(pool);
    if (state.activationType !== ActivationType.Slot) {
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

    // Same order as `LockVestingPositionParameters::validate`, minus the
    // checks that need the current point (cliff in the past, full-release
    // overflow, cliff delay within the max duration). The schedule-length
    // cap depends on the pool's activation type and is applied separately.
    const hasPeriodic =
      !parameters.periodFrequency.isZero() ||
      parameters.bpsPerPeriod > 0 ||
      parameters.numberOfPeriod > 0;
    const periodicComplete =
      !parameters.periodFrequency.isZero() &&
      parameters.bpsPerPeriod > 0 &&
      parameters.numberOfPeriod > 0;
    if (parameters.cliffUnlockBps === 0 && !periodicComplete) {
      throw PoolError.invalidParameters();
    }
    const scheduleDuration = parameters.periodFrequency.muln(
      parameters.numberOfPeriod,
    );
    if (scheduleDuration.gt(U64_MAX)) {
      throw PoolError.mathOverflow();
    }
    if (hasPeriodic && !periodicComplete) {
      throw PoolError.invalidParameters();
    }
    if (parameters.bps === 0 || parameters.bps > MAX_BASIS_POINT) {
      throw PoolError.invalidParameters();
    }
    const periodicBps = parameters.bpsPerPeriod * parameters.numberOfPeriod;
    if (
      periodicBps > 0xffff ||
      parameters.cliffUnlockBps + periodicBps > 0xffff
    ) {
      throw PoolError.mathOverflow();
    }
    if (parameters.cliffUnlockBps + periodicBps !== MAX_BASIS_POINT) {
      throw PoolError.invalidParameters();
    }
  }
}
