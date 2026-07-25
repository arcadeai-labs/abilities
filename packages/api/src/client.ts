import { hc, type ClientRequestOptions } from "hono/client";
import type { AppType } from "./app";

/**
 * Typed RPC over the same route table the server is built from. The base URL is
 * the caller's to supply, because the app answers at `/api` behind the frontend
 * and at `/` when the standalone server runs it. A browser can pass the bare path
 * `/api`; anything off-origin needs the full URL.
 */
export const createClient = (baseUrl: string, options?: ClientRequestOptions) =>
  hc<AppType>(baseUrl, options);

export type Client = ReturnType<typeof createClient>;

export type { AppType };
