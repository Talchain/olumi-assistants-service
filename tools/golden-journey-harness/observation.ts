/**
 * Golden-Journey Harness v1 — the wire observation the classifiers read.
 *
 * `tools/v5-journey-replay/types.ts` models only the slice of the turn
 * response the replay harness asserted (assistant_text, chips, a tiny
 * analysis_ready). The golden-journey invariants need MORE wire fields —
 * the freshness/hash trio, blockers, model_adjustments, the diagnostic
 * trace, and `_timings`. Rather than fork that type, we define a permissive
 * superset here and read through it defensively (every field optional).
 *
 * The CEE-owned `analysis_ready` contract is `src/schemas/analysis-ready.ts`
 * (freshness enum = fresh|stale|unknown|none). We mirror the fields we
 * read; we do NOT import the Zod schema (this module stays product-free so
 * it runs under plain `tsx`).
 */

import type { TurnResponse } from '../v5-journey-replay/types.js';

export type WireFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

export interface AnalysisReadyWire {
  readonly status?: string;
  readonly options?: readonly unknown[];
  readonly goal_node_id?: string;
  readonly computed_at?: string;
  readonly blockers?: readonly unknown[];
  /** Repairs/reconciliations surfaced to the user (A7). */
  readonly model_adjustments?: readonly unknown[];
  readonly bias_findings?: readonly unknown[];
  /** Enrichment keep-list (A5 science signals). */
  readonly factor_sensitivity?: readonly unknown[];
  readonly option_comparison?: readonly unknown[];
  readonly option_comparison_status?: unknown;
  readonly robustness?: unknown;
  readonly freshness?: WireFreshness;
  readonly freshness_reason?: string;
  readonly graph_hash_at_run?: string;
  readonly current_graph_hash?: string;
  readonly [k: string]: unknown;
}

export interface DiagnosticTraceWire {
  readonly exit_path?: string;
  readonly correlation_ids?: {
    readonly request_id?: string;
    readonly scenario_id?: string;
    readonly turn_id?: string;
    readonly graph_hash?: string;
    readonly prompt_hash?: string;
    readonly [k: string]: unknown;
  };
  readonly coaching_delivery?: {
    readonly handler?: string;
    readonly composer?: string;
    readonly copy_source?: string;
    readonly coaching_fields_used?: readonly string[];
    readonly [k: string]: unknown;
  };
  readonly benchmarking?: {
    readonly total_duration_ms?: number;
    readonly substage_timings?: Record<string, unknown>;
  };
  readonly [k: string]: unknown;
}

export interface WireChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type?: string;
}

/**
 * Permissive superset of the replay `TurnResponse`. Read defensively.
 * `analysis_ready` and the debug surfaces are typed here; the rest is
 * inherited from `TurnResponse` via the intersection.
 */
export type WireBody = Omit<TurnResponse, 'analysis_ready' | 'suggested_actions'> & {
  readonly analysis_ready?: AnalysisReadyWire;
  readonly suggested_actions?: readonly WireChip[];
  readonly _diagnostic_trace?: DiagnosticTraceWire;
  readonly _timings?: Record<string, unknown>;
  /**
   * Optional AI-facing context summary surface (canonical-state M3
   * `_context_summary`). Absent on every wire path today — its presence is
   * exactly the CEE acceptance requirement that A9 tracks (see invariants.ts).
   */
  readonly _context_summary?: Record<string, unknown>;
  /**
   * Server-side pending proposals (e.g. `proposed_concept`). A turn that
   * carries a `proposed_*` pending action emitted a PROPOSAL, not a durable
   * commit — a strong "no mutation happened" signal for A8.
   */
  readonly pending_actions?: readonly { readonly action?: { readonly kind?: string } & Record<string, unknown> }[];
  readonly draft_graph?: { readonly nodes?: readonly unknown[]; readonly edges?: readonly unknown[]; readonly [k: string]: unknown };
  readonly [k: string]: unknown;
};

/** Roles drive which invariants apply to a given turn. */
export type TurnRole =
  | 'draft'
  | 'analysis'
  | 'explain'
  | 'follow_up'
  | 'mutate'
  /** A change *request* that should NOT durably commit (clarify/propose only). */
  | 'mutate_intent'
  | 'rerun_analysis'
  | 'explain_changed'
  | 'reload'
  /** A premortem / challenge prompt — safe-handling check only. */
  | 'premortem';

/**
 * One captured turn plus the cross-turn memory the classifiers need.
 * Pure data — the journey runner populates the hash/flag fields; the
 * unit tests construct these literals directly.
 */
export interface TurnObservation {
  readonly step: string;
  readonly role: TurnRole;
  readonly httpStatus: number;
  readonly body: WireBody | undefined;
  readonly elapsedMs?: number;
  /**
   * `current_graph_hash` of the analysis baseline established BEFORE this
   * turn (set from the first run_analysis). Used by A3 at rerun time.
   */
  readonly priorRunHash?: string | null;
  /** The most recent `current_graph_hash` seen before this turn. */
  readonly priorGraphHash?: string | null;
  /**
   * Whether the operator confirmed the diagnostic-trace flag is ON for this
   * run (dispatch guardrail #5). When false and the trace is absent, A6 is
   * inconclusive (config gap) rather than a product fail.
   */
  readonly diagnosticTraceExpected: boolean;
  /** Option/factor labels parsed at draft, threaded for A5 grounding. */
  readonly optionLabels?: readonly string[];
  readonly factorLabels?: readonly string[];
}

