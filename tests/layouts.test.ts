import { describe, expect, it } from "vitest";
import {
  decodeLimitOrderDataFromData,
  decodeObservationsFromData,
  decodePoolExtensionsFromData,
  decodePositionsFromData,
  decodeTicksFromData,
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

const TICK_ARRAY_HEADER_SIZE = 64;
const POSITION_ARRAY_HEADER_SIZE = 112;
const LIMIT_ORDER_HEADER_SIZE = 112;
const ORACLE_HEADER_SIZE = 56;

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
        TICK_ARRAY_HEADER_SIZE,
        false,
      ),
    ).toHaveLength(3);
    expect(
      decodeTicksFromData(
        accountData("TickArray", TICK_ARRAY_HEADER_SIZE, 192 * 2),
        TICK_ARRAY_HEADER_SIZE,
        true,
      ),
    ).toHaveLength(2);
    expect(
      decodePositionsFromData(
        accountData("PositionArray", POSITION_ARRAY_HEADER_SIZE, 128 * 2),
        POSITION_ARRAY_HEADER_SIZE,
        false,
      ),
    ).toHaveLength(2);
    expect(
      decodeLimitOrderDataFromData(
        accountData("LimitOrder", LIMIT_ORDER_HEADER_SIZE, 24 * 4),
        LIMIT_ORDER_HEADER_SIZE,
      ),
    ).toHaveLength(4);
    expect(
      decodeObservationsFromData(
        accountData("Oracle", ORACLE_HEADER_SIZE, 16 * 5),
        ORACLE_HEADER_SIZE,
      ),
    ).toHaveLength(5);
  });

  it("rejects data with a wrong discriminator", () => {
    const data = accountData("Pool", POSITION_ARRAY_HEADER_SIZE, 160 * 3);
    expect(() =>
      decodeTicksFromData(data, TICK_ARRAY_HEADER_SIZE, false),
    ).toThrow(/TickArray/);
    expect(() =>
      decodePositionsFromData(data, POSITION_ARRAY_HEADER_SIZE, false),
    ).toThrow(/PositionArray/);
    expect(() =>
      decodeLimitOrderDataFromData(data, LIMIT_ORDER_HEADER_SIZE),
    ).toThrow(/LimitOrder/);
    expect(() => decodeObservationsFromData(data, ORACLE_HEADER_SIZE)).toThrow(
      /Oracle/,
    );
    expect(() =>
      decodePoolExtensionsFromData(
        accountData("TickArray", TICK_ARRAY_HEADER_SIZE, 0),
        TICK_ARRAY_HEADER_SIZE,
        0,
      ),
    ).toThrow(/Pool/);
  });

  it("rejects data shorter than the header", () => {
    expect(() =>
      decodeObservationsFromData(
        accountData("Oracle", 8, 0),
        ORACLE_HEADER_SIZE,
      ),
    ).toThrow();
  });

  it("rejects trailing bytes that do not align to the element size", () => {
    expect(() =>
      decodeObservationsFromData(
        accountData("Oracle", ORACLE_HEADER_SIZE, 17),
        ORACLE_HEADER_SIZE,
      ),
    ).toThrow();
  });
});
