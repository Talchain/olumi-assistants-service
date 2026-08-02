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

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import type { SuggestedAction } from './types.js';
import type { HandlerValidationRegistry } from '../routing/validator.js';
import { curatedHandlerChips } from './helpers.js';
import type { ContextPackAnalysis } from '../context/context-pack-assembler.js';
// D-ask-1 (2.11 P0-1): configure chip for scaffolded-placeholder runs —
// derives from #487's single configure-chip copy source.
import { buildScaffoldConfigureChip } from '../coaching/scaffold-disclosure.js';
import type { GraphPatchBlockData } from '../../orchestrator/types.js';
import { isSuccessfulRunAnalysisFact } from '../context/freshness.js';
import { buildAnalysisFromPriorFacts } from '../context/analysis-fallback.js';
// ROADMAP 2.308 / S2(b) — the "Set values for options" chip copy is DERIVED,
// never re-typed. All four sites below (the readiness floor, which fires on
// `needs_encoding` — the 2.308 blocked state — plus the three stage
// fallbacks) previously carried a hand-typed literal that was blocked twice:
// NO_MATCH at `detectConfigureOptionIntent` AND a hit on
// EDIT_GRAPH_NEGATIVE_REGEX's "set up". `configure-option-product-copy-routes.test.ts`
// pins `generateChips` OUTPUT, not just the constant.
import {
  SET_OPTION_VALUES_CHIP_LABEL,
  SET_OPTION_VALUES_CHIP_MESSAGE,
} from '../configure-option-chip-text.js';

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
  /**
   * V5 canonical analysis state (M2 convergence). When present, the chip
   * floor and the post-mutation / stale-recovery rules derive
   * `hasAnyRunAnalysisFact`, `freshness` and the rerun affordance from this
   * single composed verdict (built over the UNIFIED current-turn + prior
   * fact chain) instead of the local `handlerFacts` / `priorFacts` /
   * `turnOutcome` reads. This closes the documented split where a turn that
   * just ran `run_analysis` reported `hasAnyRunAnalysisFact === true` while
   * `deriveAnalysisFreshness(priorFacts)` returned `'none'`.
   *
   * Optional + additive: when omitted, every rule falls back to the prior
   * local expressions with ZERO behaviour change. Live activation (turn-
   * executor threading the canonical state in) lands in M5 (post-#287);
   * M2 ships the mechanism + the unit-level convergence proof.
   */
  readonly canonicalState?: import('../context/canonical-analysis-state.js').CanonicalAnalysisState;
  /**
   * ROADMAP 1.20(b) — chip-sameness guard. Chip ids offered on the
   * IMMEDIATELY PRIOR turn (call site derives this from
   * `context.most_recent_pending_actions`, the same single-prior-turn
   * authority every other pending-action consumer in turn-executor
   * reads — see that field's doc comment). When every candidate chip
   * this turn computes is already in this set, `generateChips` ships an
   * empty array instead of repeating the identical offer — closing the
   * live defect where 5/5 consecutive turns offered IDENTICAL chips
   * regardless of what the turns were actually about. Optional +
   * additive: omitted → zero behaviour change (every existing call site
   * and test is byte-identical).
   */
  readonly recentlyOfferedChipIds?: ReadonlySet<string>;
  /**
   * D-ask-1 (ROADMAP 2.11 P0-1) — options the CURRENT turn's run_analysis
   * scaffolded with disclosed placeholder interventions (threaded from
   * `HandlerOutcome.__scaffolded_options` by the turn-executor execute path
   * and the chip-click dispatch). When non-empty on a run_analysis success
   * turn, the configure chip for the scaffolded option is offered FIRST —
   * claim-safety (get real values in) beats exploration follow-ups.
   * Optional + additive: omitted/empty → byte-identical chips.
   */
  readonly scaffoldedOptions?: ReadonlyArray<
    import('../coaching/scaffold-disclosure.js').ScaffoldedOptionRecord
  >;
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
 * Build chips for the compose layer. Returns at most MAX_CHIPS. All
 * emitted chips are passed through `validateAndFilterChips` so a chip
 * with an unmapped or literally-null `action_type` cannot reach the wire.
 *
 * V5 link-safe response floor: when the existing rules + filter would
 * return an empty array, {@link applyChipFloor} attempts to attach one
 * deterministic conversational or executable chip drawn from current
 * state (analysisReady, prior run_analysis facts, freshness). If no
 * floor candidate qualifies, the empty array is preserved and
 * `v5.chips.empty_intentional` is emitted with `reason: 'no_safe_floor'`
 * so monitoring can see that the empty state was deliberate, not a
 * regression.
 */
