import type { AccountMeta, PublicKey } from "@solana/web3.js";
import {
  BITMAP_SIZE,
  MAX_TICK_SPACING,
  MAX_TICKS_PER_ARRAY,
  MAX_TICK_ID,
  MIN_TICK_ID,
  POSITION_MAX_RANGE,
} from "../constants";
import { PoolError } from "../errors";
import {
  getBitmapSetIndicesFromPool,
  getExtensionBitmapSetIndicesFromState,
} from "./codec";
import { deriveTickArray } from "./pda";
import type {
  BitmapExtensionState,
  PoolBitmapState,
  TickRange,
} from "../types";

export function isUsableTickId(tickId: number, tickSpacing: number): boolean {
  if (
    !Number.isInteger(tickId) ||
    !Number.isInteger(tickSpacing) ||
    tickSpacing <= 0 ||
    tickSpacing > MAX_TICK_SPACING ||
    tickId < MIN_TICK_ID ||
    tickId > MAX_TICK_ID
  ) {
    return false;
  }
  return tickId % tickSpacing === 0;
}

export function tickIndexFromId(tickId: number, tickSpacing: number): number {
  if (
    !Number.isInteger(tickId) ||
    !Number.isInteger(tickSpacing) ||
    tickSpacing <= 0 ||
    tickSpacing > MAX_TICK_SPACING
  ) {
    throw PoolError.invalidParameters();
  }
  const scaled = Math.floor(tickId / tickSpacing);
  const index = Math.trunc(scaled / MAX_TICKS_PER_ARRAY);
  if (tickId < 0 && scaled % MAX_TICKS_PER_ARRAY !== 0) {
    return index - 1;
  }
  return index;
}

export function overflowsDefaultTickArrayBitmap(tickIndex: number): boolean {
  return tickIndex < -BITMAP_SIZE || tickIndex > BITMAP_SIZE - 1;
}

export function tickIdsInRange(
  minTickId: number,
  maxTickId: number,
  tickSpacing: number,
): number[] {
  if (
    minTickId > maxTickId ||
    !isUsableTickId(minTickId, tickSpacing) ||
    !isUsableTickId(maxTickId, tickSpacing)
  ) {
    throw PoolError.invalidParameters();
  }

  const tickIds: number[] = [];
  for (let tickId = minTickId; tickId <= maxTickId; tickId += tickSpacing) {
    tickIds.push(tickId);
  }
  return tickIds;
}

export function validateTickRanges(
  ranges: TickRange[],
  tickSpacing: number,
): void {
  if (ranges.length === 0 || ranges.length > POSITION_MAX_RANGE) {
    throw PoolError.invalidParameters();
  }
  for (const range of ranges) {
    if (
      range.tickLowerId >= range.tickUpperId ||
      !isUsableTickId(range.tickLowerId, tickSpacing) ||
      !isUsableTickId(range.tickUpperId, tickSpacing)
    ) {
      throw PoolError.invalidParameters();
    }
  }
}

/** Position-flow only (open/expand/add/remove/close): range-endpoint arrays ascending — wrong for swap, use `tickArraysForSwap`. */
export function tickArraysForRanges(
  pool: PublicKey,
  ranges: TickRange[],
  tickSpacing: number,
): PublicKey[] {
  const indexes = new Set<number>();
  for (const range of ranges) {
    indexes.add(tickIndexFromId(range.tickLowerId, tickSpacing));
    indexes.add(tickIndexFromId(range.tickUpperId, tickSpacing));
  }
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => deriveTickArray(pool, index));
}

/** Tick arrays for a swap, ordered for the program's single forward pass: descending indices when `swapForY`, ascending otherwise, starting from the current tick's array. */
export function tickArraysForSwap(args: {
  pool: PublicKey;
  poolState: PoolBitmapState;
  extensionState?: BitmapExtensionState | null;
  swapForY: boolean;
  maxTickArrays?: number;
}): { tickArrays: PublicKey[]; requiresBitmapExtension: boolean } {
  const maxTickArrays = args.maxTickArrays ?? 3;
  if (!Number.isInteger(maxTickArrays) || maxTickArrays <= 0) {
    throw PoolError.invalidParameters();
  }
  const currentIndex = tickIndexFromId(
    args.poolState.tickCurrentId,
    args.poolState.tickSpacing,
  );

  const indexes = new Set<number>(getBitmapSetIndicesFromPool(args.poolState));
  if (args.extensionState) {
    for (const index of getExtensionBitmapSetIndicesFromState(
      args.extensionState,
    )) {
      indexes.add(index);
    }
  }

  const selected = [...indexes]
    .filter((index) =>
      args.swapForY ? index <= currentIndex : index >= currentIndex,
    )
    .sort((a, b) => (args.swapForY ? b - a : a - b))
    .slice(0, maxTickArrays);

  return {
    tickArrays: selected.map((index) => deriveTickArray(args.pool, index)),
    // The program reads the extension account only while the pool flag is
    // set, and then whenever the internal bitmap runs out mid-traversal, so
    // the flag alone decides: pass it when set even if every selected array
    // is internal, never when clear even if the current index overflows.
    requiresBitmapExtension: args.poolState.isBitmapExtensionInitialized === 1,
  };
}

export function tickArrayRemainingAccounts(
  pool: PublicKey,
  ranges: TickRange[],
  tickSpacing: number,
  isWritable = true,
): AccountMeta[] {
  validateTickRanges(ranges, tickSpacing);
  return tickArraysForRanges(pool, ranges, tickSpacing).map((pubkey) => ({
    pubkey,
    isWritable,
    isSigner: false,
  }));
}
