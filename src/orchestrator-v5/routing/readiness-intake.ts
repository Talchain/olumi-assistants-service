/**
 * S2-L1 — typed readiness/coaching intake composer.
 *
 * THE GAP THIS CLOSES: `analysis_readiness` is an intent CEE already accepts
 * on the wire (`@talchain/schemas` 0.20.0 `ActionType`), but nothing routes a
 * `source='chip_click'` + `chip.action_type='analysis_readiness'` turn on its
 * TYPE. The enum comment in 0.20.0 promises CEE "routes the turn through the
 * existing pre-heuristic chip branch to its readiness/coaching arm" — that arm
 * did not exist. Today the routing is done by the hand-maintained string mirror
 * (`process-meta-intake.ts` `PRODUCT_COACHING_PROMPTS`, trap-12), i.e. by the
 * canned wording, not by the type.
 *
 * This module is the readiness/coaching arm the type should reach. It consumes
 * the SAME readiness engine the coaching spine uses
 * (the canonical graph readiness adapter + `summariseReadiness`, which
 * `coaching-state.ts`'s `evaluateReadiness` also wraps) — no new science — and
 * the SAME honest fresh-canvas answer (`composeProcessMetaIntakeResponse`), now
 * reached by the type. The string-mirror branch and the typed branch collapse
 * onto one composer on a fresh canvas; on a populated canvas the type reaches
 * deterministic readiness coaching keyed on the persisted graph, not on the
 * chip's canned text.
 *
 * Pure + total: never throws (structural readiness is best-effort; an
 * unparseable persisted graph degrades to the honest fresh-canvas answer, the
 * same defensive stance `evaluateReadiness` takes).
 *
 * DELIBERATELY does NOT delete the string mirror. That is S2-L5, gated on the
 * typed path being deployed + the UI re-vendored + staging-confirmed
 * (consume-then-delete; never before the confirm).
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { GraphV3 } from '../../schemas/cee-v3.js';
import {
  assessCanonicalAnalysisReadiness,
  type CanonicalReadinessAssessment,
  type CanonicalReadinessRepairProposal,
} from '../../orchestrator/tools/analysis-ready-helper.js';
import { summariseReadiness } from './readiness-summary.js';
import { composeProcessMetaIntakeResponse } from './process-meta-intake.js';
import { resolveRunAdmission } from '../tools/handlers/analysis-ready-core.js';
import { PLOT_MIN_COMPARISON_OPTIONS } from '../tools/handlers/analysable-option-gate.js';
import {
  buildAnswerChips,
  buildLabelLookup,
  selectAnswerableBlockers,
} from './readiness-answer-chips.js';

/**
 * The deployed `SuggestedChips` slices to THREE (observed in the staging
 * bundle, 2026-08-20). Emitting more would silently drop affordances this
 * composer's own prose may have promised — so the cap is enforced HERE, where
 * the promise is written, rather than left to the client to truncate.
 */
const MAX_RENDERED_CHIPS = 3;

/**
 * ⭐ THE RUN AFFORDANCE THE LOOP OWNS.
 *
 * Deliberately emitted by this composer rather than relied upon elsewhere: the
 * canvas's own Analyse control is rendered CONDITIONALLY on the results tab
 * (`OutputsDock.tsx`), so selecting the Olumi tab UNMOUNTS it. A loop whose
 * last step told the user to "run it whenever you like" would end by pointing
 * at a control that may not be on screen. `run_analysis` is in the client's
 * dispatch vocabulary already, so this chip routes deterministically.
 *
 * ⚠⚠ HALF OF THIS IS DARK TODAY, AND THE HONEST SCOPE IS NARROW.
 *
 * The client gates `run_analysis` chips on `ceeAnalysisReady.status === 'ready'`
 * (`SuggestedChips.tsx`, `READINESS_GATED_ACTIONS`). So:
 *
 *   - `readiness_ready` branch  → status IS 'ready'          → chip RENDERS.
 *   - `readiness_open` + `willProceed` → status is
 *     'needs_user_input' (exclusion carries the run)         → chip is FILTERED.
 *
 * That second case is the interesting one — the turn where the loop says
 * "there is already enough here to run" — and it is trap 21's shape: the client
 * gates on "is the model fully configured?" while the chip's correctness rests
 * on "will a run actually proceed?". Two authorities, two different questions.
 *
 * CEE ALREADY PUBLISHES THE RIGHT SIGNAL: `may_run: admission.willProceed`
 * (`cee/graph-readiness/canonical-readiness.ts`), whose own docblock says it is
 * declared so "a consumer's gate is written for it from the start rather than
 * retrofitted". ⚠ But `may_run` is ABSENT from the vendored contract 0.48.0
 * (measured with four contrast controls firing at 5/6/8/9 files while `may_run`,
 * `options_ready`, `scaffold_plan` and `waived_by_exclusion` all read zero), so
 * it does not survive to the client. Closing this needs a schema change plus one
 * line in the client gate — a THIRD repo, deliberately out of this lane's scope.
 *
 * The chip is emitted anyway: it is correct, it renders today in the ready
 * branch, a filtered chip is ABSENT rather than broken, and it lights up the
 * moment the contract carries `may_run`. The prose above it states the run
 * state as a FACT and never instructs the user to click anything, so it stays
 * true in both postures.
 */
