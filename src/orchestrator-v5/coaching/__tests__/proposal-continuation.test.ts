import { describe, expect, it } from 'vitest';

import {
  buildFactorAffectClarifierResponse,
  buildPendingActionsWithProposalCapture,
  buildProposalPendingAction,
  buildProposalStageOneResponse,
  decideProposalContinuation,
  detectsAddAsFactorIntent,
  detectsContinuationAgreement,
  extractProposedConcept,
  findProposedConceptAction,
  findProposedConceptEntry,
  isProposedConceptExpired,
  pickCandidateAffectLabels,
  resolveProposalResume,
} from '../proposal-continuation.js';

import type { PendingAction } from '../../session/pending-action.js';

const FORBIDDEN_USER_FACING_TOKENS = [
  /factor or edge/i,
  /\bnode\b/i,
  /\bedge\b/i,
  /\bgraph\b/i,
  /\bschema\b/i,
  /\bvalidator\b/i,
  /\bpatch\b/i,
];

function assertCleanUserCopy(text: string): void {
  for (const forbidden of FORBIDDEN_USER_FACING_TOKENS) {
    expect(forbidden.test(text), `text leaks forbidden token: ${text}`).toBe(false);
  }
}

describe('extractProposedConcept', () => {
  it('captures "would you like me to add X as a factor" with preferred_kind=factor', () => {
    const r = extractProposedConcept(
      'The most useful next step would be to add team morale or cultural fit as a factor.',
    );
    expect(r).not.toBeNull();
    expect(r?.concept).toBe('team morale or cultural fit');
    expect(r?.preferred_kind).toBe('factor');
  });

  it('captures "add X as a risk" with preferred_kind=risk', () => {
    const r = extractProposedConcept(
      'You might want to add stakeholder pushback as a risk to capture this.',
    );
    expect(r?.concept).toBe('stakeholder pushback');
    expect(r?.preferred_kind).toBe('risk');
  });

  it('captures "would you like me to add X" with preferred_kind=either', () => {
    const r = extractProposedConcept(
      'Would you like me to add onboarding pace? It looks important.',
    );
    expect(r?.concept).toBe('onboarding pace');
    expect(r?.preferred_kind).toBe('either');
  });

  it('captures "adding X to the model" with preferred_kind=either', () => {
    const r = extractProposedConcept(
      'Adding code review depth to the model would help.',
    );
    expect(r?.concept).toBe('code review depth');
    expect(r?.preferred_kind).toBe('either');
  });

  it('strips leading articles from captured concept', () => {
    const r = extractProposedConcept(
      'Would you like me to add the hiring pipeline depth as a factor?',
    );
    expect(r?.concept).toBe('hiring pipeline depth');
  });

  it('rejects ID-shaped concepts', () => {
    expect(extractProposedConcept('Add opt_123 as a factor')).toBeNull();
    expect(extractProposedConcept('Would you like me to add fac_team_morale')).toBeNull();
  });

  it('rejects concepts with fewer than 2 alphabetic characters', () => {
    // Defends against the non-greedy regex over-matching on a single
    // letter ("Add X as a factor" → "X") and against pure-digit
    // captures ("Add 42 as a factor" → "42").
    expect(extractProposedConcept('Add X as a factor')).toBeNull();
    expect(extractProposedConcept('Add 42 as a factor')).toBeNull();
  });

  it('rejects concepts containing internal vocabulary', () => {
    expect(extractProposedConcept('Add a validator node as a factor')).toBeNull();
    expect(extractProposedConcept('Adding the edge weight to the model')).toBeNull();
    expect(extractProposedConcept('Add a patch as a factor')).toBeNull();
    expect(extractProposedConcept('Add a graph cycle as a factor')).toBeNull();
  });

  it('rejects concepts containing egress-banned prescriptive vocabulary', () => {
    // These would trip the finaliser-level egress guard if reflected
    // verbatim into Stage 1 / Stage 2 chip messages.
    expect(extractProposedConcept('Add the recommended approach as a factor')).toBeNull();
    expect(extractProposedConcept('Add my recommendation as a factor')).toBeNull();
    expect(extractProposedConcept('Add the winner as a factor')).toBeNull();
    expect(extractProposedConcept('Add winning option logic as a factor')).toBeNull();
  });

  it('returns null on text with no proposal phrasing', () => {
    expect(extractProposedConcept('Run analysis and you will see the result.')).toBeNull();
    expect(extractProposedConcept('Team morale is important.')).toBeNull();
  });

  it('returns null on empty / non-string inputs', () => {
    expect(extractProposedConcept('')).toBeNull();
    expect(extractProposedConcept('   ')).toBeNull();
    expect(extractProposedConcept(null)).toBeNull();
    expect(extractProposedConcept(undefined)).toBeNull();
  });

  it('truncates concepts longer than 80 chars at the last word boundary', () => {
    const long = 'a'.repeat(50) + ' ' + 'b'.repeat(50);
    const r = extractProposedConcept(`Would you like me to add ${long}?`);
    expect(r).not.toBeNull();
    expect(r!.concept.length).toBeLessThanOrEqual(80);
  });

  // ─── PR #212 staging-smoke regression corpus ──────────────────────
  //
  // Each entry is real or near-real LLM output that the v1 extractor
  // either misclassified or over-captured. The expected concept is the
  // clean noun phrase a human would write into a chip message.

  it('staging smoke: chained Sonnet question truncates at "or would you rather"', () => {
    const prose =
      'This is a real risk. Would you like me to add a team sentiment or '
      + 'change resistance factor, or would you rather explore what\'s most '
      + 'likely to drive disengagement first?';
    const r = extractProposedConcept(prose);
    expect(r).not.toBeNull();
    expect(r!.concept).toBe('team sentiment or change resistance');
    // Trailing "factor" was stripped → preferred_kind comes from the
    // strip, not the pattern.
    expect(r!.preferred_kind).toBe('factor');
  });

  it('staging smoke: trailing kind word "factor" is stripped from the concept', () => {
    const r = extractProposedConcept(
      'Would you like me to add a team morale factor?',
    );
    expect(r?.concept).toBe('team morale');
    expect(r?.preferred_kind).toBe('factor');
  });

  it('staging smoke: trailing kind word "risk" is stripped from the concept', () => {
    const r = extractProposedConcept(
      'Would you like me to add a stakeholder pushback risk?',
    );
    expect(r?.concept).toBe('stakeholder pushback');
    expect(r?.preferred_kind).toBe('risk');
  });

  it('staging smoke: clause boundary "or would you rather" truncates without preceding comma', () => {
    const r = extractProposedConcept(
      'Would you like me to add team morale or would you rather explore engagement?',
    );
    expect(r?.concept).toBe('team morale');
  });

  it('staging smoke: clause boundary ", and X" truncates a chained continuation', () => {
    const r = extractProposedConcept(
      'Would you like me to add team morale, and would you also like to add cultural fit?',
    );
    expect(r?.concept).toBe('team morale');
  });

  it.each([
    "Would you like me to add team morale rather than something else?",
    "Would you like me to add what's most important to you?",
  ])('rejects concepts that retain question-tail vocab after truncation: %s', (prose) => {
    expect(extractProposedConcept(prose)).toBeNull();
  });

  it('rejects a concept ending in trailing question-tail "first"', () => {
    // No earlier clause boundary, so "first" survives truncation and
    // the trailing-anchored QUESTION_TAIL pattern rejects it.
    expect(extractProposedConcept('Would you like me to add team morale first?')).toBeNull();
  });

  it('preserves leading "first" in legitimate concepts (first-mover, first principles)', () => {
    // PR #216 review follow-up: a bare `\bfirst\b` reject would have
    // false-positively dropped these. The trailing-anchored pattern
    // preserves them.
    expect(extractProposedConcept('Would you like me to add first principles thinking?')?.concept)
      .toBe('first principles thinking');
    expect(extractProposedConcept('You should add first-mover advantage as a factor.')?.concept)
      .toBe('first-mover advantage');
  });

  it('preserves internal "first" ("time to first value")', () => {
    // PR #216 review NICE-TO-HAVE: trailing-anchored `first` reject does
    // not touch an internal "first".
    expect(extractProposedConcept('Would you like me to add time to first value?')?.concept)
      .toBe('time to first value');
  });

  // ─── PR #216 second-round review: bare kind-word rejection ────────
  it.each([
    'Would you like me to add a factor?',
    'Would you like me to add a risk?',
    'Would you like me to add a driver?',
    'Would you like me to add factors?',
  ])('rejects a concept that reduces to a bare kind word: %s', (prose) => {
    expect(extractProposedConcept(prose)).toBeNull();
  });

  // ─── PR #216 round-3 review: bare generic structural nouns ────────
  it.each([
    'Would you like me to add a goal?',
    'Would you like me to add an option?',
    'Would you like me to add an outcome?',
    'Would you like me to add a constraint?',
    'Would you like me to add a decision?',
    'Would you like me to add an objective?',
    'Would you like me to add an assumption?',
    'Would you like me to add a lever?',
    'Would you like me to add a scenario?',
    'Would you like me to add a criterion?',
    'Would you like me to add criteria?',
    'Would you like me to add options?',
    // Round-4 review: target + model.
    'Would you like me to add a target?',
    'Would you like me to add a model?',
    'Would you like me to add targets?',
  ])('rejects a concept that reduces to a bare generic structural noun: %s', (prose) => {
    expect(extractProposedConcept(prose)).toBeNull();
  });

  it('still extracts the noun from a multi-word "X factor" / "X risk" concept', () => {
    expect(extractProposedConcept('Would you like me to add a cost factor?')?.concept).toBe('cost');
    expect(extractProposedConcept('Would you like me to add the onboarding risk?')?.concept).toBe('onboarding');
  });

  it('still extracts multi-word concepts ending in a generic structural noun', () => {
    // The bare-noun reject is EXACT single-token only; multi-word
    // concepts that happen to end in a structural noun survive.
    expect(extractProposedConcept('Would you like me to add a delivery goal?')?.concept).toBe('delivery goal');
    expect(extractProposedConcept('Would you like me to add a stretch objective?')?.concept).toBe('stretch objective');
    expect(extractProposedConcept('Would you like me to add a sales target?')?.concept).toBe('sales target');
    expect(extractProposedConcept('Would you like me to add a business model?')?.concept).toBe('business model');
  });

  // ─── PR #216 second-round review: curly apostrophe + "what is" ────
  it('truncates at a curly-apostrophe "what’s most likely" clause boundary', () => {
    // Curly apostrophe (U+2019) — LLM prose routinely emits it; a
    // straight-only pattern would have missed the boundary.
    const r = extractProposedConcept(
      'Would you like me to add team morale, or what’s most likely driving this?',
    );
    expect(r?.concept).toBe('team morale');
  });

  it('truncates at a "what is most likely" clause boundary (no contraction)', () => {
    const r = extractProposedConcept(
      'Would you like me to add team morale, or what is most likely the cause?',
    );
    expect(r?.concept).toBe('team morale');
  });

  it('rejects a concept retaining a curly-apostrophe "what’s" tail', () => {
    expect(extractProposedConcept('Would you like me to add what’s most important?')).toBeNull();
  });

  it('preserves "team morale" (clean, ≤8 words, no trailing kind)', () => {
    const r = extractProposedConcept('Would you like me to add team morale?');
    expect(r?.concept).toBe('team morale');
  });

  it('preserves "cultural fit" (clean, ≤8 words, no trailing kind)', () => {
    const r = extractProposedConcept('Would you like me to add cultural fit?');
    expect(r?.concept).toBe('cultural fit');
  });

  it('preserves "change resistance" (clean, ≤8 words, no trailing kind)', () => {
    const r = extractProposedConcept('Would you like me to add change resistance?');
    expect(r?.concept).toBe('change resistance');
  });

  it('preserves "team sentiment or change resistance" (bare "or" without comma)', () => {
    const r = extractProposedConcept(
      'Would you like me to add team sentiment or change resistance?',
    );
    expect(r?.concept).toBe('team sentiment or change resistance');
  });

  it('truncates an 11-word concept at the 8-word boundary', () => {
    const r = extractProposedConcept(
      'Would you like me to add one two three four five six seven eight nine ten eleven?',
    );
    expect(r).not.toBeNull();
    expect(r!.concept.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it('handles "add X as a factor" with a trailing kind word in X (double-kind)', () => {
    // Pattern 1 captures "team morale factor" (capture stops at " as a
    // factor"). Trailing-strip removes "factor" → "team morale".
    const r = extractProposedConcept('You should add a team morale factor as a factor.');
    expect(r?.concept).toBe('team morale');
    expect(r?.preferred_kind).toBe('factor');
  });

  it('handles "add X as a driver" (driver maps to factor)', () => {
    const r = extractProposedConcept('Consider adding code review depth as a driver.');
    expect(r?.concept).toBe('code review depth');
    expect(r?.preferred_kind).toBe('factor');
  });
});

describe('detectsContinuationAgreement', () => {
  it.each([
    'yes',
    'Yes',
    'Yeah',
    'yep.',
    'sure',
    'ok',
    'Okay!',
    'please',
    "That's a good idea.",
    "That is a good idea.",
    "let's do that",
    "lets involve the team",
    'How should we update the model?',
    'how should we update the decision?',
    'For that risk, what next?',
    'For that factor, how do we proceed?',
    'Go ahead',
    'please add',
  ])('accepts agreement phrase: %s', (m) => {
    expect(detectsContinuationAgreement(m)).toBe(true);
  });

  it.each([
    'no',
    'no thanks',
    'not yet',
    "don't add",
    'ignore that',
    'skip it',
    'instead of that, what about something else?',
    'never',
    'no, that is not a good idea',
    'no, do not do that',
  ])('rejects negation phrase: %s', (m) => {
    expect(detectsContinuationAgreement(m)).toBe(false);
  });

  it('rejects unrelated free text', () => {
    expect(detectsContinuationAgreement('Walk me through the analysis.')).toBe(false);
    expect(detectsContinuationAgreement('The team is large.')).toBe(false);
    expect(detectsContinuationAgreement('What does this mean?')).toBe(false);
  });

  it('rejects empty / oversized input', () => {
    expect(detectsContinuationAgreement('')).toBe(false);
    expect(detectsContinuationAgreement('   ')).toBe(false);
    expect(detectsContinuationAgreement('a'.repeat(401))).toBe(false);
  });

  it('handles the exact failing transcript user follow-up', () => {
    const userTurn =
      "That's a good idea. Let's involve the team in the hiring process. "
      + 'For that risk, how should we update the decision model?';
    expect(detectsContinuationAgreement(userTurn)).toBe(true);
  });
});

describe('detectsAddAsFactorIntent', () => {
  it('accepts free-text add-as-factor', () => {
    expect(detectsAddAsFactorIntent('Add team morale as a factor.')).toBe(true);
    expect(detectsAddAsFactorIntent('Adding stakeholder pushback as a factor')).toBe(true);
  });

  it('accepts chip-replay shape', () => {
    expect(detectsAddAsFactorIntent('Add team morale as a factor.')).toBe(true);
  });

  it('rejects already-disambiguated factor messages', () => {
    expect(
      detectsAddAsFactorIntent('Add team morale as a factor affecting delivery speed.'),
    ).toBe(false);
  });

  it('rejects add-as-risk messages', () => {
    expect(detectsAddAsFactorIntent('Add team morale as a risk.')).toBe(false);
  });

  it('rejects unrelated free text', () => {
    expect(detectsAddAsFactorIntent('Walk me through the analysis.')).toBe(false);
    expect(detectsAddAsFactorIntent('Yes')).toBe(false);
  });
});

describe('buildProposalStageOneResponse', () => {
  it('emits three labelled chips with safe messages', () => {
    const r = buildProposalStageOneResponse({
      concept: 'team morale or cultural fit',
      preferred_kind: 'factor',
    });
    expect(r.suggestedActions).toHaveLength(3);
    expect(r.suggestedActions[0]?.label).toBe('Add as risk');
    expect(r.suggestedActions[1]?.label).toBe('Add as factor');
    expect(r.suggestedActions[2]?.label).toBe('Keep as note');
    expect(r.suggestedActions[0]?.message).toBe(
      'Add team morale or cultural fit as a risk.',
    );
    expect(r.suggestedActions[1]?.message).toBe(
      'Add team morale or cultural fit as a factor.',
    );
    expect(r.suggestedActions[2]?.message).toBe(
      'Just note this for now and keep the model unchanged.',
    );
  });

  it('does not include forbidden user-facing vocabulary', () => {
    const r = buildProposalStageOneResponse({
      concept: 'team morale or cultural fit',
      preferred_kind: 'factor',
    });
    assertCleanUserCopy(r.assistantText);
    for (const a of r.suggestedActions) {
      assertCleanUserCopy(a.label);
      assertCleanUserCopy(a.message);
    }
  });

  it('does not say "factor or edge"', () => {
    const r = buildProposalStageOneResponse({
      concept: 'team morale',
      preferred_kind: 'either',
    });
    expect(r.assistantText.toLowerCase()).not.toContain('factor or edge');
  });
});

describe('buildFactorAffectClarifierResponse', () => {
  it('emits up to 4 chips, one per candidate affect target', () => {
    const r = buildFactorAffectClarifierResponse({
      concept: 'team morale',
      candidateAffects: ['Delivery speed', 'Code quality', 'Cost', 'Onboarding pace'],
    });
    expect(r.suggestedActions).toHaveLength(4);
    expect(r.suggestedActions[0]?.label).toBe('Delivery speed');
    expect(r.suggestedActions[0]?.message).toBe(
      'Add team morale as a factor affecting Delivery speed.',
    );
  });

  it('caps at 4 chips even with more candidates', () => {
    const r = buildFactorAffectClarifierResponse({
      concept: 'team morale',
      candidateAffects: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'],
    });
    expect(r.suggestedActions).toHaveLength(4);
  });

  it('falls back to free-text prompt when no candidates given', () => {
    const r = buildFactorAffectClarifierResponse({
      concept: 'team morale',
      candidateAffects: [],
    });
    expect(r.suggestedActions).toHaveLength(0);
    expect(r.assistantText).toContain('Tell me which outcome or factor it most affects.');
  });

  it('does not include forbidden user-facing vocabulary', () => {
    const r = buildFactorAffectClarifierResponse({
      concept: 'team morale or cultural fit',
      candidateAffects: ['Delivery speed', 'Code quality'],
    });
    assertCleanUserCopy(r.assistantText);
    for (const a of r.suggestedActions) {
      assertCleanUserCopy(a.label);
      assertCleanUserCopy(a.message);
    }
  });

  it('does not say "factor or edge"', () => {
    const r = buildFactorAffectClarifierResponse({
      concept: 'team morale',
      candidateAffects: ['Delivery speed'],
    });
    expect(r.assistantText.toLowerCase()).not.toContain('factor or edge');
  });
});

describe('pickCandidateAffectLabels', () => {
  it('returns goal-kind labels first', () => {
    const r = pickCandidateAffectLabels([
      { label: 'Driver A', kind: 'factor' },
      { label: 'Outcome X', kind: 'outcome' },
      { label: 'Goal G', kind: 'goal' },
    ]);
    expect(r[0]).toBe('Outcome X');
    expect(r[1]).toBe('Goal G');
    expect(r[2]).toBe('Driver A');
  });

  it('skips empty / short / non-alpha labels', () => {
    const r = pickCandidateAffectLabels([
      { label: '', kind: 'goal' },
      { label: '   ', kind: 'goal' },
      { label: 'X', kind: 'goal' }, // <2 alpha
      { label: '!!', kind: 'goal' },
      { label: 'Delivery', kind: 'goal' },
    ]);
    expect(r).toEqual(['Delivery']);
  });

  it('dedupes case-insensitively', () => {
    const r = pickCandidateAffectLabels([
      { label: 'Delivery speed', kind: 'goal' },
      { label: 'delivery speed', kind: 'goal' },
    ]);
    expect(r).toHaveLength(1);
  });

  it('caps at 4', () => {
    const r = pickCandidateAffectLabels([
      { label: 'Alpha', kind: 'goal' },
      { label: 'Beta', kind: 'goal' },
      { label: 'Gamma', kind: 'goal' },
      { label: 'Delta', kind: 'goal' },
      { label: 'Epsilon', kind: 'goal' },
    ]);
    expect(r).toHaveLength(4);
    expect(r).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('returns empty array on null/empty input', () => {
    expect(pickCandidateAffectLabels(null)).toEqual([]);
    expect(pickCandidateAffectLabels(undefined)).toEqual([]);
    expect(pickCandidateAffectLabels([])).toEqual([]);
  });
});

describe('buildProposalPendingAction', () => {
  it('builds a parseable proposed_concept pending action', () => {
    const action = buildProposalPendingAction({
      concept: 'team morale',
      preferred_kind: 'factor',
      scenario_id: '11111111-1111-1111-1111-111111111111',
      emitted_at_iso: '2026-05-28T10:00:00.000Z',
      graph_hash: 'sha256:abc123',
    });
    expect(action.action.kind).toBe('proposed_concept');
    expect(action.action).toMatchObject({
      kind: 'proposed_concept',
      concept: 'team morale',
      preferred_kind: 'factor',
    });
    expect(action.preconditions.graph_hash).toBe('sha256:abc123');
    expect(action.scenario_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(typeof action.id).toBe('string');
    expect(action.id.length).toBeGreaterThanOrEqual(12);
  });

  it('omits graph_hash from preconditions when not provided', () => {
    const action = buildProposalPendingAction({
      concept: 'team morale',
      preferred_kind: 'factor',
      scenario_id: '11111111-1111-1111-1111-111111111111',
      emitted_at_iso: '2026-05-28T10:00:00.000Z',
    });
    expect(action.preconditions.graph_hash).toBeUndefined();
  });
});

describe('decideProposalContinuation', () => {
  const concept = {
    concept: 'team morale or cultural fit',
    preferred_kind: 'factor' as const,
  };

  it('returns null when no pending concept', () => {
    expect(
      decideProposalContinuation({
        message: 'Yes.',
        pendingProposedConcept: null,
      }),
    ).toBeNull();
  });

  it('returns stage_one on agreement', () => {
    const d = decideProposalContinuation({
      message: "That's a good idea.",
      pendingProposedConcept: concept,
    });
    expect(d?.stage).toBe('stage_one');
    expect(d?.suggestedActions).toHaveLength(3);
  });

  it('returns stage_two on add-as-factor intent', () => {
    const d = decideProposalContinuation({
      message: 'Add team morale as a factor.',
      pendingProposedConcept: concept,
      nodes: [
        { label: 'Delivery speed', kind: 'goal' },
        { label: 'Code quality', kind: 'outcome' },
      ],
    });
    expect(d?.stage).toBe('stage_two');
    expect(d?.suggestedActions).toHaveLength(2);
  });

  it('stage_two takes precedence over stage_one when both match', () => {
    const d = decideProposalContinuation({
      message: "Yes, let's add team morale as a factor.",
      pendingProposedConcept: concept,
      nodes: [{ label: 'Delivery speed', kind: 'goal' }],
    });
    expect(d?.stage).toBe('stage_two');
  });

  it('returns null when neither stage matches', () => {
    expect(
      decideProposalContinuation({
        message: 'Walk me through the analysis.',
        pendingProposedConcept: concept,
      }),
    ).toBeNull();
  });

  it('returns null when message is empty', () => {
    expect(
      decideProposalContinuation({
        message: '',
        pendingProposedConcept: concept,
      }),
    ).toBeNull();
  });
});

describe('buildPendingActionsWithProposalCapture', () => {
  it('returns undefined when no proposal pattern matches', () => {
    const out = buildPendingActionsWithProposalCapture({
      assistantText: 'The biggest thing to examine next is delivery speed.',
      chips: [],
      scenarioId: '11111111-1111-1111-1111-111111111111',
      graphHash: 'h1',
      requestId: 'req-1',
      originPath: 'llm_sonnet',
    });
    expect(out).toBeUndefined();
  });

  it('captures the proposal and emits a pending action when matched', () => {
    const out = buildPendingActionsWithProposalCapture({
      assistantText:
        'Would you like me to add team morale or cultural fit as a factor?',
      chips: [],
      scenarioId: '11111111-1111-1111-1111-111111111111',
      graphHash: 'h1',
      requestId: 'req-1',
      originPath: 'llm_sonnet',
    });
    expect(out).toBeDefined();
    expect(out).toHaveLength(1);
    expect(out![0]!.action.kind).toBe('proposed_concept');
    if (out![0]!.action.kind === 'proposed_concept') {
      expect(out![0]!.action.concept).toBe('team morale or cultural fit');
    }
  });

  it('caps the combined list at 3 entries with proposal first', () => {
    // Build a chip list with run_analysis chip so derivePendingActions
    // emits a chip-derived pending action.
    const chips = Array.from({ length: 4 }, (_, i) => ({
      id: `chip_${i}`,
      label: `Run analysis ${i}`,
      message: `Run analysis ${i}.`,
      action_type: 'run_analysis' as const,
    }));
    const out = buildPendingActionsWithProposalCapture({
      assistantText: 'Add team morale as a factor.',
      chips,
      scenarioId: '11111111-1111-1111-1111-111111111111',
      graphHash: 'h1',
      requestId: 'req-1',
      originPath: 'llm_sonnet',
    });
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(3);
    // Proposal entry should be first so it survives capping.
    expect(out![0]!.action.kind).toBe('proposed_concept');
  });

  it('returns undefined on capture failure (defensive)', () => {
    // Non-string assistantText causes extractProposedConcept to return null
    // (graceful, not an error), so the helper returns undefined.
    const out = buildPendingActionsWithProposalCapture({
      assistantText: 123 as unknown as string,
      chips: [],
      scenarioId: '11111111-1111-1111-1111-111111111111',
      graphHash: 'h1',
      requestId: 'req-1',
      originPath: 'llm_sonnet',
    });
    expect(out).toBeUndefined();
  });
});

describe('findProposedConceptAction', () => {
  function makeAction(): PendingAction {
    return buildProposalPendingAction({
      concept: 'team morale',
      preferred_kind: 'factor',
      scenario_id: '11111111-1111-1111-1111-111111111111',
      emitted_at_iso: '2026-05-28T10:00:00.000Z',
      graph_hash: 'h1',
    });
  }

  it('returns the concept + preferred_kind when entry present', () => {
    const found = findProposedConceptAction([makeAction()]);
    expect(found).toEqual({ concept: 'team morale', preferred_kind: 'factor' });
  });

  it('returns null when no proposed_concept entry present', () => {
    expect(findProposedConceptAction([])).toBeNull();
    expect(findProposedConceptAction(null)).toBeNull();
    expect(findProposedConceptAction(undefined)).toBeNull();
  });

  it('returns the most recent proposed_concept when multiple present', () => {
    const a1 = buildProposalPendingAction({
      concept: 'first concept',
      preferred_kind: 'risk',
      scenario_id: '11111111-1111-1111-1111-111111111111',
      emitted_at_iso: '2026-05-28T09:00:00.000Z',
      graph_hash: 'h1',
    });
    const a2 = buildProposalPendingAction({
      concept: 'second concept',
      preferred_kind: 'factor',
      scenario_id: '11111111-1111-1111-1111-111111111111',
      emitted_at_iso: '2026-05-28T10:00:00.000Z',
      graph_hash: 'h2',
    });
    const found = findProposedConceptAction([a1, a2]);
    expect(found?.concept).toBe('second concept');
    expect(found?.preferred_kind).toBe('factor');
  });
});

describe('findProposedConceptEntry', () => {
  it('returns the full PendingAction object for the most recent proposed_concept', () => {
    const entry = buildProposalPendingAction({
      concept: 'team morale',
      preferred_kind: 'factor',
      scenario_id: '11111111-1111-1111-1111-111111111111',
      emitted_at_iso: '2026-05-28T10:00:00.000Z',
      graph_hash: 'h1',
    });
    const found = findProposedConceptEntry([entry]);
    expect(found).not.toBeNull();
    expect(found?.expires_at_iso).toBe(entry.expires_at_iso);
    expect(found?.preconditions.graph_hash).toBe('h1');
  });

  it('returns null on empty / missing input', () => {
    expect(findProposedConceptEntry([])).toBeNull();
    expect(findProposedConceptEntry(null)).toBeNull();
    expect(findProposedConceptEntry(undefined)).toBeNull();
  });

  it('returns null when no proposed_concept entry present', () => {
    // Non-proposed_concept pending shapes do not match.
    const nonProposed: PendingAction = {
      id: 'pa_1',
      scenario_id: '11111111-1111-1111-1111-111111111111',
      chip_id: 'chip_1',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-01-01T00:00:00.000Z',
      emitted_at_iso: '2026-05-28T10:00:00.000Z',
    };
    expect(findProposedConceptEntry([nonProposed])).toBeNull();
  });
});

describe('isProposedConceptExpired', () => {
  const baseEntry: PendingAction = buildProposalPendingAction({
    concept: 'team morale',
    preferred_kind: 'factor',
    scenario_id: '11111111-1111-1111-1111-111111111111',
    emitted_at_iso: '2026-05-28T10:00:00.000Z',
    graph_hash: 'h1',
  });

  it('returns false when expires_at_iso is in the future', () => {
    const future: PendingAction = {
      ...baseEntry,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
    };
    expect(isProposedConceptExpired(future, Date.parse('2026-05-28T10:00:00.000Z'))).toBe(false);
  });

  it('returns true when now is strictly past expires_at_iso', () => {
    const expired: PendingAction = {
      ...baseEntry,
      expires_at_iso: '2026-05-28T10:00:00.000Z',
    };
    // one millisecond past expiry
    expect(isProposedConceptExpired(expired, Date.parse('2026-05-28T10:00:00.001Z'))).toBe(true);
  });

  it('returns false at the exact expiry instant (inclusive boundary)', () => {
    const atBoundary: PendingAction = {
      ...baseEntry,
      expires_at_iso: '2026-05-28T10:00:00.000Z',
    };
    expect(isProposedConceptExpired(atBoundary, Date.parse('2026-05-28T10:00:00.000Z'))).toBe(false);
  });

  it('returns true when expires_at_iso is unparseable (fail closed)', () => {
    const malformed: PendingAction = {
      ...baseEntry,
      expires_at_iso: 'not-a-date',
    };
    expect(isProposedConceptExpired(malformed, Date.now())).toBe(true);
  });
});

describe('resolveProposalResume — wall-clock + graph-hash gate', () => {
  const SCENARIO = '11111111-1111-1111-1111-111111111111';
  const EMITTED_AT = '2026-05-28T10:00:00.000Z';
  const FRESH_GRAPH_HASH = 'sha256:fresh';
  const CONCEPT = 'team morale or cultural fit';

  function buildValidPending(): PendingAction {
    return buildProposalPendingAction({
      concept: CONCEPT,
      preferred_kind: 'factor',
      scenario_id: SCENARIO,
      emitted_at_iso: EMITTED_AT,
      graph_hash: FRESH_GRAPH_HASH,
    });
  }

  function buildExpiredPending(): PendingAction {
    const valid = buildValidPending();
    // Force expiry into the past — covers the wall-clock branch even
    // when the test clock has not advanced.
    return {
      ...valid,
      expires_at_iso: '2026-05-28T09:59:59.999Z',
    };
  }

  const NOW_MS = Date.parse('2026-05-28T10:00:00.001Z');

  it('returns no_pending when the list is empty', () => {
    const r = resolveProposalResume({
      message: "That's a good idea.",
      pendingActions: [],
      nodes: null,
      currentGraphHash: FRESH_GRAPH_HASH,
      nowMs: NOW_MS,
    });
    expect(r.decision).toBeNull();
    expect(r.rejection).toBe('no_pending');
  });

  it('returns no_pending when the list contains no proposed_concept entry', () => {
    const nonProposed: PendingAction = {
      id: 'pa_1',
      scenario_id: SCENARIO,
      chip_id: 'chip_1',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-01-01T00:00:00.000Z',
      emitted_at_iso: EMITTED_AT,
    };
    const r = resolveProposalResume({
      message: "That's a good idea.",
      pendingActions: [nonProposed],
      nodes: null,
      currentGraphHash: FRESH_GRAPH_HASH,
      nowMs: NOW_MS,
    });
    expect(r.decision).toBeNull();
    expect(r.rejection).toBe('no_pending');
  });

  // ─── User-required test case 1 ─────────────────────────────────────
  it('expired pending + agreement → no Stage 1 (rejection: expired_wall)', () => {
    const r = resolveProposalResume({
      message: "That's a good idea. Let's involve the team.",
      pendingActions: [buildExpiredPending()],
      nodes: null,
      currentGraphHash: FRESH_GRAPH_HASH,
      nowMs: NOW_MS,
    });
    expect(r.decision).toBeNull();
    expect(r.rejection).toBe('expired_wall');
  });

  // ─── User-required test case 2 ─────────────────────────────────────
  it('expired pending + Add as factor → no Stage 2 (rejection: expired_wall)', () => {
    const r = resolveProposalResume({
      message: 'Add team morale as a factor.',
      pendingActions: [buildExpiredPending()],
      nodes: [{ label: 'Delivery speed', kind: 'goal' }],
      currentGraphHash: FRESH_GRAPH_HASH,
      nowMs: NOW_MS,
    });
    expect(r.decision).toBeNull();
    expect(r.rejection).toBe('expired_wall');
  });

  // ─── User-required test case 3 ─────────────────────────────────────
  it('valid (non-expired, matching hash) pending + agreement → Stage 1 resumes normally', () => {
    const r = resolveProposalResume({
      message: "That's a good idea. Let's involve the team.",
      pendingActions: [buildValidPending()],
      nodes: null,
      currentGraphHash: FRESH_GRAPH_HASH,
      nowMs: NOW_MS,
    });
    expect(r.rejection).toBeNull();
    expect(r.decision).not.toBeNull();
    expect(r.decision?.stage).toBe('stage_one');
    expect(r.decision?.assistantText).toContain(CONCEPT);
    expect(r.decision?.suggestedActions).toHaveLength(3);
  });

  it('valid pending + Add as factor → Stage 2 resumes normally with affect-target chips', () => {
    const r = resolveProposalResume({
      message: 'Add team morale as a factor.',
      pendingActions: [buildValidPending()],
      nodes: [
        { label: 'Delivery speed', kind: 'goal' },
        { label: 'Quality', kind: 'outcome' },
      ],
      currentGraphHash: FRESH_GRAPH_HASH,
      nowMs: NOW_MS,
    });
    expect(r.rejection).toBeNull();
    expect(r.decision?.stage).toBe('stage_two');
    expect(r.decision?.suggestedActions).toHaveLength(2);
  });

  it('wall-clock TTL takes precedence over graph-hash divergence (expired first)', () => {
    // Both conditions hold (expired AND diverged); the gate rejects on
    // wall-clock because it runs first.
    const r = resolveProposalResume({
      message: "That's a good idea.",
      pendingActions: [buildExpiredPending()],
      nodes: null,
      currentGraphHash: 'sha256:diverged',
      nowMs: NOW_MS,
    });
    expect(r.rejection).toBe('expired_wall');
  });

  it('graph-hash divergence rejects the resume when not expired', () => {
    const r = resolveProposalResume({
      message: "That's a good idea.",
      pendingActions: [buildValidPending()],
      nodes: null,
      currentGraphHash: 'sha256:diverged',
      nowMs: NOW_MS,
    });
    expect(r.rejection).toBe('graph_hash_changed');
    expect(r.decision).toBeNull();
  });

  it('valid pending + unrelated message → decision null, rejection null (gate satisfied, no agreement)', () => {
    // The gate passes (pending exists, fresh, hash matches), but
    // decideProposalContinuation returns null because the message
    // matches neither agreement nor add-as-factor. Callers fall through
    // to existing branches with NO invalidated telemetry.
    const r = resolveProposalResume({
      message: 'Walk me through the analysis.',
      pendingActions: [buildValidPending()],
      nodes: null,
      currentGraphHash: FRESH_GRAPH_HASH,
      nowMs: NOW_MS,
    });
    expect(r.decision).toBeNull();
    expect(r.rejection).toBeNull();
  });

  it('passes through when persisted hash is absent (no precondition to compare)', () => {
    const noHash = buildProposalPendingAction({
      concept: CONCEPT,
      preferred_kind: 'factor',
      scenario_id: SCENARIO,
      emitted_at_iso: EMITTED_AT,
      // omit graph_hash
    });
    const r = resolveProposalResume({
      message: "That's a good idea.",
      pendingActions: [noHash],
      nodes: null,
      currentGraphHash: 'sha256:anything',
      nowMs: NOW_MS,
    });
    expect(r.rejection).toBeNull();
    expect(r.decision?.stage).toBe('stage_one');
  });
});
