/**
 * A5 · result refs by label (CEE half) — DL #70 5855437928, Canonical's ruling.
 *
 * `result.win_probabilities` is a DISPLAY map keyed by option LABEL (fallback option_id; producer
 * `extractWinProbabilities`, run-analysis.ts), while `result.leading_option_id` is an option ID.
 * The prior-fact fallback's minimal branch looked the ID up in the LABEL-keyed map, missed whenever
 * the option has a label, and then reported the leader at an invented 0.
 *
 * FIXTURE: the served analysis_result block of staging bundle paul-08bf9a1f (CEE 263dbd5), scrubbed —
 * see the fixture's `_source`. That run's leader was withheld (`leading_option_id: null`), so the
 * leader here is the one the handler's own rule would name on the same records: the strict maximum
 * among five `computed` options, `features_pro_price_rise` (0.4115…).
 *
 * REACH, stated plainly (measured, not assumed — see the CONTROL row): every fact the handler has
 * written since it shipped (3ccca3d3) carries `enrichment` with id-bearing option records, so
 * buildAnalysisFromPriorFacts answers from its ENRICHED branch and the served shape was never read as
 * 0. The minimal branch meets a declared leader only on a fact with no enrichment, or when
 * `compactAnalysis` faults; the fact selector admits no failed/blocked envelope. So the resolution
 * through the same result's option records is pinned at the helper, and the reachable end-to-end
 * change is "absent, not 0".
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  buildAnalysisFromPriorFacts,
  resolveLeadingWinProbability,
} from '../analysis-fallback.js';

type ServedOptionRecord = {
  option_id: string;
  option_label: string;
  label: string;
  status: string;
  win_probability: number;
};
type ServedFixture = {
  analysis_result: {
    leading_option_id: string | null;
    win_probabilities: Record<string, number>;
    enrichment: {
      option_comparison: ServedOptionRecord[];
      decision_brief: { options: { option_id: string; label: string; win_probability: number }[] };
    };
  };
};
type RunAnalysisResult = Extract<HandlerFact, { fact_type: 'run_analysis' }>['result'];

const served = JSON.parse(
  readFileSync(new URL('./fixtures/served-analysis-result-08bf9a1f.json', import.meta.url), 'utf8'),
) as ServedFixture;

const LEADER = 'features_pro_price_rise';
const LEADER_LABEL = 'Features + Pro price rise';

const servedResult = () => structuredClone(served.analysis_result);

function fact(
  result: Pick<RunAnalysisResult, 'leading_option_id'> & Partial<Omit<RunAnalysisResult, 'leading_option_id'>>,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: '00000000-0000-4000-8000-000000000001',
      summary: 'Prior run',
      ...result,
    },
  };
}

describe('A5 · the leading option\'s probability is resolved by ID, never read as 0', () => {
  it('PRECONDITIONS (served shape): the display map is keyed by LABEL, the leader is an ID, and the same result carries the id→probability record', () => {
    const r = servedResult();
    expect(Object.hasOwn(r.win_probabilities, LEADER), 'the old id lookup misses on the served map').toBe(false);
    expect(Object.keys(r.win_probabilities).sort()).toEqual(
      r.enrichment.option_comparison.map((o) => o.option_label).sort(),
    );
    const leaderRecord = r.enrichment.option_comparison.find((o) => o.option_id === LEADER)!;
    expect(leaderRecord.option_label).toBe(LEADER_LABEL);
    // The leader is the strict maximum among `computed` records (the handler's R2 rule on these records).
    const max = Math.max(...r.enrichment.option_comparison.map((o) => o.win_probability));
    expect(leaderRecord.win_probability).toBe(max);
    expect(r.enrichment.option_comparison.filter((o) => o.win_probability === max)).toHaveLength(1);
  });

  it('RED (served 263dbd5): each option ID resolves to ITS OWN probability — the one the label-keyed map holds under that option\'s label', () => {
    const r = servedResult();
    for (const o of r.enrichment.option_comparison) {
      // Bound by identity: the value the display map shows beside THIS option's label, reached from THIS option's id.
      expect(
        resolveLeadingWinProbability(r.win_probabilities, o.option_id, r.enrichment),
        o.option_id,
      ).toBe(r.win_probabilities[o.option_label]);
    }
    expect(resolveLeadingWinProbability(r.win_probabilities, LEADER, r.enrichment)).toBe(0.41153999999999713);
  });

  it('CONTRAST: the same result carries no probability for the leader → ABSENT (null), never 0', () => {
    const r = servedResult();
    delete r.win_probabilities[LEADER_LABEL];
    const withoutLeaderProbability = {
      option_comparison: r.enrichment.option_comparison.map((o) =>
        o.option_id === LEADER ? { ...o, win_probability: undefined } : o,
      ),
      decision_brief: {
        options: r.enrichment.decision_brief.options.map((o) =>
          o.option_id === LEADER ? { ...o, win_probability: undefined } : o,
        ),
      },
    };
    expect(resolveLeadingWinProbability(r.win_probabilities, LEADER, withoutLeaderProbability)).toBeNull();
    expect(resolveLeadingWinProbability(r.win_probabilities, LEADER, null)).toBeNull();
  });

  it('RED (buildAnalysisFromPriorFacts, minimal branch — a fact with no enrichment, label-keyed map): the leader is ABSENT (null), never 0, and never guessed through the current graph\'s label', () => {
    const r = servedResult();
    const summary = buildAnalysisFromPriorFacts(
      [fact({ leading_option_id: LEADER, win_probabilities: r.win_probabilities })],
      // The CURRENT graph names the leader with the same words the map is keyed by — still not an identity.
      [{ id: LEADER, label: LEADER_LABEL }],
    )!;
    expect(summary.winner.option_id).toBe(LEADER);
    expect(summary.winner.option_label).toBe(LEADER_LABEL);
    expect(summary.winner.win_probability).toBeNull();
    // The display list is untouched: still the label-keyed map, sorted by probability.
    expect(summary.options.map((o) => [o.option_id, o.win_probability])).toEqual(
      Object.entries(r.win_probabilities).sort((a, b) => b[1] - a[1]),
    );
  });

  it('CONTROL (served shape, enrichment present): the ENRICHED branch answers with the leader\'s own probability — before and after this change', () => {
    const r = servedResult();
    const summary = buildAnalysisFromPriorFacts([
      fact({
        leading_option_id: LEADER,
        win_probabilities: r.win_probabilities,
        enrichment: { ...r.enrichment, analysis_status: 'computed' },
      }),
    ])!;
    expect(summary.winner.option_id).toBe(LEADER);
    expect(summary.winner.win_probability).toBe(r.win_probabilities[LEADER_LABEL]);
  });

  it('UNCHANGED when the datum is found under the id itself (id-keyed map, or an option with no label): same value as before', () => {
    const summary = buildAnalysisFromPriorFacts([
      fact({ leading_option_id: 'opt-a', win_probabilities: { 'opt-a': 0.62, 'opt-b': 0.38 } }),
    ])!;
    expect(summary.winner.win_probability).toBe(0.62);
    // The id-keyed hit wins even when the same result's record says otherwise (the map is what the fact recorded).
    expect(
      resolveLeadingWinProbability({ 'opt-a': 0.62 }, 'opt-a', {
        option_comparison: [{ option_id: 'opt-a', win_probability: 0.5 }],
      }),
    ).toBe(0.62);
  });
});
