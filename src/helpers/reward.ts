import BN from "bn.js";
import {
  downScaleCeil,
  safeMul,
  tryCastU64,
  tryCastU128,
  U192_MAX,
} from "../math";
import { Rounding } from "../types";

export function calculateRewardAmount(
  timeDelta: BN,
  emissionPerSecond: BN,
  rounding: Rounding,
): BN {
  tryCastU64(timeDelta);
  tryCastU128(emissionPerSecond);
  const prod = safeMul(timeDelta, emissionPerSecond, U192_MAX);
  const scaled =
    rounding === Rounding.Up ? downScaleCeil(prod, 64) : prod.shrn(64);
  return tryCastU64(scaled);
}
