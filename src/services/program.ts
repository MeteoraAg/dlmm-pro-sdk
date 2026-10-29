import type { Program } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import type {
  AccountMeta,
  Commitment,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import type BN from "bn.js";
import type { DlmmProClientContext } from "../dlmm_pro";
import {
  derivePoolAuthority,
  derivePosition,
  deriveReserve,
  isNativeSol,
  readTokenAccountMint,
  resolveTokenProgram,
  tickArrayRemainingAccounts,
  unwrapSOLInstruction,
  wrapSOLInstruction,
  type TransferHookLeg,
} from "../helpers";
import type { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";
import type { TickRange } from "../types";
import type { StateService } from "./state";

export class DlmmProProgram {
  protected readonly program: Program<DlmmPro>;
  protected readonly connection: Connection;
  protected readonly commitment: Commitment;
  protected readonly state: StateService;

  protected get programId(): PublicKey {
    return this.program.programId;
  }

  constructor(client: DlmmProClientContext) {
    this.program = client.program;
    this.connection = client.connection;
    this.commitment = client.commitment;
    this.state = client.state;
  }

  /**
   * Resolves each token to `account`, or to the owner's associated token
   * account. Associated token accounts are created when missing. Native SOL in
   * the owner's wrapped SOL account is topped up to `wrapAmount` before and
   * closed after, both of which need the owner to sign.
   */
  protected async prepareTokenAccounts(params: {
    payer: PublicKey;
    owner: PublicKey;
    /** Defaults to true; a delegate withdrawing to the owner leaves wrapped SOL in place. */
    ownerSigns?: boolean;
    tokens: readonly {
      mint: PublicKey;
      tokenProgram: PublicKey;
      account?: PublicKey;
      wrapAmount?: BN | null;
    }[];
  }): Promise<{
    accounts: PublicKey[];
    preInstructions: TransactionInstruction[];
    postInstructions: TransactionInstruction[];
  }> {
    const tokens = params.tokens.map((token) => {
      const ata = getAssociatedTokenAddressSync(
        token.mint,
        params.owner,
        true,
        token.tokenProgram,
      );
      const account = token.account ?? ata;
      return { ...token, account, isAta: account.equals(ata) };
    });
    const atas = tokens.filter((token) => token.isAta);
    const ataInfos =
      atas.length === 0
        ? []
        : await this.connection.getMultipleAccountsInfo(
            atas.map((token) => token.account),
            this.commitment,
          );

    const preInstructions: TransactionInstruction[] = [];
    const postInstructions: TransactionInstruction[] = [];
    atas.forEach((token, index) => {
      const info = ataInfos[index];
      if (!info) {
        preInstructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            params.payer,
            token.account,
            params.owner,
            token.mint,
            token.tokenProgram,
          ),
        );
      }
      if (!isNativeSol(token.mint) || params.ownerSigns === false) {
        return;
      }
      const balance = info
        ? unpackAccount(token.account, info, token.tokenProgram).amount
        : 0n;
      const wanted = BigInt(token.wrapAmount?.toString() ?? 0);
      if (wanted > balance) {
        preInstructions.push(
          ...wrapSOLInstruction(params.owner, token.account, wanted - balance),
        );
      }
      postInstructions.push(unwrapSOLInstruction(params.owner));
    });
    return {
      accounts: tokens.map((token) => token.account),
      preInstructions,
      postInstructions,
    };
  }

  protected async tokenProgramFor(
    mint: PublicKey,
    explicit?: PublicKey,
  ): Promise<PublicKey> {
    return (
      explicit ?? resolveTokenProgram(this.connection, mint, this.commitment)
    );
  }

  protected async referralHook(
    pool: PublicKey,
    referral: PublicKey | null | undefined,
    metas: AccountMeta[] | undefined,
  ): Promise<{ metas?: AccountMeta[]; leg?: TransferHookLeg }> {
    if (!referral || metas !== undefined) {
      return { metas };
    }
    const mint = await readTokenAccountMint(
      this.connection,
      referral,
      this.commitment,
    );
    return {
      leg: {
        mint,
        source: deriveReserve(mint, pool, this.programId),
        destination: referral,
        authority: derivePoolAuthority(this.programId),
      },
    };
  }

  protected refreshFeesAndRewardsIx(params: {
    pool: PublicKey;
    nftMint: PublicKey;
    nftAccount: PublicKey;
    signer: PublicKey;
    bitmap: BN;
    tickRanges: TickRange[];
    tickSpacing: number;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .refreshFeesAndRewards(params.bitmap)
      .accountsPartial({
        pool: params.pool,
        position: derivePosition(params.nftMint, this.programId),
        nftAccount: params.nftAccount,
        signer: params.signer,
      })
      .remainingAccounts(
        // Slots without liquidity are skipped before their ticks are read.
        params.tickRanges.length === 0
          ? []
          : tickArrayRemainingAccounts(
              params.pool,
              params.tickRanges,
              params.tickSpacing,
              false,
              this.programId,
            ),
      )
      .instruction();
  }
}
