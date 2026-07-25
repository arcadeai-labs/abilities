import { hc } from "hono/client";
import type { AppType } from "./app";

export const client = hc<AppType>(process.env.API_URL ?? "http://localhost:3000");

export type Client = typeof client;
