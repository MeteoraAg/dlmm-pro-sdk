import { Program } from "@coral-xyz/anchor";
import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { DlmmPro } from "../idl/dlmm_pro";
import { createDlmmProProgram } from "../helpers/create_program";
import {
  decodeLimitOrderDataFromData,
  decodeObservationsFromData,
  decodePoolExtensionsFromData,
  decodePositionsFromData,
  decodeTicksFromData,
  getBitmapSetIndicesFromPool,
  getExtensionBitmapSetIndicesFromState,
} from "../helpers/codec";
import type {
  DecodePositionsOpts,
  DecodeTicksOpts,
  DecodedLimitOrderData,
  DecodedObservation,
  DecodedPoolExtensions,
  DecodedPosition,
  DecodedPositionWithReward,
  DecodedTick,
  DecodedTickWithReward,
  DynamicConfig,
  LimitOrder,
  Operator,
  Oracle,
  Pool,
  PositionArray,
  StaticConfig,
  TickArray,
  TickArrayBitmapExtension,
  TokenBadge,
} from "../types";

export class StateService {
  program: Program<DlmmPro>;
  private commitment: Commitment;
  private connection: Connection;

  constructor(connection: Connection, commitment: Commitment) {
    const { program } = createDlmmProProgram(connection, commitment);
    this.program = program;
    this.commitment = commitment;
    this.connection = connection;
  }

  private async getAccountData(address: PublicKey): Promise<Buffer> {
    const info = await this.connection.getAccountInfo(address, this.commitment);
    if (!info) {
      throw new Error(`Account not found: ${address.toBase58()}`);
    }
    return Buffer.from(info.data);
  }

  /**
   * Fetch the pool account.
   * @param poolAddress - The address of the pool account.
   * @returns The pool account.
   */
  async fetchPool(poolAddress: PublicKey): Promise<Pool> {
    return this.program.account.pool.fetch(poolAddress, this.commitment);
  }

  /**
   * Fetch the static config account.
   * @param configAddress - The address of the static config account.
   * @returns The static config account.
   */
  async fetchStaticConfig(configAddress: PublicKey): Promise<StaticConfig> {
    return this.program.account.staticConfig.fetch(
      configAddress,
      this.commitment,
    );
  }

  /**
   * Fetch the dynamic config account.
   * @param configAddress - The address of the dynamic config account.
   * @returns The dynamic config account.
   */
  async fetchDynamicConfig(configAddress: PublicKey): Promise<DynamicConfig> {
    return this.program.account.dynamicConfig.fetch(
      configAddress,
      this.commitment,
    );
  }

  /**
   * Fetch the position array account.
   * @param positionArrayAddress - The address of the position array account.
   * @returns The position array account.
   */
  async fetchPositionArray(
    positionArrayAddress: PublicKey,
  ): Promise<PositionArray> {
    return this.program.account.positionArray.fetch(
      positionArrayAddress,
      this.commitment,
    );
  }

  /**
   * Fetch the limit order account.
   * @param limitOrderAddress - The address of the limit order account.
   * @returns The limit order account.
   */
  async fetchLimitOrder(limitOrderAddress: PublicKey): Promise<LimitOrder> {
    return this.program.account.limitOrder.fetch(
      limitOrderAddress,
      this.commitment,
    );
  }

  /**
   * Fetch the tick array account.
   * @param tickArrayAddress - The address of the tick array account.
   * @returns The tick array account.
   */
  async fetchTickArray(tickArrayAddress: PublicKey): Promise<TickArray> {
    return this.program.account.tickArray.fetch(
      tickArrayAddress,
      this.commitment,
    );
  }

  /**
   * Fetch the tick array bitmap extension account.
   * @param extensionAddress - The address of the tick array bitmap extension account.
   * @returns The tick array bitmap extension account.
   */
  async fetchTickArrayBitmapExtension(
    extensionAddress: PublicKey,
  ): Promise<TickArrayBitmapExtension> {
    return this.program.account.tickArrayBitmapExtension.fetch(
      extensionAddress,
      this.commitment,
    );
  }

  /**
   * Fetch the operator account.
   * @param operatorAddress - The address of the operator account.
   * @returns The operator account.
   */
  async fetchOperator(operatorAddress: PublicKey): Promise<Operator> {
    return this.program.account.operator.fetch(
      operatorAddress,
      this.commitment,
    );
  }

