/**
 * ⛔ NO CARRIER CARD BESIDE OLUMI'S GAP PLUG (AIQ 5905919190, rule 5904836575; P0 PARTNER rows 5905933422; R3 5905918746).
 *
 * A graph built before #2343's construction drop still holds Olumi's `non_pro_mrr` £1,500, sized to close the gap
 * (£75,000 − £49 × 1,500). The carrier card said it "gives your £75,000", which is circular, and a Yes would build the plug into
 * the goal. WIRE row: `M8` is R3's served stored graph verbatim (`r3/science-notes` @ `0293cf69`,
 * `row-b-2339-ef042ce/drafts/m8.json`), which is what R3's post-share row seeds.
 */
import { describe, it, expect } from 'vitest';
import { proposeProductIdentity } from '../identity-proposal.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[]; goal_constraints?: unknown };
const M8: Graph = {"edges":[{"to":"keep_49_price","from":"should_we_raise_our_pro_plan_price_from_49_to_59_a_month","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"raise_to_59","from":"should_we_raise_our_pro_plan_price_from_49_to_59_a_month","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"raise_to_54","from":"should_we_raise_our_pro_plan_price_from_49_to_59_a_month","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"pro_plan_price","from":"raise_to_59","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"pro_plan_price","from":"raise_to_54","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"pro_plan_price","from":"keep_49_price","origin":"repair","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis","reasoning":"Connectivity repair wired this option to a factor another option targets; no effect value is implied"},"effect_direction":"positive","exists_probability":1},{"to":"monthly_churn","from":"pro_plan_price","strength":{"std":0.06999999999999999,"mean":0.13999999999999999},"defaulted":true,"provenance":{"source":"cee_hypothesis","magnitude":"olumi_estimate","natural_effect":{"amount":0.7,"amount_unit":"percentage points","strength_mean":0.13999999999999999,"per_source_change":10,"strength_mean_frame":"edge_strength","per_source_change_unit":"£ per subscriber per month"}},"effect_direction":"positive","exists_probability":0.8},{"to":"month_12_paying_subscribers","from":"current_paying_subscribers","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"month_12_paying_subscribers","from":"monthly_churn","strength":{"std":0.125,"mean":-0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"negative","exists_probability":0.8},{"to":"month_12_paying_subscribers","from":"monthly_new_subscribers","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"pro_plan_mrr","from":"pro_plan_price","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"pro_plan_mrr","from":"month_12_paying_subscribers","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"mrr","from":"pro_plan_mrr","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"mrr","from":"non_pro_mrr","strength":{"std":0.4705882352941176,"mean":0.9411764705882352},"defaulted":true,"provenance":{"source":"cee_hypothesis","magnitude":"olumi_estimate","natural_effect":{"amount":1,"amount_unit":"£/month","strength_mean":0.9411764705882352,"per_source_change":1,"strength_mean_frame":"edge_strength","per_source_change_unit":"£/month"}},"effect_direction":"positive","exists_probability":0.8}],"nodes":[{"id":"should_we_raise_our_pro_plan_price_from_49_to_59_a_month","kind":"decision","label":"Should we raise our Pro plan…","provenance":"from_brief","description":"Should we raise our Pro plan price from £49 to £59 a month?"},{"id":"mrr","kind":"goal","label":"MRR","provenance":"from_brief","goal_direction":">","goal_threshold":0.8,"observed_state":{"cap":106250,"unit":"£/month","value":0.7058823529411765,"source":"brief_extraction","baseline":0.7058823529411765,"raw_value":75000},"threshold_source":"brief_extraction","goal_threshold_cap":106250,"goal_threshold_raw":85000,"goal_horizon_months":12,"goal_threshold_unit":"£/month","goal_threshold_frame":"level","goal_threshold_cap_provenance":"target_derived_headroom"},{"id":"keep_49_price","kind":"option","label":"Keep £49 price","provenance":"ai_inferred","is_baseline":true},{"id":"raise_to_59","kind":"option","label":"Raise to £59","provenance":"from_brief","interventions":{"pro_plan_price":{"unit":"£ per subscriber per month","value":0.295,"source":"brief_extraction","raw_value":59,"target_match":{"node_id":"pro_plan_price","confidence":"high","match_type":"exact_id"}}}},{"id":"raise_to_54","kind":"option","label":"Raise to £54","provenance":"ai_inferred","proposed_by":"olumi","interventions":{"pro_plan_price":{"unit":"£ per subscriber per month","value":0.27,"source":"cee_hypothesis","raw_value":54,"target_match":{"node_id":"pro_plan_price","confidence":"high","match_type":"exact_id"}}}},{"id":"pro_plan_price","kind":"factor","label":"Pro plan price","category":"controllable","provenance":"from_brief","observed_state":{"cap":200,"unit":"£ per subscriber per month","value":0.245,"source":"brief_extraction","raw_value":49,"declared_scale":"unit_interval"}},{"id":"current_paying_subscribers","kind":"factor","label":"Current paying subscribers","category":"observable","provenance":"from_brief","observed_state":{"cap":10000,"unit":"subscribers","value":0.15,"source":"brief_extraction","raw_value":1500,"declared_scale":"unit_interval"}},{"id":"monthly_churn","kind":"factor","label":"Monthly churn","category":"observable","provenance":"ai_inferred","scale_frame":100,"observed_state":{"unit":"%","value":0.03,"source":"cee_inference","raw_value":3,"extractionType":"inferred"}},{"id":"monthly_new_subscribers","kind":"factor","label":"Monthly new subscribers","category":"observable","provenance":"ai_inferred","scale_frame":2000,"observed_state":{"unit":"subscribers per month","value":0.035,"source":"cee_inference","raw_value":70,"extractionType":"inferred"}},{"id":"non_pro_mrr","kind":"factor","label":"Non-Pro MRR","category":"observable","provenance":"ai_inferred","scale_frame":100000,"observed_state":{"unit":"£/month","value":0.015,"source":"cee_inference","raw_value":1500,"extractionType":"inferred"}},{"id":"month_12_paying_subscribers","kind":"outcome","label":"Month-12 paying subscribers","provenance":"ai_inferred"},{"id":"pro_plan_mrr","kind":"outcome","label":"Pro plan MRR","provenance":"ai_inferred","nonlinear_identity":{"operation":"product","factor_ids":["pro_plan_price","month_12_paying_subscribers"],"stated_in_brief":false}}],"goal_constraints":[{"unit":"%","label":"Monthly churn","value":5,"node_id":"monthly_churn","operator":"<=","provenance":"explicit","value_frame":"level","constraint_id":"agent-lane:monthly_churn:<=","operator_as_stated":"<"}]};
const g = (edit: (x: Graph) => void = () => {}): Graph => { const x = structuredClone(M8); edit(x); return x; };
const plug = (x: Graph) => x.nodes.find((n) => n.id === 'non_pro_mrr')!;

describe('the carrier card refuses beside Olumi’s gap plug, and only there (seeded pre-fix m8)', () => {
  it('PREMISE: the served m8 — the carrier + Olumi’s £1,500, exactly £75,000 − £49 × 1,500, no cause of its own', () => {
    const goal = M8.nodes.find((n) => n.kind === 'goal')!;
    expect(M8.edges.filter((e) => e.to === goal.id).map((e) => e.from).sort()).toEqual(['non_pro_mrr', 'pro_plan_mrr']);
    expect(plug(M8).observed_state).toMatchObject({ raw_value: 1500, source: 'cee_inference', unit: '£/month' });
    expect(M8.edges.filter((e) => e.to === 'non_pro_mrr')).toEqual([]);
    expect(75000 - 49 * 1500).toBe(1500);
  });

  it('R1 (RED): Olumi’s gap plug beside the carrier → no card', () => {
    expect(proposeProductIdentity(M8)).toBeNull();
  });

  it('R2: the same £1,500 as the USER’s figure keeps the card, named as theirs', () => {
    const card = proposeProductIdentity(g((x) => { plug(x).observed_state.source = 'brief_extraction'; }));
    expect(card).not.toBeNull();
    expect(card!.words).toContain('(your figure, £1,500) that gives your £75,000');
  });

  it('R3 (the existing carrier design): an Olumi addend of another size keeps the card, which says it also adds it', () => {
    const card = proposeProductIdentity(g((x) => { plug(x).observed_state.raw_value = 6000; }));
    expect(card).not.toBeNull();
    expect(card!.words).toContain('which also adds “Non-Pro MRR” (Olumi\'s estimate, £6,000)');
  });

  it('R4: the plug taken out (what a fresh #2343 draft stores) → the card, unchanged', () => {
    const card = proposeProductIdentity(g((x) => { x.nodes = x.nodes.filter((n) => n.id !== 'non_pro_mrr'); x.edges = x.edges.filter((e) => e.from !== 'non_pro_mrr'); }));
    expect(card).not.toBeNull();
    expect(card!.words).toContain('= £73,500, close to your £75,000 “MRR”.');
  });

  it('CONTROL: an Olumi £1,500 with a cause of its own is modelled, not a plug — the existing card', () => {
    const card = proposeProductIdentity(g((x) => { x.edges.push({ from: 'monthly_churn', to: 'non_pro_mrr', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative', provenance: { source: 'cee_hypothesis' } }); }));
    expect(card).not.toBeNull();
  });
});
