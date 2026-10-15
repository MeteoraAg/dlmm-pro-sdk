import {
  ExtensionType,
  ExtraAccountMetaAccountDataLayout,
  ExtraAccountMetaLayout,
  getExtraAccountMetaAddress,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { getExtraAccountMetasForTransferHook } from "../src";
import {
  createAndFundWallet,
  createSvmConnection,
  createToken,
  createToken2022Mint,
  initializeSVM,
} from "./helpers";

describe("transfer hook metas", () => {
  it("returns no metas for a mint without a hook", async () => {
    const svm = initializeSVM();
    const connection = createSvmConnection(svm);
    const payer = createAndFundWallet(svm);
    const metas = await getExtraAccountMetasForTransferHook(connection, {
      mint: createToken(svm, payer),
      source: payer.publicKey,
      destination: payer.publicKey,
      authority: payer.publicKey,
    });
    expect(metas).toEqual([]);
  });

  it("resolves a hook mint's extra account metas", async () => {
    const svm = initializeSVM();
    const connection = createSvmConnection(svm);
    const payer = createAndFundWallet(svm);
    const hookProgram = PublicKey.unique();
    const mint = createToken2022Mint(svm, payer, [
      { type: ExtensionType.TransferHook, programId: hookProgram },
    ]);
    const extraAccount = PublicKey.unique();
    const validation = getExtraAccountMetaAddress(mint, hookProgram);
    // A u32 count and one meta, after the u64 discriminator and u32 length.
    const length = 4 + ExtraAccountMetaLayout.span;
    const data = Buffer.alloc(8 + 4 + length);
    ExtraAccountMetaAccountDataLayout.encode(
      {
        instructionDiscriminator: 0n,
        length,
        extraAccountsList: {
          count: 1,
          extraAccounts: [
            {
              discriminator: 0,
              addressConfig: extraAccount.toBuffer(),
              isSigner: false,
              isWritable: false,
            },
          ],
        },
      },
      data,
    );
    svm.setAccount(validation, {
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      data,
      owner: hookProgram,
      executable: false,
    });

    const metas = await getExtraAccountMetasForTransferHook(connection, {
      mint,
      source: payer.publicKey,
      destination: payer.publicKey,
      authority: payer.publicKey,
    });
    expect(metas.map((meta) => meta.pubkey.toBase58())).toEqual([
      extraAccount.toBase58(),
      hookProgram.toBase58(),
      validation.toBase58(),
    ]);
  });
});
