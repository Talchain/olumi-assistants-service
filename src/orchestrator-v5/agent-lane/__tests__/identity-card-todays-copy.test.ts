/**
 * ⛔ AN OLUMI LEVEL THAT IS AN EXACT COPY OF THE USER'S FIGURE IS READ AT TODAY'S LEVEL (AIQ 5906371639; R3 share-build
 * `bdc4ff54`). MRR = ‘Pro plan price’ × ‘Paying subscribers at 12 months’, a FACTOR holding Olumi's 1,500 copied from the
 * user's 1,500 ‘Current paying subscribers’. WIRE row: `M4` is R3's served stored graph verbatim (`r3/science-notes`
 * @ `567a9a67`, `rate10-2366977/m4.json`).
 */
import { describe, it, expect } from 'vitest';
import { proposeProductIdentity } from '../identity-proposal.js';
import { applyIdentityConfirmEdit, identityConfirmReadingToken } from '../../system-events/identity-confirm-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[]; goal_constraints?: unknown };
const M4: Graph = {"edges":[{"to":"keep_current_price","from":"should_we_raise_our_pro_plan_price_from_49_to_59_a_month","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"raise_to_59_month","from":"should_we_raise_our_pro_plan_price_from_49_to_59_a_month","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"raise_to_54_month","from":"should_we_raise_our_pro_plan_price_from_49_to_59_a_month","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"pro_plan_price","from":"raise_to_59_month","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"pro_plan_price","from":"raise_to_54_month","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":1},{"to":"pro_plan_price","from":"keep_current_price","origin":"repair","strength":{"std":0.01,"mean":1},"provenance":{"source":"cee_hypothesis","reasoning":"Connectivity repair wired this option to a factor another option targets; no effect value is implied"},"effect_direction":"positive","exists_probability":1},{"to":"monthly_churn","from":"pro_plan_price","strength":{"std":0.08,"mean":0.16},"defaulted":true,"provenance":{"source":"cee_hypothesis","magnitude":"olumi_estimate","natural_effect":{"amount":0.8,"amount_unit":"percentage points","strength_mean":0.16,"per_source_change":10,"strength_mean_frame":"edge_strength","per_source_change_unit":"£/month"}},"effect_direction":"positive","exists_probability":0.8},{"to":"paying_subscribers_at_12_months","from":"current_paying_subscribers","strength":{"std":0.5,"mean":1},"defaulted":true,"provenance":{"source":"cee_hypothesis","magnitude":"olumi_estimate","natural_effect":{"amount":1,"amount_unit":"subscribers","strength_mean":1,"per_source_change":1,"strength_mean_frame":"edge_strength","per_source_change_unit":"subscribers"}},"effect_direction":"positive","exists_probability":0.8},{"to":"paying_subscribers_at_12_months","from":"monthly_new_subscribers","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"paying_subscribers_at_12_months","from":"monthly_churn","strength":{"std":0.125,"mean":-0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"negative","exists_probability":0.8},{"to":"mrr","from":"pro_plan_price","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8},{"to":"mrr","from":"paying_subscribers_at_12_months","strength":{"std":0.125,"mean":0.5},"defaulted":true,"provenance":{"source":"cee_hypothesis"},"effect_direction":"positive","exists_probability":0.8}],"nodes":[{"id":"should_we_raise_our_pro_plan_price_from_49_to_59_a_month","kind":"decision","label":"Should we raise our Pro plan…","provenance":"from_brief","description":"Should we raise our Pro plan price from £49 to £59 a month?"},{"id":"mrr","kind":"goal","label":"MRR","provenance":"from_brief","goal_direction":">","goal_threshold":0.8,"observed_state":{"cap":106250,"unit":"£/month","value":0.7058823529411765,"source":"brief_extraction","baseline":0.7058823529411765,"raw_value":75000},"threshold_source":"brief_extraction","goal_threshold_cap":106250,"goal_threshold_raw":85000,"nonlinear_identity":{"operation":"product","factor_ids":["pro_plan_price","paying_subscribers_at_12_months"],"stated_in_brief":false},"goal_horizon_months":12,"goal_threshold_unit":"£/month","goal_threshold_frame":"level","goal_threshold_cap_provenance":"target_derived_headroom"},{"id":"keep_current_price","kind":"option","label":"Keep current price","provenance":"ai_inferred","is_baseline":true},{"id":"raise_to_59_month","kind":"option","label":"Raise to £59/month","provenance":"from_brief","interventions":{"pro_plan_price":{"unit":"£/month","value":0.295,"source":"brief_extraction","raw_value":59,"target_match":{"node_id":"pro_plan_price","confidence":"high","match_type":"exact_id"}}}},{"id":"raise_to_54_month","kind":"option","label":"Raise to £54/month","provenance":"ai_inferred","proposed_by":"olumi","interventions":{"pro_plan_price":{"unit":"£/month","value":0.27,"source":"cee_hypothesis","raw_value":54,"target_match":{"node_id":"pro_plan_price","confidence":"high","match_type":"exact_id"}}}},{"id":"pro_plan_price","kind":"factor","label":"Pro plan price","category":"controllable","provenance":"from_brief","observed_state":{"cap":200,"unit":"£/month","value":0.245,"source":"brief_extraction","raw_value":49,"declared_scale":"unit_interval"}},{"id":"current_paying_subscribers","kind":"factor","label":"Current paying subscribers","category":"observable","provenance":"from_brief","observed_state":{"cap":10000,"unit":"subscribers","value":0.15,"source":"brief_extraction","raw_value":1500,"declared_scale":"unit_interval"}},{"id":"monthly_churn","kind":"factor","label":"Monthly churn","category":"observable","provenance":"ai_inferred","scale_frame":100,"observed_state":{"unit":"%","value":0.035,"source":"cee_inference","raw_value":3.5,"extractionType":"inferred"}},{"id":"monthly_new_subscribers","kind":"factor","label":"Monthly new subscribers","category":"observable","provenance":"ai_inferred","scale_frame":1000,"observed_state":{"unit":"subscribers/month","value":0.053,"source":"cee_inference","raw_value":53,"extractionType":"inferred"}},{"id":"paying_subscribers_at_12_months","kind":"factor","label":"Paying subscribers at 12 months","category":"observable","provenance":"ai_inferred","scale_frame":10000,"observed_state":{"unit":"subscribers","value":0.15,"source":"cee_inference","raw_value":1500,"extractionType":"inferred"}}],"goal_constraints":[{"unit":"%","label":"Monthly churn","value":5,"node_id":"monthly_churn","operator":"<=","provenance":"explicit","value_frame":"level","constraint_id":"agent-lane:monthly_churn:<=","operator_as_stated":"<"}]};
const g = (edit: (x: Graph) => void = () => {}): Graph => { const x = structuredClone(M4); edit(x); return x; };
const node = (x: Graph, id: string) => x.nodes.find((n) => n.id === id)!;

