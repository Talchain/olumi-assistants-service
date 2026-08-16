/**
 * Context Architecture v2 — S0 "measure first" (ROADMAP 1.73).
 *
 * Central emitters + budget tables for the two S0 telemetry events
 * (design pack `03-budgets-and-telemetry` §1–§2):
 *
 *   - `v5.context_budget` — once per LLM call: per-section char accounting,
 *     the per-call-site budget verdict, disclosed truncations, and the API
 *     response's `usage` block (ground-truth tokens). `chars_per_token` is
 *     measured continuously per call site (total_chars / input_tokens) so
 *     char-budget ↔ token drift self-reports on the dashboard.
 *
 *   - `v5.context_truncation` — emitted at the cut site the moment ANY
 *     content is dropped. `disclosed:false` marks a cut the LLM cannot see;
 *     with in-band disclosure now unconditional, the turn-path cut sites
 *     emit `disclosed:true` and a persistent `disclosed:false` is a bug the
 *     harness ratchet can enforce.
 *
 * S0 discipline: telemetry-additive ONLY. This module never throws, never
 * mutates its inputs, and changes zero prompt bytes. Budgets here are the
 * design pack's MEASUREMENT targets (03 §1) — nothing in S0 enforces them.
 */

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import {
  deriveContextSectionBudgets,
  emitContextPolicyDivergence,
  type BudgetTelemetryCallSite,
} from './context-policy.js';

// ---------------------------------------------------------------------------
// Budget tables — a DERIVED VIEW of CONTEXT_POLICY (ROADMAP 1.199, Q1 rule 2)
// ---------------------------------------------------------------------------

// The call-site enum is the same set the policy's derived view keys on.
export type ContextBudgetCallSite = BudgetTelemetryCallSite;

interface SiteBudget {
  /** Per-section char budgets. Sections absent here are unbudgeted. */
  readonly sections: Readonly<Record<string, number>>;
  /** Whole-context char budget; null = instrumented but not budgeted. */
  readonly total: number | null;
}

/**
 * The per-site char-budget table. Formerly a hand-authored parallel table that
 * DRIFTED from the enforced caps (decision_review `brief:8_000` vs enforced
 * 2_000; edit `conversation:6_000` vs enforced 4_000). It is now a DERIVED VIEW
 * of {@link CONTEXT_POLICY} (ROADMAP 1.199, Q1 rule 2 / Q5): every budget is
 * projected out of the policy's per-section `char_budget`, so the two mirrors
 * can no longer diverge. `conversation_summary` / `older_relevant_facts` /
 * `decision_records` remain pre-declared reservations (policy `unpopulated`),
 * measuring 0 until the layer that fills them ships — the dashboard still shows
 * the layer arriving. draft_graph stays instrumented-only (POST wave-1, P4).
 */
export const CONTEXT_SECTION_BUDGETS: Readonly<Record<ContextBudgetCallSite, SiteBudget>> =
  deriveContextSectionBudgets();

/**
 * Which sections (by name, plus the sentinel `'total'`) exceed the 03 §1
 * budgets for the call site. Unbudgeted sections never flag. Pure.
 */
export function computeOverBudget(
  callSite: ContextBudgetCallSite,
  sectionChars: Readonly<Record<string, number>>,
  totalChars: number,
): string[] {
  const budget = CONTEXT_SECTION_BUDGETS[callSite];
  const over: string[] = [];
  for (const [section, chars] of Object.entries(sectionChars)) {
    const cap = budget.sections[section];
    if (typeof cap === 'number' && typeof chars === 'number' && chars > cap) {
      over.push(section);
    }
  }
  if (budget.total !== null && typeof totalChars === 'number' && totalChars > budget.total) {
    over.push('total');
  }
  return over;
}

// ---------------------------------------------------------------------------
// v5.context_budget
// ---------------------------------------------------------------------------

/** Disclosed-truncation record carried inside `v5.context_budget`. */
export interface ContextTruncationRecord {
  readonly section: string;
  readonly original_chars: number;
  readonly kept_chars: number;
  readonly disclosed: boolean;
  /**
   * Item counts, for sections cut by ITEM rather than by chars (the
   * decision-records read drops whole records at the SQL LIMIT, whose chars
   * never enter the process and must not be invented). Absent on char-only
   * cuts. Additive: char-cut producers are unchanged.
   */
  readonly original_records?: number;
  readonly kept_records?: number;
}

/**
 * Token usage from the API response — ground truth (03 §3). Shapes vary by
 * adapter (`UsageMetrics`, `ChatWithToolsResult['usage']`, pipeline
 * `token_usage`) so every field is optional here and normalised to
 * number-or-null on the event.
 */
export interface ContextBudgetUsage {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
}

