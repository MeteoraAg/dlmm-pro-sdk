import type { Program } from "@coral-xyz/anchor";
import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";
import { PoolExtension } from "../constants";
import type { DlmmProProvider } from "../dlmm_pro";
import type { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";
import {
  decodeLimitOrderDataFromData,
  decodeObservationsFromData,
  decodePoolExtensionsFromData,
  decodePositionsFromData,
  decodeTicksFromData,
  getBitmapSetIndicesFromPool,
  getExtensionBitmapSetIndicesFromState,
  isSupportExtension,
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
} from "../types";

export class StateService {
  private readonly program: Program<DlmmPro>;
  private readonly commitment: Commitment;
  private readonly connection: Connection;

  constructor(provider: DlmmProProvider) {
    this.program = provider.program;
    this.commitment = provider.commitment;
    this.connection = provider.connection;
  }

  private async getAccountData(address: PublicKey): Promise<Buffer> {
    const info = await this.connection.getAccountInfo(address, this.commitment);
    if (!info) {
      throw new Error(`Account not found: ${address.toBase58()}`);
    }
    if (!info.owner.equals(this.program.programId)) {
      throw new Error(
        `Account ${address.toBase58()} is not owned by the DLMM Pro program`,
      );
    }
    return Buffer.from(info.data);
  }

  private async fetchAccount<T>(
    address: PublicKey,
    accountName: string,
  ): Promise<T> {
    const data = await this.getAccountData(address);
    return this.program.coder.accounts.decode<T>(accountName, data);
  }

  async fetchPool(poolAddress: PublicKey): Promise<Pool> {
    return this.fetchAccount(poolAddress, "pool");
  }

  async fetchPoolWithExtensions(poolAddress: PublicKey): Promise<{
    pool: Pool;
    extensions: DecodedPoolExtensions;
  }> {
    const data = await this.getAccountData(poolAddress);
    const pool = this.program.coder.accounts.decode<Pool>("pool", data);
    return {
      pool,
      extensions: decodePoolExtensionsFromData(
        data,
        this.program.account.pool.size,
        pool.extensions,
      ),
    };
  }

  async fetchStaticConfig(configAddress: PublicKey): Promise<StaticConfig> {
    return this.fetchAccount(configAddress, "staticConfig");
  }

  async fetchDynamicConfig(configAddress: PublicKey): Promise<DynamicConfig> {
    return this.fetchAccount(configAddress, "dynamicConfig");
  }

  async fetchPositionArray(
    positionArrayAddress: PublicKey,
  ): Promise<PositionArray> {
    return this.fetchAccount(positionArrayAddress, "positionArray");
  }

  /** `withReward` must match the pool's liquidity-mining extension bit. */
  async fetchPositionArrayWithPositions(
    positionArrayAddress: PublicKey,
    opts: { withReward: boolean },
  ): Promise<{
    positionArray: PositionArray;
    positions: DecodedPosition[] | DecodedPositionWithReward[];
  }> {
    const data = await this.getAccountData(positionArrayAddress);
    return {
      positionArray: this.program.coder.accounts.decode<PositionArray>(
        "positionArray",
        data,
      ),
      positions: decodePositionsFromData(
        data,
        this.program.account.positionArray.size,
        opts.withReward,
      ),
    };
  }

  async fetchLimitOrder(limitOrderAddress: PublicKey): Promise<LimitOrder> {
    return this.fetchAccount(limitOrderAddress, "limitOrder");
  }

  async fetchTickArray(tickArrayAddress: PublicKey): Promise<TickArray> {
    return this.fetchAccount(tickArrayAddress, "tickArray");
  }

  async fetchTickArraysWithTicks(
    tickArrayAddresses: PublicKey[],
    opts: DecodeTicksOpts,
  ): Promise<
    {
      tickArray: TickArray;
      ticks: DecodedTick[] | DecodedTickWithReward[];
    }[]
  > {
    if (tickArrayAddresses.length === 0) {
      return [];
    }
    const infos = await this.connection.getMultipleAccountsInfo(
      tickArrayAddresses,
      this.commitment,
    );
    return infos.map((info, index) => {
      const address = tickArrayAddresses[index];
      if (!info) {
        throw new Error(`Account not found: ${address.toBase58()}`);
      }
      if (!info.owner.equals(this.program.programId)) {
        throw new Error(
          `Account ${address.toBase58()} is not owned by the DLMM Pro program`,
        );
      }
      const data = Buffer.from(info.data);
      return {
        tickArray: this.program.coder.accounts.decode<TickArray>(
          "tickArray",
          data,
        ),
        ticks: decodeTicksFromData(
          data,
          this.program.account.tickArray.size,
          opts.withReward,
        ),
      };
    });
  }

  async fetchTickArrayBitmapExtension(
    extensionAddress: PublicKey,
  ): Promise<TickArrayBitmapExtension> {
    return this.fetchAccount(extensionAddress, "tickArrayBitmapExtension");
  }

  async fetchOperator(operatorAddress: PublicKey): Promise<Operator> {
    return this.fetchAccount(operatorAddress, "operator");
  }

  async fetchOracle(oracleAddress: PublicKey): Promise<Oracle> {
    return this.fetchAccount(oracleAddress, "oracle");
  }

  async decodePoolExtensions(
    poolAddress: PublicKey,
  ): Promise<DecodedPoolExtensions> {
    return (await this.fetchPoolWithExtensions(poolAddress)).extensions;
  }

  async decodePositions(
    positionArrayAddress: PublicKey,
    opts: DecodePositionsOpts = {},
  ): Promise<DecodedPosition[] | DecodedPositionWithReward[]> {
    const data = await this.getAccountData(positionArrayAddress);
    let withReward = opts.withReward;
    if (withReward === undefined) {
      const positionArray = this.program.coder.accounts.decode<PositionArray>(
        "positionArray",
        data,
      );
      const pool = await this.fetchPool(positionArray.pool);
      withReward = isSupportExtension(
        pool.extensions,
        PoolExtension.LiquidityMining,
      );
    }
    return decodePositionsFromData(
      data,
      this.program.account.positionArray.size,
      withReward,
    );
  }

  /** `withReward` must match the pool's liquidity-mining extension bit. */
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

  async decodeLimitOrderData(
    limitOrderAddress: PublicKey,
  ): Promise<DecodedLimitOrderData[]> {
    const data = await this.getAccountData(limitOrderAddress);
    return decodeLimitOrderDataFromData(
      data,
      this.program.account.limitOrder.size,
    );
  }

  async decodeObservations(
    oracleAddress: PublicKey,
  ): Promise<DecodedObservation[]> {
    const data = await this.getAccountData(oracleAddress);
    return decodeObservationsFromData(data, this.program.account.oracle.size);
  }

  /** Tick-array indices set in the pool's default bitmap (-512..511). */
  async getBitmapSetIndices(poolAddress: PublicKey): Promise<number[]> {
    const poolState = await this.fetchPool(poolAddress);
    return getBitmapSetIndicesFromPool(poolState);
  }

  async getExtensionBitmapSetIndices(
    extensionAddress: PublicKey,
  ): Promise<number[]> {
    const extensionState =
      await this.fetchTickArrayBitmapExtension(extensionAddress);
    return getExtensionBitmapSetIndicesFromState(extensionState);
  }
}
