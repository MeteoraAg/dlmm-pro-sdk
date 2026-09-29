import { PublicKey, Transaction, type AccountMeta } from "@solana/web3.js";
import BN from "bn.js";
import {
  DYNAMIC_CONFIG_PERMISSION_COUNT,
  MAX_PARTNER_FEE_BPS,
  MAX_TICK_SPACING,
  OPERATOR_PERMISSION_COUNT,
  POOL_EXTENSION_VARIANT_COUNT,
  POOL_STATUS_COUNT,
  PoolExtension,
} from "../constants";
import { PoolError } from "../errors";
import {
  bitmaskMax,
  deriveDynamicConfig,
  deriveOperator,
  derivePoolAuthority,
  deriveProtocolFeeAuthority,
  deriveReserve,
  deriveStaticConfig,
  isSupportExtension,
  permissionBitmask,
  LIQUIDITY_HOOKS,
  resolveInstructionHooks,
  resolveTokenProgram,
  readTokenAccountMint,
  validatePoolFeeParameters,
} from "../helpers";
import { assertU64 } from "../helpers/validation";
import {
  tryCastActivationType,
  tryCastCollectFeeMode,
} from "../math/safe_math";
import type {
  DynamicConfigParameters,
  OperatorPermission,
  StaticConfigParameters,
} from "../types";
import { DlmmProProgram } from "./program";

function validateStaticConfigParameters(
  parameters: StaticConfigParameters,
): void {
  validatePoolFeeParameters(parameters.poolFees);
  if (
    !Number.isInteger(parameters.tickSpacing) ||
    parameters.tickSpacing <= 0 ||
    parameters.tickSpacing > MAX_TICK_SPACING
  ) {
    throw PoolError.invalidParameters();
  }
  tryCastCollectFeeMode(parameters.collectFeeMode);
  try {
    tryCastActivationType(parameters.activationType);
  } catch {
    throw PoolError.invalidActivationType();
  }
  const extensionMax = (1 << POOL_EXTENSION_VARIANT_COUNT) - 1;
  if (
    !Number.isInteger(parameters.extensions) ||
    parameters.extensions < 0 ||
    parameters.extensions > extensionMax ||
    isSupportExtension(parameters.extensions, PoolExtension.ActivationAccess)
  ) {
    throw PoolError.invalidParameters();
  }
}

function validateDynamicConfigParameters(
  parameters: DynamicConfigParameters,
  poolCreatorAuthority: PublicKey,
): void {
  if (
    parameters.permission.isNeg() ||
    parameters.permission.gt(bitmaskMax(DYNAMIC_CONFIG_PERMISSION_COUNT))
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    !Number.isInteger(parameters.partnerFeeBps) ||
    parameters.partnerFeeBps < 0 ||
    parameters.partnerFeeBps > MAX_PARTNER_FEE_BPS
  ) {
    throw PoolError.invalidParameters();
  }
  if (poolCreatorAuthority.equals(PublicKey.default)) {
    throw PoolError.invalidParameters();
  }
}

/**
 * Admin and operator instructions. Creating an operator requires the program
 * admin. The other methods require the whitelisted operator wallet.
 */
