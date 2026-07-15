/**
 * V5 — Recent-changes projection for the LLM-facing ContextPack.
 *
 * Projects up to {@link RECENT_CHANGES_CAP} successful mutation facts from
 * `prior_facts` into a compact, decision-language summary the routing LLM
 * can ground its answer on. Fixes the Phase 0 information-starvation
 * finding: prior facts were persisted and read back correctly, but the
 * ContextPack only carried `last_tool_used` (a string), so on a follow-up
 * state-query Sonnet had no payload to reference and fell to the legacy
 * `edit_graph` catch-all.
 *
 * Hard contract:
 *   - **No raw structural identifiers** in the summary string. No
 *     `constraint_id`, `node_id`, `target_id`, edge IDs, UUIDs, or
 *     `provenance` markers. The summary is what a user would say.
 *   - **Cap is hard.** Maximum {@link RECENT_CHANGES_CAP} entries; each
 *     summary is truncated to {@link RECENT_CHANGES_SUMMARY_MAX_CHARS}
 *     characters (with an ellipsis marker if truncated). The cap protects
 *     the routing prompt token budget — `recent_changes` cannot grow
 *     unbounded as the conversation extends.
 *   - **Successful mutations only.** Noop facts (no actual change)
 *     and non-mutation fact types are filtered out.
 *
 * What this module does NOT do:
 *   - Hash identifiers. The projection drops them entirely; do not
 *     "redact" them, leave them out.
 *   - Reach into the live graph. All fields it needs come off the
 *     fact's `before`/`after` snapshots. Edge summaries stay generic
 *     because the fact does not carry node labels.
 *   - Touch the wire response. `recent_changes` is internal context
 *     only; the boundary `graph_patch` block schema is unchanged.
 */

import { createHash } from 'node:crypto';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { isNoopFact } from '../tools/fact-noop.js';
import {
  formatConstraintAdded,
  formatConstraintUpdated,
  formatFactorChange,
} from '../tools/handlers/d1-shared/format-confirmation.js';

/**
 * Maximum number of recent-change entries projected into the ContextPack.
 *
 * Three is enough for "what just changed?" follow-ups (the user is almost
 * always referring to the most recent action) without bloating the prompt.
 * If the conversation has more mutations than this, the oldest fall off
 * the projection — they remain in the database for replay and analytics.
 */
export const RECENT_CHANGES_CAP = 3;

/**
 * Maximum characters per summary string. Targets the ~80 char cap from
 * the implementation brief. Realistic outputs sit at 40–65 chars; the
 * truncation guard catches pathological inputs (very long node labels,
 * unusual unit strings) so a single mutation cannot blow the prompt
 * budget.
 */
export const RECENT_CHANGES_SUMMARY_MAX_CHARS = 80;

/**
 * Permitted change-type discriminators. PRODUCT-DOMAIN VALUES — these
 * strings ship in the LLM-facing payload (and the assistant_text path
 * via the state-query guard), so they are deliberately phrased as
 * decision-language outcomes rather than handler ids. Mapping to the
 * underlying handler set:
 *
 *   constraint_added       ← `add_constraint` handler (D1)
 *   factor_value_updated   ← `set_factor_value` handler (D1)
 *   link_strength_updated  ← `adjust_edge_strength` handler (D1)
 *
 * Keeping this enum separate from `HandlerFact['fact_type']` means
 * Sonnet cannot accidentally echo internal handler ids back at the
 * user. Additions here MUST coincide with a `summariseMutation` branch
 * AND a documented mapping above.
 */
export type RecentChangeAction =
  | 'constraint_added'
  | 'factor_value_updated'
  | 'link_strength_updated'
  // 0.12.0 — DL-7 PR B: LLM-driven graph edits via the `edit_graph`
  // dispatcher. Companion to the three D1 mutation actions above.
  // Mapping: `'graph_edited'` ← `EditGraphHandlerFact` (any
  // `edit_kind`). The fact's `safe_summary` is quoted verbatim as
  // the projection's `summary`; `affected_entities[0].label` becomes
  // the `target_label`. The schema-side `noop=true` filter at
  // `summariseMutation` line 134 already covers the emitter-safety
  // contract for "noop facts not surfaced as successful changes".
  | 'graph_edited';

