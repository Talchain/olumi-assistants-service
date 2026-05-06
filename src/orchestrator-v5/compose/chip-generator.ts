/**
 * V5 Task 2.1 — deterministic chip generation for successful turns.
 *
 * Standard compose functions (composeDirectAnswerResponse,
 * composeToolCallResponse) previously emitted `suggested_actions: []`. This
 * generator produces stage-aware, context-aware chip suggestions so
 * successful turns give the user a visible next step without forcing them to
 * know what to ask next.
 *
 * Two kinds of chips:
 *   - Executable chips carry `action_type`, mapping to a registered handler
 *     (e.g. `run_analysis`). The UI submits a chip_click event that routes
 *     straight to the deterministic handler — no LLM. Only emitted for
 *     handlers actually present in the validation registry.
 *   - Conversational prompt chips omit `action_type`. The UI submits the
 *     chip `message` as user text; the next turn runs through routing with
 *     that text as the user message. Safe because no handler is implied.
 *
 * Prompt-chip copy is deliberately self-contained. The routing prompt has
 * no conversation history (Task 1.1 deferred), so "Explain the result"
 * must work as a freestanding first message — not as a reference to the
 * turn that emitted the chip.
 *
 * Rules are deterministic. **Chips are derived from structured state only —
 * never from parsing the model's response text.** Reading response text for
 * chip decisions is a contract violation; see
 * `Docs/v5/v5-resilience-contract.md` Part D. Do not call an LLM from here.
 *
 * V5 alpha hardening Phase 2.4: readiness gate for the executable
 * `Run analysis` chip. Source order (correction 11):
 *   1. `input.analysisReady` — pre-computed payload threaded by the call
 *      site (from draft-graph-dispatch or turn-executor).
 *   2. Otherwise `computeStructuralReadiness(graph)` — not done here; the
 *      call site MUST do the computation and pass it in.
 *   3. If `analysisReady` is undefined, readiness is unknown and the
 *      executable chip MUST NOT render. Fall back to a conversational
 *      prompt. The `graphOptionCount` hint still drives fallback copy.
 *
 * The executable chip emits iff `analysisReady.status === 'ready'` — the
 * `computeStructuralReadiness` helper already verifies goal node +
 * ≥2 options + every non-baseline option having ≥1 numeric intervention.
 * See `src/orchestrator/tools/analysis-ready-helper.ts`.
 */

