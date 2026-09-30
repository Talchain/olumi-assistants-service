import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { partitionM1Candidate } from '../m1-candidate-partition.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { deriveIntakeOptionReconciliation } from '../../../orchestrator/context/intake-option-reconciliation.js';

type Rec = Record<string, any>;
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/m1-four-captured-candidates-20260929.json', import.meta.url), 'utf8')) as {
  cases: { id: string; brief: string; candidates: CandidateModel[] }[];
};
const fixture = (id: string) => FIXTURE.cases.find((c) => c.id === id)!;
async function build(candidate: CandidateModel, brief: string) {
  let registered: Rec | null = null;
  const call = vi.fn(async () => ({ text: JSON.stringify(candidate) }));
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) {
      registered = (body as { graph: Rec }).graph;
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  const result = await buildModelFromBrief('99999999-9999-4999-8999-999999999999', brief, dispatch, call as CallStructuredModel, undefined, 'm1');
  return { result, graph: registered as unknown as Rec, call };
}

describe('M1 partition replays the four frozen real drafts', () => {
  it.each(FIXTURE.cases)('$id keeps user values and options, withdrawing invented zero baselines before admission', ({ id, brief, candidates }) => {
    const original = candidates[0]!;
    const before = JSON.stringify(original);
    const { candidate, proposals } = partitionM1Candidate(original, brief);
    expect(candidate.options).toHaveLength(id === 'E' ? 2 : 1);
    expect(candidate.goal).toEqual(original.goal);
    expect(candidate.constraints).toEqual(original.constraints);
    for (const factor of original.factors.filter((f) => f.provenance === 'explicit' && f.baseline_known)) {
      expect(candidate.factors.find((f) => f.label === factor.label)).toEqual(factor.baseline_value === 0 ? { ...factor, baseline_known: false, baseline_value: null } : factor);
    }
    for (const option of original.options.filter((o) => o.provenance === 'explicit')) {
      const kept = candidate.options.find((o) => o.label === option.label)!;
      expect(kept).toBeDefined();
      for (const intervention of option.interventions ?? []) if (intervention.provenance === 'explicit') expect(kept.interventions).toContainEqual(intervention);
    }
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.actions.join('/') === 'explore/add/dismiss')).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
  });

  it.each(FIXTURE.cases)('$id registers the faithful projection; guesses remain proposals and cost no coverage retry', async ({ id, brief, candidates }) => {
    const { result, graph, call } = await build(candidates[0]!, brief);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(GraphV3.safeParse(graph).success).toBe(true);
    expect(graph.nodes.filter((n: Rec) => n.kind === 'option')).toHaveLength(id === 'E' ? 2 : 1);
    expect(graph.nodes.filter((n: Rec) => n.kind === 'option').every((n: Rec) => n.provenance === 'from_brief')).toBe(true);
    expect(result.constructor_placeholders).toBeDefined();
    expect(call).toHaveBeenCalledTimes(1);
    expect(result.construction_retried).toBe(false);
    expect((result.constructor_proposals as unknown[]).length).toBeGreaterThan(0);
    expect(graph.constructor_proposals).toBeUndefined();
    expect(graph.nodes.some((n: Rec) => /Phased|£54|One senior, two juniors|Existing delivery capacity|Platform delivery effort|Onboarding drag|Chat concurrency|First-response time|New paying subscribers/.test(n.description ?? n.label))).toBe(false);
    const levels = graph.nodes.flatMap((n: Rec) => n.observed_state ? [n.observed_state.raw_value ?? n.observed_state.value] : []);
    if (id === 'paul-mrr') {
      expect(levels).toEqual(expect.arrayContaining([49, 1500, 75000]));
      expect(levels).not.toContain(3.5);
      expect(levels).not.toContain(53);
      const churn = graph.nodes.find((n: Rec) => n.label === 'Monthly churn');
      expect(churn).toBeDefined();
      expect(churn.observed_state).toBeUndefined();
      expect(churn.provenance).not.toBe('from_brief');
      const option = graph.nodes.find((n: Rec) => n.kind === 'option');
      expect(Object.values(option.interventions).some((v: any) => (v.raw_value ?? v.value) === 59)).toBe(true);
      expect(result.constructor_placeholders).toContain('Monthly churn');
      const questions = result.open_questions as string[];
      expect(questions.some((q) => q.includes('£75k') && q.includes('£49') && q.includes('£73.5k') && /scope/.test(q))).toBe(true);
      expect(questions.some((q) => /\b3\.5%|53 per month/.test(q))).toBe(false);
      expect(graph.edges.some((e: Rec) => e.strength_source === 'cee_inference')).toBe(false);
    }
    if (id === 'support') expect(levels).toEqual(expect.arrayContaining([3, 400, 82]));
    if (id === 'E') {
      const settings = graph.nodes.filter((n: Rec) => n.kind === 'option').flatMap((n: Rec) => Object.values(n.interventions ?? {})).map((v: any) => v.raw_value ?? v.value);
      expect(settings).not.toEqual(expect.arrayContaining([2, 4]));
      expect(levels).not.toContain(0);
      expect((result.open_questions as string[]).some((q) => q.includes('addition of 2 engineers') && q.includes('starting level'))).toBe(true);
      expect((result.open_questions as string[]).some((q) => q.includes('What makes'))).toBe(false);
      expect(result.additions_without_total).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 2, reason: 'baseline_unknown' }),
        expect.objectContaining({ value: 4, reason: 'baseline_unknown' }),
      ]));
    }
  });
});

