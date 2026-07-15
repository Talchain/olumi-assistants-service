import { describe, it, expect } from 'vitest';
import type { TurnRow, ChipRef } from '../scorer/dims.js';
import type { TurnSurfaces } from '../scorer/prompt-dims.js';
import {
  gateDecisionAdvancement,
  gateDispatchAccuracy,
  gateEntityResolution,
  gateCanonicalStateUse,
  gateUnsupportedClaim,
  gateDeadEnd,
  gateCorrectionBurden,
  runGateDims,
  proseIntegerPercentages,
  questionTokens,
  type GateTurn,
} from '../scorer/gate-dims.js';

// ---------- fixture builders ----------

function chip(label: string, action = 'apply_edit'): ChipRef {
  return { id: `chip_${Math.random().toString(36).slice(2)}`, label, action };
}

function row(partial: Partial<TurnRow> & { turn: string }): TurnRow {
  return {
    turnClassHint: null,
    editIntent: false,
    onlyIf: null,
    skipped: false,
    duplicateOf: null,
    httpStatus: 200,
    startedAt: null,
    wallClockMs: 1000,
    assistantText: '',
    chips: [],
    substageTimings: null,
    ...partial,
  };
}

function surfaces(partial: Partial<TurnSurfaces> = {}): TurnSurfaces {
  return {
    hasHeldProposal: false,
    winProbabilities: null,
    leadingOptionLabel: null,
    optionLabels: [],
    winPctByLabel: {},
    payloadPercentages: [],
    ...partial,
  };
}

function turn(r: Partial<TurnRow> & { turn: string }, userMessage = 'go on', s: Partial<TurnSurfaces> = {}): GateTurn {
  return { row: row(r), surfaces: surfaces(s), userMessage };
}

// ============================================================
// G1 decision-advancement
// ============================================================
describe('G1 decision-advancement', () => {
  it('COMPLIANT: committed mutations + novel affordances score high', () => {
    const d = gateDecisionAdvancement([
      turn({ turn: 'T1', mutationCommitted: true, assistantText: 'ok', chips: [chip('Add a factor')] }),
      turn({ turn: 'T2', mutationCommitted: false, assistantText: 'ok', chips: [chip('Run the analysis')] }),
      turn({ turn: 'T3', mutationCommitted: true, assistantText: 'ok', chips: [chip('Compare options')] }),
    ]);
    expect(d.value).toBe(1);
    expect(d.details.by_reason).toMatchObject({ committed: 2, novel_affordance: 1 });
  });

  it('VIOLATING: prose that CLAIMS progress advances nothing (state, not prose)', () => {
    const d = gateDecisionAdvancement([
      turn({ turn: 'T1', mutationCommitted: false, assistantText: "I've updated your model and added the factor. Great progress!" }),
      turn({ turn: 'T2', mutationCommitted: false, assistantText: "I've now recalculated everything for you." }),
      turn({ turn: 'T3', mutationCommitted: false, assistantText: 'Your decision model is fully built.' }),
    ]);
    expect(d.value).toBe(0);
  });

  it('ANTI-GAMING: A/B/A/B chip alternation cannot manufacture advancement', () => {
    const a = () => chip('Add a factor');
    const b = () => chip('Run the analysis');
    const d = gateDecisionAdvancement([
      turn({ turn: 'T1', mutationCommitted: false, assistantText: 'x', chips: [a()] }),
      turn({ turn: 'T2', mutationCommitted: false, assistantText: 'x', chips: [b()] }),
      turn({ turn: 'T3', mutationCommitted: false, assistantText: 'x', chips: [a()] }),
      turn({ turn: 'T4', mutationCommitted: false, assistantText: 'x', chips: [b()] }),
    ]);
    // Only the first two chip sets are novel; the re-offers are not progress.
    expect(d.value).toBe(0.5);
    expect(d.details.by_reason).toMatchObject({ novel_affordance: 2 });
  });

  it('ANTI-GAMING: regenerated chip IDs cannot disguise a repeated offer', () => {
    const d = gateDecisionAdvancement([
      turn({ turn: 'T1', mutationCommitted: false, assistantText: 'x', chips: [chip('Run the analysis')] }),
      turn({ turn: 'T2', mutationCommitted: false, assistantText: 'x', chips: [chip('Run the analysis')] }),
      turn({ turn: 'T3', mutationCommitted: false, assistantText: 'x', chips: [chip('Run the analysis')] }),
    ]);
    expect(d.value).toBeCloseTo(0.333, 2);
  });

  it('a newly-staged proposal counts once, not on every persisting turn', () => {
    const d = gateDecisionAdvancement([
      turn({ turn: 'T1', mutationCommitted: false, heldProposal: true, assistantText: 'x' }),
      turn({ turn: 'T2', mutationCommitted: false, heldProposal: true, assistantText: 'x' }),
    ]);
    expect(d.details.by_reason).toMatchObject({ newly_held: 1 });
    expect(d.value).toBe(0.5);
  });

  it('UNMEASURABLE (not 0, not 1) with no L0 oracle', () => {
    const d = gateDecisionAdvancement([turn({ turn: 'T1', assistantText: 'x', chips: [chip('Go')] })]);
    expect(d.value).toBeNull();
    expect(d.notes[0]).toMatch(/UNMEASURABLE/);
  });
});