// --------------------------------------------------------------------------
// Defensive accessors — never throw, return undefined on shape drift.
// --------------------------------------------------------------------------

export function getAnalysisReady(body: WireBody | undefined): AnalysisReadyWire | undefined {
  const ar = body?.analysis_ready;
  return ar && typeof ar === 'object' ? ar : undefined;
}

export function getAssistantText(body: WireBody | undefined): string {
  const t = body?.assistant_text;
  return typeof t === 'string' ? t : '';
}

export function getChips(body: WireBody | undefined): readonly WireChip[] {
  const c = body?.suggested_actions;
  return Array.isArray(c) ? c : [];
}

export function getDiagnosticTrace(body: WireBody | undefined): DiagnosticTraceWire | undefined {
  const t = body?._diagnostic_trace;
  return t && typeof t === 'object' ? t : undefined;
}

export function hasTimings(body: WireBody | undefined): boolean {
  const t = body?._timings;
  return Boolean(t && typeof t === 'object');
}

export function getCurrentGraphHash(body: WireBody | undefined): string | undefined {
  const v = getAnalysisReady(body)?.current_graph_hash;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function getGraphHashAtRun(body: WireBody | undefined): string | undefined {
  const v = getAnalysisReady(body)?.graph_hash_at_run;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function getFreshness(body: WireBody | undefined): WireFreshness | undefined {
  return getAnalysisReady(body)?.freshness;
}

/** True when the analysis_ready payload reports a runnable/complete analysis. */
export function isAnalysisReadyComplete(body: WireBody | undefined): boolean {
  return getAnalysisReady(body)?.status === 'ready';
}

/** The `_timings.turn` block (server-side per-turn substage timings), if present. */
function getTurnTimings(body: WireBody | undefined): Record<string, unknown> | undefined {
  const t = body?._timings;
  if (!t || typeof t !== 'object') return undefined;
  const turn = (t as { turn?: unknown }).turn;
  return turn && typeof turn === 'object' ? (turn as Record<string, unknown>) : undefined;
}

/**
 * Wall-clock for the turn. Prefers the server `_timings.turn.total_ms`
 * (deterministic, present in replay fixtures); falls back to the client-
 * measured `elapsedMs` (live only). Returns undefined when neither exists —
 * latency is then unprovable (A10 inconclusive), never silently "fast".
 */
export function getTurnTotalMs(obs: TurnObservation): number | undefined {
  const v = getTurnTimings(obs.body)?.total_ms;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof obs.elapsedMs === 'number' && Number.isFinite(obs.elapsedMs)) return Math.round(obs.elapsedMs);
  return undefined;
}

/**
 * Number of LLM calls the turn made. `0` ⇒ a simple deterministic turn
 * (the latency-tracking class the brief names). `undefined` ⇒ not observable.
 */
export function getLlmCalls(body: WireBody | undefined): number | undefined {
  const v = getTurnTimings(body)?.llm_calls_used;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * The AI-facing context summary surface, if the wire exposes one. Checks the
 * canonical-state `_context_summary` field first, then a context block nested
 * in the diagnostic trace. Absent everywhere today — A9 turns that absence
 * into an explicit CEE acceptance requirement rather than a silent pass.
 */
export function getContextSummary(body: WireBody | undefined): Record<string, unknown> | undefined {
  const top = body?._context_summary;
  if (top && typeof top === 'object') return top as Record<string, unknown>;
  const traceCtx = (body?._diagnostic_trace as { context_summary?: unknown } | undefined)?.context_summary;
  return traceCtx && typeof traceCtx === 'object' ? (traceCtx as Record<string, unknown>) : undefined;
}

/**
 * The committing handler id for the turn (`_timings.turn.handler_id`, or the
 * trace `coaching_delivery.handler`). `undefined` ⇒ no handler executed — a
 * turn that nonetheless claims a mutation made none (A8 durability signal).
 */
export function getHandlerId(body: WireBody | undefined): string | undefined {
  const fromTimings = getTurnTimings(body)?.handler_id;
  if (typeof fromTimings === 'string' && fromTimings.length > 0) return fromTimings;
  const fromTrace = body?._diagnostic_trace?.coaching_delivery?.handler;
  return typeof fromTrace === 'string' && fromTrace.length > 0 ? fromTrace : undefined;
}

/**
 * True when the turn carries a `proposed_*` pending action — i.e. it emitted a
 * PROPOSAL the user must still confirm, not a durable mutation. A8 treats this
 * as "no commit happened": a turn that proposes must not also claim it applied.
 */
export function hasProposedPendingAction(body: WireBody | undefined): boolean {
  const pa = body?.pending_actions;
  if (!Array.isArray(pa)) return false;
  return pa.some((p) => typeof p?.action?.kind === 'string' && /^proposed[_-]/.test(p.action.kind));
}
