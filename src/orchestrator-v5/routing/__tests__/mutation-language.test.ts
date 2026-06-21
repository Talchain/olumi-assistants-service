/**
 * Mutation-language detector — unit tests.
 */

import { describe, expect, it } from 'vitest';

import {
  containsMutationLanguage,
  containsStructuralSuccessClaim,
  classifyStructuralClaim,
  V5_STRUCTURAL_DECLINE_TEXT,
} from '../mutation-language.js';

describe('containsMutationLanguage', () => {
  it('detects "Proposing to add X" — the canonical staging-incident phrase', () => {
    // Verbatim staging incident phrase: an explain_from_structure turn
    // produced "Proposing to add a competitive response risk factor..." and
    // the user believed a graph mutation was being made.
    expect(
      containsMutationLanguage(
        'Proposing to add a competitive response risk factor to capture market dynamics.',
      ),
    ).toBe(true);
  });

  it('detects first-person commitment phrases ("I\'ll set", "I\'ll change", "I will update")', () => {
    expect(containsMutationLanguage("I'll set the budget to 300k.")).toBe(true);
    expect(containsMutationLanguage("I'll change the engineering capacity factor.")).toBe(true);
    expect(containsMutationLanguage('I will update the model.')).toBe(true);
    expect(containsMutationLanguage("I'd like to add a hiring constraint.")).toBe(true);
  });

  it('detects "adding/updating/removing the X" action-in-progress phrasing', () => {
    expect(containsMutationLanguage('Adding the engineering factor would help.')).toBe(true);
    expect(containsMutationLanguage('Updating the budget value to 250k.')).toBe(true);
    expect(containsMutationLanguage('Removing the Q3 deadline factor.')).toBe(true);
  });

  it('detects "I\'d suggest adding/updating" framing', () => {
    expect(containsMutationLanguage("I'd suggest adding a calibration step.")).toBe(true);
    expect(containsMutationLanguage('I would suggest updating the link strength.')).toBe(true);
  });

  it('returns false for benign explanation prose with no mutation language', () => {
    const benign = [
      'Engineering Capacity has the strongest causal footprint across your goal at 0.65 strength.',
      'The leading option performs best because of the combined effect of three factors.',
      'Looking at the model structure, the strongest direct link is from Capacity to Throughput.',
      'Probability sits at 62 per cent with a stable robustness band; the runner-up trails by twelve points.',
      'No analysis has been run on your model yet. Your model has 4 options set up and is ready to analyse.',
    ];
    for (const text of benign) {
      expect(containsMutationLanguage(text)).toBe(false);
    }
  });

  it('returns false for empty / non-string input', () => {
    expect(containsMutationLanguage('')).toBe(false);
    // Defensive against caller bugs — runtime types may diverge from TS.
    expect(containsMutationLanguage(undefined as unknown as string)).toBe(false);
    expect(containsMutationLanguage(null as unknown as string)).toBe(false);
  });

  it('is case-insensitive on the patterns it matches', () => {
    expect(containsMutationLanguage('PROPOSING TO ADD a factor')).toBe(true);
    expect(containsMutationLanguage("i'll set the value")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Brief 4 — narrow structural-success-claim detector (the ENFORCING gate's
// detector). Conservative: catches first-person success / commitment /
// completion claims anchored to a graph object, plus "model now" state
// assertions; preserves advisory / offer / benign-pronoun phrasing.
// ---------------------------------------------------------------------------

// E1 contract oracle — VERBATIM from the red-eval pack, used to prove the
// decline copy carries no success leak.
const E1_SUCCESS_CLAIM: readonly RegExp[] = [
  /\bI['’]?ll add\b/i,
  /\bI['’]?ve added\b/i,
  /\bI have added\b/i,
  /add(?:ing|ed)?\b[^.]*\boption\b[^.]*\bnow\b/i,
  /\boption\b[^.]*\bto your model now\b/i,
];

describe('containsStructuralSuccessClaim — MUST MATCH (first-person / completion / state-now)', () => {
  const mustMatch: ReadonlyArray<readonly [string, string]> = [
    [
      'verbatim E1 capture',
      'I\'ll add the "Coach Internal Developer into Tech Lead Role" option to your model now, connecting it to the relevant factors as discussed.',
    ],
    ['present-perfect completion', "I've added the Coach option."],
    ['"I have added it to the model"', 'I have added it to the model.'],
    ['state-now includes', 'Your model now includes the Coach option.'],
    ['state-now has', 'The model now has three options.'],
    ['past-tense graph edit', 'I updated the graph.'],
    ['past-tense model edit', 'I changed the model.'],
    ['future commitment + factor', "I'll add a factor for that."],
    ['"let me add the option"', 'Let me add the option.'],
    ['present-continuous + option', "I'm adding the option now."],
  ];
  for (const [name, text] of mustMatch) {
    it(`matches: ${name}`, () => {
      expect(containsStructuralSuccessClaim(text)).toBe(true);
    });
  }
});

describe('containsStructuralSuccessClaim — MUST NOT MATCH (advisory / offer / benign)', () => {
  const mustNotMatch: ReadonlyArray<readonly [string, string]> = [
    ['advisory "you could add"', 'You could add an option called Coach.'],
    ['advisory "I\'d suggest adding"', "I'd suggest adding a competitive risk factor."],
    ['advisory "I suggest adding"', 'I suggest adding a factor.'],
    ['offer / question', 'Would you like me to add the Coach option?'],
    ['non-graph commitment', "I'll update you on the results."],
    ['non-graph completion', 'I added a note about timing.'],
    ['benign pronoun to notes', "I'll add that to my notes."],
    ['conditional pronoun, no graph ref', "I'll add it once you confirm."],
    ['greeting', 'Hello, how can I help?'],
    ['plain prose', 'Here are the trade-offs between the options.'],
    ['empty', ''],
  ];
  for (const [name, text] of mustNotMatch) {
    it(`does not match: ${name}`, () => {
      expect(containsStructuralSuccessClaim(text)).toBe(false);
    });
  }

  it('returns false on non-string input', () => {
    expect(containsStructuralSuccessClaim(undefined as unknown as string)).toBe(false);
    expect(containsStructuralSuccessClaim(null as unknown as string)).toBe(false);
  });
});

describe('V5_STRUCTURAL_DECLINE_TEXT — approved copy oracle (Brief 4 req #6)', () => {
  it('is exactly the approved copy (pins the integration-test literal)', () => {
    expect(V5_STRUCTURAL_DECLINE_TEXT).toBe(
      'I have not changed the model. I cannot make that kind of structural change to the model in this version.',
    );
  });
  it('carries no E1 success-claim token', () => {
    expect(E1_SUCCESS_CLAIM.some((p) => p.test(V5_STRUCTURAL_DECLINE_TEXT))).toBe(false);
  });
  it('does not itself trigger the detector (idempotent under re-evaluation)', () => {
    expect(containsStructuralSuccessClaim(V5_STRUCTURAL_DECLINE_TEXT)).toBe(false);
  });
  it('contains no em dash and no canvas-capability claim', () => {
    expect(V5_STRUCTURAL_DECLINE_TEXT).not.toContain('—');
    expect(V5_STRUCTURAL_DECLINE_TEXT.toLowerCase()).not.toContain('canvas');
  });
});

describe('classifyStructuralClaim — canonical mutation predicate (mirrors handlerEmittedMutatedGraph || isDraftOrEditGraph)', () => {
  const CLAIM = 'I have added the Coach option to the model.';
  const ADVISORY = "I'd suggest adding a competitive risk factor."; // broad-only
  const BENIGN = 'Here are the trade-offs.';

  it('no mutation + structural claim → swap', () => {
    expect(
      classifyStructuralClaim({ assistantText: CLAIM, handlerEmittedMutatedGraph: false, proposedHandlerId: null }),
    ).toBe('swap');
  });

  it('no mutation + broad-only language (advisory) → monitor (never swap)', () => {
    expect(
      classifyStructuralClaim({ assistantText: ADVISORY, handlerEmittedMutatedGraph: false, proposedHandlerId: null }),
    ).toBe('monitor');
  });

  it('no mutation + benign → pass', () => {
    expect(
      classifyStructuralClaim({ assistantText: BENIGN, handlerEmittedMutatedGraph: false, proposedHandlerId: null }),
    ).toBe('pass');
  });

  // Reverse-trust: a REAL mutation must never be swapped, even with a claim.
  it('scalar mutation (handlerEmittedMutatedGraph=true) + claim → pass [handler-agnostic: covers set_factor_value, add_constraint, adjust_edge_strength]', () => {
    expect(
      classifyStructuralClaim({ assistantText: CLAIM, handlerEmittedMutatedGraph: true, proposedHandlerId: 'set_factor_value' }),
    ).toBe('pass');
  });

  it('draft_graph (isDraftOrEditGraph) + claim → pass', () => {
    expect(
      classifyStructuralClaim({ assistantText: CLAIM, handlerEmittedMutatedGraph: false, proposedHandlerId: 'draft_graph' }),
    ).toBe('pass');
  });

  it('edit_graph (isDraftOrEditGraph) + claim → pass', () => {
    expect(
      classifyStructuralClaim({ assistantText: CLAIM, handlerEmittedMutatedGraph: false, proposedHandlerId: 'edit_graph' }),
    ).toBe('pass');
  });

  it('there is NO handler_id skip: a non-mutating handler_id with a claim still swaps', () => {
    // The deployed STEP 6.5 guard skipped when handler_id was null/edit; this
    // gate must NOT — the canonical failure had handler_id === null, and a
    // non-mutating registered handler (e.g. explain_results) that somehow
    // emitted a structural claim with no mutation must also swap.
    expect(
      classifyStructuralClaim({ assistantText: CLAIM, handlerEmittedMutatedGraph: false, proposedHandlerId: 'explain_results' }),
    ).toBe('swap');
  });

  it('empty / nullish text → pass', () => {
    expect(classifyStructuralClaim({ assistantText: '', handlerEmittedMutatedGraph: false, proposedHandlerId: null })).toBe('pass');
    expect(classifyStructuralClaim({ assistantText: undefined, handlerEmittedMutatedGraph: false, proposedHandlerId: null })).toBe('pass');
  });
});
