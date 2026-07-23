/**
 * Context Policy — the single declared, conformance-tested statement of "what
 * does each LLM call site put in front of a model, at what size, in what order"
 * (CONTEXT-POLICY-DESIGN-2026-07-23, ROADMAP 1.199 Lane B; wave-5 lanes P1-P3).
 *
 * This module is NOT a hand-authored mirror of the assemblers. It is a
 * DECLARATION whose fidelity to the live assemblers is proven two ways, both
 * DERIVED — never a second copy anyone must remember to sync (the estate's
 * dominant defect class, platform CLAUDE.md trap #12):
 *
 *   1. CI conformance (`__tests__/context-policy.conformance.test.ts`) runs the
 *      REAL assembler over a realistic fixture, OBSERVES the serialised
 *      composition (ordered section names + realised char sizes), and asserts
 *      it matches the declared row EXACTLY — with a POSITIVE CONTROL (inject a
 *      stray/over-budget section → the check must go RED) so an absence
 *      assertion is never vacuous (trap #13). This is the #636
 *      enrichment-manifest Proxy-observe pattern applied at section granularity.
 *   2. The runtime tripwire {@link emitContextPolicyDivergence} fires
 *      `v5.context_policy.divergence` on LIVE traffic (the shapes no fixture
 *      carries) when the realised composition departs from the policy —
 *      observe-only, never throws, logs names never values (mirrors
 *      `emitUnknownEnrichmentKeyTelemetry`). Called once per LLM call from the
 *      one `emitContextBudget` seam, so it covers every site uniformly.
 *
 * ── Budgets are DERIVED, never re-typed ────────────────────────────────────
 * Where a section is bounded by a real enforcement constant, {@link char_budget}
 * IMPORTS that constant (so a change to the constant moves the policy row with
 * NO edit here). Two such imports are CYCLE-SAFE and used as the derived-budget
 * proof: `DISPLAY_ANALYSIS_CHAR_BUDGET` (format-analysis) and
 * `CONTEXT_PACK_BRIEF_CHAR_CAP` (context-pack-schema). Four other enforcement
 * constants live in modules that import `context-budget-telemetry` (which imports
 * THIS module for the derived budget view) — importing them here would form a
 * cycle, so they are declared as LOCAL constants and PINNED equal to their
 * originals by the conformance test (the sanctioned `enrichment-manifest`
 * sanitiser precedent: a local replica + a fail-loud parity pin). A section
 * whose number is genuinely hand-written with no importable ceiling is tagged
 * `telemetry_only` — the honest label, never a false `enforced` (Q5).
 *
 * ── Scope (wave-5 P1-P3) ───────────────────────────────────────────────────
 * Six call sites are declared here: coach_converse, edit_graph,
 * repair_edit_graph, decision_review, chip_run, clarify. The two DRAFT rows
 * (draft_structural, draft_coaching) are POST-wave-1 (the draft train is
 * mid-flight); P4 widens {@link ContextCallSite} additively and adds them, plus
 * the namesake-twin kill. This module makes no claim about the draft path.
 */

import {
  DISPLAY_ANALYSIS_CHAR_BUDGET,
  DISPLAY_ANALYSIS_TRUNCATION_ORDER,
} from '../format/format-analysis-for-context.js';
import { CONTEXT_PACK_BRIEF_CHAR_CAP } from './context-pack-schema.js';
import { log } from '../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Local enforcement-constant replicas (CYCLE-SAFE) — pinned to their originals
// by the conformance test. See module header for why these are not imported.
// ---------------------------------------------------------------------------

