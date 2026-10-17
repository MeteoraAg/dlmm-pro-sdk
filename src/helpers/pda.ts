import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  ACCESS_REGISTRY_PROGRAM_ID,
  DLMM_PRO_PROGRAM_ID,
  DYNAMIC_CONFIG_PREFIX,
  LAUNCH_POOL_PREFIX,
  LIMIT_ORDER_PREFIX,
  NUM_REWARDS,
  OPERATOR_PREFIX,
  ORACLE_PREFIX,
  POOL_AUTHORITY_PREFIX,
  POOL_PREFIX,
  POSITION_PREFIX,
  RESERVE_PREFIX,
  REWARD_VAULT_PREFIX,
  STATIC_CONFIG_PREFIX,
  TICK_ARRAY_BITMAP_EXTENSION_PREFIX,
  TICK_ARRAY_PREFIX,
  TOKEN_BADGE_PREFIX,
} from "../constants";
import { PoolError } from "../errors";
import { encodePodU64 } from "./pod";
import { assertI32 } from "./validation";

function toI32Buffer(index: number): Buffer {
  assertI32(index);
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(index, 0);
  return buf;
}

function sortMints(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  return a.toBuffer().compare(b.toBuffer()) > 0 ? [a, b] : [b, a];
}

export function derivePoolAuthority(
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_AUTHORITY_PREFIX)],
    programId,
  )[0];
}

export function deriveOperator(
  whitelistedAddress: PublicKey,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(OPERATOR_PREFIX), whitelistedAddress.toBuffer()],
    programId,
  )[0];
}

export function deriveStaticConfig(
  index: BN | number,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(STATIC_CONFIG_PREFIX), encodePodU64(index)],
    programId,
  )[0];
}

export function deriveDynamicConfig(
  poolCreatorAuthority: PublicKey,
  index: BN | number,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(DYNAMIC_CONFIG_PREFIX),
      poolCreatorAuthority.toBuffer(),
      encodePodU64(index),
    ],
    programId,
  )[0];
}

export function deriveTokenBadge(
  tokenMint: PublicKey,
  programId: PublicKey = ACCESS_REGISTRY_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TOKEN_BADGE_PREFIX), tokenMint.toBuffer()],
    programId,
  )[0];
}

export function derivePool(
  config: PublicKey,
  tokenXMint: PublicKey,
  tokenYMint: PublicKey,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  const [hi, lo] = sortMints(tokenXMint, tokenYMint);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_PREFIX), config.toBuffer(), hi.toBuffer(), lo.toBuffer()],
    programId,
  )[0];
}

export function deriveLaunchPool(
  tokenXMint: PublicKey,
  tokenYMint: PublicKey,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  const [hi, lo] = sortMints(tokenXMint, tokenYMint);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LAUNCH_POOL_PREFIX), hi.toBuffer(), lo.toBuffer()],
    programId,
  )[0];
}

export function deriveOracle(
  pool: PublicKey,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ORACLE_PREFIX), pool.toBuffer()],
    programId,
  )[0];
}

export function deriveReserve(
  mint: PublicKey,
  pool: PublicKey,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(RESERVE_PREFIX), mint.toBuffer(), pool.toBuffer()],
    programId,
  )[0];
}

export function deriveTickArrayBitmapExtension(
  pool: PublicKey,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TICK_ARRAY_BITMAP_EXTENSION_PREFIX), pool.toBuffer()],
    programId,
  )[0];
}

export function deriveTickArray(
  pool: PublicKey,
  tickArrayIndex: number,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(TICK_ARRAY_PREFIX),
      pool.toBuffer(),
      toI32Buffer(tickArrayIndex),
    ],
    programId,
  )[0];
}

export function derivePosition(
  nftMint: PublicKey,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POSITION_PREFIX), nftMint.toBuffer()],
    programId,
  )[0];
}

export function deriveLimitOrder(
  nftMint: PublicKey,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LIMIT_ORDER_PREFIX), nftMint.toBuffer()],
    programId,
  )[0];
}

export function assertRewardIndex(rewardIndex: number): void {
  if (
    !Number.isInteger(rewardIndex) ||
    rewardIndex < 0 ||
    rewardIndex >= NUM_REWARDS
  ) {
    throw PoolError.invalidRewardIndex();
  }
}

// `reward_index` is a u8 seed: one byte.
export function deriveRewardVault(
  pool: PublicKey,
  rewardIndex: number,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  assertRewardIndex(rewardIndex);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(REWARD_VAULT_PREFIX),
      pool.toBuffer(),
      Buffer.from([rewardIndex]),
    ],
    programId,
  )[0];
}
