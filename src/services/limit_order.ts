import type { PublicKey, Transaction, AccountMeta } from "@solana/web3.js";
import BN from "bn.js";
import { LIMIT_ORDER_MAX_TICK } from "../constants";
import { PoolError } from "../errors";
import {
  bitmapExtensionForTickArrays,
  deriveLimitOrder,
  derivePoolAuthority,
  deriveReserve,
  deriveTickArray,
  findNftAccount,
  getTokenProgram,
  isUsableTickId,
  MAX_LIMIT_ORDER_DELEGATE_PERMISSION,
  reserveTransferLegs,
  resolveInstructionHooks,
  tickArrayMetas,
  tickArraysForTickIds,
  tickIndexFromId,
} from "../helpers";
import { assertI32, assertU64, isIntegerIn } from "../helpers/validation";
import type { OpenLimitOrderParameters } from "../types";
import { DlmmProProgram } from "./program";

/** Tick array indexes the order's ticks land in; for a relative order, every one its band can resolve them to. */
function orderTickArrayIndexes(
  parameters: OpenLimitOrderParameters,
  tickSpacing: number,
): number[] {
  const indexes = new Set<number>();
  for (const tick of parameters.ticks) {
    if (parameters.relativeTick === null) {
      indexes.add(tickIndexFromId(tick.id, tickSpacing));
      continue;
    }
    const offset = tick.id * tickSpacing;
    const lowest = tickIndexFromId(
      parameters.relativeTick.spacingAlignedMinTickId + offset,
      tickSpacing,
    );
    const highest = tickIndexFromId(
      parameters.relativeTick.spacingAlignedMaxTickId + offset,
      tickSpacing,
    );
    for (let index = lowest; index <= highest; index++) {
      indexes.add(index);
    }
  }
  return [...indexes].sort((a, b) => a - b);
}

function assertCancelTickIds(tickIds: number[]): void {
  if (tickIds.length === 0) {
    throw PoolError.invalidParameters("tickIds must not be empty");
  }
  for (const tickId of tickIds) {
    assertI32(tickId, "tickIds");
  }
  for (let i = 1; i < tickIds.length; i++) {
    if (tickIds[i - 1] >= tickIds[i]) {
      throw PoolError.invalidParameters("tickIds must be strictly ascending");
    }
  }
}

