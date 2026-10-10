import { BN } from "@coral-xyz/anchor";
import { describe, expect, it } from "vitest";
import {
  deriveOracle,
  deriveTickArray,
  DlmmProClient,
  encodePoolExtensions,
  MAX_OBSERVATION_LENGTH,
  MAX_TICK_ID,
  MAX_TICKS_PER_ARRAY,
  PoolErrorCode,
  PoolExtension,
  PoolStatus,
  validatePoolCanSwap,
} from "../src";
import { createDlmmProProgram } from "../src/helpers/create_program";
import {
  allOperatorPermissions,
  bitmask,
  createDynamicConfig,
  createFundedMarket,
  createSvmConnection,
  defaultDynamicPoolParameters,
  getOrCreateAssociatedTokenAccount,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  randomID,
  seedPoolLiquidity,
  sendTransaction,
  sendTransactionExpectingError,
  setPoolStatus,
  SQRT_PRICE_ONE,
  swap,
  U64_MAX,
  updatePartnerFee,
} from "./helpers";

describe("pool", () => {
  const svm = initializeSVM();
  const connection = createSvmConnection(svm);
  const client = DlmmProClient.create(connection);

  it("claims partner fees to the partner's token accounts", async () => {
    const market = await createFundedMarket({
      svm,
      client,
      permissions: allOperatorPermissions(),
    });
    const config = await createDynamicConfig(
      svm,
      connection,
      market.operator,
      market.payer,
      randomID(),
      market.creator.publicKey,
      { permission: new BN(0), partnerFeeBps: 1_000 },
    );
    const { tx, pool } = await client.pool.initializePoolWithDynamicConfig({
      config,
      poolCreatorAuthority: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      creator: market.creator.publicKey,
      payer: market.payer.publicKey,
      parameters: defaultDynamicPoolParameters(SQRT_PRICE_ONE),
    });
    sendTransaction(svm, tx, [market.payer, market.creator]);

    await seedPoolLiquidity(svm, client, {
      pool,
      lpOwner: market.lpOwner,
      payer: market.payer,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      lpTokenX: market.lpTokenX,
      lpTokenY: market.lpTokenY,
    });
    await swap(svm, client, {
      pool,
      user: market.swapper,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      userTokenIn: market.swapperTokenY,
      userTokenOut: market.swapperTokenX,
      inputAmount: new BN(1_000_000),
    });

    await updatePartnerFee(svm, connection, {
      pool,
      signer: market.operator,
      partnerFeeBps: 500,
    });
    expect((await client.state.fetchPool(pool)).partnerFeeBps).toBe(500);

    const partnerTokenX = getOrCreateAssociatedTokenAccount(
      svm,
      market.payer,
      market.tokenXMint,
      market.creator.publicKey,
    );
    const partnerTokenY = getOrCreateAssociatedTokenAccount(
      svm,
      market.payer,
      market.tokenYMint,
      market.creator.publicKey,
    );
    const xBefore = getTokenAmount(svm, partnerTokenX);
    const yBefore = getTokenAmount(svm, partnerTokenY);
    const { tx: claimTx } = await client.pool.claimPartnerFee({
      pool,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      receiverTokenX: partnerTokenX,
      receiverTokenY: partnerTokenY,
      signer: market.creator.publicKey,
      maxAmountX: U64_MAX,
      maxAmountY: U64_MAX,
    });
    sendTransaction(svm, claimTx, [market.creator]);

    expect(
      getTokenAmount(svm, partnerTokenX)
        .sub(xBefore)
        .add(getTokenAmount(svm, partnerTokenY).sub(yBefore))
        .gt(new BN(0)),
    ).toBe(true);
  });

  it("rejects swaps off-chain and on-chain once the pool status disables them", async () => {
    const market = await createFundedMarket({
      svm,
      client,
      permissions: allOperatorPermissions(),
    });
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    await seedPoolLiquidity(svm, client, {
      pool,
      lpOwner: market.lpOwner,
      payer: market.payer,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
      lpTokenX: market.lpTokenX,
      lpTokenY: market.lpTokenY,
    });

    const disabled = bitmask([PoolStatus.Swap]);
    await setPoolStatus(svm, connection, {
      pool,
      signer: market.operator,
      status: disabled,
    });

    const poolState = await client.state.fetchPool(pool);
    expect(poolState.poolStatus).toBe(disabled);
    expect(() =>
      validatePoolCanSwap(
        poolState,
        null,
        market.swapper.publicKey,
        new BN(svm.getClock().unixTimestamp.toString()),
      ),
    ).toThrow();
    expect(() =>
      validatePoolCanSwap(
        {
          ...poolState,
          poolStatus: 0,
          extensions: encodePoolExtensions([PoolExtension.ActivationAccess]),
        },
        null,
        market.swapper.publicKey,
        new BN(svm.getClock().unixTimestamp.toString()),
      ),
    ).toThrow(
      expect.objectContaining({ code: PoolErrorCode.InvalidParameters }),
    );

    await expect(
      swap(svm, client, {
        pool,
        user: market.swapper,
        tokenXMint: market.tokenXMint,
        tokenYMint: market.tokenYMint,
        userTokenIn: market.swapperTokenY,
        userTokenOut: market.swapperTokenX,
        inputAmount: new BN(1_000_000),
      }),
    ).rejects.toThrow(/InvalidActivationAccess/);
  });

  it("decodes the operator account backing a pool's config", async () => {
    const permissions = allOperatorPermissions();
    const market = await createFundedMarket({ svm, client, permissions });
    const state = await client.state.fetchOperator(market.operatorPda);
    expect(state.whitelistedAddress.toBase58()).toBe(
      market.operator.publicKey.toBase58(),
    );
    expect(state.permission.toNumber()).toBe(bitmask(permissions));
  });

  it("rejects tick-array indexes past the usable ticks and oracle lengths over the cap", async () => {
    const market = await createFundedMarket({ svm, client });
    const { pool } = await initializeStaticPool(svm, client, {
      operator: market.operator,
      payer: market.payer,
      creator: market.creator.publicKey,
      tokenXMint: market.tokenXMint,
      tokenYMint: market.tokenYMint,
    });
    const funder = market.payer.publicKey;
    const lastIndex = Math.floor(MAX_TICK_ID / MAX_TICKS_PER_ARRAY);
    const program = createDlmmProProgram(connection);

    const { tx: lastTx } = await client.pool.initializeTickArray({
      pool,
      index: lastIndex,
      funder,
    });
    sendTransaction(svm, lastTx, [market.payer]);
    await expect(
      client.pool.initializeTickArray({ pool, index: lastIndex + 1, funder }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    const pastTx = await program.methods
      .initializeTickArray(lastIndex + 1)
      .accountsPartial({
        pool,
        tickArray: deriveTickArray(pool, lastIndex + 1),
        funder,
      })
      .transaction();
    sendTransactionExpectingError(
      svm,
      pastTx,
      [market.payer],
      "InvalidParameters",
    );

    const { tx: growTx } = await client.pool.increaseOracleLength({
      pool,
      payer: funder,
      lengthToAdd: MAX_OBSERVATION_LENGTH - 1,
    });
    sendTransaction(svm, growTx, [market.payer]);
    await expect(
      client.pool.increaseOracleLength({ pool, payer: funder, lengthToAdd: 1 }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidParameters });
    const overTx = await program.methods
      .increaseOracleLength(1)
      .accountsPartial({ oracle: deriveOracle(pool), payer: funder })
      .transaction();
    sendTransactionExpectingError(
      svm,
      overTx,
      [market.payer],
      "InvalidParameters",
    );
  });
});