/** = `EDIT_CONTEXT_BRIEF_CHAR_CAP` (serialise.ts). Pinned by conformance. */
export const POLICY_EDIT_BRIEF_CHAR_CAP = 1_000;
/** = `DECISION_REVIEW_MAX_BRIEF_CHARS` (cee/decision-review/invoke.ts). Pinned. */
export const POLICY_DECISION_REVIEW_BRIEF_CHAR_CAP = 2_000;
/** = `CONTEXT_PACK_RECENT_TURNS_CAP` (context-pack-assembler.ts). Pinned. */
export const POLICY_VERBATIM_TURNS = 5;
/** = `MAX_PROJECTED_OPTIONS` (context-pack-assembler.ts). Pinned. */
export const POLICY_MAX_PROJECTED_OPTIONS = 12;
/** Edit-context graph-JSON serialiser cap (serialise default `maxGraphBytes`). */
const POLICY_EDIT_GRAPH_JSON_CAP = 8_000;
/** Edit-context conversation serialiser cap (serialise default `maxConversationChars`). */
const POLICY_EDIT_CONVERSATION_CAP = 4_000;

// Telemetry/measurement targets with NO importable enforcement constant (03 §1
// budget table). Declared here so `CONTEXT_SECTION_BUDGETS` derives from ONE
// source. Each is tagged `telemetry_only` (a measured target, not a live cut).
const T_ROUTING_CONVERSATION = 34_000;
const T_ROUTING_CONVERSATION_SUMMARY = 1_300;
const T_ROUTING_DISPLAY_GRAPH = 8_000;
const T_ROUTING_OLDER_FACTS = 3_000; // I-15 pre-declared slot (unpopulated)
const T_ROUTING_REST = 2_500;
const T_ROUTING_TOTAL = 55_000;
const T_EDIT_CONVERSATION_SUMMARY = 1_300;
const T_EDIT_TOTAL = 16_300;
const T_DR_GRAPH_JSON = 16_000;
const T_DR_ISL_RESULTS = 16_000;
const T_DR_DECISION_RECORDS = 1_800; // I-15 pre-declared slot (unpopulated)
const T_DR_CONVERSATION_SUMMARY = 1_300;
const T_DR_TOTAL = 43_100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextCallSite =
  | 'coach_converse' // = budget-telemetry's 'routing'; the V5 shared pack
  | 'edit_graph'
  | 'repair_edit_graph'
  | 'decision_review'
  | 'chip_run' // DETERMINISTIC — asserts no LLM adapter call
  | 'clarify'; // DETERMINISTIC — asserts no LLM adapter call

/** Where a section draws its content from (documentation + conformance metadata). */
export type ContextSource =
  | 'identity'
  | 'brief'
  | 'conversation_window'
  | 'rolling_summary'
  | 'analysis_enrichment'
  | 'graph'
  | 'recent_changes'
  | 'coaching_cache'
  | 'coaching_context'
  | 'decision_records'
  | 'system_event'
  | 'quantities'
  | 'compound'
  | 'budget_disclosure'
  | 'framing'
  | 'isl_results'
  | 'deterministic_coaching'
  | 'focus'
  | 'aggregate'
  | 'none';

export type SectionEnforcement = 'enforced' | 'telemetry_only' | 'unpopulated';

export interface ContextSectionPolicy {
  /** Canonical section name — matches the `section_chars`/budget-table key. */
  readonly name: string;
  /**
   * The model-facing serialised JSON key when it differs from {@link name}
   * (e.g. coach_converse's `display_analysis` section serialises under `analysis`
   * after buildUserMessage substitutes the display-safe projection). Used by the
   * anchor conformance to reconcile the observed prompt keys with the policy.
   */
  readonly serialised_as?: string;
  readonly source: ContextSource;
  /** How the section is projected (formatAnalysisForContext, projectConversation…). */
  readonly projection?: string;
  /**
   * Char budget. DERIVED from an enforcement constant where one exists (import
   * or conformance-pinned replica); a hand-written measurement target otherwise
   * (then `enforcement: 'telemetry_only'`); `null` when unbudgeted.
   */
  readonly char_budget: number | null;
  readonly enforcement: SectionEnforcement;
  /** Position in the cut order (lower = cut first); null = no section-level cut. */
  readonly cut_rank: number | null;
  /**
   * True when the section appears as a key in the serialised model-facing
   * prompt; false for a telemetry/budget slot that is not itself a prompt key
   * (e.g. the `rest` aggregate, or the `older_relevant_facts` reservation).
   */
  readonly model_facing: boolean;
}

