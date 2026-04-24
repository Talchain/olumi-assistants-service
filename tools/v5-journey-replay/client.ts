/**
 * V5 alpha hardening Phase 3 — tier-A HTTP client for /orchestrate/v2/turn.
 *
 * Standalone fetch wrapper — no UI dependency. Mirrors the payload shape
 * that route-v2.ts expects on the `message` ingress path (POST /turn).
 *
 * Log capture is stdout-only (correction 15). Staging evidence rows are
 * filled in manually by pasting relevant log lines.
 */

import type { TurnResponse } from './types.js';

export interface TurnPayload {
  readonly turn_id: string;
  readonly scenario_id: string;
  readonly message: string;
  readonly turn_class: 'decide' | 'frame' | 'analyse' | 'review';
  readonly stage: 'frame' | 'analyse' | 'decide' | 'review' | 'evaluate';
  readonly context?: {
    readonly graph?: unknown;
    readonly analysis_response?: unknown;
    readonly framing?: {
      readonly stage?: string;
      readonly goal?: string;
    };
    readonly messages?: ReadonlyArray<unknown>;
  };
}

export interface FetchResult {
  readonly status: number;
  readonly body: TurnResponse;
  readonly elapsed_ms: number;
}

export async function postTurn(
  baseUrl: string,
  payload: TurnPayload,
  timeoutMs = 60_000,
): Promise<FetchResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/orchestrate/v2/turn`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const elapsed = Date.now() - start;
    const body = (await res.json()) as TurnResponse;
    return { status: res.status, body, elapsed_ms: elapsed };
  } finally {
    clearTimeout(timer);
  }
}