  /**
   * Fetch the token badge account.
   * @param tokenBadgeAddress - The address of the token badge account.
   * @returns The token badge account.
   */
  async fetchTokenBadge(tokenBadgeAddress: PublicKey): Promise<TokenBadge> {
    return this.program.account.tokenBadge.fetch(
      tokenBadgeAddress,
      this.commitment,
    );
  }

  /**
   * Fetch the oracle account.
   * @param oracleAddress - The address of the oracle account.
   * @returns The oracle account.
   */
  async fetchOracle(oracleAddress: PublicKey): Promise<Oracle> {
    return this.program.account.oracle.fetch(oracleAddress, this.commitment);
  }

  /**
   * Decode pool trailing extensions (rewards / activation) by fetching the pool account.
   * For already-loaded bytes, use `decodePoolExtensionsFromData` from helpers/codec.
   */
  async decodePoolExtensions(
    poolAddress: PublicKey,
  ): Promise<DecodedPoolExtensions> {
    const data = await this.getAccountData(poolAddress);
    const poolState = this.program.coder.accounts.decode<Pool>("pool", data);
    return decodePoolExtensionsFromData(
      data,
      this.program.account.pool.size,
      poolState.extensions,
    );
  }

  /**
   * Decode position slots after the fixed `PositionArray` header.
   * For already-loaded bytes, use `decodePositionsFromData` from helpers/codec.
   */
  async decodePositions(
    positionArrayAddress: PublicKey,
    opts: DecodePositionsOpts = {},
  ): Promise<DecodedPosition[] | DecodedPositionWithReward[]> {
    const data = await this.getAccountData(positionArrayAddress);
    return decodePositionsFromData(
      data,
      this.program.account.positionArray.size,
      opts.withReward ?? false,
    );
  }

  /**
   * Decode tick slots after the fixed `TickArray` header.
   * `withReward` must match the pool's liquidity-mining extension bit.
   * For already-loaded bytes, use `decodeTicksFromData` from helpers/codec.
   */
  async decodeTicks(
    tickArrayAddress: PublicKey,
    opts: DecodeTicksOpts,
  ): Promise<DecodedTick[] | DecodedTickWithReward[]> {
    const data = await this.getAccountData(tickArrayAddress);
    return decodeTicksFromData(
      data,
      this.program.account.tickArray.size,
      opts.withReward,
    );
  }

  /**
   * Decode `LimitOrderData` entries after the fixed `LimitOrder` header.
   * For already-loaded bytes, use `decodeLimitOrderDataFromData` from helpers/codec.
   */
  async decodeLimitOrderData(
    limitOrderAddress: PublicKey,
  ): Promise<DecodedLimitOrderData[]> {
    const data = await this.getAccountData(limitOrderAddress);
    return decodeLimitOrderDataFromData(
      data,
      this.program.account.limitOrder.size,
    );
  }

  /**
   * Decode oracle observation ring-buffer entries after the fixed `Oracle` header.
   * For already-loaded bytes, use `decodeObservationsFromData` from helpers/codec.
   */
  async decodeObservations(
    oracleAddress: PublicKey,
  ): Promise<DecodedObservation[]> {
    const data = await this.getAccountData(oracleAddress);
    return decodeObservationsFromData(data, this.program.account.oracle.size);
  }

  /**
   * Tick-array indices set in the pool's default bitmap (-512..511).
   * If you already have a `Pool`, use `getBitmapSetIndicesFromPool` from helpers/codec.
   */
  async getBitmapSetIndices(poolAddress: PublicKey): Promise<number[]> {
    const poolState = await this.fetchPool(poolAddress);
    return getBitmapSetIndicesFromPool(poolState);
  }

  /**
   * Tick-array indices set in the bitmap extension account.
   * If you already have extension state, use `getExtensionBitmapSetIndicesFromState`
   * from helpers/codec.
   */
  async getExtensionBitmapSetIndices(
    extensionAddress: PublicKey,
  ): Promise<number[]> {
    const extensionState =
      await this.fetchTickArrayBitmapExtension(extensionAddress);
    return getExtensionBitmapSetIndicesFromState(extensionState);
  }
}
