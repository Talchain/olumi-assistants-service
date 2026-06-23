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
  getCurrentGraphHash,
  getDiagnosticTrace,
  getFreshness,
  hasTimings,
  isAnalysisReadyComplete,
  type TurnObservation,
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
// Per-turn dispatch + whole-journey evaluation
// ===========================================================================

/** Run every invariant that applies to a single turn's role. */
export function evaluateObservation(obs: TurnObservation): Finding[] {
  const findings: Finding[] = [];
  // Universal: observability + recovery + false-success run on every turn.
  findings.push(...a6DebugExplains(obs));
  findings.push(...a7RecoveryVisible(obs));
  findings.push(...a4NoFalseSuccess(obs));

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
