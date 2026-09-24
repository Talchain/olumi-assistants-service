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
import { mayPresentComparedRunLeader } from '../compared-run-leader.js';
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

function delta(priorProvenance: object | null) {
  const prior = fact(PRIOR, '111', 'hash-a', '2026-09-24T11:00:00.000Z', priorProvenance);
  const current = fact(CURRENT, '222', 'hash-b', '2026-09-24T12:00:00.000Z', null);
  const out = buildRunDelta({ priorFacts: [current, prior], mayNameLeadingOption: true });
  if (out.kind !== 'ok') throw new Error(`control: the pair must be comparable, got ${JSON.stringify(out)}`);
  return out.delta;
}

describe.each([
  ['auto_post_construction', () => buildConstructionAutoRunProvenance(K)],
  ['auto_post_draft', () => buildAutoRunProvenance('draft-turn-abc')],
])('an AUTO-INITIATED (%s) prior run', (_kind, stamp) => {
  it('RED: its leader id is absent and no change is claimed; the user-requested current side keeps its id', () => {
    const d = delta(stamp());
    expect(d.leader).not.toHaveProperty('prior_leading_option_id');
    expect(d.leader.changed).toBe(false);
    expect(d.leader.current_leading_option_id).toBe('opt-b');
  });
});

describe('CONTRAST: a USER-requested prior keeps both ids and the change', () => {
  it('prior opt-a → current opt-b, changed', () => {
    const d = delta(null);
    expect(d.leader).toMatchObject({ changed: true, prior_leading_option_id: 'opt-a', current_leading_option_id: 'opt-b' });
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