export interface RecentMutation {
  /** Discriminator. Used by Sonnet and the deterministic state-query guard. */
  readonly action: RecentChangeAction;
  /**
   * One-line decision-language summary. No identifiers, no internal
   * terms. Capped at {@link RECENT_CHANGES_SUMMARY_MAX_CHARS}; truncated
   * with an ellipsis marker when the source string exceeds the cap.
   */
  readonly summary: string;
  /**
   * Decision-language label of the entity the mutation targeted (e.g.
   * "Total cost" for an `add_constraint` on the cost factor; "Customer
   * churn" for a `set_factor_value`). Surfaced separately from
   * `summary` so future deterministic copy paths (state-query guard,
   * follow-up receipts, UI handoff) can reference the target without
   * regex-parsing the summary string.
   *
   * Empty string when the fact lacks a clean label (defensive — production
   * mutation facts always carry one). Edge mutations have no single
   * target label so this falls back to a generic descriptor.
   */
  readonly target_label: string;
}

/**
 * Project the recent successful mutations from `prior_facts` into the
 * ContextPack. Caller MUST pass facts ordered newest-first (matching
 * `SessionStore.readFactsFor` which orders by `created_at DESC`).
 *
 * Returns a frozen, possibly-empty array. Never throws — bad/unknown
 * fact shapes are skipped silently so a single corrupt fact cannot
 * blank the entire projection.
 */
export function projectRecentChanges(
  priorFacts: readonly HandlerFact[] | undefined,
): readonly RecentMutation[] {
  if (!priorFacts || priorFacts.length === 0) return Object.freeze([]);

  const out: RecentMutation[] = [];
  for (const fact of priorFacts) {
    if (out.length >= RECENT_CHANGES_CAP) break;
    const summarised = summariseMutation(fact);
    if (summarised) out.push(summarised);
  }
  return Object.freeze(out);
}

function summariseMutation(fact: HandlerFact): RecentMutation | null {
  // Successful mutations only — noops carry no user-visible change to
  // reference. `isNoopFact` is the shared predicate (tools/fact-noop.ts);
  // the coaching-signal detector gates on the same one, so the two
  // channels cannot drift apart on what "no change" means.
  if (isNoopFact(fact)) return null;

  if (fact.fact_type === 'add_constraint') {
    return summariseAddConstraint(fact.result);
  }
  if (fact.fact_type === 'set_factor_value') {
    return summariseSetFactorValue(fact.result);
  }
  if (fact.fact_type === 'adjust_edge_strength') {
    // Edge facts do not carry node labels, only IDs. Without a graph
    // lookup at projection time we keep the summary intentionally
    // generic — Sonnet still sees that an edge change happened.
    return {
      action: 'link_strength_updated',
      summary: cap('Adjusted a link in the decision model.'),
      target_label: 'a link in the decision model',
    };
  }
  if (fact.fact_type === 'edit_graph') {
    return summariseEditGraph(fact.result);
  }
  return null;
}

/**
 * Project a successful `EditGraphHandlerFact` (DL-7 PR B) into a
 * `RecentMutation`. Reads `safe_summary` verbatim — it has already
 * been sanitised at the emitter (raw-ID scrub + Phase 2A jargon
 * guard + 80-char cap) — so no further sanitisation here, and the
 * `cap()` wrapper is just a defence-in-depth re-application.
 *
 * `target_label` is taken from the first affected entity. The
 * fact's schema requires `safe_summary.min(1)` and each entity's
 * `label.min(1)`, so both are non-empty when the fact arrives here;
 * the `?? 'the decision model'` fallback handles the rare case of
 * an empty `affected_entities` array (allowed by the schema for
 * structural-without-target edits).
 */
