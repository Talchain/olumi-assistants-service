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
 * ⭐⭐ A DATED RECORD OF WHAT THE PRODUCT EMITTED — NOT A LIVE EXPECTATION.
 *
 * The SIX questions from the witnessed zero-configured arm, verbatim from
 * `assessCanonicalAnalysisReadiness(...).repairProposal.unresolved_inputs[].prompt`
 * **as emitted at UI `2b6ec553` / CEE `19a60fd`, 2026-08-20T00:00Z**.
 *
 * ⛔ APPEND-ONLY. THESE STRINGS ARE EVIDENCE AND MUST NEVER BE EDITED IN PLACE.
 * They record sentences the product ACTUALLY PUT TO A USER on a dated build.
 * Rewriting them to match new behaviour would falsify that record, and a suite
 * green against a rewritten history is a suite agreeing with a history that
 * never happened (CLAUDE.md trap 14b). If the wording moves, ADD a new list —
 * which is exactly what {@link QUESTIONS_NOW} is.
 *
 * ⚠ THREE OF THESE SIX ARE NO LONGER WHAT THE PRODUCT SAYS. See
 * {@link QUESTIONS_NOW} for the current wording and the reasoning. This list is
 * retained deliberately, and the divergence is asserted below rather than
 * quietly erased.
 *
 * Still load-bearing as a TEST INPUT: the carry-through tests feed this list to
 * the composer to prove it names every question it is handed. That property is
 * wording-agnostic, so historic strings are the right input for it — and using
 * them proves the composer is not coupled to today's phrasing.
 */
const QUESTIONS_AS_EMITTED_2026_08_20: readonly string[] = [
  'Choose the missing effect value for "subcontracting inner-city deliveries to a green courier" on "Subcontractor cost as share of affected-route revenue".',
  'Choose the missing effect value for "paying the daily charges and passing costs to customers" on "Annual clean-air charge burden".',
  'Choose the missing effect value for "replacing a third of the diesel fleet with electric vans now" on "Net EV capex after grants and resale of displaced diesels".',
  'Choose which factor "Electrify one-third of fleet (EV capex route)" changes and by how much.',
  'Choose which factor "Subcontract inner-city runs to green courier" changes and by how much.',
  'Choose which factor "Pay daily clean-air charges and pass through to customers" changes and by how much.',
];

/**
 * ⭐⭐ WHAT THE PRODUCT SAYS NOW (2026-08-26) — and the confession of what moved.
 *
 * THREE OF THE SIX CHANGED, and they are exactly the three `MISSING_OPTION_VALUE`
 * questions. The three `OPTION_NEEDS_MAPPING` questions are BYTE-IDENTICAL to
 * the 20 Aug record, which is the discriminating half of the change: a blanket
 * rewrite would have moved all six.
 *
 * WHY THEY MOVED. `blockerIssue` was DISCARDING the producer's own sentence and
 * synthesising a substitute, which the shared contract explicitly forbids
 * ("rendered VERBATIM … a consumer must not … SYNTHESISE A SUBSTITUTE WHEN IT
 * DISLIKES THE WORDING"). For the pair-scoped `missing_value` class the
 * producer's sentence is strictly more useful: it names both scopes AND the
 * factor's current value AND asks the question the user must answer, where the
 * substitute named the scopes and nothing else.
 *
 * The current value now reads "Moderate (0.5)" rather than the internal level
 * `0.5`, which is the other half of the same train — the producer was quoting a
 * normalised level while the node's own display form sat in the same payload.
 *
 * ⚠ WHY ONLY THIS CLASS. The other three blocker classes keep their composed
 * remedies, because their producer messages were never written to be shown to a
 * user: `ambiguous_value` emits "…analysis-scale source binding is unresolved",
 * the factor-only `missing_value` emits a diagnosis with no remedy, and
 * `constraint_dropped` leaks an internal id. A blanket rule would have traded
 * one truthfulness defect for three.
 */
