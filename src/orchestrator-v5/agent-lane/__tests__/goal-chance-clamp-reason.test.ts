/**
 * PLoT #422 (AIQ 5893355501; code set ACK 5893824972): a run that withheld its goal figures because the user's own link
 * size on the goal's path was cut carries `GOAL_FIGURES_USER_EFFECT_CLAMPED`. CEE reads it exactly like #416's code —
 * the same withheld set — and the Agent says PLoT's reason. Messages are PLoT's served words (c96fc4bb on `cdf3422`).
 */
import { describe, it, expect } from 'vitest';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import {
  goalFiguresWithheldWarning,
  readOptionResultSources,
  runWithheldGoalFigures,
} from '../../../orchestrator/context/option-result-source.js';

const OPENING = 'This run doesn’t yet show each option’s chance of meeting your goal.';
const CUT = {
  code: 'GOAL_FIGURES_USER_EFFECT_CLAMPED',
  severity: 'warning',
  node_ids: ['paying_subscribers', 'mrr'],
  message: 'Not shown. Your size for how ‘Paying subscribers’ moves ‘MRR’ is bigger than this model\'s scale can hold, so the run couldn\'t use it at full size, and the figures that depend on it would be wrong.',
};
const IDENTITY = {
  code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED',
  node_ids: ['mrr'],
  message: 'Not shown. Olumi reads \'MRR\' as \'Pro plan price\' × \'Paying subscribers\', but that hasn\'t been confirmed, so this run gives no chance of reaching the target for \'MRR\'.',
};
const block = (warnings: unknown[]) => ({ enrichment: { inference_warnings: warnings } });

describe('the Agent reads PLoT #422\'s cut-link withhold', () => {
  it('the cut code alone → withheld, PLoT\'s reason said after the opening, the link\'s ends named', () => {
    const g = goalChanceWithheldForAgent(block([CUT]));
    expect(g?.withheld).toBe(true);
    expect(g?.say).toBe(`${OPENING} Your size for how ‘Paying subscribers’ moves ‘MRR’ is bigger than this model's scale can hold, so the run couldn't use it at full size, and the figures that depend on it would be wrong.`);
    expect(g?.node_ids).toEqual(['paying_subscribers', 'mrr']);
  });

  it('both reasons (the served c96 shape) → identity first, then the cut; the two are never merged into one cause', () => {
    const g = goalChanceWithheldForAgent(block([CUT, IDENTITY]));
    expect(g?.say.startsWith(`${OPENING} Olumi reads 'MRR'`)).toBe(true);
    expect(g?.say).toContain('Your size for how ‘Paying subscribers’ moves ‘MRR’');
    expect(g?.node_ids).toEqual(['paying_subscribers', 'mrr']);
  });

  it('CONTROL — the identity code alone keeps its reason byte-identical after the new opening', () => {
    expect(goalChanceWithheldForAgent(block([IDENTITY]))?.say)
      .toBe(`${OPENING} Olumi reads 'MRR' as 'Pro plan price' × 'Paying subscribers', but that hasn't been confirmed, so this run gives no chance of reaching the target for 'MRR'.`);
  });

  it('CONTROL — any other code withholds nothing', () => {
    expect(goalChanceWithheldForAgent(block([{ code: 'EDGE_STRENGTH_CLAMPED', message: 'Olumi\'s estimate … was capped.' }]))).toBeUndefined();
    expect(goalChanceWithheldForAgent(block([]))).toBeUndefined();
  });
});

describe('the compact / sources readers treat the cut code as a withhold', () => {
  const envelope = {
    inference_warnings: [CUT],
    option_comparison: [{ option_id: 'a', outcome: { n_samples: 1000 } }],
    results: [{ option_id: 'a', win_probability: 0.7 }],
  };
  it('runWithheldGoalFigures + the warning itself', () => {
    expect(runWithheldGoalFigures(envelope)).toBe(true);
    expect(goalFiguresWithheldWarning(envelope)?.code).toBe('GOAL_FIGURES_USER_EFFECT_CLAMPED');
  });
  it('ABSENT STAYS ABSENT — only the current carrier is read, never a downstream copy with a win probability', () => {
    expect(readOptionResultSources(envelope)).toEqual([[{ option_id: 'a', outcome: { n_samples: 1000 } }]]);
  });
  it('CONTROL — no withhold code → every source is read as before', () => {
    const plain = { ...envelope, inference_warnings: [] };
    expect(runWithheldGoalFigures(plain)).toBe(false);
    expect(readOptionResultSources(plain).length).toBeGreaterThan(1);
  });
});
