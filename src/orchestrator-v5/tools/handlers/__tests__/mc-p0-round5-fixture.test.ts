import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runP0Graph } from './mc-p0-run-helper.js';
import { unsizedLeaderGoalPaths } from '../../../agent-lane/goal-certainty.js';
const F = JSON.parse(readFileSync(new URL('./fixtures/served-cut-costs-altB-r0-1f9d769.json', import.meta.url), 'utf8'));
function sized(includeUnmarked: boolean) {
  const g = structuredClone(F.graph);
  for (const e of g.edges) if (e.provenance?.magnitude === 'olumi_placeholder') e.provenance.magnitude = 'olumi_estimate';
  if (includeUnmarked) {
    const e = g.edges.find((e: any) => e.from === 'gcp_workload_share' && e.to === 'monthly_gcp_cost_saving');
    e.provenance = { ...e.provenance, magnitude: 'olumi_estimate', natural_effect: { amount: 1, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: '%', strength_mean: e.strength.mean, strength_mean_frame: 'edge_strength' } };
  }
  return g;
}
it('R5 capture :212/:219 original and :241 old/new setups', async () => {
  const rows = [];
  for (const [tag, g] of [['original-212-219', F.graph], ['241-old-setup', sized(false)], ['241-new-setup', sized(true)]] as const) rows.push({ tag, result: await runP0Graph(g, F._provenance.brief_text, F.plot_body) });
  writeFileSync(`/private/tmp/mc-codex-p0/cee-evidence/round5/fixture-${process.env.R5_CAPTURE ?? 'after'}.json`, JSON.stringify(rows, null, 2));
});
it('R5 original :241 setup: legacy workload-share link keeps leader and discloses by endpoint identity', async () => {
  const g = sized(false);
  const link = { from: 'gcp_workload_share', to: 'monthly_gcp_cost_saving' };
  const e = g.edges.find((e: any) => e.from === link.from && e.to === link.to);
  expect(e.defaulted).toBe(true); expect(e.provenance?.magnitude).toBeUndefined();
  const r = await runP0Graph(g, F._provenance.brief_text, F.plot_body);
  expect(r.leading_option_id).toBe('switch_fully_to_gcp');
  const w = r.enrichment.inference_warnings.find((w: any) => w.code === 'GOAL_FIGURES_OLUMI_SUPPLIED_LINK');
  expect(w.node_ids).toEqual(expect.arrayContaining([link.from, link.to]));
  expect(w.message).toContain('GCP workload share'); expect(w.message).toContain('Monthly GCP cost saving');
  const paths = unsizedLeaderGoalPaths(g, ['remain_on_aws', 'switch_fully_to_gcp', 'phase_50_to_gcp']);
  expect(paths).toEqual([]);
  expect(w.links).toEqual([link]);
  expect(r.summary.startsWith('Ran analysis on your current scenario.')).toBe(true);
  expect(r.summary).not.toContain(w.message); // RD-2: prose only beside a named leader; this constraint-gap summary names none.
});
