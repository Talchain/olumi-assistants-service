/**
 * ⛔ `run_delta` NEVER CARRIES THE LEADER OF A RUN NOBODY ASKED FOR (review of #1857, B4).
 *
 * `run_delta` reaches the UI's "What's changed" section ("the option with the
 * highest score moved from Offshore to Onshore") and the routing prompt
 * (RUN_DELTA_INSTRUCTION licenses naming any option it carries an id for). Its
 * per-run entitlement read the CONSTRAINT verdict only, so after a construction
 * auto-run (leader confined, never presented) and the user's first explicit Run,
 * it carried the automatic run's leader. It now uses the one per-run authority
 * shared with the "What changed?" gate, `mayPresentComparedRunLeader`.
 *
 * Fixture shape as `build-run-delta.test.ts`; the stamp is the production builder's.
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { buildRunDelta } from '../build-run-delta.js';
import { mayPresentComparedRunLeader, mayPresentComparedRunVerdicts } from '../compared-run-leader.js';
import {
  RUN_PROVENANCE_ENRICHMENT_KEY,
  buildAutoRunProvenance,
  buildConstructionAutoRunProvenance,
} from '../../context/run-initiator.js';

function fact(options: ReadonlyArray<{ id: string; label: string; win: number }>, seed: string, hash: string, at: string, provenance: object | null): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: options.map((o) => ({ option_id: o.id, option_label: o.label, win_probability: o.win })),
        meta: { seed_used: seed, n_samples: 10_000 },
        ...(provenance === null ? {} : { [RUN_PROVENANCE_ENRICHMENT_KEY]: provenance }),
      },
      computed_at: at,
      graph_hash_at_run: hash,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    },
  } as unknown as HandlerFact;
}

const PRIOR = [{ id: 'opt-a', label: 'Offshore', win: 0.62 }, { id: 'opt-b', label: 'Onshore', win: 0.38 }] as const;
const CURRENT = [{ id: 'opt-a', label: 'Offshore', win: 0.45 }, { id: 'opt-b', label: 'Onshore', win: 0.55 }] as const;
const K = 'graph_registration:00000000-0000-4000-8000-0000000000bb';

function build(priorProvenance: object | null) {
  const prior = fact(PRIOR, '111', 'hash-a', '2026-09-24T11:00:00.000Z', priorProvenance);
  const current = fact(CURRENT, '222', 'hash-b', '2026-09-24T12:00:00.000Z', null);
  return buildRunDelta({ priorFacts: [current, prior], mayNameLeadingOption: true });
}

/**
 * B5 (5824387982): withholding only the leader id was not enough — `win_probabilities`
 * ("Offshore: 62% → 45%") names it by arithmetic, and confinement withholds those scores
 * too. A pair with an unrequested run gets NO run_delta.
 */
describe.each([
  ['auto_post_construction', () => buildConstructionAutoRunProvenance(K)],
  ['auto_post_draft', () => buildAutoRunProvenance('draft-turn-abc')],
])('an AUTO-INITIATED (%s) prior run', (_kind, stamp) => {
  it('RED: no run_delta at all — the refusal names why; no id, no score of the automatic run ships', () => {
    const out = build(stamp());
    expect(out).toEqual({ kind: 'none', reason: 'unrequested_run_in_pair' });
    expect(JSON.stringify(out)).not.toContain('0.62');
    expect(JSON.stringify(out)).not.toContain('opt-a');
  });
});

describe('CONTRAST: a USER-requested prior keeps the whole comparison', () => {
  it('prior opt-a → current opt-b, changed, with both runs\' scores', () => {
    const out = build(null);
    if (out.kind !== 'ok') throw new Error(`control: the pair must be comparable, got ${JSON.stringify(out)}`);
    expect(out.delta.leader).toMatchObject({ changed: true, prior_leading_option_id: 'opt-a', current_leading_option_id: 'opt-b' });
    expect(out.delta.win_probabilities?.find((w) => w.option_id === 'opt-a')?.prior).toBe(0.62);
  });
});

describe('mayPresentComparedRunLeader — the three conjuncts, each discriminating', () => {
  const userRun = fact(PRIOR, '1', 'h', '2026-09-24T11:00:00.000Z', null);
  it('all three hold → true', () => expect(mayPresentComparedRunLeader(true, userRun)).toBe(true));
  it('turn withholds → false', () => expect(mayPresentComparedRunLeader(false, userRun)).toBe(false));
  it('auto-initiated → false', () =>
    expect(mayPresentComparedRunLeader(true, fact(PRIOR, '1', 'h', '2026-09-24T11:00:00.000Z', buildConstructionAutoRunProvenance(K)))).toBe(false));
  it('verdict withholds → false', () => {
    const withheld = fact(PRIOR, '1', 'h', '2026-09-24T11:00:00.000Z', null) as unknown as { result: { constraint_verdict: Record<string, unknown> } };
    withheld.result.constraint_verdict = { may_name_leading_option: false, constraint_verdict_state: 'evaluated_infeasible' };
    expect(mayPresentComparedRunLeader(true, withheld as unknown as HandlerFact)).toBe(false);
  });
});

describe('mayPresentComparedRunVerdicts — the requested-run half, on its own', () => {
  it('user-requested → true; automatic (both initiators) → false', () => {
    expect(mayPresentComparedRunVerdicts(fact(PRIOR, '1', 'h', '2026-09-24T11:00:00.000Z', null))).toBe(true);
    expect(mayPresentComparedRunVerdicts(fact(PRIOR, '1', 'h', '2026-09-24T11:00:00.000Z', buildConstructionAutoRunProvenance(K)))).toBe(false);
    expect(mayPresentComparedRunVerdicts(fact(PRIOR, '1', 'h', '2026-09-24T11:00:00.000Z', buildAutoRunProvenance('d')))).toBe(false);
  });
});
