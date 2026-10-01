import { PublicKey, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import {
  getActivationHandler,
  getBaseFeeHandler,
  getTokenProgram,
  calculateTransferFeeExcludedAmount,
  defaultDynamicPoolParameters,
  delegatePermissionMask,
  deriveStaticConfig,
  deriveTickArray,
  DlmmProClient,
  encodePoolExtensions,
  getLiquidityFromAmounts,
  liquidityBitmap,
  positionIndexesFromBitmap,
  PoolErrorCode,
  LIQUIDITY_HOOKS,
  remainingAccountsFromHooks,
  tickArrayRemainingAccounts,
  validateDynamicFeeParameters,
  validateInitializePoolWithDynamicParameters,
} from "../src";

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

  it("rejects hook slices the instruction does not accept", () => {
    const account = {
      pubkey: PublicKey.default,
      isSigner: false,
      isWritable: false,
    };
    expect(() =>
      remainingAccountsFromHooks(
        { transferHookReward: [account] },
        LIQUIDITY_HOOKS,
      ),
    ).toThrow(
      expect.objectContaining({
        code: PoolErrorCode.InvalidRemainingAccountSlice,
      }),
    );
    expect(
      remainingAccountsFromHooks({ transferHookReward: [] }, LIQUIDITY_HOOKS)
        .remainingAccounts,
    ).toEqual([]);
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

  it("rejects out-of-range dynamic fee fields", () => {
    expect(() =>
      validateDynamicFeeParameters({
        maxVolatilityAccumulator: -1,
        variableFeeControl: 0,
        filterPeriod: 1,
        decayPeriod: 2,
        reductionFactor: 1,
      }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
    expect(() =>
      validateDynamicFeeParameters({
        maxVolatilityAccumulator: 0,
        variableFeeControl: 0,
        filterPeriod: 1,
        decayPeriod: 0x1_0000,
        reductionFactor: 1,
      }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
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

  it("rejects negative unsigned instruction amounts before account loading", async () => {
    const client = DlmmProClient.create({} as Connection);
    await expect(
      client.pool.swap({
        pool: PublicKey.default,
        tokenXMint: PublicKey.default,
        tokenYMint: PublicKey.default,
        userTokenIn: PublicKey.default,
        userTokenOut: PublicKey.default,
        user: PublicKey.default,
        tickArrays: [],
        parameters: {
          inputAmount: new BN(-1),
          minimumOutputAmount: new BN(0),
        },
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.TypeCastFailed });
  });

  it("rejects values that would alias in PDA seeds or bitmasks", () => {
    expect(() => deriveStaticConfig(-1)).toThrow();
    expect(() => deriveStaticConfig(1.5)).toThrow();
    expect(() => deriveTickArray(PublicKey.default, Number.NaN)).toThrow();
    expect(() => delegatePermissionMask([32 as never])).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidPermission }),
    );
    expect(() => encodePoolExtensions([32 as never])).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
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

  it("validates dynamic-pool wire fields before fetching the clock", async () => {
    const invalidActivation = defaultDynamicPoolParameters(new BN(1).shln(64));
    invalidActivation.activationType = 255;
    await expect(
      validateInitializePoolWithDynamicParameters(
        {} as Connection,
        invalidActivation,
      ),
    ).rejects.toMatchObject({
      code: PoolErrorCode.InvalidActivationType,
    });

    const invalidSpacing = defaultDynamicPoolParameters(new BN(1).shln(64));
    invalidSpacing.tickSpacing = 1.5;
    await expect(
      validateInitializePoolWithDynamicParameters(
        {} as Connection,
        invalidSpacing,
      ),
    ).rejects.toMatchObject({
      code: PoolErrorCode.InvalidParameters,
    });
  });
});
