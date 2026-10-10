import { BN } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  AccessRegistryOperatorPermission,
  ActivationMode,
  ActivationType,
  bondingCurveActivationParameters,
  CollectFeeMode,
  deriveLaunchPool,
  deriveOracle,
  derivePool,
  deriveReserve,
  deriveTickArrayBitmapExtension,
  deriveTokenBadge,
  DlmmProClient,
  DynamicConfigPermission,
  encodePoolExtensions,
  getSqrtPriceFromTickId,
  openActivationParameters,
  OperatorPermission,
  PoolErrorCode,
  PoolExtension,
  PoolType,
  tickArraysForRanges,
  timeBasedActivationParameters,
  TokenProgramFlags,
} from "../src";
import {
  addLiquidity,
  bitmask,
  closeConfig,
  closeTokenBadge,
  createAccessRegistryOperator,
  createAndFundWallet,
  createDynamicConfig,
  createStaticConfig,
  createSvmConnection,
  createToken,
  createToken2022WithFreeze,
  createTokenBadge,
  createWhitelistOperator,
  defaultDynamicPoolParameters,
  defaultStaticConfigArgs,
  getOrCreateAssociatedTokenAccount,
  getTokenAmount,
  initializeSVM,
  mintSplTokenTo,
  openPosition,
  randomID,
  seedPoolLiquidity,
  sendTransaction,
  sendTransactionExpectingError,
  SQRT_PRICE_ONE,
  swap,
  U64_MAX,
  warpToTime,
} from "./helpers";