export function generateChips(input: ChipGeneratorInput): readonly SuggestedAction[] {
  const filtered = validateAndFilterChips(generateChipsRaw(input), input.validationRegistry);
  const primary = filtered.length > 0 ? filtered : applyChipFloor(input);
  return excludeRecentlyOfferedChips(primary, input.recentlyOfferedChipIds);
}

/**
 * ROADMAP 1.20(b) — chip-sameness guard. See `ChipGeneratorInput.recentlyOfferedChipIds`.
 * Only suppresses a chip whose id was offered on the immediately prior
 * turn; when that removes EVERY candidate, ships `[]` rather than a
 * partially-filtered set that could look arbitrary — an honest empty
 * turn, same philosophy as `applyChipFloor`'s `no_safe_floor` branch.
 * When nothing is filtered, returns the input array unchanged (no new
 * allocation) so byte-identical output is preserved for every call site
 * that doesn't thread `recentlyOfferedChipIds`.
 */
function excludeRecentlyOfferedChips(
  chips: readonly SuggestedAction[],
  recentlyOfferedChipIds: ReadonlySet<string> | undefined,
): readonly SuggestedAction[] {
  if (!recentlyOfferedChipIds || recentlyOfferedChipIds.size === 0 || chips.length === 0) {
    return chips;
  }
  const next = chips.filter((c) => !recentlyOfferedChipIds.has(c.id));
  if (next.length === chips.length) return chips;
  emit(TelemetryEvents.V5ChipsRecentlyOfferedSuppressed, {
    suppressed_ids: chips.filter((c) => recentlyOfferedChipIds.has(c.id)).map((c) => c.id),
    survived_count: next.length,
  });
  return next;
}

/**
 * Link-safe response floor. Called when the standard rules + filter
 * produced an empty array. Picks a single safe chip from a priority
 * ladder driven entirely by existing input signals. No new wire
 * `action_type` is invented; no edit-path is implied. When no rung
 * matches, returns `[]` and emits `v5.chips.empty_intentional` —
 * an empty product turn is honest, a filler chip would be noise.
 *
 * Priority ladder (first match wins):
 *
 *   1. Post-edit stale analysis (`turnOutcome.analysis_freshness === 'stale'`
 *      AND any prior/current run_analysis fact) → conversational
 *      "Re-run analysis" prompt. Conversational rather than executable
 *      so upstream gates can refuse the run when readiness regressed.
 *   2. Ready + no analysis fact (yet) → existing executable
 *      `run_analysis` chip, only when the handler is in the validation
 *      registry. Safe because `analysisReady.status === 'ready'`
 *      already enforces goal + ≥2 options + numeric interventions.
 *   3. Any run_analysis fact present (current or prior) → conversational
 *      "What could change the outcome?" prompt. Routes through the
 *      existing post-analysis advice gate as plain text.
 *   4. `analysisReady.status` in {`needs_user_input`, `needs_user_mapping`,
 *      `needs_encoding`} → conversational "Set values for options"
 *      prompt. Does NOT emit the executable `run_analysis` chip here —
 *      the upstream readiness gate would reject it.
 *   5. None of the above → empty preserved; `V5ChipsEmptyIntentional`
 *      emitted with `reason: 'no_safe_floor'`.
 */
