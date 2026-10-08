import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const BASIS = 'typical annual key-staff turnover in small software teams';
const LABEL = 'Key developer departure';
const PREFIX = "Revenue is £10,000 a month today. We want revenue to reach £20,000 a month within 12 months. We have 1 developer today. We're deciding between Hiring contractors and Training in-house. ";
function draft(occurrence = true, probability = false) {
  return {
    goal: { metric: 'Revenue', operator: '>=', value: 20000, unit: 'GBP/month', horizon_months: 12,
      target_stated: true, provenance: 'explicit', baseline_known: true, baseline_value: 10000, baseline_provenance: 'explicit' },
    constraints: [], options: [
      { label: 'Hiring contractors', provenance: 'explicit', changes: [], is_status_quo: false,
        interventions: [{ factor_label: 'Delivery capacity', value: 3, value_kind: 'absolute', unit: 'developers', provenance: 'ai_proposed' }] },
      { label: 'Training in-house', provenance: 'explicit', changes: [], is_status_quo: false,
        interventions: [{ factor_label: 'Delivery capacity', value: 2, value_kind: 'absolute', unit: 'developers', provenance: 'ai_proposed' }] },
    ], factors: [{ label: 'Delivery capacity', role: 'controllable', baseline_known: true,
      baseline_value: 1, unit: 'developers', plausible_max: 10, provenance: 'explicit' },
      ...(probability ? [{ label: `${LABEL} probability`, role: 'external', baseline_known: false,
        baseline_value: 10, unit: '%', plausible_max: 100, provenance: 'ai_proposed' }] : [])],
    risks: [{ label: LABEL, unit: 'GBP/month', plausible_max: 10000, provenance: 'explicit',
      occurrence: occurrence ? { p_low_pct: 10, p_high_pct: 10, horizon_months: 12, basis_text: BASIS } : null }],
    outcomes: [], links: [
      { from: 'Delivery capacity', to: 'Revenue', direction: 'positive', provenance: 'ai_proposed',
        effect_amount: 500, effect_per_source_change: 1, effect_provenance: 'ai_proposed' },
      { from: LABEL, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed',
        effect_amount: -1000, effect_per_source_change: 1, effect_provenance: 'ai_proposed' },
      ...(probability ? [{ from: `${LABEL} probability`, to: 'Revenue', direction: 'negative',
        provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null }] : []),
    ], identities: [], unknowns: [], decision_question: null,
  };
}
async function build(candidate: ReturnType<typeof draft>, statement: string) {
  let registered: unknown;
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate) });
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('ec000000-0000-4000-8000-000000000001', PREFIX + statement, dispatch, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const graph = GraphV3.parse(registered);
  return { graph, out, risk: graph.nodes.find(n => n.kind === 'risk')! };
}

describe('event branch through construction, registration body and strict graph readback', () => {
  it('holds an Olumi occurrence, basis words and natural-unit conditional impact', async () => {
    const { graph, out, risk } = await build(draft(), 'There is a risk of Key developer departure.');
    expect(risk.event_risk).toMatchObject({ occurrence: { basis: 'olumi' }, horizon: { months: 12 } });
    expect(risk.event_risk_basis_text).toBe(BASIS);
    const impact = graph.edges.find(e => e.from === risk.id)!;
    expect(impact.exists_probability).toBe(0.8);
    expect(impact.provenance?.natural_effect).toMatchObject({ amount: -1000, amount_unit: 'GBP/month', per_source_change: 1 });
    expect(out.event_risk_disclosures).toContain(`${LABEL}: May happen: about 5–18% within 12 months (Olumi's estimate, based on ${BASIS}).`);
  });
  it('explicit chance conversion survives the later user hold with its own horizon', async () => {
    const { graph, out, risk } = await build(draft(true, true), 'Key developer departure: a 10% chance he leaves within 6 months.');
    expect(risk.event_risk).toMatchObject({ occurrence: { basis: 'user', p_low: 0.1, p_high: 0.1 }, horizon: { months: 6 } });
    expect(risk.event_risk_basis_text).toBeUndefined();
    expect(graph.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
    expect(JSON.stringify(out.event_risk_disclosures)).toContain('Converted');
  });
  it('the hedge drops the probability factor and serves the prescribed disclosure', async () => {
    const { graph, out, risk } = await build(draft(false, true), 'Key developer departure: probably 10% within 6 months.');
    expect(risk.event_risk).toBeUndefined();
    expect(graph.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
    expect(out.event_risk_disclosures).toContain(`Olumi had drafted ‘${LABEL} probability’ = 10% without a basis, so it isn't used.`);
  });
});
