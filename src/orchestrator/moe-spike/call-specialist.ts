/**
 * MoE Spike — specialist caller.
 *
 * Calls GPT-4.1-mini for brief quality + bias detection.
 * Isolated from the critical path: own try/catch, own timeout. Never throws.
 *
 * briefHash is SHA-256 of the original untouched brief.
 * The specialist receives a truncated copy.
 */

import { createHash } from "node:crypto";
import { getAdapterForProvider } from "../../adapters/llm/router.js";
import { UpstreamTimeoutError, LLMTimeoutError } from "../../adapters/llm/errors.js";
import { MOE_SPIKE_SYSTEM_PROMPT } from "./prompt.js";
import { MoeSpikeResultPayload } from "./schemas.js";
import type { MoeSpikeResult } from "./schemas.js";

// ============================================================================
// Types
// ============================================================================

export interface SpikeCallResult {
  ok: true;
  result: MoeSpikeResult;
  briefHash: string;
  latencyMs: number;
}

export interface SpikeCallError {
  ok: false;
  error: string;
  briefHash: string;
  latencyMs: number;
}

export type SpikeCallOutcome = SpikeCallResult | SpikeCallError;

// ============================================================================
// Helpers
// ============================================================================

const MAX_BRIEF_CHARS = 3000;

/** Hash the original (untouched) brief — first 12 hex chars of SHA-256. */
export function hashBrief(brief: string): string {
  return createHash('sha256').update(brief).digest('hex').slice(0, 12);
}

/** Truncate on word boundary, append "..." if truncated. */
function truncateBrief(brief: string): string {
  if (brief.length <= MAX_BRIEF_CHARS) return brief;
  const cut = brief.lastIndexOf(' ', MAX_BRIEF_CHARS);
  const boundary = cut > 0 ? cut : MAX_BRIEF_CHARS;
  return brief.slice(0, boundary) + '...';
}

/**
 * Deduplicate bias_signals by bias_type (case-insensitive).
 * Keeps the entry with the highest confidence.
 */
function deduplicateBiasSignals(
  signals: MoeSpikeResult['bias_signals'],
): MoeSpikeResult['bias_signals'] {
  const best = new Map<string, MoeSpikeResult['bias_signals'][number]>();
  for (const s of signals) {
    const key = s.bias_type.toLowerCase();
    const existing = best.get(key);
    if (!existing || s.confidence > existing.confidence) {
      best.set(key, s);
    }
  }
  return [...best.values()];
}

// ============================================================================
// Main
// ============================================================================

/**
 * Call the brief quality specialist. Never throws.
 * If safeParse fails the entire result is an error — no partial use.
 */
export async function callBriefSpecialist(
  brief: string,
  requestId: string,
): Promise<SpikeCallOutcome> {
  const briefHash = hashBrief(brief);
  const start = Date.now();

  try {
    const adapter = getAdapterForProvider('openai', 'gpt-4.1-mini');
    const truncated = truncateBrief(brief);

    const chatResult = await adapter.chat(
      {
        system: MOE_SPIKE_SYSTEM_PROMPT,
        userMessage: truncated,
        temperature: 0,
        maxTokens: 500,
      },
      {
        requestId: `${requestId}:moe-spike`,
        timeoutMs: 5000,
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(chatResult.content);
    } catch {
      return {
        ok: false,
        error: 'JSON_PARSE_FAILED',
        briefHash,
        latencyMs: Date.now() - start,
      };
    }
    const validated = MoeSpikeResultPayload.safeParse(parsed);

    if (!validated.success) {
      return {
        ok: false,
        error: `ZOD_VALIDATION_FAILED: ${validated.error.issues.length} issues`,
        briefHash,
        latencyMs: Date.now() - start,
      };
    }

    const result: MoeSpikeResult = {
      ...validated.data,
      bias_signals: deduplicateBiasSignals(validated.data.bias_signals),
    };

    return { ok: true, result, briefHash, latencyMs: Date.now() - start };
  } catch (err) {
    // Coarse error code only — never log raw model output or freeform error text
    const code = (err instanceof UpstreamTimeoutError || err instanceof LLMTimeoutError)
      ? 'TIMEOUT'
      : 'ADAPTER_ERROR';
    return {
      ok: false,
      error: code,
      briefHash,
      latencyMs: Date.now() - start,
    };
  }
}
