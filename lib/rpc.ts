// Minimal Bitcoin-style JSON-RPC client for the eCash/L2L mainchain node.
// Server-side only (reads credentials from env; talks to a localhost node).
//
// Defaults match a stock BitWindow L2L-Signet install; override via env:
//   ECASH_RPC_URL  (default http://127.0.0.1:38332)
//   ECASH_RPC_USER (default "user")
//   ECASH_RPC_PASS (default "password")

const RPC_URL = process.env.ECASH_RPC_URL ?? "http://127.0.0.1:38332";
const RPC_USER = process.env.ECASH_RPC_USER ?? "user";
const RPC_PASS = process.env.ECASH_RPC_PASS ?? "password";

const authHeader =
  "Basic " + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString("base64");

export async function rpc<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "text/plain;",
      authorization: authHeader,
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "dcft", method, params }),
    // Never cache at the fetch layer; the data layer handles TTL caching.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { result: T; error: unknown };
  if (json.error) {
    throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

/**
 * Run async work over `items` with bounded concurrency, preserving order.
 * Keeps request-time block scans fast without opening thousands of sockets.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
