/**
 * Mutation-language detector — unit tests.
 */

import { describe, expect, it } from 'vitest';

import {
  containsMutationLanguage,
  containsStructuralSuccessClaim,
  containsBroadStructuralClaimLanguage,
  looksLikeAmbiguousEdgeClaim,
  mentionsStructuralEditRequest,
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

describe('containsStructuralSuccessClaim — MUST MATCH (first-person mutation verb + structural noun)', () => {
  const mustMatch: ReadonlyArray<readonly [string, string]> = [
    [
      'verbatim E1 capture',
      'I\'ll add the "Coach Internal Developer into Tech Lead Role" option to your model now, connecting it to the relevant factors as discussed.',
    ],
    ['present-perfect completion', "I've added the Coach option."],
    // Claims anchored to an UNAMBIGUOUS structural noun (option/factor/node/
    // edge/driver/constraint) swap unconditionally. Edge nouns (link/connection/
    // relationship/dependency) are ambiguous and intent-gated (see classify
    // tests); they still swap here when an unambiguous noun is also present.
    ['edge claim w/ factor anchor', 'I wired a dependency from the budget factor.'],
    ['edge claim w/ factors anchor', 'I removed the relationship between the two factors.'],
    ['past-tense graph edit', 'I updated the graph.'],
    ['past-tense model edit', 'I changed the model.'],
    ['option to your model (graph target, not excluded)', 'I added an option to your model.'],
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
    // Read-only current-state descriptions (Brief 4 review / Gemini HIGH) — must
    // be preserved on no-mutation turns; actorless "model now …" no longer swaps
    // at all (incl. includes/contains).
    ['read-out — model now has count', 'Your model now has four options.'],
    ['read-out — model now supports', 'Your model now supports a comparison of the options.'],
    ['read-out — model now shows', 'Your model now shows three factors and one goal.'],
    ['read-out — model now contains count', 'The model now contains three factors and two options.'],
    ['read-out — model now includes existing', 'Your model now includes four existing options.'],
    // Idioms / people — edge VERBS without a structural noun must not swap
    // (review round 3). These are surfaced by the monitor, never declined.
    ['idiom — drew a distinction', 'I drew a distinction between Cost and Revenue.'],
    ['idiom — connected the dots', 'I connected the dots between cost and growth.'],
    ['people — connected Alice with Bob', 'I connected Alice with Bob.'],
    ['people — joined teams for a workshop', 'I joined Marketing and Sales for the workshop.'],
    ['conversational connect with people', "I'll connect you with the team later."],
    // Review round 6 — ambiguous edge nouns must NOT swap unconditionally:
    // doc links and social/team connections are not graph edits.
    ['doc link — created a link to docs', 'I created a link to the documentation.'],
    ['social — established a connection with team', 'I established a connection with the team.'],
    // Review round 7 — non-graph context (presentation/documentation) must NOT
    // swap even with an unambiguous noun ("option to the presentation") or the
    // graph/model compound ("model documentation").
    ['non-graph — option to the presentation', 'I added an option to the presentation.'],
    ['non-graph — model documentation', 'I updated the model documentation.'],
    ['non-graph — model presentation', 'I changed the model presentation.'],
    // Round 8 — possessive compound + qualified PP.
    ["non-graph — model's documentation (possessive)", "I updated the model's documentation."],
    ['non-graph — option called "Draft" to the presentation', 'I added an option called "Draft" to the presentation.'],
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
      "I haven't changed the model. This version can't make that kind of model edit yet.",
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

describe('classifyStructuralClaim — intent-gated honesty decision', () => {
  const NARROW = 'I have added the Coach option.'; // first-person + structural noun
  const NOUNLESS_EDGE = 'I connected Marketing to Revenue.'; // broad, noun-less
  const ACTORLESS_STATE = 'Your model now includes the Coach option.'; // broad, actorless
  const ADVISORY = "I'd suggest adding a competitive risk factor."; // mutation-language only
  const BENIGN = 'Here are the trade-offs.';
  const base = { handlerEmittedMutatedGraph: false, proposedHandlerId: null as string | null };

  it('narrow first-person + structural-noun claim → swap (high_confidence), intent irrelevant', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: NARROW })).toEqual({ verdict: 'swap', kind: 'high_confidence' });
    expect(classifyStructuralClaim({ ...base, assistantText: NARROW, structuralEditIntent: true })).toEqual({ verdict: 'swap', kind: 'high_confidence' });
  });

  // Blocking #1/#3 — noun-less edges + verb synonyms now SWAP when the user
  // asked for a structural edit (intent), instead of merely being logged.
  it('broad noun-less edge claim + structural-edit intent → swap (intent_gated)', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: NOUNLESS_EDGE, structuralEditIntent: true }))
      .toEqual({ verdict: 'swap', kind: 'intent_gated' });
    expect(classifyStructuralClaim({ ...base, assistantText: 'I connected marketing to revenue.', structuralEditIntent: true }).verdict).toBe('swap');
  });
  it('verb-synonym claims (introduced/incorporated/made/included) + intent → swap', () => {
    for (const t of [
      'I introduced a new option to the model.',
      'I incorporated a risk factor into the model.',
      'I have made a connection between cost and growth.',
      'I included a new dependency in the graph.',
    ]) {
      expect(classifyStructuralClaim({ ...base, assistantText: t, structuralEditIntent: true }).verdict).toBe('swap');
    }
  });
  // Blocking #2 — actorless state-success is caught under intent, surfaced (not
  // silent) without intent.
  it('actorless "model now includes X" → swap under intent, monitor without', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: ACTORLESS_STATE, structuralEditIntent: true }).verdict).toBe('swap');
    expect(classifyStructuralClaim({ ...base, assistantText: ACTORLESS_STATE }).verdict).toBe('monitor');
  });

  // Round-6 blocker 2 — PASSIVE structural success ("the option has been added",
  // "the relationship is now in place") swaps under intent, monitored without.
  it('passive structural success (incl. change/update verbs) → swap under intent, monitor without', () => {
    for (const t of [
      'The option has been added.',
      'The factor has been changed.',
      'A new option was created.',
      'The option has now been updated.',
    ]) {
      expect(classifyStructuralClaim({ ...base, assistantText: t, structuralEditIntent: true }).verdict).toBe('swap');
      expect(classifyStructuralClaim({ ...base, assistantText: t }).verdict).toBe('monitor');
    }
  });

  // Round-6 blocker 3 — ambiguous edge nouns swap under intent, but are NEVER
  // unconditionally swapped (doc links / social connections preserved).
  it('edge-noun claims (link/connection) → swap under intent, never unconditionally', () => {
    for (const t of [
      'I created a link between Marketing and Revenue.',
      'I added a connection from Marketing to Revenue.',
      'I set up a connection between cost and growth.',
    ]) {
      expect(classifyStructuralClaim({ ...base, assistantText: t, structuralEditIntent: true }).verdict).toBe('swap');
    }
  });
  it('ambiguous doc link / social connection WITHOUT intent are NOT swapped', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: 'I created a link to the documentation.' }).verdict).not.toBe('swap');
    expect(classifyStructuralClaim({ ...base, assistantText: 'I established a connection with the team.' }).verdict).not.toBe('swap');
  });

  // Round-8 blocker 2 — passive edge claims are MONITOR-ONLY (never swap, even
  // under intent), but must produce candidate telemetry (not silent pass).
  it('passive edge claim → monitor/ambiguous_edge, never swap (even under intent)', () => {
    for (const t of [
      'The relationship has been changed.',
      'The connection is now in place.',
      'A new dependency was created.',
      'The link has been added.',
    ]) {
      expect(classifyStructuralClaim({ ...base, assistantText: t })).toEqual({ verdict: 'monitor', kind: 'ambiguous_edge' });
      expect(classifyStructuralClaim({ ...base, assistantText: t, structuralEditIntent: true }).verdict).toBe('monitor');
    }
  });

  it('broad claim WITHOUT intent → monitor (broad_no_intent), never swap', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: NOUNLESS_EDGE }))
      .toEqual({ verdict: 'monitor', kind: 'broad_no_intent' });
  });

  // No false declines: idioms / people / read-outs WITHOUT structural-edit
  // intent are never swapped (monitored at most).
  it('idioms / people / read-outs without intent are NOT swapped', () => {
    for (const t of [
      'I drew a distinction between Cost and Revenue.',
      'I connected the dots between cost and growth.',
      'I connected Alice with Bob.',
      'The model now contains three factors and two options.',
      'Your model now has four options.',
    ]) {
      expect(classifyStructuralClaim({ ...base, assistantText: t }).verdict).not.toBe('swap');
    }
  });
  // Advisory ("I'd suggest adding") is never swapped — even under intent — because
  // the broad detector requires the verb to follow the first-person pronoun.
  it('advisory "I\'d suggest adding" → monitor even under intent (never swap)', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: ADVISORY, structuralEditIntent: true }).verdict).toBe('monitor');
  });

  // Codex blocker 3 — conditional advice ("I would add … if …") is NOT a success
  // claim and must never swap, even when the user requested a structural edit.
  it('conditional advice ("I would add … if …") is never swapped, even under intent', () => {
    for (const t of [
      'I would add a risk factor if we needed more sensitivity.',
      "I'd add another option if you wanted to explore that.",
      'I would include a dependency in a fuller model.',
    ]) {
      expect(classifyStructuralClaim({ ...base, assistantText: t, structuralEditIntent: true }).verdict).not.toBe('swap');
    }
  });
  it('high-confidence success claims still swap (not weakened by the conditional fix)', () => {
    for (const t of ["I've added the option.", 'I added a risk factor.', 'I updated the model.']) {
      expect(classifyStructuralClaim({ ...base, assistantText: t }).verdict).toBe('swap');
    }
  });
  it('benign prose → pass', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: BENIGN }).verdict).toBe('pass');
  });

  // Reverse-trust: a REAL mutation is never swapped, even with a claim + intent.
  it('scalar mutation (handlerEmittedMutatedGraph=true) → pass [covers all D1 handlers]', () => {
    expect(classifyStructuralClaim({ assistantText: NARROW, handlerEmittedMutatedGraph: true, proposedHandlerId: 'set_factor_value', structuralEditIntent: true }).verdict).toBe('pass');
  });
  it('draft_graph / edit_graph (isDraftOrEditGraph) → pass', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: NARROW, proposedHandlerId: 'draft_graph' }).verdict).toBe('pass');
    expect(classifyStructuralClaim({ ...base, assistantText: NARROW, proposedHandlerId: 'edit_graph' }).verdict).toBe('pass');
  });
  it('NO handler_id skip: non-mutating handler_id + narrow claim still swaps', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: NARROW, proposedHandlerId: 'explain_results' }).verdict).toBe('swap');
  });
  it('empty / nullish text → pass', () => {
    expect(classifyStructuralClaim({ ...base, assistantText: '' }).verdict).toBe('pass');
    expect(classifyStructuralClaim({ ...base, assistantText: undefined }).verdict).toBe('pass');
  });
});

