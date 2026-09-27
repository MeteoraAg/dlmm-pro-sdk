import type { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  type Commitment,
  type Connection,
} from "@solana/web3.js";
import { ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT } from "../constants";
import { PoolError } from "../errors";
import { createAccessRegistryProgram } from "../helpers/create_program";
import {
  deriveAccessRegistryOperator,
  deriveTokenBadge,
  permissionBitmask,
} from "../helpers";
import { assertU8 } from "../helpers/validation";
import type { AccessRegistry } from "../idl/access-registry/access_registry";
import type {
  AccessRegistryOperator,
  AccessRegistryOperatorPermission,
  TokenBadge,
} from "../types";

/**
 * Read access to the access-registry program
 * (`regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr`), which owns the TokenBadge
 * accounts dlmm-pro reads to authorize unsupported mints. The native-SOL and
 * USDC whitelist is a separate requirement for pools using the OnlyY rule.
 * Badge and operator accounts are created by the registry admin and operators.
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

  async fetchOperator(operator: PublicKey): Promise<AccessRegistryOperator> {
    return this.fetchAccount(operator, "operator");
  }

  async createOperatorAccount(params: {
    whitelistedAddress: PublicKey;
    signer: PublicKey;
    payer: PublicKey;
    permissions: readonly AccessRegistryOperatorPermission[];
  }): Promise<{ tx: Transaction; operator: PublicKey }> {
    const permission = permissionBitmask(
      params.permissions,
      ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT,
    );
    if (permission.isZero()) {
      throw PoolError.invalidPermission();
    }
    const operator = deriveAccessRegistryOperator(params.whitelistedAddress);
    const tx = await this.program.methods
      .createOperatorAccount(permission)
      .accountsPartial({
        operator,
        whitelistedAddress: params.whitelistedAddress,
        signer: params.signer,
        payer: params.payer,
      })
      .transaction();
    tx.feePayer = params.payer;
    return { tx, operator };
  }

  async closeOperatorAccount(params: {
    operator: PublicKey;
    signer: PublicKey;
    rentReceiver: PublicKey;
  }): Promise<{ tx: Transaction }> {
    const tx = await this.program.methods
      .closeOperatorAccount()
      .accountsPartial({
        operator: params.operator,
        signer: params.signer,
        rentReceiver: params.rentReceiver,
      })
      .transaction();
    tx.feePayer = params.signer;
    return { tx };
  }

  async createTokenBadge(params: {
    tokenMint: PublicKey;
    signer: PublicKey;
    payer: PublicKey;
    mintScore?: number;
  }): Promise<{ tx: Transaction; tokenBadge: PublicKey }> {
    const mintScore = params.mintScore ?? 0;
    assertU8(mintScore);
    const tokenBadge = deriveTokenBadge(params.tokenMint);
    const tx = await this.program.methods
      .createTokenBadge(mintScore)
      .accountsPartial({
        tokenBadge,
        tokenMint: params.tokenMint,
        operator: deriveAccessRegistryOperator(params.signer),
        signer: params.signer,
        payer: params.payer,
      })
      .transaction();
    tx.feePayer = params.payer;
    return { tx, tokenBadge };
  }

  async closeTokenBadge(params: {
    tokenBadge: PublicKey;
    signer: PublicKey;
    rentReceiver: PublicKey;
  }): Promise<{ tx: Transaction }> {
    if (params.tokenBadge.equals(PublicKey.default)) {
      throw PoolError.invalidAccount();
    }
    const tx = await this.program.methods
      .closeTokenBadge()
      .accountsPartial({
        tokenBadge: params.tokenBadge,
        operator: deriveAccessRegistryOperator(params.signer),
        signer: params.signer,
        rentReceiver: params.rentReceiver,
      })
      .transaction();
    tx.feePayer = params.signer;
    return { tx };
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
