import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  delegatePermissionMask,
  deriveProtocolFeeAuthority,
  deriveStaticConfig,
  deriveTickArray,
  encodePoolExtensions,
  PoolErrorCode,
} from "../src";

describe("client-side validation", () => {
  it("derives the protocol-fee authority the claim instruction hardcodes", () => {
    expect(deriveProtocolFeeAuthority().toBase58()).toBe(
      "FkU5rQCWQM131skHCpcEbK8P1JrQGsBgqXe55w525SSF",
    );
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
});
