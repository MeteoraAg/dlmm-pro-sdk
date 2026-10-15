import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  deriveTickArray,
  DlmmProClient,
  PoolErrorCode,
  tickArraysForSwap,
  tickArraysForTickIds,
  tickIndexFromId,
  type BitmapExtensionState,
  type PoolBitmapState,
} from "../src";
import { getNonZeroLiquidityNextIndex } from "../src/quote/bitmap_traversal";
import {
  createFundedMarket,
  createSvmConnection,
  initializeStaticPool,
  initializeSVM,
  sendTransaction,
} from "./helpers";

function bitmapFromIndexes(indexes: number[]): BN[] {
  const limbs = Array.from({ length: 16 }, () => new BN(0));
  for (const index of indexes) {
    const offset = index + 512;
    const chunk = Math.floor(offset / 64);
    limbs[chunk] = limbs[chunk].or(new BN(1).shln(offset % 64));
  }
  return limbs;
}

function poolStateWith(args: {
  tickCurrentId: number;
  tickSpacing: number;
  setIndexes: number[];
  isBitmapExtensionInitialized?: number;
}): PoolBitmapState {
  return {
    tickCurrentId: args.tickCurrentId,
    tickSpacing: args.tickSpacing,
    tickArrayBitmap: bitmapFromIndexes(args.setIndexes),
    isBitmapExtensionInitialized: args.isBitmapExtensionInitialized ?? 0,
  };
}

function extensionStateWith(indexes: number[]): BitmapExtensionState {
  const emptyBitmap = () =>
    Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => new BN(0)));
  const positiveBitmap = emptyBitmap();
  const negativeBitmap = emptyBitmap();

  for (const index of indexes) {
    const bitmap = index >= 512 ? positiveBitmap : negativeBitmap;
    const value = index >= 512 ? index - 512 : -index - 513;
    const offset = Math.floor(value / 512);
    const chunk = Math.floor((value % 512) / 64);
    bitmap[offset][chunk] = bitmap[offset][chunk].or(
      new BN(1).shln(value % 64),
    );
  }

  return { positiveBitmap, negativeBitmap };
}

describe("tickIndexFromId", () => {
  it("matches the program for negative unaligned tick ids", () => {
    expect(tickIndexFromId(-1, 2)).toBe(-1);
    expect(tickIndexFromId(-257, 2)).toBe(-2);
    expect(tickIndexFromId(-2, 2)).toBe(-1);
    expect(tickIndexFromId(-129, 1)).toBe(-2);
  });

  it("matches the program for aligned tick ids", () => {
    expect(tickIndexFromId(-256, 2)).toBe(-1);
    expect(tickIndexFromId(-512, 2)).toBe(-2);
    expect(tickIndexFromId(-128, 1)).toBe(-1);
    expect(tickIndexFromId(-1, 1)).toBe(-1);
  });

  it("matches the program for positive tick ids", () => {
    expect(tickIndexFromId(0, 2)).toBe(0);
    expect(tickIndexFromId(255, 2)).toBe(0);
    expect(tickIndexFromId(256, 2)).toBe(1);
    expect(tickIndexFromId(127, 1)).toBe(0);
    expect(tickIndexFromId(128, 1)).toBe(1);
  });
});

describe("initializeTickArray", () => {
  it("creates the derived tick array for the pool", async () => {
    const svm = initializeSVM();
    const client = DlmmProClient.create(createSvmConnection(svm));
    const market = await createFundedMarket({ svm, client });
    const pool = await initializeStaticPool(svm, client, market);

    const index = -1;
    const { tx, tickArray } = await client.pool.initializeTickArray({
      pool,
      index,
      funder: market.payer.publicKey,
    });
    sendTransaction(svm, tx, [market.payer]);
    expect(tickArray.toBase58()).toBe(deriveTickArray(pool, index).toBase58());

    const state = await client.state.fetchTickArray(tickArray);
    expect(state.pool.toBase58()).toBe(pool.toBase58());
    expect(state.tickIndex).toBe(index);
  });
});

describe("tickArraysForTickIds", () => {
  it("returns each array once, ascending by index", () => {
    const pool = Keypair.generate().publicKey;
    expect(tickArraysForTickIds(pool, [300, -1, 2, 129, -130], 1)).toEqual(
      [-2, -1, 0, 1, 2].map((index) => deriveTickArray(pool, index)),
    );
  });
});

