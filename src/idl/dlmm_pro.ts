/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/dlmm_pro.json`.
 */
export type DlmmPro = {
  address: "dLmmthrtCtGNx512fjkTsWx7otWdv1SKrbQDR8dbffA";
  metadata: {
    name: "dlmmPro";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "addLiquidity";
      discriminator: [181, 157, 89, 67, 143, 182, 52, 72];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["position", "tickArrayBitmapExtension"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "addLiquidityParameters";
            };
          };
        },
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityByWeight";
      discriminator: [28, 140, 238, 99, 231, 162, 21, 149];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["position", "tickArrayBitmapExtension"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "addLiquidityByWeightParameters";
            };
          };
        },
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityImbalance";
      discriminator: [12, 68, 222, 87, 138, 56, 203, 54];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["position", "tickArrayBitmapExtension"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "addLiquidityImbalanceParameters";
            };
          };
        },
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "cancelLimitOrder";
      discriminator: [132, 156, 132, 31, 67, 40, 232, 97];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["tickArrayBitmapExtension", "limitOrder"];
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "limitOrder";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "userTokenX";
          docs: [
            "When dont set it tokenAccount to prevent unnecessary create token account (rent fee) when user only withdraw token y",
          ];
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "referralToken";
          writable: true;
          optional: true;
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "tickIds";
          type: {
            vec: "i32";
          };
        },
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "claimFee";
      discriminator: [169, 32, 79, 137, 136, 232, 70, 137];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["position"];
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "claimPartnerFee";
      docs: ["PARTNER FUNCTIONS ////"];
      discriminator: [97, 206, 39, 105, 94, 94, 126, 148];
      accounts: [
        {
          name: "pool";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "receiverTokenX";
          writable: true;
        },
        {
          name: "receiverTokenY";
          writable: true;
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "maxAmountX";
          type: "u64";
        },
        {
          name: "maxAmountY";
          type: "u64";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "claimProtocolFee2";
      discriminator: [235, 194, 54, 69, 65, 10, 236, 112];
      accounts: [
        {
          name: "receiverTokenAccount";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "pool";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "signer";
          signer: true;
          address: "FkU5rQCWQM131skHCpcEbK8P1JrQGsBgqXe55w525SSF";
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
      ];
      args: [
        {
          name: "maxAmount";
          type: "u64";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "claimReward";
      discriminator: [149, 95, 181, 242, 94, 90, 158, 162];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["position"];
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "rewardVault";
          writable: true;
        },
        {
          name: "rewardMint";
        },
        {
          name: "userTokenAccount";
          writable: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "rewardIndex";
          type: "u8";
        },
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "closeConfig";
      discriminator: [145, 9, 72, 157, 95, 125, 61, 85];
      accounts: [
        {
          name: "staticConfig";
          writable: true;
          optional: true;
        },
        {
          name: "dynamicConfig";
          writable: true;
          optional: true;
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "closeLimitOrder";
      discriminator: [76, 124, 128, 15, 213, 87, 37, 250];
      accounts: [
        {
          name: "pool";
          relations: ["limitOrder"];
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "limitOrder";
          writable: true;
        },
        {
          name: "nftMint";
          docs: ["nftMint"];
          writable: true;
          relations: ["limitOrder"];
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
          writable: true;
        },
        {
          name: "owner";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "tokenProgram";
          docs: [
            "Program to create NFT mint/token account and transfer for token22 account",
          ];
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "closeOperatorAccount";
      discriminator: [171, 9, 213, 74, 120, 23, 3, 29];
      accounts: [
        {
          name: "operator";
          writable: true;
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "closePosition";
      discriminator: [123, 134, 81, 0, 49, 68, 98, 98];
      accounts: [
        {
          name: "nftMint";
          docs: ["nftMint"];
          writable: true;
          relations: ["position"];
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
          writable: true;
        },
        {
          name: "pool";
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "owner";
          docs: ["Owner of position"];
          signer: true;
        },
        {
          name: "tokenProgram";
          docs: [
            "Program to create NFT mint/token account and transfer for token22 account",
          ];
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "closeTokenBadge";
      discriminator: [108, 146, 86, 110, 179, 254, 10, 104];
      accounts: [
        {
          name: "tokenBadge";
          writable: true;
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "createDynamicConfig";
      discriminator: [81, 251, 122, 78, 66, 57, 208, 82];
      accounts: [
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [100, 95, 99, 111, 110, 102, 105, 103];
              },
              {
                kind: "account";
                path: "poolCreatorAuthority";
              },
              {
                kind: "arg";
                path: "index";
              },
            ];
          };
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "poolCreatorAuthority";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "index";
          type: "u64";
        },
        {
          name: "configParameters";
          type: {
            defined: {
              name: "dynamicConfigParameters";
            };
          };
        },
      ];
    },
    {
      name: "createOperatorAccount";
      docs: ["ADMIN FUNCTIONS /////"];
      discriminator: [221, 64, 246, 149, 240, 153, 229, 163];
      accounts: [
        {
          name: "operator";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 112, 101, 114, 97, 116, 111, 114];
              },
              {
                kind: "account";
                path: "whitelistedAddress";
              },
            ];
          };
        },
        {
          name: "whitelistedAddress";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "permission";
          type: "u128";
        },
      ];
    },
    {
      name: "createStaticConfig";
      docs: ["OPERATOR FUNCTIONS /////"];
      discriminator: [213, 102, 10, 153, 255, 23, 107, 85];
      accounts: [
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [115, 95, 99, 111, 110, 102, 105, 103];
              },
              {
                kind: "arg";
                path: "index";
              },
            ];
          };
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "index";
          type: "u64";
        },
        {
          name: "configParameters";
          type: {
            defined: {
              name: "staticConfigParameters";
            };
          };
        },
      ];
    },
    {
      name: "createTokenBadge";
      discriminator: [88, 206, 0, 91, 60, 175, 151, 118];
      accounts: [
        {
          name: "tokenBadge";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [116, 111, 107, 101, 110, 95, 98, 97, 100, 103, 101];
              },
              {
                kind: "account";
                path: "tokenMint";
              },
            ];
          };
        },
        {
          name: "tokenMint";
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "expandPosition";
      docs: ["BELOW ARE INSTRUCTIONS FOP ADVANCED LP"];
      discriminator: [225, 19, 137, 20, 203, 60, 46, 233];
      accounts: [
        {
          name: "pool";
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "payer";
          docs: ["Address paying to expand the position. Can be anyone"];
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "openPositionParameters";
            };
          };
        },
      ];
    },
    {
      name: "increaseOracleLength";
      discriminator: [190, 61, 125, 87, 103, 79, 158, 173];
      accounts: [
        {
          name: "oracle";
          writable: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "lenghtToAdd";
          type: "u16";
        },
      ];
    },
    {
      name: "initializeLaunchPool";
      discriminator: [93, 7, 113, 208, 205, 146, 140, 86];
      accounts: [
        {
          name: "pool";
          docs: ["Initialize an account to store the pool state"];
          writable: true;
        },
        {
          name: "tokenXMint";
          docs: ["Token x mint"];
        },
        {
          name: "tokenYMint";
          docs: ["Token y mint"];
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "oracle";
          docs: ["Oracle account"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "reserveX";
          docs: ["Token x vault for the pool"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 115, 101, 114, 118, 101];
              },
              {
                kind: "account";
                path: "tokenXMint";
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "reserveY";
          docs: ["Token y vault for the pool"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 115, 101, 114, 118, 101];
              },
              {
                kind: "account";
                path: "tokenYMint";
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "tokenBadgeX";
          optional: true;
        },
        {
          name: "tokenBadgeY";
          optional: true;
        },
        {
          name: "creator";
        },
        {
          name: "payer";
          docs: ["Address paying to create the pool. Can be anyone"];
          writable: true;
          signer: true;
        },
        {
          name: "tokenXProgram";
          docs: ["Program to create mint account and mint tokens"];
        },
        {
          name: "tokenYProgram";
          docs: ["Program to create mint account and mint tokens"];
        },
        {
          name: "systemProgram";
          docs: ["System program"];
          address: "11111111111111111111111111111111";
        },
        {
          name: "userTokenX";
        },
        {
          name: "userTokenY";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "initializePoolWithDynamicParameters";
            };
          };
        },
      ];
    },
    {
      name: "initializePoolWithDynamicConfig";
      discriminator: [149, 82, 72, 197, 253, 252, 68, 15];
      accounts: [
        {
          name: "pool";
          docs: ["Initialize an account to store the pool state"];
          writable: true;
        },
        {
          name: "tokenXMint";
          docs: ["Token x mint"];
        },
        {
          name: "tokenYMint";
          docs: ["Token y mint"];
        },
        {
          name: "config";
          docs: ["Which config the pool belongs to."];
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "oracle";
          docs: ["Oracle account"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "reserveX";
          docs: ["Token x vault for the pool"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 115, 101, 114, 118, 101];
              },
              {
                kind: "account";
                path: "tokenXMint";
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "reserveY";
          docs: ["Token y vault for the pool"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 115, 101, 114, 118, 101];
              },
              {
                kind: "account";
                path: "tokenYMint";
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "tokenBadgeX";
          optional: true;
        },
        {
          name: "tokenBadgeY";
          optional: true;
        },
        {
          name: "creator";
        },
        {
          name: "payer";
          docs: ["Address paying to create the pool. Can be anyone"];
          writable: true;
          signer: true;
        },
        {
          name: "poolCreatorAuthority";
          signer: true;
          relations: ["config"];
        },
        {
          name: "tokenXProgram";
          docs: ["Program to create mint account and mint tokens"];
        },
        {
          name: "tokenYProgram";
          docs: ["Program to create mint account and mint tokens"];
        },
        {
          name: "systemProgram";
          docs: ["System program"];
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "initializePoolWithDynamicParameters";
            };
          };
        },
      ];
    },
    {
      name: "initializePoolWithStaticConfig";
      docs: ["USER FUNCTIONS ////"];
      discriminator: [31, 137, 135, 139, 16, 202, 132, 165];
      accounts: [
        {
          name: "pool";
          docs: ["Initialize an account to store the pool state"];
          writable: true;
        },
        {
          name: "tokenXMint";
          docs: ["Token x mint"];
        },
        {
          name: "tokenYMint";
          docs: ["Token y mint"];
        },
        {
          name: "config";
          docs: ["Which config the pool belongs to."];
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "oracle";
          docs: ["Oracle account"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "reserveX";
          docs: ["Token x vault for the pool"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 115, 101, 114, 118, 101];
              },
              {
                kind: "account";
                path: "tokenXMint";
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "reserveY";
          docs: ["Token y vault for the pool"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 115, 101, 114, 118, 101];
              },
              {
                kind: "account";
                path: "tokenYMint";
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "tokenBadgeX";
          optional: true;
        },
        {
          name: "tokenBadgeY";
          optional: true;
        },
        {
          name: "creator";
        },
        {
          name: "payer";
          docs: ["Address paying to create the pool. Can be anyone"];
          writable: true;
          signer: true;
        },
        {
          name: "poolCreatorAuthority";
          relations: ["config"];
        },
        {
          name: "tokenXProgram";
          docs: ["Program to create mint account and mint tokens"];
        },
        {
          name: "tokenYProgram";
          docs: ["Program to create mint account and mint tokens"];
        },
        {
          name: "systemProgram";
          docs: ["System program"];
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "initialSqrtPrice";
          type: "u128";
        },
      ];
    },
    {
      name: "initializeReward";
      discriminator: [95, 135, 192, 196, 242, 129, 230, 68];
      accounts: [
        {
          name: "pool";
          writable: true;
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "rewardVault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 119, 97, 114, 100];
              },
              {
                kind: "account";
                path: "pool";
              },
              {
                kind: "arg";
                path: "rewardIndex";
              },
            ];
          };
        },
        {
          name: "rewardMint";
        },
        {
          name: "tokenBadge";
          optional: true;
        },
        {
          name: "operator";
          optional: true;
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "rewardAuthority";
        },
        {
          name: "tokenProgram";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "index";
          type: "u8";
        },
      ];
    },
    {
      name: "initializeTickArray";
      discriminator: [11, 188, 193, 214, 141, 91, 149, 184];
      accounts: [
        {
          name: "pool";
        },
        {
          name: "tickArray";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [116, 105, 99, 107, 95, 97, 114, 114, 97, 121];
              },
              {
                kind: "account";
                path: "pool";
              },
              {
                kind: "arg";
                path: "index";
              },
            ];
          };
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "index";
          type: "i32";
        },
      ];
    },
    {
      name: "initializeTickBitmapExtension";
      discriminator: [115, 38, 91, 170, 127, 154, 45, 215];
      accounts: [
        {
          name: "pool";
          writable: true;
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "pool";
              },
            ];
          };
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "lockPermanentPosition";
      discriminator: [16, 252, 253, 25, 44, 162, 121, 210];
      accounts: [
        {
          name: "pool";
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "bps";
          type: "u16";
        },
      ];
    },
    {
      name: "lockVestingPosition";
      discriminator: [249, 133, 194, 132, 243, 138, 177, 40];
      accounts: [
        {
          name: "pool";
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "lockVestingPositionParameters";
            };
          };
        },
      ];
    },
    {
      name: "openLimitOrder";
      docs: ["LIMIT ORDER FUNCTIONS"];
      discriminator: [157, 32, 218, 183, 71, 29, 18, 147];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["tickArrayBitmapExtension"];
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "nftMint";
          docs: ["nftMint"];
          writable: true;
          signer: true;
        },
        {
          name: "nftAccount";
          docs: ["limit order nft account"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "owner";
              },
              {
                kind: "account";
                path: "token2022Program";
              },
              {
                kind: "account";
                path: "nftMint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "reserve";
          writable: true;
        },
        {
          name: "tokenMint";
        },
        {
          name: "limitOrder";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [108, 105, 109, 105, 116, 95, 111, 114, 100, 101, 114];
              },
              {
                kind: "account";
                path: "nftMint";
              },
            ];
          };
        },
        {
          name: "userToken";
          writable: true;
        },
        {
          name: "referral";
          optional: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "owner";
          docs: ["owner of the limit order"];
          signer: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "token2022Program";
          docs: [
            "Program to create NFT mint/token account and transfer for token22 account",
          ];
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "openLimitOrderParameters";
            };
          };
        },
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "openPosition";
      discriminator: [135, 128, 47, 77, 15, 152, 240, 49];
      accounts: [
        {
          name: "pool";
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "nftMint";
          docs: ["nftMint"];
          writable: true;
          signer: true;
        },
        {
          name: "nftAccount";
          docs: ["position nft account"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "owner";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169,
                ];
              },
              {
                kind: "account";
                path: "nftMint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "position";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 111, 115, 105, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "nftMint";
              },
            ];
          };
        },
        {
          name: "owner";
        },
        {
          name: "payer";
          docs: ["Address paying to create the position. Can be anyone"];
          writable: true;
          signer: true;
        },
        {
          name: "tokenProgram";
          docs: [
            "Program to create NFT mint/token account and transfer for token22 account",
          ];
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "openPositionParameters";
            };
          };
        },
      ];
    },
    {
      name: "refreshFeesAndRewards";
      discriminator: [79, 227, 79, 141, 141, 165, 202, 20];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "removeLiquidity";
      discriminator: [80, 85, 209, 72, 24, 206, 177, 108];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["position", "tickArrayBitmapExtension"];
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "removeLiquidityParameters";
            };
          };
        },
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "removeLiquidityByBps";
      discriminator: [218, 16, 16, 235, 228, 186, 196, 237];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["position", "tickArrayBitmapExtension"];
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "removeLiquidityByBpsParameters";
            };
          };
        },
        {
          name: "remainingAccountInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "removePosition";
      discriminator: [219, 24, 236, 110, 138, 80, 129, 6];
      accounts: [
        {
          name: "pool";
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "removePositionParameters";
            };
          };
        },
      ];
    },
    {
      name: "setPoolStatus";
      discriminator: [112, 87, 135, 223, 83, 204, 132, 53];
      accounts: [
        {
          name: "pool";
          writable: true;
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "status";
          type: "u16";
        },
      ];
    },
    {
      name: "setRewardEmission";
      discriminator: [43, 97, 246, 165, 236, 217, 184, 193];
      accounts: [
        {
          name: "pool";
          writable: true;
        },
        {
          name: "rewardVault";
          writable: true;
        },
        {
          name: "rewardMint";
        },
        {
          name: "funderTokenAccount";
          writable: true;
        },
        {
          name: "funder";
          signer: true;
        },
        {
          name: "authority";
          signer: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "setRewardEmissionParameters";
            };
          };
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "swap";
      discriminator: [248, 198, 158, 145, 225, 117, 135, 200];
      accounts: [
        {
          name: "pool";
          writable: true;
          relations: ["tickArrayBitmapExtension", "oracle"];
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "tickArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["pool"];
        },
        {
          name: "userTokenIn";
          writable: true;
        },
        {
          name: "userTokenOut";
          writable: true;
        },
        {
          name: "referral";
          writable: true;
          optional: true;
        },
        {
          name: "tokenXMint";
          relations: ["pool"];
        },
        {
          name: "tokenYMint";
          relations: ["pool"];
        },
        {
          name: "oracle";
          docs: ["oracle account"];
          writable: true;
        },
        {
          name: "user";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameters";
          type: {
            defined: {
              name: "swapParameters";
            };
          };
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "updateLimitOrderDelegatePermission";
      discriminator: [24, 118, 227, 203, 225, 210, 24, 22];
      accounts: [
        {
          name: "limitOrder";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "owner";
          signer: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "permission";
          type: "u32";
        },
      ];
    },
    {
      name: "updatePartnerFee";
      discriminator: [249, 155, 163, 84, 99, 131, 168, 241];
      accounts: [
        {
          name: "pool";
          writable: true;
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "partnerFeeBps";
          type: "u16";
        },
      ];
    },
    {
      name: "updatePositionDelegatePermission";
      discriminator: [40, 46, 122, 247, 20, 225, 29, 122];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "nftAccount";
          docs: ["The token account for nft"];
        },
        {
          name: "owner";
          signer: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "permission";
          type: "u32";
        },
      ];
    },
    {
      name: "updateRewardAuthority";
      discriminator: [65, 118, 233, 219, 224, 104, 111, 154];
      accounts: [
        {
          name: "pool";
          writable: true;
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "newAuthority";
          docs: ["CHECK, new authority, can be any one"];
        },
        {
          name: "operator";
          optional: true;
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "index";
          type: "u8";
        },
      ];
    },
    {
      name: "withdrawIneligibleRewards";
      discriminator: [210, 167, 115, 21, 123, 152, 213, 243];
      accounts: [
        {
          name: "pool";
          writable: true;
        },
        {
          name: "poolAuthority";
          address: "A7Fp7eGFn4eHjyoxanRvFPaBMcJMDDzkfSS5JMqwGKeo";
        },
        {
          name: "rewardVault";
          writable: true;
        },
        {
          name: "rewardMint";
        },
        {
          name: "funderTokenAccount";
          writable: true;
        },
        {
          name: "funder";
          signer: true;
        },
        {
          name: "authority";
          signer: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "index";
          type: "u8";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
  ];
  accounts: [
    {
      name: "dynamicConfig";
      discriminator: [27, 6, 225, 85, 179, 188, 16, 62];
    },
    {
      name: "limitOrder";
      discriminator: [137, 183, 212, 91, 115, 29, 141, 227];
    },
    {
      name: "operator";
      discriminator: [219, 31, 188, 145, 69, 139, 204, 117];
    },
    {
      name: "oracle";
      discriminator: [139, 194, 131, 179, 140, 179, 229, 244];
    },
    {
      name: "pool";
      discriminator: [241, 154, 109, 4, 17, 177, 109, 188];
    },
    {
      name: "positionArray";
      discriminator: [191, 127, 182, 83, 240, 21, 253, 160];
    },
    {
      name: "staticConfig";
      discriminator: [224, 158, 109, 93, 248, 232, 193, 126];
    },
    {
      name: "tickArray";
      discriminator: [69, 97, 189, 190, 110, 7, 66, 187];
    },
    {
      name: "tickArrayBitmapExtension";
      discriminator: [60, 150, 36, 219, 97, 128, 139, 153];
    },
    {
      name: "tokenBadge";
      discriminator: [116, 219, 204, 229, 249, 116, 255, 150];
    },
  ];
  events: [
    {
      name: "evtAddLiquidity";
      discriminator: [175, 242, 8, 157, 30, 247, 185, 169];
    },
    {
      name: "evtCancelLimitOrder";
      discriminator: [172, 199, 242, 78, 83, 76, 252, 169];
    },
    {
      name: "evtClaimFee";
      discriminator: [6, 36, 88, 232, 53, 193, 253, 98];
    },
    {
      name: "evtClaimPartnerFee";
      discriminator: [118, 99, 77, 10, 226, 1, 1, 87];
    },
    {
      name: "evtClaimProtocolFee";
      discriminator: [186, 244, 75, 251, 188, 13, 25, 33];
    },
    {
      name: "evtClaimReward";
      discriminator: [218, 86, 147, 200, 235, 188, 215, 231];
    },
    {
      name: "evtCloseConfig";
      discriminator: [36, 30, 239, 45, 58, 132, 14, 5];
    },
    {
      name: "evtCloseLimitOrder";
      discriminator: [96, 207, 191, 15, 18, 145, 236, 243];
    },
    {
      name: "evtClosePosition";
      discriminator: [20, 145, 144, 68, 143, 142, 214, 178];
    },
    {
      name: "evtCloseTokenBadge";
      discriminator: [60, 217, 34, 82, 183, 10, 89, 188];
    },
    {
      name: "evtCreateDynamicConfig";
      discriminator: [231, 197, 13, 164, 248, 213, 133, 152];
    },
    {
      name: "evtCreateStaticConfig";
      discriminator: [234, 224, 124, 152, 51, 10, 35, 56];
    },
    {
      name: "evtCreateTokenBadge";
      discriminator: [141, 120, 134, 116, 34, 28, 114, 160];
    },
    {
      name: "evtExpandPosition";
      discriminator: [4, 96, 179, 22, 251, 12, 153, 138];
    },
    {
      name: "evtIncreaseOracleLength";
      discriminator: [200, 26, 202, 64, 204, 39, 24, 29];
    },
    {
      name: "evtInitializeBitmapExtension";
      discriminator: [66, 113, 184, 247, 118, 137, 109, 3];
    },
    {
      name: "evtInitializePool";
      discriminator: [228, 50, 246, 85, 203, 66, 134, 37];
    },
    {
      name: "evtInitializeReward";
      discriminator: [129, 91, 188, 3, 246, 52, 185, 249];
    },
    {
      name: "evtInitializeTickArray";
      discriminator: [172, 157, 96, 5, 143, 89, 252, 243];
    },
    {
      name: "evtLockPermanent";
      discriminator: [13, 210, 242, 189, 27, 110, 154, 50];
    },
    {
      name: "evtLockVesting";
      discriminator: [120, 158, 54, 216, 205, 50, 2, 207];
    },
    {
      name: "evtOpenLimitOrder";
      discriminator: [166, 252, 90, 102, 156, 108, 252, 180];
    },
    {
      name: "evtOpenPosition";
      discriminator: [231, 109, 233, 198, 26, 153, 65, 157];
    },
    {
      name: "evtRemoveLiquidity";
      discriminator: [87, 46, 88, 98, 175, 96, 34, 91];
    },
    {
      name: "evtRemovePosition";
      discriminator: [198, 89, 5, 246, 12, 176, 181, 123];
    },
    {
      name: "evtSetPoolStatus";
      discriminator: [100, 213, 74, 3, 95, 91, 228, 146];
    },
    {
      name: "evtSetRewardEmission";
      discriminator: [84, 53, 84, 96, 61, 124, 32, 204];
    },
    {
      name: "evtSwap";
      discriminator: [27, 60, 21, 213, 138, 170, 187, 147];
    },
    {
      name: "evtUpdateLimitOrderDelegatePermission";
      discriminator: [254, 38, 187, 92, 174, 169, 97, 141];
    },
    {
      name: "evtUpdatePartnerFee";
      discriminator: [248, 186, 117, 175, 253, 13, 62, 187];
    },
    {
      name: "evtUpdatePositionDelegatePermission";
      discriminator: [14, 70, 182, 47, 167, 103, 100, 171];
    },
    {
      name: "evtUpdateRewardAuthority";
      discriminator: [48, 207, 235, 185, 114, 13, 99, 1];
    },
    {
      name: "evtWithdrawIneligibleReward";
      discriminator: [248, 215, 184, 78, 31, 180, 179, 168];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "mathOverflow";
      msg: "Math operation overflow";
    },
    {
      code: 6001;
      name: "typeCastFailed";
      msg: "Type cast error";
    },
    {
      code: 6002;
      name: "invalidAdmin";
      msg: "Invalid admin";
    },
    {
      code: 6003;
      name: "invalidPermission";
      msg: "Invalid permission";
    },
    {
      code: 6004;
      name: "cannotCreateTokenBadgeOnSupportedMint";
      msg: "Cannot create token badge on supported mint";
    },
    {
      code: 6005;
      name: "unsupportNativeMintToken2022";
      msg: "Unsupported native mint token2022";
    },
    {
      code: 6006;
      name: "invalidTokenBadge";
      msg: "Invalid token badge";
    },
    {
      code: 6007;
      name: "invalidTokenOwnerProof";
      msg: "Invalid token owner proof";
    },
    {
      code: 6008;
      name: "unmatchedTickIndex";
      msg: "Tick index is unmatched";
    },
    {
      code: 6009;
      name: "reallocExceedMaxLengthPerInstruction";
      msg: "Realloc exceed max length per instruction";
    },
    {
      code: 6010;
      name: "tickIdIsOutOfBound";
      msg: "Tick id is out of bound";
    },
    {
      code: 6011;
      name: "insufficientRemainingAccounts";
      msg: "Insufficient remaining accounts";
    },
    {
      code: 6012;
      name: "invalidRemainingAccountSlice";
      msg: "Invalid remaining account slice";
    },
    {
      code: 6013;
      name: "duplicatedRemainingAccountTypes";
      msg: "Duplicated remaining account types";
    },
    {
      code: 6014;
      name: "invalidRewardIndex";
      msg: "Invalid reward index";
    },
    {
      code: 6015;
      name: "invalidTickArray";
      msg: "Invalid tick array";
    },
    {
      code: 6016;
      name: "cannotFindTickFromId";
      msg: "Cannot find tick from id";
    },
    {
      code: 6017;
      name: "missingRemainingAccountForTransferHook";
      msg: "Missing remaining account for transfer hook";
    },
    {
      code: 6018;
      name: "noTransferHookProgram";
      msg: "Remaining account was passed for transfer hook but there's no hook program";
    },
    {
      code: 6019;
      name: "exceededSlippage";
      msg: "Exceeded slippage tolerance";
    },
    {
      code: 6020;
      name: "notConsumingFullAmountIn";
      msg: "Not consuming full amount in";
    },
    {
      code: 6021;
      name: "tickArrayBitmapExtensionAccountIsNotProvided";
      msg: "TickArray bitmap extension account is not provided";
    },
    {
      code: 6022;
      name: "liquidityIsTooHigh";
      msg: "Liquidity is too high";
    },
    {
      code: 6023;
      name: "liquidityIsZero";
      msg: "Liquidity is zero";
    },
    {
      code: 6024;
      name: "undeterminedError";
      msg: "Undetermined error";
    },
    {
      code: 6025;
      name: "cannotFindLimitOrderByTickId";
      msg: "Cannot find limit order by tick id";
    },
    {
      code: 6026;
      name: "cancelNonEmptyLimitOrder";
      msg: "Cancel on empty limit order";
    },
    {
      code: 6027;
      name: "invalidPoolType";
      msg: "Invalid pool type";
    },
    {
      code: 6028;
      name: "missingOperatorAccount";
      msg: "Missing operator account";
    },
    {
      code: 6029;
      name: "rewardUninitialized";
      msg: "Reward not initialized";
    },
    {
      code: 6030;
      name: "invalidRewardVault";
      msg: "Invalid reward vault";
    },
    {
      code: 6031;
      name: "identicalFunder";
      msg: "Identical funder";
    },
    {
      code: 6032;
      name: "positionIsNotEmpty";
      msg: "Position is not empty";
    },
    {
      code: 6033;
      name: "limitOrderIsNotEmpty";
      msg: "Limit order is not empty";
    },
    {
      code: 6034;
      name: "invalidActivationType";
      msg: "Invalid activation type";
    },
    {
      code: 6035;
      name: "invalidBaseFeeMode";
      msg: "Invalid base fee mode";
    },
    {
      code: 6036;
      name: "invalidParameters";
      msg: "Invalid parameters";
    },
    {
      code: 6037;
      name: "invalidAccount";
      msg: "Invalid account in instruction";
    },
    {
      code: 6038;
      name: "amountIsZero";
      msg: "Amount is zero";
    },
    {
      code: 6039;
      name: "invalidActivationAccess";
      msg: "Invalid activation access";
    },
    {
      code: 6040;
      name: "invalidRewardState";
      msg: "Invalid reward state";
    },
    {
      code: 6041;
      name: "positionAlreadyHadVesting";
      msg: "Position already had vesting";
    },
    {
      code: 6042;
      name: "insufficientLiquidity";
      msg: "Liquidity is insufficient";
    },
    {
      code: 6043;
      name: "bitmapExtensionAccountIsNotProvided";
      msg: "Bitmap extension account is not provided";
    },
    {
      code: 6044;
      name: "cannotModifyAccount";
      msg: "Cannot modify account";
    },
    {
      code: 6045;
      name: "invalidPoolCreatorAuthority";
      msg: "Invalid pool creator authority";
    },
    {
      code: 6046;
      name: "invalidAuthority";
      msg: "Invalid authority";
    },
    {
      code: 6047;
      name: "delegatedAmountNonZero";
      msg: "Delegated amount is not zero";
    },
    {
      code: 6048;
      name: "incorrectAta";
      msg: "Incorrect ATA";
    },
  ];
  types: [
    {
      name: "accountsType";
      type: {
        kind: "enum";
        variants: [
          {
            name: "transferHookX";
          },
          {
            name: "transferHookY";
          },
          {
            name: "transferHookReferral";
          },
          {
            name: "transferHookReward";
          },
        ];
      };
    },
    {
      name: "addLiquidityByWeightParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "maxAmountX";
            type: "u64";
          },
          {
            name: "maxAmountY";
            type: "u64";
          },
          {
            name: "bitmap";
            type: "u64";
          },
          {
            name: "multiplier";
            type: "u128";
          },
          {
            name: "liquidities";
            type: "bytes";
          },
        ];
      };
    },
    {
      name: "addLiquidityImbalanceParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "maxAmountXAndFeeBps";
            type: {
              option: {
                defined: {
                  name: "maxAmountAndFeeBps";
                };
              };
            };
          },
          {
            name: "maxAmountYAndFeeBps";
            type: {
              option: {
                defined: {
                  name: "maxAmountAndFeeBps";
                };
              };
            };
          },
          {
            name: "observedTickId";
            type: "i32";
          },
          {
            name: "maxTickSlippage";
            type: "u32";
          },
          {
            name: "index";
            type: "u8";
          },
          {
            name: "expectedTickRange";
            type: {
              defined: {
                name: "tickRange";
              };
            };
          },
        ];
      };
    },
    {
      name: "addLiquidityParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "maxAmountX";
            type: "u64";
          },
          {
            name: "maxAmountY";
            type: "u64";
          },
          {
            name: "bitmap";
            type: "u64";
          },
          {
            name: "liquidities";
            type: {
              vec: "u128";
            };
          },
        ];
      };
    },
    {
      name: "baseFeeConfig";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "baseFeeMode";
            type: "u8";
          },
          {
            name: "data";
            type: {
              array: ["u8", 31];
            };
          },
        ];
      };
    },
    {
      name: "baseFeeConfigParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "baseFeeMode";
            type: "u8";
          },
          {
            name: "data";
            type: {
              array: ["u8", 31];
            };
          },
        ];
      };
    },
    {
      name: "dynamicConfig";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "index";
            docs: ["config index"];
            type: "u64";
          },
          {
            name: "padding0";
            docs: ["padding 0"];
            type: "u64";
          },
          {
            name: "poolCreatorAuthority";
            docs: [
              "Only pool_creator_authority can use the current config to initialize new pool",
            ];
            type: "pubkey";
          },
          {
            name: "permission";
            type: "u128";
          },
          {
            name: "partnerFeeBps";
            docs: ["partner fee share"];
            type: "u16";
          },
          {
            name: "padding1";
            type: {
              array: ["u8", 14];
            };
          },
        ];
      };
    },
    {
      name: "dynamicConfigParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "permission";
            type: "u128";
          },
          {
            name: "partnerFeeBps";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "dynamicFeeConfig";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "maxVolatilityAccumulator";
            type: "u32";
          },
          {
            name: "variableFeeControl";
            type: "u32";
          },
          {
            name: "filterPeriod";
            type: "u16";
          },
          {
            name: "decayPeriod";
            type: "u16";
          },
          {
            name: "reductionFactor";
            type: "u16";
          },
          {
            name: "initialized";
            type: "u8";
          },
          {
            name: "padding";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "dynamicFeeParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "maxVolatilityAccumulator";
            type: "u32";
          },
          {
            name: "variableFeeControl";
            type: "u32";
          },
          {
            name: "filterPeriod";
            type: "u16";
          },
          {
            name: "decayPeriod";
            type: "u16";
          },
          {
            name: "reductionFactor";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "evtAddLiquidity";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "amountX";
            type: "u64";
          },
          {
            name: "amountY";
            type: "u64";
          },
          {
            name: "currentSqrtPrice";
            type: "u128";
          },
          {
            name: "bitmap";
            type: "u64";
          },
          {
            name: "liquidities";
            type: {
              vec: "u128";
            };
          },
        ];
      };
    },
    {
      name: "evtCancelLimitOrder";
      docs: ["Close config"];
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "limitOrder";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "amountX";
            type: "u64";
          },
          {
            name: "amountY";
            type: "u64";
          },
          {
            name: "tickIds";
            type: {
              vec: "i32";
            };
          },
          {
            name: "referral";
            type: "pubkey";
          },
          {
            name: "referralFee";
            type: "u64";
          },
          {
            name: "referralFeesOnTokenX";
            type: "bool";
          },
        ];
      };
    },
    {
      name: "evtClaimFee";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "amountX";
            type: "u64";
          },
          {
            name: "amountY";
            type: "u64";
          },
          {
            name: "currentSqrtPrice";
            type: "u128";
          },
        ];
      };
    },
    {
      name: "evtClaimPartnerFee";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "signer";
            type: "pubkey";
          },
          {
            name: "amountX";
            type: "u64";
          },
          {
            name: "amountY";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "evtClaimProtocolFee";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "receiverTokenAccount";
            type: "pubkey";
          },
          {
            name: "tokenMint";
            type: "pubkey";
          },
          {
            name: "amount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "evtClaimReward";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "rewardMint";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u8";
          },
          {
            name: "amount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "evtCloseConfig";
      type: {
        kind: "struct";
        fields: [
          {
            name: "config";
            type: "pubkey";
          },
          {
            name: "signer";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "evtCloseLimitOrder";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "limitOrder";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "evtClosePosition";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "evtCloseTokenBadge";
      type: {
        kind: "struct";
        fields: [
          {
            name: "tokenBadge";
            type: "pubkey";
          },
          {
            name: "signer";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "evtCreateDynamicConfig";
      type: {
        kind: "struct";
        fields: [
          {
            name: "config";
            type: "pubkey";
          },
          {
            name: "signer";
            type: "pubkey";
          },
          {
            name: "poolCreatorAuthority";
            type: "pubkey";
          },
          {
            name: "index";
            type: "u64";
          },
          {
            name: "permission";
            type: "u128";
          },
          {
            name: "partnerFeeBps";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "evtCreateStaticConfig";
      type: {
        kind: "struct";
        fields: [
          {
            name: "config";
            type: "pubkey";
          },
          {
            name: "signer";
            type: "pubkey";
          },
          {
            name: "poolCreatorAuthority";
            type: "pubkey";
          },
          {
            name: "index";
            type: "u64";
          },
          {
            name: "poolFees";
            type: {
              defined: {
                name: "poolFeeParameters";
              };
            };
          },
          {
            name: "tickSpacing";
            type: "u16";
          },
          {
            name: "collectFeeMode";
            type: "u8";
          },
          {
            name: "activationType";
            type: "u8";
          },
          {
            name: "extensions";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "evtCreateTokenBadge";
      type: {
        kind: "struct";
        fields: [
          {
            name: "tokenMint";
            type: "pubkey";
          },
          {
            name: "signer";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "evtExpandPosition";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "tickRanges";
            type: {
              vec: {
                defined: {
                  name: "tickRange";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "evtIncreaseOracleLength";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "oldLength";
            type: "u64";
          },
          {
            name: "newLength";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "evtInitializeBitmapExtension";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "evtInitializePool";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "creator";
            type: "pubkey";
          },
          {
            name: "payer";
            type: "pubkey";
          },
          {
            name: "tokenXMint";
            type: "pubkey";
          },
          {
            name: "tokenYMint";
            type: "pubkey";
          },
          {
            name: "tokenXFlag";
            type: "u8";
          },
          {
            name: "tokenYFlag";
            type: "u8";
          },
          {
            name: "poolType";
            type: "u8";
          },
          {
            name: "poolFees";
            type: {
              defined: {
                name: "poolFeeParameters";
              };
            };
          },
          {
            name: "tickSpacing";
            type: "u16";
          },
          {
            name: "collectFeeMode";
            type: "u8";
          },
          {
            name: "initialSqrtPrice";
            type: "u128";
          },
          {
            name: "activationType";
            type: "u8";
          },
          {
            name: "activationPoint";
            type: "u64";
          },
          {
            name: "extensions";
            type: "u8";
          },
          {
            name: "poolActivation";
            type: {
              option: {
                defined: {
                  name: "poolActivationParameters";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "evtInitializeReward";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "rewardMint";
            type: "pubkey";
          },
          {
            name: "rewardAuthority";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "evtInitializeTickArray";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "index";
            type: "i32";
          },
        ];
      };
    },
    {
      name: "evtLockPermanent";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "bps";
            type: "u16";
          },
          {
            name: "liquidities";
            type: {
              vec: "u128";
            };
          },
        ];
      };
    },
    {
      name: "evtLockVesting";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "parameters";
            type: {
              defined: {
                name: "lockVestingPositionParameters";
              };
            };
          },
          {
            name: "liquidities";
            type: {
              vec: "u128";
            };
          },
        ];
      };
    },
    {
      name: "evtOpenLimitOrder";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "limitOrder";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "isAskSide";
            type: "bool";
          },
          {
            name: "orderAges";
            type: {
              vec: "u64";
            };
          },
          {
            name: "referral";
            type: {
              option: "pubkey";
            };
          },
          {
            name: "actualTickLimitOrderAmount";
            type: {
              vec: {
                defined: {
                  name: "tickLimitOrderAmount";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "evtOpenPosition";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "tickRanges";
            type: {
              vec: {
                defined: {
                  name: "tickRange";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "evtRemoveLiquidity";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "amountX";
            type: "u64";
          },
          {
            name: "amountY";
            type: "u64";
          },
          {
            name: "currentSqrtPrice";
            type: "u128";
          },
          {
            name: "bitmap";
            type: "u64";
          },
          {
            name: "liquidities";
            type: {
              vec: "u128";
            };
          },
        ];
      };
    },
    {
      name: "evtRemovePosition";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "nftAccount";
            type: "pubkey";
          },
          {
            name: "bitmap";
            type: "u64";
          },
          {
            name: "tickRanges";
            type: {
              vec: {
                defined: {
                  name: "tickRange";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "evtSetPoolStatus";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "signer";
            type: "pubkey";
          },
          {
            name: "status";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "evtSetRewardEmission";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u8";
          },
          {
            name: "openTime";
            type: "u64";
          },
          {
            name: "endTime";
            type: "u64";
          },
          {
            name: "emissionPerSecond";
            type: "u128";
          },
        ];
      };
    },
    {
      name: "evtSwap";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "startSqrtPrice";
            type: "u128";
          },
          {
            name: "endSqrtPrice";
            type: "u128";
          },
          {
            name: "swapForY";
            type: "bool";
          },
          {
            name: "amountIn";
            type: "u64";
          },
          {
            name: "amountLeft";
            type: "u64";
          },
          {
            name: "amountOut";
            type: "u64";
          },
          {
            name: "mmFee";
            type: "u64";
          },
          {
            name: "protocolFee";
            type: "u64";
          },
          {
            name: "limitOrderFee";
            type: "u64";
          },
          {
            name: "hostFee";
            type: "u64";
          },
          {
            name: "partnerFee";
            type: "u64";
          },
          {
            name: "feesOnInput";
            type: "bool";
          },
          {
            name: "feesOnTokenX";
            type: "bool";
          },
        ];
      };
    },
    {
      name: "evtUpdateLimitOrderDelegatePermission";
      type: {
        kind: "struct";
        fields: [
          {
            name: "limitOrder";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "permission";
            type: "u32";
          },
          {
            name: "delegate";
            type: {
              option: "pubkey";
            };
          },
        ];
      };
    },
    {
      name: "evtUpdatePartnerFee";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "signer";
            type: "pubkey";
          },
          {
            name: "oldPartnerFeeBps";
            type: "u16";
          },
          {
            name: "newPartnerFeeBps";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "evtUpdatePositionDelegatePermission";
      type: {
        kind: "struct";
        fields: [
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "permission";
            type: "u32";
          },
          {
            name: "delegate";
            type: {
              option: "pubkey";
            };
          },
        ];
      };
    },
    {
      name: "evtUpdateRewardAuthority";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "newAuthority";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "evtWithdrawIneligibleReward";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u8";
          },
          {
            name: "rewardAmount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "feeConfig";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "baseFee";
            type: {
              defined: {
                name: "baseFeeConfig";
              };
            };
          },
          {
            name: "dynamicFee";
            type: {
              defined: {
                name: "dynamicFeeConfig";
              };
            };
          },
        ];
      };
    },
    {
      name: "initializePoolWithDynamicParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "poolFees";
            docs: ["pool fees"];
            type: {
              defined: {
                name: "poolFeeParameters";
              };
            };
          },
          {
            name: "tickSpacing";
            type: "u16";
          },
          {
            name: "collectFeeMode";
            type: "u8";
          },
          {
            name: "initialSqrtPrice";
            docs: [
              "The init price of the pool as a sqrt(token_b/token_a) Q64.64 value",
            ];
            type: "u128";
          },
          {
            name: "activationType";
            type: "u8";
          },
          {
            name: "activationPoint";
            type: {
              option: "u64";
            };
          },
          {
            name: "extensions";
            type: "u8";
          },
          {
            name: "poolActivation";
            type: {
              option: {
                defined: {
                  name: "poolActivationParameters";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "limitOrder";
      serialization: "bytemuck";
      repr: {
        kind: "c";
        align: 8;
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "referral";
            docs: ["referral wallet that receives part of the limit order fee"];
            type: "pubkey";
          },
          {
            name: "delegatePermission";
            type: "u32";
          },
          {
            name: "padding0";
            type: {
              array: ["u8", 4];
            };
          },
        ];
      };
    },
    {
      name: "lockVestingPositionParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "cliffPoint";
            type: {
              option: "u64";
            };
          },
          {
            name: "cliffUnlockBps";
            type: "u16";
          },
          {
            name: "bpsPerPeriod";
            type: "u16";
          },
          {
            name: "periodFrequency";
            type: "u64";
          },
          {
            name: "numberOfPeriod";
            type: "u16";
          },
          {
            name: "bps";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "maxAmountAndFeeBps";
      type: {
        kind: "struct";
        fields: [
          {
            name: "maxAmount";
            type: "u64";
          },
          {
            name: "maxFeeBps";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "openLimitOrderParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "isAskSide";
            type: "bool";
          },
          {
            name: "relativeTick";
            type: {
              option: {
                defined: {
                  name: "relativeTick";
                };
              };
            };
          },
          {
            name: "ticks";
            type: {
              vec: {
                defined: {
                  name: "tickLimitOrderAmount";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "openPositionParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "tickRanges";
            type: {
              vec: {
                defined: {
                  name: "tickRange";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "operator";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "whitelistedAddress";
            type: "pubkey";
          },
          {
            name: "permission";
            type: "u128";
          },
        ];
      };
    },
    {
      name: "oracle";
      serialization: "bytemuck";
      repr: {
        kind: "c";
        align: 8;
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "idx";
            docs: ["Index of latest observation"];
            type: "u16";
          },
          {
            name: "padding";
            type: {
              array: ["u8", 6];
            };
          },
          {
            name: "lastObservationCreatedTimestamp";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "pool";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "tokenXMint";
            docs: ["Token X mint"];
            type: "pubkey";
          },
          {
            name: "tokenYMint";
            docs: ["Token Y mint"];
            type: "pubkey";
          },
          {
            name: "reserveX";
            docs: ["Token X reserve"];
            type: "pubkey";
          },
          {
            name: "reserveY";
            docs: ["Token Y reserve"];
            type: "pubkey";
          },
          {
            name: "creator";
            docs: ["Pool creator"];
            type: "pubkey";
          },
          {
            name: "feeConfig";
            docs: ["fee config"];
            type: {
              defined: {
                name: "feeConfig";
              };
            };
          },
          {
            name: "variableFee";
            docs: ["variable fee"];
            type: {
              defined: {
                name: "variableFee";
              };
            };
          },
          {
            name: "poolPartner";
            docs: ["pool partner fee state"];
            type: {
              defined: {
                name: "poolPartner";
              };
            };
          },
          {
            name: "liquidity";
            docs: ["current pool liquidity"];
            type: "u128";
          },
          {
            name: "initSqrtPrice";
            type: "u128";
          },
          {
            name: "sqrtPrice";
            type: "u128";
          },
          {
            name: "feeGrowthGlobalX";
            type: {
              defined: {
                name: "z192";
              };
            };
          },
          {
            name: "feeGrowthGlobalY";
            type: {
              defined: {
                name: "z192";
              };
            };
          },
          {
            name: "tickArrayBitmap";
            docs: ["Tick array state"];
            type: {
              array: ["u64", 16];
            };
          },
          {
            name: "activationPoint";
            docs: ["activation point"];
            type: "u64";
          },
          {
            name: "protocolFeeX";
            type: "u64";
          },
          {
            name: "protocolFeeY";
            type: "u64";
          },
          {
            name: "tickCurrentId";
            type: "i32";
          },
          {
            name: "tickSpacing";
            type: "u16";
          },
          {
            name: "poolStatus";
            docs: ["pool status"];
            type: "u16";
          },
          {
            name: "partnerFeeBps";
            docs: ["partner fee share"];
            type: "u16";
          },
          {
            name: "poolType";
            docs: ["pool type, static/dynamic or launch pool"];
            type: "u8";
          },
          {
            name: "tokenXFlag";
            docs: ["tokenXFlag"];
            type: "u8";
          },
          {
            name: "tokenYFlag";
            docs: ["tokenYFlag"];
            type: "u8";
          },
          {
            name: "activationType";
            docs: ["activation type"];
            type: "u8";
          },
          {
            name: "collectFeeMode";
            docs: ["collect fee mode"];
            type: "u8";
          },
          {
            name: "extensions";
            docs: ["extensions"];
            type: "u8";
          },
          {
            name: "isBitmapExtensionInitialized";
            docs: ["flag to know if bitmap extensions is initalized"];
            type: "u8";
          },
          {
            name: "padding0";
            docs: ["padding for future use"];
            type: {
              array: ["u8", 7];
            };
          },
        ];
      };
    },
    {
      name: "poolActivationInfoParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "activationMode";
            type: "u8";
          },
          {
            name: "data";
            type: {
              array: ["u8", 15];
            };
          },
        ];
      };
    },
    {
      name: "poolActivationParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "whitelistedSwap";
            type: "pubkey";
          },
          {
            name: "whitelistedAddLiquidity";
            type: "pubkey";
          },
          {
            name: "whitelistedRemoveLiquidity";
            type: "pubkey";
          },
          {
            name: "activations";
            type: {
              array: [
                {
                  defined: {
                    name: "poolActivationInfoParameters";
                  };
                },
                2,
              ];
            };
          },
        ];
      };
    },
    {
      name: "poolFeeParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "baseFeeParameter";
            type: {
              defined: {
                name: "baseFeeConfigParameters";
              };
            };
          },
          {
            name: "dynamicFeeParameter";
            type: {
              option: {
                defined: {
                  name: "dynamicFeeParameters";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "poolPartner";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "partner";
            docs: [
              "partner taken from config.pool_creator_authority at pool creation",
            ];
            type: "pubkey";
          },
          {
            name: "pendingFeeX";
            docs: ["pending partner fee for token x"];
            type: "u64";
          },
          {
            name: "pendingFeeY";
            docs: ["pending partner fee for token y"];
            type: "u64";
          },
        ];
      };
    },
    {
      name: "positionArray";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "nftMint";
            type: "pubkey";
          },
          {
            name: "delegatePermission";
            type: "u32";
          },
          {
            name: "padding0";
            type: {
              array: ["u8", 12];
            };
          },
          {
            name: "vesting";
            type: {
              defined: {
                name: "positionVesting";
              };
            };
          },
        ];
      };
    },
    {
      name: "positionVesting";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "cliffPoint";
            type: "u64";
          },
          {
            name: "periodFrequency";
            type: "u64";
          },
          {
            name: "cliffUnlockBps";
            type: "u16";
          },
          {
            name: "bpsPerPeriod";
            type: "u16";
          },
          {
            name: "numberOfPeriod";
            type: "u16";
          },
          {
            name: "initialize";
            type: "u8";
          },
          {
            name: "padding";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "relativeTick";
      type: {
        kind: "struct";
        fields: [
          {
            name: "activeId";
            docs: ["Active tick that integrator observe off-chain"];
            type: "i32";
          },
          {
            name: "maxSlippage";
            docs: ["max active tick slippage allowed"];
            type: "u32";
          },
        ];
      };
    },
    {
      name: "remainingAccountsInfo";
      type: {
        kind: "struct";
        fields: [
          {
            name: "slices";
            type: {
              vec: {
                defined: {
                  name: "remainingAccountsSlice";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "remainingAccountsSlice";
      type: {
        kind: "struct";
        fields: [
          {
            name: "accountsType";
            type: {
              defined: {
                name: "accountsType";
              };
            };
          },
          {
            name: "length";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "removeLiquidityByBpsParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "minAmountX";
            type: "u64";
          },
          {
            name: "minAmountY";
            type: "u64";
          },
          {
            name: "bps";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "removeLiquidityParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "minAmountX";
            type: "u64";
          },
          {
            name: "minAmountY";
            type: "u64";
          },
          {
            name: "bitmap";
            type: "u64";
          },
          {
            name: "liquidities";
            type: {
              vec: "u128";
            };
          },
        ];
      };
    },
    {
      name: "removePositionParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "bitmap";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "setRewardEmissionParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "index";
            type: "u8";
          },
          {
            name: "openTime";
            type: {
              option: "u64";
            };
          },
          {
            name: "endTime";
            type: "u64";
          },
          {
            name: "emissionPerSecond";
            type: "u128";
          },
        ];
      };
    },
    {
      name: "staticConfig";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "index";
            docs: ["config index"];
            type: "u64";
          },
          {
            name: "padding0";
            docs: ["padding 0"];
            type: "u64";
          },
          {
            name: "poolCreatorAuthority";
            docs: [
              "Only pool_creator_authority can use the current config to initialize new pool. When it's Pubkey::default, it's a public config.",
            ];
            type: "pubkey";
          },
          {
            name: "collectFeeMode";
            docs: ["Collect fee mode"];
            type: "u8";
          },
          {
            name: "activationType";
            docs: ["activation type"];
            type: "u8";
          },
          {
            name: "extensions";
            docs: ["extensions"];
            type: "u8";
          },
          {
            name: "padding1";
            docs: ["padding 1"];
            type: {
              array: ["u8", 3];
            };
          },
          {
            name: "tickSpacing";
            type: "u16";
          },
          {
            name: "feeConfig";
            docs: ["fee config"];
            type: {
              defined: {
                name: "feeConfig";
              };
            };
          },
        ];
      };
    },
    {
      name: "staticConfigParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "poolFees";
            type: {
              defined: {
                name: "poolFeeParameters";
              };
            };
          },
          {
            name: "tickSpacing";
            type: "u16";
          },
          {
            name: "collectFeeMode";
            type: "u8";
          },
          {
            name: "activationType";
            type: "u8";
          },
          {
            name: "extensions";
            type: "u8";
          },
          {
            name: "poolCreatorAuthority";
            type: {
              option: "pubkey";
            };
          },
        ];
      };
    },
    {
      name: "swapParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "swapMode";
            type: "u8";
          },
          {
            name: "inputAmount";
            type: "u64";
          },
          {
            name: "minimumOutputAmount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "tickArray";
      serialization: "bytemuck";
      repr: {
        kind: "c";
        align: 8;
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "tickIndex";
            type: "i32";
          },
          {
            name: "padding0";
            type: {
              array: ["u8", 20];
            };
          },
        ];
      };
    },
    {
      name: "tickArrayBitmapExtension";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "positiveBitmap";
            type: {
              array: [
                {
                  array: ["u64", 8];
                },
                6,
              ];
            };
          },
          {
            name: "negativeBitmap";
            type: {
              array: [
                {
                  array: ["u64", 8];
                },
                6,
              ];
            };
          },
        ];
      };
    },
    {
      name: "tickLimitOrderAmount";
      type: {
        kind: "struct";
        fields: [
          {
            name: "id";
            type: "i32";
          },
          {
            name: "amount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "tickRange";
      type: {
        kind: "struct";
        fields: [
          {
            name: "tickLowerId";
            type: "i32";
          },
          {
            name: "tickUpperId";
            type: "i32";
          },
        ];
      };
    },
    {
      name: "tokenBadge";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "tokenMint";
            docs: ["token mint"];
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "variableFee";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "sqrtPriceReference";
            docs: ["sqrt price of last swap."];
            type: "u128";
          },
          {
            name: "lastUpdateTimestamp";
            docs: ["Last timestamp the variable parameters was updated"];
            type: "u64";
          },
          {
            name: "volatilityAccumulator";
            type: "u32";
          },
          {
            name: "volatilityReference";
            type: "u32";
          },
        ];
      };
    },
    {
      name: "z192";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "inner";
            type: {
              array: ["u8", 24];
            };
          },
        ];
      };
    },
  ];
  constants: [
    {
      name: "bitmapSize";
      type: "i32";
      value: "512";
    },
    {
      name: "feeDenominator";
      type: "u64";
      value: "1000000000";
    },
    {
      name: "hostFeeBps";
      docs: ["Host fee. 20%"];
      type: "u16";
      value: "2000";
    },
    {
      name: "limitOrderMaxTickU64";
      type: "u64";
      value: "30";
    },
    {
      name: "limitOrderProtocolFeeBps";
      type: "u16";
      value: "5000";
    },
    {
      name: "limitOrderReferralFeeBps";
      type: "u16";
      value: "2000";
    },
    {
      name: "maxBasisPoint";
      type: "u16";
      value: "10000";
    },
    {
      name: "maxFeeNumerator";
      type: "u64";
      value: "990000000";
    },
    {
      name: "maxPartnerFeeBps";
      type: "u16";
      value: "5000";
    },
    {
      name: "maxRewardDuration";
      type: "u64";
      value: "31536000";
    },
    {
      name: "maxTicksPerArrayU64";
      type: "u64";
      value: "128";
    },
    {
      name: "maxTickSpacing";
      type: "u16";
      value: "256";
    },
    {
      name: "minFeeNumerator";
      type: "u64";
      value: "100000";
    },
    {
      name: "minRewardDuration";
      type: "u64";
      value: "86400";
    },
    {
      name: "mmLaunchPoolProtocolFeeBps";
      type: "u16";
      value: "2000";
    },
    {
      name: "mmProtocolFeeBps";
      type: "u16";
      value: "1000";
    },
    {
      name: "numRewardsU64";
      type: "u64";
      value: "2";
    },
    {
      name: "positionMaxRangeU64";
      type: "u64";
      value: "45";
    },
  ];
};