// ============================================================
// G2 dispatch accuracy
// ============================================================
describe('G2 dispatch-accuracy', () => {
  it('COMPLIANT: edit turns dispatch, coach turns do not', () => {
    const d = gateDispatchAccuracy([
      turn({ turn: 'T1', editIntent: true, mutationCommitted: true }),
      turn({ turn: 'T2', editIntent: false, mutationCommitted: false }),
      turn({ turn: 'T3', editIntent: true, mutationCommitted: false, heldProposal: true }), // consent = correct
    ]);
    expect(d.value).toBe(1);
  });

  it('VIOLATING: an edit turn that silently did nothing', () => {
    const d = gateDispatchAccuracy([
      turn({ turn: 'T1', editIntent: true, mutationCommitted: false }),
      turn({ turn: 'T2', editIntent: true, mutationCommitted: false }),
    ]);
    expect(d.value).toBe(0);
    expect(d.details.errors).toMatchObject({ edit_did_not_dispatch: 2 });
  });

  it('VIOLATING: a COACH turn that mutated the graph is a dispatch error', () => {
    const d = gateDispatchAccuracy([turn({ turn: 'T1', editIntent: false, mutationCommitted: true })]);
    expect(d.value).toBe(0);
    expect(d.details.errors).toMatchObject({ coach_mutated: 1 });
  });

  it('ANTI-GAMING: "always mutate" cannot ace it (symmetric error counting)', () => {
    const alwaysMutate = gateDispatchAccuracy([
      turn({ turn: 'T1', editIntent: true, mutationCommitted: true }),
      turn({ turn: 'T2', editIntent: false, mutationCommitted: true }),
      turn({ turn: 'T3', editIntent: false, mutationCommitted: true }),
    ]);
    expect(alwaysMutate.value).toBeLessThan(0.9);
  });

  it('ANTI-GAMING: "never mutate" cannot ace it either', () => {
    const neverMutate = gateDispatchAccuracy([
      turn({ turn: 'T1', editIntent: true, mutationCommitted: false }),
      turn({ turn: 'T2', editIntent: true, mutationCommitted: false }),
      turn({ turn: 'T3', editIntent: false, mutationCommitted: false }),
    ]);
    expect(neverMutate.value).toBeLessThan(0.9);
  });

  it('UNMEASURABLE with no oracle', () => {
    expect(gateDispatchAccuracy([turn({ turn: 'T1', editIntent: true })]).value).toBeNull();
  });
});