export class OperatorService extends DlmmProProgram {
  async createOperatorAccount(params: {
    whitelistedAddress: PublicKey;
    signer: PublicKey;
    payer: PublicKey;
    permissions: readonly OperatorPermission[];
  }): Promise<{ tx: Transaction; operator: PublicKey }> {
    const permission = permissionBitmask(
      params.permissions,
      OPERATOR_PERMISSION_COUNT,
    );
    if (permission.isZero()) {
      throw PoolError.invalidPermission();
    }
    const operator = deriveOperator(params.whitelistedAddress);
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

  async createStaticConfig(params: {
    index: BN;
    parameters: StaticConfigParameters;
    signer: PublicKey;
    payer: PublicKey;
  }): Promise<{ tx: Transaction; config: PublicKey }> {
    assertU64(params.index);
    validateStaticConfigParameters(params.parameters);
    const config = deriveStaticConfig(params.index);
    const tx = await this.program.methods
      .createStaticConfig(params.index, params.parameters)
      .accountsPartial({
        config,
        operator: deriveOperator(params.signer),
        signer: params.signer,
        payer: params.payer,
      })
      .transaction();
    tx.feePayer = params.payer;
    return { tx, config };
  }

  async createDynamicConfig(params: {
    index: BN;
    poolCreatorAuthority: PublicKey;
    parameters: DynamicConfigParameters;
    signer: PublicKey;
    payer: PublicKey;
  }): Promise<{ tx: Transaction; config: PublicKey }> {
    assertU64(params.index);
    validateDynamicConfigParameters(
      params.parameters,
      params.poolCreatorAuthority,
    );
    const config = deriveDynamicConfig(
      params.poolCreatorAuthority,
      params.index,
    );
    const tx = await this.program.methods
      .createDynamicConfig(params.index, params.parameters)
      .accountsPartial({
        config,
        operator: deriveOperator(params.signer),
        signer: params.signer,
        payer: params.payer,
        poolCreatorAuthority: params.poolCreatorAuthority,
      })
      .transaction();
    tx.feePayer = params.payer;
    return { tx, config };
  }

  /**
   * Pass exactly one of `staticConfig` and `dynamicConfig`.
   */
  async closeConfig(params: {
    signer: PublicKey;
    rentReceiver: PublicKey;
    staticConfig?: PublicKey | null;
    dynamicConfig?: PublicKey | null;
  }): Promise<{ tx: Transaction }> {
    const hasStatic = !!params.staticConfig;
    const hasDynamic = !!params.dynamicConfig;
    if (hasStatic === hasDynamic) {
      throw PoolError.invalidParameters();
    }
    const tx = await this.program.methods
      .closeConfig()
      .accountsPartial({
        staticConfig: params.staticConfig ?? null,
        dynamicConfig: params.dynamicConfig ?? null,
        operator: deriveOperator(params.signer),
        signer: params.signer,
        rentReceiver: params.rentReceiver,
      })
      .transaction();
    tx.feePayer = params.signer;
    return { tx };
  }

  async setPoolStatus(params: {
    pool: PublicKey;
    signer: PublicKey;
    /** New `pool_status` bitfield. A set bit disables that action. */
    status: number;
  }): Promise<{ tx: Transaction }> {
    const maxStatus = bitmaskMax(POOL_STATUS_COUNT).toNumber();
    if (
      !Number.isInteger(params.status) ||
      params.status < 0 ||
      params.status > maxStatus
    ) {
      throw PoolError.invalidParameters();
    }
    const tx = await this.program.methods
      .setPoolStatus(params.status)
      .accountsPartial({
        pool: params.pool,
        operator: deriveOperator(params.signer),
        signer: params.signer,
      })
      .transaction();
    tx.feePayer = params.signer;
    return { tx };
  }

  async updatePartnerFee(params: {
    pool: PublicKey;
    signer: PublicKey;
    partnerFeeBps: number;
  }): Promise<{ tx: Transaction }> {
    if (
      !Number.isInteger(params.partnerFeeBps) ||
      params.partnerFeeBps < 0 ||
      params.partnerFeeBps > MAX_PARTNER_FEE_BPS
    ) {
      throw PoolError.invalidParameters();
    }
    const pool = await this.state.fetchPool(params.pool);
    if (pool.poolPartner.partner.equals(PublicKey.default)) {
      throw PoolError.invalidParameters();
    }
    const tx = await this.program.methods
      .updatePartnerFee(params.partnerFeeBps)
      .accountsPartial({
        pool: params.pool,
        operator: deriveOperator(params.signer),
        signer: params.signer,
      })
      .transaction();
    tx.feePayer = params.signer;
    return { tx };
  }

  /**
   * Claim accrued protocol fee for one side. `signer` is the protocol-fee
   * authority PDA; the external protocol-fee program has to sign.
   */
  async claimProtocolFee(params: {
    pool: PublicKey;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
    receiverTokenAccount: PublicKey;
    /** Pays the transaction fee. The instruction signer is the protocol-fee authority PDA. */
    payer: PublicKey;
    maxAmount: BN;
    minAmount?: BN;
    tokenXProgram?: PublicKey;
    tokenYProgram?: PublicKey;
    transferHookX?: AccountMeta[];
    transferHookY?: AccountMeta[];
  }): Promise<{ tx: Transaction }> {
    assertU64(params.maxAmount);
    assertU64(params.minAmount ?? new BN(0));
    const receiverMint = await readTokenAccountMint(
      this.connection,
      params.receiverTokenAccount,
      this.commitment,
    );
    const claimingX = receiverMint.equals(params.tokenXMint);
    if (!claimingX && !receiverMint.equals(params.tokenYMint)) {
      throw PoolError.invalidAccount();
    }
    const reserve = deriveReserve(receiverMint, params.pool);
    const poolAuthority = derivePoolAuthority();
    const hooks = await resolveInstructionHooks(
      this.connection,
      this.commitment,
      LIQUIDITY_HOOKS,
      {
        transferHookX: params.transferHookX,
        transferHookY: params.transferHookY,
      },
      claimingX
        ? {
            transferHookX: {
              mint: params.tokenXMint,
              source: reserve,
              destination: params.receiverTokenAccount,
              authority: poolAuthority,
              amount: async () => {
                const pool = await this.state.fetchPool(params.pool);
                const pending = pool.protocolFeeX;
                return pending.lt(params.maxAmount)
                  ? pending
                  : params.maxAmount;
              },
            },
          }
        : {
            transferHookY: {
              mint: params.tokenYMint,
              source: reserve,
              destination: params.receiverTokenAccount,
              authority: poolAuthority,
              amount: async () => {
                const pool = await this.state.fetchPool(params.pool);
                const pending = pool.protocolFeeY;
                return pending.lt(params.maxAmount)
                  ? pending
                  : params.maxAmount;
              },
            },
          },
    );
    const [tokenXProgram, tokenYProgram] = await Promise.all([
      params.tokenXProgram ??
        resolveTokenProgram(
          this.connection,
          params.tokenXMint,
          this.commitment,
        ),
      params.tokenYProgram ??
        resolveTokenProgram(
          this.connection,
          params.tokenYMint,
          this.commitment,
        ),
    ]);
    const tx = await this.program.methods
      .claimProtocolFee2(
        params.maxAmount,
        params.minAmount ?? new BN(0),
        hooks.remainingAccountsInfo,
      )
      .accountsPartial({
        receiverTokenAccount: params.receiverTokenAccount,
        tokenXMint: params.tokenXMint,
        tokenYMint: params.tokenYMint,
        tokenXProgram,
        tokenYProgram,
        pool: params.pool,
        reserveX: deriveReserve(params.tokenXMint, params.pool),
        reserveY: deriveReserve(params.tokenYMint, params.pool),
        signer: deriveProtocolFeeAuthority(),
        poolAuthority,
      })
      .remainingAccounts(hooks.remainingAccounts)
      .transaction();
    tx.feePayer = params.payer;
    return { tx };
  }
}