function applyChipFloor(input: ChipGeneratorInput): readonly SuggestedAction[] {
  const readyStatus = input.analysisReady?.status;
  const readyStatusLabel: string = readyStatus ?? 'unknown';
  // M2 convergence: when the canonical analysis state is threaded, the
  // floor reads `hasAnyRunAnalysisFact` / `freshness` / the rerun + explore
  // affordances from the single composed verdict (unified current+prior
  // facts) so it cannot disagree with `deriveAnalysisFreshness`. Absent →
  // the prior local expressions, byte-for-byte unchanged.
  const cs = input.canonicalState;
  const hasAnyRunAnalysisFact = cs
    ? cs.selected_fact_index !== null
    : (input.handlerFacts ?? []).some(isSuccessfulRunAnalysisFact) ||
      (input.priorFacts ?? []).some(isSuccessfulRunAnalysisFact);
  const freshness = cs ? cs.freshness : input.turnOutcome?.analysis_freshness;
  // Rerun affordance. Canonical: `requiresRerun` (stale OR trust-downgrade).
  // Fallback: the prior exact condition (a fact present AND stale).
  const requiresRerun = cs
    ? cs.requiresRerun
    : hasAnyRunAnalysisFact && freshness === 'stale';
  // Exploration affordance. Canonical: only when the analysis is usable for
  // follow-up context (fresh/stale, not blocked/contradictory). Fallback:
  // any run_analysis fact present (prior behaviour).
  const canExploreAnalysis = cs ? cs.usableForFollowupContext : hasAnyRunAnalysisFact;
  const stage = input.stage;

  // Priority 1: rerun-required → conversational re-run prompt. The reason
  // label distinguishes a true staleness rerun from a trust-downgrade rerun
  // (actionable-blocker / degraded-newer contradiction on otherwise-fresh
  // analysis) so the floor-applied telemetry stream is not misleading once
  // canonicalState is threaded (M5).
  if (requiresRerun) {
    const rerunReason =
      cs && cs.freshness !== 'stale' ? 'trust_downgrade_rerun' : 'stale_post_edit';
    emit(TelemetryEvents.V5ChipsFloorApplied, {
      reason: rerunReason,
      stage,
      analysis_ready_status: readyStatusLabel,
      has_run_analysis_fact: true,
    });
    return [
      promptChip(
        'floor_rerun_analysis',
        'Re-run analysis',
        'Please re-run the analysis.',
      ),
    ];
  }

  // Priority 2: ready + no analysis fact → executable run_analysis chip.
  if (readyStatus === 'ready' && !hasAnyRunAnalysisFact) {
    const curated = curatedHandlerChips(input.validationRegistry);
    const runAnalysis = curated.find((c) => c.handler_id === 'run_analysis');
    if (runAnalysis) {
      emit(TelemetryEvents.V5ChipsFloorApplied, {
        reason: 'analysis_ready',
        stage,
        analysis_ready_status: readyStatusLabel,
        has_run_analysis_fact: false,
      });
      return [
        executableChip(
          runAnalysis.handler_id as V5ActionType,
          runAnalysis.label,
        ),
      ];
    }
  }

  // Priority 3: usable analysis present → "What could change the outcome?".
  //
  // M2 convergence: gate on `canExploreAnalysis` (canonical
  // `usableForFollowupContext` when threaded; else `hasAnyRunAnalysisFact`,
  // byte-identical to before) so a blocked / contradictory analysis state
  // does not offer exploration.
  //
  // V5 P0-B — this chip must dispatch DETERMINISTICALLY. It was previously a
  // bare promptChip with no `action_type`, so a click routed through the LLM /
  // post-analysis advice gate as plain text instead of the deterministic
  // what_would_flip handler (the routing hole P0-B closes). We now emit the
  // EXECUTABLE what_would_flip chip — byte-identical to the post-run_analysis
  // rule's chip — so the click resolves via `dispatchDeterministicChipClick`.
  //
  // Precondition parity (red-team guard): the what_would_flip handler only
  // returns 'execute' when, ALSO, an analysis projection is buildable from the
  // facts AND freshness !== 'stale' (see `decideExplanationPrecondition`).
  // `buildAnalysisProjectionSummary` returns null only for a null input, and
  // on the chip-click path that input is non-null iff
  // `buildAnalysisFromPriorFacts` is non-null — so projection-buildability is
  // the faithful 'execute' predicate. Freshness is already non-stale here
  // (Priority 1 diverted the rerun-required case to the re-run prompt), but we
  // assert it defensively. When the precondition would NOT be met, we keep the
  // conversational promptChip (status quo) so a click never lands the user on
  // a "no analysis run yet" handler template.
  if (canExploreAnalysis) {
    const combinedFacts: readonly HandlerFact[] = [
      ...(input.handlerFacts ?? []),
      ...(input.priorFacts ?? []),
    ];
    const projectionBuildable = buildAnalysisFromPriorFacts(combinedFacts, undefined) !== null;
    const preconditionWouldExecute = projectionBuildable && freshness !== 'stale';
    emit(TelemetryEvents.V5ChipsFloorApplied, {
      reason: 'post_analysis_no_obvious_next',
      stage,
      analysis_ready_status: readyStatusLabel,
      has_run_analysis_fact: true,
    });
    if (preconditionWouldExecute) {
      // Executable — identical shape to the post-run_analysis rule's chip so a
      // click bypasses the LLM and dispatches the what_would_flip handler.
      return [
        {
          id: 'chip_action_what_would_flip',
          label: 'What could change the outcome?',
          message: 'What could change the outcome of this analysis?',
          action_type: 'what_would_flip',
        },
      ];
    }
    // Precondition would not execute → keep the conversational prompt.
    return [
      promptChip(
        'floor_post_analysis_explore',
        'What could change the outcome?',
        'What could change the outcome of this analysis?',
      ),
    ];
  }

  // Priority 4: readiness needs user input → setup prompt.
  if (
    readyStatus === 'needs_user_input' ||
    readyStatus === 'needs_user_mapping' ||
    readyStatus === 'needs_encoding'
  ) {
    emit(TelemetryEvents.V5ChipsFloorApplied, {
      reason: 'needs_input',
      stage,
      analysis_ready_status: readyStatusLabel,
      has_run_analysis_fact: false,
    });
    return [
      promptChip(
        'floor_set_option_values',
        SET_OPTION_VALUES_CHIP_LABEL,
        SET_OPTION_VALUES_CHIP_MESSAGE,
      ),
    ];
  }

  // No safe floor applies. Empty is honest — emit telemetry so monitoring
  // can distinguish an intentional empty turn from a regression.
  emit(TelemetryEvents.V5ChipsEmptyIntentional, {
    reason: 'no_safe_floor',
    stage,
    analysis_ready_status: readyStatusLabel,
    has_run_analysis_fact: hasAnyRunAnalysisFact,
  });
  return [];
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

  // M2 convergence: a single canonical-aware freshness signal reused by the
  // post-mutation and stale-recovery rules below. When the canonical state
  // is threaded it is authoritative (unified current+prior facts);
  // otherwise the prior `turnOutcome` read, unchanged.
  const canonicalState = input.canonicalState;
  const effectiveFreshness = canonicalState
    ? canonicalState.freshness
    : input.turnOutcome?.analysis_freshness;

  // Rule: after run_analysis succeeds, prompt for the follow-ups that don't
  // require a new handler. Both executable chips emit `action_type` so the
  // chip-click path resolves deterministically via `dispatchDeterministicChipClick`
  // (saves ~12s ORIENT Sonnet call per click — see Phase 2b round-2 reviewer
  // finding: the prior `promptChip` for "Explain the result" had no
  // `action_type`, so the chip click silently routed through Sonnet and
  // never hit the deterministic bypass). Both also seed a pending action
  // so a typed "yes" on the next turn can resume via the short-confirm
  // pre-route.
  //
  // V5 coaching — a third prompt chip ("What should we validate?") is
  // appended ONLY when the CURRENT-turn run_analysis fact carries
  // non-empty decision_review.evidence_enhancements with at least one
  // entry having a non-empty `specific_action` string. Honesty gate:
  // never offer the chip when the advice answer would be empty.
  //
  // **Current-turn handler facts are authoritative.** The chip only
  // fires on the run_analysis success turn (`handlerJustRan ===
  // 'run_analysis'`), so the freshly-attached enrichment on THIS turn
  // is the right source. Falling back to priorFacts would surface a
  // chip pointing at stale pre-edit evidence whenever the current
  // run_analysis's enricher soft-failed — exactly the dishonesty
  // Codex flagged on the original PR #190. If current-turn has no
  // usable enhancements, the chip is suppressed.
  //
  // The chip has no `action_type` — on click, the message text routes
  // through the post-analysis advice gate's evidence_gap class and is
  // answered deterministically (0 LLM calls). `cap` caps at MAX_CHIPS
  // so the new chip is suppressed if the slot budget is already full.
  if (handlerJustRan === 'run_analysis') {
    const chips: SuggestedAction[] = [];
    // D-ask-1 (2.11 P0-1): a scaffolded run completed on PLACEHOLDER values
    // for at least one option — the configure route is the honest first
    // offer. Chip copy derives from #487's single configure-chip source
    // (buildScaffoldConfigureChip), so message and deterministic route
    // cannot drift apart. Prompt chip (no action_type): the message text
    // routes through the configure-option gate.
    if (input.scaffoldedOptions !== undefined && input.scaffoldedOptions.length > 0) {
      const configureChip = buildScaffoldConfigureChip(input.scaffoldedOptions);
      chips.push({
        id: configureChip.id,
        label: configureChip.label,
        message: configureChip.message,
      });
    }
    chips.push(
      {
        id: 'chip_action_explain_results',
        label: 'Explain the result',
        message: 'Please explain the analysis result in plain language.',
        action_type: 'explain_results',
      },
      {
        id: 'chip_action_what_would_flip',
        label: 'What could change the outcome?',
        message: 'What could change the outcome of this analysis?',
        action_type: 'what_would_flip',
      },
    );
    if (currentTurnCarriesUsableValidationGuidance(input.handlerFacts)) {
      chips.push({
        id: 'chip_prompt_validate_decision',
        label: 'What should we validate?',
        message: 'What should we validate or research to build confidence in this decision?',
      });
    }
    return cap(chips);
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
    // M2 convergence: prefer the canonical verdict when threaded. On a
    // mutation turn the current handlerFacts hold the mutation (not a
    // run_analysis), so `selected_fact_index !== null` reflects a prior
    // run_analysis exactly like the local priorFacts scan.
    const hasPriorRunAnalysis = canonicalState
      ? canonicalState.selected_fact_index !== null
      : (input.priorFacts ?? []).some(isSuccessfulRunAnalysisFact);
    const freshness = effectiveFreshness;
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
    effectiveFreshness === 'stale' &&
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

  // Rule: after a successful (precondition-met) what_would_flip turn,
  // surface three exploration chips so the deterministic-fallback
  // closing question "Which of those would you like to explore
  // changing?" has clickable follow-ups. Pre-this rule the success
  // path emitted zero chips and the user was asked a question with no
  // answer affordance.
  //
  // Chips:
  //   1. "Walk me through the analysis" → action_type 'explain_results'
  //      (hits the deterministic chip-click fast path — zero LLM
  //      round-trip).
  //   2. "Re-run analysis" → action_type 'run_analysis' (same fast
  //      path).
  //   3. "Run a pre-mortem" → prompt chip (no action_type because
  //      there is no registered handler for pre-mortem; the click
  //      routes through TurnExecutor as a normal turn). Mirrors the
  //      decide-stage rule pattern below.
  //
  // Placed AFTER the explain_results SUCCESS rule so the precedence
  // (explain → what_would_flip → run_analysis) is preserved on
  // unusual multi-fact turns; in practice the two handlers do not
  // co-emit on a single turn.
  if (findSuccessfulWhatWouldFlipJustRan(input.handlerFacts)) {
    return cap([
      {
        id: 'chip_action_explain_results',
        label: 'Walk me through the analysis',
        message: 'Walk me through the analysis.',
        action_type: 'explain_results',
      },
      {
        id: 'chip_action_rerun_analysis',
        label: 'Re-run analysis',
        message: 'Re-run the analysis.',
        action_type: 'run_analysis',
      },
      promptChip(
        'run_pre_mortem',
        'Run a pre-mortem',
        'Imagine this decision went wrong. What would have caused it?',
      ),
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
        SET_OPTION_VALUES_CHIP_LABEL,
        SET_OPTION_VALUES_CHIP_MESSAGE,
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
          SET_OPTION_VALUES_CHIP_LABEL,
          SET_OPTION_VALUES_CHIP_MESSAGE,
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
          SET_OPTION_VALUES_CHIP_LABEL,
          SET_OPTION_VALUES_CHIP_MESSAGE,
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
  // "What would make this flip" emits an executable `action_type: 'what_would_flip'`
  // chip so the click hits the deterministic dispatcher (Phase 2b round-2
  // reviewer finding — prior `promptChip` had no `action_type` and the
  // bypass never fired). "Run a pre-mortem" stays a prompt chip because
  // there is no registered handler for it; it still routes through Sonnet.
  if (input.stage === 'decide' && robustnessIsFragile) {
    return cap([
      {
        id: 'chip_action_what_would_flip_decide',
        label: 'What would make this flip?',
        message: 'What would make the leading option flip to another option?',
        action_type: 'what_would_flip',
      },
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
 * one of the supplied facts is a successful (non-noop) mutation.
 *
 * **Single caller by design (DO NOT REGRESS):** the post-mutation chip
 * rule above invokes this against `input.handlerFacts` only — i.e. the
 * mutation that ran on the CURRENT turn. Reusing this helper against
 * `priorFacts` here would re-introduce the stale-chip regression
 * (a "Run analysis" chip on every subsequent converse turn until
 * analysis is rerun). The state-query continuity surface owns the
 * priorFacts-aware chip via `composeStateQueryChip` in
 * `routing/state-query-guard.ts`; do NOT route that responsibility
 * back through this helper.
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

/**
 * Did `what_would_flip` produce a successful (precondition-met) fact
 * this turn? Mirrors `findSuccessfulExplainResultsJustRan` — production
 * `what_would_flip` facts always carry `noop: true`; the success
 * discriminator is `result.precondition_unmet === false`.
 *
 * Used by the new what_would_flip SUCCESS chip rule to surface the
 * three follow-up exploration chips when the handler returns a valid
 * answer (Sonnet's prose or the deterministic fallback). Without this
 * rule, the closing question "Which of those would you like to explore
 * changing?" had no clickable follow-up.
 */
function findSuccessfulWhatWouldFlipJustRan(
  facts: readonly HandlerFact[] | undefined,
): boolean {
  if (!facts || facts.length === 0) return false;
  for (const f of facts) {
    if (f.fact_type !== 'what_would_flip') continue;
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

/**
 * V5 coaching — honesty gate for the post-run_analysis
 * "What should we validate?" prompt chip.
 *
 * Returns `true` when `handlerFacts` (the CURRENT turn's facts) carries
 * a successful `run_analysis` fact whose
 * `result.enrichment.decision_review.evidence_enhancements` map has at
 * least one entry with a non-empty `specific_action` string.
 *
 * **Current-turn authoritative.** No priorFacts fallback: the chip only
 * fires on the run_analysis success turn, so the freshly-attached
 * enrichment on THIS turn is the only honest source. If the current
 * run_analysis's enricher soft-failed (no usable specific_action),
 * suppress the chip — surfacing it via a stale prior fact would point
 * the user at pre-edit evidence, which is exactly what Codex flagged
 * on the original PR #190 walk.
 *
 * The chip-click answer is composed by `composeEvidenceGap` in
 * post-analysis-advice-gate.ts. That composer is wired (via
 * `pickLatestDecisionReview`) to the freshness-aligned selector, so
 * once the chip is offered, the deterministic answer it points at uses
 * the SAME fact this check inspected.
 *
 * Defensive shape parsing throughout: the `decision_review` payload is
 * a passthrough `Record<string, unknown>`.
 */
function currentTurnCarriesUsableValidationGuidance(
  handlerFacts: readonly HandlerFact[] | undefined,
): boolean {
  if (!handlerFacts || handlerFacts.length === 0) return false;
  for (const fact of handlerFacts) {
    if (!isSuccessfulRunAnalysisFact(fact)) continue;
    // `isSuccessfulRunAnalysisFact` already filters `fact_type ===
    // 'run_analysis'` and noop=false at runtime; the extra narrow here
    // is for TypeScript only — the helper is not a type predicate so
    // the discriminated-union member isn't narrowed otherwise.
    if (fact.fact_type !== 'run_analysis') continue;
    const enrichment = fact.result.enrichment;
    if (enrichment == null || typeof enrichment !== 'object') continue;
    const dr = (enrichment as Record<string, unknown>)['decision_review'];
    if (dr == null || typeof dr !== 'object' || Array.isArray(dr)) continue;
    const enhancements = (dr as Record<string, unknown>)['evidence_enhancements'];
    if (
      enhancements == null ||
      typeof enhancements !== 'object' ||
      Array.isArray(enhancements)
    ) continue;
    for (const key of Object.keys(enhancements)) {
      const entry = (enhancements as Record<string, unknown>)[key];
      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const action = (entry as Record<string, unknown>)['specific_action'];
      if (typeof action === 'string' && action.trim().length > 0) {
        return true;
      }
    }
  }
  return false;
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
