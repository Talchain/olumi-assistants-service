import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel } from '../verified-option-setting.js';
import { BUILD_INSTRUCTIONS, buildCandidateSchema, buildModelFromBrief, strictForTheDrafter, type CallStructuredModel } from '../runtime/build-model.js';
import { nodeProvenanceDisplay, observedValueAuthorship } from '../../../cee/transforms/provenance-display.js';
import { valueAuthorshipOf } from '../turn-context/guidance-signals.js';
import { conditionalInputBasis } from '../conditional-input-basis.js';
import { limitChecksForAgent } from '../limit-checks.js';
import { limitedLevelAsks, optionSetLimitAsks } from '../limited-level-ask.js';
import { deriveInferredValues } from '../../coaching/inferred-value-disclosure.js';
import { estimatedLimitIn } from '../../coaching/estimated-limit-card.js';
import { proposeProductIdentity, todaysLevelFor } from '../identity-proposal.js';
import { structureProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { transformNodeToV3 } from '../../../cee/transforms/schema-v3.js';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const cases = [
  { label: 'Net monthly clearance', value: 250, unit: 'jobs/month', quote: 'After new intake is counted, we work off a net 250 jobs a month.', third: 'Our competitor works off a net 250 jobs a month.' },
  { label: 'Additional assessors', value: 2, unit: 'assessors', quote: 'We could bring in two extra assessors at £2,900 a month each.', third: 'Our competitor could bring in two extra assessors at £2,900 a month each.' },
  { label: 'Completed appointments', value: 920, unit: 'appointments/month', quote: 'Our clinic completes 920 appointments each month.', third: 'Our competitor completes 920 appointments each month.' },
];
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function model(row = cases[2]!): Mutable<CandidateModel> & { unknowns: string[] } {
  const intervention = { factor_label: row.label, value: row.value + 1, value_kind: 'absolute', unit: row.unit, provenance: 'ai_proposed' };
  return {
    goal: { metric: 'Operating surplus', operator: '>=', unit: 'GBP/month', value: 10000, target_stated: false, horizon_months: null, provenance: 'inferred', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null },
    factors: [{ label: row.label, role: 'observable', baseline_known: true, baseline_value: row.value, baseline_evidence: { quote: row.quote }, unit: row.unit, provenance: 'explicit', plausible_max: 2000 }],
    options: [{ label: 'Improve service', provenance: 'ai_proposed', changes: [row.label], interventions: [intervention], is_status_quo: null }, { label: 'Keep current service', provenance: 'ai_proposed', changes: [], interventions: [], is_status_quo: true }],
    constraints: [], risks: [], outcomes: [], unknowns: [], decision_question: null,
    links: [{ from: row.label, to: 'Operating surplus', direction: 'positive', provenance: 'inferred' }],
  };
}
const verify = (m: CandidateModel, brief: string): boolean => verifiedFactorLevel(m, m.factors[0]!, brief);

describe('typed current-level sentence authority', () => {
  for (const provenance of ['explicit', 'from_brief', 'ai_proposed', 'inferred']) {
    it(`three states: refused ${provenance} material retains its true author and level ask`, async () => {
      const m = model(); const label = m.factors[0]!.label;
      const claimed = provenance === 'explicit' || provenance === 'from_brief';
      m.factors[0]!.provenance = provenance; m.factors[0]!.baseline_evidence = null;
      m.factors[0]!.baseline_known = provenance === 'explicit';
      m.options = m.options.map(o => ({ ...o, changes: [], interventions: [] }));
      m.constraints = [{ metric: label, operator: '>=', value: 900, unit: 'appointments/month', provenance: 'explicit' }];
      let graph: any;
      const dispatch: InternalDispatch = async (path, body) => {
        if (path.endsWith('/graph/register')) graph = GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph));
        return { status: 200, json: { registered: true, graph: { nodes: [], edges: [] } } };
      };
      const call: CallStructuredModel = async () => ({ text: JSON.stringify(m) });
      const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', cases[2]!.quote, dispatch, call);
      expect(out.ok, JSON.stringify(out)).toBe(true);
      const n = graph.nodes.find((n: any) => n.kind === 'factor' && n.label === label);
      const os = n.observed_state;
      expect(os.source).toBe('cee_inference');
      if (claimed) {
        expect(n.provenance).toBe('unverified_brief');
        expect(transformNodeToV3(n).provenance).toBe('unverified_brief');
        expect(transformNodeToV3(n).observed_state).toEqual(os);
      }
      expect(os.user_material_unverified).toBe(claimed ? true : undefined);
      expect(NodeV3.parse({ ...n, provenance: nodeProvenanceDisplay('explicit', os) }).provenance).toBe(claimed ? 'unverified_brief' : 'from_brief');
      expect(nodeProvenanceDisplay(os.extractionType, os)).toBe(claimed ? 'unverified_brief' : 'ai_inferred');
      expect(observedValueAuthorship(os)?.provenance).toBe(claimed ? 'unverified_brief' : undefined);
      expect(valueAuthorshipOf(os)).toBe(claimed ? 'unknown' : 'olumi_estimate');
      expect(deriveInferredValues(graph).some(r => r.factor_id === n.id)).toBe(!claimed);
      const questions = (out as { open_questions?: string[] }).open_questions ?? [];
      expect(questions.some(q => q.startsWith(`What is "${label}" today?`))).toBe(true);
      if (claimed) {
        expect(questions.filter(q => q.includes(label)).join(' ')).not.toMatch(/Olumi/i);
        expect(questions).toContain(`What is "${label}" today? Not confirmed from your brief`);
        expect(limitedLevelAsks(graph)[0]?.estimate).toBeNull();
        expect(structureProvenance(n)).toBe('unattributed');
        const basis = conditionalInputBasis({ graph, admission: { semantic_signals: { material_parameters_awaiting_user_node_ids: [n.id] } }, analysedOptionIds: graph.nodes.filter((x: any) => x.kind === 'option').map((x: any) => x.id) });
        expect(basis).toContain(`"${label}": Not confirmed from your brief`);
        expect(basis).not.toMatch(/Olumi/i);
        expect(estimatedLimitIn(graph)).toBeNull();
        const unmarked = { ...graph, nodes: graph.nodes.map((x: any) => x.id === n.id ? { ...x, observed_state: { ...os, user_material_unverified: undefined } } : x) };
        expect(estimatedLimitIn(unmarked)).not.toBeNull();
        const checks = limitChecksForAgent(graph, { per_limit: [{ constraint_id: graph.goal_constraints[0].constraint_id, state: 'estimate_only', reason: 'level_olumi_estimate' }] } as any);
        expect(checks?.[0]?.say).toContain('Not confirmed from your brief');
        expect(checks?.[0]?.say).not.toMatch(/Olumi/i);
        expect(checks?.[0]?.ask).toBe(`What is "${label}" today? Not confirmed from your brief`);
        const settingGraph = { ...graph, nodes: [...graph.nodes, { id: 'sized_option', kind: 'option', label: 'More service', interventions: { [n.id]: { value: 0.5, raw_value: 1000, source: 'cee_hypothesis', unit: 'appointments/month' } } }] };
        expect(optionSetLimitAsks(settingGraph)[0]?.question).toBe(`What is "${label}" today? Not confirmed from your brief`);
      }
    });
  }
  it('an ai_proposed known starting point is Olumi-produced, never unverified user material', () => {
    const m = model(); m.factors[0]!.provenance = 'ai_proposed'; m.factors[0]!.baseline_evidence = null;
    const n = admitCandidateModel(m, {}, cases[2]!.quote).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state?.source).toBe('cee_inference');
    expect(n.observed_state?.user_material_unverified).toBeUndefined();
    expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).toBe('ai_inferred');
    expect(valueAuthorshipOf(n.observed_state)).toBe('olumi_estimate');
  });
  it('valid receipt carries user credit, display and authorship with no unverified marker', () => {
    const m = model(); const n = admitCandidateModel(m, {}, cases[2]!.quote).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state).toMatchObject({ source: 'brief_extraction', extractionType: 'explicit' });
    expect(n.observed_state?.user_material_unverified).toBeUndefined();
    expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).toBe('from_brief');
    expect(valueAuthorshipOf(n.observed_state)).toBe('yours');
  });
  it('existing stock/time stated-level proposer refuses a flagged level, including contradictory legacy source', () => {
    const stock = { id: 'stock', kind: 'factor', label: 'Current paying subscribers', observed_state: { value: 0.15, raw_value: 1500, cap: 10000, unit: 'subscribers', source: 'brief_extraction' } };
    const graph = { nodes: [stock, { id: 'future', kind: 'outcome', label: 'Subscribers at month 12' },
      { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP per subscriber per month', source: 'brief_extraction' } },
      { id: 'goal', kind: 'goal', label: 'MRR', goal_threshold_unit: 'GBP/month', observed_state: { value: 0.375, raw_value: 75000, cap: 200000, unit: 'GBP/month', source: 'brief_extraction' }, nonlinear_identity: { operation: 'product', factor_ids: ['price', 'future'], stated_in_brief: false } }],
      edges: [{ from: 'stock', to: 'future' }, { from: 'price', to: 'goal' }, { from: 'future', to: 'goal' }] };
    expect(proposeProductIdentity(graph)).not.toBeNull();
    const marked = { ...graph, nodes: graph.nodes.map(n => n.id === 'stock' ? { ...n, observed_state: { ...stock.observed_state, user_material_unverified: true } } : n) };
    expect(proposeProductIdentity(marked)).toBeNull();
    expect(todaysLevelFor(graph, 'future')).toMatchObject({ raw: 1500, source: 'brief_extraction' });
    expect(todaysLevelFor({ ...graph, nodes: [{ ...stock, observed_state: { ...stock.observed_state, user_material_unverified: true } }, graph.nodes[1]] }, 'future')).toBeNull();
  });

  for (const row of cases) {
    it(`credits ${row.label}: ${row.quote}`, () => expect(verify(model(row), row.quote)).toBe(true));
    it(`refuses third party, same verb: ${row.third}`, () => {
      const m = model(row); m.factors[0]!.baseline_evidence = { quote: row.third };
      expect(verify(m, row.third)).toBe(false);
    });
  }
  it('refuses first-person reports of third-party figures, plans or alternatives', () => {
    for (const quote of ['We hear clinics like ours complete 920 appointments each month.',
      'We have heard our competitor completes 920 appointments each month.',
      'Our clinic’s competitor completes 920 appointments each month.',
      'We plan to complete 920 appointments each month.',
      'We complete 920 appointments each month, or 1,000 after scheduling changes.']) {
      const m = model(); m.factors[0]!.baseline_evidence = { quote };
      expect(verify(m, quote), quote).toBe(false);
    }
  });
  it('refuses the sentence holding goal.value even without goal vocabulary', () => {
    const m = model(); m.goal.value = 920;
    expect(verify(m, cases[2]!.quote)).toBe(false);
  });
  it('refuses a goal-target sentence claimed as current', () => {
    const m = model(); const quote = 'Our goal is to reach 1,100 completed appointments a month.';
    m.goal.value = 1100; m.goal.metric = 'Completed appointments'; m.factors[0]!.baseline_value = 1100; m.factors[0]!.baseline_evidence = { quote };
    expect(verify(m, quote)).toBe(false);
  });
  it('refuses a constraint value on that factor', () => {
    const m = model(); m.constraints = [{ metric: m.factors[0]!.label, value: 920, unit: 'appointments/month', operator: '>=', provenance: 'explicit' }];
    expect(verify(m, cases[2]!.quote)).toBe(false);
  });
  it('refuses a non-unique quote', () => expect(verify(model(), `${cases[2]!.quote}\n\n${cases[2]!.quote}`)).toBe(false));
  it('refuses a byte mismatch (paraphrase)', () => {
    const m = model(); m.factors[0]!.baseline_evidence = { quote: 'Our clinic finishes 920 appointments each month.' };
    expect(verify(m, cases[2]!.quote)).toBe(false);
  });
  it('refuses Olumi attribution in the paragraph', () => expect(verify(model(), `${cases[2]!.quote} Olumi suggested 920.`)).toBe(false));
  it('refuses null evidence even with an explicit known baseline and matching brief', () => {
    const m = model(); m.factors[0]!.baseline_evidence = null;
    expect(verify(m, cases[2]!.quote)).toBe(false);
    const f = admitCandidateModel(m, {}, cases[2]!.quote).nodes.find(n => n.kind === 'factor' && n.label === cases[2]!.label)!;
    expect(f.observed_state?.source).toBe('cee_inference');
  });
  it('refuses a quote holding another entity’s figure', () => {
    const m = model(); const quote = 'Our clinic completes 920 consultations each month.';
    m.outcomes = [{ label: 'Completed consultations', unit: 'consultations/month', plausible_max: 2000, provenance: 'explicit' }];
    m.factors[0]!.baseline_evidence = { quote };
    expect(verify(m, quote)).toBe(false);
  });
  it('ignores model offsets and accepts normalized whitespace', () => {
    const m = model(); m.factors[0]!.baseline_evidence = { quote: ` ${cases[2]!.quote.replace('920', '  920')} `, start: -100 } as { quote: string };
    expect(verify(m, cases[2]!.quote)).toBe(true);
  });
  it('fails closed on a malformed draft', () => {
    const m = model(); m.constraints = null as unknown as Mutable<CandidateModel['constraints']>;
    expect(verify(m, cases[2]!.quote)).toBe(false);
  });
  it('requires a named entity and the complete unit frame', () => {
    const m = model(); const quote = 'We complete 920 each month.'; m.factors[0]!.baseline_evidence = { quote };
    expect(verify(m, quote)).toBe(false);
    const wrongPeriod = 'Our clinic completes 920 appointments each year.'; m.factors[0]!.baseline_evidence = { quote: wrongPeriod };
    expect(verify(m, wrongPeriod)).toBe(false);
    const net = model(cases[0]!); const gross = 'We work off 250 gross jobs a month.'; net.factors[0]!.baseline_evidence = { quote: gross };
    expect(verify(net, gross)).toBe(false);
  });
  it('keeps evidence optional for replay and mandatory only at the strict provider boundary', () => {
    const instruction = 'For a factor whose CURRENT level the brief states, give baseline_evidence.quote as the complete verbatim sentence that states it; null for estimates, targets, limits or ambiguous ownership.';
    expect(BUILD_INSTRUCTIONS.split(instruction)).toHaveLength(2);
    const schema = buildCandidateSchema() as any;
    const properties = schema.properties.factors.items.properties;
    expect(properties.baseline_evidence).toEqual({ anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: { quote: { type: 'string' } }, required: ['quote'] }], description: 'Complete verbatim brief sentence stating this factor’s current level; null otherwise.' });
    for (const [providerBoundary, required] of [[false, false], [true, true]] as const) {
      const strict = strictForTheDrafter(schema, { providerBoundary }) as any;
      expect(strict.properties.factors.items.required.includes('baseline_evidence')).toBe(required);
      expect(strict.properties.options.items.properties.interventions.items.required.includes('stated_evidence')).toBe(required);
    }
    const old = model(); delete old.factors[0]!.baseline_evidence;
    const validate = new Ajv({ strict: false }).compile((strictForTheDrafter(schema, { providerBoundary: false }) as any).properties.factors.items);
    expect(validate(old.factors[0]), JSON.stringify(validate.errors)).toBe(true);
  });
  it('real buildModelFromBrief: valid receipts credit; missing receipts never upgrade estimates', async () => {
    for (const row of cases) for (const hasQuote of [true, false]) {
      const m = model(row); m.factors[0]!.baseline_known = false; m.factors[0]!.provenance = 'inferred';
      if (!hasQuote) m.factors[0]!.baseline_evidence = null;
      m.constraints = [{ metric: row.label, operator: '>=', value: row.value - 1, unit: row.unit, provenance: 'explicit', frame: 'level' }];
      m.options = m.options.map(o => ({ ...o, changes: [], interventions: [] }));
      let graph: any;
      let observed: CandidateModel | undefined;
      const dispatch: InternalDispatch = async (path, body) => {
        if (path.endsWith('/graph/register')) graph = (body as { graph: unknown }).graph;
        return { status: 200, json: { registered: true, graph: { nodes: [], edges: [] } } };
      };
      const call: CallStructuredModel = async () => ({ text: JSON.stringify(m) });
      const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', row.quote, dispatch, call, undefined, undefined, undefined, snapshot => { observed = snapshot.candidate; });
      expect(out.ok, JSON.stringify(out)).toBe(true);
      // A matching number without a receipt must not upgrade the candidate before admission either.
      if (!hasQuote) {
        expect(observed?.factors[0]?.baseline_known).toBe(false);
        expect(observed?.factors[0]?.provenance).toBe('inferred');
      }
      graph = GraphV3.parse(projectGraphForPersistence(graph));
      const factor = graph.nodes.find((n: any) => n.kind === 'factor' && n.label === row.label);
      expect(factor.observed_state.source).toBe(hasQuote ? 'brief_extraction' : 'cee_inference');
      expect(factor.observed_state.raw_value).toBe(row.value);
      expect(JSON.stringify(graph)).not.toContain('baseline_evidence');
      const questions = (out as { open_questions?: string[] }).open_questions ?? [];
      if (!hasQuote) expect(questions.some(q => q.startsWith(`What is "${row.label}" today?`) && q.includes("Olumi's estimate"))).toBe(true);
      else expect(questions.some(q => q.startsWith(`What is "${row.label}" today?`))).toBe(false);
    }
  });
});