describe('containsBroadStructuralClaimLanguage — broad (intent-gated) detector', () => {
  it('flags edit verbs, synonyms, actorless state-now, and between/and edges', () => {
    expect(containsBroadStructuralClaimLanguage('I connected Marketing to Revenue.')).toBe(true);
    expect(containsBroadStructuralClaimLanguage('I introduced a new option.')).toBe(true);
    expect(containsBroadStructuralClaimLanguage('I have made a connection between cost and growth.')).toBe(true);
    expect(containsBroadStructuralClaimLanguage('Your model now includes the Coach option.')).toBe(true);
  });
  it('does not flag plain prose', () => {
    expect(containsBroadStructuralClaimLanguage('Here are the trade-offs.')).toBe(false);
    expect(containsBroadStructuralClaimLanguage('')).toBe(false);
  });
});

describe('looksLikeAmbiguousEdgeClaim — monitor-only passive edge detector', () => {
  it('flags passive edge claims (link/connection/relationship/dependency)', () => {
    expect(looksLikeAmbiguousEdgeClaim('The relationship has been changed.')).toBe(true);
    expect(looksLikeAmbiguousEdgeClaim('The connection is now in place.')).toBe(true);
    expect(looksLikeAmbiguousEdgeClaim('A new dependency was created.')).toBe(true);
  });
  it('does not flag structural-noun passives or plain prose', () => {
    expect(looksLikeAmbiguousEdgeClaim('The option has been added.')).toBe(false); // structural → handled elsewhere
    expect(looksLikeAmbiguousEdgeClaim('The team has been notified.')).toBe(false);
    expect(looksLikeAmbiguousEdgeClaim('')).toBe(false);
  });
});

