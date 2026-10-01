import { Program, type Provider } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import AccessRegistryIDL from "../idl/access-registry/access_registry.json";
import type { AccessRegistry } from "../idl/access-registry/access_registry";
import DlmmProIDL from "../idl/dlmm-pro/dlmm_pro.json";
import type { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";

function readOnlyProvider(connection: Connection): Provider {
  return { connection };
}

export function createDlmmProProgram(connection: Connection): Program<DlmmPro> {
  return new Program<DlmmPro>(DlmmProIDL, readOnlyProvider(connection));
}

export function createAccessRegistryProgram(
  connection: Connection,
): Program<AccessRegistry> {
  return new Program<AccessRegistry>(
    AccessRegistryIDL,
    readOnlyProvider(connection),
  );
}
