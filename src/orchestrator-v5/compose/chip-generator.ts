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
  const hasAnalysis = input.analysis != null;
  const robustnessIsFragile =
    input.analysis != null && input.analysis.robustness_band === 'fragile';

  // Rule: after run_analysis succeeds, prompt for the follow-ups that don't
  // require a new handler. Explain + sensitivity are the two most common
  // asks; both are conversational (no handler required).
  if (handlerJustRan === 'run_analysis') {
    return cap([
      promptChip(
        'explain_result',
        'Explain the result',
        'Please explain the analysis result in plain language.',
      ),
      promptChip(
        'what_could_flip',
        'What could change the outcome?',
        'What could change the outcome of this analysis?',
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


function findHandlerJustRan(
  facts: readonly HandlerFact[] | undefined,
): V5ActionType | null {
  if (!facts || facts.length === 0) return null;
  for (const f of facts) {
    if (f.fact_type === 'run_analysis' && !f.noop) return 'run_analysis';
  }
  return null;
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
