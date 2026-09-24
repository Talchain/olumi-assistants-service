import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

// Paul's 24 September hiring brief, reconstructed as a corrected producer candidate.
// This is a no-provider contract fixture, not a claim about generated model quality.
function hiring() {
  return {
    goal: { metric: 'Productivity', operator: '>=', target_stated: false, value: null, unit: '%', horizon_months: null, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire a tech lead', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Tech leads', value: 1, value_kind: 'absolute', unit: 'people', provenance: 'explicit' }] },
      { label: 'Hire two developers', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Developers', value: 2, value_kind: 'additional', unit: 'people', provenance: 'explicit' }] },
      { label: 'Keep current team', provenance: 'ai_proposed', changes: [], interventions: [{ factor_label: 'Developers', value: 5, value_kind: 'absolute', unit: 'people', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'Tech leads', role: 'controllable' as const, baseline_known: false, baseline_value: 0, unit: 'people', plausible_max: 5, provenance: 'ai_proposed' },
      { label: 'Developers', role: 'controllable' as const, baseline_known: false, baseline_value: 5, unit: 'people', plausible_max: 20, provenance: 'ai_proposed' },
    ],
    risks: [{ label: 'Onboarding disruption', provenance: 'ai_proposed' }, { label: 'Leadership mismatch', provenance: 'ai_proposed' }],
    outcomes: [],
    links: [
      { from: 'Developers', to: 'Productivity', direction: 'positive' as const, provenance: 'ai_proposed' },
      { from: 'Tech leads', to: 'Productivity', direction: 'positive' as const, provenance: 'ai_proposed' },
      { from: 'Developers', to: 'Onboarding disruption', direction: 'positive' as const, provenance: 'ai_proposed' },
      { from: 'Tech leads', to: 'Leadership mismatch', direction: 'positive' as const, provenance: 'ai_proposed' },
      { from: 'Onboarding disruption', to: 'Productivity', direction: 'negative' as const, provenance: 'ai_proposed' },
      { from: 'Leadership mismatch', to: 'Productivity', direction: 'negative' as const, provenance: 'ai_proposed' },
    ],
    unknowns: ['Current headcount is estimated, not confirmed.'],
  };
}

async function construct(...candidates: CandidateModel[]) {
  let graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } | undefined;
  let calls = 0;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) graph = (body as { graph: typeof graph }).graph;
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromBrief('33333333-3333-4333-8333-333333333333',
    'Should I hire a Tech lead or two developers to increase productivity?', dispatch,
    async () => ({ text: JSON.stringify(candidates[Math.min(calls++, candidates.length - 1)]) }));
  return { result, graph, calls };
}

function invalidRisk() {
  const candidate = hiring();
  candidate.links = candidate.links.filter((l) => l.to !== 'Onboarding disruption');
  candidate.links.push({ from: 'Hire two developers', to: 'Onboarding disruption', direction: 'positive', provenance: 'ai_proposed' });
  return candidate;
}

describe('provisional hiring construction uses real admission and registration payload', () => {
  it('fits the actual structured schema, adds headcount once, and retains estimated provenance', async () => {
    const validate = new Ajv({ strict: false }).compile(buildCandidateSchema());
    expect(validate(hiring()), JSON.stringify(validate.errors)).toBe(true);
    const prepared = prepareProvisionalCandidate(hiring());
    expect(prepared.issues).toEqual([]);
    expect(prepared.candidate.factors[1]).toMatchObject({ baseline_known: false, baseline_value: 5, provenance: 'ai_proposed' });
    expect(prepared.candidate.options[1].interventions?.[0]).toMatchObject({ value: 7, provenance: 'ai_proposed' });
    expect(prepareProvisionalCandidate(prepared.candidate).candidate).toEqual(prepared.candidate);
    const { result, graph, calls } = await construct(hiring());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(calls).toBe(1);
    const option = graph?.nodes.find((n) => n.label === 'Hire two developers');
    expect(option?.interventions).toEqual({ developers: { value: 0.35, source: 'cee_hypothesis' } });
    expect(graph?.nodes.find((n) => n.kind === 'goal')).not.toHaveProperty('goal_threshold_raw');
  });

  it('keeps true user-supplied totals and distinguishes an absolute two from an additional two', () => {
    const c = hiring();
    c.options[1].interventions[0].value_kind = 'absolute';
    expect(prepareProvisionalCandidate(c).candidate.options[1].interventions?.[0]).toMatchObject({ value: 2, provenance: 'explicit' });
    c.options[1].interventions[0].value_kind = 'additional';
    c.factors[1].baseline_known = true;
    c.factors[1].provenance = 'explicit';
    const prepared = prepareProvisionalCandidate(c).candidate;
    expect(prepared.options[1].interventions?.[0]).toMatchObject({ value: 7, provenance: 'explicit' });
    expect(admitCandidateModel(prepared, {}).nodes.find((n) => n.label === 'Developers')?.observed_state).toMatchObject({ raw_value: 5, source: 'brief_extraction' });
  });

  it.each(['missing baseline', 'wrong unit'])('refuses unresolved addition after one bounded retry: %s', async (fault) => {
    const c: CandidateModel = hiring();
    if (fault === 'missing baseline') c.factors[1].baseline_value = null;
    else c.options[1].interventions![0].unit = 'GBP';
    const { result, graph, calls } = await construct(c);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'construction_needs_semantic_repair' });
    expect(graph).toBeUndefined();
    expect(calls).toBe(2);
  });

  it('repairs a direct option-risk hypothesis through a factor without dropping its downstream effect', async () => {
    const { result, graph, calls } = await construct(invalidRisk(), hiring());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(calls).toBe(2);
    expect(graph?.edges.some((e) => e.from === 'developers' && e.to === 'onboarding_disruption')).toBe(true);
    expect(graph?.edges.some((e) => e.from === 'onboarding_disruption' && e.to === 'productivity')).toBe(true);
  });

  it.each(['strand risk', 'reverse risk'])('rejects a repair that retains risk nodes but changes the hypothesis: %s', async (fault) => {
    const c = hiring();
    if (fault === 'strand risk') c.links = c.links.filter((l) => l.to !== 'Onboarding disruption');
    else c.links = c.links.map((l) => l.from === 'Onboarding disruption' ? { ...l, direction: 'positive' } : l);
    const { result, graph } = await construct(invalidRisk(), c);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'construction_needs_semantic_repair' });
    expect(graph).toBeUndefined();
  });
});
