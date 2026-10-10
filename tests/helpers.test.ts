import { describe, expect, it } from "vitest";
import {
  LimitOrderDelegatePermission,
  limitOrderDelegatePermissionMask,
  MAX_TICK_ID,
  MAX_TICKS_PER_ARRAY,
  MIN_TICK_ID,
  PoolErrorCode,
  PositionDelegatePermission,
  positionDelegatePermissionMask,
  tickArrayCoversUsableTick,
  tickArrayTickRange,
} from "../src";

describe("delegate permission masks", () => {
  it("sets one bit per position permission", () => {
    expect(
      positionDelegatePermissionMask([
        PositionDelegatePermission.AddLiquidity,
        PositionDelegatePermission.UpdatePositionRange,
      ]),
    ).toBe(0b10001);
    expect(positionDelegatePermissionMask([])).toBe(0);
  });

  it("rejects bits outside each enum", () => {
    expect(() =>
      positionDelegatePermissionMask([
        (PositionDelegatePermission.UpdatePositionRange + 1) as never,
      ]),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidPermission }),
    );
    expect(
      limitOrderDelegatePermissionMask([
        LimitOrderDelegatePermission.CancelLimitOrder,
      ]),
    ).toBe(1);
    expect(() =>
      limitOrderDelegatePermissionMask([
        PositionDelegatePermission.RemoveLiquidity as never,
      ]),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidPermission }),
    );
  });
});

describe("tick array ranges", () => {
  const lastIndex = Math.floor(MAX_TICK_ID / MAX_TICKS_PER_ARRAY);

  it("spans MAX_TICKS_PER_ARRAY ticks from index times the array width", () => {
    expect(tickArrayTickRange(0, 1)).toEqual({
      minTickId: 0,
      maxTickId: MAX_TICKS_PER_ARRAY - 1,
    });
    expect(tickArrayTickRange(-1, 10)).toEqual({
      minTickId: -MAX_TICKS_PER_ARRAY * 10,
      maxTickId: -10,
    });
  });

  it("accepts an index only while one of its ticks is a usable tick id", () => {
    expect(tickArrayCoversUsableTick(lastIndex, 1)).toBe(true);
    expect(tickArrayCoversUsableTick(lastIndex + 1, 1)).toBe(false);
    expect(tickArrayCoversUsableTick(-lastIndex - 1, 1)).toBe(true);
    expect(tickArrayCoversUsableTick(-lastIndex - 2, 1)).toBe(false);
    expect(
      tickArrayCoversUsableTick(Math.floor(MIN_TICK_ID / 256 / 128), 256),
    ).toBe(true);
  });

  it("fails like safe_mul when the range leaves i32", () => {
    expect(() => tickArrayTickRange(0x7fffffff, 1)).toThrow(
      expect.objectContaining({ code: PoolErrorCode.MathOverflow }),
    );
    expect(() => tickArrayTickRange(0x7fffffff >> 7, 256)).toThrow(
      expect.objectContaining({ code: PoolErrorCode.MathOverflow }),
    );
  });
});
