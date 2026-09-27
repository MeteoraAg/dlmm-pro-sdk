import type { Layout } from "@coral-xyz/borsh";
import BN from "bn.js";
import { PoolExtension } from "../constants";
import { PoolError } from "../errors";
import { U16_MAX, U32_MAX, U64_MAX } from "../math/safe_math";
import type {
  DecodedLimitOrderData,
  DecodedObservation,
  DecodedPoolActivation,
  DecodedPoolExtensions,
  DecodedPoolRewardInfo,
  DecodedPosition,
  DecodedPositionWithReward,
  DecodedTick,
  DecodedTickWithReward,
  Pool,
  TickArrayBitmapExtension,
} from "../types";
import {
  LIMIT_ORDER_DATA_LAYOUT,
  OBSERVATION_LAYOUT,
  POOL_ACTIVATION_LAYOUT,
  POOL_REWARD_LAYOUT,
  POSITION_LAYOUT,
  POSITION_WITH_REWARD_LAYOUT,
  TICK_LAYOUT,
  TICK_WITH_REWARD_LAYOUT,
} from "./layouts";

function encodePodUint(
  value: BN | number,
  byteLength: number,
  max: BN,
): Buffer {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw PoolError.invalidParameters();
  }
  const bn = BN.isBN(value) ? value : new BN(value);
  if (bn.isNeg() || bn.gt(max)) {
    throw PoolError.invalidParameters();
  }
  return bn.toArrayLike(Buffer, "le", byteLength);
}

export function encodePodU64(value: BN | number): Buffer {
  return encodePodUint(value, 8, U64_MAX);
}

export function encodePodU32(value: BN | number): Buffer {
  return encodePodUint(value, 4, U32_MAX);
}

export function encodePodU16(value: BN | number): Buffer {
  return encodePodUint(value, 2, U16_MAX);
}

export function encodePodU8(value: BN | number): Buffer {
  return encodePodUint(value, 1, new BN(0xff));
}

export function toPodBuffer(data: number[], length: number): Buffer {
  if (data.length !== length) {
    throw PoolError.invalidParameters();
  }
  return Buffer.from(data);
}

function decodeSeq<T>(
  layout: Layout<unknown>,
  data: Buffer,
  offset: number,
): T[] {
  if (data.length < offset) {
    throw new Error("Account data shorter than header size");
  }
  const count = Math.floor((data.length - offset) / layout.span);
  const items: T[] = [];
  for (let i = 0; i < count; i++) {
    items.push(layout.decode(data, offset + i * layout.span) as T);
  }
  return items;
}

function hasExtension(extensions: number, extension: PoolExtension): boolean {
  return (extensions & (1 << extension)) !== 0;
}

/**
 * Decode pool trailing extension bytes after the fixed `Pool` header
 * @param data - The pool account data
 * @param poolHeaderSize - The pool header size
 * @param extensions - The pool extensions
 * @returns The decoded pool extensions
 */
export function decodePoolExtensionsFromData(
  data: Buffer,
  poolHeaderSize: number,
  extensions: number,
): DecodedPoolExtensions {
  const hasLiquidityMining = hasExtension(
    extensions,
    PoolExtension.LiquidityMining,
  );
  const hasActivationAccess = hasExtension(
    extensions,
    PoolExtension.ActivationAccess,
  );

  let offset = poolHeaderSize;
  let rewards: DecodedPoolRewardInfo[] | undefined;
  let activation: DecodedPoolActivation | undefined;

  if (hasLiquidityMining) {
    if (data.length < offset + POOL_REWARD_LAYOUT.span) {
      throw new Error("Pool account missing liquidity mining extension data");
    }
    rewards = (
      POOL_REWARD_LAYOUT.decode(data, offset) as {
        rewards: DecodedPoolRewardInfo[];
      }
    ).rewards;
    offset += POOL_REWARD_LAYOUT.span;
  }

  if (hasActivationAccess) {
    if (data.length < offset + POOL_ACTIVATION_LAYOUT.span) {
      throw new Error("Pool account missing activation access extension data");
    }
    activation = POOL_ACTIVATION_LAYOUT.decode(
      data,
      offset,
    ) as DecodedPoolActivation;
  }

  return {
    extensions,
    hasLiquidityMining,
    hasActivationAccess,
    rewards,
    activation,
  };
}

