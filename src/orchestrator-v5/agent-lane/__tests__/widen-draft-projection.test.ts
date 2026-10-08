import { describe, expect, it, vi } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { widenDraft, widenedRiskMarker, widenedRiskNote, WIDENED_RISK_MARKER_DOWN } from '../runtime/widen-draft.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import { doorLevelOf, estimateLevelPersists } from '../runtime/agent-capabilities.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { widenGate, widenTurnFromSignals } from '../method-turn/widen-turn.js';
import { withoutPreconditionRisks } from '../../../graph/inert-risk.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

describe('P05b widening retains the level its existing options gate checked', () => {
  it('aw-signed-percent: admission cannot add today twice to an estimate on the admitted frame', async () => {
    const brief = 'We want to deliver 20 features. Today price change is 0%. We can reduce price change by 15% or increase it by 10%. Pilot effort is currently 0 hours and can range up to 10 hours.';
    const candidate: CandidateModel = {
      goal: { metric: 'Features delivered', operator: '>=', value: 20, unit: 'features', horizon_months: null, provenance: 'explicit' },
      constraints: [],
      options: [
        { label: 'Carry on as now', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
        { label: 'Reduce price', provenance: 'explicit', interventions: [{ factor_label: 'Price change', value: -15, unit: '%', provenance: 'explicit' }] },
        { label: 'Increase price', provenance: 'explicit', interventions: [{ factor_label: 'Price change', value: 10, unit: '%', provenance: 'explicit' }] },
      ],
      factors: [
        { label: 'Price change', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'explicit', plausible_max: 100 },
        { label: 'Pilot effort', role: 'observable', baseline_known: true, baseline_value: 0, unit: 'hours', provenance: 'explicit', plausible_max: 10 },
      ],
      risks: [{ label: 'Supplier delay', provenance: 'explicit' }, { label: 'Customer disruption', provenance: 'explicit' }],
      outcomes: [],
      links: [
        { from: 'Price change', to: 'Features delivered', direction: 'positive', provenance: 'inferred' },
        { from: 'Pilot effort', to: 'Features delivered', direction: 'positive', provenance: 'inferred' },
      ],
    };
    const admitted = admitCandidateModel(candidate, {}, brief);
    const graph = { nodes: admitted.nodes, edges: admitted.edges };
    const price = admitted.nodes.find(n => n.label === 'Price change')!;
    expect(price.observed_state).toMatchObject({ raw_value: 100, cap: 200 });
    const unit = price.observed_state!.unit!;
    const estimate = { value: 90, unit, estimate: true, basis: 'A bounded discount pilot for the team to test' };
    const args = { options: [{
      label: 'Combine price and pilot',
      acts_on: [
        { factor_label: 'Price change', direction: 'negative', level: estimate },
        { factor_label: 'Pilot effort', direction: 'positive', level: { value: 1, unit: 'hours', estimate: true, basis: 'One hour for a bounded pilot' } },
      ],
      rationale: 'The generator rationale must be discarded',
    }] };
    const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [], graph,
      analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
    const turn = widenTurnFromSignals(signals, graph);
    expect(turn.kind).toBe('run');
    if (turn.kind !== 'run') throw new Error('The fixture must reach the existing options gate');
    expect(widenGate(turn, args).passing_indices).toEqual([0]);
    expect(estimateLevelPersists(doorLevelOf(estimate)!, price as never, graph, args.options[0]!.label)).toEqual({ ok: true, value: 0.45 });
    const bytes = JSON.stringify(admitted);
    const callStructured = vi.fn<CallStructuredModel>(async () => ({ text: JSON.stringify(args) }));
    // Re-admitting the raw 90 to the pre-restatement candidate would make it 190/200.
    // Optional widening must close rather than silently reverse this checked move.
    expect(await widenDraft({ admitted, candidate, brief, deadlineAt: Date.now() + 60_000, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(admitted)).toBe(bytes);
  });

  it('aw-b1-run-projection: added risks remain on the graph, reach no goal edge and enter no analysis input', async () => {
    const brief = 'We want to deliver 20 features in six months. Today we have 0 Engineer hires and 0 Contractor hours. Engineer hires can range up to 10 people; Contractor hours up to 100 hours. Hire two engineers or use 20 contractor hours.';
    const candidate: CandidateModel = {
      goal: { metric: 'Features delivered', operator: '>=', value: 20, unit: 'features', horizon_months: 6, provenance: 'explicit' },
      constraints: [],
      options: [
        { label: 'Carry on as now', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
        { label: 'Hire engineers', provenance: 'explicit', interventions: [{ factor_label: 'Engineer hires', value: 2, unit: 'people', provenance: 'explicit' }] },
        { label: 'Use contractors', provenance: 'explicit', interventions: [{ factor_label: 'Contractor hours', value: 20, unit: 'hours', provenance: 'explicit' }] },
      ],
      factors: [
        { label: 'Engineer hires', role: 'observable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 10 },
        { label: 'Contractor hours', role: 'observable', baseline_known: true, baseline_value: 0, unit: 'hours', provenance: 'explicit', plausible_max: 100 },
      ],
      risks: [{ label: 'Supplier delay', provenance: 'explicit' }],
      outcomes: [],
      links: [
        { from: 'Engineer hires', to: 'Features delivered', direction: 'positive', provenance: 'inferred' },
        { from: 'Contractor hours', to: 'Features delivered', direction: 'positive', provenance: 'inferred' },
      ],
    };
    const admitted = admitCandidateModel(candidate, {}, brief);
    const callStructured = vi.fn<CallStructuredModel>(async (request) => ({ text: JSON.stringify(
      request.instructions.includes('suggest risks they have not considered')
        ? { risk_suggestions: [{ label: 'Hiring stalls', category: 'timing', mechanism: 'relies_on',
          hits_id: 'hire_engineers', through_id: 'engineer_hires', through_direction: 'positive',
          affects_id: 'features_delivered', direction: 'negative', relies_on: 'both hires joining in time', watch_for: 'offers remain unaccepted' }] }
        : { options: [] }) }));
    const widened = await widenDraft({ admitted, candidate, brief, deadlineAt: Date.now() + 60_000, callStructured });
    expect(widened).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(widened!.counts).toEqual({ options: 0, risks: 1 });
    const originalIds = new Set(admitted.nodes.map((node) => node.id));
    const addedRisks = widened!.admitted.nodes.filter((node) => node.kind === 'risk' && !originalIds.has(node.id));
    expect(addedRisks.map((node) => node.id)).toEqual(['hiring_stalls']);
    const graph = GraphV3.parse({ nodes: widened!.admitted.nodes, edges: widened!.admitted.edges,
      ...(widened!.admitted.goal_constraints.length > 0 ? { goal_constraints: widened!.admitted.goal_constraints } : {}) });
    const graphBytes = JSON.stringify(graph);
    for (const risk of addedRisks) {
      const receipt = graph.nodes.find((node) => node.id === risk.id)?.draft_widening;
      expect(receipt && 'affects' in receipt ? receipt.affects : undefined).toMatchObject({ id: 'features_delivered', direction: 'negative' });
      expect(graph.edges.filter((edge) => edge.from === risk.id || edge.to === risk.id)).toEqual([]);
    }
    // This is the shared compute projection called by the real Run handler before its input readers.
    const analysisInput = withoutPreconditionRisks(graph);
    for (const risk of addedRisks) expect(JSON.stringify(analysisInput)).not.toContain(risk.id);
    expect(analysisInput.nodes.find((node) => node.id === 'supplier_delay')).toEqual(graph.nodes.find((node) => node.id === 'supplier_delay'));
    expect(analysisInput.edges).toEqual(graph.edges);
    expect(JSON.stringify(graph)).toBe(graphBytes);
    expect(widenedRiskNote(widened!.counts)).toBe("Risks Olumi added aren't in the chance yet, so it may be too high.");
    expect(widenedRiskMarker(addedRisks)).toBe(WIDENED_RISK_MARKER_DOWN);
    // Display renaming cannot change which identity is excluded or cause the original risk to disappear.
    const renamed = { ...graph, nodes: graph.nodes.map((node) => node.id === 'hiring_stalls' ? { ...node, label: 'Supplier delay' } : node) };
    const renamedInput = withoutPreconditionRisks(renamed);
    expect(renamedInput.nodes.map((node) => node.id)).not.toContain('hiring_stalls');
    expect(renamedInput.nodes.map((node) => node.id)).toContain('supplier_delay');
  });
});
