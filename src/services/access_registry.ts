import type { Program } from "@coral-xyz/anchor";
import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";
import { createAccessRegistryProgram } from "../helpers/create_program";
import type { AccessRegistry } from "../idl/access-registry/access_registry";
import type { TokenBadge } from "../types";

/**
 * Read access to token badges in the access-registry program
 * (`regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr`). dlmm-pro reads those
 * accounts to authorize unsupported mints. The native-SOL and USDC whitelist
 * is a separate requirement for pools using the OnlyY rule. Creating and
 * closing badges and registry operators is not part of this client.
 */
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
