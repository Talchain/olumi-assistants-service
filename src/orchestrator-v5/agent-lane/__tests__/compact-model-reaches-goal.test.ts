/**
 * ⛔ A compact model must still reach its goal (regression from #1710).
 *
 * Measured on served `553254d`, Paul's brief, through the UI's own transport:
 * the first model was 6 nodes — decision, goal, 2 options, 2 factors — with
 * `option → factor` edges and NO `factor → goal` edge. The orphaned-goal repair in
 * admission looked only for terminal OUTCOMES; a compact model has none, so it
 * never fired. "Yes, use those." then saved the values and the comparison was
 * refused (`analysis_ready: blocked`, 0 blocks).
 *
 * Every assertion runs through the SAME admission the route uses and the estate's
 * one readiness authority, on the shape that was served.
 */
import { describe, it, expect } from 'vitest';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { disclosuresFor } from '../disclosure.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const GOAL = { metric: 'Engineering velocity', operator: '>=', value: 20, unit: 'points', horizon_months: 6, provenance: 'explicit' };
const factor = (label: string) => ({ label, role: 'controllable', baseline_known: false, baseline_value: null, unit: 'hires', plausible_max: 10, provenance: 'inferred' });
const option = (label: string, f: string, v: number) => ({ label, provenance: 'explicit', changes: [f], interventions: [{ factor_label: f, value: v, unit: 'hires', provenance: 'explicit' }] });

/** The served compact shape: no outcomes, no link from any factor to the goal. */
const SERVED_COMPACT = {
  goal: GOAL, constraints: [], risks: [], outcomes: [], unknowns: ['What limits velocity today?'],
  options: [option('Hire Tech Lead', 'Tech lead hires', 1), option('Hire Two Developers', 'Developer hires', 2)],
  factors: [factor('Tech lead hires'), factor('Developer hires')],
  links: [],
};

const admit = (c: unknown) => admitCandidateModel(c as CandidateModel, {});
const goalId = (a: ReturnType<typeof admit>) => a.nodes.find((n) => n.kind === 'goal')!.id;
const STRUCTURAL = new Set(['ORPHAN_NODE', 'NO_PATH_TO_GOAL']);

describe('a compact model still reaches its goal', () => {
  it('RED: every terminal factor is linked to the goal as a DISCLOSED, defaulted assumption', () => {
    const a = admit(SERVED_COMPACT);
    const g = goalId(a);
    const intoGoal = a.edges.filter((e) => e.to === g);
    expect(intoGoal.map((e) => e.from).sort()).toEqual(['developer_hires', 'tech_lead_hires']);
    for (const e of intoGoal) {
      expect((e as { defaulted?: boolean }).defaulted).toBe(true);
      expect(e.effect_direction).toBe('positive');
    }
    // The user is told — the repair is never silent.
    const told = a.loss.filter((l) => String(l.field_path).endsWith(`->${g}]`));
    expect(told).toHaveLength(2);
    for (const l of told) expect(l.reason).toMatch(/connected to the goal as an ASSUMPTION/);
  });

  it('RED: the readiness authority no longer reports the goal orphaned or unreachable', () => {
    const a = admit(SERVED_COMPACT);
    const r = assessCanonicalAnalysisReadiness({ nodes: a.nodes, edges: a.edges });
    const structural = r.issues.map((i) => i.code).filter((c) => STRUCTURAL.has(c));
    expect(structural, JSON.stringify(r.issues.map((i) => i.code))).toEqual([]);
    expect((r.analysisReady?.options ?? []).map((o) => o.option_id).sort()).toEqual(['hire_tech_lead', 'hire_two_developers']);
  });

  it('RED (Panel B1): the build result carries each assumed goal link, with its direction — not only the ledger', async () => {
    const calls: string[] = [];
    const call = (async () => { calls.push('x'); return { text: JSON.stringify(SERVED_COMPACT) }; }) as unknown as CallStructuredModel;
    const d: InternalDispatch = async (path) => (path.endsWith('/graph/register')
      ? { status: 200, json: { model_version: { version_number: 1 } } }
      : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } });
    const out = await buildModelFromBrief('33333333-3333-4333-8333-333333333333', 'Should I hire a Tech lead or two developers to increase velocity?', d, call) as Record<string, unknown>;
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.assumed_goal_links).toEqual([
      { from_label: 'Tech lead hires', to_label: 'Engineering velocity', direction: 'positive' },
      { from_label: 'Developer hires', to_label: 'Engineering velocity', direction: 'positive' },
    ]);
  });

  it('RED (Panel B1+B2): the server STATES each assumed link and its direction, and offers to flip it — Panel’s churn probe', () => {
    const churn = {
      ...SERVED_COMPACT,
      goal: { metric: 'Monthly recurring revenue', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
      options: [option('Raise price', 'Monthly churn', 8), option('Hold price', 'Monthly churn', 4)],
      factors: [factor('Monthly churn')],
    };
    const a = admit(churn);
    expect(a.assumed_goal_links).toEqual([{ from_label: 'Monthly churn', to_label: 'Monthly recurring revenue', direction: 'positive' }]);
    const owed = disclosuresFor([{ mutated: true, assumed_goal_links: a.assumed_goal_links }]);
    expect(owed).toHaveLength(1);
    expect(owed[0]).toContain('\u201cMonthly churn\u201d \u2192 \u201cMonthly recurring revenue\u201d: I assumed more of it raises Monthly recurring revenue');
    expect(owed[0]).toMatch(/tell me and I will flip it/);
  });

  it('CONTRAST: no assumed link → no disclosure; a non-write never discloses', () => {
    expect(disclosuresFor([{ mutated: true }])).toEqual([]);
    expect(disclosuresFor([{ mutated: false, assumed_goal_links: [{ from_label: 'A', to_label: 'G', direction: 'positive' }] }])).toEqual([]);
  });

  it('CONTRAST: when an outcome ends the chain, the outcome is linked — not the factor', () => {
    const c = {
      ...SERVED_COMPACT,
      outcomes: [{ label: 'Delivery throughput', provenance: 'inferred' }],
      links: [
        { from: 'Tech lead hires', to: 'Delivery throughput', direction: 'positive', provenance: 'inferred' },
        { from: 'Developer hires', to: 'Delivery throughput', direction: 'positive', provenance: 'inferred' },
      ],
    };
    const a = admit(c);
    const g = goalId(a);
    expect(a.edges.filter((e) => e.to === g).map((e) => e.from)).toEqual(['delivery_throughput']);
  });

  it('CONTRAST: a goal the model already connects is left exactly as the model made it', () => {
    const c = { ...SERVED_COMPACT, links: [{ from: 'Tech lead hires', to: 'Engineering velocity', direction: 'positive', provenance: 'inferred' }] };
    const a = admit(c);
    const g = goalId(a);
    const intoGoal = a.edges.filter((e) => e.to === g);
    expect(intoGoal.map((e) => e.from)).toEqual(['tech_lead_hires']);
    // ⚠ Not `defaulted`: admission sets that on ANY link whose strength it had to
    // project, including this model-supplied one. The repair's identity is its
    // disclosure — and there must be none.
    expect(a.loss.filter((l) => /connected to the goal as an ASSUMPTION/.test(String(l.reason)))).toEqual([]);
    expect(a.assumed_goal_links).toBeUndefined();
  });
});
