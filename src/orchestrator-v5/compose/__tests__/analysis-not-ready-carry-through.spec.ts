/**
 * ⭐ THE TOP SENDABLE BLOCKER: a fresh user is refused an analysis and given no
 * route through the refusal.
 *
 * WITNESSED (deployed, fresh guest, 2026-08-20T00:00Z, UI `2b6ec553` / CEE
 * `19a60fd`): the panel said "6 parts of your model are not ready for analysis
 * yet. Ask in the chat what they need." The user asked in the chat and was told
 * the blockers were not "broken out by name". The chat then offered "Want me to
 * run it?"; the user said "Yes, please run it." and got "Review all 6 readiness
 * issues together before analysis." Clicking the product's own "Review the
 * model" chip returned "I have not run the analysis, because I did not read
 * that as a request to run one."
 *
 * ⭐ THE BLOCKERS ARE GENUINE AND THIS SPEC DOES NOT WEAKEN THEM. Reproduced by
 * executing the authority over a real captured draft with its option values
 * stripped (the zero-configured fresh-draft arm): exactly 6 blocking issues, 3
 * `MISSING_OPTION_VALUE` + 3 `OPTION_NEEDS_MAPPING`, `willProceed:false`. No
 * option carries a quantified effect, so there is nothing to compare and
 * `gateAnalysableOptions` correctly declines to scaffold
 * (`analysable-option-gate.ts:444` — all-unanalysable returns ungated). The
 * refusal is right. What was missing is the CARRY-THROUGH.
 *
 * ⭐ AND THE CONTENT ALREADY EXISTED. The same assessment that produces the
 * refusal also produces `repairProposal.unresolved_inputs` — in the witnessed
 * arm, six fully-composed questions naming the option AND the factor
 * ("Choose the missing effect value for "…" on "…"."). The failure response
 * dropped every one of them and printed only the count. The user was told to
 * ask in the chat for information CEE was already holding.
 *
 * Two defects, one response:
 *   1. the named questions were derived and discarded;
 *   2. the recovery chip replayed "Help me fix my model so it can be
 *      analysed." as UNTYPED text, so it round-tripped through the LLM router,
 *      was elected `run_analysis`, and was then DEMOTED by
 *      `analysis-election-gate.ts` — the product emitting an affordance whose
 *      own message its own admission predicate refuses. That is the exact P8
 *      violation `analysis-election-gate.ts:125-129` claims to protect against.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { composeHandlerFailure } from '../handler-failure-responses.js';
import { HandlerInvocationFailedError } from '../../tools/handler-errors.js';
import type {
  HandlerFailureDetails,
  HandlerInvocationFailedCause,
} from '../../tools/handler-errors.js';
import type { ComposeContext } from '../types.js';
import { PRODUCT_COACHING_PROMPTS } from '../../routing/process-meta-intake.js';
import { looksLikeExplicitAnalysisRequest } from '../../routing/analytical-intent.js';
import {
  assessAnalysisReadiness,
  readinessQuestions,
  resolveRunAdmission,
} from '../../tools/handlers/analysis-ready-core.js';

const CTX: ComposeContext = { handlerRegistry: {} };

function build(
  extra: Omit<HandlerFailureDetails, 'handler_id'> & Record<string, unknown>,
): HandlerInvocationFailedError {
  return new HandlerInvocationFailedError('test', {
    cause_kind: 'analysis_not_ready' as HandlerInvocationFailedCause,
    retryable: false,
    details: { handler_id: 'run_analysis', ...extra },
  });
}

/**
 * The SIX questions from the witnessed zero-configured arm, verbatim from
 * `assessCanonicalAnalysisReadiness(...).repairProposal.unresolved_inputs[].prompt`.
 * Bound by IDENTITY (option label + factor label), never by shape: a different
 * object could satisfy "contains a question mark" or "mentions an option".
 */
