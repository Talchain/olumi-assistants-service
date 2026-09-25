/**
 * ⭐ PROOF BEYOND SCHEMA VALIDITY — a freshly generated model gets a provisional
 * first analysis when it is admissible, and Olumi's estimates stay Olumi's.
 *
 * Three briefs of different shape, each passed through the REAL construction
 * (`buildModelFromBrief` → `admitCandidateModel` → the `/graph/register` payload),
 * parsed with CEE's own `GraphV3`, and judged by the real Run admission
 * (`resolveRunAdmission`) and the analysis admission the Agent reads
 * (`resolveAnalysisAdmission`):
 *
 *   · HIRING  — Paul's brief: a tech lead vs two developers vs an inert
 *               "Maintain current staffing", every current value an AI estimate.
 *   · PRICING — the canonical Pro plan brief: a stated price, an estimated churn,
 *               and an inert "Keep the current price" arm.
 *   · HELD-OUT — a contrasting logistics brief written for this suite and used
 *               nowhere else: a "Carry on as we are" arm, a zero estimate, and one
 *               estimate that cannot be framed.
 *
 * Every assertion names a node or option by its id. Counts are reported as exact
 * cases, never as a rate.
 */
import { describe, it, expect } from 'vitest';
import type { CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { resolveAnalysisAdmission } from '../../admission/analysis-admission.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type F = CandidateModel['factors'][number];
const est = (label: string, value: number | null, plausible_max: number | null, unit: string, over: Partial<F> = {}): F => ({
  label, role: 'controllable', baseline_known: false, baseline_value: value, unit, provenance: 'inferred', plausible_max, ...over,
});
const link = (from: string, to: string, direction: 'positive' | 'negative') => ({ from, to, direction, provenance: 'inferred' });

const HIRING = (devEstimate = 6): CandidateModel => ({
  goal: { metric: 'Velocity', operator: '>', value: 40, unit: 'points per sprint', horizon_months: null, provenance: 'explicit' },
  constraints: [],
  options: [
    { label: 'Hire a Tech Lead', provenance: 'explicit', changes: [],
      interventions: [{ factor_label: 'Tech leads', value: 1, unit: 'FTE', provenance: 'explicit' }] },
    { label: 'Hire Two Developers', provenance: 'explicit', changes: [],
      interventions: [{ factor_label: 'Developers', value: devEstimate + 2, unit: 'FTE', provenance: 'inferred' }] },
    { label: 'Maintain current staffing', provenance: 'ai_proposed', changes: [], interventions: [] },
  ],
  factors: [
    est('Tech leads', 0, 5, 'FTE'),
    est('Developers', devEstimate, 50, 'FTE'),
    est('Coordination overhead', 20, 100, 'score'),
  ],
  risks: [], outcomes: [],
  links: [
    link('Tech leads', 'Velocity', 'positive'),
    link('Developers', 'Velocity', 'positive'),
    link('Developers', 'Coordination overhead', 'positive'),
    link('Tech leads', 'Coordination overhead', 'negative'),
    link('Coordination overhead', 'Velocity', 'negative'),
  ],
} as CandidateModel);

const PRICING = (): CandidateModel => ({
  goal: { metric: 'Monthly recurring revenue', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [],
  options: [
    { label: 'Raise to £59', provenance: 'explicit', changes: [],
      interventions: [{ factor_label: 'Pro plan price', value: 59, unit: 'GBP', provenance: 'explicit' }] },
    { label: 'Keep the current price', provenance: 'explicit', changes: [], interventions: [] },
  ],
  factors: [
    { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
    est('Monthly churn rate', 4, 100, '%', { role: 'observable' }),
    est('Pro subscribers', 400, 1000, 'subscribers', { role: 'observable' }),
  ],
  risks: [], outcomes: [],
  links: [
    link('Pro plan price', 'Monthly churn rate', 'positive'),
    link('Pro plan price', 'Monthly recurring revenue', 'positive'),
    link('Monthly churn rate', 'Pro subscribers', 'negative'),
    link('Pro subscribers', 'Monthly recurring revenue', 'positive'),
  ],
} as CandidateModel);

const HELD_OUT = (): CandidateModel => ({
  goal: { metric: 'On-time deliveries', operator: '>=', value: 95, unit: '%', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [
    { label: 'Open a second depot', provenance: 'explicit', changes: [],
      interventions: [{ factor_label: 'Depots', value: 2, unit: 'depots', provenance: 'explicit' }] },
    { label: 'Outsource the last mile', provenance: 'explicit', changes: [],
      interventions: [{ factor_label: 'Courier partners', value: 3, unit: 'partners', provenance: 'inferred' }] },
    { label: 'Carry on as we are', provenance: 'explicit', changes: [], interventions: [] },
  ],
  factors: [
    est('Depots', 1, 10, 'depots'),
    est('Courier partners', 0, 20, 'partners'),
    // Olumi's guess with no range and nothing to derive one from: stays missing.
    est('Parcel backlog', 1200, null, 'parcels', { role: 'external' }),
  ],
  risks: [], outcomes: [],
  links: [
    link('Depots', 'On-time deliveries', 'positive'),
    link('Courier partners', 'On-time deliveries', 'positive'),
    link('Parcel backlog', 'On-time deliveries', 'negative'),
  ],
} as CandidateModel);

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; scale_frame?: number };
type Graph = { nodes: Node[]; edges: { from: string; to: string; origin?: string }[] };

async function registered(model: CandidateModel): Promise<{ graph: Graph; out: Record<string, unknown> }> {
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify({ ...model, unknowns: [] }) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('66666666-6666-4666-8666-666666666666', 'A decision brief.', d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(graph) as unknown as Graph, out };
}

function verdict(g: Graph) {
  const run = resolveRunAdmission(g);
  const a = resolveAnalysisAdmission(g);
  return {
    willProceed: run.willProceed,
    mode: a.permitted_analysis_mode,
    blockers: run.assessment.blockingIssues.map((i) => i.code).sort(),
    ceeInference: g.nodes.filter((n) => n.observed_state?.source === 'cee_inference').map((n) => n.id),
  };
}

const PRICING_STATUS_QUO = (): CandidateModel => {
  const m = PRICING();
  return { ...m, options: [m.options[0]!, { ...m.options[1]!, label: 'Status quo: stay at £49' }] } as CandidateModel;
};

const valueIn = (g: unknown, id: string) =>
  ((g as Graph | null)?.nodes ?? []).find((n) => n.id === id)?.observed_state?.value;

describe('a freshly built model is admissible for a provisional first analysis (exact cases)', () => {
  it('HIRING: proceeds, provisional; every current value is Olumi’s estimate', async () => {
    const { graph } = await registered(HIRING());
    expect(verdict(graph)).toEqual({
      willProceed: true, mode: 'quantified_provisional', blockers: [],
      ceeInference: ['tech_leads', 'developers', 'coordination_overhead'],
    });
    expect(graph.nodes.find((n) => n.id === 'developers')?.observed_state).toStrictEqual({ value: 6 / 50, raw_value: 6, unit: 'FTE', source: 'cee_inference' });
  });

  it('PRICING ("Keep the current price"): refused, and says why — the label is not a status-quo idiom readiness recognises', async () => {
    const { graph, out } = await registered(PRICING());
    expect(verdict(graph)).toEqual({
      willProceed: false, mode: 'none', blockers: ['OPTION_NEEDS_MAPPING', 'OPTION_NO_FACTOR_EDGES'],
      ceeInference: ['monthly_churn_rate', 'pro_subscribers'],
    });
    // Nothing was invented to make it comparable: the arm is named as inert.
    expect(out.options_that_change_nothing).toEqual(['Keep the current price']);
    expect(graph.edges.filter((e) => e.from === 'keep_the_current_price' && e.to !== 'decision_monthly_recurring_revenue')).toEqual([]);
  });

  it('PRICING ("Status quo: stay at £49", one price arm): held and ready, but the Run floor finds one lever — nothing to compare', async () => {
    const { graph } = await registered(PRICING_STATUS_QUO());
    // The held baseline is accepted by readiness: no blocker, is_baseline, ready…
    expect(verdict(graph)).toEqual({
      willProceed: false, mode: 'exploratory', blockers: [],
      ceeInference: ['monthly_churn_rate', 'pro_subscribers'],
    });
    const sq = resolveRunAdmission(graph).assessment.analysisReady?.options.find((o) => o.option_id === 'status_quo_stay_at_49');
    expect([sq?.is_baseline, sq?.status]).toEqual([true, 'ready']);
    // …and the refusal is the Run admission's comparison floor (`comparisonSurvivesDedup`,
    // mirroring PLoT's IDENTICAL_OPTIONS), which counts only options WITH a level.
    // Not this lane's rule; reported in the PR, pinned here so a change is seen.
    expect(resolveRunAdmission(graph).blockedNextStep).toBe('Name at least two different options you are weighing, then run analysis.');
    expect(graph.nodes.find((n) => n.id === 'pro_plan_price')?.observed_state?.source).toBe('brief_extraction');
  });

  it('PRICING ("Status quo: stay at £49", two price arms): proceeds; the stated price stays the user’s', async () => {
    const m = PRICING_STATUS_QUO();
    const two = { ...m, options: [m.options[0]!, { label: 'Raise to £55', provenance: 'explicit', changes: [],
      interventions: [{ factor_label: 'Pro plan price', value: 55, unit: 'GBP', provenance: 'explicit' }] }, m.options[1]!] } as CandidateModel;
    const { graph } = await registered(two);
    // ⚠ `comparative_leader`, by the UNCHANGED claim policy: the user's stated £49
    // is in the comparison's substrate, so "partly user-stated" licenses naming a
    // leader even though churn and subscribers are Olumi's. Pinned, not endorsed —
    // permission to calculate and permission to name a leader are the policy's call.
    expect(verdict(graph)).toEqual({
      willProceed: true, mode: 'comparative_leader', blockers: [],
      ceeInference: ['monthly_churn_rate', 'pro_subscribers'],
    });
    expect(resolveAnalysisAdmission(graph).reasons.map((r) => r.code)).toContain('CONFIDENCE_PARAMETERS_PARTLY_USER_STATED');
    expect(graph.nodes.find((n) => n.id === 'pro_plan_price')?.observed_state?.source).toBe('brief_extraction');
  });

  it('HELD-OUT: proceeds, provisional; zero is kept, the unframeable guess stays missing', async () => {
    const { graph } = await registered(HELD_OUT());
    expect(verdict(graph)).toEqual({
      willProceed: true, mode: 'quantified_provisional', blockers: [],
      ceeInference: ['depots', 'courier_partners'],
    });
    expect(graph.nodes.find((n) => n.id === 'courier_partners')?.observed_state).toStrictEqual({ value: 0, raw_value: 0, unit: 'partners', source: 'cee_inference' });
    expect(graph.nodes.find((n) => n.id === 'parcel_backlog')).not.toHaveProperty('observed_state');
  });

  it('CHANGED INPUT: a different estimate reaches the analysis input as a different value', async () => {
    const a = resolveRunAdmission((await registered(HIRING(6))).graph);
    const b = resolveRunAdmission((await registered(HIRING(9))).graph);
    expect(a.willProceed && b.willProceed).toBe(true);
    expect(valueIn(a.canonicalGraph, 'developers')).toBeCloseTo(6 / 50, 12);
    expect(valueIn(b.canonicalGraph, 'developers')).toBeCloseTo(9 / 50, 12);
    // …and only that factor moved.
    for (const id of ['tech_leads', 'coordination_overhead']) {
      expect(valueIn(b.canonicalGraph, id), id).toBe(valueIn(a.canonicalGraph, id));
    }
  });

  it('UNCHANGED CONTROL: the same brief and estimates give a byte-identical analysis input', async () => {
    const a = resolveRunAdmission((await registered(HIRING(6))).graph);
    const b = resolveRunAdmission((await registered(HIRING(6))).graph);
    expect(a.canonicalGraph).not.toBeNull();
    expect(JSON.stringify(b.canonicalGraph)).toBe(JSON.stringify(a.canonicalGraph));
  });
});
