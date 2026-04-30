/**
 * V5 journey replay — direct client for `/assist/v1/draft-graph`.
 *
 * Used by the `1a_assist_draft_graph` step to obtain coaching + per-node /
 * per-edge provenance data, which the orchestrator turn endpoint
 * (`/orchestrate/v2/turn`) does not expose on its envelope.
 *
 * Mirrors the payload contract in
 * [src/routes/assist.v1.draft-graph.ts](../../src/routes/assist.v1.draft-graph.ts)
 * and the request schema `DraftGraphInput` in
 * [src/schemas/assist.ts](../../src/schemas/assist.ts) (brief: 30..5000 chars).
 *
 * Authentication, redaction, and JSON-parse-fingerprint behaviour mirror
 * `client.ts:postTurn` so existing assertions / evidence rows compose.
 */

import { createHash } from 'node:crypto';

import { sanitiseError } from './redact.js';
import type { TurnResponse } from './types.js';
import type { FetchResult } from './client.js';

export interface AssistDraftGraphPayload {
  readonly brief: string;
}

function buildAuthHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) {
    headers['x-olumi-assist-key'] = apiKey;
  }
  return headers;
}

export async function postDraftGraph(
  baseUrl: string,
  payload: AssistDraftGraphPayload,
  timeoutMs = 30_000,
  apiKey?: string,
): Promise<FetchResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/draft-graph`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(apiKey),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      throw sanitiseError(err, apiKey);
    }
    const elapsed = Date.now() - start;
    let raw = '';
    try {
      raw = await res.text();
    } catch {
      raw = '';
    }
    let body: TurnResponse;
    try {
      body = JSON.parse(raw) as TurnResponse;
    } catch {
      const contentType =
        typeof res.headers?.get === 'function' ? (res.headers.get('content-type') ?? '') : '';
      const sha256Prefix = createHash('sha256').update(raw).digest('hex').slice(0, 8);
      body = {
        __body_parse_failed: true,
        __body_length: raw.length,
        __body_content_type: contentType,
        __body_sha256_prefix: sha256Prefix,
      };
    }
    return { status: res.status, body, elapsed_ms: elapsed };
  } finally {
    clearTimeout(timer);
  }
}
