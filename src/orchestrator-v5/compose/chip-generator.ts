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
 * Rules are deterministic. Do not call an LLM from here.
 */

import type { HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';
import type { StageType } from '@talchain/schemas/boundary';

import type { SuggestedAction } from './types.js';
import type { HandlerValidationRegistry } from '../routing/validator.js';
import { curatedHandlerChips } from './helpers.js';
import type { ContextPackAnalysis } from '../context/context-pack-assembler.js';

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
   * V5 review: count of option nodes in the current ContextPack graph. Used
   * to gate the executable `Run analysis` chip — the `run_analysis` handler
   * has a precondition requiring at least one option node
   * (`src/orchestrator-v5/routing/validation-registry.ts:37`), and offering
   * the chip when none exist would produce a PRECONDITION_UNMET handler
   * failure on click. When zero, we fall back to a conversational setup
   * chip instead.
   */
  readonly graphOptionCount?: number;
}

const MAX_CHIPS = 3;

/**
 * Build chips for the compose layer. Returns at most MAX_CHIPS. Returns
 * empty array when no rule applies for the current stage/signals.
 */
export function generateChips(input: ChipGeneratorInput): readonly SuggestedAction[] {
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
  // Executable variant is only safe when the precondition will hold — at
  // least one option node must exist in the graph. Otherwise run_analysis
  // returns PRECONDITION_UNMET on click and the user sees a handler-failure
  // coaching response instead of the analysis they expected. When options
  // are absent we emit a conversational setup prompt instead, steering the
  // user toward the canvas UI to define options.
  if (input.stage === 'analyse' && !hasAnalysis && handlerJustRan == null) {
    const hasOptions = (input.graphOptionCount ?? 0) > 0;
    const curated = curatedHandlerChips(input.validationRegistry);
    const runAnalysis = curated.find((c) => c.handler_id === 'run_analysis');
    if (runAnalysis && hasOptions) {
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
    return cap([
      promptChip(
        'ask_run_analysis',
        'Run the analysis',
        'I want to run the analysis on this decision.',
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
