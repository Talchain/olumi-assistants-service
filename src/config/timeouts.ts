import { env } from "node:process";

const MIN_TIMEOUT_MS = 5_000; // 5s
const MAX_TIMEOUT_MS = 5 * 60_000; // 5m

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) return MIN_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, value));
}

function parseTimeoutEnv(name: string, defaultMs: number): number {
  const raw = env[name];
  if (!raw) return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultMs;
  return n;
}

function parseDelayEnv(name: string, defaultMs: number): number {
  const raw = env[name];
  if (!raw) return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultMs;
  return n;
}

export const HTTP_CLIENT_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("HTTP_CLIENT_TIMEOUT_MS", 110_000),
);

export const ROUTE_TIMEOUT_MS = clampTimeout(
  parseTimeoutEnv("ROUTE_TIMEOUT_MS", 115_000),
);

const DEFAULT_UPSTREAM_RETRY_DELAY_MS = 800; // Default centre of ~600–900ms jitter
export const UPSTREAM_RETRY_DELAY_MS = parseDelayEnv(
  "UPSTREAM_RETRY_DELAY_MS",
  DEFAULT_UPSTREAM_RETRY_DELAY_MS,
);

export function getJitteredRetryDelayMs(base: number = UPSTREAM_RETRY_DELAY_MS): number {
  // ±25% jitter around base delay (e.g. ~600–1_000ms for 800ms base)
  const jitter = Math.floor(base * 0.25);
  const min = Math.max(0, base - jitter);
  const max = base + jitter;
  if (max <= min) return base;
  return Math.floor(min + Math.random() * (max - min + 1));
}