describe('M1 authority and recovery controls', () => {
  it.each([false, true])('literal listed Option A/Option B retain distinct authorship; borrowed name=%s', async (borrowed) => {
    const raw = structuredClone(fixture('paul-mrr').candidates[0]!);
    const candidate = { ...raw, options: ['A', 'B'].map((letter, i) => ({
      ...raw.options[0]!, label: `Option ${letter}`, brief_words: `Option ${borrowed ? ['B', 'A'][i] : letter}`, interventions: [],
    })) };
    const brief = 'The options are Option A, or Option B. We currently have £75k MRR and want MRR above £85k.';
    const { result, graph } = await build(candidate, brief);
    expect(result.ok).toBe(true);
    const saved = GraphV3.parse(graph);
    // The existing intake enumeration grammar does not quote bare A/B labels; this guard preserves their ownership,
    // without pretending that a swapped literal name binds the other source item or adding a new intake grammar.
    expect(saved.nodes.filter((n) => n.kind === 'option').map((n) => [n.label, n.provenance]))
      .toEqual(borrowed ? [] : [['Option A', 'from_brief'], ['Option B', 'from_brief']]);
  });

  it.each([
    { words: 'increase the Pro plan price from £49 to £59', value: 59, label: 'Raise to £59', valid: true },
    { words: 'price Pro at £59 with a setup credit to £54', value: 59, label: 'Raise to £59', valid: true },
    { words: 'price Pro at £59 with a setup credit to £54', value: 54, label: 'Price Pro at £54', valid: false },
    { words: 'increase the Pro plan price from £49 to £59', value: 49, label: 'Pro plan price', valid: false },
    { words: 'increase the Pro plan price from £49 to £59', value: 59, label: 'Keep at £59', valid: false },
    { words: 'raise Pro price to £59 with a £54 setup credit', value: 59, label: 'Raise Pro price to £59', factor: 'Setup credit', valid: false },
  ])('MG b05 numeric binding: $label / $words keeps the source option=$valid', async ({ words, value, label, factor, valid }) => {
    const raw = structuredClone(fixture('paul-mrr').candidates[0]!);
    const setting = raw.options[0]!.interventions![0]!;
    const candidate = { ...raw, factors: factor === undefined ? raw.factors : [...raw.factors, { ...raw.factors[0]!, label: factor }], options: [
      { ...raw.options[0]!, label, provenance: 'explicit', brief_words: words, interventions: [{ ...setting, value, factor_label: factor ?? setting.factor_label }] },
      { ...raw.options[1]!, label: 'Keep at £49', provenance: 'explicit', brief_words: 'keep it at £49', interventions: [{ ...setting, value: 49 }] },
    ] };
    const brief = `The options are ${words}, or keep it at £49. We currently have £75k MRR and want MRR above £85k.`;
    const { graph, result } = await build(candidate, brief);
    expect(result.ok).toBe(true);
    const saved = GraphV3.parse(graph);
    const binding = deriveIntakeOptionReconciliation(brief, saved, saved);
    const option = saved.nodes.find((n) => n.kind === 'option' && n.label === label);
    expect(binding.mayNameLeadingOption).toBe(valid);
    if (valid) {
      expect(option).toMatchObject({ provenance: 'from_brief', source_quote: words });
      expect(Object.values(option!.interventions!).some((i) => i.raw_value === 59 && i.source === 'brief_extraction')).toBe(true);
    } else {
      expect(option).toBeUndefined();
      expect(result.constructor_proposals).toContainEqual(expect.objectContaining({ kind: 'option', label }));
    }
  });

  it('an explicit tag without a source action cannot admit an invented option', async () => {
    const { brief, candidates } = fixture('paul-mrr');
    const raw = structuredClone(candidates[0]!);
    const invented = { ...raw.options[2]!, provenance: 'explicit' };
    const { result, graph } = await build({ ...raw, options: [raw.options[0]!, invented] }, brief);
    expect(result.ok).toBe(true);
    expect(graph.nodes.filter((n: Rec) => n.kind === 'option')).toHaveLength(1);
    expect(result.constructor_proposals).toContainEqual(expect.objectContaining({ kind: 'option', label: invented.label }));
  });

  it.each([
    { value: 54, label: 'Raise to £54', provenance: 'ai_proposed', valid: false },
    { value: 54, label: 'Raise Pro price', provenance: 'ai_proposed', valid: false },
    { value: 54, label: 'Raise to £59', provenance: 'explicit', valid: false },
    { value: 59, label: 'Keep at £59', provenance: 'ai_proposed', valid: false },
    { value: 59, label: 'Raise to £59', provenance: 'ai_proposed', valid: true },
  ])('borrowed list-item quote: $label / $value / $provenance has valid ownership=$valid', async ({ value, label, provenance, valid }) => {
    const raw = structuredClone(fixture('paul-mrr').candidates[0]!);
    const brief = 'The options are raise Pro price to £59, or keep it at £49. We currently have £75k MRR and want MRR above £85k.';
    const setting = raw.options[0]!.interventions![0]!;
    const candidate = { ...raw, options: [
      { ...raw.options[0]!, label, provenance, brief_words: 'raise Pro price to £59', interventions: [{ ...setting, value, provenance: valid ? 'explicit' : provenance }] },
      { ...raw.options[1]!, label: 'Keep at £49', provenance: 'explicit', brief_words: 'keep it at £49', interventions: [{ ...setting, value: 49, provenance: 'explicit' }] },
    ] };
    const { result, graph } = await build(candidate, brief);
    expect(result.ok).toBe(true);
    const saved = GraphV3.parse(graph);
    const binding = deriveIntakeOptionReconciliation(brief, saved, saved);
    expect(binding.state).toBe(valid ? 'reconciled' : 'options_missing');
    expect(binding.mayNameLeadingOption).toBe(valid);
    const option = saved.nodes.find((n) => n.kind === 'option' && n.label === label);
    if (valid) {
      expect(option).toMatchObject({ provenance: 'from_brief', source_quote: 'raise Pro price to £59' });
      expect(option?.proposed_by).toBeUndefined();
      expect(Object.values(option!.interventions!).some((i) => i.raw_value === 59 && i.source === 'brief_extraction')).toBe(true);
    } else {
      expect(option).toBeUndefined();
      expect(result.constructor_proposals).toContainEqual(expect.objectContaining({ kind: 'option', label, payload: expect.objectContaining({ provenance }) }));
      expect(saved.nodes.some((n) => n.kind === 'option' && n.source_quote === 'raise Pro price to £59')).toBe(false);
    }
  });

  it.each([{ value: 49, unit: 'GBP/month' }, { value: 59, unit: 'EUR/month' }])('a quote cannot certify the current amount or a swapped currency: $value $unit', async ({ value, unit }) => {
    const raw = structuredClone(fixture('paul-mrr').candidates[0]!);
    const candidate = { ...raw, options: [{ ...raw.options[0]!, label: 'Raise Pro price', interventions: [{ ...raw.options[0]!.interventions![0]!, value, unit }] }] };
    const { result, graph } = await build(candidate, fixture('paul-mrr').brief);
    expect(result.ok).toBe(true);
    expect(graph.nodes.filter((n: Rec) => n.kind === 'option')).toHaveLength(0);
    expect(result.constructor_proposals).toContainEqual(expect.objectContaining({ kind: 'option', label: 'Raise Pro price' }));
  });

  it('an explicit source action supports an inferred option; repeated action quotes do not claim authorship', () => {
    const { brief, candidates } = fixture('paul-mrr');
    const raw = structuredClone(candidates[0]!);
    const first = { ...raw.options[0]!, provenance: 'ai_proposed' };
    const candidate = { ...raw, options: [first] };
    expect(partitionM1Candidate(candidate, brief).candidate.options).toHaveLength(1);
    const words = (first as unknown as { brief_words: string }).brief_words;
    const ambiguous = partitionM1Candidate(candidate, `${brief} ${words}`);
    expect(ambiguous.candidate.options).toHaveLength(0);
    expect(ambiguous.proposals.some((p) => p.kind === 'option')).toBe(true);
  });

  it.each(['£49', 'raise our Pro plan price from £49 to £59 a month'])('a reused source quote %s cannot promote an invented Keep £49 option', (brief_words) => {
    const { brief, candidates } = fixture('paul-mrr');
    const raw = structuredClone(candidates[0]!);
    const keep = { ...raw.options[1]!, brief_words };
    const result = partitionM1Candidate({ ...raw, options: [keep] }, brief);
    expect(result.candidate.options).toHaveLength(0);
    expect(result.proposals.some((p) => p.kind === 'option')).toBe(true);
    expect(result.option_quotes.size).toBe(0);
  });

  it.each(['0 senior engineers hired', 'zero senior engineers hired'])('retains a user-stated zero current count: %s', (statement) => {
    const { brief, candidates } = fixture('E');
    const result = partitionM1Candidate(candidates[0]!, `${brief} We currently have ${statement}.`);
    expect(result.candidate.factors.find((f) => f.label === 'Senior engineers hired')?.baseline_value).toBe(0);
    expect(result.candidate.factors.find((f) => f.label === 'Junior engineers hired')?.baseline_value).toBeNull();
  });

  it('an explicit provider tag cannot keep an unstated numeric baseline', () => {
    const { brief, candidates } = fixture('paul-mrr');
    const raw = structuredClone(candidates[0]!);
    const candidate = { ...raw, factors: raw.factors.map((f) => f.label === 'Pro plan price' ? { ...f, baseline_value: 99 } : f) };
    const result = partitionM1Candidate(candidate, brief);
    expect(result.candidate.factors.find((f) => f.label === 'Pro plan price')?.baseline_value).toBeNull();
    expect(result.proposals).toContainEqual(expect.objectContaining({ kind: 'value', field_path: 'factors[Pro plan price].baseline_value' }));
  });

  it('a user-stated absolute option setting keeps its authorship when the current level is missing', async () => {
    const { brief, candidates } = fixture('paul-mrr');
    const candidate = structuredClone(candidates[0]!);
    const changed = { ...candidate, factors: candidate.factors.map((f) => f.label === 'Pro plan price' ? { ...f, baseline_known: false, baseline_value: null } : f) };
    const { result, graph, call } = await build(changed, brief);
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    const option = graph.nodes.find((n: Rec) => n.kind === 'option');
    const setting = Object.values(option.interventions).find((v: any) => (v.raw_value ?? v.value) === 59) as Rec;
    expect(setting.source).toBe('brief_extraction');
  });

  it('reapplying after a retry cannot restore a guessed current level or AI option', () => {
    const { brief, candidates } = fixture('paul-mrr');
    const first = partitionM1Candidate(candidates[0]!, brief);
    const retry = {
      ...first.candidate,
      options: [...first.candidate.options, candidates[0]!.options[2]!],
      factors: first.candidate.factors.map((f) => f.label === 'Monthly churn' ? { ...f, baseline_known: false, baseline_value: 4.2 } : f),
    };
    const next = partitionM1Candidate(retry, brief);
    expect(next.candidate.options).toHaveLength(1);
    expect(next.candidate.factors.find((f) => f.label === 'Monthly churn')?.baseline_value).toBeNull();
    expect(next.proposals.some((p) => p.field_path === 'factors[Monthly churn].baseline_value')).toBe(true);
  });
});


