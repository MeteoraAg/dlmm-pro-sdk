import type { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { BITMAP_SIZE, DLMM_PRO_PROGRAM_ID } from "../constants";
import { PoolError } from "../errors";
import { deriveTickArray } from "../helpers/pda";
import {
  overflowsDefaultTickArrayBitmap,
  tickIndexFromId,
} from "../helpers/tick_array";
import type { BitmapExtensionState, PoolBitmapState } from "../types";

const EXTENSION_BITMAP_SIZE = 6;
const U1024_BITS = BITMAP_SIZE * 2;
const MIN_BITMAP_INDEX = -BITMAP_SIZE;
const MAX_BITMAP_INDEX = BITMAP_SIZE - 1;

function fromLimbs(limbs: BN[]): BN {
  let value = new BN(0);
  for (let i = limbs.length - 1; i >= 0; i--) {
    value = value.shln(64).or(limbs[i]);
  }
  return value;
}

function leadingZeros(value: BN, bits: number): number {
  return bits - value.bitLength();
}

function internalNextIndex(
  pool: PoolBitmapState,
  swapForY: boolean,
  fromTickIndex: number,
): [number, boolean] {
  const bitmap = fromLimbs(pool.tickArrayBitmap);
  const arrayOffset = fromTickIndex + BITMAP_SIZE;
  if (swapForY) {
    const bitmapRange = MAX_BITMAP_INDEX - MIN_BITMAP_INDEX;
    if (arrayOffset > bitmapRange) {
      throw PoolError.mathOverflow();
    }
    const offsetBitMap = bitmap
      .shln(bitmapRange - arrayOffset)
      .maskn(U1024_BITS);
    if (offsetBitMap.isZero()) {
      return [MIN_BITMAP_INDEX - 1, false];
    }
    const nextBit = leadingZeros(offsetBitMap, U1024_BITS);
    return [fromTickIndex - nextBit, true];
  }
  const offsetBitMap = bitmap.shrn(arrayOffset);
  if (offsetBitMap.isZero()) {
    return [MAX_BITMAP_INDEX + 1, false];
  }
  const nextBit = offsetBitMap.zeroBits();
  return [fromTickIndex + nextBit, true];
}

function extensionBitmapOffset(index: number): number {
  if (index > 0) {
    return Math.trunc(index / BITMAP_SIZE) - 1;
  }
  return Math.trunc(-(index + 1) / BITMAP_SIZE) - 1;
}

function extensionOffsetInBitmap(tickArrayIndex: number): number {
  if (tickArrayIndex > 0) {
    return tickArrayIndex % BITMAP_SIZE;
  }
  return -(tickArrayIndex + 1) % BITMAP_SIZE;
}

function extensionBitmapRange(): [number, number] {
  return [
    -BITMAP_SIZE * (EXTENSION_BITMAP_SIZE + 1),
    BITMAP_SIZE * (EXTENSION_BITMAP_SIZE + 1) - 1,
  ];
}

function toTickArrayIndex(
  offset: number,
  tickArrayOffset: number,
  isPositive: boolean,
): number {
  if (isPositive) {
    return (offset + 1) * BITMAP_SIZE + tickArrayOffset;
  }
  return -((offset + 1) * BITMAP_SIZE + tickArrayOffset) - 1;
}

function extensionBit(
  extension: BitmapExtensionState,
  tickArrayIndex: number,
): boolean {
  const offset = extensionBitmapOffset(tickArrayIndex);
  const limbs =
    tickArrayIndex < 0
      ? extension.negativeBitmap[offset]
      : extension.positiveBitmap[offset];
  const bitmap = fromLimbs(limbs);
  return bitmap.testn(extensionOffsetInBitmap(tickArrayIndex));
}

function extensionIterBitmap(
  extension: BitmapExtensionState,
  startIndex: number,
  endIndex: number,
): number | null {
  if (startIndex === endIndex) {
    return extensionBit(extension, startIndex) ? startIndex : null;
  }
  const offset = extensionBitmapOffset(startIndex);
  const tickArrayOffset = extensionOffsetInBitmap(startIndex);
  if (startIndex < 0) {
    if (startIndex < endIndex) {
      for (let i = offset; i >= 0; i--) {
        let bitmap = fromLimbs(extension.negativeBitmap[i]);
        if (i === offset) {
          bitmap = bitmap
            .shln(BITMAP_SIZE - tickArrayOffset - 1)
            .maskn(BITMAP_SIZE);
          if (bitmap.isZero()) {
            continue;
          }
          const tickArrayOffsetInBitmap =
            tickArrayOffset - leadingZeros(bitmap, BITMAP_SIZE);
          return toTickArrayIndex(i, tickArrayOffsetInBitmap, false);
        }
        if (bitmap.isZero()) {
          continue;
        }
        const tickArrayOffsetInBitmap =
          BITMAP_SIZE - leadingZeros(bitmap, BITMAP_SIZE) - 1;
        return toTickArrayIndex(i, tickArrayOffsetInBitmap, false);
      }
    } else {
      for (let i = offset; i < EXTENSION_BITMAP_SIZE; i++) {
        let bitmap = fromLimbs(extension.negativeBitmap[i]);
        if (i === offset) {
          bitmap = bitmap.shrn(tickArrayOffset);
          if (bitmap.isZero()) {
            continue;
          }
          const tickArrayOffsetInBitmap = tickArrayOffset + bitmap.zeroBits();
          return toTickArrayIndex(i, tickArrayOffsetInBitmap, false);
        }
        if (bitmap.isZero()) {
          continue;
        }
        return toTickArrayIndex(i, bitmap.zeroBits(), false);
      }
    }
  } else {
    if (startIndex < endIndex) {
      for (let i = offset; i < EXTENSION_BITMAP_SIZE; i++) {
        let bitmap = fromLimbs(extension.positiveBitmap[i]);
        if (i === offset) {
          bitmap = bitmap.shrn(tickArrayOffset);
          if (bitmap.isZero()) {
            continue;
          }
          const tickArrayOffsetInBitmap = tickArrayOffset + bitmap.zeroBits();
          return toTickArrayIndex(i, tickArrayOffsetInBitmap, true);
        }
        if (bitmap.isZero()) {
          continue;
        }
        return toTickArrayIndex(i, bitmap.zeroBits(), true);
      }
    } else {
      for (let i = offset; i >= 0; i--) {
        let bitmap = fromLimbs(extension.positiveBitmap[i]);
        if (i === offset) {
          bitmap = bitmap
            .shln(BITMAP_SIZE - tickArrayOffset - 1)
            .maskn(BITMAP_SIZE);
          if (bitmap.isZero()) {
            continue;
          }
          const tickArrayOffsetInBitmap =
            tickArrayOffset - leadingZeros(bitmap, BITMAP_SIZE);
          return toTickArrayIndex(i, tickArrayOffsetInBitmap, true);
        }
        if (bitmap.isZero()) {
          continue;
        }
        const tickArrayOffsetInBitmap =
          BITMAP_SIZE - leadingZeros(bitmap, BITMAP_SIZE) - 1;
        return toTickArrayIndex(i, tickArrayOffsetInBitmap, true);
      }
    }
  }
  return null;
}

function extensionNextIndex(
  extension: BitmapExtensionState | null | undefined,
  swapForY: boolean,
  startIndex: number,
): [number, boolean] {
  if (!extension) {
    throw PoolError.bitmapExtensionAccountIsNotProvided();
  }
  const [minBitmapId, maxBitmapId] = extensionBitmapRange();
  if (startIndex > 0) {
    if (swapForY) {
      const value = extensionIterBitmap(extension, startIndex, BITMAP_SIZE);
      return value !== null ? [value, true] : [BITMAP_SIZE - 1, false];
    }
    const value = extensionIterBitmap(extension, startIndex, maxBitmapId);
    return value !== null ? [value, true] : [maxBitmapId, false];
  }
  if (swapForY) {
    const value = extensionIterBitmap(extension, startIndex, minBitmapId);
    return value !== null ? [value, true] : [minBitmapId, false];
  }
  const value = extensionIterBitmap(extension, startIndex, -BITMAP_SIZE - 1);
  return value !== null ? [value, true] : [-BITMAP_SIZE, false];
}

function internalToExtension(
  pool: PoolBitmapState,
  swapForY: boolean,
  fromArrayIndex: number,
  extension: BitmapExtensionState | null | undefined,
): number | null {
  const [tickArrayIndex, isNonZeroLiquidityFlag] = internalNextIndex(
    pool,
    swapForY,
    fromArrayIndex,
  );
  if (isNonZeroLiquidityFlag) {
    return tickArrayIndex;
  }
  if (pool.isBitmapExtensionInitialized === 1) {
    const [extensionIndex, extensionFlag] = extensionNextIndex(
      extension,
      swapForY,
      tickArrayIndex,
    );
    return extensionFlag ? extensionIndex : null;
  }
  return null;
}

export function getNonZeroLiquidityNextIndex(
  pool: PoolBitmapState,
  swapForY: boolean,
  fromTickIndex: number,
  extension: BitmapExtensionState | null | undefined,
): number | null {
  if (overflowsDefaultTickArrayBitmap(fromTickIndex)) {
    if (pool.isBitmapExtensionInitialized !== 1) {
      // With no extension there is no liquidity outside the internal bitmap, so
      // a swap heading back into it resumes from the boundary. `tickCurrentId`
      // can sit outside the internal range because crossing a tick moves it to
      // `tick.tickId - 1`.
      const towardsInternal = swapForY
        ? fromTickIndex > MAX_BITMAP_INDEX
        : fromTickIndex < MIN_BITMAP_INDEX;
      if (!towardsInternal) {
        return null;
      }
      return internalToExtension(
        pool,
        swapForY,
        swapForY ? MAX_BITMAP_INDEX : MIN_BITMAP_INDEX,
        extension,
      );
    }
    const [tickArrayIndex, isNonZeroLiquidityFlag] = extensionNextIndex(
      extension,
      swapForY,
      fromTickIndex,
    );
    if (isNonZeroLiquidityFlag) {
      return tickArrayIndex;
    }
    if (!overflowsDefaultTickArrayBitmap(tickArrayIndex)) {
      return internalToExtension(pool, swapForY, tickArrayIndex, extension);
    }
    return null;
  }
  return internalToExtension(pool, swapForY, fromTickIndex, extension);
}

/** Tick arrays for a swap, ordered for the program's single forward pass: descending indices when `swapForY`, ascending otherwise, starting from the current tick's array. */
export function tickArraysForSwap(args: {
  pool: PublicKey;
  poolState: PoolBitmapState;
  extensionState?: BitmapExtensionState | null;
  swapForY: boolean;
  maxTickArrays?: number;
  programId?: PublicKey;
}): { tickArrays: PublicKey[]; requiresBitmapExtension: boolean } {
  const programId = args.programId ?? DLMM_PRO_PROGRAM_ID;
  const maxTickArrays = args.maxTickArrays ?? 3;
  if (!Number.isInteger(maxTickArrays) || maxTickArrays <= 0) {
    throw PoolError.invalidParameters(
      "maxTickArrays must be a positive integer",
    );
  }
  const requiresBitmapExtension =
    args.poolState.isBitmapExtensionInitialized === 1;
  // Without the extension's bitmap the arrays it tracks would be skipped.
  if (requiresBitmapExtension && !args.extensionState) {
    throw PoolError.bitmapExtensionAccountIsNotProvided();
  }

  const tickArrays: PublicKey[] = [];
  let index = getNonZeroLiquidityNextIndex(
    args.poolState,
    args.swapForY,
    tickIndexFromId(args.poolState.tickCurrentId, args.poolState.tickSpacing),
    args.extensionState,
  );
  while (index !== null) {
    tickArrays.push(deriveTickArray(args.pool, index, programId));
    if (tickArrays.length === maxTickArrays) {
      break;
    }
    index = getNonZeroLiquidityNextIndex(
      args.poolState,
      args.swapForY,
      args.swapForY ? index - 1 : index + 1,
      args.extensionState,
    );
  }

  return {
    tickArrays,
    // The program reads the extension account only while the pool flag is
    // set, and then whenever the internal bitmap runs out mid-traversal, so
    // the flag alone decides: pass it when set even if every selected array
    // is internal, never when clear even if the current index overflows.
    requiresBitmapExtension,
  };
}