function summariseEditGraph(
  result: Record<string, unknown> | undefined,
): RecentMutation | null {
  if (!result || typeof result !== 'object') return null;
  // Defence in depth: the schema's `status` enum is `'applied' | 'noop'`
  // today and the dispatcher's `isSuccessfulAppliedMutation` gate
  // already excludes rejected edits from emitting a fact at all.
  // Filtering on 'noop' AND 'rejected' here is belt-and-braces: if a
  // future schema bump adds a 'rejected' literal (or any non-applied
  // status), the projection treats it as not-surface-able. The
  // top-level `isNoopFact` filter in `summariseMutation` is the
  // primary gate; this is the secondary.
  const status = (result as { status?: unknown }).status;
  if (status === 'noop' || status === 'rejected') return null;
  const safeSummary = (result as { safe_summary?: unknown }).safe_summary;
  if (typeof safeSummary !== 'string' || safeSummary.length === 0) return null;
  const entities = (result as { affected_entities?: unknown }).affected_entities;
  const firstLabel =
    Array.isArray(entities) && entities.length > 0 && typeof entities[0]?.label === 'string'
      ? entities[0].label
      : 'the decision model';
  return {
    action: 'graph_edited',
    summary: cap(safeSummary),
    target_label: firstLabel,
  };
}

function summariseAddConstraint(
  result: Record<string, unknown> | undefined,
): RecentMutation | null {
  if (!result || typeof result !== 'object') return null;
  const after = (result as { after?: unknown }).after;
  const before = (result as { before?: unknown }).before;
  if (!isRecord(after)) return null;

  const operator = readOperator(after.operator);
  if (operator === null) return null;
  const value = typeof after.value === 'number' ? after.value : null;
  if (value === null || !Number.isFinite(value)) return null;

  // Defensive: the constraint label is always present on a well-formed
  // GoalConstraint, but if the persisted shape lacks it (older facts,
  // partial writes) we leave the summary generic rather than fabricate
  // a target name.
  const label = readNonEmptyString(after.label) ?? 'this factor';
  const unit = readNonEmptyString(after.unit);

  // `before` is null on a fresh add, populated on an in-place update.
  const isUpdate = isRecord(before);
  const formatter = isUpdate ? formatConstraintUpdated : formatConstraintAdded;
  const summary = formatter({
    targetLabel: label,
    operator,
    value,
    ...(unit !== undefined ? { unit } : {}),
  });

  return {
    action: 'constraint_added',
    summary: cap(summary),
    target_label: label,
  };
}

function summariseSetFactorValue(
  result: Record<string, unknown> | undefined,
): RecentMutation | null {
  if (!result || typeof result !== 'object') return null;
  const after = (result as { after?: unknown }).after;
  const before = (result as { before?: unknown }).before;
  if (!isRecord(after) || !isRecord(before)) return null;

  // `formatFactorChange` reads raw_value with a fallback to value, plus
  // optional unit and label. We mirror the handler-side resolution.
  const beforeValue = numericFrom(before, ['raw_value', 'value']);
  const afterValue = numericFrom(after, ['raw_value', 'value']);
  if (beforeValue === null || afterValue === null) return null;

  const label =
    readNonEmptyString(after.label) ??
    readNonEmptyString(before.label) ??
    'a factor';

  const beforeUnit = readNonEmptyString(before.unit);
  const afterUnit = readNonEmptyString(after.unit);

  const summary = formatFactorChange({
    label,
    before: {
      raw_value: beforeValue,
      ...(beforeUnit !== undefined ? { unit: beforeUnit } : {}),
    },
    after: {
      raw_value: afterValue,
      ...(afterUnit !== undefined ? { unit: afterUnit } : {}),
    },
  });

  return {
    action: 'factor_value_updated',
    summary: cap(summary),
    target_label: label,
  };
}

