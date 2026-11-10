import { BN } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AccessRegistryOperatorPermission,
  ActivationMode,
  ActivationType,
  baseFeeParameters,
  BaseFeeMode,
  bondingCurveActivationParameters,
  CollectFeeMode,
  deriveLaunchPool,
  deriveOracle,
  derivePool,
  deriveReserve,
  deriveTickArrayBitmapExtension,
  DlmmProClient,
  encodePoolExtensions,
  getLiquidityFromAmounts,
  getSqrtPriceFromTickId,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  openActivationParameters,
  OperatorPermission,
  PoolErrorCode,
  PoolExtension,
  PoolType,
  tickArraysForSwap,
  timeBasedActivationParameters,
  TokenProgramFlags,
  type BaseFeeBpsParams,
  type StaticConfigParameters,
} from "../src";
import {
  accountExists,
  addLiquidity,
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
  getTokenAmount,
  initializeSVM,
  mintSplTokenTo,
  nextConfigIndex,
  openPosition,
  sendTransaction,
  sendTransactionExpectingError,
  SQRT_PRICE_ONE,
  swap,
  warpToTime,
} from "./helpers";

describe("initialize pool", () => {
  const svm = initializeSVM();
  const connection = createSvmConnection(svm);
  const client = new DlmmProClient(connection);

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

  beforeAll(async () => {
    await createWhitelistOperator(svm, connection, admin, operator.publicKey, [
      OperatorPermission.CreateConfigKey,
    ]);
    await createAccessRegistryOperator(
      svm,
      connection,
      admin,
      registryOperator.publicKey,
      [AccessRegistryOperatorPermission.CreateTokenBadge],
    );
  });

  function staticConfig(args?: StaticConfigParameters): Promise<PublicKey> {
    return createStaticConfig(
      svm,
      connection,
      operator,
      payer,
      nextConfigIndex(),
      args,
    );
  }

  function dynamicConfig(): Promise<PublicKey> {
    return createDynamicConfig(
      svm,
      connection,
      operator,
      payer,
      nextConfigIndex(),
      creator.publicKey,
    );
  }

  describe("static config", () => {
    it("initializes a pool from a static config", async () => {
      const config = await staticConfig();
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
      expect(accountExists(svm, oracle)).toBe(true);

      const poolState = await client.state.fetchPool(pool);
      expect(poolState.poolType).toBe(PoolType.Static);
      expect(poolState.tokenXMint.toBase58()).toBe(tokenXMint.toBase58());
      expect(poolState.tokenYMint.toBase58()).toBe(tokenYMint.toBase58());
      expect(poolState.isBitmapExtensionInitialized).toBe(0);
    });

    it("creates the bitmap extension when the initial tick overflows the inline bitmap", async () => {
      const { tx, pool, tickArrayBitmapExtension } =
        await client.pool.initializePoolWithStaticConfig({
          config: await staticConfig(),
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

    it.each([
      { name: "below the minimum", initialSqrtPrice: MIN_SQRT_PRICE.subn(1) },
      { name: "above the maximum", initialSqrtPrice: MAX_SQRT_PRICE.addn(1) },
    ])("rejects an initial sqrt price $name", async ({ initialSqrtPrice }) => {
      await expect(
        client.pool.initializePoolWithStaticConfig({
          config: await staticConfig(),
          tokenXMint,
          tokenYMint,
          creator: creator.publicKey,
          payer: payer.publicKey,
          initialSqrtPrice,
        }),
      ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    });

    it("initializes a pool when the private config authority co-signs", async () => {
      const { tx, pool } = await client.pool.initializePoolWithStaticConfig({
        config: await staticConfig(defaultStaticConfigArgs(creator.publicKey)),
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

    it("initializes a pool when token x has a token badge", async () => {
      const badgeMint = createToken2022WithFreeze(svm, payer);
      const tokenBadgeX = await createTokenBadge(svm, connection, {
        tokenMint: badgeMint,
        signer: registryOperator,
        payer,
      });
      expect(
        (await client.state.fetchTokenBadge(tokenBadgeX)).tokenMint.toBase58(),
      ).toBe(badgeMint.toBase58());
      const { tx, pool } = await client.pool.initializePoolWithStaticConfig({
        config: await staticConfig(),
        tokenXMint: badgeMint,
        tokenYMint: createToken(svm, payer),
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
    });
  });

  describe("dynamic config", () => {
    it("initializes a pool from a dynamic config", async () => {
      const config = await dynamicConfig();
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
      expect(accountExists(svm, oracle)).toBe(true);

      const poolState = await client.state.fetchPool(pool);
      expect(poolState.poolType).toBe(PoolType.Dynamic);
      expect(poolState.tokenXMint.toBase58()).toBe(tokenXMint.toBase58());
      expect(poolState.tokenYMint.toBase58()).toBe(tokenYMint.toBase58());
      expect(poolState.tickSpacing).toBe(1);
    });

    it("initializes pools from the bps base fee builders", async () => {
      const marketCap = {
        startingBaseFeeBps: 1000,
        endingBaseFeeBps: 25,
        numberOfPeriod: 50,
        priceMultiple: 100,
        schedulerExpirationDuration: 86_400,
      };
      const cases: [string, BaseFeeBpsParams][] = [
        ["fixed", { baseFeeMode: BaseFeeMode.Fixed, feeBps: 25 }],
        [
          "time linear",
          {
            baseFeeMode: BaseFeeMode.TimeSchedulerLinear,
            startingBaseFeeBps: 5000,
            endingBaseFeeBps: 100,
            numberOfPeriod: 10,
            totalDuration: 3600,
          },
        ],
        [
          "time exponential ending at 1 bps",
          {
            baseFeeMode: BaseFeeMode.TimeSchedulerExponential,
            startingBaseFeeBps: 100,
            endingBaseFeeBps: 1,
            numberOfPeriod: 50,
            totalDuration: 3600,
          },
        ],
        [
          "market cap linear",
          { baseFeeMode: BaseFeeMode.MarketCapSchedulerLinear, ...marketCap },
        ],
        [
          "market cap exponential between both fee bounds",
          {
            baseFeeMode: BaseFeeMode.MarketCapSchedulerExponential,
            startingBaseFeeBps: 9900,
            endingBaseFeeBps: 1,
            numberOfPeriod: 100,
            priceMultiple: 1000,
            schedulerExpirationDuration: 86_400,
          },
        ],
      ];

      for (const [label, params] of cases) {
        const baseFeeParameter = baseFeeParameters(params);
        const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
          config: await dynamicConfig(),
          poolCreatorAuthority: creator.publicKey,
          tokenXMint,
          tokenYMint,
          creator: creator.publicKey,
          payer: payer.publicKey,
          parameters: {
            ...defaultDynamicPoolParameters(SQRT_PRICE_ONE),
            poolFees: { baseFeeParameter, dynamicFeeParameter: null },
          },
        });
        sendTransaction(svm, tx, [payer, creator]);

        const { baseFee } = (await client.state.fetchPool(pool)).feeConfig;
        expect(baseFee.baseFeeMode, label).toBe(baseFeeParameter.baseFeeMode);
        expect(Array.from(baseFee.data), label).toEqual(
          Array.from(baseFeeParameter.data),
        );
      }
    });

    it("initializes a pool when token x has a token badge", async () => {
      const badgeMint = createToken2022WithFreeze(svm, payer);
      const tokenBadgeX = await createTokenBadge(svm, connection, {
        tokenMint: badgeMint,
        signer: registryOperator,
        payer,
      });
      const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
        config: await dynamicConfig(),
        poolCreatorAuthority: creator.publicKey,
        tokenXMint: badgeMint,
        tokenYMint: createToken(svm, payer),
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

    it("rejects an unknown activation type and a fractional tick spacing", async () => {
      const config = await dynamicConfig();
      for (const [overrides, code] of [
        [{ activationType: 255 }, PoolErrorCode.InvalidActivationType],
        [{ tickSpacing: 1.5 }, PoolErrorCode.InvalidParameters],
      ] as const) {
        await expect(
          client.pool.initializePoolWithDynamicConfig({
            config,
            poolCreatorAuthority: creator.publicKey,
            tokenXMint,
            tokenYMint,
            creator: creator.publicKey,
            payer: payer.publicKey,
            parameters: {
              ...defaultDynamicPoolParameters(SQRT_PRICE_ONE),
              ...overrides,
            },
          }),
        ).rejects.toMatchObject({ code });
      }
    });
  });

  describe("activation access", () => {
    it("gates open, add, and swap until the time-based points", async () => {
      warpToTime(svm, 1_700_000_000n);
      const current = Number(svm.getClock().unixTimestamp);
      const addLiquidityPoint = current + 30;
      const swapPoint = current + 60;
      const removeLiquidityPoint = current + 90;

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
        config: await dynamicConfig(),
        poolCreatorAuthority: creator.publicKey,
        tokenXMint,
        tokenYMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        parameters,
      });
      sendTransaction(svm, tx, [payer, creator]);

      const { extensions } = await client.state.fetchPoolWithExtensions(pool);
      expect(extensions.activation).toBeDefined();
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
      const inputAmount = new BN(1_000);
      const { tx: swapTx } = await client.pool.swap({
        pool,
        tokenXMint,
        tokenYMint,
        userTokenIn: swapperTokenY,
        userTokenOut: swapperTokenX,
        user: payer.publicKey,
        swapForY: false,
        parameters: {
          inputAmount,
          minimumOutputAmount: new BN(0),
        },
        tickArrays: tickArraysForSwap({
          pool,
          poolState: await client.state.fetchPool(pool),
          swapForY: false,
        }).tickArrays,
      });
      sendTransactionExpectingError(
        svm,
        swapTx,
        [payer],
        "InvalidActivationAccess",
      );

      warpToTime(svm, BigInt(swapPoint));
      const reserveY = deriveReserve(tokenYMint, pool);
      const reserveYBefore = getTokenAmount(svm, reserveY);
      await swap(svm, client, {
        pool,
        user: payer,
        tokenXMint,
        tokenYMint,
        userTokenIn: swapperTokenY,
        userTokenOut: swapperTokenX,
        inputAmount,
      });
      expect(getTokenAmount(svm, reserveY).sub(reserveYBefore).toString()).toBe(
        inputAmount.toString(),
      );
    });

    it("initializes a bonding-curve activation pool and rejects a position from a non-whitelisted owner", async () => {
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
        config: await dynamicConfig(),
        poolCreatorAuthority: creator.publicKey,
        tokenXMint,
        tokenYMint,
        creator: creator.publicKey,
        payer: payer.publicKey,
        parameters,
      });
      sendTransaction(svm, tx, [payer, creator]);

      const { extensions } = await client.state.fetchPoolWithExtensions(pool);
      expect(extensions.activation).toBeDefined();
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
      });
      sendTransactionExpectingError(
        svm,
        gated.tx,
        [payer, gatedNft],
        "InvalidActivationAccess",
      );
    });
  });

  it("initializes a dynamic pool with tick spacing 10 and collectFeeMode OnlyY", async () => {
    const parameters = defaultDynamicPoolParameters(SQRT_PRICE_ONE);
    parameters.tickSpacing = 10;
    parameters.collectFeeMode = CollectFeeMode.OnlyY;

    const tokenBadgeY = await createTokenBadge(svm, connection, {
      tokenMint: tokenYMint,
      signer: registryOperator,
      payer,
    });

    const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
      config: await dynamicConfig(),
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
      deposits: [
        {
          positionIndex: 0,
          maxTokenX: new BN(50_000),
          maxTokenY: new BN(50_000),
        },
      ],
    });
    const [position] = await client.state.decodePositions(opened.position);
    expect(position.unlockedLiquidity.toString()).toBe(
      getLiquidityFromAmounts({
        maxTokenX: new BN(50_000),
        maxTokenY: new BN(50_000),
        ...tickRanges[0],
        tickCurrentId: poolState.tickCurrentId,
        currentSqrtPrice: poolState.sqrtPrice,
      }).toString(),
    );
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
      expect(accountExists(svm, oracle)).toBe(true);

      const poolState = await client.state.fetchPool(pool);
      expect(poolState.poolType).toBe(PoolType.LaunchPool);
      expect(poolState.tokenXMint.toBase58()).toBe(tokenXMint.toBase58());
      expect(poolState.tokenYMint.toBase58()).toBe(tokenYMint.toBase58());
    });
  });
});
