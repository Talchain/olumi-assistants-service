/**
 * ⭐⭐ A REQUEST FOR OLUMI'S JUDGEMENT REACHES THE REASONING LAYER, AND AN EDIT
 * STILL EDITS.
 *
 * ── THE RED, MEASURED AT PRISTINE `de254398` ───────────────────────────────
 * A seven-brief evaluation ran an A/B on ONE scenario, one build, one model.
 * Executing the predicates at that tip (`.tmp/probe-routing.ts`) reproduces it:
 *
 *   isBriefAuditQuestion("Do you actually disagree with anything I said?")
 *     → true          → answered with a figure tally, `llm_calls: 0`
 *   isBriefAuditQuestion("Argue the opposite case as strongly as you can.")
 *     → false         → reached the reasoning layer, answered WELL
 *   isBriefAuditQuestion("What is the most important thing my framing missed?")
 *     → false         → reached the reasoning layer, answered WELL
 *
 *   isStructureOriginQuestion(
 *     "Why is Enterprise ACV target in the model, and how confident are you in it?")
 *     → true          → whole reply: `"Enterprise ACV target" was my
 *                       suggestion, not something you wrote.` (67 chars)
 *
 * Same model, same scenario, same build. The phrasing decided whether the user
 * reached the capability.
 *
 * ── WHERE THE CORPUS COMES FROM (trap 22) ──────────────────────────────────
 * The MUST-REASON rows are the evaluation's verbatim questions plus the
 * phrasings a colleague types around them. Every OPPOSITE-DIRECTION TWIN is
 * lifted unchanged from the two suites that already own these arms —
 * `state-query-guard.brief-audit.test.ts` (verbatim trace captures) and
 * `state-query-guard.structure-origin.test.ts` (a verbatim journey witness) —
 * so neither direction is drawn from this author's head, and a blanket disable
 * of the arms cannot pass this file (trap 22b).
 *
 * ── THE STRUCTURAL TWIN, WHICH IS THE ONE THAT MATTERS ─────────────────────
 * Misrouting a question to reasoning is recoverable; misrouting a genuine edit
 * to reasoning LOSES THE USER'S EDIT. The two harms cannot share a window, so
 * this change does not put them in one: the decline lives ONLY in
 * `tryStateQueryGuard`'s two answering arms, and `isStateQueryQuestionShape` —
 * the predicate that denies a mutation warrant (`mutation-warrant.ts:1052`) and
 * suppresses `edit_graph` dispatch (`route-v2.ts:4879`) — is untouched. The
 * PROTECTION-UNCHANGED block below pins that by execution over the whole
 * corpus, with the pristine values recorded at `de254398`, so a future
 * "simplification" that pushes the decline down into `isBriefAuditQuestion` or
 * `isStructureOriginQuestion` goes RED here rather than quietly re-opening
 * `edit_graph` to a question.
 */
import { describe, expect, it } from 'vitest';

import type { ContextPack } from '../../context/context-pack-assembler.js';
import type { RecentMutation } from '../../context/recent-changes.js';
import { isBriefAuditQuestion } from '../../../cee/context-integrity/brief-audit-answer.js';
import { isStructureOriginQuestion } from '../../../cee/context-integrity/structure-origin-answer.js';
import { asksForOwnJudgement } from '../judgement-request.js';
import { hasMutationWarrantSignal, isEditRequestShape } from '../mutation-warrant.js';
import { isStateQueryQuestionShape, tryStateQueryGuard } from '../state-query-guard.js';
import { tryPostAnalysisAdviceGate } from '../post-analysis-advice-gate.js';
import { tryStaleRerunGuard } from '../stale-rerun-guard.js';

/** Lifted verbatim from `state-query-guard.structure-origin.test.ts`. */
const WITNESS_GRAPH = {
  nodes: [
    {
      id: '939d4630',
      kind: 'option',
      label: 'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
      provenance: 'ai_inferred',
    },
    {
      id: '4abad64d',
      kind: 'option',
      label:
        'double down on enterprise sales (higher margins but longer cycles and more headcount)',
      provenance: 'from_brief',
      source_quote:
        'double down on enterprise sales (higher margins but longer cycles and more headcount)',
    },
    {
      id: 'ac71d0c2',
      kind: 'factor',
      label: 'Enterprise ACV target',
      provenance: 'ai_inferred',
    },
  ],
  edges: [],
};

