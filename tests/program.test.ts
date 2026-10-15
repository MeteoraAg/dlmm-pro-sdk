import { Connection, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  createDlmmProProgram,
  DLMM_PRO_PROGRAM_ID,
  derivePoolAuthority,
  DlmmProIDL,
} from "../src";

describe("createDlmmProProgram", () => {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  it("keeps the published program id", () => {
    const program = createDlmmProProgram(connection);
    expect(program.programId.equals(DLMM_PRO_PROGRAM_ID)).toBe(true);
  });

  it("points another deployment at its own pool authority", () => {
    const programId = PublicKey.unique();
    const program = createDlmmProProgram(connection, programId);
    const authority = derivePoolAuthority(programId).toBase58();
    const publishedAuthority =
      derivePoolAuthority(DLMM_PRO_PROGRAM_ID).toBase58();
    const text = JSON.stringify(program.idl);

    expect(program.programId.equals(programId)).toBe(true);
    expect(text).toContain(authority);
    expect(text.includes(publishedAuthority)).toBe(false);
    expect(DlmmProIDL.address).toBe(DLMM_PRO_PROGRAM_ID.toBase58());
    expect(JSON.stringify(DlmmProIDL)).toContain(publishedAuthority);
  });
});