export interface ContextBudgetArgs {
  readonly call_site: ContextBudgetCallSite;
  /** Join keys mirroring ContextPackAssembled (null when unknown). */
  readonly model: string | null;
  readonly prompt_version: string | null;
  readonly prompt_hash: string | null;
  readonly request_id: string | null;
  readonly scenario_id: string | null;
  /** Char count per context section actually sent on this call. */
  readonly section_chars: Readonly<Record<string, number>>;
  readonly total_chars: number;
  /** Truncations that shaped this context (may be empty). */
  readonly truncations: readonly ContextTruncationRecord[];
  /** Summary staleness in turns — null until S4 ships the summary layer. */
  readonly summary_lag_turns: number | null;
  /**
   * True when the UI declared pre-narrowed analysis context via the
   * `analysis_state.narrowing` marker (02 Seam 4 [R8]); false when the
   * marker says un-narrowed; null when no marker (pre-S8u UIs).
   */
  readonly ui_narrowed: boolean | null;
  readonly usage: ContextBudgetUsage | undefined;
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Emit `v5.context_budget`. Never throws — a telemetry fault must never
 * fail a turn (same posture as every other emit site in this repo).
 */
export function emitContextBudget(args: ContextBudgetArgs): void {
  try {
    const inputTokens = numOrNull(args.usage?.input_tokens);
    const totalChars = numOrNull(args.total_chars);
    const charsPerToken =
      inputTokens !== null && inputTokens > 0 && totalChars !== null
        ? Math.round((totalChars / inputTokens) * 100) / 100
        : null;

    emit(TelemetryEvents.V5ContextBudget, {
      call_site: args.call_site,
      model: args.model,
      prompt_version: args.prompt_version,
      prompt_hash: args.prompt_hash,
      request_id: args.request_id,
      scenario_id: args.scenario_id,
      section_chars: args.section_chars,
      total_chars: args.total_chars,
      budget_chars: CONTEXT_SECTION_BUDGETS[args.call_site].total,
      over_budget: computeOverBudget(args.call_site, args.section_chars, args.total_chars),
      truncations: args.truncations,
      summary_lag_turns: args.summary_lag_turns,
      ui_narrowed: args.ui_narrowed,
      usage: {
        input_tokens: inputTokens,
        output_tokens: numOrNull(args.usage?.output_tokens),
        cache_read_input_tokens: numOrNull(args.usage?.cache_read_input_tokens),
        cache_creation_input_tokens: numOrNull(args.usage?.cache_creation_input_tokens),
      },
      chars_per_token: charsPerToken,
    });
  } catch (err) {
    log.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'v5.context_budget emit failed (swallowed — telemetry must never fail a turn)',
    );
  }
  // ROADMAP 1.199 — the ContextPolicy divergence tripwire rides the SAME
  // once-per-LLM-call seam, so it covers every migrated call site from one
  // insertion point (derive-don't-mirror). Observe-only, never throws; it fires
  // v5.context_policy.divergence only when the realised composition departs from
  // CONTEXT_POLICY (an undeclared section or an enforced section over budget).
  emitContextPolicyDivergence(
    args.call_site,
    args.section_chars,
    args.total_chars,
    args.request_id,
    args.scenario_id,
  );
}

// ---------------------------------------------------------------------------
// v5.context_truncation
// ---------------------------------------------------------------------------

export interface ContextTruncationArgs {
  /** Stable cut-site identifier, e.g. 'serialise.truncateGraphJson'. */
  readonly site: string;
  /** Context section the cut applies to, e.g. 'graph_json'. */
  readonly section: string;
  readonly original_chars: number;
  readonly kept_chars: number;
  /** Item counts for item-wise cuts — see {@link ContextTruncationRecord}. */
  readonly original_records?: number;
  readonly kept_records?: number;
  /** Bounded enum-ish string, e.g. 'hard_slice' | 'window_slice'. */
  readonly strategy: string;
  /** Whether the LLM can SEE that the cut happened (in-band disclosure). */
  readonly disclosed: boolean;
  /**
   * Whole-pack accounting for a cut driven by a call site's TOTAL budget
   * rather than by a per-section cap (Context/Memory V5 defect 3,
   * `enforceContextPackCeiling`). ABSENT on section-driven cuts, so every
   * pre-existing producer is unchanged. Present together or not at all: they
   * are one measurement (pack chars before → after, against the ceiling that
   * fired), and reading `after` without `budget` would invite the reader to
   * supply a number of their own.
   */
  readonly pack_total_chars_before?: number;
  readonly pack_total_chars_after?: number;
  readonly pack_total_budget?: number;
  /**
   * Present-and-true when the cut stopped at its RETENTION FLOOR while the
   * pack was still over the ceiling — the honest "this did not fit" signal.
   * Absent when the cut reached the target (never a noisy `false`), matching
   * the key-absence disclosure doctrine used across this pack.
   */
  readonly floor_reached?: true;
  readonly request_id?: string | null;
  readonly scenario_id?: string | null;
}

/** Emit `v5.context_truncation`. Never throws. */
export function emitContextTruncation(args: ContextTruncationArgs): void {
  try {
    emit(TelemetryEvents.V5ContextTruncation, {
      site: args.site,
      section: args.section,
      original_chars: args.original_chars,
      kept_chars: args.kept_chars,
      ...(args.original_records === undefined ? {} : { original_records: args.original_records }),
      ...(args.kept_records === undefined ? {} : { kept_records: args.kept_records }),
      ...(args.pack_total_chars_before === undefined
        ? {}
        : { pack_total_chars_before: args.pack_total_chars_before }),
      ...(args.pack_total_chars_after === undefined
        ? {}
        : { pack_total_chars_after: args.pack_total_chars_after }),
      ...(args.pack_total_budget === undefined ? {} : { pack_total_budget: args.pack_total_budget }),
      ...(args.floor_reached === undefined ? {} : { floor_reached: args.floor_reached }),
      strategy: args.strategy,
      disclosed: args.disclosed,
      request_id: args.request_id ?? null,
      scenario_id: args.scenario_id ?? null,
    });
  } catch (err) {
    log.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'v5.context_truncation emit failed (swallowed — telemetry must never fail a turn)',
    );
  }
}
