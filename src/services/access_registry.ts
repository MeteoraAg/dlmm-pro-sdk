import type { Program } from "@coral-xyz/anchor";
import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";
import { createAccessRegistryProgram } from "../helpers/create_program";
import type { AccessRegistry } from "../idl/access-registry/access_registry";
import type { TokenBadge } from "../types";

export class AccessRegistryService {
  private readonly program: Program<AccessRegistry>;
  private readonly commitment: Commitment;
  private readonly connection: Connection;

  constructor(connection: Connection, commitment: Commitment) {
    this.program = createAccessRegistryProgram(connection);
    this.commitment = commitment;
    this.connection = connection;
  }

  async fetchTokenBadge(tokenBadge: PublicKey): Promise<TokenBadge> {
    return this.fetchAccount(tokenBadge, "tokenBadge");
  }

  private async fetchAccount<T>(
    address: PublicKey,
    accountName: string,
  ): Promise<T> {
    const info = await this.connection.getAccountInfo(address, this.commitment);
    if (!info) {
      throw new Error(`Account not found: ${address.toBase58()}`);
    }
    if (!info.owner.equals(this.program.programId)) {
      throw new Error(
        `Account ${address.toBase58()} is not owned by the access-registry program`,
      );
    }
    return this.program.coder.accounts.decode<T>(accountName, info.data);
  }
}