describe('M1 saved live target-scope regression', () => {
  const live = JSON.parse(readFileSync(new URL('./fixtures/m1-live-paul-inferred-carrier-20260929.json', import.meta.url), 'utf8')) as { brief: string; candidate: CandidateModel };

  it('does not fold an inferred Pro-plan identity onto unresolved all-plan MRR or recreate its default edges', async () => {
    const { graph, result, call } = await build(live.candidate, live.brief);
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    const goal = graph.nodes.find((n: Rec) => n.kind === 'goal');
    expect(goal.observed_state.raw_value).toBe(75000);
    expect(goal.nonlinear_identity).toBeUndefined();
    expect(graph.edges.filter((e: Rec) => e.to === goal.id)).toHaveLength(0);
    expect(graph.nodes.some((n: Rec) => /Pro plan MRR|Non-Pro MRR/.test(n.description ?? n.label))).toBe(false);
    const questions = result.open_questions as string[];
    expect(questions.some((q) => /MRR/.test(q) && /all plans/.test(q) && /Pro plan/.test(q))).toBe(true);
    expect(questions.join(' ')).not.toMatch(/accounts for your|is worked out as|£1\.5k|so the model measures|treats it as all-plan/i);
    expect((result.constructor_proposals as Rec[]).some((p) => p.kind === 'definition')).toBe(true);
    const disclosures = result.not_represented as string[];
    expect(disclosures.some((line) => /scope.*unresolved/i.test(line))).toBe(true);
    expect(disclosures.join(' ')).not.toMatch(/model measures.*all plans|Olumi.s assumption.*brief does not say/i);
  });

  it('keeps an inferred direct goal identity outside M1 even when its scope flag says resolved', async () => {
    const candidate = structuredClone(live.candidate);
    candidate.goal.scope = { modelled: 'the Pro plan only', alternative: 'all plans', stated_in_brief: true };
    candidate.identities = [{ ...candidate.identities![0]!, outcome: candidate.goal.metric }];
    candidate.links = candidate.identities[0]!.factors.map((from) => ({ from, to: candidate.goal.metric, provenance: 'inferred', direction: 'positive' }));
    const { graph } = await build(candidate, live.brief);
    const goal = graph.nodes.find((n: Rec) => n.kind === 'goal');
    expect(goal.nonlinear_identity).toBeUndefined();
    expect(graph.edges.filter((e: Rec) => e.to === goal.id)).toHaveLength(0);
  });

  it('continues to carry an explicit user definition through existing admission', async () => {
    const candidate = structuredClone(live.candidate);
    candidate.goal.scope = { modelled: 'the Pro plan only', alternative: 'all plans', stated_in_brief: true };
    candidate.goal.baseline_value = 73500;
    candidate.identities = [{ ...candidate.identities![0]!, outcome: candidate.goal.metric, provenance: 'explicit' }];
    candidate.links = candidate.identities[0]!.factors.map((from) => ({ from, to: candidate.goal.metric, provenance: 'explicit', direction: 'positive' }));
    const brief = live.brief.replace('£75k MRR', '£73.5k MRR') + ' MRR means Pro-plan MRR only and equals Average realised Pro price multiplied by Pro paying subscribers.';
    const { graph, result } = await build(candidate, brief);
    expect(result.ok).toBe(true);
    const goal = graph.nodes.find((n: Rec) => n.kind === 'goal');
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: true });
  });
});