describe('mentionsStructuralEditRequest — user structural-edit intent', () => {
  it('detects request-shaped structural edits (add/create/remove + noun, "new <noun>")', () => {
    expect(mentionsStructuralEditRequest('Add an option called Coach.')).toBe(true);
    expect(mentionsStructuralEditRequest('1. A new option, "Coach Internal Developer into Tech Lead Role"')).toBe(true);
    expect(mentionsStructuralEditRequest('remove the churn factor')).toBe(true);
    expect(mentionsStructuralEditRequest('I want to add a factor')).toBe(true);
  });

  // Codex blocker 4 — edit/change/update/modify on a structural noun or the
  // graph/model must create intent.
  it('detects edit/change/update/modify requests (structural noun or graph/model)', () => {
    expect(mentionsStructuralEditRequest('Edit the option')).toBe(true);
    expect(mentionsStructuralEditRequest('Change the churn factor')).toBe(true);
    expect(mentionsStructuralEditRequest('Modify the node')).toBe(true);
    expect(mentionsStructuralEditRequest('Update the model to include a new option')).toBe(true);
    expect(mentionsStructuralEditRequest('Please update the model')).toBe(true);
  });

  // Review round 7 — ambiguous edge-noun requests no longer create intent
  // ("between … and" can't tell graph labels from people/docs). Deferred to #289.
  it('does NOT create intent for ambiguous edge-noun requests (deferred to #289)', () => {
    expect(mentionsStructuralEditRequest('Add a relationship between Cost and Growth')).toBe(false);
    expect(mentionsStructuralEditRequest('Create a dependency between Cost and Growth')).toBe(false);
    expect(mentionsStructuralEditRequest('Set up a connection between Cost and Growth')).toBe(false);
    expect(mentionsStructuralEditRequest('Create a relationship between Alice and Bob')).toBe(false);
    expect(mentionsStructuralEditRequest('Add a link between the release notes and the documentation')).toBe(false);
  });

  // Codex blocker 1 — request-shaped questions still create intent.
  it('request-shaped questions create intent', () => {
    expect(mentionsStructuralEditRequest('Can you add an option?')).toBe(true);
    expect(mentionsStructuralEditRequest('Could you remove the churn factor?')).toBe(true);
  });

  // Review round 7/8 — non-graph compound / possessive / qualified-PP / new-noun
  // targets do NOT create intent.
  it('does NOT create intent for non-graph documentation/presentation targets', () => {
    expect(mentionsStructuralEditRequest('Please update the model documentation.')).toBe(false);
    expect(mentionsStructuralEditRequest('Change the model presentation.')).toBe(false);
    expect(mentionsStructuralEditRequest('Can you add an option to the presentation?')).toBe(false);
    // round 8 — possessive compound, "new <noun>" PP, and qualified PP.
    expect(mentionsStructuralEditRequest("Please update the model's documentation.")).toBe(false);
    expect(mentionsStructuralEditRequest('Add a new option to the presentation.')).toBe(false);
    expect(mentionsStructuralEditRequest('Add an option called "Draft" to the presentation')).toBe(false);
    // …but genuine graph targets still do.
    expect(mentionsStructuralEditRequest('Add an option to your model')).toBe(true);
    expect(mentionsStructuralEditRequest('Add a new option to the model')).toBe(true);
  });

  // Codex blocker 1 — state/read-out questions must NOT create intent,
  // including POSSESSIVE forms (review round 6: "does your/my/our …").
  it('does NOT fire on state / read-out questions (incl. possessives)', () => {
    expect(mentionsStructuralEditRequest('Did you add an option?')).toBe(false);
    expect(mentionsStructuralEditRequest('Have you added a factor?')).toBe(false);
    expect(mentionsStructuralEditRequest('Did you update the model?')).toBe(false);
    expect(mentionsStructuralEditRequest('Is the option now included?')).toBe(false);
    expect(mentionsStructuralEditRequest('Does your model include an option?')).toBe(false);
    expect(mentionsStructuralEditRequest('Has your model got a churn factor?')).toBe(false);
    expect(mentionsStructuralEditRequest('Do our nodes include a driver?')).toBe(false);
  });

  // Codex blocker 2 — people / workflow connection requests must NOT create intent.
  it('does NOT fire on social / workflow connection requests', () => {
    expect(mentionsStructuralEditRequest('Can you connect Alice with Bob?')).toBe(false);
    expect(mentionsStructuralEditRequest('Please connect me with the team')).toBe(false);
    expect(mentionsStructuralEditRequest('Can you connect us with Marketing?')).toBe(false);
  });

  it('does NOT fire on read-only questions, scalar edits, noun-less or non-graph edge requests', () => {
    expect(mentionsStructuralEditRequest('what do I have so far?')).toBe(false);
    expect(mentionsStructuralEditRequest('summarise the model')).toBe(false);
    expect(mentionsStructuralEditRequest('set the budget to 5')).toBe(false);
    expect(mentionsStructuralEditRequest('connect Marketing to Revenue')).toBe(false); // noun-less → #289
    expect(mentionsStructuralEditRequest('add a link to the documentation')).toBe(false); // doc link, no "between … and"
    expect(mentionsStructuralEditRequest('')).toBe(false);
  });
});