const RUN_ANALYSIS_CHIP = {
  id: 'chip_readiness_run_analysis',
  label: 'Run the analysis',
  action_type: 'run_analysis',
  message: 'Run the analysis.',
} as const;

/** Where the readiness arm landed — surfaced to telemetry so the typed arm is
 *  observable per turn (fresh-canvas unification vs each populated branch). */
export type ReadinessIntakeOutcome =
  | 'fresh_canvas'
  | 'goal_missing'
  | 'readiness_open'
  | 'readiness_ready';

export interface ReadinessIntakeResult {
  readonly outcome: ReadinessIntakeOutcome;
  readonly response: OlumiResponse;
  readonly assessment: CanonicalReadinessAssessment | null;
}

type StageIndicator = OlumiResponse['stage_indicator'];

/**
 * Stable copy markers for tests/telemetry greps. Each populated-canvas branch
 * carries exactly one so a routing change goes RED against an EXACT phrase
 * rather than hiding inside a substring overlap. The fresh-canvas branch reuses
 * `composeProcessMetaIntakeResponse`'s own marker (`a model on the canvas`).
 */
export const READINESS_GOAL_MISSING_MARKER = 'does not have a goal node yet';
/** Reused verbatim from `summariseReadiness`'s prose lead. */
export const READINESS_OPEN_MARKER = 'still open before this can run cleanly';
export const READINESS_READY_MARKER = 'looks ready to analyse';

function composeGoalMissingResponse(stage: StageIndicator): OlumiResponse {
  const assistantText =
    'Your model is on the canvas, but it does not have a goal node yet, so ' +
    'there is nothing for the analysis to judge the options against. Add the ' +
    'goal you want to weigh the options up against, and I will help you check ' +
    'the rest before you run the first analysis.';
  // ⚠ DELIBERATELY CHIPLESS, and this is a judgement rather than an omission.
  // A missing goal is a STRUCTURAL gap: it is not answerable with an effect
  // value, and offering a "set a value" affordance here would attach the
  // loop's mechanic to a question it cannot answer. The answer chips are
  // scoped by blocker code for exactly this reason (see
  // `readiness-answer-chips.ts`), and the suite's discrimination control pins
  // that a structural blocker is never offered one.
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: stage,
  } as OlumiResponse;
}

/**
 * ⭐⭐ "TWO ANSWERS, NOT SIX" — the sentence that makes this loop finite.
 *
 * `PLOT_MIN_COMPARISON_OPTIONS` is the real finish line: once that many options
 * carry effect values the comparison runs, and the exclusion honestly carries
 * the rest. Measured over the J4 capture, admission flips at exactly TWO
 * configured options with FOUR blockers still open.
 *
 * Saying this is not a convenience — it is what stops the loop reading as a
 * march through every blocker. These blockers are `obligation: 'offered'`, so
 * the product may offer to work them through and may never demand them.
 */
function spellSmallNumber(value: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  // Falls back to digits rather than going silently wrong if the constant moves.
  return words[value] ?? String(value);
}

/**
 * ⚠ Caught by READING THE COMPOSED OUTPUT, not by the suite — every assertion
 * was green while the product said "…to run. four options are still unset".
 * A spelled number opening a sentence needs a capital, and no test that checks
 * for chips, counts or forbidden phrasings can see that.
 */
