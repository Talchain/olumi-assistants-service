/**
 * Golden-Journey Harness v1 — the seven invariant classifiers (A1..A7).
 *
 * Each classifier is a PURE function over a {@link TurnObservation} (or, for
 * A2, a {@link ContextSnapshot}) and returns zero-or-more {@link Finding}s
 * tagged with their core component. Purity is the contract: the committed
 * unit test feeds each one a hand-built contradiction case and a clean case
 * and asserts the classification, with no network and no product boot.
 *
 * Wire signals were verified against `src/schemas/analysis-ready.ts` and the
 * reuse modules in `../v5-journey-replay/`. The harness composes its own
 * "success claim" detector because the product's `findSuccessClaimHit` is
 * not exported — the regex mirrors the product's `SUCCESS_CLAIM_PATTERNS`
 * (`src/orchestrator-v5/compose/forbidden-user-facing-phrases.ts`) so the
 * two cannot drift in spirit.
 *
 * Dispatch guardrails baked in:
 *   #1 A1 is PROVISIONAL (marked on most A1 findings) until the
 *      canonical-state lane finalises the coherence contract — EXCEPT the
 *      deterministic stale-as-fresh finding (Contradiction 2), which is
 *      GATING and wire-grounded to the live `deriveAnalysisFreshness` verdict
 *      (Coaching Context Pack v1). See `a1AnalysisCoherence`.
 *   #4 Missing observability (no trace / no `current_graph_hash`) →
 *      `inconclusive` AND a high-severity Component-6 finding, never a
 *      silent pass.
 */

import {
  hasErrorEnvelope,
} from '../v5-journey-replay/classify-outcome.js';
import {
  MUTATION_ACK_PATTERN,
  CLARIFICATION_BACK_PATTERN,
  STEP5_DENIAL_PHRASES,
} from '../v5-journey-replay/assertions.js';

import {
  makeFinding,
  type CoverageCaveat,
  type Finding,
} from './components.js';
import {
  getAnalysisReady,
  getAssistantText,
  getChips,
  getContextSummary,
  getCurrentGraphHash,
  getDiagnosticTrace,
  getFreshness,
  getHandlerId,
  getLlmCalls,
  getTurnTotalMs,
  hasProposedPendingAction,
  hasTimings,
  isAnalysisReadyComplete,
  type TurnObservation,
  type TurnRole,
  type WireBody,
} from './observation.js';

/**
 * Opening-line success claim. Mirrors the product's `SUCCESS_CLAIM_PATTERNS`
 * — a line that opens with a mutation verb followed by content. On a turn
 * that did not durably mutate, this is a false success claim (A4).
 */
const OPENING_SUCCESS_CLAIM =
  /^\s*(?:Updated|Set|Added|Removed|Changed|Edited|Applied|Adjusted|Modified|Created)\s+\S/m;

/** Staleness acknowledgement — text OR a rerun/refresh chip. Mirrors `assertExplainLeaderStale`. */
function hasStalenessSignal(body: WireBody | undefined): boolean {
  const text = getAssistantText(body);
  const textSignal =
    /\b(stale|model has changed|no longer reflects?|out[- ]of[- ]date|since (?:the )?analysis|re[- ]?run)\b/i.test(
      text,
    );
  if (textSignal) return true;
  return getChips(body).some((chip) => {
    const blob = `${chip.label} ${chip.message}`.toLowerCase();
    return /\b(?:re[- ]?run|refresh|update|stale)\b/.test(blob) && blob.includes('analy');
  });
}

