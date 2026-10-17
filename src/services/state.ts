import type { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  type AccountInfo,
  type Commitment,
  type Connection,
} from "@solana/web3.js";
import { ACCESS_REGISTRY_PROGRAM_ID } from "../constants";
import type { DlmmProProvider } from "../dlmm_pro";
import { createAccessRegistryProgram } from "../helpers/create_program";
import type { AccessRegistry } from "../idl/access-registry/access_registry";
import type { DlmmPro } from "../idl/dlmm-pro/dlmm_pro";
import {
  decodeLimitOrderDataFromData,
  decodeObservationsFromData,
  decodePoolExtensionsFromData,
  decodePositionsFromData,
  decodeTicksFromData,
  isSupportExtension,
} from "../helpers/codec";
import {
  PoolExtension,
  type DecodePositionsOpts,
  type DecodeTicksOpts,
  type DecodedLimitOrderData,
  type DecodedObservation,
  type DecodedPoolExtensions,
  type DecodedPosition,
  type DecodedPositionWithReward,
  type DecodedTick,
  type DecodedTickWithReward,
  type DynamicConfig,
  type LimitOrder,
  type Operator,
  type Oracle,
  type Pool,
  type PositionArray,
  type StaticConfig,
  type TickArray,
  type TickArrayBitmapExtension,
  type TokenBadge,
} from "../types";

export class StateService {
  private readonly program: Program<DlmmPro>;
  private readonly accessRegistry: Program<AccessRegistry>;
  private readonly commitment: Commitment;
  private readonly connection: Connection;

  constructor(provider: DlmmProProvider) {
    this.program = provider.program;
    this.accessRegistry = createAccessRegistryProgram(provider.connection);
    this.commitment = provider.commitment;
    this.connection = provider.connection;
  }

  private async getAccountData(address: PublicKey): Promise<Buffer> {
    return this.ownedData(
      address,
      await this.connection.getAccountInfo(address, this.commitment),
    );
  }

  private ownedData(
    address: PublicKey,
    info: AccountInfo<Buffer> | null,
  ): Buffer {
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
    return {
      pool: this.program.coder.accounts.decode<Pool>("pool", data),
      extensions: decodePoolExtensionsFromData(data),
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
      positions: decodePositionsFromData(data, opts.withReward),
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
      const data = this.ownedData(tickArrayAddresses[index], info);
      return {
        tickArray: this.program.coder.accounts.decode<TickArray>(
          "tickArray",
          data,
        ),
        ticks: decodeTicksFromData(data, opts.withReward),
      };
    });
  }

  async fetchTickArrayBitmapExtension(
    extensionAddress: PublicKey,
  ): Promise<TickArrayBitmapExtension> {
    return this.fetchAccount(extensionAddress, "tickArrayBitmapExtension");
  }

  async fetchTokenBadge(address: PublicKey): Promise<TokenBadge> {
    const info = await this.connection.getAccountInfo(address, this.commitment);
    if (!info) {
      throw new Error(`Account not found: ${address.toBase58()}`);
    }
    if (!info.owner.equals(ACCESS_REGISTRY_PROGRAM_ID)) {
      throw new Error(
        `Account ${address.toBase58()} is not owned by the access-registry program`,
      );
    }
    return this.accessRegistry.coder.accounts.decode<TokenBadge>(
      "tokenBadge",
      info.data,
    );
  }

  async fetchOperator(operatorAddress: PublicKey): Promise<Operator> {
    return this.fetchAccount(operatorAddress, "operator");
  }

  async fetchOracle(oracleAddress: PublicKey): Promise<Oracle> {
    return this.fetchAccount(oracleAddress, "oracle");
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
    return decodePositionsFromData(data, withReward);
  }

  /** `withReward` must match the pool's liquidity-mining extension bit. */
  async decodeTicks(
    tickArrayAddress: PublicKey,
    opts: DecodeTicksOpts,
  ): Promise<DecodedTick[] | DecodedTickWithReward[]> {
    const data = await this.getAccountData(tickArrayAddress);
    return decodeTicksFromData(data, opts.withReward);
  }

  async decodeLimitOrderData(
    limitOrderAddress: PublicKey,
  ): Promise<DecodedLimitOrderData[]> {
    const data = await this.getAccountData(limitOrderAddress);
    return decodeLimitOrderDataFromData(data);
  }

  async decodeObservations(
    oracleAddress: PublicKey,
  ): Promise<DecodedObservation[]> {
    const data = await this.getAccountData(oracleAddress);
    return decodeObservationsFromData(data);
  }
}
