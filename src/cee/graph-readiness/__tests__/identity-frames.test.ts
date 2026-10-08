/**
 * A stated identity with a frameless part blocks readiness with the unit question (Canvas #72 5898075514; R3 5898098452),
 * mirroring ISL rule 1 and PLoT's forwarding: served Paul MRR run 1 (`served-paul-mrr-ed49d44.json`).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { statedIdentityFrameGaps } from '../identity-frames.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Json = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../../orchestrator-v5/agent-lane/__tests__/fixtures/served-paul-mrr-ed49d44.json', import.meta.url), 'utf8')) as { runs: { run: number; graph: Json }[] };
const run1 = (): Json => structuredClone(FX.runs.find((r) => r.run === 1)!.graph);
const node = (g: Json, id: string): Json => g.nodes.find((n: Json) => n.id === id);
/** The user's confirmed product (what #2292's Yes writes), with "Paying subscribers" left with NO frame. */
const statedFrameless = (): Json => {
  const g = run1();
  node(g, 'mrr').nonlinear_identity.stated_in_brief = true;
  const s = node(g, 'paying_subscribers');
  delete s.observed_state.cap; delete s.scale_frame; s.observed_state.value = s.observed_state.raw_value; // the pair gives no frame
  return g;
};

describe('a stated identity needs a frame on every part before the Run', () => {
  it('stated and fully framed (the confirmed MRR product) → no gap, readiness unchanged', () => {
    const g = run1(); node(g, 'mrr').nonlinear_identity.stated_in_brief = true;
    expect(statedIdentityFrameGaps(g)).toEqual([]);
    expect(assessCanonicalAnalysisReadiness(g).blockingIssues.filter((i) => i.code === 'IDENTITY_FRAME_MISSING')).toEqual([]);
  });

  it('Olumi\'s UNCONFIRMED reading with a frameless part → no gap (PLoT does not forward it; ISL never refuses it)', () => {
    const g = statedFrameless(); node(g, 'mrr').nonlinear_identity.stated_in_brief = false;
    expect(statedIdentityFrameGaps(g)).toEqual([]);
  });

  it('stated with a frameless part → readiness BLOCKED with the unit question, required of the user', () => {
    const g = statedFrameless();
    expect(statedIdentityFrameGaps(g)).toEqual([{ id: 'paying_subscribers', label: node(g, 'paying_subscribers').label, identity_id: 'mrr', identity_label: node(g, 'mrr').label }]);
    const a = assessCanonicalAnalysisReadiness(g);
    const issue = a.blockingIssues.find((i) => i.code === 'IDENTITY_FRAME_MISSING');
    expect(issue).toEqual(expect.objectContaining({ category: 'numeric_integrity', repairability: 'human_input_required', factor_id: 'paying_subscribers' }));
    expect(issue!.message).toMatch(/^What unit is ".+" in\? Olumi needs it to work out ".+" from it\.$/);
    expect(a.safeToAnalyse).toBe(false);
  });

  it('each PLoT frame source counts: cap, scale_frame, the value/raw pair, a goal\'s goal_threshold_cap', () => {
    const one = (patch: (s: Json) => void): number => { const g = statedFrameless(); patch(node(g, 'paying_subscribers')); return statedIdentityFrameGaps(g).length; };
    expect(one((s) => { s.observed_state.cap = 5000; })).toBe(0);
    expect(one((s) => { s.scale_frame = 5000; })).toBe(0);
    expect(one((s) => { s.observed_state.value = 0.3; s.observed_state.raw_value = 1500; })).toBe(0);
    const g = run1(); node(g, 'mrr').nonlinear_identity.stated_in_brief = true; delete node(g, 'mrr').observed_state.cap;
    node(g, 'mrr').observed_state.value = 75000; // no pair frame; the goal cap still frames it
    expect(statedIdentityFrameGaps(g)).toEqual([]);
    delete node(g, 'mrr').goal_threshold_cap;
    expect(statedIdentityFrameGaps(g).map((x) => x.id)).toEqual(['mrr']);
  });
});

describe('accumulation carrier frames use the existing three-part rule', () => {
  const accumulation = (): Json => ({
    nodes: [
      { id: 'subscribers_at_12', kind: 'outcome', label: 'Subscribers at month 12', scale_frame: 5000,
        nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock_today', 'churn', 'inflow'],
          horizon_months: 12, rate_scale: 0.01, stated_in_brief: true } },
      { id: 'stock_today', kind: 'factor', label: 'Subscribers today', observed_state: { raw_value: 250, value: 0.125, cap: 2000, unit: 'subscribers' } },
      { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { raw_value: 3, value: 0.03, cap: 100, unit: '%' } },
      { id: 'inflow', kind: 'factor', label: 'New subscribers each month', observed_state: { raw_value: 30, value: 0.15, cap: 200, unit: 'subscribers/month' } },
    ],
  });

  it('subscribers_at_12 has its scale_frame and all three named parts have frames, so there is no gap', () => {
    expect(statedIdentityFrameGaps(accumulation())).toEqual([]);
  });

  it('CONTROL: a frameless churn part is bound to subscribers_at_12, rather than ignored as a third participant', () => {
    const g = accumulation();
    const churn = node(g, 'churn');
    delete churn.observed_state.cap;
    churn.observed_state.value = churn.observed_state.raw_value;
    expect(statedIdentityFrameGaps(g)).toEqual([
      { id: 'churn', label: 'Monthly churn', identity_id: 'subscribers_at_12', identity_label: 'Subscribers at month 12' },
    ]);
    churn.scale_frame = 100;
    expect(statedIdentityFrameGaps(g)).toEqual([]);
  });
});