describe("tickArraysForSwap", () => {
  const pool = Keypair.generate().publicKey;

  it("orders arrays descending from the current array when swapping for Y", () => {
    const { tickArrays, requiresBitmapExtension } = tickArraysForSwap({
      pool,
      poolState: poolStateWith({
        tickCurrentId: 0,
        tickSpacing: 1,
        setIndexes: [-3, -1, 0, 2],
      }),
      swapForY: true,
    });

    expect(tickArrays).toEqual([
      deriveTickArray(pool, 0),
      deriveTickArray(pool, -1),
      deriveTickArray(pool, -3),
    ]);
    expect(requiresBitmapExtension).toBe(false);
  });

  it("orders arrays ascending from the current array when swapping for X", () => {
    const { tickArrays, requiresBitmapExtension } = tickArraysForSwap({
      pool,
      poolState: poolStateWith({
        tickCurrentId: 0,
        tickSpacing: 1,
        setIndexes: [-3, -1, 0, 2],
      }),
      swapForY: false,
    });

    expect(tickArrays).toEqual([
      deriveTickArray(pool, 0),
      deriveTickArray(pool, 2),
    ]);
    expect(requiresBitmapExtension).toBe(false);
  });

  it("caps the number of arrays at maxTickArrays", () => {
    const { tickArrays } = tickArraysForSwap({
      pool,
      poolState: poolStateWith({
        tickCurrentId: 0,
        tickSpacing: 1,
        setIndexes: [-3, -1, 0, 2],
      }),
      swapForY: true,
      maxTickArrays: 2,
    });

    expect(tickArrays).toEqual([
      deriveTickArray(pool, 0),
      deriveTickArray(pool, -1),
    ]);
  });

  it("merges positive extension indexes and flags the extension requirement", () => {
    const { tickArrays, requiresBitmapExtension } = tickArraysForSwap({
      pool,
      poolState: poolStateWith({
        tickCurrentId: 511 * 128,
        tickSpacing: 1,
        setIndexes: [511],
        isBitmapExtensionInitialized: 1,
      }),
      extensionState: extensionStateWith([512]),
      swapForY: false,
    });

    expect(tickArrays).toEqual([
      deriveTickArray(pool, 511),
      deriveTickArray(pool, 512),
    ]);
    expect(requiresBitmapExtension).toBe(true);
  });

  it("merges negative extension indexes and flags the extension requirement", () => {
    const { tickArrays, requiresBitmapExtension } = tickArraysForSwap({
      pool,
      poolState: poolStateWith({
        tickCurrentId: -512 * 128,
        tickSpacing: 1,
        setIndexes: [-512],
        isBitmapExtensionInitialized: 1,
      }),
      extensionState: extensionStateWith([-513]),
      swapForY: true,
    });

    expect(tickArrays).toEqual([
      deriveTickArray(pool, -512),
      deriveTickArray(pool, -513),
    ]);
    expect(requiresBitmapExtension).toBe(true);
  });

  it("requires an initialized extension even when every selected array is internal", () => {
    const poolState = poolStateWith({
      tickCurrentId: 0,
      tickSpacing: 1,
      setIndexes: [0],
      isBitmapExtensionInitialized: 1,
    });
    const { tickArrays, requiresBitmapExtension } = tickArraysForSwap({
      pool,
      poolState,
      extensionState: extensionStateWith([]),
      swapForY: true,
    });

    expect(tickArrays).toEqual([deriveTickArray(pool, 0)]);
    expect(requiresBitmapExtension).toBe(true);
    expect(() =>
      tickArraysForSwap({ pool, poolState, swapForY: true }),
    ).toThrow(
      expect.objectContaining({
        code: PoolErrorCode.BitmapExtensionAccountIsNotProvided,
      }),
    );
  });

  it("does not require a missing extension when the current index has slipped outside the inline bitmap", () => {
    const { tickArrays, requiresBitmapExtension } = tickArraysForSwap({
      pool,
      poolState: poolStateWith({
        tickCurrentId: -512 * 128 - 1,
        tickSpacing: 1,
        setIndexes: [-512, -100],
      }),
      swapForY: false,
    });

    expect(tickArrays).toEqual([
      deriveTickArray(pool, -512),
      deriveTickArray(pool, -100),
    ]);
    expect(requiresBitmapExtension).toBe(false);
  });
});

// Without an extension account there is no liquidity outside the internal
// bitmap, but `tickCurrentId` can still sit outside it because crossing a tick
// moves the current id to `tick.tickId - 1`. The program then resumes the
// search from the internal boundary instead of giving up.
describe("getNonZeroLiquidityNextIndex without a bitmap extension", () => {
  it("resumes at the top of the internal bitmap when swapping for Y", () => {
    const poolState = poolStateWith({
      tickCurrentId: 0,
      tickSpacing: 1,
      setIndexes: [100],
    });
    expect(getNonZeroLiquidityNextIndex(poolState, true, 600, null)).toBe(100);
  });

  it("resumes at the bottom of the internal bitmap when swapping for X", () => {
    const poolState = poolStateWith({
      tickCurrentId: 0,
      tickSpacing: 1,
      setIndexes: [-100],
    });
    expect(getNonZeroLiquidityNextIndex(poolState, false, -600, null)).toBe(
      -100,
    );
  });

  it("gives up when the swap direction leads away from the internal bitmap", () => {
    const poolState = poolStateWith({
      tickCurrentId: 0,
      tickSpacing: 1,
      setIndexes: [100],
    });
    expect(
      getNonZeroLiquidityNextIndex(poolState, false, 600, null),
    ).toBeNull();
    expect(
      getNonZeroLiquidityNextIndex(poolState, true, -600, null),
    ).toBeNull();
  });

  it("gives up when the internal bitmap is empty", () => {
    const poolState = poolStateWith({
      tickCurrentId: 0,
      tickSpacing: 1,
      setIndexes: [],
    });
    expect(getNonZeroLiquidityNextIndex(poolState, true, 600, null)).toBeNull();
  });
});
