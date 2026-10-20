import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import type { Layout } from "@coral-xyz/borsh";
import { POOL_EXTENSION_VARIANT_COUNT } from "../constants";
import { PoolError } from "../errors";
import DlmmProIDL from "../idl/dlmm-pro/dlmm_pro.json";
import {
  PoolExtension,
  type DecodedLimitOrderData,
  type DecodedObservation,
  type DecodedPoolExtensions,
  type DecodedPoolRewardInfo,
  type DecodedPosition,
  type DecodedPositionWithReward,
  type DecodedTick,
  type DecodedTickWithReward,
  type Pool,
  type PoolActivationParameters,
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
import { isIntegerIn } from "./validation";

const coder = new BorshAccountsCoder(DlmmProIDL as Idl);
const POOL_HEADER_SIZE = coder.size("Pool");
const POSITION_ARRAY_HEADER_SIZE = coder.size("PositionArray");
const TICK_ARRAY_HEADER_SIZE = coder.size("TickArray");
const LIMIT_ORDER_HEADER_SIZE = coder.size("LimitOrder");
const ORACLE_HEADER_SIZE = coder.size("Oracle");

function assertAccountDiscriminator(data: Buffer, accountName: string): void {
  const expected = coder.accountDiscriminator(accountName);
  if (!data.subarray(0, expected.length).equals(expected)) {
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
  return Array.from(
    { length: count },
    (_, i) => layout.decode(data, offset + i * layout.span) as T,
  );
}

export function isSupportExtension(
  extensions: number,
  extension: PoolExtension,
): boolean {
  return (extensions & (1 << extension)) !== 0;
}

export function encodePoolExtensions(extensions: PoolExtension[]): number {
  for (const extension of extensions) {
    if (!isIntegerIn(extension, 0, POOL_EXTENSION_VARIANT_COUNT - 1)) {
      throw PoolError.invalidParameters(
        "extensions must be PoolExtension variants",
      );
    }
  }
  return extensions.reduce((acc, extension) => acc | (1 << extension), 0);
}

export function decodePoolExtensionsFromData(
  data: Buffer,
): DecodedPoolExtensions {
  if (data.length < POOL_HEADER_SIZE) {
    throw new Error("Account data shorter than Pool header size");
  }
  const { extensions } = coder.decode<Pool>("Pool", data);

  let offset = POOL_HEADER_SIZE;
  let rewards: DecodedPoolRewardInfo[] | undefined;
  let activation: PoolActivationParameters | undefined;

  if (isSupportExtension(extensions, PoolExtension.LiquidityMining)) {
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

  if (isSupportExtension(extensions, PoolExtension.ActivationAccess)) {
    if (data.length < offset + POOL_ACTIVATION_LAYOUT.span) {
      throw new Error("Pool account missing activation access extension data");
    }
    activation = POOL_ACTIVATION_LAYOUT.decode(
      data,
      offset,
    ) as PoolActivationParameters;
  }

  return { extensions, rewards, activation };
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
