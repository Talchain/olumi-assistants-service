/**
 * Narrow draft-coaching projection for the response envelope.
 *
 * Two entry points share the per-entry type-guards below:
 *
 * 1. `buildDraftCoaching(result: DraftGraphResult)` — legacy orchestrator-tool
 *    path. `DraftGraphResult` carries `coachingWideningLog` and
 *    `coachingBiasSignals` as `readonly unknown[] | null` to preserve
 *    byte-for-byte LLM output for V5 ContextPack threading on later turns.
 *
 * 2. `narrowCoachingForResponse(coaching: unknown)` — unified-pipeline path.
 *    `ctx.coaching` is the raw passthrough object from the LLM adapter
 *    (typed `unknown` in StageContext) and arrives nested under
 *    `summary` / `strengthen_items` / `widening_log` / `bias_signals`.
 *
 * Both paths produce the same `DraftCoaching` display shape. Entries that
 * fail the narrow type-guard are dropped from the response copy; raw caches
 * (consumed by V5 ContextPack) retain the original data unchanged.
 */
import type { DraftGraphResult } from "./tools/draft-graph.js";
import type {
  DraftCoaching,
  DraftCoachingWideningEntry,
  DraftCoachingWideningLog,
  DraftCoachingBiasSignal,
  DraftCoachingStrengthenItem,
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

/**
 * v0.11.0 schema amendment: narrow the canonical `WideningLog` object
 * shape. Returns null for shape-invalid input. Legacy array shape is
 * converted to canonical at the Anthropic-adapter ingress seam, so by
 * the time narrowing runs the input is either canonical-object or
 * absent/null.
 */
function narrowWideningLog(value: unknown): DraftCoachingWideningLog | null {
  if (!isRecord(value)) return null;
  const elementsAdded = Array.isArray(value.elements_added)
    ? value.elements_added.filter((s): s is string => typeof s === 'string')
    : [];
  const excluded = Array.isArray(value.elements_considered_but_excluded)
    ? value.elements_considered_but_excluded.filter((s): s is string => typeof s === 'string')
    : [];
  const briefCompleteness =
    value.brief_completeness === 'complete' ||
    value.brief_completeness === 'partial' ||
    value.brief_completeness === 'thin'
      ? value.brief_completeness
      : 'thin';
  return {
    elements_added: elementsAdded,
    elements_considered_but_excluded: excluded,
    brief_completeness: briefCompleteness,
  };
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

function narrowStrengthenItem(value: unknown): DraftCoachingStrengthenItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.label !== 'string') return null;
  if (typeof value.detail !== 'string') return null;
  if (typeof value.action_type !== 'string') return null;
  const out: DraftCoachingStrengthenItem = {
    id: value.id,
    label: value.label,
    detail: value.detail,
    action_type: value.action_type,
  };
  if (typeof value.bias_category === 'string') {
    out.bias_category = value.bias_category;
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
  // Legacy path: `result.coachingWideningLog` is the pre-v0.11.0 array of
  // `{node_id,label,reason}` entries. Convert to the canonical
  // `DraftCoachingWideningLog` object shape — node_ids → elements_added,
  // reasons → elements_considered_but_excluded.
  const legacyEntries = narrowArray(result.coachingWideningLog, narrowWideningEntry);
  const widening: DraftCoachingWideningLog | null = legacyEntries
    ? {
        elements_added: legacyEntries.map((e) => e.node_id),
        elements_considered_but_excluded: legacyEntries.map((e) => e.reason),
        brief_completeness: 'thin',
      }
    : null;
  return {
    summary: result.coachingSummary ?? null,
    strengthen_items: result.strengthenItems ?? [],
    widening_log: widening,
    bias_signals: narrowArray(result.coachingBiasSignals, narrowBiasSignal),
  };
}

/**
 * Public unified-pipeline equivalent of `buildDraftCoaching`.
 *
 * Stage 5 of the unified pipeline carries the raw LLM coaching block on
 * `ctx.coaching` (typed `unknown`). This narrows it to the same display shape
 * that `buildDraftCoaching` produces from the legacy `DraftGraphResult` path,
 * so both routes converge on a single `DraftCoaching` type before egress.
 *
 * Returns `null` when the input is not a record (i.e. coaching was absent or
 * malformed). Individual sub-fields use the same per-entry guards as
 * `buildDraftCoaching`; entries that fail the guard are dropped.
 */
export function narrowCoachingForResponse(coaching: unknown): DraftCoaching | null {
  if (!isRecord(coaching)) return null;
  // Whitespace-only summaries are normalised to null so consumers don't have
  // to distinguish "" / "   " / null. hasMeaningfulCoaching also trims, but
  // doing it here keeps the wire shape consistent if other consumers read
  // the narrowed object directly.
  const summaryRaw = typeof coaching.summary === 'string' ? coaching.summary : null;
  const summary = summaryRaw !== null && summaryRaw.trim().length > 0 ? summaryRaw : null;
  const rawStrengthen = Array.isArray(coaching.strengthen_items) ? coaching.strengthen_items : null;
  const strengthenItems = narrowArray(rawStrengthen, narrowStrengthenItem) ?? [];
  // v0.11.0 schema amendment: narrow `widening_log` as the canonical
  // object shape. By the time this runs the Anthropic ingress normaliser
  // (`src/adapters/llm/normalise-legacy-coaching.ts`) has converted any
  // legacy array shape to the canonical object, so we narrow the object
  // form directly. Legacy paths should not reach this function.
  const widening = narrowWideningLog(coaching.widening_log);
  const rawBias = Array.isArray(coaching.bias_signals) ? coaching.bias_signals : null;
  return {
    summary,
    strengthen_items: strengthenItems,
    widening_log: widening,
    bias_signals: narrowArray(rawBias, narrowBiasSignal),
  };
}
