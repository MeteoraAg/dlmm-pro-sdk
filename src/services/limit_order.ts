import { getAccount, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, type AccountMeta } from "@solana/web3.js";
import BN from "bn.js";
import {
  LIMIT_ORDER_MAX_TICK,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
} from "../constants";
import { PoolError } from "../errors";
import {
  cancelLimitOrderTransfers,
  cappedTransferFeeIncludedAmount,
  deriveLimitOrder,
  derivePoolAuthority,
  deriveReserve,
  findNftAccount,
  lazy,
  readClock,
  readTokenAccountMint,
  readTransferFeeMint,
  requireTick,
  resolveInstructionHooks,
  resolveTokenProgram,
  SWAP_HOOKS,
  ticksById,
} from "../helpers";
import { assertI32, assertU64, assertU128 } from "../helpers/validation";
import { safeAdd, U64_MAX } from "../math";
import {
  LimitOrderDelegatePermission,
  type OpenLimitOrderParameters,
} from "../types";
import { DlmmProProgram } from "./program";

const MAX_LIMIT_ORDER_DELEGATE_PERMISSION =
  (1 << (LimitOrderDelegatePermission.CancelLimitOrderToOwner + 1)) - 1;

export class LimitOrderService extends DlmmProProgram {
  /**
   * The `nftMint` keypair must co-sign the transaction.
   * `tickArrays` must be sorted by tick array index in ascending order.
   */
  async openLimitOrder(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    owner: PublicKey;
    payer: PublicKey;
    tokenMint: PublicKey;
    userToken: PublicKey;
    parameters: OpenLimitOrderParameters;
    tickArrays: PublicKey[];
    tokenProgram?: PublicKey;
    tickArrayBitmapExtension?: PublicKey | null;
    referral?: PublicKey | null;
    nftAccount?: PublicKey;
    transferHookX?: AccountMeta[];
    transferHookY?: AccountMeta[];
  }): Promise<{
    tx: Transaction;
    limitOrder: PublicKey;
    nftAccount: PublicKey;
  }> {
    const { maxAmount, relativeTick, ticks } = params.parameters;
    assertU64(maxAmount);
    if (ticks.length === 0 || ticks.length > LIMIT_ORDER_MAX_TICK) {
      throw PoolError.invalidParameters();
    }
    for (let index = 0; index < ticks.length; index++) {
      assertI32(ticks[index].id);
      assertU64(ticks[index].amount);
      if (
        ticks[index].amount.isZero() ||
        (index > 0 && ticks[index - 1].id >= ticks[index].id)
      ) {
        throw PoolError.invalidParameters();
      }
    }
    if (relativeTick !== null) {
      assertU128(relativeTick.minSqrtPrice);
      assertU128(relativeTick.maxSqrtPrice);
      if (
        relativeTick.minSqrtPrice.lt(MIN_SQRT_PRICE) ||
        relativeTick.maxSqrtPrice.gt(MAX_SQRT_PRICE) ||
        relativeTick.minSqrtPrice.gt(relativeTick.maxSqrtPrice)
      ) {
        throw PoolError.invalidParameters();
      }
    }
    const offSideHook = params.parameters.isAskSide
      ? params.transferHookY
      : params.transferHookX;
    if (offSideHook && offSideHook.length > 0) {
      throw PoolError.invalidRemainingAccountSlice();
    }
    const limitOrder = deriveLimitOrder(params.nftMint);
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);
    const onSideKey = params.parameters.isAskSide
      ? "transferHookX"
      : "transferHookY";
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      [onSideKey],
      params.parameters.isAskSide
        ? { transferHookX: params.transferHookX }
        : { transferHookY: params.transferHookY },
      {
        [onSideKey]: {
          mint: params.tokenMint,
          source: params.userToken,
          destination: deriveReserve(params.tokenMint, params.pool),
          authority: params.owner,
          amount: async () => {
            const total = params.parameters.ticks.reduce(
              (sum, tick) => safeAdd(sum, tick.amount, U64_MAX),
              new BN(0),
            );
            const [mint, clock] = await Promise.all([
              readTransferFeeMint(
                this.connection,
                params.tokenMint,
                this.commitment,
              ),
              readClock(this.connection, this.commitment),
            ]);
            return cappedTransferFeeIncludedAmount(
              mint,
              clock.epoch,
              total,
              maxAmount,
            );
          },
        },
      },
    );

    const tx = await this.program.methods
      .openLimitOrder(params.parameters, hooks.remainingAccountsInfo)
      .accountsPartial({
        pool: params.pool,
        nftMint: params.nftMint,
        nftAccount,
        tickArrayBitmapExtension: params.tickArrayBitmapExtension ?? null,
        reserve: deriveReserve(params.tokenMint, params.pool),
        tokenMint: params.tokenMint,
        limitOrder,
        userToken: params.userToken,
        referral: params.referral ?? null,
        payer: params.payer,
        owner: params.owner,
        tokenProgram:
          params.tokenProgram ??
          (await resolveTokenProgram(
            this.connection,
            params.tokenMint,
            this.commitment,
          )),
      })
      .remainingAccounts([
        ...hooks.remainingAccounts,
        ...params.tickArrays.map((pubkey) => ({
          pubkey,
          isWritable: true,
          isSigner: false,
        })),
      ])
      .transaction();

    tx.feePayer = params.payer;
    return { tx, limitOrder, nftAccount };
  }

  async cancelLimitOrder(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    owner: PublicKey;
    signer: PublicKey;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    userTokenX: PublicKey;
    userTokenY: PublicKey;
    tickIds: number[];
    /** Minimum token X to receive after transfer fees; defaults to no minimum. */
    minAmountX?: BN;
    /** Minimum token Y to receive after transfer fees; defaults to no minimum. */
    minAmountY?: BN;
    tickArrays: PublicKey[];
    tokenXProgram?: PublicKey;
    tokenYProgram?: PublicKey;
    tickArrayBitmapExtension?: PublicKey | null;
    nftAccount?: PublicKey;
    referralToken?: PublicKey | null;
    transferHookX?: AccountMeta[];
    transferHookY?: AccountMeta[];
    transferHookReferral?: AccountMeta[];
  }): Promise<{ tx: Transaction }> {
    if (params.tickIds.length === 0) {
      throw PoolError.invalidParameters();
    }
    assertU64(params.minAmountX ?? new BN(0));
    assertU64(params.minAmountY ?? new BN(0));
    for (const tickId of params.tickIds) {
      assertI32(tickId);
    }
    for (let i = 1; i < params.tickIds.length; i++) {
      if (params.tickIds[i - 1] >= params.tickIds[i]) {
        throw PoolError.invalidParameters();
      }
    }
    const poolAuthority = derivePoolAuthority();
    const referralMint = params.referralToken
      ? await readTokenAccountMint(
          this.connection,
          params.referralToken,
          this.commitment,
        )
      : null;
    if (
      referralMint &&
      !referralMint.equals(params.tokenXMint) &&
      !referralMint.equals(params.tokenYMint)
    ) {
      throw PoolError.invalidAccount();
    }
    const payout = lazy(() => this.cancelTransferAmounts(params, referralMint));
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
          source: deriveReserve(params.tokenXMint, params.pool),
          destination: params.userTokenX,
          authority: poolAuthority,
          amount: async () => (await payout()).amountX,
        },
        transferHookY: {
          mint: params.tokenYMint,
          source: deriveReserve(params.tokenYMint, params.pool),
          destination: params.userTokenY,
          authority: poolAuthority,
          amount: async () => (await payout()).amountY,
        },
        transferHookReferral:
          params.referralToken && referralMint
            ? {
                mint: referralMint,
                source: deriveReserve(referralMint, params.pool),
                destination: params.referralToken,
                authority: poolAuthority,
                amount: async () => {
                  const result = await payout();
                  if (result.referralFee.isZero()) {
                    return result.referralFee;
                  }
                  const feeMint = result.referralOnX
                    ? params.tokenXMint
                    : params.tokenYMint;
                  if (!referralMint.equals(feeMint)) {
                    throw PoolError.invalidAccount();
                  }
                  return result.referralFee;
                },
              }
            : undefined,
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
      .cancelLimitOrder(
        {
          tickIds: params.tickIds,
          minAmountX: params.minAmountX ?? new BN(0),
          minAmountY: params.minAmountY ?? new BN(0),
        },
        hooks.remainingAccountsInfo,
      )
      .accountsPartial({
        pool: params.pool,
        tickArrayBitmapExtension: params.tickArrayBitmapExtension ?? null,
        reserveX: deriveReserve(params.tokenXMint, params.pool),
        reserveY: deriveReserve(params.tokenYMint, params.pool),
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        limitOrder: deriveLimitOrder(params.nftMint),
        nftAccount:
          params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
        userTokenX: params.userTokenX,
        userTokenY: params.userTokenY,
        referralToken: params.referralToken ?? null,
        signer: params.signer,
        tokenXProgram,
        tokenYProgram,
      })
      .remainingAccounts([
        ...hooks.remainingAccounts,
        ...params.tickArrays.map((pubkey) => ({
          pubkey,
          isWritable: true,
          isSigner: false,
        })),
      ])
      .transaction();

    tx.feePayer = params.signer;
    return { tx };
  }

  private async cancelTransferAmounts(
    params: {
      pool: PublicKey;
      nftMint: PublicKey;
      owner: PublicKey;
      tickIds: number[];
      tickArrays: PublicKey[];
      referralToken?: PublicKey | null;
      nftAccount?: PublicKey;
    },
    referralMint: PublicKey | null,
  ) {
    const limitOrder = deriveLimitOrder(params.nftMint);
    const [header, orders, loaded] = await Promise.all([
      this.state.fetchLimitOrder(limitOrder),
      this.state.decodeLimitOrderData(limitOrder),
      this.state.fetchPoolWithExtensions(params.pool),
    ]);
    const ticks = ticksById(
      await this.state.fetchTickArraysWithTicks(params.tickArrays, {
        withReward: loaded.extensions.hasLiquidityMining,
      }),
    );
    const paired = params.tickIds.map((tickId) => {
      const order = orders.find((entry) => entry.tickId === tickId);
      if (!order) {
        throw PoolError.cannotFindLimitOrderByTickId();
      }
      return { tick: requireTick(ticks, tickId), order };
    });
    let referralEligible = false;
    if (
      params.referralToken &&
      referralMint &&
      !header.referral.equals(PublicKey.default)
    ) {
      const nftAccount =
        params.nftAccount ?? findNftAccount(params.nftMint, params.owner);
      const referralProgram = await resolveTokenProgram(
        this.connection,
        referralMint,
        this.commitment,
      );
      const [nft, referralToken] = await Promise.all([
        getAccount(
          this.connection,
          nftAccount,
          this.commitment,
          TOKEN_2022_PROGRAM_ID,
        ),
        getAccount(
          this.connection,
          params.referralToken,
          this.commitment,
          referralProgram,
        ),
      ]);
      referralEligible =
        !header.referral.equals(nft.owner) &&
        referralToken.owner.equals(header.referral);
    }
    return cancelLimitOrderTransfers({
      collectFeeMode: loaded.pool.collectFeeMode,
      orders: paired,
      referralEligible,
    });
  }

  /** `tickArrays` must be sorted by tick array index in ascending order. */
  async closeLimitOrder(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    owner: PublicKey;
    rentReceiver: PublicKey;
    nftAccount?: PublicKey;
    tickArrays: PublicKey[];
  }): Promise<{ tx: Transaction; limitOrder: PublicKey }> {
    const limitOrder = deriveLimitOrder(params.nftMint);
    const tx = await this.program.methods
      .closeLimitOrder()
      .accountsPartial({
        pool: params.pool,
        limitOrder,
        nftMint: params.nftMint,
        nftAccount:
          params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
        owner: params.owner,
        rentReceiver: params.rentReceiver,
      })
      .remainingAccounts(
        params.tickArrays.map((pubkey) => ({
          pubkey,
          isWritable: true,
          isSigner: false,
        })),
      )
      .transaction();

    tx.feePayer = params.owner;
    return { tx, limitOrder };
  }

  async updateLimitOrderDelegatePermission(params: {
    limitOrder: PublicKey;
    nftAccount: PublicKey;
    owner: PublicKey;
    permission: number;
  }): Promise<{ tx: Transaction }> {
    if (
      !Number.isInteger(params.permission) ||
      params.permission < 0 ||
      params.permission > MAX_LIMIT_ORDER_DELEGATE_PERMISSION
    ) {
      throw PoolError.invalidPermission();
    }
    const tx = await this.program.methods
      .updateLimitOrderDelegatePermission(params.permission)
      .accountsPartial({
        limitOrder: params.limitOrder,
        nftAccount: params.nftAccount,
        owner: params.owner,
      })
      .transaction();

    tx.feePayer = params.owner;
    return { tx };
  }
}
