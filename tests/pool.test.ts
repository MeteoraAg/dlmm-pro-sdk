import { BN } from "@coral-xyz/anchor";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DlmmProClient,
  OperatorPermission,
  PoolErrorCode,
  PoolStatus,
} from "../src";
import { permissionBitmask } from "../src/helpers/permissions";
import { U64_MAX } from "../src/math";
import {
  big,
  createDynamicConfig,
  createFundedMarket,
  createSvmConnection,
  defaultDynamicPoolParameters,
  getOrCreateAssociatedTokenAccount,
  getTokenAmount,
  initializeStaticPool,
  initializeSVM,
  nextConfigIndex,
  OPERATOR_PERMISSION_COUNT,
  POOL_STATUS_COUNT,
  pushPrice,
  seedPoolLiquidity,
  sendTransaction,
  setPoolStatus,
  SQRT_PRICE_ONE,
  type Market,
} from "./helpers";

describe("pool", () => {
  const svm = initializeSVM();
  const connection = createSvmConnection(svm);
  const client = new DlmmProClient(connection);
  const permissions = [
    OperatorPermission.CreateConfigKey,
    OperatorPermission.SetPoolStatus,
  ];

  let market: Market;

  beforeAll(async () => {
    market = await createFundedMarket({ svm, client, permissions });
  });

  it("claims partner fees to the partner's token accounts", async () => {
    const config = await createDynamicConfig(
      svm,
      connection,
      market.operator,
      market.payer,
      nextConfigIndex(),
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
    await seedPoolLiquidity(svm, client, market, pool);
    await pushPrice(svm, client, market, pool, "up", new BN(1_000_000));

    const { poolPartner } = await client.state.fetchPool(pool);
    expect(big(poolPartner.pendingFeeX)).toBeGreaterThan(0n);
    expect(poolPartner.pendingFeeY.toString()).toBe("0");

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

    expect({
      x: getTokenAmount(svm, partnerTokenX).sub(xBefore).toString(),
      y: getTokenAmount(svm, partnerTokenY).sub(yBefore).toString(),
    }).toEqual({
      x: poolPartner.pendingFeeX.toString(),
      y: poolPartner.pendingFeeY.toString(),
    });
  });

  it("refuses to quote a pool whose status disables swaps", async () => {
    const pool = await initializeStaticPool(svm, client, market);
    await seedPoolLiquidity(svm, client, market, pool);
    const disabled = permissionBitmask([PoolStatus.Swap], POOL_STATUS_COUNT);
    await setPoolStatus(svm, connection, {
      pool,
      signer: market.operator,
      status: disabled,
    });
    expect((await client.state.fetchPool(pool)).poolStatus).toBe(disabled);

    await expect(
      client.pool.quoteExactIn({
        pool,
        inputAmount: new BN(1_000_000),
        swapForY: false,
      }),
    ).rejects.toMatchObject({ code: PoolErrorCode.InvalidActivationAccess });
  });

  it("decodes a whitelisted operator's address and permissions", async () => {
    const state = await client.state.fetchOperator(market.operatorPda);
    expect(state.whitelistedAddress.toBase58()).toBe(
      market.operator.publicKey.toBase58(),
    );
    expect(state.permission.toString()).toBe(
      permissionBitmask(permissions, OPERATOR_PERMISSION_COUNT).toString(),
    );
  });
});