import type { HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';
import type { StageType } from '@talchain/schemas/boundary';

import { log } from '../../utils/telemetry.js';
import type { SuggestedAction } from './types.js';
import type { HandlerValidationRegistry } from '../routing/validator.js';
import { curatedHandlerChips } from './helpers.js';
import type { ContextPackAnalysis } from '../context/context-pack-assembler.js';
import type { GraphPatchBlockData } from '../../orchestrator/types.js';
import { isSuccessfulRunAnalysisFact } from '../context/freshness.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

export interface ChipGeneratorInput {
  readonly stage: StageType;
  /** Handler facts produced on THIS turn (empty for converse/clarify). */
  readonly handlerFacts?: readonly HandlerFact[];
  /** Analysis state projection (the same one that went into ContextPack). */
  readonly analysis?: ContextPackAnalysis | null;
  /** Validation registry — used to verify executable chips only point at
   *  handlers that are actually registered. */
  readonly validationRegistry: HandlerValidationRegistry;
  /**
   * V5 alpha hardening Phase 2.4: full structural readiness payload. When
   * present with `status === 'ready'`, the executable `Run analysis` chip
   * is safe to render — `computeStructuralReadiness` already verified the
   * full set of preconditions (goal node present, ≥2 options with numeric
   * interventions). When present with any other status (`needs_user_input`,
   * `needs_user_mapping`, `needs_encoding`), the chip falls back to a
   * conversational prompt. When undefined (graph absent or readiness not
   * computed), readiness is treated as unknown and the executable variant
   * MUST NOT render.
   *
   * Source order (correction 11 of the alpha hardening plan):
   *   1. Pre-computed payload threaded by the call site (preferred).
   *   2. Fallback: the call site calls `computeStructuralReadiness(graph)`
   *      and passes the result here.
   *   3. Neither available → leave this field undefined.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * Legacy hint: count of option nodes on the graph. Retained for
   * conversational-fallback copy selection (so "Set values for options"
   * vs "Run the analysis" depends on whether ANY options exist). NOT a
   * readiness signal on its own — see `analysisReady` above.
   */
  readonly graphOptionCount?: number;
  /**
   * V5 0.9.0: prior-turn handler facts loaded from the session store.
   * `handlerFacts` above only carries the CURRENT turn's facts — fine for
   * "did run_analysis just succeed?" but wrong for "is there an analysis
   * record anywhere in the conversation?" The new `facts_absent` rule
   * needs the cross-turn view: if a prior `run_analysis` fact exists but
   * the current turn is a noop explanation, we should NOT emit a "Run
   * analysis" chip (the user already has analysis). Optional for
   * compatibility with chip-suppression / regression tests that pass only
   * the current turn's facts.
   */
  readonly priorFacts?: readonly HandlerFact[];
  /**
   * V5 state-trust: turn outcome contract. The freshness verdict drives
   * the "Rerun analysis" chip — emitted only when `analysis_freshness ===
   * 'stale'`. Optional for backwards-compatibility with call sites that
   * don't yet derive freshness (chip-suppression / regression tests pass
   * fewer fields). When omitted, the chip suppresses (safe default).
   */
  readonly turnOutcome?: import('../turn-outcome.js').TurnOutcome;
}

const MAX_CHIPS = 3;

/**
 * Defensive chip-egress validator. Drops chips that cannot map cleanly to a
 * registered action: literal `null` action_types (defence against upstream
 * regressions that fill optional fields with null), and action_types that
 * point at handlers absent from the validation registry. Prompt chips
 * (action_type omitted entirely) pass through unchanged — they are
 * conversational text, not handler invocations.
 *
 * Policy: dead or misleading chips are worse than missing chips. No
 * fallback action_type is invented; the offending chip is suppressed.
 */
export function validateAndFilterChips(
  chips: readonly SuggestedAction[],
  registry: HandlerValidationRegistry,
): readonly SuggestedAction[] {
  return chips.filter((chip) => {
    if (!('action_type' in chip)) return true;
    const at = (chip as { action_type?: unknown }).action_type;
    if (at === undefined) return true;
    if (at === null) {
      // Silent drops hide broken chip generation upstream — emit a
      // structured warning so any regression that re-introduces a
      // null action_type surfaces in logs.
      log.warn(
        {
          event: 'v5.chip.suppressed',
          action_type: null,
          reason: 'null_action_type',
          chip_label: (chip as { label?: unknown }).label ?? null,
        },
        'V5 chip suppression — chip dropped because action_type was literally null',
      );
      return false;
    }
    if (typeof at !== 'string') {
      log.warn(
        {
          event: 'v5.chip.suppressed',
          action_type: typeof at,
          reason: 'null_action_type',
          chip_label: (chip as { label?: unknown }).label ?? null,
        },
        'V5 chip suppression — chip dropped because action_type was not a string',
      );
      return false;
    }
    if (registry[at] == null) {
      log.warn(
        {
          event: 'v5.chip.suppressed',
          action_type: at,
          reason: 'unregistered_handler',
          chip_label: (chip as { label?: unknown }).label ?? null,
        },
        'V5 chip suppression — chip dropped because action_type points at an unregistered handler',
      );
      return false;
    }
    return true;
  });
}

/**
 * Build chips for the compose layer. Returns at most MAX_CHIPS. Returns
 * empty array when no rule applies for the current stage/signals. All
 * emitted chips are passed through `validateAndFilterChips` so a chip
 * with an unmapped or literally-null `action_type` cannot reach the wire.
 */
export function generateChips(input: ChipGeneratorInput): readonly SuggestedAction[] {
  return validateAndFilterChips(generateChipsRaw(input), input.validationRegistry);
}

function generateChipsRaw(input: ChipGeneratorInput): readonly SuggestedAction[] {
  const handlerJustRan = findHandlerJustRan(input.handlerFacts);
  const noopExplanationHandlerJustRan = findNoopExplanationHandlerJustRan(
    input.handlerFacts,
  );
  const preconditionUnmetExplanationFact = findPreconditionUnmetExplanationFact(
    input.handlerFacts,
  );
  const hasAnalysis = input.analysis != null;
  const robustnessIsFragile =
    input.analysis != null && input.analysis.robustness_band === 'fragile';
  // V5 product-state continuity (foamy-bee tranche) — fires only when
  // the mutation ran on the CURRENT turn (handlerFacts). The
  // priorFacts surface is intentionally NOT consulted here: a stale
  // mutation in prior_facts would otherwise trigger the chip on every
  // subsequent converse turn until analysis is rerun — noise the user
  // wouldn't expect.
  //
  // The state-query continuity path composes its own chip inline (see
  // turn-executor's state-query guard block) using the same Run /
  // Rerun analysis logic. Keeping the chip-generator narrow to the
  // current turn means a generic converse turn that happens to have
  // an old mutation in prior_facts cannot accidentally surface a
  // stale "Run analysis" chip.
  const successfulMutationOnCurrentTurn = hasSuccessfulMutationFact(
    input.handlerFacts,
  );

  // Rule: after run_analysis succeeds, prompt for the follow-ups that don't
  // require a new handler. "Explain the result" stays a conversational
  // prompt chip (the explain_results handler dispatch is reached via
  // Sonnet routing on the next turn). "What could change the outcome?"
  // emits a what_would_flip action chip so the chip-click path resolves
  // deterministically AND a pending action lands so a typed "yes" on
  // the next turn can resume via the short-confirm pre-route.
  if (handlerJustRan === 'run_analysis') {
    return cap([
      promptChip(
        'explain_result',
        'Explain the result',
        'Please explain the analysis result in plain language.',
      ),
      {
        id: 'chip_action_what_would_flip',
        label: 'What could change the outcome?',
        message: 'What could change the outcome of this analysis?',
        action_type: 'what_would_flip',
      },
    ]);
  }

  // V5 product-state continuity (foamy-bee tranche) — post-mutation
  // analysis chip. Fires ONLY on the turn that ran the mutation
  // (`successfulMutationOnCurrentTurn`). The user's natural next step
  // is to see how the change affected the recommendation.
  //
  // Boundary with the state-query continuity surface (DO NOT REGRESS):
  // a state-query turn (handlerFacts empty, priorFacts carries a prior
  // mutation) gets its own chip from `composeStateQueryChip` in
  // `routing/state-query-guard.ts`, not from this rule. Re-introducing
  // the priorFacts surface here would surface a stale "Run analysis"
  // chip on every subsequent converse turn until the user reruns
  // analysis — visible noise the user wouldn't expect. The
  // chip-generator's post-mutation rule is current-turn only by design.
  //
  // The chip variant depends on what analysis state already exists:
  //   - Prior successful run_analysis fact AND freshness === 'stale'
  //     (graph hash diverged because the mutation invalidated it) →
  //     "Run analysis again".
  //   - No prior run_analysis fact (model has never been analysed) →
  //     "Run analysis".
  //   - Otherwise (fresh analysis, or model not structurally ready) →
  //     suppress; emitting a chip in those branches would either
  //     mislead the user or trip the validation registry's executable
  //     gate at click time.
  //
  // Placed BEFORE the existing stale-explanation rerun-recovery rule
  // so a turn that both ran a mutation AND would otherwise trigger the
  // explain-with-stale rule still surfaces the post-mutation chip — a
  // mutation is the more proximate signal of "what the user just did".
  if (
    successfulMutationOnCurrentTurn &&
    input.analysisReady?.status === 'ready'
  ) {
    const hasPriorRunAnalysis = (input.priorFacts ?? []).some(
      isSuccessfulRunAnalysisFact,
    );
    const freshness = input.turnOutcome?.analysis_freshness;
    const curated = curatedHandlerChips(input.validationRegistry);
    const runAnalysisRegistered = curated.find(
      (c) => c.handler_id === 'run_analysis',
    );
    if (runAnalysisRegistered) {
      if (hasPriorRunAnalysis && freshness === 'stale') {
        return cap([
          {
            id: 'chip_action_rerun_analysis_after_mutation',
            label: 'Run analysis again',
            message: 'Run the analysis again.',
            action_type: 'run_analysis',
          },
        ]);
      }
      if (!hasPriorRunAnalysis) {
        return cap([
          executableChip(
            runAnalysisRegistered.handler_id as V5ActionType,
            runAnalysisRegistered.label,
          ),
        ]);
      }
    }
    // Fresh analysis or `run_analysis` not registered — fall through
    // to the existing rules. The mutation receipt's deterministic
    // assistant_text already carries a staleness narrative when prior
    // analysis exists, so the user is not left without context.
  }

  // V5 state-trust — stale-analysis recovery chip.
  //
  // When the freshness derivation reports `analysis_freshness === 'stale'`
  // (graph hash diverged since the last run_analysis fact) AND the graph
  // is currently analysable, surface an executable "Rerun analysis" chip
  // so the user can refresh in one click.
  //
  // Retargeted from the legacy `input.analysis?.staleness_reason` gate:
  // the freshness verdict is now the source of truth (deterministic hash
  // comparison), replacing the always-set "loaded_from_prior_run_
  // freshness_unknown" fallback that fired even on fresh analysis. The
  // chip suppresses on fresh / unknown / none — only stale produces it.
  //
  // Placed BEFORE the precondition-unmet and facts_absent rules so the
  // staleness recovery wins for turns that have a stale analysis.
  if (
    noopExplanationHandlerJustRan != null &&
    input.turnOutcome?.analysis_freshness === 'stale' &&
    input.analysisReady?.status === 'ready'
  ) {
    const curated = curatedHandlerChips(input.validationRegistry);
    const runAnalysis = curated.find((c) => c.handler_id === 'run_analysis');
    if (runAnalysis) {
      return cap([
        {
          id: 'chip_action_rerun_analysis',
          label: 'Rerun analysis',
          message: 'Rerun the analysis.',
          action_type: 'run_analysis',
        },
      ]);
    }
  }

  // Rule: after a successful (precondition-met) explain_results turn,
  // surface a what_would_flip action chip. Mirrors the offer the
  // deterministic fallback prose makes ("Would you like to explore
  // what would change this result?") and lets a typed "yes" resume
  // via the short-confirm pre-route.
  //
  // Production explain_results facts always carry noop=true; the
  // success/failure discriminator is result.precondition_unmet.
  // findSuccessfulExplainResultsJustRan filters on
  // precondition_unmet === false. findHandlerJustRan returns only
  // 'run_analysis' so we cannot rely on it for explanation handlers.
  //
  // Placed AFTER the stale-rerun rule so a stale-analysis explain
  // turn surfaces "Rerun analysis" rather than offering to explore
  // a stale result.
  if (findSuccessfulExplainResultsJustRan(input.handlerFacts)) {
    return cap([
      {
        id: 'chip_action_what_would_flip',
        label: 'Explore what would change this',
        message: 'Explore what would change the result.',
        action_type: 'what_would_flip',
      },
    ]);
  }

  // V5 spec §7 every-failure-path-includes-a-chip — explicit precondition rule.
  // When `explain_results` or `what_would_flip` returned a precondition-fail
  // outcome (`noop: true` + `result.precondition_unmet === true`), the
  // handler itself signalled that analysis is missing. The chip MUST fire
  // independent of priorFacts threading: the precondition-fail signal IS the
  // single source of truth for this turn. Placed BEFORE the facts_absent
  // rule below so the precondition-fail path is decided by the typed handler
  // signal, not by re-deriving from priorFacts.
  if (
    preconditionUnmetExplanationFact != null &&
    input.analysisReady?.status === 'ready'
  ) {
    const curated = curatedHandlerChips(input.validationRegistry);
    const runAnalysis = curated.find((c) => c.handler_id === 'run_analysis');
    if (runAnalysis) {
      return cap([
        executableChip(runAnalysis.handler_id as V5ActionType, runAnalysis.label),
      ]);
    }
  }

  // V5 0.9.0 — Rule: when one of the no-op explanation handlers ran but
  // projection is facts_absent (no real run_analysis fact exists yet), the
  // user has asked an analysis-grounded question with no analysis to ground
  // it in. Surface a "Run analysis" executable chip so the user can recover
  // in one click. Gated on analysisReady.status === 'ready' per the same
  // contract used by the analyse-stage rule below — without readiness we
  // fall back to a conversational prompt.
  //
  // This rule fires at ANY stage. The existing analyse-stage rule below
  // covers the case where no handler ran at all; this rule covers the case
  // where Sonnet correctly routed an explanation handler but the analysis
  // is missing. Both target the same recovery action.
  if (
    noopExplanationHandlerJustRan != null &&
    deriveProjectionStatus(
      input.handlerFacts,
      input.analysis ?? null,
      input.priorFacts,
    ) === 'facts_absent'
  ) {
    const readyStatus = input.analysisReady?.status;
    const isReady = readyStatus === 'ready';
    const curated = curatedHandlerChips(input.validationRegistry);
    const runAnalysis = curated.find((c) => c.handler_id === 'run_analysis');
    if (runAnalysis && isReady) {
      return cap([
        executableChip(runAnalysis.handler_id as V5ActionType, runAnalysis.label),
      ]);
    }
    // Readiness unknown / not ready — surface a conversational prompt so
    // the user has a visible next step. Mirrors the analyse-stage fallback.
    return cap([
      promptChip(
        'set_option_values',
        'Set values for options',
        'Help me set up the options for this decision so the analysis can run.',
      ),
    ]);
  }

  // Rule: analyse stage, no analysis yet → run analysis.
  //
  // V5 alpha hardening Phase 2.4: the executable variant is gated on the
  // FULL structural readiness signal — `computeStructuralReadiness`
  // already verified goal node + ≥2 options + every non-baseline option
  // having ≥1 numeric intervention. This closes the gap where the old
  // `graphOptionCount > 0` gate would emit an executable chip on a graph
  // that had options but no interventions configured, leading to
  // PRECONDITION_UNMET or an options_not_configured handler failure on
  // click.
  //
  // When readiness is unknown (undefined or any non-'ready' status), we
  // emit a conversational fallback — steering copy depends on what IS
  // present (some options vs none) so the user always has a visible
  // next step.
  if (input.stage === 'analyse' && !hasAnalysis && handlerJustRan == null) {
    const readyStatus = input.analysisReady?.status;
    const isReady = readyStatus === 'ready';
    const hasOptions = (input.graphOptionCount ?? 0) > 0;
    const curated = curatedHandlerChips(input.validationRegistry);
    const runAnalysis = curated.find((c) => c.handler_id === 'run_analysis');
    if (runAnalysis && isReady) {
      return cap([executableChip(runAnalysis.handler_id as V5ActionType, runAnalysis.label)]);
    }
    if (!hasOptions) {
      return cap([
        promptChip(
          'set_option_values',
          'Set values for options',
          'Help me set up the options for this decision so the analysis can run.',
        ),
      ]);
    }
    // Follow-up review: when readiness is KNOWN but not ready (e.g.
    // needs_user_mapping / needs_encoding), the user's real next step
    // is to configure missing intervention values — NOT to retry an
    // analysis the precondition won't let run. Emitting "Run the analysis"
    // in this branch loop-baited Sonnet back toward a run_analysis call
    // that validator would reject (200 coaching under hardening, but a
    // wasted round-trip either way). The truly-unknown readiness case
    // (analysisReady undefined) is handled in the final branch below
    // with a distinct neutral decision-framing prompt.
    if (readyStatus != null && readyStatus !== 'ready') {
      return cap([
        promptChip(
          'set_option_values',
          'Set values for options',
          'Help me set up the options for this decision so the analysis can run.',
        ),
      ]);
    }
    // Follow-up review: readiness is UNKNOWN (analysisReady undefined —
    // typically no graph / unparseable graph). Pre-follow-up this
    // emitted "Run the analysis" which nudged Sonnet toward an action
    // whose graph precondition is structurally impossible. Under the
    // Phase 2.2 recoverable-validator pattern this wouldn't 500, but it
    // would still waste a round-trip. A neutral decision-framing
    // prompt keeps the user (and the model) focused on whatever
    // structural step is actually next — usually "tell me about the
    // decision" at frame stage.
    return cap([
      promptChip(
        'describe_decision',
        'Tell me about your decision',
        'Tell me about this decision so I can help you work through it.',
      ),
    ]);
  }

  // Rule: decide stage with fragile robustness → prompt for pre-mortem + flip.
  // "What would make this flip" is a self-contained question — works without
  // conversation history because the graph + analysis in the ContextPack
  // give Sonnet enough to answer.
  if (input.stage === 'decide' && robustnessIsFragile) {
    return cap([
      promptChip(
        'what_would_flip',
        'What would make this flip?',
        'What would make the leading option flip to another option?',
      ),
      promptChip(
        'run_pre_mortem',
        'Run a pre-mortem',
        'Imagine this decision went wrong — what would have caused it?',
      ),
    ]);
  }

  // Rule: decide stage with stable analysis → explain-the-decision prompt.
  if (input.stage === 'decide' && hasAnalysis && !robustnessIsFragile) {
    return cap([
      promptChip(
        'explain_decision',
        'Explain the decision',
        'Help me explain why this is the right decision.',
      ),
    ]);
  }

  // Rule: review stage → summarise.
  if (input.stage === 'review') {
    return cap([
      promptChip(
        'summarise_decision',
        'Summarise the decision',
        'Summarise the decision and the key trade-offs.',
      ),
    ]);
  }

  // Rule: frame stage with no graph yet is handled by the draft_graph
  // heuristic dispatch before reaching compose. On the rare frame-stage
  // converse turns, no chip is meaningful.
  return [];
}


/**
 * V5 product-state continuity (foamy-bee tranche) — true when at least
 * one of the supplied facts is a successful (non-noop) mutation. The
 * post-mutation chip rule shares this predicate across the
 * "this turn mutated" (handlerFacts) and "a prior turn mutated"
 * (priorFacts) surfaces.
 */
function hasSuccessfulMutationFact(
  facts: readonly HandlerFact[] | undefined,
): boolean {
  if (!facts) return false;
  for (const f of facts) {
    if (
      !f.noop &&
      (f.fact_type === 'add_constraint' ||
        f.fact_type === 'set_factor_value' ||
        f.fact_type === 'adjust_edge_strength')
    ) {
      return true;
    }
  }
  return false;
}

function findHandlerJustRan(
  facts: readonly HandlerFact[] | undefined,
): V5ActionType | null {
  if (!facts || facts.length === 0) return null;
  for (const f of facts) {
    // Single source of truth (P0 V5 golden-path repair): a run_analysis
    // fact only counts as "this handler just ran successfully" when it
    // also passes the freshness eligibility — i.e. status normalises to a
    // canonical success or is missing entirely (legacy fact). Partial /
    // failed / blocked facts are not "successful runs" and must not gate
    // explanation chips. Mirrors the precondition in explain_results /
    // what_would_flip and the selector in context/freshness.ts.
    if (isSuccessfulRunAnalysisFact(f)) return 'run_analysis';
  }
  return null;
}

/**
 * Did `explain_results` produce a successful (precondition-met) fact
 * this turn?
 *
 * Production `explain_results` facts ALWAYS carry `noop: true` —
 * regardless of whether the handler successfully composed an answer
 * or short-circuited on a precondition failure. The real success/
 * failure discriminator is `result.precondition_unmet`:
 *   - true  → handler bailed before composing an answer
 *   - false → handler emitted prose ending with the explore offer
 *
 * Gating on `noop !== true` (an earlier mistake) was dead code: no
 * production fact would ever match. The correct predicate is
 * `precondition_unmet === false`. The misleadingly-named
 * `findNoopExplanationHandlerJustRan` is kept for the precondition-
 * unmet rule below.
 */
function findSuccessfulExplainResultsJustRan(
  facts: readonly HandlerFact[] | undefined,
): boolean {
  if (!facts || facts.length === 0) return false;
  for (const f of facts) {
    if (f.fact_type !== 'explain_results') continue;
    const result = (f as { result?: unknown }).result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const r = result as { precondition_unmet?: unknown };
      if (r.precondition_unmet === false) return true;
    }
  }
  return false;
}