// -----------------------------------------------------------------------
// helpers — kept private; tests exercise them through projectRecentChanges
// -----------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readOperator(v: unknown): '>=' | '<=' | null {
  return v === '>=' || v === '<=' ? v : null;
}

function readNonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

function numericFrom(
  rec: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Truncate to {@link RECENT_CHANGES_SUMMARY_MAX_CHARS}. We append a single
 * ellipsis character (U+2026) on truncation so the budget guarantee
 * remains exact and the cut is visible. Strings within budget are
 * returned unchanged.
 */
function cap(s: string): string {
  if (s.length <= RECENT_CHANGES_SUMMARY_MAX_CHARS) return s;
  // Reserve one char for the ellipsis marker so the post-truncation
  // string is exactly RECENT_CHANGES_SUMMARY_MAX_CHARS characters long.
  return `${s.slice(0, RECENT_CHANGES_SUMMARY_MAX_CHARS - 1)}…`;
}

// E4 sentinel returned for empty inputs. Stable, distinguishable from a real
// hash so log readers do not confuse "no recent changes" with a hash that
// happens to render as twelve zero hex digits.
export const RECENT_CHANGES_HASH_EMPTY = 'empty';

// Twelve hex chars = 48 bits = roughly one collision per 16M entries; matches
// the project's existing short-hash conventions (graph hashes, fact hashes).
const RECENT_CHANGES_HASH_LENGTH = 12;

/**
 * E4 — short content hash for the curated `recent_changes` projection.
 *
 * Used as pre-LLM telemetry evidence in the routing payload assembly so
 * operators can prove `recent_changes` reached the LLM-bound context
 * without logging the curated content itself. Returns
 * {@link RECENT_CHANGES_HASH_EMPTY} when the input has no entries.
 *
 * Canonicalisation: stable key order on each entry (`action`, `summary`,
 * `target_label`) and array order preserved (newest-first, matching
 * {@link projectRecentChanges}). SHA-256, truncated to twelve hex
 * characters.
 *
 * **Not** a security primitive. Two different curated payloads with the
 * same prefix-of-12 hex chars are theoretically possible; for E4 evidence
 * that risk is acceptable because the operator only needs to distinguish
 * "same payload across calls" from "different payload across calls".
 */
export function computeRecentChangesHash(items: readonly RecentMutation[]): string {
  if (items.length === 0) return RECENT_CHANGES_HASH_EMPTY;
  const canonical = items.map((m) => ({
    action: m.action,
    summary: m.summary,
    target_label: m.target_label,
  }));
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, RECENT_CHANGES_HASH_LENGTH);
}

/**
 * E4 — derive the pre-LLM telemetry payload for `recent_changes` from a
 * possibly-malformed source. Tolerates the regression case where the
 * field is missing, `null`, or a non-array; in those cases reports
 * `field_present: false`, `count: 0`, and the empty-sentinel hash so
 * the regression is detectable from logs without a code-search.
 *
 * Extracted into its own helper for unit-testability — the route-level
 * emit site in `turn-executor.ts` is hard to reach with a malformed
 * context pack, but the regression signal is exactly what operators
 * need from this telemetry.
 *
 * Type signature deliberately accepts `unknown` as the source field so
 * callers don't have to widen the type at the emit site.
 */
export interface RecentChangesEvidence {
  readonly count: number;
  readonly field_present: boolean;
  readonly hash: string;
}

export function deriveRecentChangesEvidence(
  source: { readonly recent_changes?: unknown },
): RecentChangesEvidence {
  const field = source.recent_changes;
  if (!Array.isArray(field)) {
    return { count: 0, field_present: false, hash: RECENT_CHANGES_HASH_EMPTY };
  }
  const items = field as readonly RecentMutation[];
  return {
    count: items.length,
    field_present: true,
    hash: computeRecentChangesHash(items),
  };
}
