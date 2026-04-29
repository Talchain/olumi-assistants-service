/**
 * Narrow draft-coaching projection for the response envelope.
 *
 * `DraftGraphResult` carries `coachingWideningLog` and `coachingBiasSignals`
 * as `readonly unknown[] | null` to preserve byte-for-byte LLM output for
 * V5 ContextPack threading on later turns. The wire-facing
 * `OrchestratorResponseEnvelope.draft_coaching` uses typed display shapes.
 *
 * This helper narrows the raw arrays at the envelope boundary. Entries that
 * fail the narrow type-guard are dropped from the envelope copy; the cache
 * (consumed by V5 ContextPack) retains the original raw data unchanged.
 */
import type { DraftGraphResult } from "./tools/draft-graph.js";
import type {
  DraftCoaching,
  DraftCoachingWideningEntry,
  DraftCoachingBiasSignal,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function narrowWideningEntry(value: unknown): DraftCoachingWideningEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.node_id !== 'string') return null;
  if (typeof value.label !== 'string') return null;
  if (typeof value.reason !== 'string') return null;
  return { node_id: value.node_id, label: value.label, reason: value.reason };
}

function narrowBiasSignal(value: unknown): DraftCoachingBiasSignal | null {
  if (!isRecord(value)) return null;
  if (typeof value.type !== 'string') return null;
  if (typeof value.detail !== 'string') return null;
  const out: DraftCoachingBiasSignal = { type: value.type, detail: value.detail };
  if (typeof value.target === 'string') {
    out.target = value.target;
  }
  return out;
}

function narrowArray<T>(
  raw: readonly unknown[] | null | undefined,
  narrow: (v: unknown) => T | null,
): T[] | null {
  if (raw === null || raw === undefined) return null;
  const out: T[] = [];
  for (const entry of raw) {
    const narrowed = narrow(entry);
    if (narrowed !== null) out.push(narrowed);
  }
  return out;
}

/**
 * Build the envelope-facing `draft_coaching` payload from a `DraftGraphResult`.
 *
 * - `summary`: passes through (already `string | null`).
 * - `strengthen_items`: passes through (already typed via `StrengthenItem`,
 *   structurally identical to `DraftCoachingStrengthenItem`).
 * - `widening_log`: narrowed entry-by-entry; entries failing the guard are
 *   dropped. Returns `null` only when the source array is null.
 * - `bias_signals`: same narrowing pattern.
 */
export function buildDraftCoaching(result: DraftGraphResult): DraftCoaching {
  return {
    summary: result.coachingSummary ?? null,
    strengthen_items: result.strengthenItems ?? [],
    widening_log: narrowArray(result.coachingWideningLog, narrowWideningEntry),
    bias_signals: narrowArray(result.coachingBiasSignals, narrowBiasSignal),
  };
}
