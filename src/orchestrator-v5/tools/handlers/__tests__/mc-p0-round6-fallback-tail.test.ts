import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { placeholderGoalWarning, unsizedLeaderGoalPaths } from '../../../agent-lane/goal-certainty.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../../orchestrator/context/option-result-source.js';
import { runP0Graph } from './mc-p0-run-helper.js';
import { resolveAnalysisAdmission } from '../../../admission/analysis-admission.js';
import { authorshipReasonForRun } from '../../../compose/authorship-reason-for-run.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/served-cut-costs-altB-r0-1f9d769.json', import.meta.url), 'utf8'));
const ids = ['remain_on_aws', 'switch_fully_to_gcp', 'phase_50_to_gcp'];
const workload = { from: 'gcp_workload_share', to: 'monthly_gcp_cost_saving' };
const otherLinks = [
  { from: 'monthly_gcp_cost_saving', to: 'monthly_cloud_spend' },
  { from: 'migration_downtime', to: 'monthly_cloud_spend' },
];
const oldTail = 'Olumi only guessed another link; you aren’t asked to size it.';
const pluralTail = '2 other links on the way aren’t sized yet either.';
const singularTail = '1 other link on the way isn’t sized yet either.';

it('R6 original :219 setup: exactly two other nobody-sized links, deduplicated by endpoint identity', async () => {
  const paths = unsizedLeaderGoalPaths(F.graph, ids);
  const links = [...new Map(paths.flatMap(p => p.links).map(l => [`${l.from}->${l.to}`, l])).values()];
  expect(links).toEqual([workload, ...otherLinks]);
  const elided = links.filter(l => l.from !== workload.from || l.to !== workload.to);
  expect(elided).toEqual(otherLinks);
  expect(elided).toHaveLength(2);
  const r = await runP0Graph(F.graph, F._provenance.brief_text, F.plot_body);
  expect(r.leading_option_id).toBeNull();
  const warning = r.enrichment.inference_warnings.find((w: any) => w.code === GOAL_FIGURES_PLACEHOLDER_PATH);
  expect(warning.message).toBe('Not shown. This run can’t say how likely these options are to reach the goal: a link on the way is not sized. Give a figure for how ‘GCP workload share’ moves ‘Monthly GCP cost saving’ and Olumi will use it. 2 other links on the way aren’t sized yet either.');
  expect(warning.message).not.toContain(oldTail);
  expect(warning.message.length).toBeLessThanOrEqual(400);
});

// Hold the warning's named paths constant: changing the stamps discriminates the tail,
// while the independent licence check verifies estimates no longer block.
function twin(magnitudes: string[]) {
  const g = structuredClone(F.graph);
  for (const [i, link] of otherLinks.entries()) {
    const e = g.edges.find((e: any) => e.from === link.from && e.to === link.to);
    e.provenance.magnitude = magnitudes[i];
  }
  const paths = [{ option_id: ids[1]!, links: [workload, ...otherLinks] }];
  return { g, paths };
}

it('R6 estimated-only twin keeps the old tail and estimates do not block', () => {
  const { g, paths } = twin(['olumi_estimate', 'olumi_estimate']);
  const actual = unsizedLeaderGoalPaths(g, ids);
  expect(actual.flatMap(p => p.links)).toEqual([workload, workload]);
  const w = placeholderGoalWarning(g, paths, GOAL_FIGURES_PLACEHOLDER_PATH);
  expect(w.message).toBe('Not shown. This run can’t say how likely these options are to reach the goal: a link on the way is not sized. Give a figure for how ‘GCP workload share’ moves ‘Monthly GCP cost saving’ and Olumi will use it. Olumi only guessed another link; you aren’t asked to size it.');
  expect(w.message).not.toContain('other links on the way');
  expect(w.message.length).toBeLessThanOrEqual(400);
});

it('R6 singular nobody-sized link comes before the estimated-link tail', () => {
  const { g, paths } = twin(['olumi_placeholder', 'olumi_estimate']);
  const w = placeholderGoalWarning(g, paths, GOAL_FIGURES_PLACEHOLDER_PATH);
  expect(w.message).toBe('Not shown. This run can’t say how likely these options are to reach the goal: a link on the way is not sized. Give a figure for how ‘GCP workload share’ moves ‘Monthly GCP cost saving’ and Olumi will use it. 1 other link on the way isn’t sized yet either. Olumi only guessed another link; you aren’t asked to size it.');
  expect(w.message.indexOf(singularTail)).toBeLessThan(w.message.indexOf(oldTail));
  expect(w.message.length).toBeLessThanOrEqual(400);
});