function startSentence(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

function composeOpenItemsResponse(
  prose: string,
  stage: StageIndicator,
  proposal: CanonicalReadinessRepairProposal | null,
  assessment: CanonicalReadinessAssessment,
  graph: unknown,
): OlumiResponse {
  // `prose` is the reviewed, deterministic readiness-summary text (the SAME
  // string the post-analysis advice gate ships). It already opens with
  // "Here's what's still open before this can run cleanly: …" and never echoes
  // a numeric readiness percentage, so it is safe to surface verbatim as the
  // whole answer. We prepend nothing structural to avoid drift with that gate.
  const planCopy = proposal === null
    ? ''
    : proposal.changes.length > 0
      ? `\n\nI have grouped the ${proposal.changes.length} safe model ${proposal.changes.length === 1 ? 'fix' : 'fixes'} into one reviewable change. ${proposal.unresolved_inputs.length} ${proposal.unresolved_inputs.length === 1 ? 'item still needs' : 'items still need'} your judgement; I will not invent missing values or relationships.`
      : `\n\nI have grouped all ${proposal.unresolved_inputs.length} open items into one review plan. They need your judgement, so I will not invent missing values or relationships.`;

  // ⚠ Derived from `blockingIssues`, NOT from `proposal.unresolved_inputs`:
  // that array exists only at two-or-more blockers, and this loop converges
  // toward one. See `readiness-answer-chips.ts`.
  const answerable = selectAnswerableBlockers(assessment.blockingIssues);
  const willProceed = resolveRunAdmission(graph).willProceed;

  if (willProceed) {
    // ⭐ THE LOOP STOPS ASKING HERE. Continuing to walk the remaining blockers
    // would be asking for values that no longer block anything — an obligation
    // these `offered` blockers do not carry. The run already discloses which
    // options it left out; this says so before the user commits to it.
    const optionsLeftOut = new Set(answerable.map((issue) => issue.option_id)).size;
    const leaveOutCopy = optionsLeftOut > 0
      ? ` ${startSentence(spellSmallNumber(optionsLeftOut))} ${optionsLeftOut === 1 ? 'option is' : 'options are'} still unset, so I will leave ${optionsLeftOut === 1 ? 'it' : 'them'} out of the comparison and name ${optionsLeftOut === 1 ? 'it' : 'them'} in the results.`
      : '';
    return {
      response_version: 2,
      assistant_text: `${prose}\n\nThere is already enough here to run.${leaveOutCopy}`,
      blocks: [],
      // The run comes first: it is the thing the user can now do. The answer
      // chips stay available for anyone who would rather set one more first.
      suggested_actions: [
        RUN_ANALYSIS_CHIP,
        ...buildAnswerChips(answerable, buildLabelLookup(graph), MAX_RENDERED_CHIPS - 1),
      ],
      insights: [],
      stage_indicator: stage,
    } as OlumiResponse;
  }

  const enoughCopy = answerable.length > PLOT_MIN_COMPARISON_OPTIONS
    ? `\n\nAnswering ${spellSmallNumber(PLOT_MIN_COMPARISON_OPTIONS)} of them is enough to start: once ${spellSmallNumber(PLOT_MIN_COMPARISON_OPTIONS)} options have effect values, I can run the comparison and leave the rest out — and I will name what I left out.`
    : '';
  return {
    response_version: 2,
    assistant_text: `${prose}${planCopy}${enoughCopy}`,
    blocks: [],
    suggested_actions: [...buildAnswerChips(answerable, buildLabelLookup(graph), MAX_RENDERED_CHIPS)],
    insights: [],
    stage_indicator: stage,
  } as OlumiResponse;
}

function composeReadyResponse(stage: StageIndicator): OlumiResponse {
  const assistantText =
    'Your model has a goal, at least two options, and factors mapped with ' +
    'values, so it looks ready to analyse. Run the analysis whenever you are ' +
    'ready, and I can talk through the results with you afterwards.';
  // The copy said "run the analysis whenever you are ready" and offered no way
  // to do it — while the canvas's own Analyse control is unmounted on the Olumi
  // tab. An affordance-free instruction to use an affordance that may not be
  // on screen is the shape this loop exists to remove.
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [RUN_ANALYSIS_CHIP],
    insights: [],
    stage_indicator: stage,
  } as OlumiResponse;
}

/**
 * Compose the readiness/coaching answer for a typed `analysis_readiness`
 * chip_click, reading the PERSISTED scenario graph (the same authority the
 * run_analysis chip uses — never the HTTP body).
 *
 * Branch tree (mirrors `evaluateReadiness`'s own structural gates so the two
 * cannot diverge on what "readiness" means):
 *   - no graph / empty / unparseable  → the honest fresh-canvas checklist
 *     (`composeProcessMetaIntakeResponse`), now reached by the type. This is
 *     the unification with the string-mirror branch.
 *   - populated, no goal node         → the canonical assessment emits a
 *     blocked wire status and this composer names the missing goal.
 *   - populated, open readiness items → surface `summariseReadiness`'s prose.
 *   - populated, nothing open         → say the model looks ready to analyse.
 */
export function composeReadinessIntakeResponse(
  persistedGraph: unknown | null,
  stage: StageIndicator,
): ReadinessIntakeResult {
  if (persistedGraph == null) {
    return { outcome: 'fresh_canvas', response: composeProcessMetaIntakeResponse(), assessment: null };
  }
  const parsed = GraphV3.safeParse(persistedGraph);
  // Unparseable, or parseable but structurally empty (no nodes): we cannot
  // assess readiness, so give the honest fresh-canvas answer rather than a
  // misleading populated-canvas claim.
  if (!parsed.success || parsed.data.nodes.length === 0) {
    return { outcome: 'fresh_canvas', response: composeProcessMetaIntakeResponse(), assessment: null };
  }
  // Preserve canonical top-level options when present; GraphV3 parsing is the
  // validity gate but its projection may intentionally omit those carriers.
  const assessment = assessCanonicalAnalysisReadiness(persistedGraph);
  const readiness = assessment.analysisReady;
  if (
    readiness === undefined
    || assessment.blockingIssues.some((issue) => issue.code === 'NO_GOAL')
  ) {
    return { outcome: 'goal_missing', response: composeGoalMissingResponse(stage), assessment };
  }
  const summary = summariseReadiness(readiness);
  if (summary.open_items.length > 0) {
    return {
      outcome: 'readiness_open',
      response: composeOpenItemsResponse(
        summary.prose,
        stage,
        assessment.repairProposal,
        assessment,
        persistedGraph,
      ),
      assessment,
    };
  }
  return { outcome: 'readiness_ready', response: composeReadyResponse(stage), assessment };
}