export class LimitOrderService extends DlmmProProgram {
  /** The `nftMint` keypair must co-sign the transaction. */
  async openLimitOrder(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    owner: PublicKey;
    payer: PublicKey;
    tokenMint: PublicKey;
    userToken: PublicKey;
    parameters: OpenLimitOrderParameters;
    /**
     * Defaults to the arrays holding the order's ticks; for a relative order,
     * every array the band can resolve them to. An explicit list must be
     * ascending by tick array index.
     */
    tickArrays?: PublicKey[];
    tokenProgram?: PublicKey;
    /** Defaults to the extension when the pool has one and a tick array lies outside the inline bitmap. */
    tickArrayBitmapExtension?: PublicKey | null;
    referral?: PublicKey | null;
    nftAccount?: PublicKey;
    /** Hook metas for the token the order deposits; resolved from the mint when omitted. */
    transferHook?: AccountMeta[];
  }): Promise<{
    tx: Transaction;
    limitOrder: PublicKey;
    nftAccount: PublicKey;
  }> {
    const { maxAmount, relativeTick, ticks } = params.parameters;
    assertU64(maxAmount, "maxAmount");
    if (ticks.length === 0 || ticks.length > LIMIT_ORDER_MAX_TICK) {
      throw PoolError.invalidParameters(
        "ticks must have 1..=LIMIT_ORDER_MAX_TICK entries",
      );
    }
    for (let index = 0; index < ticks.length; index++) {
      assertI32(ticks[index].id, "ticks.id");
      assertU64(ticks[index].amount, "ticks.amount");
      if (ticks[index].amount.isZero()) {
        throw PoolError.invalidParameters("ticks.amount must be non-zero");
      }
      if (index > 0 && ticks[index - 1].id >= ticks[index].id) {
        throw PoolError.invalidParameters(
          "ticks.id must be strictly ascending",
        );
      }
    }
    if (relativeTick !== null) {
      assertI32(
        relativeTick.spacingAlignedMinTickId,
        "spacingAlignedMinTickId",
      );
      assertI32(
        relativeTick.spacingAlignedMaxTickId,
        "spacingAlignedMaxTickId",
      );
      if (
        relativeTick.spacingAlignedMinTickId >
        relativeTick.spacingAlignedMaxTickId
      ) {
        throw PoolError.invalidParameters(
          "spacingAlignedMinTickId must not exceed spacingAlignedMaxTickId",
        );
      }
    }
    const { isAskSide } = params.parameters;
    const hookKey = isAskSide ? "transferHookX" : "transferHookY";
    const [pool, hooks] = await Promise.all([
      this.state.fetchPool(params.pool),
      resolveInstructionHooks(this.connection, this.commitment, {
        [hookKey]: {
          metas: params.transferHook,
          leg: {
            mint: params.tokenMint,
            source: params.userToken,
            destination: deriveReserve(
              params.tokenMint,
              params.pool,
              this.programId,
            ),
            authority: params.owner,
          },
        },
      }),
    ]);
    const { tickSpacing } = pool;
    if (relativeTick !== null) {
      if (
        relativeTick.spacingAlignedMinTickId % tickSpacing !== 0 ||
        relativeTick.spacingAlignedMaxTickId % tickSpacing !== 0
      ) {
        throw PoolError.invalidParameters(
          "relativeTick tick ids must be multiples of the pool tickSpacing",
        );
      }
    } else if (!ticks.every((tick) => isUsableTickId(tick.id, tickSpacing))) {
      throw PoolError.invalidParameters("ticks.id must be usable tick ids");
    }
    const tickArrayIndexes = orderTickArrayIndexes(
      params.parameters,
      tickSpacing,
    );
    const tickArrays =
      params.tickArrays ??
      tickArrayIndexes.map((index) =>
        deriveTickArray(params.pool, index, this.programId),
      );
    const tickArrayBitmapExtension =
      params.tickArrayBitmapExtension !== undefined
        ? params.tickArrayBitmapExtension
        : bitmapExtensionForTickArrays(
            params.pool,
            pool.isBitmapExtensionInitialized,
            tickArrayIndexes,
            this.programId,
          );
    const limitOrder = deriveLimitOrder(params.nftMint, this.programId);
    const nftAccount =
      params.nftAccount ?? findNftAccount(params.nftMint, params.owner);
    const tx = await this.program.methods
      .openLimitOrder(params.parameters, hooks.remainingAccountsInfo)
      .accountsPartial({
        pool: params.pool,
        nftMint: params.nftMint,
        nftAccount,
        tickArrayBitmapExtension,
        reserve: deriveReserve(params.tokenMint, params.pool, this.programId),
        tokenMint: params.tokenMint,
        limitOrder,
        userToken: params.userToken,
        referral: params.referral ?? null,
        payer: params.payer,
        owner: params.owner,
        tokenProgram:
          params.tokenProgram ??
          getTokenProgram(isAskSide ? pool.tokenXFlag : pool.tokenYFlag),
      })
      .remainingAccounts([
        ...hooks.remainingAccounts,
        ...tickArrayMetas(tickArrays),
      ])
      .transaction();

    tx.feePayer = params.payer;
    return { tx, limitOrder, nftAccount };
  }

  async cancelLimitOrder(params: {
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
    /** Strictly ascending. Defaults to every tick of the order not yet canceled. */
    tickIds?: number[];
    /** Minimum token X to receive after transfer fees; defaults to no minimum. */
    minAmountX?: BN;
    /** Minimum token Y to receive after transfer fees; defaults to no minimum. */
    minAmountY?: BN;
    /** Defaults to the arrays holding `tickIds`. */
    tickArrays?: PublicKey[];
    tokenXProgram?: PublicKey;
    tokenYProgram?: PublicKey;
    /** Defaults to the extension when the pool has one and a tick array lies outside the inline bitmap. */
    tickArrayBitmapExtension?: PublicKey | null;
    nftAccount?: PublicKey;
    referralToken?: PublicKey | null;
    transferHookX?: AccountMeta[];
    transferHookY?: AccountMeta[];
    transferHookReferral?: AccountMeta[];
  }): Promise<{ tx: Transaction }> {
    const minAmountX = params.minAmountX ?? new BN(0);
    const minAmountY = params.minAmountY ?? new BN(0);
    assertU64(minAmountX, "minAmountX");
    assertU64(minAmountY, "minAmountY");
    const limitOrder = deriveLimitOrder(params.nftMint, this.programId);
    const referralToken = params.referralToken;
    const tickIds =
      params.tickIds ??
      (await this.state.decodeLimitOrderData(limitOrder))
        .filter((order) => !order.amount.isZero() || !order.age.isZero())
        .map((order) => order.tickId)
        .sort((a, b) => a - b);
    assertCancelTickIds(tickIds);
    const [pool, transferHookReferral] = await Promise.all([
      this.state.fetchPool(params.pool),
      this.referralHook(
        params.pool,
        referralToken,
        params.transferHookReferral,
      ),
    ]);
    const tickArrays =
      params.tickArrays ??
      tickArraysForTickIds(
        params.pool,
        tickIds,
        pool.tickSpacing,
        this.programId,
      );
    const tickArrayBitmapExtension =
      params.tickArrayBitmapExtension !== undefined
        ? params.tickArrayBitmapExtension
        : bitmapExtensionForTickArrays(
            params.pool,
            pool.isBitmapExtensionInitialized,
            tickIds.map((tickId) => tickIndexFromId(tickId, pool.tickSpacing)),
            this.programId,
          );
    const poolAuthority = derivePoolAuthority(this.programId);
    const { reserveX, reserveY, transferHookX, transferHookY } =
      reserveTransferLegs({
        pool: params.pool,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        userTokenX: params.userTokenX,
        userTokenY: params.userTokenY,
        authority: poolAuthority,
        deposit: false,
        programId: this.programId,
      });
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      {
        transferHookX: { metas: params.transferHookX, leg: transferHookX },
        transferHookY: { metas: params.transferHookY, leg: transferHookY },
        transferHookReferral,
      },
    );

    const tx = await this.program.methods
      .cancelLimitOrder(
        {
          tickIds,
          minAmountX,
          minAmountY,
        },
        hooks.remainingAccountsInfo,
      )
      .accountsPartial({
        pool: params.pool,
        tickArrayBitmapExtension,
        reserveX,
        reserveY,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        limitOrder,
        nftAccount:
          params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
        userTokenX: params.userTokenX,
        userTokenY: params.userTokenY,
        referralToken: referralToken ?? null,
        signer: params.signer,
        tokenXProgram: params.tokenXProgram ?? getTokenProgram(pool.tokenXFlag),
        tokenYProgram: params.tokenYProgram ?? getTokenProgram(pool.tokenYFlag),
      })
      .remainingAccounts([
        ...hooks.remainingAccounts,
        ...tickArrayMetas(tickArrays),
      ])
      .transaction();

    tx.feePayer = params.signer;
    return { tx };
  }

  async closeLimitOrder(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    owner: PublicKey;
    rentReceiver: PublicKey;
    nftAccount?: PublicKey;
    /**
     * Defaults to the arrays holding every tick the order was placed on. An
     * explicit list must be ascending by tick array index.
     */
    tickArrays?: PublicKey[];
  }): Promise<{ tx: Transaction; limitOrder: PublicKey }> {
    const limitOrder = deriveLimitOrder(params.nftMint, this.programId);
    let tickArrays = params.tickArrays;
    if (tickArrays === undefined) {
      const [orders, { tickSpacing }] = await Promise.all([
        this.state.decodeLimitOrderData(limitOrder),
        this.state.fetchPool(params.pool),
      ]);
      tickArrays = tickArraysForTickIds(
        params.pool,
        orders.map((order) => order.tickId),
        tickSpacing,
        this.programId,
      );
    }
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
      .remainingAccounts(tickArrayMetas(tickArrays))
      .transaction();

    tx.feePayer = params.owner;
    return { tx, limitOrder };
  }

  async updateLimitOrderDelegatePermission(params: {
    nftMint: PublicKey;
    owner: PublicKey;
    permission: number;
    nftAccount?: PublicKey;
  }): Promise<{ tx: Transaction }> {
    if (
      !isIntegerIn(params.permission, 0, MAX_LIMIT_ORDER_DELEGATE_PERMISSION)
    ) {
      throw PoolError.invalidPermission();
    }
    const tx = await this.program.methods
      .updateLimitOrderDelegatePermission(params.permission)
      .accountsPartial({
        limitOrder: deriveLimitOrder(params.nftMint, this.programId),
        nftAccount:
          params.nftAccount ?? findNftAccount(params.nftMint, params.owner),
        owner: params.owner,
      })
      .transaction();

    tx.feePayer = params.owner;
    return { tx };
  }
}