const BRIEF_TEXT =
  'We are a Series A healthtech startup. ARR is £11.2m and growing 22% a year. ' +
  'We need to decide whether to double down on enterprise sales.';

const ADD_CONSTRAINT_50K: RecentMutation = {
  action: 'constraint_added',
  summary: 'Added constraint: Total cost must be at most £50,000.',
  target_label: 'Total cost',
};

function ctx(
  recent: readonly RecentMutation[],
  status: ContextPack['recent_changes_status'] = 'complete',
): Pick<ContextPack, 'recent_changes' | 'recent_changes_status'> {
  return { recent_changes: recent, recent_changes_status: status };
}

const briefAudit = { briefText: BRIEF_TEXT, graph: WITNESS_GRAPH };

describe('independent review — control complements retain the system subject', () => {
  it.each([
    // Outside review5674195175: requesting a report is not recalling one.
    'Can you tell me which of my figures you used?',
    'Could you explain what you left out of my brief?',
    'Would you show me which assumptions you kept from my brief?',
    'Can you list what you omitted from my brief?',
    'Could you tell me what you inferred from my brief?',
    'As you know, tell me which of my figures you used.',
    'Given what you said, show me what you left out of my brief.',
    'Before you answer, list which assumptions you kept from my brief.',
  ])('recognises the current request to report a handling fact: %j', (message) => {
    for (const recent of [[], [ADD_CONSTRAINT_50K]]) {
      const outcome = tryStateQueryGuard({ message, contextPack: ctx(recent), briefAudit });
      expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
    }
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it.each([
    'Did you tell me which of my figures you used?',
    'Can you remember which of my figures you used?',
    'Could you explain what you planned to use from my brief?',
    'Can you tell me what I should keep from the figures you used in my brief?',
    'As you know, tell me what I should infer from my brief.',
  ])('requesting a report does not make its content actual system handling: %j', (message) => {
    expect(tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched).toBe(false);
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it.each([
    // Outside review5674116183: the question subject follows the preamble.
    'As you know, which of my figures did you decide to use?',
    'Given what you said, which figures from my brief did you start using?',
    'Before you answer, what did you leave out of my brief?',
    'You mentioned the model earlier; which of my assumptions did you choose to keep?',
    'What you told me was useful — which figures did you use from my brief?',
    'You gave me a tally before: what parts of my brief did you end up omitting?',
  ])('binds the current interrogative rather than a preamble subject: %j', (message) => {
    for (const recent of [[], [ADD_CONSTRAINT_50K]]) {
      const outcome = tryStateQueryGuard({ message, contextPack: ctx(recent), briefAudit });
      expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
    }
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it.each([
    'As you know, did you mention that you started using my figures?',
    'You mentioned a draft earlier; did you claim to have used my figures?',
    'Before you answer, do you think we should use my figures?',
  ])('a preamble does not make an outer report or advice request factual handling: %j', (message) => {
    expect(tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched).toBe(false);
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it.each([
    // Outside corpus from exact-head review of e5ab279e, comment 5673875752.
    'Which of my figures did you decide to use?',
    'Which of my assumptions did you choose to keep?',
    'What parts of my brief did you end up omitting?',
    'What did you choose to infer from my brief?',
    'Which parts of my brief did you opt to incorporate?',
    'Which figures from my brief did you go on to include?',
    // Self-review after the outside corpus: a bare gerund complement carries
    // the same subject too; do not fix only the six infinitive/particle forms.
    'Which figures from my brief did you start using?',
    'Which figures from my brief have you been using?',
    'Which figures from my brief did you continue using?',
  ])('keeps the factual audit in both edit-history states: %j', (message) => {
    for (const recent of [[], [ADD_CONSTRAINT_50K]]) {
      const outcome = tryStateQueryGuard({ message, contextPack: ctx(recent), briefAudit });
      expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
    }
    expect(isStateQueryQuestionShape(message)).toBe(true);
    expect(hasMutationWarrantSignal(message)).toBe(false);
    expect(isEditRequestShape(message)).toBe(false);
  });

  it.each([
    'Do you believe we should choose to use my figures?',
    'Do you reckon I should decide to keep my estimates?',
    'Do you believe we should go on to infer a target from my brief?',
    'Do you believe we should start using my figures?',
    'What did you choose to infer from my brief? What should we use instead?',
  ])('does not transfer the human\'s prospective action to the system: %j', (message) => {
    for (const recent of [[], [ADD_CONSTRAINT_50K]]) {
      expect(tryStateQueryGuard({ message, contextPack: ctx(recent), briefAudit }).matched).toBe(false);
    }
    expect(hasMutationWarrantSignal(message)).toBe(false);
    expect(isEditRequestShape(message)).toBe(false);
  });
});

describe('outside-corpus blockers — disposition ownership and reported speech', () => {
  it.each([
    // Outside follow-up5674055262: an embedded handling proposition is not
    // permission to replace the outer question about saying/thinking it.
    'Did you say that you decided to use my figures?',
    'Did you mention that you started using my figures?',
    'Do you think you decided to keep my assumptions?',
    'Did you deny that you had decided to use my figures?',
    'Did you agree that you used my figures?',
  ])('does not answer the inner proposition instead of the current question: %j', (message) => {
    for (const recent of [[], [ADD_CONSTRAINT_50K]]) {
      expect(tryStateQueryGuard({ message, contextPack: ctx(recent), briefAudit }).matched).toBe(false);
    }
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it.each([
    // Current assent to the handling fact remains the existing contract;
    // past agreement above asks about a different event.
    'Do you agree you left out my ARR figure?',
    'Do you agree that you left out my ARR figure?',
  ])('retains an explicit current request to check the handling fact: %j', (message) => {
    const outcome = tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit });
    expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
  });

  it.each([
    // Independent delta review 5673979510: subject continuity alone does not
    // prove that a promise, intention or claim was actually carried out.
    'Did you promise to use my figures?',
    'Did you plan to keep my assumptions?',
    'Did you hope to include the targets from my brief?',
    'Did you claim to have used my figures?',
    'Did you pretend to use my estimates?',
    'Did you bring up using my figures?',
    'Did you refuse to use my figures?',
    // Same semantic distinction, not seven phrase exclusions.
    'What parts of my brief did you consider omitting?',
    'Did you try to use my figures?',
    'Did you expect to use my figures?',
    'Did you ask us to use my figures?',
  ])('leaves non-completed or other-person handling to reasoning: %j', (message) => {
    for (const recent of [[], [ADD_CONSTRAINT_50K]]) {
      expect(tryStateQueryGuard({ message, contextPack: ctx(recent), briefAudit }).matched).toBe(false);
    }
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it.each([
    'Do you believe we should use my figures?',
    'Do you reckon I should use my estimates?',
    'Do you believe we should infer a target from my brief?',
  ])('does not mistake the user\'s prospective action for our handling: %j', (message) => {
    expect(tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched).toBe(false);
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it.each([
    'What did you leave out of my brief when I wrote, "Do you think we should protect a 30% margin?"',
    'What did you leave out of my brief when I wrote, “Do you think we should protect a 30% margin?”',
    "What did you leave out of my brief when I wrote, 'Do you think we should protect a 30% margin?'",
  ])('keeps a real audit when advice is only quoted: %j', (message) => {
    const result = tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit });
    expect(result.matched && result.dispatch).toBe('brief_audit');
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it('does not let a quoted audit licence an unquoted recommendation request', () => {
    const message = 'In my brief I wrote "which of my figures did you use?"; what should I use now?';
    expect(tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched).toBe(false);
  });

  it('still declines advice appended after a quoted audit subject', () => {
    const message = 'What did you leave out of my brief when I wrote "should we protect 30%"? What should we do next?';
    expect(tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched).toBe(false);
  });

  it.each([
    '"Which of my figures did you use?"',
    '“Which of my figures did you use”?',
    'Which of my figures have you already used?',
    'What did you leave out of my brief when I wrote "we shouldn\'t spend more"?',
  ])('preserves a whole quoted request and ordinary audit modifiers: %j', (message) => {
    const result = tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit });
    expect(result.matched && result.dispatch).toBe('brief_audit');
  });
});

describe('independent review — a modal naming the audited item is not advice', () => {
  const auditQuestions = [
    // CCT's independent contrast corpus, review of 32cbaf45.
    'Which of my figures did you use for the margin we should protect?',
    'What did you leave out that I should know about?',
    'Which of my figures do you use?',
    'What did you leave out of my brief?',
    // Same distinction with the other modal admitted by the former rule.
    'Which of my figures did you use for the margin we could protect?',
    'What did you leave out that I could know about?',
  ];

  it.each(auditQuestions)('keeps the grounded audit and mutation protection for %j', (message) => {
    const outcome = tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit });
    expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
    expect(isStateQueryQuestionShape(message)).toBe(true);
    expect(hasMutationWarrantSignal(message)).toBe(false);
    expect(isEditRequestShape(message)).toBe(false);
  });

  it.each([
    'Which of my figures did you use for the margin we should protect? What should we use instead?',
    'What did you leave out that I should know about? Recommend what I should add.',
    'Given my brief, do you think that we could use £59?',
    'Given my brief, should I use £59?',
  ])('still sends an actual advice request to reasoning: %j', (message) => {
    expect(tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched).toBe(false);
    expect(hasMutationWarrantSignal(message)).toBe(false);
    expect(isEditRequestShape(message)).toBe(false);
  });
});

describe('a brief reference is not permission to replace a conversation with an audit', () => {
  const reasoningRequests = [
    // Paul, served CEE 78515b95, request ef2da921-cc66-4a53-9506-e23d79554489.
    'Looking at my brief, what do you recommend these values should be?',
    // New paraphrases are contrasts, not additional live witnesses.
    'Given my brief, do you see a better way forward?',
    'What do you think about my brief?',
    'What do you recommend I use from my brief?',
    'What did you leave out of my brief, and what would you recommend instead?',
    'Which of my figures did you use? Suggest better values for the uncertain ones.',
    'What did you leave out of my brief, and what should I do next?',
    'Based on what I told you, which values would you choose?',
    'Given my brief, do you think I should use £59?',
  ];

  it.each(reasoningRequests)('does not intercept %j, with or without a saved edit', (message) => {
    for (const recent of [[], [ADD_CONSTRAINT_50K]]) {
      expect(tryStateQueryGuard({ message, contextPack: ctx(recent), briefAudit })).toEqual({
        matched: false,
      });
    }
  });

  it('keeps the witnessed recommendation protected from mutation when its answer falls through', () => {
    const message = reasoningRequests[0];
    expect(isBriefAuditQuestion(message)).toBe(true);
    expect(isStateQueryQuestionShape(message)).toBe(true);
    expect(hasMutationWarrantSignal(message)).toBe(false);
  });

  it.each(['fresh', 'stale', 'unknown'] as const)(
    'the witnessed request also clears the two following conversational gates when analysis is %s',
    (freshness) => {
      const message = reasoningRequests[0];
      expect(tryStaleRerunGuard({ message, freshness }).matched).toBe(false);
      expect(tryPostAnalysisAdviceGate({
        message,
        freshness,
        analysis: {
          status: 'success',
          leading_option: { label: 'Increase price' },
          runner_up: { label: 'Hold price' },
          top_drivers: [],
          fragile_edges: [],
        },
      }).matched).toBe(false);
    },
  );

  it.each([
    'Tell me what you kept from my brief.',
    'Which of my figures do you use?',
    'What did you leave out of my brief?',
    'Do you agree you left out my ARR figure?',
  ])('still answers the explicit factual audit %j', (message) => {
    const outcome = tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit });
    expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
    expect(outcome.matched && outcome.assistant_text).toContain('£11.2m');
  });

  it.each([
    undefined,
    { briefText: null, graph: WITNESS_GRAPH },
    { briefText: BRIEF_TEXT, graph: null },
  ])('does not manufacture an audit when its source is unavailable: %j', (source) => {
    expect(tryStateQueryGuard({
      message: 'What did you leave out of my brief?',
      contextPack: ctx([]),
      briefAudit: source,
    })).toEqual({ matched: false });
  });

  it('does not swallow an edit attached to an audit', () => {
    const message = 'What did you leave out of my brief? Also set Enterprise ACV target to 45000.';
    expect(tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit })).toEqual({ matched: false });
    expect(hasMutationWarrantSignal(message)).toBe(true);
  });

  it.each(['Yes, confirm it.', 'No, cancel that.', 'Do not save that change.'])(
    'does not acquire ownership of a consent turn: %j',
    (message) => {
      expect(tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit })).toEqual({ matched: false });
    },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// RED — the questions the evaluation measured being intercepted
// ───────────────────────────────────────────────────────────────────────────

/**
 * The A/B's own three questions. Row 2 and row 3 already reached reasoning at
 * pristine and are here as the CONTRAST CONTROL: if all three pass because the
 * guard has been disabled wholesale rather than narrowed, the TWIN blocks below
 * go red.
 */
const AB_QUESTIONS: readonly (readonly [string, string])[] = [
  ['A/B row 1 — intercepted at pristine', 'Do you actually disagree with anything I said?'],
  ['A/B row 2 — reached reasoning at pristine', 'Argue the opposite case as strongly as you can.'],
  [
    'A/B row 3 — reached reasoning at pristine',
    'What is the most important thing my framing has missed?',
  ],
];

/** Challenge phrasings around row 1 — what a colleague types next. */
const CHALLENGE_QUESTIONS: readonly string[] = [
  'Do you actually disagree with anything I said?',
  'Have you pushed back on anything I said?',
  'Do you agree with everything I said, or not?',
  'Would you challenge anything I told you?',
  'Do you buy the argument I made about unit cost?',
  'Are you convinced by what I wrote?',
];

/**
 * Reasoning about a named element on screen — reported failing 8 times out of
 * 8, every reply a provenance disclaimer.
 */
const ELEMENT_REASONING_QUESTIONS: readonly string[] = [
  'Why is Enterprise ACV target in the model, and how confident are you in it?',
  'What is Enterprise ACV target based on, and how much should I trust it?',
  'Why is there a hybrid option, and is it actually credible?',
  'Why did you add the Hybrid Phased Approach, and do you stand by it?',
];

describe('RED — a request for our judgement is not claimed by a deterministic arm', () => {
  for (const [label, message] of AB_QUESTIONS) {
    it(`${label}: reaches the reasoning layer`, () => {
      const outcome = tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit });
      expect(outcome.matched).toBe(false);
    });
  }

  for (const message of CHALLENGE_QUESTIONS) {
    it(`challenge — no arm claims ${JSON.stringify(message)}`, () => {
      expect(asksForOwnJudgement(message)).toBe(true);
      // With and without recorded session edits: the discriminator keys on the
      // QUESTION, never on whether edits happen to exist.
      expect(
        tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched,
      ).toBe(false);
      expect(
        tryStateQueryGuard({
          message,
          contextPack: ctx([ADD_CONSTRAINT_50K]),
          briefAudit,
        }).matched,
      ).toBe(false);
    });
  }

  for (const message of ELEMENT_REASONING_QUESTIONS) {
    it(`element reasoning — no 67-character provenance stub for ${JSON.stringify(message)}`, () => {
      expect(asksForOwnJudgement(message)).toBe(true);
      expect(
        tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched,
      ).toBe(false);
      expect(
        tryStateQueryGuard({
          message,
          contextPack: ctx([ADD_CONSTRAINT_50K]),
          briefAudit,
        }).matched,
      ).toBe(false);
    });
  }

  it('the intercepted A/B row was genuinely intercepted at pristine (the RED is real, not a phrasing artefact)', () => {
    // `isBriefAuditQuestion` is UNCHANGED by this fix — it still classifies the
    // disagreement question, which is what keeps the mutation warrant denied.
    // The change is only that the ANSWERING arm no longer claims it.
    expect(isBriefAuditQuestion('Do you actually disagree with anything I said?')).toBe(true);
    expect(
      isStructureOriginQuestion(
        'Why is Enterprise ACV target in the model, and how confident are you in it?',
      ),
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TWIN 1 — the arms still answer the questions they were written for
// ───────────────────────────────────────────────────────────────────────────

describe('TWIN — the brief-audit arm is not disabled', () => {
  /** Verbatim from `496a89d9-T4C_EXCLUDED.json` via the brief-audit suite. */
  const CAPTURED_EXCLUDED_QUESTION =
    'Which parts of my brief did you leave out of the model, and which numbers ' +
    'did you change or reinterpret?';

  const STILL_AUDITED: readonly string[] = [
    CAPTURED_EXCLUDED_QUESTION,
    'What did you keep from my brief and what did you leave out?',
    'Which of my figures do you use?',
    'What did you add or infer yourself?',
  ];

  for (const message of STILL_AUDITED) {
    it(`still dispatches brief_audit for ${JSON.stringify(message.slice(0, 48))}…`, () => {
      const outcome = tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit });
      expect(outcome.matched).toBe(true);
      expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
    });
  }

  /**
   * ⭐ THE SECOND CONJUNCT'S OWN TWIN. A judgement request that ALSO attributes
   * a handling action to us leaves something for the manifest to report, so the
   * decline must NOT fire. Without `hasDispositionVerb` this row goes red.
   */
  it('a judgement request carrying a disposition verb KEEPS its manifest answer', () => {
    const message = 'Do you agree you left out my ARR figure?';
    expect(asksForOwnJudgement(message)).toBe(true);
    const outcome = tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit });
    expect(outcome.matched).toBe(true);
    expect(outcome.matched && outcome.dispatch).toBe('brief_audit');
  });
});

describe('TWIN — the structure-origin arm is not disabled', () => {
  /** Verbatim journey witness, deployed CEE `585f8dce`, turn 2. */
  const WITNESS_TURN_2 =
    'Why did you add a hybrid phased option? I never mentioned one — where did that come from?';

  it('the witnessed origin question is still answered from provenance', () => {
    const outcome = tryStateQueryGuard({
      message: WITNESS_TURN_2,
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('structure_origin');
    expect(outcome.assistant_text).toContain(
      'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
    );
  });

  it('a bare existential origin question is still claimed', () => {
    const outcome = tryStateQueryGuard({
      message: 'Why is there a Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)?',
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(outcome.matched && outcome.dispatch).toBe('structure_origin');
  });
});

describe('TWIN — the session-edit readback arms are untouched', () => {
  it('"Did you add the cost constraint?" still gets the recent-change readback', () => {
    const outcome = tryStateQueryGuard({
      message: 'Did you add the cost constraint?',
      contextPack: ctx([ADD_CONSTRAINT_50K]),
    });
    expect(outcome.matched && outcome.dispatch).toBe('with_recent_change');
  });

  it('"What changed?" is untouched', () => {
    const outcome = tryStateQueryGuard({
      message: 'What changed?',
      contextPack: ctx([ADD_CONSTRAINT_50K]),
    });
    expect(outcome.matched && outcome.dispatch).toBe('with_recent_change');
  });

  it('"Did you add it?" with no recorded edits still gets the honest absence copy', () => {
    const outcome = tryStateQueryGuard({ message: 'Did you add it?', contextPack: ctx([]) });
    expect(outcome.matched && outcome.dispatch).toBe('no_recent_changes');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TWIN 2 — THE ONE THAT MATTERS: a genuine edit still edits
// ───────────────────────────────────────────────────────────────────────────

/**
 * Misrouting a question to reasoning costs an answer instead of a stub.
 * Misrouting an EDIT to reasoning loses the user's edit. These rows are the
 * opposite-direction twins for every MUST-REASON row above.
 */
const GENUINE_EDITS: readonly string[] = [
  'Change the Enterprise ACV target to 45000',
  'Add a factor for regulatory risk',
  'Set churn to 5%',
  'Remove the hybrid option',
  'Update Total cost to 2.4m',
  'Increase the budget to 100000',
];

describe('TWIN — a genuine edit is still routed to the edit path', () => {
  for (const message of GENUINE_EDITS) {
    it(`${JSON.stringify(message)} keeps its mutation warrant and is not claimed by the guard`, () => {
      // The warrant is what authorises the write. It must survive this change.
      expect(hasMutationWarrantSignal(message)).toBe(true);
      // No answering arm may intercept it.
      expect(
        tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched,
      ).toBe(false);
      expect(
        tryStateQueryGuard({
          message,
          contextPack: ctx([ADD_CONSTRAINT_50K]),
          briefAudit,
        }).matched,
      ).toBe(false);
      // And `route-v2`'s own edit door still recognises it.
      expect(isEditRequestShape(message)).toBe(true);
    });
  }

  /**
   * ⭐ A COMPOUND TURN — a judgement request WITH a real edit riding it. The
   * edit half must survive. The existing `FRESH_EDIT_BAIL_OUT_PATTERNS` already
   * declines these; this row pins that the new decline did not displace it, and
   * that the warrant is intact either way.
   */
  it('a judgement request carrying a real edit keeps the edit', () => {
    const message =
      'Do you disagree with anything I said? Also set Enterprise ACV target to 45000.';
    expect(hasMutationWarrantSignal(message)).toBe(true);
    expect(
      tryStateQueryGuard({ message, contextPack: ctx([]), briefAudit }).matched,
    ).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// STRUCTURAL TWIN — the protective predicate is NOT narrowed
// ───────────────────────────────────────────────────────────────────────────

/**
 * `isStateQueryQuestionShape` is the protective half: it DENIES a mutation
 * warrant and SUPPRESSES `edit_graph` dispatch. Widening the reasoning
 * catchment must not narrow it, or a question could start editing the thing it
 * asks about.
 *
 * Values recorded by execution at pristine `de254398` before the fix. Every row
 * that reads `true` here is a question the router still refuses to turn into an
 * edit — including the ones that now reach the reasoning layer.
 */
const PROTECTION_PRISTINE: readonly (readonly [string, boolean])[] = [
  ['Do you actually disagree with anything I said?', true],
  ['Have you pushed back on anything I said?', true],
  ['Do you agree with everything I said, or not?', true],
  ['Why is Enterprise ACV target in the model, and how confident are you in it?', true],
  ['What is Enterprise ACV target based on, and how much should I trust it?', true],
  ['Why is there a hybrid option, and is it actually credible?', true],
  ['Argue the opposite case as strongly as you can.', false],
  ['What is the most important thing my framing has missed?', false],
  ['What did you keep from my brief and what did you leave out?', true],
  ['Why did you add a hybrid phased option? I never mentioned one.', true],
  ['What changed?', true],
  ['Did you change it?', true],
  ['Change the Enterprise ACV target to 45000', false],
  ['Add a factor for regulatory risk', false],
  ['Set churn to 5%', false],
  ['Remove the hybrid option', false],
];

describe('PROTECTION UNCHANGED — the edit-suppression predicate is byte-identical', () => {
  for (const [message, pristine] of PROTECTION_PRISTINE) {
    it(`isStateQueryQuestionShape(${JSON.stringify(message.slice(0, 44))}…) === ${pristine}`, () => {
      expect(isStateQueryQuestionShape(message)).toBe(pristine);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// The predicate's own negative direction
// ───────────────────────────────────────────────────────────────────────────

describe('asksForOwnJudgement does not fire on ordinary edits or readbacks', () => {
  const NOT_JUDGEMENT: readonly string[] = [
    ...GENUINE_EDITS,
    'What changed?',
    'Did you change it?',
    'What did you keep from my brief and what did you leave out?',
    'Why did you add a hybrid phased option? I never mentioned one.',
    'Where did that come from?',
    // The user asserting their OWN view is not a request for ours.
    'I disagree with the framing and I think the unit cost is wrong.',
    // A declarative about reliability is not a request to appraise one.
    'The ARR figure is reliable.',
  ];

  for (const message of NOT_JUDGEMENT) {
    it(`false for ${JSON.stringify(message.slice(0, 48))}…`, () => {
      expect(asksForOwnJudgement(message)).toBe(false);
    });
  }
});
