import { Connection, PublicKey, type FetchFn } from "@solana/web3.js";
import type { LiteSVM } from "litesvm";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown[];
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
};

const METHOD_NOT_FOUND = -32601;

// web3.js requests base64 for every account read the SDK makes.
function encodeAccount(svm: LiteSVM, address: string) {
  const account = svm.getAccount(new PublicKey(address));
  if (!account) {
    return null;
  }

  const data = Buffer.from(account.data);
  return {
    lamports: account.lamports,
    owner: account.owner.toBase58(),
    data: [data.toString("base64"), "base64"],
    executable: account.executable,
    rentEpoch: account.rentEpoch,
    space: data.length,
  };
}

function respond(svm: LiteSVM, request: JsonRpcRequest): JsonRpcResponse {
  const { id, method } = request;
  const params = request.params ?? [];
  const slot = Number(svm.getClock().slot);
  const context = { slot };
  const ok = (result: unknown): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    result,
  });

  switch (method) {
    case "getAccountInfo": {
      const address = params[0] as string;
      return ok({ context, value: encodeAccount(svm, address) });
    }
    case "getMultipleAccounts": {
      const addresses = params[0] as string[];
      return ok({
        context,
        value: addresses.map((address) => encodeAccount(svm, address)),
      });
    }
    case "getLatestBlockhash":
      return ok({
        context,
        value: {
          blockhash: svm.latestBlockhash(),
          lastValidBlockHeight: slot,
        },
      });
    case "getBalance": {
      const account = svm.getAccount(new PublicKey(params[0] as string));
      return ok({ context, value: account ? account.lamports : 0 });
    }
    case "getMinimumBalanceForRentExemption":
      return ok(
        Number(svm.minimumBalanceForRentExemption(BigInt(params[0] as number))),
      );
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: METHOD_NOT_FOUND,
          message: `LiteSVM connection does not support RPC method: ${method}`,
        },
      };
  }
}

/**
 * A web3.js Connection whose JSON-RPC transport is served from LiteSVM state,
 * so Anchor and the SDK read the local bank instead of a live RPC node.
 */
export function createSvmConnection(svm: LiteSVM): Connection {
  const fetch: FetchFn = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as
      JsonRpcRequest | JsonRpcRequest[];
    const payload = Array.isArray(body)
      ? body.map((request) => respond(svm, request))
      : respond(svm, body);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return new Connection("http://127.0.0.1:8899", {
    commitment: "confirmed",
    fetch,
  });
}