const QUESTIONS_NOW: readonly string[] = [
  'Factor "Subcontractor cost as share of affected-route revenue" is currently Moderate (0.5). What should option "subcontracting inner-city deliveries to a green courier" set it to?',
  'Factor "Annual clean-air charge burden" is currently Moderate (0.5). What should option "paying the daily charges and passing costs to customers" set it to?',
  'Factor "Net EV capex after grants and resale of displaced diesels" is currently Moderate (0.5). What should option "replacing a third of the diesel fleet with electric vans now" set it to?',
  'Choose which factor "Electrify one-third of fleet (EV capex route)" changes and by how much.',
  'Choose which factor "Subcontract inner-city runs to green courier" changes and by how much.',
  'Choose which factor "Pay daily clean-air charges and pass through to customers" changes and by how much.',
];

const WITNESSED_NEXT_STEP = 'Review all 6 readiness issues together before analysis.';

describe('analysis_not_ready — the user gets a route through the refusal', () => {
  it('names EVERY outstanding question, bound by option+factor identity', () => {
    const { response } = composeHandlerFailure(
      build({ reason_code: 'MISSING_OPTION_VALUE', next_step: WITNESSED_NEXT_STEP,
        readiness_questions: [...QUESTIONS_AS_EMITTED_2026_08_20] }),
      CTX,
      'frame',
    );
    // The count sentence is kept: it is the strict verdict and remains true.
    expect(response.assistant_text).toContain(WITNESSED_NEXT_STEP);
    // ⭐ Each question by IDENTITY. A value predicate ("mentions an option")
    // could be satisfied by a different question; these cannot.
    for (const q of QUESTIONS_AS_EMITTED_2026_08_20) {
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
    // ⚠ THE LABELS ARE DELIBERATELY DIGIT-FREE, and that is the whole test.
    // My first version numbered them ("opt 3"), so the assertion that the
    // withheld COUNT appears was satisfied by the digit inside a question that
    // WAS shown — a guard agreeing with itself, and a mutant that deleted the
    // disclosure line SURVIVED it. With word labels the only digit that can
    // supply the count is the disclosure sentence itself.
    const NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india'];
    const many = NAMES.map((n) => `Choose the missing effect value for "opt ${n}" on "fac ${n}".`);
    const { response } = composeHandlerFailure(
      build({ reason_code: 'MISSING_OPTION_VALUE', next_step: 'Review all nine readiness issues together before analysis.',
        readiness_questions: many }),
      CTX,
      'frame',
    );
    const shown = many.filter((q) => response.assistant_text.includes(q));
    expect(shown.length).toBeGreaterThan(0);
    // Whatever the cap is, the response must ACCOUNT for every question it did
    // not print. A silent truncation is the dishonesty this estate bans.
    const withheld = many.length - shown.length;
    expect(withheld).toBeGreaterThan(0);
    expect(response.assistant_text).toContain(String(withheld));
    // PRECONDITION pinned in-test: no SHOWN question may carry a digit, or the
    // assertion above could pass without any disclosure at all.
    for (const q of shown) expect(q).not.toMatch(/[0-9]/);
  });

  it('⭐ the recovery chip is TYPED, so it cannot be demoted by the election gate', () => {
    const { response, chip_type } = composeHandlerFailure(
      build({ reason_code: 'MISSING_OPTION_VALUE', next_step: WITNESSED_NEXT_STEP,
        readiness_questions: [...QUESTIONS_AS_EMITTED_2026_08_20] }),
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
        readiness_questions: [...QUESTIONS_AS_EMITTED_2026_08_20] }),
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
 * {@link QUESTIONS_NOW} above is a literal list, and a literal list written by
 * the author is not evidence about the producer (trap 16-inverse: a fixture you
 * wrote yourself encodes your model of the producer rather than the producer).
 * This block derives the same six strings by RUNNING the authority, and asserts
 * the two agree exactly. If the producer's wording, ordering or count ever
 * moves, this REDs and `QUESTIONS_NOW` is corrected from the producer, never the
 * other way round.
 *
 * ⛔ AND THE CORRECTION TARGET IS `QUESTIONS_NOW`, NEVER
 * {@link QUESTIONS_AS_EMITTED_2026_08_20}. The two lists answer different
 * questions — one is a dated record of what the product SAID, the other an
 * expectation about what it says NOW — and only the second one tracks. Editing
 * the record to silence a RED would falsify evidence (trap 14b); the delta
 * between them is asserted explicitly instead.
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
    //
    // Read from the ADMISSION'S OWN assessment rather than the neutral verdict's
    // optional `issues`: `blockingIssues` is the exact set the refusal counts
    // (`analysis-ready-core.ts:176-177` prints `blockingIssues.length`), so this
    // pins the same object the sentence is derived from.
    expect(admission.assessment.blockingIssues).toHaveLength(6);
    // ⭐ AND BY CODE, not just by count — this is the mechanism, and a count
    // alone would be satisfied by six issues of any kind.
    const codes = admission.assessment.blockingIssues.map((i) => i.code).sort();
    expect(codes).toEqual([
      'MISSING_OPTION_VALUE', 'MISSING_OPTION_VALUE', 'MISSING_OPTION_VALUE',
      'OPTION_NEEDS_MAPPING', 'OPTION_NEEDS_MAPPING', 'OPTION_NEEDS_MAPPING',
    ]);
    // ⭐ EVERY ONE IS `offered`. CEE's own rule is that `user_stated` and only
    // `user_stated` earns a demand (`obligation-provenance.ts:86`), so none of
    // these six may be put to the user as an obligation. Pinned because the
    // surfaces still render them as one.
    for (const issue of admission.assessment.blockingIssues) {
      expect((issue as { obligation?: string }).obligation).toBe('offered');
    }
    expect(admission.strict.nextStep).toBe(WITNESSED_NEXT_STEP);
  });

  it('⭐ readinessQuestions() returns EXACTLY the six current literals', () => {
    const derived = readinessQuestions(assessAnalysisReadiness(zeroConfiguredArm()));
    expect([...derived]).toEqual([...QUESTIONS_NOW]);
  });

  /**
   * ⭐⭐ THE DELTA IS ASSERTED, NOT ERASED.
   *
   * The 20 Aug record and today's output are DIFFERENT OBJECTS: one is evidence
   * about THEN, the other an expectation about NOW. Keeping both and pinning the
   * difference is what stops a future reader mistaking a wording change for a
   * wording that never changed — and it REDs if the delta ever grows or shrinks,
   * so a later blanket rewrite of the other three classes cannot slip through.
   */
  it('⭐ EXACTLY THREE of the six moved — the MISSING_OPTION_VALUE ones, and no others', () => {
    const changed = QUESTIONS_AS_EMITTED_2026_08_20
      .map((was, i) => ({ was, now: QUESTIONS_NOW[i], i }))
      .filter((row) => row.was !== row.now);

    expect(changed.map((row) => row.i)).toEqual([0, 1, 2]);

    // The three that moved are the pair-scoped value questions: they gained the
    // factor's current value and the direct question.
    for (const row of changed) {
      expect(row.was).toContain('Choose the missing effect value for');
      expect(row.now).toContain('is currently');
      expect(row.now).toContain('set it to?');
    }

    // ⛔ AND THE MAPPING QUESTIONS ARE UNTOUCHED — byte-identical to the record.
    // This is the discriminating half: a blanket change would move these too.
    expect(QUESTIONS_NOW.slice(3)).toEqual(QUESTIONS_AS_EMITTED_2026_08_20.slice(3));
  });

  it('OPPOSITE DIRECTION — a verdict with no enumerable inputs yields no questions', () => {
    // NO_GRAPH has one issue and no repair proposal, so the list is empty and the
    // composer's `shown.length === 0` branch is the one that runs. Without this,
    // "returns the six" would be satisfied by a function that always returns six.
    expect(readinessQuestions(assessAnalysisReadiness(null))).toHaveLength(0);
  });
});
