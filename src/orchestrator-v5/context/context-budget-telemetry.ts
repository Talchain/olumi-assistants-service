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
 *     post-S1 (CEE_CONTEXT_DISCLOSURE_V2) that state is a bug the harness
 *     ratchet can enforce.
 *
 * S0 discipline: telemetry-additive ONLY. This module never throws, never
 * mutates its inputs, and changes zero prompt bytes. Budgets here are the
 * design pack's MEASUREMENT targets (03 §1) — nothing in S0 enforces them.
 */

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Budget tables (03 §1) — measurement targets, NOT enforcement
// ---------------------------------------------------------------------------

export type ContextBudgetCallSite =
  | 'routing'
  | 'edit_graph'
  | 'repair_edit_graph'
  | 'decision_review'
  | 'draft_graph';

interface SiteBudget {
  /** Per-section char budgets. Sections absent here are unbudgeted. */
  readonly sections: Readonly<Record<string, number>>;
  /** Whole-context char budget; null = instrumented but not budgeted. */
  readonly total: number | null;
}

/**
 * Verbatim from 03 §1. `conversation_summary` / `older_relevant_facts` /
 * `decision_records` budgets are pre-declared for layers that later slices
 * (S3/S4/S5) introduce — they measure as 0 until those ship, which is the
 * point: the dashboard shows the layer arriving.
 *
 * NOTE (edit_graph.conversation): the 03 §1 design budget is 6,000 chars
 * while today's enforced serialiser cap is 4,000 — S0 measures against the
 * design budget; the enforcement change is S4/S5 territory, not S0's.
 */
export const CONTEXT_SECTION_BUDGETS: Readonly<Record<ContextBudgetCallSite, SiteBudget>> = {
  routing: {
    sections: {
      conversation: 34_000,
      conversation_summary: 1_300,
      brief: 2_000,
      display_analysis: 4_000,
      display_graph: 8_000,
      older_relevant_facts: 3_000,
      rest: 2_500,
    },
    total: 55_000,
  },
  edit_graph: {
    sections: {
      graph_json: 8_000,
      conversation: 6_000,
      conversation_summary: 1_300,
      brief: 1_000,
    },
    total: 16_300,
  },
  repair_edit_graph: {
    // Same site budget as edit_graph — repair reuses the identical
    // contextSection (edit-graph.ts), it only swaps the system prompt.
    sections: {
      graph_json: 8_000,
      conversation: 6_000,
      conversation_summary: 1_300,
      brief: 1_000,
    },
    total: 16_300,
  },
  decision_review: {
    sections: {
      graph_json: 16_000,
      isl_results: 16_000,
      brief: 8_000,
      decision_records: 1_800,
      conversation_summary: 1_300,
    },
    total: 43_100,
  },
  draft_graph: {
    // Instrumented but NOT re-budgeted here — the 58,564-char draft prompt
    // is ROADMAP 1.75's scope (03 §1). Boundary kept deliberately.
    sections: {},
    total: null,
  },
};

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
  /** Bounded enum-ish string, e.g. 'hard_slice' | 'window_slice'. */
  readonly strategy: string;
  /** Whether the LLM can SEE that the cut happened (in-band disclosure). */
  readonly disclosed: boolean;
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
