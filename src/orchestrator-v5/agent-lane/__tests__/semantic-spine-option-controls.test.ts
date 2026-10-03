import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Rec = Record<string, unknown>;
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });

// Controls run after pricing's transcript-free acceptance. The defining mechanism is expressed with existing
// factors and option changes. A level we do not know stays absent; the existing readiness question survives reload.
describe('Phase 2: existing option representation preserves incomplete pricing mechanisms', () => {
  it.each([
    { label: 'Raise Pro to £59 with 1 free month', lever: 'Free months', value: 1, unit: 'months', unknown: 'Introductory offer exposure', brief: 'Explore raising Pro to £59 with 1 free month. We have not specified which subscribers receive the introductory offer.' },
    { label: 'Charge £10 per seat instead of flat-plan pricing', lever: 'Price per seat', value: 10, unit: 'GBP per seat per month', unknown: 'Billable seats per subscription', brief: 'Explore charging £10 per seat instead of flat-plan pricing. We have not specified the billable seats per subscription.' },
  ])('$label retains its mechanism and unknown input after transcript-free reload', async control => {
    const wire = {
      goal: { metric: 'MRR', operator: '>=', target_stated: false, frame: 'level', value: null, unit: 'GBP/month', horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null },
      constraints: [], options: [
        { label: 'Keep current pricing', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
        { label: control.label, provenance: 'explicit', is_status_quo: null, changes: [control.unknown], interventions: [{ factor_label: control.lever, value: control.value, value_kind: 'absolute', unit: control.unit, provenance: 'explicit' }] },
      ],
      factors: [
        { label: control.lever, role: 'controllable', baseline_known: false, baseline_value: null, unit: control.unit, provenance: 'explicit', plausible_max: control.value * 10 },
        { label: control.unknown, role: 'controllable', baseline_known: false, baseline_value: null, unit: control.unit === 'months' ? '%' : 'seats per subscription', provenance: 'inferred', plausible_max: 100 },
      ], risks: [], outcomes: [], links: [link(control.lever, 'MRR'), link(control.unknown, 'MRR')], identities: [], unknowns: [], decision_question: null,
    };
    expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
    let graph: unknown;
    const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) graph = GraphV3.parse((body as {graph: unknown}).graph);
      return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'control-revision' } };
    };
    const built = await buildModelFromBrief('77787778-7778-4777-8777-777877787778', control.brief, dispatch, call);
    expect(built.ok, JSON.stringify(built)).toBe(true);
    graph = GraphV3.parse(JSON.parse(JSON.stringify(graph))); // No brief, transcript or builder memory in either reader.
    const canonical = graph as {nodes: Rec[]; edges: Rec[]};
    const option = canonical.nodes.find(n => n.label === control.label)!;
    const lever = canonical.nodes.find(n => n.label === control.lever)!;
    const unknown = canonical.nodes.find(n => n.label === control.unknown)!;
    expect(option).toBeDefined(); expect(lever).toBeDefined(); expect(unknown).not.toHaveProperty('observed_state');
    expect(canonical.edges.some(e => e.from === option.id && e.to === unknown.id)).toBe(true);
    expect(JSON.stringify(option.interventions)).toContain(String(lever.id));
    const readiness = assessCanonicalAnalysisReadiness(graph);
    expect(JSON.stringify(readiness)).toContain(control.unknown);
    expect(readiness.analysisReady?.status).not.toBe('ready');
    const context = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({ scenario_id: '77787778-7778-4777-8777-777877787778', authenticated_user_id: null, request_id: 'r-controls' });
    expect(JSON.stringify(context)).toContain(control.label); expect(JSON.stringify(context)).toContain(control.unknown);
    // The mechanism can be retained without a new primitive. This does not attest a horizon-aware pricing calculation.
  });
});
