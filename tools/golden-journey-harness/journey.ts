/**
 * Golden-Journey Harness v1 — the comprehensive PoC journey.
 *
 * One journey threads the full core arc the brief names:
 *   draft model → run analysis → explain → follow-up → mutate/value-edit →
 *   rerun → explain what changed → reload → (verify chips/actions) →
 *   (capture debug/context trace).
 *
 * Steps 1–8 are HTTP turns against `POST /orchestrate/v2/turn`. Steps 9 and
 * 10 ("verify chips/actions" and "capture debug/context trace") are NOT
 * separate turns — they are evaluations OVER the eight captured turns, so
 * they live in the classifier (`invariants.ts`) and the report, surfaced
 * here only as coverage metadata.
 *
 * Reuse: payload shaping, the factor-label fallback, and the
 * precondition-error flow all come from `../v5-journey-replay/steps.js`.
 * The mutate step uses `edit_graph_generic` (the proven deterministic
 * mutation path); `set_factor_value` is label-fragile (dispatch guardrail
 * #3 — the runner records the fallback as a Component-4 caveat if it ever
 * has to use the narrow path).
 */

import {
  mkTurnId,
  selectFactorLabel,
  JourneyPreconditionError,
} from '../v5-journey-replay/steps.js';
import type { TurnPayload } from '../v5-journey-replay/client.js';

import type { InvariantId } from './components.js';
import {
  getCurrentGraphHash,
  getGraphHashAtRun,
  type TurnObservation,
  type TurnRole,
  type WireBody,
} from './observation.js';

/** The decision brief that seeds the journey. Mirrors the v5-journey-replay brief. */
export const GOLDEN_BRIEF =
  'We are a 15-person engineering team weighing three options for scaling ' +
  'delivery over the next six months: hire two senior engineers locally, ' +
  'engage an offshore partner, or introduce tiered pricing to hire more ' +
  'gradually. Decision matters for Q3 roadmap commitments.';

export interface GoldenJourneyContext {
  readonly scenario_id: string;
  optionLabels: string[];
  factorLabels: string[];
  resolvedFactorLabel: string | null;
  factorLabelReason: 'budget_match' | 'first_label' | 'no_factor_labels';
}

export interface GoldenStep {
  readonly name: string;
  readonly role: TurnRole;
  readonly description: string;
  /** Invariants this step is designed to exercise (for the coverage matrix). */
  readonly invariants: readonly InvariantId[];
  readonly depends_on?: string;
  readonly buildPayload: (ctx: GoldenJourneyContext) => TurnPayload;
}

/** Re-implements the (non-exported) `requireFactorLabel` guard from steps.ts. */
function requireFactorLabel(ctx: GoldenJourneyContext): string {
  const label = ctx.resolvedFactorLabel;
  if (label === null || label === undefined) {
    throw new JourneyPreconditionError(
      'no_factor_label_available',
      'Draft did not produce a usable factor label for the mutate / explain-changed steps.',
    );
  }
  return label;
}

export const GOLDEN_STEPS: readonly GoldenStep[] = [
  {
    name: '1_draft',
    role: 'draft',
    description: 'POST fresh scenario + decision brief → draft model with post-draft chips.',
    invariants: ['A2', 'A6'],
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: GOLDEN_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '2_run_analysis',
    role: 'analysis',
    description: 'chip_click run_analysis on the drafted graph → analysis_ready + win-probabilities.',
    invariants: ['A1', 'A3', 'A6'],
    depends_on: '1_draft',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }),
  },
  {
    name: '3_explain_leader',
    role: 'explain',
    description: '"Why does the leading option win?" → grounded explanation, no denial of available analysis.',
    invariants: ['A1', 'A5', 'A6'],
    depends_on: '2_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'Why does the leading option win?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '4_follow_up',
    role: 'follow_up',
    description: 'Follow-up that depends on recent-turn context ("…and how does the runner-up compare?").',
    invariants: ['A1', 'A2', 'A5'],
    depends_on: '2_run_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'And how does the runner-up option compare to it?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '5_mutate',
    role: 'mutate',
    description:
      'Concrete scalar value-edit ("Set <captured factor> to 0.5") — a real durable mutation. ' +
      "Drives the deterministic value-update gate so the back half of the journey is meaningful " +
      '(replaces the old vague "make X more important", which correctly clarified-first and no-op\'d).',
    invariants: ['A1', 'A3', 'A4', 'A7'],
    depends_on: '1_draft',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'frame',
      message: `Set ${requireFactorLabel(ctx)} to 0.5`,
      turn_class: 'frame',
      source: 'composer',
    }),
  },
  {
    name: '6_rerun_analysis',
    role: 'rerun_analysis',
    description: 'chip_click run_analysis on the mutated graph → fresh analysis; hash must differ from step 2.',
    invariants: ['A3', 'A7'],
    depends_on: '5_mutate',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }),
  },
  {
    name: '7_explain_what_changed',
    role: 'explain_changed',
    description: '"What changed?" → references the edited factor + honest change description.',
    invariants: ['A1', 'A5', 'A7'],
    depends_on: '5_mutate',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'What changed in the model, and does it change which option leads?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '8_reload',
    role: 'reload',
    description:
      'Fresh read turn (no graph_state in body) → server reloads canonical graph + re-derives analysis_ready. ' +
      'Proves analysis state survives reload and is not contradicted.',
    invariants: ['A1', 'A2'],
    depends_on: '6_rerun_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'Show me the current analysis for this decision.',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '9_mutate_intent',
    role: 'mutate_intent',
    description:
      'A NON-COMMITTING change request — vague/ambiguous edit intent ("make the budget side matter more") that ' +
      'the product should clarify or propose, NOT silently apply. Proves the assistant never claims a mutation ' +
      'it did not durably make (lived defect 1: phantom success on a no-op edit). A8 + A4.',
    invariants: ['A4', 'A8'],
    depends_on: '6_rerun_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message: 'The budget side feels off — can you make it matter more?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
  {
    name: '10_premortem',
    role: 'premortem',
    description:
      'Premortem / challenge prompt → safe handling only: structural framing, a clear next step, no overclaiming ' +
      'or invented science/coaching doctrine (lived defect 4, secondary). A11 (advisory).',
    invariants: ['A11'],
    depends_on: '6_rerun_analysis',
    buildPayload: (ctx) => ({
      kind: 'message',
      turn_id: mkTurnId(),
      scenario_id: ctx.scenario_id,
      stage: 'decide',
      message:
        'Give me a premortem: what would have to go wrong for the leading option to turn out to be the wrong call?',
      turn_class: 'decide',
      source: 'composer',
    }),
  },
];

