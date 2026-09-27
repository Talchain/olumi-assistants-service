/**
 * A5 · result refs by id (CEE half) — DL #70 5855437928; Canonical's ruling #70 5856134042.
 *
 * `result.win_probabilities` is a DISPLAY map keyed by option LABEL (option_id only for an unlabelled
 * option; producer `extractWinProbabilities`, run-analysis.ts), while `result.leading_option_id` is an
 * option ID. The prior-fact fallback's minimal branch looked the ID up in the LABEL-keyed map, missed
 * whenever the option has a label, and then reported the leader at an invented 0.
 *
 * FIXTURE: the served analysis_result block of staging bundle paul-08bf9a1f (CEE 263dbd5), scrubbed —
 * see the fixture's `_source`. That run's leader was withheld (`leading_option_id: null`), so the
 * leader here is the one the handler's own rule would name on the same records: the strict maximum
 * among five `computed` options, `features_pro_price_rise` (0.4115…).
 *
 * REACH (see the CONTROL row): every fact the handler writes carries `enrichment`, so the fallback
 * answers from its ENRICHED branch and never read the served shape as 0. The minimal branch meets a
 * declared leader on (1) a fact with no enrichment — rows (b2) — or (2) an enrichment that
 * `compactAnalysis` returns null for through its own catch (rows (a) and (b)). (2) is reached here by
 * making `compactAnalysis` return null — its documented fault contract — never by a hand-built envelope.
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  buildAnalysisFromPriorFacts,
  resolveLeadingWinProbability,
} from '../analysis-fallback.js';

// `compactAnalysis` answers normally unless a row switches its fault on (catch → null).
const compactFault = vi.hoisted(() => ({ on: false }));
vi.mock('../../../orchestrator/context/analysis-compact.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../orchestrator/context/analysis-compact.js')>();
  return {
    ...actual,
    compactAnalysis: (...args: Parameters<typeof actual.compactAnalysis>) =>
      compactFault.on ? null : actual.compactAnalysis(...args),
  };
});
afterEach(() => {
  compactFault.on = false;
});

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

/** The same served result, with every trace of the leader's probability removed (map key and records). */
function servedWithoutLeaderProbability() {
  const r = servedResult();
  delete r.win_probabilities[LEADER_LABEL];
  const strip = <T extends { option_id: string; win_probability?: number }>(o: T) => {
    if (o.option_id !== LEADER) return o;
    const { win_probability: _dropped, ...rest } = o;
    return rest;
  };
  return {
    win_probabilities: r.win_probabilities,
    enrichment: {
      option_comparison: r.enrichment.option_comparison.map(strip),
      decision_brief: { options: r.enrichment.decision_brief.options.map(strip) },
    },
  };
}

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

  it('(a) RED (served 263dbd5, minimal branch): the label-keyed map holds the leader\'s probability → the fallback reports THAT probability, not 0', () => {
    const r = servedResult();
    compactFault.on = true;
    const summary = buildAnalysisFromPriorFacts([
      fact({ leading_option_id: LEADER, win_probabilities: r.win_probabilities, enrichment: r.enrichment }),
    ])!;
    // The minimal branch answered (its options are the display map's keys, not the records' ids).
    expect(summary.options.map((o) => o.option_id)).toContain(LEADER_LABEL);
    expect(summary.winner.option_id).toBe(LEADER);
    // Bound by identity: the value the display map shows beside THIS leader's label.
    expect(summary.winner.win_probability).toBe(r.win_probabilities[LEADER_LABEL]);
    expect(summary.winner.win_probability).toBe(0.41153999999999713);
  });

  it('(a) RED (helper): each option ID resolves to ITS OWN probability — the one the label-keyed map holds under that option\'s label', () => {
    const r = servedResult();
    for (const o of r.enrichment.option_comparison) {
      expect(
        resolveLeadingWinProbability(r.win_probabilities, o.option_id, r.enrichment),
        o.option_id,
      ).toBe(r.win_probabilities[o.option_label]);
    }
  });

  it('(b) CONTRAST (served 263dbd5, minimal branch): the same result carries NO probability for the leader → ABSENT (null), never 0', () => {
    const r = servedWithoutLeaderProbability();
    compactFault.on = true;
    const summary = buildAnalysisFromPriorFacts([
      fact({ leading_option_id: LEADER, win_probabilities: r.win_probabilities, enrichment: r.enrichment }),
    ])!;
    expect(summary.winner.option_id).toBe(LEADER);
    expect(summary.winner.win_probability).toBeNull();
    // The rest of the result is untouched: the other four options keep their own figures.
    expect(summary.options.map((o) => [o.option_id, o.win_probability])).toEqual(
      Object.entries(r.win_probabilities).sort((a, b) => b[1] - a[1]),
    );
  });

  it('(b2) CONTRAST (a fact with no enrichment): no id-bearing record ties the leader to a probability → ABSENT (null), never 0, and never guessed through the current graph\'s label', () => {
    const r = servedResult();
    const summary = buildAnalysisFromPriorFacts(
      [fact({ leading_option_id: LEADER, win_probabilities: r.win_probabilities })],
      // The CURRENT graph names the leader with the same words the map is keyed by — still not an identity.
      [{ id: LEADER, label: LEADER_LABEL }],
    )!;
    expect(summary.winner.option_id).toBe(LEADER);
    expect(summary.winner.option_label).toBe(LEADER_LABEL);
    expect(summary.winner.win_probability).toBeNull();
    expect(resolveLeadingWinProbability(r.win_probabilities, LEADER, null)).toBeNull();
    // The display list is untouched: still the label-keyed map, sorted by probability.
    expect(summary.options.map((o) => [o.option_id, o.win_probability])).toEqual(
      Object.entries(r.win_probabilities).sort((a, b) => b[1] - a[1]),
    );
  });

  it('CONTROL (served shape, enrichment present, compactAnalysis answering): the ENRICHED branch reports the leader\'s own probability — before and after this change', () => {
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

  it('PIN — UNCHANGED when the datum is found under the id itself (id-keyed map, or an option with no label): same value as before', () => {
    const summary = buildAnalysisFromPriorFacts([
      fact({ leading_option_id: 'opt-a', win_probabilities: { 'opt-a': 0.62, 'opt-b': 0.38 } }),
    ])!;
    expect(summary.winner.win_probability).toBe(0.62);
  });

  it('(helper) a hit under the id itself wins even when the same result\'s record says otherwise — the map is what the fact recorded', () => {
    expect(
      resolveLeadingWinProbability({ 'opt-a': 0.62 }, 'opt-a', {
        option_comparison: [{ option_id: 'opt-a', win_probability: 0.5 }],
      }),
    ).toBe(0.62);
  });
});
