import type BN from "bn.js";

export function big(value: BN): bigint {
  return BigInt(value.toString());
}