function firstDenialPhrase(text: string): string | null {
  for (const re of STEP5_DENIAL_PHRASES) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

// ===========================================================================
// A1 — analysis state not contradicted by prose, chips, or reload (PROVISIONAL)
// ===========================================================================

export function a1AnalysisCoherence(obs: TurnObservation): Finding[] {
  // Non-200 turns are an observability/recovery concern (A6/A7), not a
  // coherence one — A1 cannot judge prose against state that never arrived.
  if (obs.httpStatus !== 200) return [];
  const ar = getAnalysisReady(obs.body);
  const freshness = getFreshness(obs.body);
  const text = getAssistantText(obs.body);
  const denial = firstDenialPhrase(text);

  // Contradiction 1: canonical state says analysis is ready, prose denies it.
  if (ar?.status === 'ready' && denial) {
    return [
      makeFinding(
        'A1',
        'fail',
        'high',
        `analysis_ready.status="ready" but prose denies analysis is available: "${denial}"`,
        { step: obs.step, provisional: true },
      ),
    ];
  }

  // Contradiction 2: graph diverged (stale) but the turn presents results
  // without any staleness caveat or rerun affordance → stale-as-fresh.
  //
  // GATING (Coaching Context Pack v1): unlike the rest of A1 (provisional /
  // advisory while the coherence contract settles), this single finding is a
  // hard gate. It is wire-grounded to the live `deriveAnalysisFreshness`
  // verdict — `getFreshness` reads `analysis_ready.freshness`, which the route
  // stamps from `ctx.freshness` (the runtime derivation), so the harness gate
  // and the deployed runtime agree on what "stale" means (no test-local
  // staleness notion). Stale-as-fresh is deterministic and safety-critical, so
  // it is NOT LLM-variance-prone like the semantic A1 checks → no `provisional`.
  if (freshness === 'stale' && !denial && !hasStalenessSignal(obs.body)) {
    return [
      makeFinding(
        'A1',
        'fail',
        'high',
        `analysis_ready.freshness="stale" but no staleness caveat or rerun chip — stale results presented as fresh`,
        { step: obs.step },
      ),
    ];
  }

  // Nothing analysis-bearing to assert this turn.
  if (ar === undefined && freshness === undefined) return [];

  return [
    makeFinding(
      'A1',
      'pass',
      'none',
      `coherent: status=${String(ar?.status)} freshness=${String(freshness)} denial=none`,
      { step: obs.step, provisional: true },
    ),
  ];
}

// ===========================================================================
// A2 — AI-facing context completeness (in-process; not wire-observable)
// ===========================================================================

/**
 * Presence of each of the five required AI-facing context elements. Each
 * is a tri-state: `true` (present + non-empty), `false` (absent/empty), or
 * `'unknown'` (could not be inspected — e.g. the live wire path, where the
 * ContextPack is never serialised).
 */
export interface ContextSnapshot {
  readonly graph: boolean | 'unknown';
  readonly analysis_state: boolean | 'unknown';
  readonly blockers: boolean | 'unknown';
  readonly capabilities: boolean | 'unknown';
  readonly recent_turn_state: boolean | 'unknown';
  /** Where this snapshot came from (for evidence). */
  readonly source: string;
}

const A2_FIELDS: ReadonlyArray<keyof Omit<ContextSnapshot, 'source'>> = [
  'graph',
  'analysis_state',
  'blockers',
  'capabilities',
  'recent_turn_state',
];

export function a2ContextCompleteness(snapshot: ContextSnapshot): Finding[] {
  const missing = A2_FIELDS.filter((f) => snapshot[f] === false);
  const unknown = A2_FIELDS.filter((f) => snapshot[f] === 'unknown');

  if (missing.length > 0) {
    return [
      makeFinding(
        'A2',
        'fail',
        'high',
        `AI-facing context missing required element(s): ${missing.join(', ')} [source=${snapshot.source}]`,
      ),
    ];
  }
  if (unknown.length > 0) {
    return [
      makeFinding(
        'A2',
        'inconclusive',
        'medium',
        `context completeness not wire-observable for: ${unknown.join(', ')} — asserted in-process ` +
          `(tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: ` +
          `flag-gated debug context-summary surface [source=${snapshot.source}]`,
      ),
    ];
  }
  return [
    makeFinding(
      'A2',
      'pass',
      'none',
      `AI-facing context carries graph + analysis + blockers + capabilities + recent-turn state [source=${snapshot.source}]`,
    ),
  ];
}

/** The live/replay path cannot inspect the internal ContextPack. */
export function a2LiveStub(): Finding[] {
  return a2ContextCompleteness({
    graph: 'unknown',
    analysis_state: 'unknown',
    blockers: 'unknown',
    capabilities: 'unknown',
    recent_turn_state: 'unknown',
    source: 'wire (ContextPack not serialised)',
  });
}

// ===========================================================================
// A3 — actions only count when durable state changed
// ===========================================================================

export function a3DurableStateChanged(obs: TurnObservation): Finding[] {
  const current = getCurrentGraphHash(obs.body);
  const baseline = obs.priorRunHash ?? undefined;

  // Missing-observability → inconclusive AND a Component-6 finding
  // (guardrail #4: missing hash blocks the harness from proving the system).
  if (baseline === undefined || current === undefined) {
    return [
      makeFinding(
        'A3',
        'inconclusive',
        'high',
        `cannot prove durable change: ${baseline === undefined ? 'no baseline graph_hash from prior analysis' : ''}` +
          `${baseline === undefined && current === undefined ? ' / ' : ''}` +
          `${current === undefined ? 'no current_graph_hash on this turn' : ''} — analysis_ready hash trio is .optional() on the wire`,
        { step: obs.step },
      ),
    ];
  }

  if (current !== baseline) {
    return [
      makeFinding(
        'A3',
        'pass',
        'none',
        `durable analysis-affecting graph hash changed after mutation (baseline≠current) — the action counted`,
        { step: obs.step },
      ),
    ];
  }

  return [
    makeFinding(
      'A3',
      'fail',
      'high',
      `durable analysis-affecting graph hash UNCHANGED after a mutation step (baseline===current) — ` +
        `a counted action did not change canonical state`,
      { step: obs.step },
    ),
  ];
}

// ===========================================================================
// A4 — failed/proposed/non-mutating turns never claim success
// ===========================================================================

export function a4NoFalseSuccess(obs: TurnObservation): Finding[] {
  const text = getAssistantText(obs.body);
  const errorEnvelope = hasErrorEnvelope(obs.body);
  const openingSuccess = OPENING_SUCCESS_CLAIM.test(text);
  const mutationAck = MUTATION_ACK_PATTERN.test(text);
  const clarifyBack = CLARIFICATION_BACK_PATTERN.test(text);

  // A failed turn (non-200, or 200-with-error-envelope) that nonetheless
  // claims a mutation succeeded.
  if ((obs.httpStatus !== 200 || errorEnvelope) && (openingSuccess || mutationAck)) {
    return [
      makeFinding(
        'A4',
        'fail',
        'high',
        `turn failed (http=${obs.httpStatus} error_envelope=${errorEnvelope}) but prose claims success ` +
          `(opening_claim=${openingSuccess} mutation_ack=${mutationAck})`,
        { step: obs.step },
      ),
    ];
  }

  // A proposed/clarifying mutate turn that simultaneously claims it applied.
  if (obs.role === 'mutate' && clarifyBack && mutationAck) {
    return [
      makeFinding(
        'A4',
        'fail',
        'high',
        `mutate turn asks for clarification (no mutation) yet also acknowledges a mutation — contradictory success claim`,
        { step: obs.step },
      ),
    ];
  }

  // A non-mutating turn that opens with a graph-mutation success claim.
  const NON_MUTATING: ReadonlyArray<TurnObservation['role']> = [
    'analysis',
    'explain',
    'follow_up',
    'rerun_analysis',
    'explain_changed',
    'reload',
  ];
  if (NON_MUTATING.includes(obs.role) && openingSuccess) {
    const m = text.match(OPENING_SUCCESS_CLAIM);
    return [
      makeFinding(
        'A4',
        'fail',
        'medium',
        `non-mutating turn (role=${obs.role}) opens with a mutation success claim: "${m?.[0]?.trim() ?? ''}"`,
        { step: obs.step },
      ),
    ];
  }

  return [
    makeFinding(
      'A4',
      'pass',
      'none',
      `no false success claim (role=${obs.role} http=${obs.httpStatus})`,
      { step: obs.step },
    ),
  ];
}

// ===========================================================================
// A5 — coaching grounded in actual graph/analysis/science signals
// ===========================================================================

function hasScienceGrounding(obs: TurnObservation): boolean {
  const text = getAssistantText(obs.body);
  const lower = text.toLowerCase();
  const ar = getAnalysisReady(obs.body);
  const labels = [...(obs.optionLabels ?? []), ...(obs.factorLabels ?? [])];
  const labelRef = labels.some((l) => l.length > 0 && lower.includes(l.toLowerCase()));
  const probRef = /\b\d{1,3}\s?%/.test(text) || /probabilit|percentage point|win\b/i.test(text);
  const enrichmentRef =
    (Array.isArray(ar?.factor_sensitivity) && ar!.factor_sensitivity!.length > 0) ||
    (Array.isArray(ar?.option_comparison) && ar!.option_comparison!.length > 0) ||
    ar?.robustness !== undefined;
  return labelRef || probRef || enrichmentRef;
}

export function a5CoachingGrounded(obs: TurnObservation): Finding[] {
  if (obs.httpStatus !== 200) return [];
  const text = getAssistantText(obs.body);
  if (text.length === 0) {
    return [makeFinding('A5', 'fail', 'medium', `coaching turn returned empty prose`, { step: obs.step })];
  }
  const denial = firstDenialPhrase(text);
  if (denial && isAnalysisReadyComplete(obs.body)) {
    return [
      makeFinding(
        'A5',
        'fail',
        'high',
        `coaching denies analysis ("${denial}") while analysis_ready.status="ready" — ungrounded in available signals`,
        { step: obs.step },
      ),
    ];
  }
  if (isAnalysisReadyComplete(obs.body) && !hasScienceGrounding(obs)) {
    return [
      makeFinding(
        'A5',
        'fail',
        'medium',
        `analysis is ready but coaching references no real option/factor label, probability, or science signal`,
        { step: obs.step },
      ),
    ];
  }
  if (!isAnalysisReadyComplete(obs.body) && getAnalysisReady(obs.body) === undefined) {
    return [
      makeFinding(
        'A5',
        'inconclusive',
        'low',
        `no analysis on this turn to ground coaching against`,
        { step: obs.step },
      ),
    ];
  }
  return [
    makeFinding('A5', 'pass', 'none', `coaching grounded in graph/analysis/science signals`, { step: obs.step }),
  ];
}

// ===========================================================================
// A6 — debug output explains what happened
// ===========================================================================

export function a6DebugExplains(obs: TurnObservation): Finding[] {
  const trace = getDiagnosticTrace(obs.body);
  const ids = trace?.correlation_ids;
  const traceComplete =
    Boolean(trace?.exit_path) &&
    Boolean(ids?.request_id) &&
    Boolean(ids?.scenario_id) &&
    Boolean(ids?.turn_id);

  if (traceComplete) {
    return [
      makeFinding(
        'A6',
        'pass',
        'none',
        `_diagnostic_trace present: exit_path="${String(trace?.exit_path)}" correlation_ids ✓ timings=${hasTimings(obs.body)}`,
        { step: obs.step },
      ),
    ];
  }

  // Missing/incomplete trace. Guardrail #4 — never a silent pass.
  if (obs.diagnosticTraceExpected) {
    return [
      makeFinding(
        'A6',
        'fail',
        'high',
        `diagnostic trace flag is ON but _diagnostic_trace ${trace === undefined ? 'is absent' : 'is incomplete (missing exit_path/correlation_ids)'} — observability regression`,
        { step: obs.step },
      ),
    ];
  }
  return [
    makeFinding(
      'A6',
      'inconclusive',
      'high',
      `no _diagnostic_trace and CEE_DIAGNOSTIC_TRACE_ENABLED not confirmed ON — cannot prove the system explained itself ` +
        `(missing observability is a high-priority finding; confirm the trace flag before treating this run as meaningful)`,
      { step: obs.step },
    ),
  ];
}

// ===========================================================================
// A7 — repairs/recoveries are visible, not silent
// ===========================================================================

export function a7RecoveryVisible(obs: TurnObservation): Finding[] {
  const errorEnvelope = hasErrorEnvelope(obs.body);
  const ar = getAnalysisReady(obs.body);
  const repairs = Array.isArray(ar?.model_adjustments) ? ar!.model_adjustments!.length : 0;

  if (obs.httpStatus >= 500) {
    return [
      makeFinding(
        'A7',
        'fail',
        'high',
        `turn failed with HTTP ${obs.httpStatus} — recoverable failures should surface as a graceful 200 + recovery chip, not a hard 5xx`,
        { step: obs.step },
      ),
    ];
  }
  if (obs.httpStatus !== 200) {
    return [
      makeFinding(
        'A7',
        'fail',
        'medium',
        `turn returned HTTP ${obs.httpStatus} (non-200) — recovery/repair not visible as a graceful response`,
        { step: obs.step },
      ),
    ];
  }
  if (obs.httpStatus === 200 && errorEnvelope) {
    return [
      makeFinding(
        'A7',
        'fail',
        'high',
        `HTTP 200 carries an error envelope — a failure disguised as success (not visible as a failure)`,
        { step: obs.step },
      ),
    ];
  }
  if (repairs > 0) {
    return [
      makeFinding(
        'A7',
        'pass',
        'none',
        `repairs surfaced to the user via analysis_ready.model_adjustments (n=${repairs})`,
        { step: obs.step },
      ),
    ];
  }
  return [
    makeFinding('A7', 'pass', 'none', `graceful turn (http=200, no hidden error envelope, no silent repair)`, {
      step: obs.step,
    }),
  ];
}

// ===========================================================================
// A8 — a non-committing change request never claims a mutation it did not make
// (lived defect 1: phantom / false-success acknowledgement on a no-op edit)
// ===========================================================================

/**
 * Roles where a mutation success claim is legitimate or out of scope for A8:
 * `mutate` is a committed value-edit (A3/A4 own it); draft/analysis/rerun do
 * not claim graph mutations. A8 guards every OTHER turn — any conversational
 * turn that claims a mutation it did not durably make is a phantom success.
 *
 * This is deliberately role-agnostic: the real lived defect (row a9da06f2) was
 * a `direct_answer`/proposal turn, not a `mutate_intent` — so gating A8 to one
 * role would miss it. The honest-proposal real text still PASSES (it makes no
 * success claim); a success-claim variant FAILS.
 */
const A8_EXCLUDED_ROLES: ReadonlyArray<TurnRole> = ['draft', 'analysis', 'rerun_analysis', 'mutate'];

/**
 * A turn that should NOT durably commit (a change *request*, a proposal, a
 * Q&A) must never claim a mutation it did not make. The lived defect is a turn
 * that says "Updated the Budget factor…" while canonical state never moved.
 * Safety/honesty gate (like A4), NOT advisory.
 *
 * "No durable change" is grounded in THREE independent wire signals (any one
 * proves non-durability): the `current_graph_hash` did not move from the
 * pre-turn hash; OR no committing `handler_id` ran; OR the turn only emitted a
 * `proposed_*` pending action. A success claim under any of these is phantom.
 */
export function a8NonCommittingNoFalseSuccess(obs: TurnObservation): Finding[] {
  if (A8_EXCLUDED_ROLES.includes(obs.role)) return [];
  if (obs.httpStatus !== 200) return []; // failure is A7's concern, not A8's
  const text = getAssistantText(obs.body);
  const mutationAck = MUTATION_ACK_PATTERN.test(text);
  const openingClaim = OPENING_SUCCESS_CLAIM.test(text);
  const clarify = CLARIFICATION_BACK_PATTERN.test(text);
  // A "success claim" mirrors the product's opening-anchored SUCCESS_CLAIM_PATTERNS
  // (a line that OPENS with a mutation verb). A bare mid-sentence mutation verb
  // (e.g. "…reflects the updated Budget importance" on a reload) is DESCRIPTIVE,
  // not a claim — so the broad mutation-ack only counts on an explicit
  // `mutate_intent` turn, where any mutation acknowledgement is suspicious.
  // Known limitation: a buried first-person claim ("I've added X") on a non-intent
  // turn is not caught — same precision boundary as the product's own detector.
  const claimsMutation = openingClaim || (obs.role === 'mutate_intent' && mutationAck);

  // A8 only has something to assert when the turn either claims a mutation, or
  // is an explicit non-committing edit intent (which we always score for coverage).
  if (!claimsMutation && obs.role !== 'mutate_intent') return [];

  const current = getCurrentGraphHash(obs.body);
  const prior = obs.priorGraphHash ?? undefined;
  const hashObservable = current !== undefined && prior !== undefined;
  const hashMoved = hashObservable && current !== prior;
  const handlerId = getHandlerId(obs.body);
  const proposalOnly = hasProposedPendingAction(obs.body);
  const evid =
    `hash_observable=${hashObservable} hash_moved=${hashMoved} handler_id=${handlerId ?? 'none'} proposal_only=${proposalOnly}`;

  if (claimsMutation) {
    // The graph hash is the AUTHORITATIVE durability signal. A moved hash proves
    // a real mutation — the claim is honest. (A running handler is NOT proof: a
    // non-mutating handler like `explain_result` leaves the hash unchanged.)
    if (hashMoved) {
      return [
        makeFinding('A8', 'pass', 'none', `claimed mutation is durable — graph hash moved (${evid})`, { step: obs.step }),
      ];
    }
    // Provable phantom: hash observable but unmoved, OR the turn only proposed.
    if ((hashObservable && !hashMoved) || proposalOnly) {
      return [
        makeFinding(
          'A8',
          'fail',
          'high',
          `turn (role=${obs.role}) claims a mutation (ack=${mutationAck} opening_claim=${openingClaim}) but made ` +
            `no durable change — ${evid}. Phantom success: a claimed mutation with no commit.`,
          { step: obs.step },
        ),
      ];
    }
    // Hash not observable and not a proposal → cannot prove/disprove the claim.
    return [
      makeFinding(
        'A8',
        'inconclusive',
        'high',
        `turn (role=${obs.role}) claims a mutation but durability is not observable — ${evid}. ACCEPTANCE ` +
          `REQUIREMENT: emit current_graph_hash on edit turns so phantom success is detectable.`,
        { step: obs.step },
      ),
    ];
  }

  // No mutation claim — honest clarify/propose/Q&A.
  return [
    makeFinding(
      'A8',
      'pass',
      'none',
      `no phantom success (role=${obs.role} clarify=${clarify} claims_mutation=false ${evid})`,
      { step: obs.step },
    ),
  ];
}

// ===========================================================================
// A9 — AI-facing context is observable on the wire (lived defect 2)
// ===========================================================================

const A9_CONTEXT_ELEMENTS = ['graph', 'analysis_state', 'blockers', 'capabilities', 'recent_turn_state'] as const;

/**
 * Journey-level: does ANY turn expose an AI-facing context summary on the wire
 * (`_context_summary` / `_diagnostic_trace.context_summary`)? Today none do —
 * so A2 can only be proven in-process. A9 names that gap as an explicit CEE
 * acceptance requirement (inconclusive, never a pass) rather than letting the
 * blind spot read as green. When the surface lands, A9 validates the five
 * required elements and graduates to pass/fail.
 */
export function a9ContextSurfaced(observations: readonly TurnObservation[]): Finding[] {
  const withCtx = observations.find((o) => getContextSummary(o.body) !== undefined);
  if (withCtx === undefined) {
    return [
      makeFinding(
        'A9',
        'inconclusive',
        'high',
        `no turn exposed an AI-facing context summary on the wire (_context_summary / ` +
          `_diagnostic_trace.context_summary absent on all ${observations.length} turns) — A2 context completeness ` +
          `cannot be proven live, only in-process. ACCEPTANCE REQUIREMENT: emit a flag-gated context summary ` +
          `(canonical-state M3) carrying graph + analysis_state + blockers + capabilities + recent_turn_state.`,
      ),
    ];
  }
  const summary = getContextSummary(withCtx.body)!;
  const missing = A9_CONTEXT_ELEMENTS.filter((k) => {
    const v = summary[k];
    return v === undefined || v === null || (Array.isArray(v) && v.length === 0) || v === false;
  });
  if (missing.length > 0) {
    return [
      makeFinding(
        'A9',
        'fail',
        'high',
        `wire context summary present (step=${withCtx.step}) but missing required element(s): ${missing.join(', ')}`,
      ),
    ];
  }
  return [
    makeFinding(
      'A9',
      'pass',
      'none',
      `AI-facing context summary observable on the wire (step=${withCtx.step}) with all five required elements`,
    ),
  ];
}

// ===========================================================================
// A10 — simple deterministic turns stay within an advisory latency budget
// (lived defect 3: latency tracking for simple turns). ADVISORY — never gates.
// ===========================================================================

/** Advisory per-class latency budgets (ms). Tunable; intentionally generous. */
export const LATENCY_BUDGET_MS = {
  /** llm_calls === 0 — a simple deterministic turn (the class the brief names). */
  deterministic: 1500,
  /** Draft generation (heavy LLM graph synthesis). */
  draft: 60000,
  /** run_analysis / rerun (PLoT→ISL compute round-trip). */
  analysis: 12000,
  /** Any other LLM-bearing turn (explain / follow-up / reload / premortem). */
  llm: 12000,
} as const;

export interface LatencyClass {
  readonly cls: 'deterministic' | 'draft' | 'analysis' | 'llm' | 'unknown';
  readonly budgetMs: number;
}

/** Pick the advisory budget class for a turn from its role + llm-call count. */
export function latencyClassFor(obs: TurnObservation): LatencyClass {
  if (obs.role === 'draft') return { cls: 'draft', budgetMs: LATENCY_BUDGET_MS.draft };
  if (obs.role === 'analysis' || obs.role === 'rerun_analysis') {
    return { cls: 'analysis', budgetMs: LATENCY_BUDGET_MS.analysis };
  }
  const llm = getLlmCalls(obs.body);
  if (llm === 0) return { cls: 'deterministic', budgetMs: LATENCY_BUDGET_MS.deterministic };
  // Unknown determinism falls back to the (generous) llm budget so a missing
  // llm_calls field never manufactures a latency fail.
  return { cls: llm === undefined ? 'unknown' : 'llm', budgetMs: LATENCY_BUDGET_MS.llm };
}

/**
 * Roles that V5 is designed to handle deterministically (no LLM call): a typed
 * value-edit, a non-committing edit intent (clarify/propose), and "what
 * changed" (reads recent_changes). An LLM call on one of these is a *wrongful
 * escalation* — it adds latency + nondeterminism for work the gate should do.
 * The real lived turn (row a9da06f2) escalated a proposal/edit-failure turn to
 * a 1-call, ~11.3s LLM route — within the generic LLM time budget, so a purely
 * time-based A10 missed it. Escalation detection catches it.
 */
export const DETERMINISTIC_ELIGIBLE_ROLES: ReadonlyArray<TurnRole> = [
  'mutate',
  'mutate_intent',
  'explain_changed',
];

export function a10Latency(obs: TurnObservation): Finding[] {
  const total = getTurnTotalMs(obs);
  const llm = getLlmCalls(obs.body);
  const { cls, budgetMs } = latencyClassFor(obs);
  const eligible = DETERMINISTIC_ELIGIBLE_ROLES.includes(obs.role);
  const overBudget = total !== undefined && total > budgetMs;
  const latencyNote = total === undefined ? 'latency=unobservable' : `${total}ms`;

  // Wrongful LLM escalation — highest-priority A10 signal. A deterministic-
  // eligible turn that made ≥1 LLM call is a latency/orchestration defect even
  // when it lands inside the generic LLM time budget. Advisory.
  if (eligible && typeof llm === 'number' && llm > 0) {
    return [
      makeFinding(
        'A10',
        'fail',
        'low',
        `wrongful LLM escalation: deterministic-eligible turn (role=${obs.role}) made ${llm} LLM call(s) ` +
          `(${latencyNote}) — should be handled by the deterministic gate; the escalation adds latency + nondeterminism`,
        { step: obs.step },
      ),
    ];
  }

  if (total === undefined) {
    return [
      makeFinding(
        'A10',
        'inconclusive',
        'low',
        `turn latency not observable (_timings.turn.total_ms absent and no client elapsed) — latency not trackable ` +
          `(enable V5_TIMING_DEBUG to capture it)`,
        { step: obs.step },
      ),
    ];
  }
  if (overBudget) {
    return [
      makeFinding(
        'A10',
        'fail',
        'low',
        `latency ${total}ms exceeds the ${cls} advisory budget (${budgetMs}ms; llm_calls=${llm ?? 'unknown'}) — advisory`,
        { step: obs.step },
      ),
    ];
  }
  return [
    makeFinding(
      'A10',
      'pass',
      'none',
      `latency ${total}ms within ${cls} budget (${budgetMs}ms; llm_calls=${llm ?? 'unknown'})`,
      { step: obs.step },
    ),
  ];
}

// ===========================================================================
// A11 — premortem / challenge prompts handled safely (lived defect 4, secondary)
// ===========================================================================

/**
 * Safe-handling ONLY (per the brief): structural framing, a clear next step,
 * and no overclaiming / invented science. Reuses the existing leakage and
 * success-claim detectors — it invents no new prose-quality heuristics — and
 * is ADVISORY (reads generated prose; the deterministic replay is the gate).
 */
export function a11PremortemSafe(obs: TurnObservation): Finding[] {
  if (obs.role !== 'premortem') return [];
  if (obs.httpStatus !== 200 || hasErrorEnvelope(obs.body)) {
    return [
      makeFinding('A11', 'fail', 'medium', `premortem turn did not return a clean 200 response (http=${obs.httpStatus})`, {
        step: obs.step,
      }),
    ];
  }
  const text = getAssistantText(obs.body);
  if (text.trim().length === 0) {
    return [makeFinding('A11', 'fail', 'medium', `premortem turn returned empty prose`, { step: obs.step })];
  }
  // Overclaiming: a false mutation/success claim on a discuss-only turn.
  if (OPENING_SUCCESS_CLAIM.test(text)) {
    const m = text.match(OPENING_SUCCESS_CLAIM);
    return [
      makeFinding(
        'A11',
        'fail',
        'medium',
        `premortem (discuss-only) opens with a mutation/success claim: "${m?.[0]?.trim() ?? ''}"`,
        { step: obs.step },
      ),
    ];
  }
  // Clear next step: a chip OR forward-looking guidance language.
  const hasNextStep =
    getChips(obs.body).length > 0 ||
    /\b(consider|you could|next step|to (?:de-?risk|reduce|test|confirm|validate)|worth|recommend|suggest)\b/i.test(text);
  if (!hasNextStep) {
    return [
      makeFinding(
        'A11',
        'fail',
        'low',
        `premortem response offers no clear next step or proposal (no chip, no forward-looking guidance)`,
        { step: obs.step },
      ),
    ];
  }
  return [
    makeFinding('A11', 'pass', 'none', `premortem handled safely: structural framing, clear next step, no overclaiming`, {
      step: obs.step,
    }),
  ];
}

// ===========================================================================
// Per-turn dispatch + whole-journey evaluation
// ===========================================================================

/** Run every invariant that applies to a single turn's role. */
export function evaluateObservation(obs: TurnObservation): Finding[] {
  const findings: Finding[] = [];
  // Universal: observability + recovery + false-success + latency run on every turn.
  findings.push(...a6DebugExplains(obs));
  findings.push(...a7RecoveryVisible(obs));
  findings.push(...a4NoFalseSuccess(obs));
  findings.push(...a10Latency(obs));
  // A8 is role-agnostic (self-filters excluded roles + non-claiming turns) so a
  // phantom success on a direct_answer/explain/proposal turn is caught, not just
  // on the synthetic mutate_intent step.
  findings.push(...a8NonCommittingNoFalseSuccess(obs));

  // Role-specific blind-spot-closure invariants.
  if (obs.role === 'premortem') findings.push(...a11PremortemSafe(obs));

  const ANALYSIS_BEARING: ReadonlyArray<TurnObservation['role']> = [
    'analysis',
    'explain',
    'follow_up',
    'rerun_analysis',
    'explain_changed',
    'reload',
    // A concrete value-edit mutate carries analysis_ready with freshness='stale'
    // ("…makes the last analysis stale, re-run…") — A1 checks that staleness is
    // acknowledged (not presented as fresh). A vague no-op mutate carries no
    // analysis_ready, so a1AnalysisCoherence returns [] for it.
    'mutate',
  ];
  if (ANALYSIS_BEARING.includes(obs.role)) findings.push(...a1AnalysisCoherence(obs));
  if (obs.role === 'rerun_analysis') findings.push(...a3DurableStateChanged(obs));
  if (obs.role === 'explain' || obs.role === 'explain_changed' || obs.role === 'follow_up') {
    findings.push(...a5CoachingGrounded(obs));
  }
  return findings;
}

export interface JourneyEvaluation {
  readonly findings: readonly Finding[];
  readonly caveats: readonly CoverageCaveat[];
}

export interface EvaluateJourneyOptions {
  /** Whether the diagnostic-trace flag was confirmed ON for the run (guardrail #5). */
  readonly diagnosticTraceExpected: boolean;
  /**
   * In-process A2 snapshot, when available (the committed test wires it).
   * Absent on the live/replay path → A2 emits the not-wire-observable stub.
   */
  readonly a2Snapshot?: ContextSnapshot;
  /**
   * Set when the run had to fall back from the typed/`set_factor_value`
   * mutation path because it was too label-fragile (guardrail #3).
   */
  readonly setFactorValueFragile?: boolean;
}

/**
 * Classify a whole captured journey. Per-turn findings + A2 + the dispatch
 * coverage caveats. Hash memory (`priorRunHash`) must already be threaded
 * onto the observations (see `threadHashMemory` in `journey.ts`).
 */
export function evaluateJourney(
  observations: readonly TurnObservation[],
  opts: EvaluateJourneyOptions,
): JourneyEvaluation {
  const findings: Finding[] = [];
  for (const obs of observations) findings.push(...evaluateObservation(obs));
  findings.push(...(opts.a2Snapshot ? a2ContextCompleteness(opts.a2Snapshot) : a2LiveStub()));
  // A9 is journey-level (like A2): one verdict over whether ANY turn surfaced
  // AI-facing context on the wire.
  findings.push(...a9ContextSurfaced(observations));

  const caveats: CoverageCaveat[] = [
    {
      component: 'context_management',
      title: 'A2 asserted in-process only',
      detail:
        'AI-facing context completeness (A2) is proven by the committed in-process test, NOT on the live ' +
        'system — the ContextPack is never serialised on the wire. It stays in-process / wire-inconclusive ' +
        'until the canonical-state M3 `_context_summary` debug surface lands (then A2 becomes wire-observable ' +
        'in the live report).',
    },
    {
      component: 'typed_action_mutation',
      title: 'Mutate covers the typed scalar value-edit path only',
      detail:
        'The mutate step drives a concrete scalar value-edit (`Set <captured factor> to 0.5`) — a REAL ' +
        'durable mutation that routes through the TYPED scalar handler (observed live: ' +
        'handler_id=`set_factor_value`, exit_path=`turn_executor`, llm_calls=0). This is genuine typed ' +
        'scalar-value coverage — NOT the old vague `edit_graph_generic` no-op, and NOT typed-ops / typed ' +
        'add_option apply coverage. Add a typed-ops / add_option journey when that path exists (guardrail #3).',
    },
    {
      component: 'science_grounded_coaching',
      title: 'Live A5 is advisory, not a hard gate',
      detail:
        'The DETERMINISTIC REPLAY is the stable regression gate. Live semantic checks (A5 coaching-grounding; ' +
        'A1 while provisional) are ADVISORY: a lone live fail does not gate (non-zero exit) unless reproduced ' +
        'across repeated calls or backed by deterministic context evidence. A5 already keys on GROUNDING TOKENS ' +
        '(option/factor label, probability, science enrichment), NOT response length. A 5× repeat of ' +
        'explain_leader on a constant scenario reproduced zero thin/ungrounded responses with stable analysis ' +
        'context — the earlier single thin response classified as likely LLM variance. A5 strengthens once the ' +
        'canonical-state M3 `_context_summary` surface exposes the actual context the model received.',
    },
    {
      component: 'context_management',
      title: 'A9 — context observability is a CEE acceptance requirement',
      detail:
        'A9 tracks whether the wire exposes an AI-facing context summary (`_context_summary` / ' +
        'trace.context_summary). It is absent on every path today, so A9 is INCONCLUSIVE and recorded as a ' +
        'CEE acceptance requirement — NOT a pass. The blind spot turns green only when the canonical-state M3 ' +
        'context summary lands; until then A2 can be proven in-process only.',
    },
    {
      component: 'ai_orchestration',
      title: 'A10 — latency is advisory + environment-variance-prone',
      detail:
        'A10 captures per-turn `_timings.turn.total_ms` (fallback: client elapsed) and flags simple deterministic ' +
        'turns (llm_calls=0) against a tight advisory budget; LLM/draft/analysis turns use generous budgets. It ' +
        'NEVER gates the exit code — latency varies with cache state, model load and network. The latency summary ' +
        'table reports every turn so deterministic-turn improvement is trackable across runs.',
    },
    {
      component: 'typed_action_mutation',
      title: 'A8 — non-committing-intent coverage needs the hash trio',
      detail:
        'A8 proves a change *request* that should not commit never claims a mutation it did not make. The ' +
        'phantom-success verdict is wire-grounded to `current_graph_hash` vs the pre-turn graph hash; when the ' +
        'hash trio is absent A8 is INCONCLUSIVE (acceptance requirement: emit the hash on edit-intent turns), ' +
        'never a pass.',
    },
  ];
  if (opts.setFactorValueFragile) {
    caveats.push({
      component: 'typed_action_mutation',
      title: 'Concrete scalar value-edit clarified instead of mutating',
      detail:
        'The concrete `Set <factor> to 0.5` instruction returned a clarification / no-op rather than a ' +
        'durable mutation on this run. Record as a Component-4 finding (guardrail #3): the scalar value-edit ' +
        'path is not reliably drivable end-to-end for the drafted factor label.',
    });
  }
  if (!opts.diagnosticTraceExpected) {
    caveats.push({
      component: 'observability_recovery',
      title: 'Diagnostic-trace flag not confirmed ON',
      detail:
        'CEE_DIAGNOSTIC_TRACE_ENABLED / V5_TIMING_DEBUG were not confirmed enabled for this run, so A6 is ' +
        'mostly inconclusive (guardrail #5). This baseline must not be treated as meaningful observability ' +
        'coverage until the trace flags are confirmed safely enabled.',
    });
  }

  return { findings, caveats };
}
