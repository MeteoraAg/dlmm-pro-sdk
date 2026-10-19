import type BN from "bn.js";
import {
  BITMAP_SIZE,
  type BitmapExtensionState,
  type PoolBitmapState,
} from "../../src";

/** Positions of the set bits across little-endian u64 limbs. */
function setBits(limbs: BN[]): number[] {
  return limbs.flatMap((limb, chunk) =>
    Array.from({ length: 64 }, (_, bit) => bit)
      .filter((bit) => limb.testn(bit))
      .map((bit) => chunk * 64 + bit),
  );
}

/** Tick array indexes set in the pool's inline bitmap. */
export function getBitmapSetIndicesFromPool(
  pool: Pick<PoolBitmapState, "tickArrayBitmap">,
): number[] {
  return setBits(pool.tickArrayBitmap).map((bit) => bit - BITMAP_SIZE);
}

/** Tick array indexes set in the bitmap extension, ascending. */
export function getExtensionBitmapSetIndicesFromState(
  extension: BitmapExtensionState,
): number[] {
  const positive = extension.positiveBitmap.flatMap((limbs, offset) =>
    setBits(limbs).map((bit) => (offset + 1) * BITMAP_SIZE + bit),
  );
  const negative = extension.negativeBitmap.flatMap((limbs, offset) =>
    setBits(limbs).map((bit) => -((offset + 1) * BITMAP_SIZE + bit) - 1),
  );
  return [...negative, ...positive].sort((a, b) => a - b);
}
