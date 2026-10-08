import { neonConfig } from "@neondatabase/serverless";

// Neon's HTTP driver has no request timeout of its own, so on a flaky
// connection a query can hang forever and the UI just spins. Abort any
// request that takes longer than this so the caller gets a real error.
const QUERY_TIMEOUT_MS = 30_000;

neonConfig.fetchFunction = (input: RequestInfo | URL, init?: RequestInit) => {
  const timeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
  return fetch(input, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
};
