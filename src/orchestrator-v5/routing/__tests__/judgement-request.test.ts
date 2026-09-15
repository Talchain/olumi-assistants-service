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
