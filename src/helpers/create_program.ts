import { Program, type Provider } from "@coral-xyz/anchor";
import { PublicKey, type Connection } from "@solana/web3.js";
import { DLMM_PRO_PROGRAM_ID } from "../constants";
import { derivePoolAuthority } from "./pda";
import AccessRegistryIDL from "../idl/access-registry/access_registry.json";
import type { AccessRegistry } from "../idl/access-registry/access_registry";
import DlmmProIDL from "../idl/dlmm-pro/dlmm_pro.json";
import type { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";

type IdlAccount = {
  address?: string;
  accounts?: IdlAccount[];
};

function readOnlyProvider(connection: Connection): Provider {
  return { connection };
}

export function createDlmmProProgram(
  connection: Connection,
  programId: PublicKey = DLMM_PRO_PROGRAM_ID,
): Program<DlmmPro> {
  const idl = programId.equals(DLMM_PRO_PROGRAM_ID)
    ? DlmmProIDL
    : idlForProgram(programId);
  return new Program<DlmmPro>(idl, readOnlyProvider(connection));
}

function idlForProgram(programId: PublicKey): typeof DlmmProIDL {
  const publishedAuthority = derivePoolAuthority(
    new PublicKey(DlmmProIDL.address),
  ).toBase58();
  const authority = derivePoolAuthority(programId).toBase58();
  const idl = structuredClone(DlmmProIDL);
  idl.address = programId.toBase58();
  for (const instruction of idl.instructions) {
    retargetAuthority(
      instruction.accounts as IdlAccount[],
      publishedAuthority,
      authority,
    );
  }
  return idl;
}

function retargetAuthority(
  accounts: IdlAccount[],
  from: string,
  to: string,
): void {
  for (const account of accounts) {
    if (account.address === from) {
      account.address = to;
    }
    if (account.accounts) {
      retargetAuthority(account.accounts, from, to);
    }
  }
}

export function createAccessRegistryProgram(
  connection: Connection,
): Program<AccessRegistry> {
  return new Program<AccessRegistry>(
    AccessRegistryIDL,
    readOnlyProvider(connection),
  );
}