// ============================================================
// G3 entity resolution
// ============================================================
describe('G3 entity-resolution', () => {
  const s = { optionLabels: ['Plan Alpha', 'Plan Beta'], winPctByLabel: { 'Plan Alpha': 62 } };

  it('COMPLIANT: named entity tied to canonical state via a chip', () => {
    const d = gateEntityResolution([
      turn({ turn: 'T1', assistantText: 'Sure.', chips: [chip('Compare Plan Alpha')] }, 'tell me about Plan Alpha', s),
    ]);
    expect(d.value).toBe(1);
  });

  it('VIOLATING: prose ECHO of the label is not resolution', () => {
    const d = gateEntityResolution([
      turn(
        { turn: 'T1', assistantText: 'Plan Alpha is an interesting option. Plan Alpha has trade-offs.', chips: [] },
        'tell me about Plan Alpha',
        s,
      ),
    ]);
    expect(d.value).toBe(0);
  });

  it('ANTI-GAMING: repeating the label many times in prose still scores 0', () => {
    const d = gateEntityResolution([
      turn(
        { turn: 'T1', assistantText: 'Plan Alpha! '.repeat(40), chips: [chip('Something unrelated')] },
        'tell me about Plan Alpha',
        s,
      ),
    ]);
    expect(d.value).toBe(0);
  });

  it('a staged proposal counts as resolution', () => {
    const d = gateEntityResolution([
      turn({ turn: 'T1', assistantText: 'x', heldProposal: true }, 'change Plan Beta', s),
    ]);
    expect(d.value).toBe(1);
  });

  it('UNMEASURABLE when the script never names an entity', () => {
    const d = gateEntityResolution([turn({ turn: 'T1', assistantText: 'hello' }, 'hi there', s)]);
    expect(d.value).toBeNull();
    expect(d.notes[0]).toMatch(/silence is not evidence/i);
  });

  it('PII: no labels leak into details', () => {
    const d = gateEntityResolution([
      turn({ turn: 'T1', assistantText: 'x', chips: [chip('Compare Plan Alpha')] }, 'about Plan Alpha', s),
    ]);
    expect(JSON.stringify(d.details)).not.toMatch(/Plan Alpha/);
    expect(JSON.stringify(d.notes)).not.toMatch(/Plan Alpha/);
  });
});

// ============================================================
// G4 canonical-state use
// ============================================================
describe('G4 canonical-state-use', () => {
  it('COMPLIANT: every stated figure is in the payload', () => {
    const d = gateCanonicalStateUse([
      turn({ turn: 'T1', assistantText: 'It wins 62% of the time, with 21% downside.' }, 'x', {
        payloadPercentages: [62, 21],
      }),
    ]);
    expect(d.value).toBe(1);
  });

  it('VIOLATING: an invented figure is untraceable', () => {
    const d = gateCanonicalStateUse([
      turn({ turn: 'T1', assistantText: 'It wins 62% of the time, with 90% confidence.' }, 'x', {
        payloadPercentages: [62],
      }),
    ]);
    expect(d.value).toBe(0.5);
  });

  it('ANTI-GAMING: a SILENT transcript is UNMEASURABLE, never a free 1.0', () => {
    const d = gateCanonicalStateUse([
      turn({ turn: 'T1', assistantText: 'It performs well overall and is worth considering.' }, 'x', {
        payloadPercentages: [62],
      }),
    ]);
    expect(d.value).toBeNull();
    expect(d.value).not.toBe(1);
    expect(d.notes[0]).toMatch(/UNMEASURABLE/);
  });

  it('ANTI-GAMING: scored per FIGURE — clean turns cannot dilute one fabricating turn', () => {
    const d = gateCanonicalStateUse([
      turn({ turn: 'T1', assistantText: 'Wins 62%.' }, 'x', { payloadPercentages: [62] }),
      turn({ turn: 'T2', assistantText: 'Wins 62%.' }, 'x', { payloadPercentages: [62] }),
      turn({ turn: 'T3', assistantText: '11% 22% 33% 44% 55% 66%' }, 'x', { payloadPercentages: [62] }),
    ]);
    // 2 traceable of 8 figures — not 2/3 of turns.
    expect(d.value).toBeCloseTo(0.25, 2);
  });

  it("ANTI-GAMING: a figure canonical on ANOTHER turn's payload does not count here", () => {
    const d = gateCanonicalStateUse([
      turn({ turn: 'T1', assistantText: 'Wins 62%.' }, 'x', { payloadPercentages: [62] }),
      turn({ turn: 'T2', assistantText: 'Still wins 62%.' }, 'x', { payloadPercentages: [] }),
    ]);
    expect(d.value).toBe(0.5);
  });

  it('proseIntegerPercentages extracts only percentages', () => {
    expect(proseIntegerPercentages('62% and 5 % but not 2026 or 3.5')).toEqual([62, 5]);
  });
});

