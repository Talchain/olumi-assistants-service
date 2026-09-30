/**
 * ⛔ A CORRECTION LANDS FIRST TIME (DL lease 5907111773; AIQ rows 5907128716 + amendments 5907227964; `relative-figure.ts`).
 * WIRE: `R1` is R3's served share-build graph verbatim (CEE `2366977`, joined run 05:52Z, `ccalt` r1, read before the
 * edit). There the Agent proposed `{25, "%"}` for ‘GCP saving rate’ (a 0–1 `proportion`, Olumi's 0.2): the card read
 * "0.2% → 25%" and the user's press was refused at write.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Json = Record<string, any>;
const R1: Json = {"edges":[{"to":"remain_on_aws","from":"should_we_switch_our_cloud_provider_from_aws_to_gcp","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"switch_to_gcp","from":"should_we_switch_our_cloud_provider_from_aws_to_gcp","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"phased_gcp_migration","from":"should_we_switch_our_cloud_provider_from_aws_to_gcp","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"gcp_workload_share","from":"switch_to_gcp","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"migration_automation_coverage","from":"switch_to_gcp","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"gcp_workload_share","from":"phased_gcp_migration","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"migration_automation_coverage","from":"phased_gcp_migration","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"gcp_workload_share","from":"remain_on_aws","origin":"repair","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis","reasoning":"Connectivity repair wired this option to a factor another option targets; no effect value is implied"},"effect_direction":"positive","exists_probability":1},{"to":"migration_automation_coverage","from":"remain_on_aws","origin":"repair","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis","reasoning":"Connectivity repair wired this option to a factor another option targets; no effect value is implied"},"effect_direction":"positive","exists_probability":1},{"to":"gcp_monthly_savings","from":"aws_equivalent_monthly_workload_cost","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"gcp_monthly_savings","from":"gcp_workload_share","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"gcp_monthly_savings","from":"gcp_saving_rate","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"monthly_spend","from":"gcp_monthly_savings","strength":{"std":0.1,"mean":-0.2},"defaulted":true,"provenance":{"source":"cee_hypothesis","magnitude":"olumi_placeholder"},"effect_direction":"negative","exists_probability":0.8},{"to":"migration_downtime","from":"gcp_workload_share","strength":{"std":0.10416666666666667,"mean":0.20833333333333334},"defaulted":true,"provenance":{"source":"cee_hypothesis","magnitude":"olumi_estimate","natural_effect":{"amount":2.5,"amount_unit":"weeks","strength_mean":0.20833333333333334,"per_source_change":1,"strength_mean_frame":"edge_strength","per_source_change_unit":"proportion"}},"effect_direction":"positive","exists_probability":0.8},{"to":"migration_downtime","from":"migration_automation_coverage","strength":{"std":0.041666666666666664,"mean":-0.08333333333333333},"defaulted":true,"provenance":{"source":"cee_hypothesis","magnitude":"olumi_estimate","natural_effect":{"amount":-1,"amount_unit":"weeks","strength_mean":-0.08333333333333333,"per_source_change":1,"strength_mean_frame":"edge_strength","per_source_change_unit":"proportion"}},"effect_direction":"negative","exists_probability":0.8}],"nodes":[{"id":"should_we_switch_our_cloud_provider_from_aws_to_gcp","kind":"decision","label":"Should we switch our cloud…","provenance":"from_brief","description":"Should we switch our cloud provider from AWS to GCP?"},{"id":"monthly_spend","kind":"goal","label":"Monthly spend","provenance":"from_brief","goal_threshold":-0.2,"observed_state":{"cap":56250,"unit":"£/month","value":0.8,"source":"brief_extraction","baseline":0.8,"raw_value":45000},"goal_sense_reading":{"basis":"typed_change_sign","sense":"minimise","words":"Olumi reads ‘Monthly spend’ as a target to bring it DOWN by at least 20% from today.","threshold":-0.2,"threshold_frame":"change_rel"},"goal_threshold_cap":56250,"goal_threshold_raw":-0.2,"goal_threshold_unit":"£/month","goal_threshold_frame":"change_rel","goal_threshold_cap_provenance":"target_derived_headroom"},{"id":"remain_on_aws","kind":"option","label":"Remain on AWS","provenance":"ai_inferred","is_baseline":true},{"id":"switch_to_gcp","kind":"option","label":"Switch to GCP","provenance":"ai_inferred","interventions":{"gcp_workload_share":{"value":1,"source":"cee_hypothesis","target_match":{"node_id":"gcp_workload_share","confidence":"high","match_type":"exact_id"}},"migration_automation_coverage":{"value":1,"source":"cee_hypothesis","target_match":{"node_id":"migration_automation_coverage","confidence":"high","match_type":"exact_id"}}}},{"id":"phased_gcp_migration","kind":"option","label":"Phased GCP Migration","provenance":"ai_inferred","proposed_by":"olumi","interventions":{"gcp_workload_share":{"value":0.5,"source":"cee_hypothesis","target_match":{"node_id":"gcp_workload_share","confidence":"high","match_type":"exact_id"}},"migration_automation_coverage":{"value":0.85,"source":"cee_hypothesis","target_match":{"node_id":"migration_automation_coverage","confidence":"high","match_type":"exact_id"}}}},{"id":"aws_equivalent_monthly_workload_cost","kind":"factor","label":"AWS-equivalent monthly workload…","category":"external","provenance":"from_brief","description":"AWS-equivalent monthly workload cost","observed_state":{"cap":100000,"unit":"£/month","value":0.45,"source":"brief_extraction","raw_value":45000,"declared_scale":"unit_interval"}},{"id":"gcp_workload_share","kind":"factor","label":"GCP workload share","category":"controllable","provenance":"ai_inferred","observed_state":{"unit":"proportion","value":0,"source":"cee_inference"}},{"id":"gcp_saving_rate","kind":"factor","label":"GCP saving rate","category":"external","provenance":"ai_inferred","observed_state":{"unit":"proportion","value":0.2,"source":"cee_inference","extractionType":"inferred"}},{"id":"migration_automation_coverage","kind":"factor","label":"Migration automation coverage","category":"controllable","provenance":"ai_inferred","observed_state":{"unit":"proportion","value":0,"source":"cee_inference"}},{"id":"migration_downtime","kind":"factor","label":"Migration downtime","category":"observable","provenance":"ai_inferred","observed_state":{"cap":12,"unit":"weeks","value":0,"source":"cee_inference","raw_value":0,"declared_scale":"unit_interval"}},{"id":"gcp_monthly_savings","kind":"outcome","label":"GCP monthly savings","provenance":"ai_inferred"}],"goal_constraints":[{"unit":"weeks","label":"Migration downtime","value":2,"node_id":"migration_downtime","operator":"<=","provenance":"explicit","value_frame":"level","constraint_id":"agent-lane:migration_downtime:<="}]};
const EDIT = "Our team's quote shows GCP would be about 25% cheaper than AWS for our workload.";
async function propose(said: string, value: number, unit: string, edit: (g: Json) => void = () => {}, label = 'GCP saving rate') {
  const graph = structuredClone(R1); edit(graph);
  const d: InternalDispatch = async (path) => { if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } }; throw new Error(path); };
  const store = new ProposalStore();
  const r = await createAgentCapabilities(d, store).proposeAssumptions(
    { scenario_id: '550e8400-e29b-41d4-a716-446655440c01', authenticated_user_id: null, request_id: 'r', user_text: said } as never,
    { assumptions: [{ factor_label: label, value, unit, basis: "the team's quote", revise: true }] } as never) as Json;
  const op = r.proposal_id ? (store.get(r.proposal_id)!.operations[0] as Json).value : null;
  return { r, op };
}

describe('the user\'s "25% cheaper" lands first time, as theirs, in the factor\'s own frame (served 2366977 r1)', () => {
  it('RED: {25, "%"} on a proportion factor → 0.25 in its frame, the user\'s, and the card reads 20% → 25% with their sentence', async () => {
    const { r, op } = await propose(EDIT, 25, '%');
    expect(op).toEqual({ value: 0.25, unit: 'proportion', basis: "the team's quote", authored_by: 'user_stated' });
    expect(r.public_label).toContain(`GCP saving rate: 20% \u2192 25% (your figure, in your words: "${EDIT}")`);
    expect(r.public_label).not.toContain('0.2%');
  });

  it('CONTROL: {0.25, "proportion"} (the served-proven write) is unchanged', async () => {
    const { op } = await propose(EDIT, 0.25, 'proportion');
    expect(op).toEqual({ value: 0.25, unit: 'proportion', basis: "the team's quote", authored_by: 'user_stated' });
  });

  it('AIQ A: {0.5, "%"} on a 0–1 factor is ambiguous (0.5% or 50%?) → nothing proposed, the user asked', async () => {
    const { r, op } = await propose('Our quote shows GCP would be about 0.5% cheaper than AWS for our workload.', 0.5, '%');
    expect(op).toBeNull();
    expect(r.scale_ambiguous).toEqual([{ label: 'GCP saving rate', value: 0.5, as_percent: 0.005, as_share: 0.5 }]);
  });

  it('AIQ B: "AWS costs 25% more" → no figure for the GCP saving by any author (not 25%, not a converted 20%), asked', async () => {
    const said = 'Our team\'s quote shows AWS costs about 25% more than GCP for our workload.';
    for (const [value, unit] of [[25, '%'], [0.2, 'proportion'], [0.25, 'proportion']] as const) {
      const { r, op } = await propose(said, value, unit);
      expect(op, `${value} ${unit}`).toBeNull();
      expect(r.direction_conflict).toEqual([{ label: 'GCP saving rate' }]);
    }
  });

  it('AIQ B: compared against the factor\'s OWN subject ("AWS is 25% cheaper than GCP") → asked, nothing written', async () => {
    const { r, op } = await propose('Our team\'s quote shows AWS is about 25% cheaper than GCP for our workload.', 25, '%');
    expect(op).toBeNull();
    expect(r.direction_conflict).toEqual([{ label: 'GCP saving rate' }]);
  });

  it('CONTROL: a comparison whose factor concept cannot be read gives no credit → Olumi\'s, said', async () => {
    const { r, op } = await propose(EDIT, 25, '%', (g) => { g.nodes.find((n: Json) => n.id === 'gcp_saving_rate').label = 'GCP cost ratio'; }, 'GCP cost ratio');
    expect(op).toMatchObject({ value: 0.25, unit: 'proportion', authored_by: 'model_proposed' });
    expect(r.not_the_users_figure).toBeDefined();
  });

  it('CONTROL: a level, not a comparison ("Our GCP saving rate is 25%.") keeps today\'s credit', async () => {
    const { op } = await propose('Our GCP saving rate is 25%.', 25, '%');
    expect(op).toMatchObject({ value: 0.25, unit: 'proportion', authored_by: 'user_stated' });
  });

  it('CONTROL: percentage POINTS are never converted; over 100% is no share; a %-native factor is left as given', async () => {
    expect((await propose(EDIT, 25, 'pp')).op).toMatchObject({ value: 25, unit: 'pp' });
    expect((await propose(EDIT, 150, '%')).op).toMatchObject({ value: 150, unit: '%' });
    const pct = await propose(EDIT, 25, '%', (g) => { Object.assign(g.nodes.find((n: Json) => n.id === 'gcp_saving_rate').observed_state, { unit: '%', value: 0.2, cap: 100, raw_value: 20 }); });
    expect(pct.op).toMatchObject({ value: 25, unit: '%' });
  });
});