const WITNESSED_QUESTIONS: readonly string[] = [
  'Choose the missing effect value for "subcontracting inner-city deliveries to a green courier" on "Subcontractor cost as share of affected-route revenue".',
  'Choose the missing effect value for "paying the daily charges and passing costs to customers" on "Annual clean-air charge burden".',
  'Choose the missing effect value for "replacing a third of the diesel fleet with electric vans now" on "Net EV capex after grants and resale of displaced diesels".',
  'Choose which factor "Electrify one-third of fleet (EV capex route)" changes and by how much.',
  'Choose which factor "Subcontract inner-city runs to green courier" changes and by how much.',
  'Choose which factor "Pay daily clean-air charges and pass through to customers" changes and by how much.',
];

const WITNESSED_NEXT_STEP = 'Review all 6 readiness issues together before analysis.';

describe('analysis_not_ready — the user gets a route through the refusal', () => {
  it('names EVERY outstanding question, bound by option+factor identity', () => {
    const { response } = composeHandlerFailure(
      build({ reason_code: 'MISSING_OPTION_VALUE', next_step: WITNESSED_NEXT_STEP,
        readiness_questions: [...WITNESSED_QUESTIONS] }),
      CTX,
      'frame',
    );
    // The count sentence is kept: it is the strict verdict and remains true.
    expect(response.assistant_text).toContain(WITNESSED_NEXT_STEP);
    // ⭐ Each question by IDENTITY. A value predicate ("mentions an option")
    // could be satisfied by a different question; these cannot.
    for (const q of WITNESSED_QUESTIONS) {
      expect(response.assistant_text).toContain(q);
    }
  });

  it('OPPOSITE DIRECTION — with no questions in hand it still says exactly the next step', () => {
    // The pre-existing NO_GRAPH contract. Proves the change cannot blanket-append
    // a carry-through section to a verdict that has none, which is how an honest
    // refusal would turn into a manufactured obligation.
    const { response } = composeHandlerFailure(
      build({ reason_code: 'NO_GRAPH', next_step: 'Draft or save a model first, then run analysis.' }),
      CTX,
      'frame',
    );
    expect(response.assistant_text).toBe('Draft or save a model first, then run analysis.');
  });

  it('discloses truncation rather than silently dropping questions', () => {
    const many = Array.from({ length: 9 }, (_, i) => `Choose the missing effect value for "opt ${i}" on "fac ${i}".`);
    const { response } = composeHandlerFailure(
      build({ reason_code: 'MISSING_OPTION_VALUE', next_step: 'Review all 9 readiness issues together before analysis.',
        readiness_questions: many }),
      CTX,
      'frame',
    );
    const shown = many.filter((q) => response.assistant_text.includes(q));
    // Whatever the cap is, the response must ACCOUNT for every question it did
    // not print. A silent truncation is the dishonesty this estate bans.
    if (shown.length < many.length) {
      expect(response.assistant_text).toContain(String(many.length - shown.length));
    }
    expect(shown.length).toBeGreaterThan(0);
  });

  it('⭐ the recovery chip is TYPED, so it cannot be demoted by the election gate', () => {
    const { response, chip_type } = composeHandlerFailure(
      build({ reason_code: 'MISSING_OPTION_VALUE', next_step: WITNESSED_NEXT_STEP,
        readiness_questions: [...WITNESSED_QUESTIONS] }),
      CTX,
      'frame',
    );
    const chip = response.suggested_actions[0];
    expect(chip).toBeDefined();
    // Bound by identity to the ONE action_type route-v2 routes to the readiness
    // arm (`route-v2.ts:2789`), not to "has some action_type".
    expect(chip?.action_type).toBe('analysis_readiness');
    expect(chip_type).toBe('action');
  });

  it('⭐ P8 — the chip replays a message the product already honours deterministically', () => {
    const { response } = composeHandlerFailure(
      build({ reason_code: 'MISSING_OPTION_VALUE', next_step: WITNESSED_NEXT_STEP,
        readiness_questions: [...WITNESSED_QUESTIONS] }),
      CTX,
      'frame',
    );
    const message = response.suggested_actions[0]?.message ?? '';
    // Membership of the EXISTING canonical set — this adds no second string
    // authority (Paul's convergence rule). `process-meta-intake.ts:63`.
    expect(PRODUCT_COACHING_PROMPTS).toContain(message);
  });

  it('⭐ REGRESSION PIN — the old replay string is refused by the product\'s own predicate', () => {
    // This is WHY the chip changed. Pinned so nobody restores it: the message
    // the chip used to carry is DEMOTED by the very gate that decides whether an
    // elected run may be honoured, while a genuine request is admitted.
    expect(looksLikeExplicitAnalysisRequest('Help me fix my model so it can be analysed.')).toBe(false);
    // Contrast control: the predicate is not simply returning false for everything.
    expect(looksLikeExplicitAnalysisRequest('run the analysis')).toBe(true);
  });
});