export interface ContextPolicy {
  readonly call_site: ContextCallSite;
  /** Which of the user-facing turn classes this call site serves. */
  readonly turn_class: string;
  /** false ⇒ deterministic; conformance asserts the path makes ZERO LLM calls. */
  readonly llm: boolean;
  /** Cross-ref to the MODEL-ROUTING-POLICY row (not duplicated here). */
  readonly model_ref: string;
  /** ORDER is load-bearing for model-facing sections (== serialised key order). */
  readonly sections: readonly ContextSectionPolicy[];
  /** Whole-context char budget (telemetry aggregate); null = instrumented-only. */
  readonly total_char_budget: number | null;
  /** null for deterministic sites (no conversation window). */
  readonly memory_window: {
    readonly verbatim_turns: number; // DERIVED from CONTEXT_PACK_RECENT_TURNS_CAP
    readonly rolling_summary: boolean; // does this site inject the rolling summary?
  } | null;
  /** Human note (e.g. activation-gated, deterministic-composer). */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

/**
 * coach_converse — the V5 shared ContextPack (`assembleContextPackWithSummary`
 * → `buildUserMessage`). The one GOOD assembler; this row is the harness
 * anchor. Sections are declared in MODEL-FACING serialised order (the order
 * `buildUserMessage` emits), which is load-bearing: the rolling summary sits
 * LAST, BELOW hard structured state, so facts beat summary (A22 Q1). The two
 * ENFORCED sections are `brief` (CONTEXT_PACK_BRIEF_CHAR_CAP) and
 * `display_analysis` (DISPLAY_ANALYSIS_CHAR_BUDGET, disclosed truncation ladder
 * {@link DISPLAY_ANALYSIS_TRUNCATION_ORDER}). `older_relevant_facts` is the
 * I-15 knowledge-over-time reservation — declared `unpopulated` so the P6 read
 * has a governed shape to fill, never an ungoverned new slot.
 */
const COACH_CONVERSE: ContextPolicy = {
  call_site: 'coach_converse',
  turn_class: 'coach-converse (coach-explain · analytical pill · run_analysis-by-message)',
  llm: true,
  model_ref: 'routing.sonnet',
  memory_window: { verbatim_turns: POLICY_VERBATIM_TURNS, rolling_summary: true },
  total_char_budget: T_ROUTING_TOTAL,
  sections: [
    { name: 'version', source: 'identity', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'scenario_id', source: 'identity', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'stage', source: 'identity', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'brief', source: 'brief', projection: 'projectBrief', char_budget: CONTEXT_PACK_BRIEF_CHAR_CAP, enforcement: 'enforced', cut_rank: null, model_facing: true },
    { name: 'conversation', source: 'conversation_window', projection: 'projectConversation', char_budget: T_ROUTING_CONVERSATION, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'recent_changes', source: 'recent_changes', projection: 'recent-changes summary (recent-changes.ts authority)', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'coaching', source: 'coaching_cache', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'compound_detected', source: 'compound', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'compound_pattern_matched', source: 'compound', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'parsed_quantities', source: 'quantities', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'system_event', source: 'system_event', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    // display_analysis serialises under the `analysis` key; display_graph under `graph`.
    { name: 'display_analysis', serialised_as: 'analysis', source: 'analysis_enrichment', projection: `formatAnalysisForContext (disclosed truncation: ${DISPLAY_ANALYSIS_TRUNCATION_ORDER.join('→')})`, char_budget: DISPLAY_ANALYSIS_CHAR_BUDGET, enforcement: 'enforced', cut_rank: null, model_facing: true },
    { name: 'display_graph', serialised_as: 'graph', source: 'graph', projection: 'formatGraphForContext', char_budget: T_ROUTING_DISPLAY_GRAPH, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'conversation_summary', source: 'rolling_summary', char_budget: T_ROUTING_CONVERSATION_SUMMARY, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    // Budget slots that are NOT themselves model-facing prompt keys:
    { name: 'older_relevant_facts', source: 'decision_records', char_budget: T_ROUTING_OLDER_FACTS, enforcement: 'unpopulated', cut_rank: null, model_facing: false },
    { name: 'rest', source: 'aggregate', char_budget: T_ROUTING_REST, enforcement: 'telemetry_only', cut_rank: null, model_facing: false },
  ],
  note: 'The one good assembler; harness anchor. buildUserMessage renames display_analysis→analysis, display_graph→graph; conversation_summary is appended LAST (facts-beat-summary).',
};

/**
 * edit_graph — the V4 edit prompt (`serialiseEditContextForLLMWithMeta`). Its
 * `sectionChars` ARE the section decomposition (measured over the pushed
 * sections, in order). ENFORCED: `brief` (EDIT_CONTEXT_BRIEF_CHAR_CAP; S2 now
 * unconditional). `graph_json`/`conversation` are `telemetry_only`: their cut
 * sites exist but overshoot (graph_json's truncate loop can exceed the cap by
 * ~2.2×, I-8/1.103), so claiming `enforced` would be false.
 */
const EDIT_GRAPH_SECTIONS: readonly ContextSectionPolicy[] = [
  { name: 'brief', source: 'brief', projection: 'projectBriefForEdit (## Decision Brief, first 1000 chars, disclosed)', char_budget: POLICY_EDIT_BRIEF_CHAR_CAP, enforcement: 'enforced', cut_rank: null, model_facing: true },
  { name: 'graph_json', source: 'graph', projection: 'editCompactGraph + truncateGraphJson', char_budget: POLICY_EDIT_GRAPH_JSON_CAP, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
  { name: 'conversation', source: 'conversation_window', projection: 'renderRecentConversationForEdit', char_budget: POLICY_EDIT_CONVERSATION_CAP, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
  { name: 'framing', source: 'framing', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
  { name: 'analysis_summary', source: 'analysis_enrichment', projection: 'summariseAnalysisResponse', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
  { name: 'focus', source: 'focus', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
  { name: 'conversation_summary', source: 'rolling_summary', char_budget: T_EDIT_CONVERSATION_SUMMARY, enforcement: 'unpopulated', cut_rank: null, model_facing: false },
];

const EDIT_GRAPH: ContextPolicy = {
  call_site: 'edit_graph',
  turn_class: 'edit',
  llm: true,
  model_ref: 'edit.llm',
  memory_window: { verbatim_turns: POLICY_VERBATIM_TURNS, rolling_summary: false },
  total_char_budget: T_EDIT_TOTAL,
  sections: EDIT_GRAPH_SECTIONS,
  note: 'Edit threads the 5-turn conversation window (I-4 FIXED) + the persisted decision brief (S2, now unconditional). conversation_summary declared but not yet injected on this site (unpopulated).',
};

/**
 * repair_edit_graph — a sub-site of edit that reuses the IDENTICAL
 * contextSection and only swaps the system prompt. The reuse is pinned
 * fail-loud by the conformance test (`repair.sections === edit.sections`), a
 * real derive-don't-mirror win: the two rows share one array reference.
 */
const REPAIR_EDIT_GRAPH: ContextPolicy = {
  ...EDIT_GRAPH,
  call_site: 'repair_edit_graph',
  turn_class: 'repair-edit (sub-site of edit)',
  model_ref: 'repair_edit.llm',
  total_char_budget: T_EDIT_TOTAL,
  sections: EDIT_GRAPH_SECTIONS, // SAME reference — repair reuses edit's contextSection.
  note: 'Reuses edit_graph.sections by reference (identical contextSection, only the system prompt differs).',
};

/**
 * decision_review — a separate gpt-4.1 prompt (`buildDecisionReviewUserMessage`,
 * `<BRIEF>·<GRAPH>·<ISL_RESULTS>·<DETERMINISTIC_COACHING>` …). Declared ONLY;
 * activation stays behind the standing keep-gpt-4.1 A/B ruling
 * (V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW) — this row does not touch it.
 *
 * The `brief` budget is DERIVED from DECISION_REVIEW_MAX_BRIEF_CHARS (2000,
 * conformance-pinned) — this KILLS the live drift where the telemetry table
 * declared `brief:8_000` while the builder enforces 2_000 (invoke.ts:220,
 * 8000-declared → RED). `decision_records` is the I-15 reservation, declared
 * `unpopulated` (nothing projects it yet — a governed absence, not an accident).
 */
const DECISION_REVIEW: ContextPolicy = {
  call_site: 'decision_review',
  turn_class: 'decision_review (post-run_analysis enrichment sub-call)',
  llm: true,
  model_ref: 'decision_review.gpt-4.1',
  memory_window: null,
  total_char_budget: T_DR_TOTAL,
  sections: [
    { name: 'brief', source: 'brief', projection: 'boundedTextBlock', char_budget: POLICY_DECISION_REVIEW_BRIEF_CHAR_CAP, enforcement: 'enforced', cut_rank: null, model_facing: true },
    { name: 'graph_json', source: 'graph', projection: 'capArray(nodes,edges) + boundedJsonBlock', char_budget: T_DR_GRAPH_JSON, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'isl_results', source: 'isl_results', projection: 'boundedJsonBlock', char_budget: T_DR_ISL_RESULTS, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'deterministic_coaching', source: 'deterministic_coaching', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'decision_context', source: 'analysis_enrichment', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'flip_threshold_data', source: 'analysis_enrichment', char_budget: null, enforcement: 'telemetry_only', cut_rank: null, model_facing: true },
    { name: 'decision_records', source: 'decision_records', char_budget: T_DR_DECISION_RECORDS, enforcement: 'unpopulated', cut_rank: null, model_facing: false },
    { name: 'conversation_summary', source: 'rolling_summary', char_budget: T_DR_CONVERSATION_SUMMARY, enforcement: 'unpopulated', cut_rank: null, model_facing: false },
  ],
  note: 'Declare-only; activation gated by the standing keep-gpt-4.1 A/B ruling (V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW), untouched here. brief:2000 derived from DECISION_REVIEW_MAX_BRIEF_CHARS — the 8000 telemetry claim dies (ROADMAP 1.199).',
};

/**
 * chip_run — run_analysis via a deterministic chip click
 * (`dispatchDeterministicChipClick`). NO LLM call: the NO-LLM run_analysis
 * compute handler + a deterministic projection composer. `llm:false`; the
 * conformance asserts the dispatch path makes ZERO adapter calls (a future edit
 * that wires an LLM call in goes RED). A real hazard guard — the chip-simplify
 * path was nearly turned into an LLM redraft (PR #464 drift).
 */
const CHIP_RUN: ContextPolicy = {
  call_site: 'chip_run',
  turn_class: 'chip-run (run_analysis via chip)',
  llm: false,
  model_ref: 'none.deterministic',
  memory_window: null,
  total_char_budget: null,
  sections: [],
  note: 'DETERMINISTIC — no model-facing context, no LLM call. Conformance asserts zero adapter calls on the chip dispatch path.',
};

/**
 * clarify — the deterministic clarification composer
 * (`composeEditClarifyResponse`), canned copy shared by
 * chip-simplify-intercept + vague-edit-guard. NO LLM call. Same inverse control
 * as chip_run.
 */
const CLARIFY: ContextPolicy = {
  call_site: 'clarify',
  turn_class: 'clarify (deterministic clarification)',
  llm: false,
  model_ref: 'none.deterministic',
  memory_window: null,
  total_char_budget: null,
  sections: [],
  note: 'DETERMINISTIC — canned clarification copy, no LLM call. Conformance asserts zero adapter calls on the clarify path.',
};

export const CONTEXT_POLICY: Readonly<Record<ContextCallSite, ContextPolicy>> = {
  coach_converse: COACH_CONVERSE,
  edit_graph: EDIT_GRAPH,
  repair_edit_graph: REPAIR_EDIT_GRAPH,
  decision_review: DECISION_REVIEW,
  chip_run: CHIP_RUN,
  clarify: CLARIFY,
};

// ---------------------------------------------------------------------------
// Derived views (one source of truth)
// ---------------------------------------------------------------------------

/**
 * The `context-budget-telemetry` call-site names. Maps to a policy row where
 * one exists; `draft_graph` has no policy row in wave-5 (POST wave-1, P4) and
 * is passed through as instrumented-only, byte-identical to before.
 */
export type BudgetTelemetryCallSite =
  | 'routing'
  | 'edit_graph'
  | 'repair_edit_graph'
  | 'decision_review'
  | 'draft_graph';

/** Which policy row backs each telemetry call site (null ⇒ not yet migrated). */
const TELEMETRY_TO_POLICY: Readonly<Record<BudgetTelemetryCallSite, ContextCallSite | null>> = {
  routing: 'coach_converse',
  edit_graph: 'edit_graph',
  repair_edit_graph: 'repair_edit_graph',
  decision_review: 'decision_review',
  draft_graph: null, // POST wave-1 (P4)
};

export interface DerivedSiteBudget {
  readonly sections: Readonly<Record<string, number>>;
  readonly total: number | null;
}

/**
 * Project the per-site char-budget table OUT of {@link CONTEXT_POLICY}. This is
 * what `context-budget-telemetry`'s `CONTEXT_SECTION_BUDGETS` becomes — a
 * DERIVED VIEW, not a separately-authored parallel table, so it can no longer
 * drift (Q1 rule 2 / Q5). Every section carrying a `char_budget` contributes
 * `{name: char_budget}`; `total` = the row's `total_char_budget`. draft_graph
 * stays instrumented-only.
 */
export function deriveContextSectionBudgets(): Record<BudgetTelemetryCallSite, DerivedSiteBudget> {
  const out = {} as Record<BudgetTelemetryCallSite, DerivedSiteBudget>;
  for (const site of Object.keys(TELEMETRY_TO_POLICY) as BudgetTelemetryCallSite[]) {
    const policySite = TELEMETRY_TO_POLICY[site];
    if (policySite === null) {
      out[site] = { sections: {}, total: null }; // draft_graph: instrumented, not budgeted.
      continue;
    }
    const policy = CONTEXT_POLICY[policySite];
    const sections: Record<string, number> = {};
    for (const s of policy.sections) {
      if (s.char_budget !== null) sections[s.name] = s.char_budget;
    }
    out[site] = { sections, total: policy.total_char_budget };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runtime tripwire — v5.context_policy.divergence
// ---------------------------------------------------------------------------

/** Minimal logger surface — satisfied by the pino `log`. */
export interface ContextPolicyTripwireLogger {
  warn(payload: Record<string, unknown>, message: string): void;
}

/** Max divergence names carried in one event (flood guard). */
const DIVERGENCE_NAME_LOG_CAP = 20;

/**
 * Over-budget tolerance for the live tripwire. The telemetry `section_chars`
 * are a COMPACT-JSON per-section PROXY (turn-executor documents them as "a
 * relative COMPOSITION signal … NOT summing to total"), while the enforced
 * budgets bound a different quantity (e.g. `brief`'s cap bounds `brief.text`,
 * but the proxy measures the whole `{text,truncated,original_chars}` object —
 * a full 2000-char brief serialises to ~2051). So an EXACT `chars > budget`
 * check would false-fire on healthy turns. The tripwire is a coarse live
 * backstop for GROSS overshoot (a cut that failed), not a byte-exact gate — CI
 * conformance is the exact gate. A section 25%+ over its budget is materially
 * over, well beyond any serialisation-wrapper overhead.
 */
const OVER_BUDGET_TOLERANCE = 1.25;

export interface ContextPolicyDivergence {
  /** Realised section names not declared in the policy row. */
  readonly unknown_sections: string[];
  /** Enforced sections whose realised chars exceeded their derived budget. */
  readonly over_budget_sections: string[];
}

/**
 * Pure discriminator: compare a realised `section_chars` decomposition against
 * the policy row for a telemetry call site. Returns the divergences (unknown
 * section names + over-ENFORCED-budget section names). Only `enforced` sections
 * are budget-checked — a `telemetry_only` target is a measurement, not a live
 * cut, so exceeding it is not a divergence (that is what keeps healthy turns
 * silent). Unmapped call sites (draft_graph) and unknown inputs → no divergence.
 * Never reads or returns any VALUE beyond the numeric char counts already given.
 */
export function findContextPolicyDivergences(
  callSite: string,
  sectionChars: Readonly<Record<string, number>>,
): ContextPolicyDivergence {
  const empty: ContextPolicyDivergence = { unknown_sections: [], over_budget_sections: [] };
  const policySite = TELEMETRY_TO_POLICY[callSite as BudgetTelemetryCallSite];
  if (!policySite) return empty;
  const policy = CONTEXT_POLICY[policySite];
  const byName = new Map(policy.sections.map((s) => [s.name, s]));
  const unknown: string[] = [];
  const overBudget: string[] = [];
  for (const [name, chars] of Object.entries(sectionChars)) {
    const section = byName.get(name);
    if (section === undefined) {
      unknown.push(name);
      continue;
    }
    if (
      section.enforcement === 'enforced' &&
      section.char_budget !== null &&
      typeof chars === 'number' &&
      Number.isFinite(chars) &&
      chars > section.char_budget * OVER_BUDGET_TOLERANCE
    ) {
      overBudget.push(name);
    }
  }
  return { unknown_sections: unknown, over_budget_sections: overBudget };
}

/**
 * RUNTIME tripwire. Emit one loud, structured warn event when a live LLM call's
 * realised composition departs from {@link CONTEXT_POLICY} — a new/renamed
 * section the policy does not declare, or an ENFORCED section that blew its
 * derived budget. Called once per LLM call from the `emitContextBudget` seam so
 * it covers every migrated site.
 *
 * Contract: OBSERVE-ONLY. Logs section NAMES + counts (never values), caps the
 * lists, and NEVER throws — a divergence must degrade coverage of the dashboard,
 * never the turn. No flag gates it; it is unconditional.
 *
 * `logger` is injectable for testing; defaults to the process `log`.
 */
export function emitContextPolicyDivergence(
  callSite: string,
  sectionChars: Readonly<Record<string, number>>,
  totalChars: number,
  requestId: string | null,
  scenarioId: string | null,
  logger: ContextPolicyTripwireLogger = log,
): void {
  try {
    const { unknown_sections, over_budget_sections } = findContextPolicyDivergences(
      callSite,
      sectionChars,
    );
    if (unknown_sections.length === 0 && over_budget_sections.length === 0) return;
    logger.warn(
      {
        event: 'v5.context_policy.divergence',
        call_site: callSite,
        request_id: requestId,
        scenario_id: scenarioId,
        total_chars: totalChars,
        unknown_section_count: unknown_sections.length,
        unknown_sections: unknown_sections.slice(0, DIVERGENCE_NAME_LOG_CAP),
        over_budget_count: over_budget_sections.length,
        over_budget_sections: over_budget_sections.slice(0, DIVERGENCE_NAME_LOG_CAP),
      },
      'v5 context: realised LLM context composition departs from CONTEXT_POLICY — a section the policy does not declare, or an enforced section over its derived budget (context-policy conformance backstop)',
    );
  } catch {
    // Observe-only: a telemetry fault must never break a turn.
  }
}

// ---------------------------------------------------------------------------
// Conformance helpers (used by the conformance test; exported so the harness
// derives from the policy, not a second copy)
// ---------------------------------------------------------------------------

/** Ordered model-facing serialised keys for a site (`serialised_as ?? name`). */
export function modelFacingSectionKeys(site: ContextCallSite): string[] {
  return CONTEXT_POLICY[site].sections
    .filter((s) => s.model_facing)
    .map((s) => s.serialised_as ?? s.name);
}

/** All declared section names for a site (the tripwire's known-section set). */
export function declaredSectionNames(site: ContextCallSite): Set<string> {
  return new Set(CONTEXT_POLICY[site].sections.map((s) => s.name));
}