describe('an operand holding an EXACT copy of the user’s figure is read at today’s level (served bdc4ff54)', () => {
  it('PREMISE: the month-12 factor holds Olumi’s 1,500, and its one user-levelled cause is the user’s 1,500', () => {
    expect(node(M4, 'paying_subscribers_at_12_months').observed_state).toMatchObject({ raw_value: 1500, source: 'cee_inference' });
    expect(node(M4, 'current_paying_subscribers').observed_state).toMatchObject({ raw_value: 1500, source: 'brief_extraction' });
  });

  it('RED: the card, crediting the user’s cause (never the month-12 node)', () => {
    const card = proposeProductIdentity(M4);
    expect(card).not.toBeNull();
    expect(card!.factor_ids).toEqual(['pro_plan_price', 'paying_subscribers_at_12_months']);
    expect(card!.words).toContain('Today that is £49 × 1,500 (your “Current paying subscribers”) = £73,500, close to your £75,000.');
  });

  it('POST-YES: the Yes confirms the reading and leaves the month-12 level Olumi’s (not re-authored)', () => {
    const card = proposeProductIdentity(M4)!;
    const r = applyIdentityConfirmEdit({ persistedGraph: M4, outcome_id: card.outcome_id, factor_ids: card.factor_ids, words: card.words,
      expected_graph_hash: computeAnalysisAffectingGraphHash(M4 as never) ?? '', reading_token: identityConfirmReadingToken(card) });
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    const after = (r as { mutatedGraph: Graph }).mutatedGraph;
    expect(node(after, 'paying_subscribers_at_12_months').observed_state).toEqual(node(M4, 'paying_subscribers_at_12_months').observed_state);
  });

  it('CONTROL: a different Olumi level (a projected 1,450) is Olumi’s projection — no card', () => {
    expect(proposeProductIdentity(g((x) => { node(x, 'paying_subscribers_at_12_months').observed_state.raw_value = 1450; }))).toBeNull();
  });

  it('CONTROL: two user-levelled causes (which is today’s?) — no card', () => {
    expect(proposeProductIdentity(g((x) => { node(x, 'monthly_new_subscribers').observed_state.source = 'brief_extraction'; }))).toBeNull();
  });
});
