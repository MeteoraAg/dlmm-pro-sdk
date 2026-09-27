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
  PROTOCOL_FEE_AUTHORITY_PREFIX,
  PROTOCOL_FEE_PROGRAM_ID,
  POSITION_PREFIX,
  RESERVE_PREFIX,
  REWARD_VAULT_PREFIX,
  STATIC_CONFIG_PREFIX,
  TICK_ARRAY_BITMAP_EXTENSION_PREFIX,
  TICK_ARRAY_PREFIX,
  TOKEN_BADGE_PREFIX,
} from "../constants";
import { PoolError } from "../errors";

function toU64Buffer(index: BN | number): Buffer {
  if (
    typeof index === "number" &&
    (!Number.isSafeInteger(index) || index < 0)
  ) {
    throw PoolError.invalidParameters();
  }
  const value = new BN(index);
  if (value.isNeg() || value.bitLength() > 64) {
    throw PoolError.invalidParameters();
  }
  return value.toArrayLike(Buffer, "le", 8);
}

function toI32Buffer(index: number): Buffer {
  if (!Number.isInteger(index) || index < -0x80000000 || index > 0x7fffffff) {
    throw PoolError.invalidParameters();
  }
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(index, 0);
  return buf;
}

// Lexicographic max/min of two pubkeys
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

/** PDA of the external protocol-fee program. It is the `claim_protocol_fee2` signer. */
export function deriveProtocolFeeAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PROTOCOL_FEE_AUTHORITY_PREFIX)],
    PROTOCOL_FEE_PROGRAM_ID,
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

// Both programs use the same seeds, so the operator registries only differ by
// program id — dlmm-pro and access-registry permissions are not interchangeable.
export function deriveAccessRegistryOperator(
  whitelistedAddress: PublicKey,
): PublicKey {
  return deriveOperator(whitelistedAddress, ACCESS_REGISTRY_PROGRAM_ID);
}

export function deriveStaticConfig(
  index: BN | number,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(STATIC_CONFIG_PREFIX), toU64Buffer(index)],
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
      toU64Buffer(index),
    ],
    programId,
  )[0];
}

// TokenBadge lives in the external access-registry program, not dlmm-pro
export function deriveTokenBadge(
  tokenMint: PublicKey,
  programId: PublicKey = ACCESS_REGISTRY_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TOKEN_BADGE_PREFIX), tokenMint.toBuffer()],
    programId,
  )[0];
}

// Static/dynamic config pool: `["pool", config, max(mintX,mintY), min(mintX,mintY)]`
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

// Launch pool: `["l_pool", max(mintX,mintY), min(mintX,mintY)]`
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
  return deriveTickArrayWithBump(pool, tickArrayIndex, programId)[0];
}

export function deriveTickArrayWithBump(
  pool: PublicKey,
  tickArrayIndex: number,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(TICK_ARRAY_PREFIX),
      pool.toBuffer(),
      toI32Buffer(tickArrayIndex),
    ],
    programId,
  );
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

// Reward vault PDA — `reward_index` is `u8` on-chain (`to_le_bytes()` = 1 byte)
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
