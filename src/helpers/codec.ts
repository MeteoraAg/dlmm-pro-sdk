import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import type { Layout } from "@coral-xyz/borsh";
import { BITMAP_SIZE, POOL_EXTENSION_VARIANT_COUNT } from "../constants";
import { PoolError } from "../errors";
import DlmmProIDL from "../idl/dlmm-pro/dlmm_pro.json";
import {
  PoolExtension,
  type DecodedLimitOrderData,
  type DecodedObservation,
  type DecodedPoolActivation,
  type DecodedPoolExtensions,
  type DecodedPoolRewardInfo,
  type DecodedPosition,
  type DecodedPositionWithReward,
  type DecodedTick,
  type DecodedTickWithReward,
  type BitmapExtensionState,
  type Pool,
  type PoolBitmapState,
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

const coder = new BorshAccountsCoder(DlmmProIDL as Idl);
const POOL_HEADER_SIZE = coder.size("Pool");
const POSITION_ARRAY_HEADER_SIZE = coder.size("PositionArray");
const TICK_ARRAY_HEADER_SIZE = coder.size("TickArray");
const LIMIT_ORDER_HEADER_SIZE = coder.size("LimitOrder");
const ORACLE_HEADER_SIZE = coder.size("Oracle");

const ACCOUNT_DISCRIMINATORS = new Map(
  DlmmProIDL.accounts.map((account) => [
    account.name,
    Buffer.from(account.discriminator),
  ]),
);

function assertAccountDiscriminator(data: Buffer, accountName: string): void {
  const expected = ACCOUNT_DISCRIMINATORS.get(accountName);
  if (!expected) {
    throw new Error(`IDL account not found: ${accountName}`);
  }
  if (
    data.length < expected.length ||
    !data.subarray(0, expected.length).equals(expected)
  ) {
    throw new Error(`Account data is not a ${accountName} account`);
  }
}

function decodeSeq<T>(
  layout: Layout<unknown>,
  data: Buffer,
  // Includes the 8-byte account discriminator.
  offset: number,
  accountName: string,
): T[] {
  assertAccountDiscriminator(data, accountName);
  if (data.length < offset) {
    throw new Error(`Account data shorter than ${accountName} header size`);
  }
  if ((data.length - offset) % layout.span !== 0) {
    throw new Error(
      `Account data length does not align to ${accountName} element size`,
    );
  }
  const count = (data.length - offset) / layout.span;
  const items: T[] = [];
  for (let i = 0; i < count; i++) {
    items.push(layout.decode(data, offset + i * layout.span) as T);
  }
  return items;
}

export function isSupportExtension(
  extensions: number,
  extension: PoolExtension,
): boolean {
  return (extensions & (1 << extension)) !== 0;
}

export function encodePoolExtensions(extensions: PoolExtension[]): number {
  for (const extension of extensions) {
    if (
      !Number.isInteger(extension) ||
      extension < 0 ||
      extension >= POOL_EXTENSION_VARIANT_COUNT
    ) {
      throw PoolError.invalidParameters();
    }
  }
  return extensions.reduce((acc, extension) => acc | (1 << extension), 0);
}

export function decodePoolExtensionsFromData(
  data: Buffer,
): DecodedPoolExtensions {
  assertAccountDiscriminator(data, "Pool");
  if (data.length < POOL_HEADER_SIZE) {
    throw new Error("Account data shorter than Pool header size");
  }
  const { extensions } = coder.decode<Pool>("Pool", data);
  const hasLiquidityMining = isSupportExtension(
    extensions,
    PoolExtension.LiquidityMining,
  );
  const hasActivationAccess = isSupportExtension(
    extensions,
    PoolExtension.ActivationAccess,
  );

  let offset = POOL_HEADER_SIZE;
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

export function decodePositionsFromData(
  data: Buffer,
  withReward: boolean,
): DecodedPosition[] | DecodedPositionWithReward[] {
  if (withReward) {
    return decodeSeq<DecodedPositionWithReward>(
      POSITION_WITH_REWARD_LAYOUT,
      data,
      POSITION_ARRAY_HEADER_SIZE,
      "PositionArray",
    );
  }
  return decodeSeq<DecodedPosition>(
    POSITION_LAYOUT,
    data,
    POSITION_ARRAY_HEADER_SIZE,
    "PositionArray",
  );
}

export function decodeTicksFromData(
  data: Buffer,
  withReward: boolean,
): DecodedTick[] | DecodedTickWithReward[] {
  if (withReward) {
    return decodeSeq<DecodedTickWithReward>(
      TICK_WITH_REWARD_LAYOUT,
      data,
      TICK_ARRAY_HEADER_SIZE,
      "TickArray",
    );
  }
  return decodeSeq<DecodedTick>(
    TICK_LAYOUT,
    data,
    TICK_ARRAY_HEADER_SIZE,
    "TickArray",
  );
}

export function decodeLimitOrderDataFromData(
  data: Buffer,
): DecodedLimitOrderData[] {
  return decodeSeq<DecodedLimitOrderData>(
    LIMIT_ORDER_DATA_LAYOUT,
    data,
    LIMIT_ORDER_HEADER_SIZE,
    "LimitOrder",
  );
}

export function decodeObservationsFromData(data: Buffer): DecodedObservation[] {
  return decodeSeq<DecodedObservation>(
    OBSERVATION_LAYOUT,
    data,
    ORACLE_HEADER_SIZE,
    "Oracle",
  );
}

export function getBitmapSetIndicesFromPool(
  pool: Pick<PoolBitmapState, "tickArrayBitmap">,
): number[] {
  const bitmap = pool.tickArrayBitmap;
  const indices: number[] = [];

  for (let chunk = 0; chunk < bitmap.length; chunk++) {
    for (let bit = 0; bit < 64; bit++) {
      if (bitmap[chunk].testn(bit)) {
        indices.push(chunk * 64 + bit - BITMAP_SIZE);
      }
    }
  }

  return indices;
}

export function getExtensionBitmapSetIndicesFromState(
  extension: BitmapExtensionState,
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
          indices.push(offset * BITMAP_SIZE + chunk * 64 + bit + BITMAP_SIZE);
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
          indices.push(
            -(offset * BITMAP_SIZE + chunk * 64 + bit + 1) - BITMAP_SIZE,
          );
        }
      }
    }
  }

  return indices.sort((a, b) => a - b);
}
