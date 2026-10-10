import { describe, expect, it } from "vitest";
import {
  calculateTradingFeeNumerator,
  DlmmProIDL,
  MAX_FEE_NUMERATOR,
  PoolError,
  PoolErrorCode,
  validateDynamicFeeParameters,
  type DynamicFeeParameters,
} from "../src";

const QUOTE_TEST_DYNAMIC_FEE: DynamicFeeParameters = {
  maxVolatilityAccumulator: 350_000,
  variableFeeControl: 2_000_000,
  filterPeriod: 30,
  decayPeriod: 600,
  reductionFactor: 5_000,
  minDeltaTickForSignificantSwap: 4,
};

describe("PoolError", () => {
  const idlErrors = DlmmProIDL.errors;
  const codeNames = Object.keys(PoolErrorCode).filter((key) =>
    Number.isNaN(Number(key)),
  );

  it("mirrors the IDL error table one to one", () => {
    expect(idlErrors.length).toBeGreaterThan(0);
    for (const entry of idlErrors) {
      expect(PoolErrorCode[entry.name as keyof typeof PoolErrorCode]).toBe(
        entry.code,
      );
    }
    expect(codeNames.sort()).toEqual(
      idlErrors.map((entry) => entry.name).sort(),
    );
  });

  it("builds every static error with the IDL message", () => {
    const constructors = Object.getOwnPropertyNames(PoolError).filter(
      (name) =>
        typeof (PoolError as unknown as Record<string, unknown>)[name] ===
          "function" && name !== "prototype",
    );
    expect(constructors.length).toBeGreaterThan(0);
    for (const name of constructors) {
      const error = (PoolError as unknown as Record<string, () => PoolError>)[
        name
      ]();
      const entry = idlErrors.find(
        (candidate) => candidate.code === error.code,
      );
      expect(entry, name).toBeDefined();
      expect(error.message, name).toBe(entry!.msg);
      expect(error.name).toBe("PoolError");
    }
  });
});

describe("dynamic fee parameters", () => {
  it("accept the parameters the quote test trades with", () => {
    expect(() =>
      validateDynamicFeeParameters(QUOTE_TEST_DYNAMIC_FEE),
    ).not.toThrow();
  });

  it("reject a zero significant-swap threshold", () => {
    expect(() =>
      validateDynamicFeeParameters({
        ...QUOTE_TEST_DYNAMIC_FEE,
        minDeltaTickForSignificantSwap: 0,
      }),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });

  it("reject a variable fee that can exceed the fee cap", () => {
    const uncapped = {
      ...QUOTE_TEST_DYNAMIC_FEE,
      maxVolatilityAccumulator: 0xff_ffff,
      variableFeeControl: 0xff_ffff,
    };
    expect(
      calculateTradingFeeNumerator(
        uncapped.variableFeeControl,
        uncapped.maxVolatilityAccumulator,
      ).gt(MAX_FEE_NUMERATOR),
    ).toBe(true);
    expect(() => validateDynamicFeeParameters(uncapped)).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );
  });
});
