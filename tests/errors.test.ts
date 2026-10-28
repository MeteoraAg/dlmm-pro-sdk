import { describe, expect, it } from "vitest";
import { DlmmProIDL, PoolError, PoolErrorCode } from "../src";

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