// V5 0.9.0 — return the no-op fact_type when one of the new no-op handlers
// produced a fact on this turn. Used to drive the "Run analysis" chip
// when explain_results / what_would_flip / explain_from_structure ran but
// no real analysis fact exists in prior_facts.
function findNoopExplanationHandlerJustRan(
  facts: readonly HandlerFact[] | undefined,
): 'explain_from_structure' | 'explain_results' | 'what_would_flip' | null {
  if (!facts || facts.length === 0) return null;
  for (const f of facts) {
    if (
      f.fact_type === 'explain_from_structure' ||
      f.fact_type === 'explain_results' ||
      f.fact_type === 'what_would_flip'
    ) {
      return f.fact_type;
    }
  }
  return null;
}

// V5 spec §7 every-failure-path-includes-a-chip — return the fact_type when
// `explain_results` or `what_would_flip` produced a precondition-fail
// outcome (the typed handler-fact signal that analysis is missing on a turn
// asking for analysis-grounded explanation). `explain_from_structure` is
// excluded: it has no analysis precondition. The runtime check on
// `result.precondition_unmet === true` narrows the discriminated union
// without an `as` cast.
function findPreconditionUnmetExplanationFact(
  facts: readonly HandlerFact[] | undefined,
): 'explain_results' | 'what_would_flip' | null {
  if (!facts || facts.length === 0) return null;
  for (const f of facts) {
    if (
      (f.fact_type === 'explain_results' || f.fact_type === 'what_would_flip') &&
      f.noop === true &&
      'result' in f &&
      f.result != null &&
      typeof f.result === 'object' &&
      'precondition_unmet' in f.result &&
      f.result.precondition_unmet === true
    ) {
      return f.fact_type;
    }
  }
  return null;
}