describe("initialize pool", () => {
  const svm = initializeSVM();
  const connection = createSvmConnection(svm);
  const client = DlmmProClient.create(connection);

  const admin = createAndFundWallet(svm);
  const operator = createAndFundWallet(svm);
  // Token badges live in the external access registry with its own operators
  const registryOperator = createAndFundWallet(svm);
  const payer = createAndFundWallet(svm);
  const creator = createAndFundWallet(svm);

  const tokenXMint = createToken(svm, payer);
  const tokenYMint = createToken(svm, payer);
  const userTokenX = mintSplTokenTo(svm, payer, tokenXMint, payer.publicKey);
  const userTokenY = mintSplTokenTo(svm, payer, tokenYMint, payer.publicKey);

  it("creates whitelist operators", async () => {
    const operatorPda = await createWhitelistOperator(
      svm,
      connection,
      admin,
      operator.publicKey,
      [OperatorPermission.CreateConfigKey, OperatorPermission.RemoveConfigKey],
    );
    expect(svm.getAccount(operatorPda)?.data.length).toBeGreaterThan(0);

    const registryOperatorPda = await createAccessRegistryOperator(
      svm,
      connection,
      admin,
      registryOperator.publicKey,
      [
        AccessRegistryOperatorPermission.CreateTokenBadge,
        AccessRegistryOperatorPermission.CloseTokenBadge,
      ],
    );
    expect(svm.getAccount(registryOperatorPda)?.data.length).toBeGreaterThan(0);
  });

  describe("static config", () => {
    describe("public", () => {
      let config: PublicKey;

      it("creates a static config", async () => {
        config = await createStaticConfig(
          svm,
          connection,
          operator,
          payer,
          randomID(),
        );
        expect(svm.getAccount(config)?.data.length).toBeGreaterThan(0);
      });

      it("initializes a pool from the static config", async () => {
        const { tx, pool, oracle, reserveX, reserveY } =
          await client.pool.initializePoolWithStaticConfig({
            config,
            tokenXMint,
            tokenYMint,
            creator: creator.publicKey,
            payer: payer.publicKey,
            initialSqrtPrice: SQRT_PRICE_ONE,
          });

        sendTransaction(svm, tx, [payer]);

        expect(pool.toBase58()).toBe(
          derivePool(config, tokenXMint, tokenYMint).toBase58(),
        );
        expect(oracle.toBase58()).toBe(deriveOracle(pool).toBase58());
        expect(reserveX.toBase58()).toBe(
          deriveReserve(tokenXMint, pool).toBase58(),
        );
        expect(reserveY.toBase58()).toBe(
          deriveReserve(tokenYMint, pool).toBase58(),
        );
        expect(svm.getAccount(pool)?.data.length).toBeGreaterThan(0);
        expect(svm.getAccount(oracle)?.data.length).toBeGreaterThan(0);

        const poolState = await client.state.fetchPool(pool);
        expect(poolState.poolType).toBe(PoolType.Static);
        expect(poolState.tokenXMint.toBase58()).toBe(tokenXMint.toBase58());
        expect(poolState.tokenYMint.toBase58()).toBe(tokenYMint.toBase58());
        expect(poolState.isBitmapExtensionInitialized).toBe(0);
      });

      it("creates the bitmap extension when the initial tick overflows the inline bitmap", async () => {
        const config = await createStaticConfig(
          svm,
          connection,
          operator,
          payer,
          randomID(),
        );
        const { tx, pool, tickArrayBitmapExtension } =
          await client.pool.initializePoolWithStaticConfig({
            config,
            tokenXMint,
            tokenYMint,
            creator: creator.publicKey,
            payer: payer.publicKey,
            initialSqrtPrice: getSqrtPriceFromTickId(65536),
          });

        expect(tickArrayBitmapExtension?.toBase58()).toBe(
          deriveTickArrayBitmapExtension(pool).toBase58(),
        );
        sendTransaction(svm, tx, [payer]);

        const poolState = await client.state.fetchPool(pool);
        expect(poolState.isBitmapExtensionInitialized).toBe(1);
      });
    });

    describe("private", () => {
      it("derives the private config authority and marks it as a signer", async () => {
        const config = await createStaticConfig(
          svm,
          connection,
          operator,
          payer,
          randomID(),
          defaultStaticConfigArgs(creator.publicKey),
        );
        const { tx } = await client.pool.initializePoolWithStaticConfig({
          config,
          tokenXMint,
          tokenYMint,
          creator: creator.publicKey,
          payer: payer.publicKey,
          initialSqrtPrice: SQRT_PRICE_ONE,
        });
        expect(
          tx.instructions.some((ix) =>
            ix.keys.some(
              (key) => key.pubkey.equals(creator.publicKey) && key.isSigner,
            ),
          ),
        ).toBe(true);
      });

      it("initializes a pool when the private config authority co-signs", async () => {
        const config = await createStaticConfig(
          svm,
          connection,
          operator,
          payer,
          randomID(),
          defaultStaticConfigArgs(creator.publicKey),
        );
        const { tx, pool } = await client.pool.initializePoolWithStaticConfig({
          config,
          tokenXMint,
          tokenYMint,
          creator: creator.publicKey,
          payer: payer.publicKey,
          initialSqrtPrice: SQRT_PRICE_ONE,
        });
        sendTransaction(svm, tx, [payer, creator]);

        const poolState = await client.state.fetchPool(pool);
        expect(poolState.poolType).toBe(PoolType.Static);
      });
    });

    it("initializes a pool when token x has a token badge", async () => {
      const badgeMint = createToken2022WithFreeze(svm, payer);
      const quoteMint = createToken(svm, payer);
      const tokenBadgeX = await createTokenBadge(svm, connection, {
        tokenMint: badgeMint,
        signer: registryOperator,
        payer,
      });
      expect(tokenBadgeX.toBase58()).toBe(
        deriveTokenBadge(badgeMint).toBase58(),
      );

      const config = await createStaticConfig(
        svm,
        connection,
        operator,
        payer,
        randomID(),
      );
      const { tx, pool } = await client.pool.initializePoolWithStaticConfig({
        config,
        tokenXMint: badgeMint,
        tokenYMint: quoteMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        initialSqrtPrice: SQRT_PRICE_ONE,
        tokenXProgram: TOKEN_2022_PROGRAM_ID,
        tokenBadgeX,
      });
      sendTransaction(svm, tx, [payer]);

      const poolState = await client.state.fetchPool(pool);
      expect(poolState.poolType).toBe(PoolType.Static);
      expect(poolState.tokenXMint.toBase58()).toBe(badgeMint.toBase58());
      expect(poolState.tokenXFlag).toBe(TokenProgramFlags.TokenProgram2022);

      await closeTokenBadge(svm, connection, {
        tokenBadge: tokenBadgeX,
        signer: registryOperator,
        rentReceiver: payer.publicKey,
      });
      expect(svm.getAccount(tokenBadgeX)).toBeNull();
    });

    it("closes a static config", async () => {
      const config = await createStaticConfig(
        svm,
        connection,
        operator,
        payer,
        randomID(),
      );
      await closeConfig(svm, connection, {
        signer: operator,
        rentReceiver: payer.publicKey,
        staticConfig: config,
      });
      expect(svm.getAccount(config)).toBeNull();
    });
  });

  describe("dynamic config", () => {
    it("creates a dynamic config and initializes a pool", async () => {
      const config = await createDynamicConfig(
        svm,
        connection,
        operator,
        payer,
        randomID(),
        creator.publicKey,
      );
      expect(svm.getAccount(config)?.data.length).toBeGreaterThan(0);

      const { tx, pool, oracle, reserveX, reserveY } =
        await client.pool.initializePoolWithDynamicConfig({
          config,
          poolCreatorAuthority: creator.publicKey,
          tokenXMint,
          tokenYMint,
          creator: creator.publicKey,
          payer: payer.publicKey,
          parameters: defaultDynamicPoolParameters(SQRT_PRICE_ONE),
        });

      sendTransaction(svm, tx, [payer, creator]);

      expect(pool.toBase58()).toBe(
        derivePool(config, tokenXMint, tokenYMint).toBase58(),
      );
      expect(oracle.toBase58()).toBe(deriveOracle(pool).toBase58());
      expect(reserveX.toBase58()).toBe(
        deriveReserve(tokenXMint, pool).toBase58(),
      );
      expect(reserveY.toBase58()).toBe(
        deriveReserve(tokenYMint, pool).toBase58(),
      );
      expect(svm.getAccount(pool)?.data.length).toBeGreaterThan(0);
      expect(svm.getAccount(oracle)?.data.length).toBeGreaterThan(0);

      const poolState = await client.state.fetchPool(pool);
      expect(poolState.poolType).toBe(PoolType.Dynamic);
      expect(poolState.tokenXMint.toBase58()).toBe(tokenXMint.toBase58());
      expect(poolState.tokenYMint.toBase58()).toBe(tokenYMint.toBase58());
      expect(poolState.tickSpacing).toBe(1);
    });

    it("lets the pool creator claim partner fees after a swap", async () => {
      const lpOwner = createAndFundWallet(svm);
      const swapper = createAndFundWallet(svm);
      const lpTokenX = mintSplTokenTo(
        svm,
        payer,
        tokenXMint,
        lpOwner.publicKey,
      );
      const lpTokenY = mintSplTokenTo(
        svm,
        payer,
        tokenYMint,
        lpOwner.publicKey,
      );
      const swapperTokenX = mintSplTokenTo(
        svm,
        payer,
        tokenXMint,
        swapper.publicKey,
      );
      const swapperTokenY = mintSplTokenTo(
        svm,
        payer,
        tokenYMint,
        swapper.publicKey,
      );

      const config = await createDynamicConfig(
        svm,
        connection,
        operator,
        payer,
        randomID(),
        creator.publicKey,
        { permission: new BN(0), partnerFeeBps: 1_000 },
      );
      const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
        config,
        poolCreatorAuthority: creator.publicKey,
        tokenXMint,
        tokenYMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        parameters: defaultDynamicPoolParameters(SQRT_PRICE_ONE),
      });
      sendTransaction(svm, tx, [payer, creator]);

      const seeded = await seedPoolLiquidity(svm, client, {
        pool,
        lpOwner,
        payer,
        tokenXMint,
        tokenYMint,
        lpTokenX,
        lpTokenY,
      });
      await swap(svm, client, {
        pool,
        user: swapper,
        tokenXMint,
        tokenYMint,
        userTokenIn: swapperTokenY,
        userTokenOut: swapperTokenX,
        inputAmount: new BN(1_000_000),
      });

      const pending = (await client.state.fetchPool(pool)).poolPartner;
      expect(pending.pendingFeeX.add(pending.pendingFeeY).gt(new BN(0))).toBe(
        true,
      );

      const partnerTokenX = getOrCreateAssociatedTokenAccount(
        svm,
        payer,
        tokenXMint,
        creator.publicKey,
      );
      const partnerTokenY = getOrCreateAssociatedTokenAccount(
        svm,
        payer,
        tokenYMint,
        creator.publicKey,
      );
      const xBefore = getTokenAmount(svm, partnerTokenX);
      const yBefore = getTokenAmount(svm, partnerTokenY);
      const { tx: claimTx } = await client.pool.claimPartnerFee({
        pool,
        tokenXMint,
        tokenYMint,
        receiverTokenX: partnerTokenX,
        receiverTokenY: partnerTokenY,
        signer: creator.publicKey,
        maxAmountX: U64_MAX,
        maxAmountY: U64_MAX,
      });
      sendTransaction(svm, claimTx, [creator]);

      expect(
        getTokenAmount(svm, partnerTokenX)
          .sub(xBefore)
          .add(getTokenAmount(svm, partnerTokenY).sub(yBefore))
          .gt(new BN(0)),
      ).toBe(true);
    });

    it("initializes a pool when token x has a token badge", async () => {
      const badgeMint = createToken2022WithFreeze(svm, payer);
      const quoteMint = createToken(svm, payer);
      const tokenBadgeX = await createTokenBadge(svm, connection, {
        tokenMint: badgeMint,
        signer: registryOperator,
        payer,
      });

      const config = await createDynamicConfig(
        svm,
        connection,
        operator,
        payer,
        randomID(),
        creator.publicKey,
      );
      const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
        config,
        poolCreatorAuthority: creator.publicKey,
        tokenXMint: badgeMint,
        tokenYMint: quoteMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        parameters: defaultDynamicPoolParameters(SQRT_PRICE_ONE),
        tokenXProgram: TOKEN_2022_PROGRAM_ID,
        tokenBadgeX,
      });
      sendTransaction(svm, tx, [payer, creator]);

      const poolState = await client.state.fetchPool(pool);
      expect(poolState.poolType).toBe(PoolType.Dynamic);
      expect(poolState.tokenXMint.toBase58()).toBe(badgeMint.toBase58());
      expect(poolState.tokenXFlag).toBe(TokenProgramFlags.TokenProgram2022);
    });

    it("initializes a pool without mint validation", async () => {
      const unsupportedMint = createToken2022WithFreeze(svm, payer);
      const quoteMint = createToken(svm, payer);
      expect(svm.getAccount(deriveTokenBadge(unsupportedMint))).toBeFalsy();

      const config = await createDynamicConfig(
        svm,
        connection,
        operator,
        payer,
        randomID(),
        creator.publicKey,
        {
          permission: new BN(
            bitmask([DynamicConfigPermission.CreatePoolWithoutMintValidation]),
          ),
          partnerFeeBps: 0,
        },
      );
      const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
        config,
        poolCreatorAuthority: creator.publicKey,
        tokenXMint: unsupportedMint,
        tokenYMint: quoteMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        parameters: defaultDynamicPoolParameters(SQRT_PRICE_ONE),
        tokenXProgram: TOKEN_2022_PROGRAM_ID,
      });
      sendTransaction(svm, tx, [payer, creator]);

      const poolState = await client.state.fetchPool(pool);
      expect(poolState.poolType).toBe(PoolType.Dynamic);
      expect(poolState.tokenXMint.toBase58()).toBe(unsupportedMint.toBase58());
      expect(poolState.tokenXFlag).toBe(TokenProgramFlags.TokenProgram2022);
    });
  });

  describe("activation access", () => {
    it("gates open, add, and swap until the time-based points", async () => {
      warpToTime(svm, 1_700_000_000n);
      const current = Number(svm.getClock().unixTimestamp);
      const addLiquidityPoint = current + 30;
      const swapPoint = current + 60;
      const removeLiquidityPoint = current + 90;

      const config = await createDynamicConfig(
        svm,
        connection,
        operator,
        payer,
        randomID(),
        creator.publicKey,
      );
      const parameters = defaultDynamicPoolParameters(SQRT_PRICE_ONE);
      parameters.extensions = encodePoolExtensions([
        PoolExtension.ActivationAccess,
      ]);
      parameters.activationType = ActivationType.Timestamp;
      parameters.activationPoint = new BN(swapPoint);
      parameters.poolActivation = {
        whitelistedSwap: PublicKey.default,
        whitelistedAddLiquidity: PublicKey.default,
        whitelistedRemoveLiquidity: PublicKey.default,
        activations: [
          openActivationParameters(),
          timeBasedActivationParameters({
            swapPoint: new BN(swapPoint),
            addLiquidityPoint: new BN(addLiquidityPoint),
            removeLiquidityPoint: new BN(removeLiquidityPoint),
          }),
        ],
      };

      const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
        config,
        poolCreatorAuthority: creator.publicKey,
        tokenXMint,
        tokenYMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        parameters,
      });
      sendTransaction(svm, tx, [payer, creator]);

      const extensions = await client.state.decodePoolExtensions(pool);
      expect(extensions.hasActivationAccess).toBe(true);
      expect(extensions.activation?.activations[1].activationMode).toBe(
        ActivationMode.TimeBased,
      );

      const gatedNft = Keypair.generate();
      const gated = await client.position.openPosition({
        pool,
        owner: creator.publicKey,
        payer: payer.publicKey,
        nftMint: gatedNft.publicKey,
        tickRanges: [{ tickLowerId: -128, tickUpperId: 128 }],
        tickSpacing: 1,
      });
      sendTransactionExpectingError(
        svm,
        gated.tx,
        [payer, gatedNft],
        "InvalidActivationAccess",
      );

      warpToTime(svm, BigInt(addLiquidityPoint));
      const opened = await openPosition(svm, client, {
        pool,
        owner: creator.publicKey,
        payer,
        tickRanges: [{ tickLowerId: -128, tickUpperId: 128 }],
        tickSpacing: 1,
      });
      await addLiquidity(svm, client, {
        pool,
        nftMint: opened.nftMint,
        signer: creator,
        tokenXMint,
        tokenYMint,
        userTokenX: mintSplTokenTo(svm, payer, tokenXMint, creator.publicKey),
        userTokenY: mintSplTokenTo(svm, payer, tokenYMint, creator.publicKey),
        tickRanges: [{ tickLowerId: -128, tickUpperId: 128 }],
        tickSpacing: 1,
        deposits: [
          {
            positionIndex: 0,
            maxTokenX: new BN(50_000),
            maxTokenY: new BN(50_000),
          },
        ],
      });

      const swapperTokenX = mintSplTokenTo(
        svm,
        payer,
        tokenXMint,
        payer.publicKey,
      );
      const swapperTokenY = mintSplTokenTo(
        svm,
        payer,
        tokenYMint,
        payer.publicKey,
      );
      const tickRanges = [{ tickLowerId: -128, tickUpperId: 128 }];
      const { tx: swapTx } = await client.pool.swap({
        pool,
        tokenXMint,
        tokenYMint,
        userTokenIn: swapperTokenY,
        userTokenOut: swapperTokenX,
        user: payer.publicKey,
        parameters: {
          inputAmount: new BN(1_000),
          minimumOutputAmount: new BN(0),
        },
        tickArrays: tickArraysForRanges(pool, tickRanges, 1),
      });
      sendTransactionExpectingError(
        svm,
        swapTx,
        [payer],
        "InvalidActivationAccess",
      );

      warpToTime(svm, BigInt(swapPoint));
      await swap(svm, client, {
        pool,
        user: payer,
        tokenXMint,
        tokenYMint,
        userTokenIn: swapperTokenY,
        userTokenOut: swapperTokenX,
        inputAmount: new BN(1_000),
      });
      expect(
        getTokenAmount(svm, deriveReserve(tokenYMint, pool)).gt(new BN(0)),
      ).toBe(true);
    });

    it("initializes a bonding-curve activation pool and blocks public add until target", async () => {
      const config = await createDynamicConfig(
        svm,
        connection,
        operator,
        payer,
        randomID(),
        creator.publicKey,
      );
      const parameters = defaultDynamicPoolParameters(SQRT_PRICE_ONE);
      parameters.extensions = encodePoolExtensions([
        PoolExtension.ActivationAccess,
      ]);
      // A bonding curve needs a whitelisted depositor to seed the pool, or it
      // could never reach the target price that opens up public deposits.
      parameters.poolActivation = {
        whitelistedSwap: PublicKey.default,
        whitelistedAddLiquidity: creator.publicKey,
        whitelistedRemoveLiquidity: PublicKey.default,
        activations: [
          openActivationParameters(),
          bondingCurveActivationParameters({ targetIncreaseBps: 10_005 }),
        ],
      };

      const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
        config,
        poolCreatorAuthority: creator.publicKey,
        tokenXMint,
        tokenYMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        parameters,
      });
      sendTransaction(svm, tx, [payer, creator]);

      const extensions = await client.state.decodePoolExtensions(pool);
      expect(extensions.hasActivationAccess).toBe(true);
      expect(extensions.activation?.activations[1].activationMode).toBe(
        ActivationMode.BondingCurve,
      );

      // `payer` is not the whitelisted depositor, so it stays gated until the
      // pool reaches the bonding-curve target.
      const gatedNft = Keypair.generate();
      const gated = await client.position.openPosition({
        pool,
        owner: payer.publicKey,
        payer: payer.publicKey,
        nftMint: gatedNft.publicKey,
        tickRanges: [{ tickLowerId: -20, tickUpperId: 20 }],
        tickSpacing: 1,
      });
      sendTransactionExpectingError(
        svm,
        gated.tx,
        [payer, gatedNft],
        "InvalidActivationAccess",
      );
    });
  });

  it("rejects OnlyY without a token-Y badge when Y is not a whitelisted quote", async () => {
    const config = await createDynamicConfig(
      svm,
      connection,
      operator,
      payer,
      randomID(),
      creator.publicKey,
    );
    const parameters = defaultDynamicPoolParameters(SQRT_PRICE_ONE);
    parameters.collectFeeMode = CollectFeeMode.OnlyY;

    await expect(
      client.pool.initializePoolWithDynamicConfig({
        config,
        poolCreatorAuthority: creator.publicKey,
        tokenXMint,
        tokenYMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        parameters,
      }),
    ).rejects.toMatchObject({
      name: "PoolError",
      code: PoolErrorCode.InvalidTokenBadge,
    });
  });

  it("initializes a dynamic pool with tick spacing 10 and collectFeeMode OnlyY", async () => {
    const config = await createDynamicConfig(
      svm,
      connection,
      operator,
      payer,
      randomID(),
      creator.publicKey,
    );
    const parameters = defaultDynamicPoolParameters(SQRT_PRICE_ONE);
    parameters.tickSpacing = 10;
    parameters.collectFeeMode = CollectFeeMode.OnlyY;

    const tokenBadgeY = await createTokenBadge(svm, connection, {
      tokenMint: tokenYMint,
      signer: registryOperator,
      payer,
    });

    const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
      config,
      poolCreatorAuthority: creator.publicKey,
      tokenXMint,
      tokenYMint,
      creator: creator.publicKey,
      payer: payer.publicKey,
      parameters,
      tokenBadgeY,
    });
    sendTransaction(svm, tx, [payer, creator]);

    const poolState = await client.state.fetchPool(pool);
    expect(poolState.tickSpacing).toBe(10);
    expect(poolState.collectFeeMode).toBe(CollectFeeMode.OnlyY);

    const tickRanges = [{ tickLowerId: -100, tickUpperId: 100 }];
    const opened = await openPosition(svm, client, {
      pool,
      owner: creator.publicKey,
      payer,
      tickRanges,
      tickSpacing: 10,
    });
    await addLiquidity(svm, client, {
      pool,
      nftMint: opened.nftMint,
      signer: creator,
      tokenXMint,
      tokenYMint,
      userTokenX: mintSplTokenTo(svm, payer, tokenXMint, creator.publicKey),
      userTokenY: mintSplTokenTo(svm, payer, tokenYMint, creator.publicKey),
      tickRanges,
      tickSpacing: 10,
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(50_000),
          maxTokenY: new BN(50_000),
        },
      ],
    });
    expect(svm.getAccount(opened.position)?.data.length).toBeGreaterThan(0);
  });

  describe("launch pool", () => {
    it("initializes a launch pool when the payer owns both tokens", async () => {
      const { tx, pool, oracle, reserveX, reserveY } =
        await client.pool.initializeLaunchPool({
          tokenXMint,
          tokenYMint,
          creator: creator.publicKey,
          payer: payer.publicKey,
          parameters: defaultDynamicPoolParameters(SQRT_PRICE_ONE),
          userTokenX,
          userTokenY,
        });

      sendTransaction(svm, tx, [payer]);

      expect(pool.toBase58()).toBe(
        deriveLaunchPool(tokenXMint, tokenYMint).toBase58(),
      );
      expect(oracle.toBase58()).toBe(deriveOracle(pool).toBase58());
      expect(reserveX.toBase58()).toBe(
        deriveReserve(tokenXMint, pool).toBase58(),
      );
      expect(reserveY.toBase58()).toBe(
        deriveReserve(tokenYMint, pool).toBase58(),
      );
      expect(svm.getAccount(pool)?.data.length).toBeGreaterThan(0);
      expect(svm.getAccount(oracle)?.data.length).toBeGreaterThan(0);

      const poolState = await client.state.fetchPool(pool);
      expect(poolState.poolType).toBe(PoolType.LaunchPool);
      expect(poolState.tokenXMint.toBase58()).toBe(tokenXMint.toBase58());
      expect(poolState.tokenYMint.toBase58()).toBe(tokenYMint.toBase58());
    });
  });
});
