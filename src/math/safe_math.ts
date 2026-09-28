import BN from "bn.js";
import { PoolError } from "../errors";
import {
  ActivationMode,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
} from "../types";

export const U16_MAX = new BN("65535");
export const U32_MAX = new BN("4294967295");
export const U64_MAX = new BN("18446744073709551615");
export const U128_MAX = new BN("340282366920938463463374607431768211455");
export const U192_MAX = new BN(1).shln(192).subn(1);
export const U256_MAX = new BN(1).shln(256).subn(1);
export const U320_MAX = new BN(1).shln(320).subn(1);

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
export const I128_MAX = new BN(1).shln(127).subn(1);

function assertUnsigned(value: BN, max: BN): BN {
  if (value.isNeg() || value.gt(max)) {
    throw PoolError.mathOverflow();
  }
  return value;
}

export function safeAdd(lhs: BN, rhs: BN, max: BN): BN {
  return assertUnsigned(lhs.add(rhs), max);
}

export function safeSub(lhs: BN, rhs: BN, max: BN): BN {
  return assertUnsigned(lhs.sub(rhs), max);
}

export function safeMul(lhs: BN, rhs: BN, max: BN): BN {
  return assertUnsigned(lhs.mul(rhs), max);
}

export function safeDiv(lhs: BN, rhs: BN, max: BN): BN {
  if (rhs.isZero()) {
    throw PoolError.mathOverflow();
  }
  return assertUnsigned(lhs.div(rhs), max);
}

export function safeShl(lhs: BN, offset: number, max: BN): BN {
  const width = max.bitLength();
  if (offset < 0 || offset >= width) {
    throw PoolError.mathOverflow();
  }
  return wrappingShl(lhs, offset, max);
}

export function wrappingShl(value: BN, offset: number, max: BN): BN {
  const width = max.bitLength();
  if (offset >= width) {
    return new BN(0);
  }
  return value.shln(offset).and(max);
}

export function wrappingAdd(lhs: BN, rhs: BN, max: BN): BN {
  return lhs.add(rhs).and(max);
}

export function wrappingSub(lhs: BN, rhs: BN, max: BN): BN {
  return lhs.sub(rhs).umod(max.addn(1));
}

export function overflowingAdd(
  lhs: BN,
  rhs: BN,
  max: BN,
): { result: BN; overflow: boolean } {
  const sum = lhs.add(rhs);
  if (sum.gt(max)) {
    return { result: sum.and(max), overflow: true };
  }
  return { result: sum, overflow: false };
}

export function downScaleCeil(value: BN, shift: number): BN {
  const quotient = value.shrn(shift);
  // Any set bit below shift means a non zero remainder.
  if (value.zeroBits() < shift && !value.isZero()) {
    return quotient.addn(1);
  }
  return quotient;
}

export function divCeil(lhs: BN, rhs: BN): BN {
  if (rhs.isZero()) {
    throw PoolError.mathOverflow();
  }
  const { div, mod } = lhs.divmod(rhs);
  if (!mod.isZero()) {
    return div.addn(1);
  }
  return div;
}

export function checkedMul(lhs: BN, rhs: BN, max: BN): BN | null {
  const product = lhs.mul(rhs);
  if (product.isNeg() || product.gt(max)) {
    return null;
  }
  return product;
}

export function checkedDiv(lhs: BN, rhs: BN, max: BN): BN | null {
  if (rhs.isZero()) {
    return null;
  }
  const result = lhs.div(rhs);
  if (result.isNeg() || result.gt(max)) {
    return null;
  }
  return result;
}

export function tryCastU16(value: BN): number {
  if (value.isNeg() || value.gt(U16_MAX)) {
    throw PoolError.typeCastFailed();
  }
  return value.toNumber();
}

export function tryCastU32(value: BN): number {
  if (value.isNeg() || value.gt(U32_MAX)) {
    throw PoolError.typeCastFailed();
  }
  return value.toNumber();
}

export function tryCastU64(value: BN): BN {
  if (value.isNeg() || value.gt(U64_MAX)) {
    throw PoolError.typeCastFailed();
  }
  return value;
}

export function tryCastU128(value: BN): BN {
  if (value.isNeg() || value.gt(U128_MAX)) {
    throw PoolError.typeCastFailed();
  }
  return value;
}

export function tryCastI32(value: bigint): number {
  if (value < BigInt(I32_MIN) || value > BigInt(I32_MAX)) {
    throw PoolError.typeCastFailed();
  }
  return Number(value);
}

export function tryCastCollectFeeMode(value: number): CollectFeeMode {
  if (value === CollectFeeMode.OutputToken || value === CollectFeeMode.OnlyY) {
    return value;
  }
  throw PoolError.typeCastFailed();
}

export function tryCastActivationType(value: number): ActivationType {
  if (value === ActivationType.Slot || value === ActivationType.Timestamp) {
    return value;
  }
  throw PoolError.typeCastFailed();
}

export function tryCastActivationMode(value: number): ActivationMode {
  switch (value) {
    case ActivationMode.Open:
    case ActivationMode.BondingCurve:
    case ActivationMode.TimeBased:
      return value;
    default:
      throw PoolError.invalidActivationAccess();
  }
}

export function tryCastBaseFeeMode(value: number): BaseFeeMode {
  switch (value) {
    case BaseFeeMode.Fixed:
    case BaseFeeMode.TimeSchedulerLinear:
    case BaseFeeMode.TimeSchedulerExponential:
    case BaseFeeMode.MarketCapSchedulerLinear:
    case BaseFeeMode.MarketCapSchedulerExponential:
      return value;
    default:
      throw PoolError.typeCastFailed();
  }
}

export function leadingZerosU128(value: BN): number {
  if (value.isZero()) {
    return 128;
  }
  return 128 - value.bitLength();
}

export function lowU64(value: BN): BN {
  return value.and(U64_MAX);
}

export function highU64(value: BN): BN {
  return value.shrn(64);
}

export function toBigInt(value: BN): bigint {
  // Byte conversion avoids bn.js base-10 `toString`, which can append `NaN`
  // on the linux-x64 build used in CI.
  let result = 0n;
  for (const byte of value.toArray("be")) {
    result = (result << 8n) + BigInt(byte);
  }
  return value.isNeg() ? -result : result;
}