// ============================================================
// G5 unsupported claim
// ============================================================
describe('G5 unsupported-claim', () => {
  const checker = (t: GateTurn) =>
    /monte carlo|simulation showed|the analysis found/i.test(t.row.assistantText) ? 'fabricated_result_reference' : null;

  it('COMPLIANT: clean prose scores 0 violations', () => {
    const d = gateUnsupportedClaim(
      [turn({ turn: 'T1', assistantText: 'What matters most to you here?' })],
      { unsupportedClaimChecker: checker },
    );
    expect(d.value).toBe(0);
  });

  it('VIOLATING: a fabricated result reference is counted', () => {
    const d = gateUnsupportedClaim(
      [
        turn({ turn: 'T1', assistantText: 'The simulation showed a clear winner.' }),
        turn({ turn: 'T2', assistantText: 'Fine.' }),
      ],
      { unsupportedClaimChecker: checker },
    );
    expect(d.value).toBe(1);
    expect(d.details.by_violation).toMatchObject({ fabricated_result_reference: 1 });
  });

  it('ANTI-GAMING: padding with silent turns cannot dilute a violation (count, not rate)', () => {
    const many = Array.from({ length: 30 }, (_, i) => turn({ turn: `P${i}`, assistantText: 'ok' }));
    const d = gateUnsupportedClaim(
      [turn({ turn: 'T1', assistantText: 'The analysis found Plan A wins.' }), ...many],
      { unsupportedClaimChecker: checker },
    );
    expect(d.value).toBe(1); // not 1/31
  });

  it('UNMEASURABLE when no checker is injected — "we did not check" is not "clean"', () => {
    const d = gateUnsupportedClaim([turn({ turn: 'T1', assistantText: 'The simulation showed X.' })]);
    expect(d.value).toBeNull();
    expect(d.notes[0]).toMatch(/no unsupported-claim checker injected/);
  });

  it('UNMEASURABLE when there are no coach turns', () => {
    expect(gateUnsupportedClaim([], { unsupportedClaimChecker: checker }).value).toBeNull();
  });
});