/**
 * Three-state derivation of the analysis projection status used by the
 * "facts_absent" chip rule below.
 *
 * - `facts_absent`     — no non-noop run_analysis fact across this turn's
 *                       handlerFacts OR prior_facts.
 * - `projection_empty` — fact present (current or prior) but the analysis
 *                       projection has no leading_option (PLoT degraded /
 *                       blocked / unknown).
 * - `projection_populated` — fact present and projection has data.
 *
 * **Critical:** the run_analysis check is `!f.noop`. A noop run_analysis
 * fact and any noop explanation fact (`explain_results`, `what_would_flip`,
 * `explain_from_structure`) must NOT count as "facts present" — they carry
 * no projection data for Sonnet to reference.
 *
 * **Single source of truth (V5 0.9.0):** the persisted `run_analysis`
 * HandlerFact is the canonical signal. The chip rule and the handler-side
 * precondition (`explain_results`/`what_would_flip` checking
 * `prior_facts`) MUST agree on this. Earlier iterations also treated a
 * populated context-pack analysis projection (`leading_option != null`)
 * as evidence of real analysis, but that diverged from the handler
 * precondition: a turn arriving with `analysis` populated upstream but no
 * persisted fact (UI bypass paths flagged in P1) would produce a
 * precondition-fail template AND chip suppression, leaving the user
 * stranded with "no analysis" text and no recovery action. Using
 * priorFacts exclusively keeps the two signals aligned.
 *
 * The `analysis` argument is retained for the projection_empty vs
 * projection_populated distinction within the "facts present" branch —
 * once we know analysis exists, the projection's leading_option tells us
 * whether PLoT actually produced usable data.
 *
 * Inputs are deliberately permissive (handles undefined/null).
 */