/**
 * Decode position array bytes after the fixed `PositionArray` header
 * @param data - The position array account data
 * @param positionArrayHeaderSize - The position array header size
 * @param withReward - Whether to decode with reward
 * @returns The decoded positions
 */
export function decodePositionsFromData(
  data: Buffer,
  positionArrayHeaderSize: number,
  withReward = false,
): DecodedPosition[] | DecodedPositionWithReward[] {
  if (withReward) {
    return decodeSeq<DecodedPositionWithReward>(
      POSITION_WITH_REWARD_LAYOUT,
      data,
      positionArrayHeaderSize,
    );
  }
  return decodeSeq<DecodedPosition>(
    POSITION_LAYOUT,
    data,
    positionArrayHeaderSize,
  );
}

/**
 * Decode tick array bytes after the fixed `TickArray` header
 * @param data - The tick array account data
 * @param tickArrayHeaderSize - The tick array header size
 * @param withReward - Whether to decode with reward
 * @returns The decoded ticks
 */
export function decodeTicksFromData(
  data: Buffer,
  tickArrayHeaderSize: number,
  withReward: boolean,
): DecodedTick[] | DecodedTickWithReward[] {
  if (withReward) {
    return decodeSeq<DecodedTickWithReward>(
      TICK_WITH_REWARD_LAYOUT,
      data,
      tickArrayHeaderSize,
    );
  }
  return decodeSeq<DecodedTick>(TICK_LAYOUT, data, tickArrayHeaderSize);
}

/**
 * Decode limit order data bytes after the fixed `LimitOrderData` header
 * @param data - The limit order data account data
 * @param limitOrderHeaderSize - The limit order data header size
 * @returns The decoded limit order data
 */
export function decodeLimitOrderDataFromData(
  data: Buffer,
  limitOrderHeaderSize: number,
): DecodedLimitOrderData[] {
  return decodeSeq<DecodedLimitOrderData>(
    LIMIT_ORDER_DATA_LAYOUT,
    data,
    limitOrderHeaderSize,
  );
}

/**
 * Decode observation bytes after the fixed `Observation` header
 * @param data - The observation account data
 * @param oracleHeaderSize - The observation header size
 * @returns The decoded observations
 */
export function decodeObservationsFromData(
  data: Buffer,
  oracleHeaderSize: number,
): DecodedObservation[] {
  return decodeSeq<DecodedObservation>(
    OBSERVATION_LAYOUT,
    data,
    oracleHeaderSize,
  );
}

/**
 * Get the bitmap set indices from the pool
 * @param pool - The pool
 * @returns The bitmap set indices
 */
export function getBitmapSetIndicesFromPool(pool: Pool): number[] {
  const bitmap = pool.tickArrayBitmap;
  const indices: number[] = [];

  for (let chunk = 0; chunk < bitmap.length; chunk++) {
    for (let bit = 0; bit < 64; bit++) {
      if (bitmap[chunk].testn(bit)) {
        indices.push(chunk * 64 + bit - 512);
      }
    }
  }

  return indices;
}

/**
 * Get the bitmap set indices from the extension
 * @param extension - The extension
 * @returns The bitmap set indices
 */
export function getExtensionBitmapSetIndicesFromState(
  extension: TickArrayBitmapExtension,
): number[] {
  const indices: number[] = [];

  for (let offset = 0; offset < extension.positiveBitmap.length; offset++) {
    for (
      let chunk = 0;
      chunk < extension.positiveBitmap[offset].length;
      chunk++
    ) {
      for (let bit = 0; bit < 64; bit++) {
        if (extension.positiveBitmap[offset][chunk].testn(bit)) {
          indices.push(offset * 512 + chunk * 64 + bit + 512);
        }
      }
    }
  }

  for (let offset = 0; offset < extension.negativeBitmap.length; offset++) {
    for (
      let chunk = 0;
      chunk < extension.negativeBitmap[offset].length;
      chunk++
    ) {
      for (let bit = 0; bit < 64; bit++) {
        if (extension.negativeBitmap[offset][chunk].testn(bit)) {
          indices.push(-(offset * 512 + chunk * 64 + bit + 1) - 512);
        }
      }
    }
  }

  return indices.sort((a, b) => a - b);
}