/**
 * ⭐ THE CORPUS IS THE PRODUCER'S, NOT MINE.
 *
 * `WITNESSED_QUESTIONS` above is a literal list, and a literal list written by
 * the author is not evidence about the producer (trap 16-inverse: a fixture you
 * wrote yourself encodes your model of the producer rather than the producer).
 * This block derives the same six strings by RUNNING the authority, and asserts
 * the two agree exactly. If the producer's wording, ordering or count ever
 * moves, this REDs and the literal list above is corrected from the producer,
 * never the other way round.
 *
 * The input is a real dated capture with its option effect values removed in
 * memory — the zero-configured arm a fresh draft lands in. The capture itself is
 * READ-ONLY: a dated capture is append-only evidence, never a fixture to edit.
 */
const CAPTURE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url),
    'utf8',
  ),
) as { draft_graph: unknown };

/** The fresh-draft arm: no option carries a quantified effect. */
function zeroConfiguredArm(): unknown {
  const g = JSON.parse(JSON.stringify(CAPTURE.draft_graph)) as {
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
  };
  const optionIds = new Set(
    (g.nodes ?? []).filter((n) => n.kind === 'option').map((n) => n.id as string),
  );
  for (const n of g.nodes ?? []) {
    if (n.kind === 'option') delete n.interventions;
  }
  for (const e of g.edges ?? []) {
    if (optionIds.has(e.from as string)) delete e.observed_state;
  }
  return g;
}

describe('the questions are the producer\'s, derived not authored', () => {
  it('PRECONDITION — the arm really is the witnessed refusal state', () => {
    const graph = zeroConfiguredArm();
    const assessment = assessAnalysisReadiness(graph);
    const admission = resolveRunAdmission(graph);
    // Pinned in-test so the assertions below cannot pass for the wrong reason.
    expect(assessment.status).toBe('unrecoverable');
    expect(admission.willProceed).toBe(false);
    // The witnessed count, and the witnessed sentence, by identity.
    expect(assessment.issues.filter((i) => i.repairability === 'human_input_required')).toHaveLength(6);
    expect(admission.strict.nextStep).toBe(WITNESSED_NEXT_STEP);
  });

  it('⭐ readinessQuestions() returns EXACTLY the six literals asserted above', () => {
    const derived = readinessQuestions(assessAnalysisReadiness(zeroConfiguredArm()));
    expect([...derived]).toEqual([...WITNESSED_QUESTIONS]);
  });

  it('OPPOSITE DIRECTION — a verdict with no enumerable inputs yields no questions', () => {
    // NO_GRAPH has one issue and no repair proposal, so the list is empty and the
    // composer's `shown.length === 0` branch is the one that runs. Without this,
    // "returns the six" would be satisfied by a function that always returns six.
    expect(readinessQuestions(assessAnalysisReadiness(null))).toHaveLength(0);
  });
});
