/**
 * ⛔ "WHAT CHANGED?" NEVER NAMES A LEADER CONFINEMENT WITHHELD — the sibling of
 * `buildRerunAcknowledgement`'s guard (coaching-signals.ts, #1857 commit 3).
 *
 * Review of #1857 at 22d19bfa (B3, independent routine): the run-comparison gate
 * licensed each run's leader from its CONSTRAINT verdict alone
 * (`readMayNameLeadingOptionVerdictForFact`). An automatic run's leader is never
 * PRESENTED — `mayPresentLeaderClaimForFact` needs a user request — so after the
 * construction auto-run and the user's first explicit Run, "What changed?" said
 * "Offshore still leads" / "Offshore scored highest most often in the earlier
 * run" about a leader the user was never given. The gate now conjoins
 * `wasAnalysisRequestedByUser` per run; the existing withheld-prior arm does the rest.
 *
 * Fixture shape and gate call as `run-comparison-per-run-authorization.test.ts`;
 * the stamp is the production builder's, bound by identity.
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  tryRunComparisonGate,
  WITHHELD_PRIOR_LEADER_COMPARISON_TEXT,
} from '../run-comparison-gate.js';
import {
  RUN_PROVENANCE_ENRICHMENT_KEY,
  buildAutoRunProvenance,
  buildConstructionAutoRunProvenance,
} from '../../context/run-initiator.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

function envelope(options: Array<{ id: string; label: string; win: number }>, band: string): V2RunResponseEnvelope {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({ option_id: o.id, option_label: o.label, win_probability: o.win, outcome: { n_samples: 10_000 } })),
    robustness_synthesis: { overall_assessment: band },
  } as unknown as V2RunResponseEnvelope;
}

/** A run whose CONSTRAINT verdict permits; `provenance` is spread into enrichment as the writer spreads it. */
function permittedRun(env: V2RunResponseEnvelope, at: string, hash: string, provenance: object | null): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: { ...env, ...(provenance === null ? {} : { [RUN_PROVENANCE_ENRICHMENT_KEY]: provenance }) },
      computed_at: at,
      graph_hash_at_run: hash,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    },
  } as unknown as HandlerFact;
}

const SAME_LEADER_PRIOR = envelope([{ id: 'a', label: 'Offshore', win: 0.6 }, { id: 'b', label: 'Onshore', win: 0.4 }], 'low');
const SAME_LEADER_CURRENT = envelope([{ id: 'a', label: 'Offshore', win: 0.76 }, { id: 'b', label: 'Onshore', win: 0.24 }], 'high');
const FLIPPED_CURRENT = envelope([{ id: 'b', label: 'Onshore', win: 0.55 }, { id: 'a', label: 'Offshore', win: 0.45 }], 'high');

const K = 'graph_registration:00000000-0000-4000-8000-0000000000aa';
const PRIORS = {
  construction: () => buildConstructionAutoRunProvenance(K),
  draft: () => buildAutoRunProvenance('draft-turn-abc'),
};

function ask(current: V2RunResponseEnvelope, priorProvenance: object | null) {
  const out = tryRunComparisonGate({
    message: 'What changed?',
    priorFacts: [
      permittedRun(current, '2026-09-24T12:00:00.000Z', 'h-current', null),
      permittedRun(SAME_LEADER_PRIOR, '2026-09-24T11:00:00.000Z', 'h-prior', priorProvenance),
    ],
    freshness: 'fresh',
    mayNameLeadingOption: true,
  });
  expect(out.matched).toBe(true);
  if (!out.matched) throw new Error('unreachable');
  expect(out.mode).toBe('compared');
  return out.assistant_text;
}

describe.each(Object.entries(PRIORS))('an AUTO-INITIATED (%s) prior run — its leader was never presented', (_kind, stamp) => {
  it('RED: same leader — no "still leads", no widened lead, no prior leader named', () => {
    const text = ask(SAME_LEADER_CURRENT, stamp());
    expect(text).not.toMatch(/\bstill leads\b/i);
    expect(text).not.toMatch(/its lead has (?:widened|narrowed)/i);
    expect(text).toContain(WITHHELD_PRIOR_LEADER_COMPARISON_TEXT);
  });

  it('RED: leader flipped — the earlier run\'s leader is not named', () => {
    const text = ask(FLIPPED_CURRENT, stamp());
    expect(text).not.toMatch(/Offshore scored highest most often in the earlier run/i);
    expect(text).not.toMatch(/has changed/i);
    expect(text).toContain(WITHHELD_PRIOR_LEADER_COMPARISON_TEXT);
    // Anti-over-suppression: the CURRENT run is user-requested and permitted.
    expect(text).toContain('Onshore');
  });
});

describe('CONTRAST: the same pair with a USER-requested prior keeps its comparison', () => {
  it('same leader → "still leads"', () => {
    expect(ask(SAME_LEADER_CURRENT, null)).toMatch(/Offshore still leads/);
  });
  it('flipped → the earlier leader is named', () => {
    expect(ask(FLIPPED_CURRENT, null)).toMatch(/Offshore/);
    expect(ask(FLIPPED_CURRENT, null)).not.toContain(WITHHELD_PRIOR_LEADER_COMPARISON_TEXT);
  });
});
