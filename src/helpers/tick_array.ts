import type { AccountMeta, PublicKey } from "@solana/web3.js";
import {
  BITMAP_SIZE,
  DLMM_PRO_PROGRAM_ID,
  MAX_TICK_SPACING,
  MAX_TICKS_PER_ARRAY,
  MAX_TICK_ID,
  MIN_TICK_ID,
  POSITION_MAX_RANGE,
} from "../constants";
import { PoolError } from "../errors";
import { deriveTickArray, deriveTickArrayBitmapExtension } from "./pda";
import type { TickRange } from "../types";
import { assertTickSpacing, isIntegerIn } from "./validation";

/** The program's `align_id_to_spacing`: the spacing multiple at or below `tickId`. */
export function alignTickDown(tickId: number, tickSpacing: number): number {
  return Math.floor(tickId / tickSpacing) * tickSpacing;
}

export function isUsableTickId(tickId: number, tickSpacing: number): boolean {
  return (
    isIntegerIn(tickSpacing, 1, MAX_TICK_SPACING) &&
    isIntegerIn(tickId, MIN_TICK_ID, MAX_TICK_ID) &&
    tickId % tickSpacing === 0
  );
}

export function tickIndexFromId(tickId: number, tickSpacing: number): number {
  if (!Number.isInteger(tickId)) {
    throw PoolError.invalidParameters("tickId must be an integer");
  }
  assertTickSpacing(tickSpacing);
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
  if (minTickId > maxTickId) {
    throw PoolError.invalidParameters("minTickId must not exceed maxTickId");
  }
  if (
    !isUsableTickId(minTickId, tickSpacing) ||
    !isUsableTickId(maxTickId, tickSpacing)
  ) {
    throw PoolError.invalidParameters(
      "minTickId and maxTickId must be usable tick ids",
    );
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
    throw PoolError.invalidParameters(
      "tickRanges must have 1..=POSITION_MAX_RANGE entries",
    );
  }
  for (const range of ranges) {
    if (
      range.tickLowerId >= range.tickUpperId ||
      !isUsableTickId(range.tickLowerId, tickSpacing) ||
      !isUsableTickId(range.tickUpperId, tickSpacing)
    ) {
      throw PoolError.invalidParameters(
        "tickRanges must be usable tick ids with tickLowerId < tickUpperId",
      );
    }
  }
}

/** Position-flow only (open/expand/add/remove/close): range-endpoint arrays ascending — wrong for swap, use `tickArraysForSwap`. */
export function tickArraysForRanges(
  pool: PublicKey,
  ranges: TickRange[],
  tickSpacing: number,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey[] {
  return tickArraysForTickIds(
    pool,
    ranges.flatMap((range) => [range.tickLowerId, range.tickUpperId]),
    tickSpacing,
    programId,
  );
}

/** Indexes of the tick arrays holding `tickIds`, deduplicated and ascending. */
export function tickArrayIndexesForTickIds(
  tickIds: number[],
  tickSpacing: number,
): number[] {
  return [
    ...new Set(tickIds.map((tickId) => tickIndexFromId(tickId, tickSpacing))),
  ].sort((a, b) => a - b);
}

/** The tick arrays holding `tickIds`, deduplicated and ascending by index, the order the limit-order instructions read them in. */
export function tickArraysForTickIds(
  pool: PublicKey,
  tickIds: number[],
  tickSpacing: number,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey[] {
  return tickArrayIndexesForTickIds(tickIds, tickSpacing).map((index) =>
    deriveTickArray(pool, index, programId),
  );
}

/**
 * The bitmap extension when the pool has one and an array lies outside the
 * inline bitmap, otherwise `null`. Anchor deserializes an optional extension
 * even where the program never reads it, so an uninitialized one would fail.
 */
export function bitmapExtensionForTickArrays(
  pool: PublicKey,
  isBitmapExtensionInitialized: number,
  tickArrayIndexes: number[],
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey | null {
  return isBitmapExtensionInitialized === 1 &&
    tickArrayIndexes.some(overflowsDefaultTickArrayBitmap)
    ? deriveTickArrayBitmapExtension(pool, programId)
    : null;
}

export function tickArrayMetas(
  tickArrays: PublicKey[],
  isWritable = true,
): AccountMeta[] {
  return tickArrays.map((pubkey) => ({ pubkey, isWritable, isSigner: false }));
}

export function tickArrayRemainingAccounts(
  pool: PublicKey,
  ranges: TickRange[],
  tickSpacing: number,
  isWritable = true,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): AccountMeta[] {
  validateTickRanges(ranges, tickSpacing);
  return tickArrayMetas(
    tickArraysForRanges(pool, ranges, tickSpacing, programId),
    isWritable,
  );
}