it('R6 singular nobody-sized link without an estimate has no old tail', () => {
  const { g, paths } = twin(['olumi_placeholder', 'olumi_placeholder']);
  paths[0]!.links.pop();
  g.nodes.find((n: any) => n.id === ids[1]).label += ' across many teams'.repeat(9);
  const w = placeholderGoalWarning(g, paths, GOAL_FIGURES_PLACEHOLDER_PATH);
  expect(w.message).toContain(singularTail);
  expect(w.message).not.toContain(oldTail);
  expect(w.message).not.toContain(pluralTail);
  expect(w.message.length).toBeLessThanOrEqual(400);
});

it('R6 both tails still fit the warning budget with long endpoint labels', () => {
  const { g, paths } = twin(['olumi_placeholder', 'olumi_estimate']);
  for (const n of g.nodes) if (n.id === workload.from || n.id === workload.to) n.label += ' across many teams'.repeat(9);
  const w = placeholderGoalWarning(g, paths, GOAL_FIGURES_PLACEHOLDER_PATH);
  expect(w.message).toContain(singularTail);
  expect(w.message).toContain(oldTail);
  expect(w.message.length).toBeLessThanOrEqual(400);
});

it('R6 capture :212, authorised :219, and :241 original/authorised setup results', async () => {
  const sizesWorkload = () => {
    const g = structuredClone(F.graph);
    const e = g.edges.find((e: any) => e.from === workload.from && e.to === workload.to);
    e.provenance = { ...e.provenance, magnitude: 'olumi_estimate', natural_effect: {
      amount: 1, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: '%',
      strength_mean: e.strength.mean, strength_mean_frame: 'edge_strength',
    } };
    return g;
  };
  const allSized = sizesWorkload();
  for (const e of allSized.edges) if (e.provenance?.magnitude === 'olumi_placeholder') e.provenance.magnitude = 'olumi_estimate';
  const old241 = structuredClone(F.graph);
  for (const e of old241.edges) if (e.provenance?.magnitude === 'olumi_placeholder') e.provenance.magnitude = 'olumi_estimate';
  const rows = [];
  for (const [tag, g] of [['212-and-219-original', F.graph], ['219-authorised', sizesWorkload()], ['241-original', old241], ['241-authorised', allSized]] as const) {
    rows.push({ tag, result: await runP0Graph(g, F._provenance.brief_text, F.plot_body) });
  }
  writeFileSync(`/private/tmp/mc-codex-p0/cee-evidence/round6/fixture-${process.env.R6_CAPTURE ?? 'after'}.json`, JSON.stringify(rows, null, 2));
  const tails = [];
  for (const [tag, stamps] of [['nobody-sized', ['olumi_placeholder', 'olumi_placeholder']], ['estimated-only', ['olumi_estimate', 'olumi_estimate']], ['both-kinds', ['olumi_placeholder', 'olumi_estimate']]] as const) {
    const { g, paths } = twin([...stamps]);
    tails.push({ tag, message: placeholderGoalWarning(g, paths, GOAL_FIGURES_PLACEHOLDER_PATH).message });
  }
  const singular = twin(['olumi_placeholder', 'olumi_placeholder']);
  singular.paths[0]!.links.pop();
  singular.g.nodes.find((n: any) => n.id === ids[1]).label += ' across many teams'.repeat(9);
  tails.push({ tag: 'singular', message: placeholderGoalWarning(singular.g, singular.paths, GOAL_FIGURES_PLACEHOLDER_PATH).message });
  writeFileSync(`/private/tmp/mc-codex-p0/cee-evidence/round6/tails-${process.env.R6_CAPTURE ?? 'after'}.json`, JSON.stringify(tails, null, 2));
  const g = JSON.parse(readFileSync(new URL('../../../admission/__tests__/fixtures/mc-p0/draw2.json', import.meta.url), 'utf8'));
  for (const e of g.edges) if (e.provenance?.natural_effect) e.provenance.magnitude = 'user_stated';
  const semantics = [];
  for (const tag of ['ALL-YOURS', 'MIXED']) {
    if (tag === 'MIXED') {
      const e = g.edges.find((e: any) => e.from === 'price_increase' && e.to === 'customer_losses_from_price_rise');
      e.provenance.magnitude = 'olumi_estimate';
      e.provenance.reviewed_by_user = { intent: 'confirm' };
    }
    const admission = resolveAnalysisAdmission(g);
    const reason = admission.reasons.find(r => r.field === 'semantic_quality_sufficient')!;
    semantics.push({ tag, reason, mode: admission.reasons.find(r => r.field === 'permitted_analysis_mode'),
      withoutLeader: authorshipReasonForRun({ analysis_ready: { analysis_admission: { reasons: [reason] } }, blocks: [] }).analysis_ready.analysis_admission.reasons[0] });
  }
  writeFileSync(`/private/tmp/mc-codex-p0/cee-evidence/round6/semantics-${process.env.R6_CAPTURE ?? 'after'}.json`, JSON.stringify(semantics, null, 2));
});
