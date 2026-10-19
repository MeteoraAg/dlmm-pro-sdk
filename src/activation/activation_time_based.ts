import BN from "bn.js";
import { MAX_SLOT_BUFFER, MAX_TIME_BUFFER } from "../constants";
import { PoolError } from "../errors";
import { toPodBuffer } from "../helpers/pod";
import { safeAdd, U64_MAX } from "../math/safe_math";
import {
  ActivationMode,
  ActivationType,
  type PoolActivationInfoParameters,
} from "../types";
import type { ActivationInitializeContext } from ".";

export type PodAlignedActivationTimeBased = {
  activationMode: number;
  swapPoint: BN;
  addLiquidityPoint: BN;
  removeLiquidityPoint: BN;
};

function readZ40(data: Buffer, offset: number): BN {
  const buf = Buffer.alloc(8);
  data.copy(buf, 0, offset, offset + 5);
  return new BN(buf, "le");
}

function writeZ40(buf: Buffer, offset: number, value: BN): void {
  if (value.isNeg() || value.bitLength() > 40) {
    throw PoolError.invalidParameters("value must fit in 40 bits");
  }
  buf.set(value.toArrayLike(Buffer, "le", 5), offset);
}

export function decodePodAlignedActivationTimeBased(
  info: PoolActivationInfoParameters,
): PodAlignedActivationTimeBased {
  const data = toPodBuffer(info.data, 15);
  return {
    activationMode: info.activationMode,
    swapPoint: readZ40(data, 0),
    addLiquidityPoint: readZ40(data, 5),
    removeLiquidityPoint: readZ40(data, 10),
  };
}

export type TimeBasedActivationParams = {
  swapPoint: BN;
  addLiquidityPoint: BN;
  removeLiquidityPoint: BN;
};

export function encodeTimeBasedActivationData(
  params: TimeBasedActivationParams,
): number[] {
  const buf = Buffer.alloc(15, 0);
  writeZ40(buf, 0, params.swapPoint);
  writeZ40(buf, 5, params.addLiquidityPoint);
  writeZ40(buf, 10, params.removeLiquidityPoint);
  return Array.from(buf);
}

export class ActivationTimeBasedHandler {
  readonly inner: PodAlignedActivationTimeBased;

  constructor(inner: PodAlignedActivationTimeBased) {
    this.inner = inner;
  }

  static fromPoolActivationInfo(
    info: PoolActivationInfoParameters,
  ): ActivationTimeBasedHandler {
    return new ActivationTimeBasedHandler(
      decodePodAlignedActivationTimeBased(info),
    );
  }

  validateInitialize({
    activationPoint,
    currentPoint,
    activationType,
  }: ActivationInitializeContext): void {
    const farthestFuture = safeAdd(
      currentPoint,
      new BN(
        activationType === ActivationType.Slot
          ? MAX_SLOT_BUFFER
          : MAX_TIME_BUFFER,
      ),
      U64_MAX,
    );

    if (!activationPoint.eq(this.inner.swapPoint)) {
      throw PoolError.invalidParameters("activationPoint must equal swapPoint");
    }

    if (
      currentPoint.gt(this.inner.swapPoint) ||
      currentPoint.gt(this.inner.addLiquidityPoint) ||
      currentPoint.gt(this.inner.removeLiquidityPoint)
    ) {
      throw PoolError.invalidParameters(
        "swapPoint, addLiquidityPoint and removeLiquidityPoint must not be before currentPoint",
      );
    }

    if (
      farthestFuture.lt(this.inner.swapPoint) ||
      farthestFuture.lt(this.inner.addLiquidityPoint) ||
      farthestFuture.lt(this.inner.removeLiquidityPoint)
    ) {
      throw PoolError.invalidParameters(
        "swapPoint, addLiquidityPoint and removeLiquidityPoint must be at most MAX_TIME_BUFFER or MAX_SLOT_BUFFER after currentPoint",
      );
    }
  }

  canSwap(currentPoint: BN): boolean {
    return currentPoint.gte(this.inner.swapPoint);
  }
}

export function timeBasedActivationParameters(
  params: TimeBasedActivationParams,
): PoolActivationInfoParameters {
  return {
    activationMode: ActivationMode.TimeBased,
    data: encodeTimeBasedActivationData(params),
  };
}
