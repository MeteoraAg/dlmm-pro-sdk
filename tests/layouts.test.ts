import { Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  createDlmmProProgram,
  decodeLimitOrderDataFromData,
  decodeObservationsFromData,
  decodePoolExtensionsFromData,
  decodePositionsFromData,
  decodeTicksFromData,
  derivePoolAuthority,
  DlmmProIDL,
} from "../src";
import {
  LIMIT_ORDER_DATA_LAYOUT,
  OBSERVATION_LAYOUT,
  POOL_REWARD_INFO_LAYOUT,
  POSITION_LAYOUT,
  POSITION_WITH_REWARD_LAYOUT,
  TICK_LAYOUT,
  TICK_WITH_REWARD_LAYOUT,
} from "../src/helpers/layouts";

const TICK_ARRAY_HEADER_SIZE = 8 + 56;
const POSITION_ARRAY_HEADER_SIZE = 8 + 136;
const LIMIT_ORDER_HEADER_SIZE = 8 + 136;
const ORACLE_HEADER_SIZE = 8 + 48;

function accountData(name: string, headerSize: number, body: number): Buffer {
  const account = DlmmProIDL.accounts.find((a) => a.name === name);
  if (!account) {
    throw new Error(`IDL account not found: ${name}`);
  }
  const data = Buffer.alloc(headerSize + body, 0);
  data.set(account.discriminator, 0);
  return data;
}

describe("layout spans", () => {
  it("matches the program account sizes", () => {
    const program = createDlmmProProgram(
      new Connection("http://127.0.0.1:8899", "confirmed"),
    );
    expect(program.account.pool.size).toBe(8 + 640);
    expect(program.account.positionArray.size).toBe(POSITION_ARRAY_HEADER_SIZE);
    expect(program.account.limitOrder.size).toBe(LIMIT_ORDER_HEADER_SIZE);
    expect(program.account.tickArray.size).toBe(TICK_ARRAY_HEADER_SIZE);
    expect(program.account.oracle.size).toBe(ORACLE_HEADER_SIZE);
    expect(program.account.operator.size).toBe(8 + 48);
    expect(program.account.staticConfig.size).toBe(8 + 120);
    expect(program.account.dynamicConfig.size).toBe(8 + 80);
    expect(program.account.tickArrayBitmapExtension.size).toBe(8 + 800);

    const swap = DlmmProIDL.instructions.find(
      (instruction) => instruction.name === "swap",
    );
    const authority = swap?.accounts.find(
      (account) => account.name === "pool_authority",
    ) as { address?: string } | undefined;
    expect(authority?.address).toBe(derivePoolAuthority().toBase58());
  });

  it("matches the program INIT_SPACE values", () => {
    expect(TICK_LAYOUT.span).toBe(160);
    expect(TICK_WITH_REWARD_LAYOUT.span).toBe(192);
    expect(POSITION_LAYOUT.span).toBe(128);
    expect(POSITION_WITH_REWARD_LAYOUT.span).toBe(192);
    expect(POOL_REWARD_INFO_LAYOUT.span).toBe(176);
    expect(LIMIT_ORDER_DATA_LAYOUT.span).toBe(24);
    expect(OBSERVATION_LAYOUT.span).toBe(16);
  });
});

describe("raw account decoding", () => {
  it("decodes accounts with the expected discriminator", () => {
    expect(
      decodeTicksFromData(
        accountData("TickArray", TICK_ARRAY_HEADER_SIZE, 160 * 3),
        false,
      ),
    ).toHaveLength(3);
    expect(
      decodeTicksFromData(
        accountData("TickArray", TICK_ARRAY_HEADER_SIZE, 192 * 2),
        true,
      ),
    ).toHaveLength(2);
    expect(
      decodePositionsFromData(
        accountData("PositionArray", POSITION_ARRAY_HEADER_SIZE, 128 * 2),
        false,
      ),
    ).toHaveLength(2);
    expect(
      decodeLimitOrderDataFromData(
        accountData("LimitOrder", LIMIT_ORDER_HEADER_SIZE, 24 * 4),
      ),
    ).toHaveLength(4);
    expect(
      decodeObservationsFromData(
        accountData("Oracle", ORACLE_HEADER_SIZE, 16 * 5),
      ),
    ).toHaveLength(5);
  });

  it("rejects data with a wrong discriminator", () => {
    const data = accountData("Pool", POSITION_ARRAY_HEADER_SIZE, 160 * 3);
    expect(() => decodeTicksFromData(data, false)).toThrow(/TickArray/);
    expect(() => decodePositionsFromData(data, false)).toThrow(/PositionArray/);
    expect(() => decodeLimitOrderDataFromData(data)).toThrow(/LimitOrder/);
    expect(() => decodeObservationsFromData(data)).toThrow(/Oracle/);
    expect(() =>
      decodePoolExtensionsFromData(
        accountData("TickArray", TICK_ARRAY_HEADER_SIZE, 0),
      ),
    ).toThrow(/Pool/);
  });

  it("rejects data shorter than the header", () => {
    expect(() =>
      decodeObservationsFromData(accountData("Oracle", 8, 0)),
    ).toThrow("Account data shorter than Oracle header size");
  });

  it("rejects trailing bytes that do not align to the element size", () => {
    expect(() =>
      decodeObservationsFromData(accountData("Oracle", ORACLE_HEADER_SIZE, 17)),
    ).toThrow("Account data length does not align to Oracle element size");
  });
});
