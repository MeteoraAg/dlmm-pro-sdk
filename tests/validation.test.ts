import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import {
  ActivationMode,
  calculateTransferFeeExcludedAmount,
  deriveStaticConfig,
  deriveTickArray,
  encodePoolExtensions,
  getLiquidityFromAmounts,
  getTokenProgram,
  liquidityBitmap,
  PoolErrorCode,
  positionIndexesFromBitmap,
} from "../src";
import { validateDynamicFeeParameters } from "../src/helpers/pool_fees";
import {
  bondingCurveActivationParameters,
  encodeBondingCurveActivationData,
  getActivationHandler,
  openActivationParameters,
  timeBasedActivationParameters,
} from "../src/activation";
import { getBaseFeeHandler } from "../src/base_fee";
import { remainingAccountsFromHooks } from "../src/helpers/remaining_accounts";
import { tickArrayRemainingAccounts } from "../src/helpers/tick_array";
import { DYNAMIC_FEE_PARAMETERS } from "./helpers";

describe("client-side validation", () => {
  it("rejects remaining-account slices that cannot fit in u8", () => {
    const account = {
      pubkey: PublicKey.default,
      isSigner: false,
      isWritable: false,
    };
    expect(() =>
      remainingAccountsFromHooks({
        transferHookX: Array.from({ length: 256 }, () => account),
      }),
    ).toThrow(
      expect.objectContaining({
        code: PoolErrorCode.InvalidRemainingAccountSlice,
      }),
    );
  });

  it("limits liquidity bitmaps to position slots supported by the program", () => {
    expect(liquidityBitmap([0, 44]).toString(2)).toBe(
      `${"1".padEnd(44, "0")}1`,
    );
    expect(positionIndexesFromBitmap(liquidityBitmap([0, 2, 44]))).toEqual([
      0, 2, 44,
    ]);
    expect(() => liquidityBitmap([])).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
    expect(() => liquidityBitmap([45])).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
    expect(() => liquidityBitmap([1.5])).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });

  it("rejects invalid position ranges", () => {
    expect(() =>
      tickArrayRemainingAccounts(PublicKey.default, [], 1),
    ).toThrow();
    expect(() =>
      tickArrayRemainingAccounts(
        PublicKey.default,
        [{ tickLowerId: 1, tickUpperId: -1 }],
        1,
      ),
    ).toThrow();
    expect(() =>
      tickArrayRemainingAccounts(
        PublicKey.default,
        [{ tickLowerId: 1, tickUpperId: 10 }],
        10,
      ),
    ).toThrow();
  });

  it("rejects dynamic fee parameters the program would refuse", () => {
    expect(() =>
      validateDynamicFeeParameters(DYNAMIC_FEE_PARAMETERS),
    ).not.toThrow();
    for (const overrides of [
      { maxVolatilityAccumulator: -1 },
      { decayPeriod: 0x1_0000 },
      { minDeltaTickForSignificantSwap: 0 },
      // The variable fee at the accumulator cap would exceed MAX_FEE_NUMERATOR.
      { maxVolatilityAccumulator: 0xff_ffff, variableFeeControl: 0xff_ffff },
    ]) {
      expect(() =>
        validateDynamicFeeParameters({
          ...DYNAMIC_FEE_PARAMETERS,
          ...overrides,
        }),
      ).toThrow(
        expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
      );
    }
  });

  it("uses the program's domain errors for invalid mode discriminants", () => {
    expect(() =>
      getBaseFeeHandler({ baseFeeMode: 255, data: Array(31).fill(0) }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidBaseFeeMode }),
    );
    expect(() =>
      getActivationHandler({ activationMode: 255, data: Array(15).fill(0) }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidActivationAccess }),
    );
  });

  it("rejects unknown token program flags", () => {
    expect(() => getTokenProgram(255)).toThrow(
      expect.objectContaining({ code: PoolErrorCode.TypeCastFailed }),
    );
  });

  it("rejects transfer-fee inputs outside on-chain integer ranges", () => {
    expect(() =>
      calculateTransferFeeExcludedAmount(null, 0n, new BN(-1)),
    ).toThrow(expect.objectContaining({ code: PoolErrorCode.TypeCastFailed }));
    expect(() =>
      calculateTransferFeeExcludedAmount(null, -1n, new BN(1)),
    ).toThrow(expect.objectContaining({ code: PoolErrorCode.TypeCastFailed }));
  });

  it("rejects values that would alias in PDA seeds or the extension bitmask", () => {
    expect(() => deriveStaticConfig(-1)).toThrow();
    expect(() => deriveStaticConfig(1.5)).toThrow();
    expect(() => deriveTickArray(PublicKey.default, Number.NaN)).toThrow();
    expect(() => encodePoolExtensions([32 as never])).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });

  it("gates each activation action on the program's predicate", () => {
    const timeBased = getActivationHandler(
      timeBasedActivationParameters({
        swapPoint: new BN(60),
        addLiquidityPoint: new BN(30),
        removeLiquidityPoint: new BN(90),
      }),
    );
    expect(timeBased.canAddLiquidity(new BN(29))).toBe(false);
    expect(timeBased.canAddLiquidity(new BN(30))).toBe(true);
    expect(timeBased.canSwap(new BN(30))).toBe(false);
    expect(timeBased.canSwap(new BN(60))).toBe(true);
    expect(timeBased.canRemoveLiquidity(new BN(60))).toBe(false);
    expect(timeBased.canRemoveLiquidity(new BN(90))).toBe(true);

    const open = getActivationHandler(openActivationParameters());
    expect(open.canSwap(new BN(0))).toBe(true);
    expect(open.canAddLiquidity(new BN(0))).toBe(true);
    expect(open.canRemoveLiquidity(new BN(0))).toBe(true);

    const belowTarget = getActivationHandler(
      bondingCurveActivationParameters({ targetIncreaseBps: 20_000 }),
    );
    expect(belowTarget.canSwap(new BN(0))).toBe(true);
    expect(belowTarget.canAddLiquidity(new BN(0))).toBe(false);
    expect(belowTarget.canRemoveLiquidity(new BN(0))).toBe(false);

    const data = encodeBondingCurveActivationData({
      targetIncreaseBps: 20_000,
    });
    data[0] = 1;
    const reachedTarget = getActivationHandler({
      activationMode: ActivationMode.BondingCurve,
      data,
    });
    expect(reachedTarget.canAddLiquidity(new BN(0))).toBe(true);
    expect(reachedTarget.canRemoveLiquidity(new BN(0))).toBe(true);
  });

  it("uses LiquidityIsZero for empty token budgets", () => {
    expect(() =>
      getLiquidityFromAmounts({
        maxTokenX: new BN(0),
        maxTokenY: new BN(0),
        tickLowerId: -1,
        tickUpperId: 1,
        tickCurrentId: 0,
        currentSqrtPrice: new BN(1).shln(64),
      }),
    ).toThrow(expect.objectContaining({ code: PoolErrorCode.LiquidityIsZero }));
  });
});
