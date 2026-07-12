/**
 * Self-test for the prompt-quality dims (scorer/prompt-dims.ts). Fixture rows +
 * synthetic wire surfaces -> expected comparable scores. Pure — no src/ imports,
 * so it runs without the service module graph (guardHits are supplied inline,
 * exactly as score-run.ts attaches them from the real src/ guards at runtime).
 *
 * NOT collected by the root required gate — the .harness-test.ts suffix does not
 * match `**.{test,spec}.*`. Run with:
 *   pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
import type { TurnRow } from '../scorer/dims.js';
import {
  pqBrevityDensity,
  pqChipCorrectness,
  pqCoherence,
  pqGrounding,
  pqGuardCleanliness,
  pqQuestionAsking,
  runPromptDims,
  surfacesFromWire,
  type TurnSurfaces,
} from '../scorer/prompt-dims.js';

const CLEAN_GUARDS = {
  forbidden: null,
  successClaim: null,
  heldScience: false,
  mutationLanguage: false,
  structuralSuccessClaim: false,
};

function row(partial: Partial<TurnRow> & { turn: string }): TurnRow {
  return {
    turnClassHint: 'coach',
    editIntent: false,
    onlyIf: null,
    skipped: false,
    duplicateOf: null,
    httpStatus: 200,
    startedAt: null,
    wallClockMs: null,
    assistantText: '',
    chips: [],
    substageTimings: null,
    guardHits: { ...CLEAN_GUARDS },
    ...partial,
  };
}

/** Full TurnSurfaces with sensible defaults. */
function surf(partial: Partial<TurnSurfaces>): TurnSurfaces {
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

describe('surfacesFromWire', () => {
  it('lifts held_proposal, win probabilities and the leading option label', () => {
    const s = surfacesFromWire({
      held_proposal: { id: 'p1' },
      blocks: [
        {
          type: 'analysis_result',
          leading_option_id: 'opt_a',
          win_probabilities: { 'Option A': 0.78, 'Option B': 0.18 },
          enrichment: {
            option_comparison: [
              { id: 'opt_a', label: 'Option A' },
              { id: 'opt_b', label: 'Option B' },
            ],
          },
        },
      ],
    });
    expect(s.hasHeldProposal).toBe(true);
    expect(s.leadingOptionLabel).toBe('Option A');
    expect(s.optionLabels).toEqual(['Option A', 'Option B']);
    expect(s.winPctByLabel).toMatchObject({ 'Option A': 78, 'Option B': 18 });
    expect(s.payloadPercentages).toContain(78);
    expect(s.payloadPercentages).toContain(18);
  });

  it('falls back to argmax of win_probabilities when no option_comparison', () => {
    const s = surfacesFromWire({ blocks: [{ type: 'analysis_result', win_probabilities: { X: 0.3, Y: 0.7 } }] });
    expect(s.hasHeldProposal).toBe(false);
    expect(s.leadingOptionLabel).toBe('Y');
  });
});

describe('PQ1 brevity/density', () => {
  it('reports mean coach-turn words (lower-better)', () => {
    const d = pqBrevityDensity([
      row({ turn: 'T1', assistantText: 'word '.repeat(100).trim() }),
      row({ turn: 'T2', assistantText: 'word '.repeat(50).trim() }),
    ]);
    expect(d.direction).toBe('lower-better');
    expect(d.value).toBe(75);
  });
  it('is null with no coach turns', () => {
    expect(pqBrevityDensity([row({ turn: 'T1', turnClassHint: 'run_analysis', assistantText: 'x' })]).value).toBeNull();
  });
});

describe('PQ2 question-asking (neutral)', () => {
  it('counts questions per coach turn and detects post-draft framing', () => {
    const d = pqQuestionAsking([
      row({ turn: 'D1', turnClassHint: 'draft', assistantText: 'Here is a draft.' }),
      row({ turn: 'K1', assistantText: 'Which matters more to you, speed or quality?' }),
    ]);
    expect(d.direction).toBe('neutral');
    expect((d.details as any).postDraftFraming).toBe(true);
    expect(d.value).toBe(1);
  });
});

describe('PQ3 grounding (higher-better)', () => {
  it('marks a numeric/label-citing turn grounded and a generic turn not (no payload)', () => {
    const d = pqGrounding(
      [
        row({ turn: 'G1', assistantText: 'Option A leads in 78% of simulations.' }),
        row({ turn: 'G2', assistantText: 'It depends — there are many factors to consider in general.' }),
      ],
      ['Option A'],
    );
    expect(d.direction).toBe('higher-better');
    expect(d.value).toBe(0.5);
    const per = (d.details as any).perTurn;
    expect(per.find((p: any) => p.turn === 'G1').grounded).toBe(true);
    expect(per.find((p: any) => p.turn === 'G2').grounded).toBe(false);
  });

  it('payload-traceable: a fabricated % is NOT grounding when analysis payload exists', () => {
    const surfaces = { G1: surf({ payloadPercentages: [78, 18], winPctByLabel: { 'Option A': 78 }, optionLabels: ['Option A'] }) };
    // Cites 55% — absent from the payload (78/18) and names no label -> not grounded.
    const d = pqGrounding([row({ turn: 'G1', assistantText: 'This option wins about 55% of the time.' })], [], surfaces);
    expect(d.value).toBe(0);
    expect((d.details as any).traceableNumberFraction).toBe(0);
  });

  it('payload-traceable: a real % counts and traceableNumberFraction is 1.0', () => {
    const surfaces = { G1: surf({ payloadPercentages: [78, 18], winPctByLabel: { 'Option A': 78 }, optionLabels: ['Option A'] }) };
    const d = pqGrounding([row({ turn: 'G1', assistantText: 'It wins about 78% of the time.' })], [], surfaces);
    expect(d.value).toBe(1);
    expect((d.details as any).traceableNumberFraction).toBe(1);
  });
});

describe('PQ4 chip-correctness (higher-better)', () => {
  it('scores chip presence on either/or question turns and counts identical repeats', () => {
    const twoChips = [
      { id: 'c1', label: 'Ship fast' },
      { id: 'c2', label: 'Hire lead' },
    ];
    const d = pqChipCorrectness([
      row({ turn: 'Q1', assistantText: 'Would you rather ship fast, or hire the lead?', chips: twoChips }),
      row({ turn: 'Q2', assistantText: 'Would you prefer A or B?', chips: [] }),
      row({ turn: 'Q3', assistantText: 'Would you rather ship fast, or hire the lead?', chips: twoChips }),
    ]);
    expect(d.value).toBeCloseTo(2 / 3, 3); // Q1,Q3 have >=2 chips; Q2 does not
    expect((d.details as any).identicalRepeats).toBe(1); // Q3 repeats Q1's chip set
  });
  it('is null when no qualifying question turns exist', () => {
    expect(pqChipCorrectness([row({ turn: 'T1', assistantText: 'Analysis complete.' })]).value).toBeNull();
  });
});

describe('PQ5 guard-cleanliness (lower-better, gating)', () => {
  it('sums guard hits across turns and is unmeasurable without guardHits', () => {
    const d = pqGuardCleanliness([
      row({ turn: 'T1', guardHits: { ...CLEAN_GUARDS, mutationLanguage: true } }),
      row({ turn: 'T2', guardHits: { ...CLEAN_GUARDS, forbidden: 'phrase' } }),
    ]);
    expect(d.gating).toBe(true);
    expect(d.value).toBe(2);
    const noHits = pqGuardCleanliness([row({ turn: 'T1', guardHits: undefined })]);
    expect(noHits.value).toBeNull();
  });
});

describe('PQ6 coherence (lower-better, gating)', () => {
  it('flags a success claim while a proposal is still held', () => {
    const surfaces = { T1: surf({ hasHeldProposal: true }) };
    const d = pqCoherence([row({ turn: 'T1', guardHits: { ...CLEAN_GUARDS, structuralSuccessClaim: true } })], surfaces);
    expect(d.value).toBe(1);
    expect((d.details as any).contradictions[0].kind).toBe('success-claim-with-held-proposal');
  });

  it('flags a win-claim that contradicts the analysis blocks', () => {
    const surfaces = { T1: surf({ winProbabilities: { 'Option A': 0.8, 'Option B': 0.2 }, leadingOptionLabel: 'Option A', optionLabels: ['Option A', 'Option B'], winPctByLabel: { 'Option A': 80, 'Option B': 20 } }) };
    const d = pqCoherence([row({ turn: 'T1', assistantText: 'Option B comes out ahead here.' })], surfaces);
    expect(d.value).toBe(1);
    expect((d.details as any).contradictions[0].kind).toBe('win-claim-contradicts-blocks');
  });

  it('does not flag a coherent win-claim', () => {
    const surfaces = { T1: surf({ winProbabilities: { 'Option A': 0.8, 'Option B': 0.2 }, leadingOptionLabel: 'Option A', optionLabels: ['Option A', 'Option B'], winPctByLabel: { 'Option A': 80, 'Option B': 20 } }) };
    const d = pqCoherence([row({ turn: 'T1', assistantText: 'Option A comes out ahead here.' })], surfaces);
    expect(d.value).toBe(0);
  });

  it('flags a prose % that disagrees with the payload win-% (B1 fragment-contradiction detector)', () => {
    const surfaces = { T1: surf({ optionLabels: ['Option A', 'Option B'], winPctByLabel: { 'Option A': 80, 'Option B': 20 }, leadingOptionLabel: 'Option A' }) };
    // Prose attributes ~50% to Option A, but the payload win-% for Option A is 80%.
    const d = pqCoherence([row({ turn: 'T1', assistantText: 'Option A wins roughly 50% of the time.' })], surfaces);
    expect((d.details as any).contradictions.some((c: any) => c.kind === 'number-disagrees-with-payload')).toBe(true);
  });

  it('does not flag a prose % that matches the payload', () => {
    const surfaces = { T1: surf({ optionLabels: ['Option A', 'Option B'], winPctByLabel: { 'Option A': 80, 'Option B': 20 }, leadingOptionLabel: 'Option A' }) };
    const d = pqCoherence([row({ turn: 'T1', assistantText: 'Option A wins about 80% of the time.' })], surfaces);
    expect((d.details as any).contradictions.some((c: any) => c.kind === 'number-disagrees-with-payload')).toBe(false);
  });
});

describe('runPromptDims', () => {
  it('returns all six prompt dims exactly once and unions surface option labels into grounding', () => {
    const dims = runPromptDims(
      [row({ turn: 'T1', assistantText: 'Option A leads by a wide margin.' })],
      { surfacesByTurn: { T1: surf({ leadingOptionLabel: 'Option A', optionLabels: ['Option A'] }) } },
    );
    expect(dims.map((d) => d.dim.split('-')[0]).sort()).toEqual(['PQ1', 'PQ2', 'PQ3', 'PQ4', 'PQ5', 'PQ6']);
    // "Option A" came only from the surface, yet grounding recognises it.
    expect(dims.find((d) => d.dim === 'PQ3-grounding')!.value).toBe(1);
  });
});