export function deriveProjectionStatus(
  handlerFacts: readonly HandlerFact[] | undefined,
  analysis: ContextPackAnalysis | null | undefined,
  priorFacts?: readonly HandlerFact[] | undefined,
): 'facts_absent' | 'projection_empty' | 'projection_populated' {
  // Single source of truth (P0 V5 golden-path repair): a run_analysis
  // fact only counts as evidence of real analysis when it also passes
  // the freshness eligibility — i.e. canonical-success or legacy-fact.
  // Partial / failed / blocked facts must not be treated as "facts
  // present" because they carry no usable projection data; the
  // explanation handlers route them through the degraded template
  // instead, and the chip-generator should match.
  const hasCurrentRunAnalysisFact = (handlerFacts ?? []).some(isSuccessfulRunAnalysisFact);
  const hasPriorRunAnalysisFact = (priorFacts ?? []).some(isSuccessfulRunAnalysisFact);
  const hasAnalysisRecord = hasCurrentRunAnalysisFact || hasPriorRunAnalysisFact;

  if (!hasAnalysisRecord) return 'facts_absent';
  if (!analysis || analysis.leading_option == null) return 'projection_empty';
  return 'projection_populated';
}

function cap(chips: readonly SuggestedAction[]): readonly SuggestedAction[] {
  return chips.slice(0, MAX_CHIPS);
}

function chipId(scope: 'action' | 'prompt', discriminator: string): string {
  return `chip_${scope}_${discriminator}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function executableChip(handlerId: V5ActionType, label: string): SuggestedAction {
  return {
    id: chipId('action', handlerId),
    label,
    message: `${label}.`,
    action_type: handlerId,
  };
}

function promptChip(discriminator: string, label: string, message: string): SuggestedAction {
  return {
    id: chipId('prompt', discriminator),
    label,
    message,
  };
}