/**
 * Steps 11 + 12 are evaluations over the captured turns, not HTTP turns.
 * Surfaced here so the coverage matrix lists the full journey (10 HTTP turns
 * + 2 synthetic evaluations).
 */
export const GOLDEN_SYNTHETIC_STEPS: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly invariants: readonly InvariantId[];
}> = [
  {
    name: '11_verify_chips',
    description: 'Verify chips/actions across the mutate + rerun turns (no false-success chips; rerun affordance after stale).',
    invariants: ['A4', 'A7'],
  },
  {
    name: '12_capture_debug',
    description: 'Capture the debug/context trace (_diagnostic_trace + _timings + latency) from every turn into the report.',
    invariants: ['A6', 'A10'],
  },
];

/** Map a step name back to its role (used when re-hydrating a replay transcript). */
export function roleForStep(name: string): TurnRole {
  const step = GOLDEN_STEPS.find((s) => s.name === name);
  return step?.role ?? 'follow_up';
}

/**
 * Parse option / factor labels out of a draft response, defensively.
 * Mirrors `captureStep1` in v5-journey-replay (reads `body.draft_graph.nodes`).
 */
export function captureLabelsFromDraft(body: WireBody | undefined): {
  optionLabels: string[];
  factorLabels: string[];
} {
  const draftGraph = body?.draft_graph;
  const nodes =
    draftGraph && typeof draftGraph === 'object' && 'nodes' in draftGraph
      ? (draftGraph as { nodes?: unknown }).nodes
      : null;
  const optionLabels: string[] = [];
  const factorLabels: string[] = [];
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (typeof n !== 'object' || n === null) continue;
      const kind = (n as { kind?: unknown }).kind;
      const label = (n as { label?: unknown }).label;
      if (typeof label !== 'string') continue;
      if (kind === 'option') optionLabels.push(label);
      else if (kind === 'factor') factorLabels.push(label);
    }
  }
  return { optionLabels, factorLabels };
}

export function resolveFactorLabel(factorLabels: readonly string[]): {
  label: string | null;
  reason: 'budget_match' | 'first_label' | 'no_factor_labels';
} {
  return selectFactorLabel(factorLabels);
}

/**
 * Thread cross-turn hash memory onto an ordered list of observations.
 *
 * The A3 baseline is the FIRST analysis turn's `graph_hash_at_run` (the
 * graph state the analysis ran on) — falling back to its
 * `current_graph_hash`. Every later observation carries that baseline as
 * `priorRunHash` so A3 (at the rerun turn) can prove the mutation moved
 * canonical state. `priorGraphHash` carries the most recent
 * `current_graph_hash` seen before the turn.
 *
 * Pure: returns new observation objects, never mutates inputs.
 */
export function threadHashMemory(
  observations: readonly TurnObservation[],
): TurnObservation[] {
  let baselineRunHash: string | null = null;
  let lastCurrentHash: string | null = null;
  const out: TurnObservation[] = [];

  for (const obs of observations) {
    const threaded: TurnObservation = {
      ...obs,
      priorRunHash: baselineRunHash,
      priorGraphHash: lastCurrentHash,
    };
    out.push(threaded);

    // Establish the baseline at the first analysis turn.
    if (baselineRunHash === null && (obs.role === 'analysis' || obs.role === 'rerun_analysis')) {
      baselineRunHash = getGraphHashAtRun(obs.body) ?? getCurrentGraphHash(obs.body) ?? null;
    }
    const current = getCurrentGraphHash(obs.body);
    if (current !== undefined) lastCurrentHash = current;
  }
  return out;
}