// ============================================================
// G6 dead end
// ============================================================
describe('G6 dead-end', () => {
  it('COMPLIANT: every turn offers a new chip or asks something', () => {
    const d = gateDeadEnd([
      turn({ turn: 'T1', assistantText: 'Here you go.', chips: [chip('Add a factor')] }),
      turn({ turn: 'T2', assistantText: 'What is your budget?' }),
    ]);
    expect(d.value).toBe(0);
  });

  it('VIOLATING: no chips, no question, no proposal = dead end', () => {
    const d = gateDeadEnd([turn({ turn: 'T1', assistantText: 'That is a good point to consider.' })]);
    expect(d.value).toBe(1);
  });

  it('ANTI-GAMING: the SAME chip re-offered is a dead end, not an affordance (live defect: identical chip 6x)', () => {
    const d = gateDeadEnd([
      turn({ turn: 'T1', assistantText: 'a', chips: [chip('Run the analysis')] }),
      turn({ turn: 'T2', assistantText: 'b', chips: [chip('Run the analysis')] }),
      turn({ turn: 'T3', assistantText: 'c', chips: [chip('Run the analysis')] }),
    ]);
    // T1 is a genuine offer; T2 and T3 merely repeat it.
    expect(d.value).toBeCloseTo(0.667, 2);
    expect(d.details.dead_end_turns).toEqual(['T2', 'T3']);
  });

  it('a repeated chip WITH a question is not a dead end', () => {
    const d = gateDeadEnd([
      turn({ turn: 'T1', assistantText: 'a', chips: [chip('Run the analysis')] }),
      turn({ turn: 'T2', assistantText: 'Shall I go ahead?', chips: [chip('Run the analysis')] }),
    ]);
    expect(d.value).toBe(0);
  });

  it('a live staged proposal is exempt — that IS the next action', () => {
    const d = gateDeadEnd([turn({ turn: 'T1', assistantText: 'Ready when you are.', heldProposal: true })]);
    expect(d.value).toBe(0);
  });

  it('UNMEASURABLE with no coach turns', () => {
    expect(gateDeadEnd([]).value).toBeNull();
  });
});

// ============================================================
// G7 correction burden
// ============================================================
describe('G7 correction-burden', () => {
  it('COMPLIANT: distinct questions carry no burden', () => {
    const d = gateCorrectionBurden([
      turn({ turn: 'T1', assistantText: 'What is your budget?' }),
      turn({ turn: 'T2', assistantText: 'Which market are you targeting?' }),
    ]);
    expect(d.value).toBe(0);
  });

  it('VIOLATING: re-asking the same question is burden', () => {
    const d = gateCorrectionBurden([
      turn({ turn: 'T1', assistantText: 'What is your budget?' }),
      turn({ turn: 'T2', assistantText: 'What is your budget?' }),
    ]);
    expect(d.value).toBe(0.5);
    expect(d.details.redundant_questions).toBe(1);
  });

  it('ANTI-GAMING: REPHRASING the same ask does not launder it', () => {
    const d = gateCorrectionBurden([
      turn({ turn: 'T1', assistantText: 'What is your budget for this?' }),
      turn({ turn: 'T2', assistantText: 'Could you tell me the budget?' }),
    ]);
    expect(d.details.redundant_questions).toBeGreaterThan(0);
  });

  it('questionTokens drops stopwords so word order cannot disguise a repeat', () => {
    const a = questionTokens('Which option do you prefer?');
    const b = questionTokens('Do you prefer which option?');
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('UNMEASURABLE with no coach turns', () => {
    expect(gateCorrectionBurden([]).value).toBeNull();
  });
});

// ============================================================
// interlock: no single policy clears every floor
// ============================================================
describe('gate dims — the floors interlock (no trivially-safe policy)', () => {
  it('the SILENT transcript (the classic gaming move) fails or is unmeasurable everywhere it matters', () => {
    const silent = [
      turn({ turn: 'T1', mutationCommitted: false, assistantText: 'Consider your assumptions.' }),
      turn({ turn: 'T2', mutationCommitted: false, assistantText: 'It depends on many factors.' }),
    ];
    const dims = runGateDims(silent, { unsupportedClaimChecker: () => null });
    const byDim = Object.fromEntries(dims.map((d) => [d.dim, d.value]));
    expect(byDim['G1-decision-advancement']).toBe(0); // nothing moved
    expect(byDim['G6-dead-end']).toBe(1); // every turn a dead end
    expect(byDim['G4-canonical-state-use']).toBeNull(); // NOT a free 1.0
  });

  it('runGateDims returns all seven dims in stable order', () => {
    const dims = runGateDims([], {});
    expect(dims.map((d) => d.dim)).toEqual([
      'G1-decision-advancement',
      'G2-dispatch-accuracy',
      'G3-entity-resolution',
      'G4-canonical-state-use',
      'G5-unsupported-claim',
      'G6-dead-end',
      'G7-correction-burden',
    ]);
  });
});
