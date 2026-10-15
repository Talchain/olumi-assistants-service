import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { admitCandidateModel, framedObservedState, TODAY_LEVEL, TODAY_UNIT, type CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel } from '../verified-option-setting.js';
import { withdrawUnstatedBaselineStamps } from '../stated-by-user.js';
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
import { analysisAdmissionFrom } from '../../admission/analysis-admission.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';

const cases = [
  { label: 'Net monthly clearance', value: 250, unit: 'jobs/month', quote: 'After new intake is counted, we work off a net 250 jobs a month.', third: 'Our competitor works off a net 250 jobs a month.' },
  { label: 'Additional assessors', value: 2, unit: 'assessors', quote: 'We could bring in two extra assessors at £2,900 a month each.', third: 'Our competitor could bring in two extra assessors at £2,900 a month each.' },
  { label: 'Completed appointments', value: 920, unit: 'appointments/month', quote: 'Our clinic completes 920 appointments each month.', third: 'Our competitor completes 920 appointments each month.' },
];
/** A brief that names the quantity but writes no figure: the drafter's tag alone decides (#2942's receipt gate). */
const UNWRITTEN = 'Our clinic completes appointments every month.';
type Mutable<T> =T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
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
  // S4 V2 origin (DL ruling (b), 12 Oct): a figure the brief WRITES in the factor's frame is the user's, role unverified,
  // whatever the drafter tagged; #2942's receipt gate still holds where the brief does not write it (Olumi's estimate).
  for (const provenance of ['explicit', 'from_brief', 'ai_proposed', 'inferred']) for (const written of [true, false]) {
    it(`three states: refused ${provenance} material retains its true author and level ask (the brief ${written ? 'writes' : 'does not write'} the figure)`, async () => {
      const m = model(); const label = m.factors[0]!.label;
      const claimed = provenance === 'explicit' || provenance === 'from_brief' || written;
      const brief = written ? cases[2]!.quote : UNWRITTEN;
      m.factors[0]!.provenance = provenance; m.factors[0]!.baseline_evidence = null;
      m.factors[0]!.baseline_known = provenance === 'explicit' || provenance === 'from_brief';
      m.options = m.options.map(o => ({ ...o, changes: [], interventions: [] }));
      m.constraints = [{ metric: label, operator: '>=', value: 900, unit: 'appointments/month', provenance: 'explicit' }];
      let graph: any;
      const dispatch: InternalDispatch = async (path, body) => {
        if (path.endsWith('/graph/register')) graph = GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph));
        return { status: 200, json: { registered: true, graph: { nodes: [], edges: [] } } };
      };
      const call: CallStructuredModel = async () => ({ text: JSON.stringify(m) });
      const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, dispatch, call);
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
      // ONE PROVENANCE AUTHORITY: a HELD figure's label is its own provenance, whatever extraction type a caller passes, and
      // the value pair is total (Olumi's figure says ai_inferred; it no longer defers to the caller's fallback).
      expect(NodeV3.parse({ ...n, provenance: nodeProvenanceDisplay('explicit', os) }).provenance).toBe(claimed ? 'unverified_brief' : 'ai_inferred');
      expect(nodeProvenanceDisplay(os.extractionType, os)).toBe(claimed ? 'unverified_brief' : 'ai_inferred');
      expect(observedValueAuthorship(os)?.provenance).toBe(claimed ? 'unverified_brief' : 'ai_inferred');
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
  it('an ai_proposed known starting point the brief does not write is Olumi-produced, never unverified user material', () => {
    const m = model(); m.factors[0]!.provenance = 'ai_proposed'; m.factors[0]!.baseline_evidence = null;
    const n = admitCandidateModel(m, {}, UNWRITTEN).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state?.source).toBe('cee_inference');
    expect(n.observed_state?.user_material_unverified).toBeUndefined();
    expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).toBe('ai_inferred');
    expect(n.observed_state?.extractionType).toBe('inferred');
    expect(valueAuthorshipOf(n.observed_state)).toBe('olumi_estimate');
  });
  it('an inferred known starting point the brief does not write is an AI estimate without explicit marker leakage', () => {
    const m = model(); m.factors[0]!.provenance = 'inferred'; m.factors[0]!.baseline_evidence = null;
    const n = admitCandidateModel(m, {}, UNWRITTEN).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state).toMatchObject({ source: 'cee_inference', extractionType: 'inferred', raw_value: 920, unit: 'appointments/month' });
    expect(n.observed_state?.user_material_unverified).toBeUndefined();
    expect(valueAuthorshipOf(n.observed_state)).toBe('olumi_estimate');
    expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).toBe('ai_inferred');
  });
  it('a human-named entity with an unknown baseline the brief does not write retains an AI-estimated level', () => {
    const m = model(); m.factors[0]!.baseline_known = false; m.factors[0]!.baseline_evidence = null;
    const n = admitCandidateModel(m, {}, UNWRITTEN).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state).toMatchObject({ source: 'cee_inference', extractionType: 'inferred', raw_value: 920, unit: 'appointments/month' });
    expect(n.observed_state?.user_material_unverified).toBeUndefined();
    expect(valueAuthorshipOf(n.observed_state)).toBe('olumi_estimate');
    expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).toBe('ai_inferred');
  });
  // S4 V2 origin (DL ruling (b)): the SAME three uncited drafts, but the brief writes "920 appointments each month". The
  // figure is the user's, role unverified, written by the SAME admission writer as an uncited explicit claim (no new stamp).
  for (const [name, tag] of [['ai_proposed known starting point', { provenance: 'ai_proposed' }],
    ['inferred known starting point', { provenance: 'inferred' }], ['human-named entity with an unknown baseline', { baseline_known: false }]] as const) {
    it(`a ${name} the brief WRITES is the user's, role unverified, through the existing unverified-claim writer`, () => {
      const m = model(); Object.assign(m.factors[0]!, tag); m.factors[0]!.baseline_evidence = null;
      const n = admitCandidateModel(m, {}, cases[2]!.quote).nodes.find(n => n.kind === 'factor')!;
      expect(n.observed_state?.user_material_unverified).toBe(true);
      expect(valueAuthorshipOf(n.observed_state)).toBe('unknown');
      expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).toBe('unverified_brief');
      const claim = model(); claim.factors[0]!.baseline_evidence = null;
      const claimed = admitCandidateModel(claim, {}, cases[2]!.quote).nodes.find(n => n.kind === 'factor')!;
      expect(n.observed_state, 'same writer, same bytes as an uncited explicit claim').toEqual(claimed.observed_state);
    });
  }
  it('the same number in ANOTHER quantity stays Olumi\'s: "920 visits" or "920" as a share is not this factor\'s figure', () => {
    for (const brief of ['Our clinic completes 920 home visits each month.', 'Our clinic fills 920 of its rota slots.']) {
      const m = model(); m.factors[0]!.provenance = 'ai_proposed'; m.factors[0]!.baseline_evidence = null;
      const n = admitCandidateModel(m, {}, brief).nodes.find(n => n.kind === 'factor')!;
      expect(valueAuthorshipOf(n.observed_state), brief).toBe('olumi_estimate');
    }
  });
  // ⭐ ONE PROVENANCE AUTHORITY (DL 12 Oct, the census's three-state rule): with NO extraction type the recognised stamp decides —
  // absent-type cee_inference is Olumi's, absent-type brief_extraction the brief's. ⚠ This reverses S7's pinned F1 'unknown'
  // (AIE #94 6094306696) — flagged to the DL/AIE with its one-row switch (provenance-of.ts AI_VALUE_STAMP / HUMAN_VALUE_STAMP).
  it('a legacy absent-type numeric origin reads as Olumi\'s by its stamp (the one rule), with no validator verdict', () => {
    const os = framedObservedState({ ...model().factors[0]!, provenance: 'ai_proposed' });
    expect(os.source).toBe('cee_inference');
    expect(os.extractionType).toBeUndefined();
    expect(os.user_material_unverified).toBeUndefined();
    expect(valueAuthorshipOf(os)).toBe('olumi_estimate');
    expect(nodeProvenanceDisplay(os.extractionType, os)).toBe('ai_inferred');
  });
  it('the trusted human formatter writes its attestation (`explicit`) beside the stamp, without a validator verdict', () => {
    // DL 12 Oct: the typed door verified the figure (`figureTheUserWrote`), so it attests it; a type-less stamp would be the
    // person's by its stamp alone, disclosed as unverified on the chance.
    const os = framedObservedState(model().factors[0]!);
    expect(os).toStrictEqual({ value: 0.46, raw_value: 920, cap: 2000, declared_scale: 'unit_interval', unit: 'appointments/month', source: 'brief_extraction',
      extractionType: 'explicit' });
    expect(valueAuthorshipOf(os)).toBe('yours');
    expect(nodeProvenanceDisplay(os.extractionType, os)).toBe('from_brief');
  });
  it('the definitional today level gains neither an AI nor an explicit extraction marker', () => {
    const os = framedObservedState({ ...model().factors[0]!, provenance: 'ai_proposed', baseline_value: TODAY_LEVEL, unit: TODAY_UNIT }, false);
    expect(os.source).toBeUndefined();
    expect(os.extractionType).toBeUndefined();
    expect(os.user_material_unverified).toBeUndefined();
    expect(valueAuthorshipOf(os)).toBe('unknown');
    // An unestablished origin is never said as Olumi's: the figure's label is "not confirmed", not "AI inferred".
    expect(nodeProvenanceDisplay(os.extractionType, os)).toBe('unverified_brief');
  });
  it('withdrawal preserves unverified claims and leaves legacy withdrawn numeric origins unknown', () => {
    const m = model(); m.factors[0]!.baseline_evidence = null;
    const unverified = admitCandidateModel(m, {}, cases[2]!.quote).nodes.find(n => n.kind === 'factor')!;
    // The LEGACY carrier: the formatter's type-less shape from before it wrote its attestation (DL 12 Oct).
    const { extractionType: _attested, ...legacyState } = framedObservedState(model().factors[0]!);
    const legacy = { kind: 'factor', label: cases[2]!.label, observed_state: legacyState };
    const [kept, withdrawn] = withdrawUnstatedBaselineStamps([unverified, legacy], 'We are reviewing service.');
    expect(kept).toBe(unverified);
    expect(kept?.observed_state).toMatchObject({ source: 'cee_inference', extractionType: 'inferred', user_material_unverified: true });
    expect(valueAuthorshipOf(kept?.observed_state)).toBe('unknown');
    expect(nodeProvenanceDisplay(kept?.observed_state?.extractionType, kept?.observed_state)).toBe('unverified_brief');
    expect(withdrawn?.observed_state).toMatchObject({ source: 'cee_inference' });
    expect(withdrawn?.observed_state?.extractionType).toBeUndefined();
    expect(valueAuthorshipOf(withdrawn?.observed_state)).toBe('olumi_estimate');
    expect(nodeProvenanceDisplay(withdrawn?.observed_state?.extractionType, withdrawn?.observed_state)).toBe('ai_inferred');
  });
  it('valid receipt carries user credit, display and authorship with no unverified marker', () => {
    const m = model(); const n = admitCandidateModel(m, {}, cases[2]!.quote).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state).toMatchObject({ source: 'brief_extraction' });
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
  it('keeps evidence optional for replay (recordings) and NEVER sends it: SYSTEM 2 retired it at the strict provider boundary', () => {
    const instruction = 'For a factor whose CURRENT level the brief states, give baseline_evidence.quote as the complete verbatim sentence that states it; null for estimates, targets, limits or ambiguous ownership.';
    expect(BUILD_INSTRUCTIONS.split(instruction)).toHaveLength(1);
    const schema = buildCandidateSchema() as any;
    const properties = schema.properties.factors.items.properties;
    expect(properties.baseline_evidence).toEqual({ anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: { quote: { type: 'string' } }, required: ['quote'] }], description: 'Complete verbatim brief sentence stating this factor’s current level; null otherwise.' });
    const replay = strictForTheDrafter(schema, { providerBoundary: false }) as any;
    expect(replay.properties.factors.items.required.includes('baseline_evidence')).toBe(false);
    expect(replay.properties.options.items.properties.interventions.items.required.includes('stated_evidence')).toBe(false);
    const sent = strictForTheDrafter(schema, { providerBoundary: true }) as any;
    expect([sent.properties.factors.items.properties.baseline_evidence, sent.properties.factors.items.required.includes('baseline_evidence')]).toEqual([undefined, false]);
    expect(sent.properties.options.items.properties.interventions.items.properties.stated_evidence).toBeUndefined();
    // Contrast: a sibling the boundary still requires.
    expect(sent.properties.factors.items.required.includes('baseline_value')).toBe(true);
    const old = model(); delete old.factors[0]!.baseline_evidence;
    const validate = new Ajv({ strict: false }).compile((strictForTheDrafter(schema, { providerBoundary: false }) as any).properties.factors.items);
    expect(validate(old.factors[0]), JSON.stringify(validate.errors)).toBe(true);
  });
  // S4 V2 origin (DL ruling (b)): with no receipt, a brief that WRITES the figure makes it the user's, role unverified; a
  // brief that does not leaves the drafter's estimate Olumi's (#2942's gate). Neither ever upgrades the candidate.
  it('real buildModelFromBrief: valid receipts credit; missing receipts never upgrade estimates', async () => {
    for (const row of cases) {
    // Paul (DL 13:0xZ): no change may add a refusal or an ask. The origin rule relabels; it never blocks or asks more.
    const seen: Partial<Record<'quote' | 'written' | 'unwritten', { asks: number; mode: string; analysable: boolean }>> = {};
    for (const receipt of ['quote', 'written', 'unwritten'] as const) {
      const hasQuote = receipt === 'quote';
      const brief = receipt === 'unwritten' ? 'We track this every month.' : row.quote;
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
      const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, dispatch, call, undefined, undefined, undefined, snapshot => { observed = snapshot.candidate; });
      expect(out.ok, JSON.stringify(out)).toBe(true);
      // A matching number without a receipt must not upgrade the candidate before admission either.
      if (!hasQuote) {
        expect(observed?.factors[0]?.baseline_known).toBe(false);
        expect(observed?.factors[0]?.provenance).toBe('inferred');
      }
      graph = GraphV3.parse(projectGraphForPersistence(graph));
      const factor = graph.nodes.find((n: any) => n.kind === 'factor' && n.label === row.label);
      expect(factor.observed_state.source).toBe(hasQuote ? 'brief_extraction' : 'cee_inference');
      expect(factor.observed_state.user_material_unverified, `${row.label} ${receipt}`).toBe(receipt === 'written' ? true : undefined);
      expect(factor.observed_state.raw_value).toBe(row.value);
      expect(JSON.stringify(graph)).not.toContain('baseline_evidence');
      const questions = (out as { open_questions?: string[] }).open_questions ?? [];
      if (receipt === 'unwritten') expect(questions.some(q => q.startsWith(`What is "${row.label}" today?`) && q.includes("Olumi's estimate"))).toBe(true);
      else if (receipt === 'written') expect(questions, row.label).toContain(`What is "${row.label}" today? Not confirmed from your brief`);
      else expect(questions.some(q => q.startsWith(`What is "${row.label}" today?`))).toBe(false);
      const verdict = analysisAdmissionFrom(resolveRunAdmission(graph), graph);
      seen[receipt] = { asks: questions.filter(q => q.includes(row.label)).length, mode: verdict.permitted_analysis_mode,
        analysable: verdict.structurally_analysable };
    }
    expect(seen.written, `${row.label}: the user's unverified figure asks no more and blocks no more than Olumi's estimate`).toEqual(seen.unwritten);
    expect(seen.written?.asks, row.label).toBe(1);
    expect(seen.quote?.asks, `CONTRAST: a receipted figure is not asked about (${row.label})`).toBe(0);
    }
  });
});

// Independent controls: no retained-response literals, provider calls or file writes.
describe('run 3 bounded span corrections', () => {
  function current(label: string, value: number, unit: string, quote: string) {
    return model({ label, value, unit, quote, third: '' });
  }
  const loss = () => current('Net waiting-list change per month', -35, 'people/month', 'We work off a net 35 people a month.');
  const bikes = () => current('Bikes in service', 340, 'bikes', 'We have three hundred and forty bikes in service.');
  const share = () => current('Taproom sales share', 70, '%', 'We have a taproom sales share of seventy per cent.');
  const stock = () => {
    const m = current('Registered borrowers today', 19000, 'borrowers', 'We have nineteen thousand registered borrowers.');
    m.goal.metric = 'Registered borrowers'; m.goal.unit = 'borrowers'; m.goal.value = 20000;
    return m;
  };
  const check = (m: ReturnType<typeof current>) => verify(m, m.factors[0]!.baseline_evidence!.quote);
  it('B1 credits a signed net change only beside its explicit direction and matching period', () => {
    expect(check(loss())).toBe(true);
    const wrongPeriod = loss(); wrongPeriod.factors[0]!.unit = 'people/year';
    expect(check(wrongPeriod)).toBe(false);
  });
  it('B1 refuses both opposite signs, absent direction, a remote direction and a prospective delta', () => {
    for (const [value, quote] of [
      [-35, 'We have been gaining a net 35 people a month.'],
      [35, 'We work off a net 35 people a month.'],
      [-35, 'We have a net 35 people a month.'],
      [-35, 'We work off a net 10 people a month and have 35 people a month.'],
      [-35, 'We could work off a net 35 people a month.'],
    ] as const) expect(check(current('Net waiting-list change per month', value, 'people/month', quote)), quote).toBe(false);
  });
  it('B2 credits identical current stock and goal quantity, including a terminal dated label', () => {
    expect(check(stock())).toBe(true);
    const dated = stock(); dated.factors[0]!.label = 'Registered borrowers at month 0';
    expect(check(dated)).toBe(true);
  });
  it('B2 retains a rival sharing the quantity and rejects a different scope, noun or period', () => {
    const rival = stock(); rival.factors.push({ ...rival.factors[0]!, label: 'Registered borrowers', baseline_evidence: null });
    expect(check(rival)).toBe(false);
    const scoped = stock(); scoped.factors[0]!.label = 'Campus registered borrowers today';
    expect(check(scoped)).toBe(false);
    const noun = stock(); noun.goal.metric = 'Registered borrower capacity';
    expect(check(noun)).toBe(false);
    const period = stock(); period.goal.unit = 'borrowers/month';
    expect(check(period)).toBe(false);
  });
  it('B2 preserves the goal-target refusal for a compound number word with no target vocabulary', () => {
    const m = stock(); m.goal.value = 19000;
    expect(check(m)).toBe(false);
  });
  it('B3 credits typed compound counts and written percent units in owned current reports', () => {
    expect(check(bikes())).toBe(true);
    expect(check(share())).toBe(true);
  });
  it('B3 refuses a nearby unit from a different quantity and an unnamed qualified subset', () => {
    expect(check(current('Bikes in service', 340, 'bikes', 'We have three hundred and forty scooters in service.'))).toBe(false);
    expect(check(current('Campus bikes', 340, 'bikes', 'We have three hundred and forty bikes.'))).toBe(false);
  });
  it('B3 preserves third-party ownership refusal with the same number words and unit', () => {
    expect(check(current('Rival e-scooters in zone', 340, 'scooters', 'The rival e-scooter operator runs three hundred and forty rival e-scooters in zone.'))).toBe(false);
    expect(check(current('Competitor monthly brewing volume', 6500, 'litres/month', 'Our nearest competitor brews six thousand five hundred litres a month.'))).toBe(false);
  });
  it('B3 refuses a hundred without a counted quantity, an idiom, and a rate with a different unit', () => {
    for (const [value, unit, quote] of [
      [100, 'bikes', 'We have a hundred.'],
      [70, 'bikes', 'We have seventy reasons to keep bikes in service.'],
      [70, 'bikes', 'We have seventy bikes a month.'],
      [70, '%', 'We have seventy bikes in service.'],
    ] as const) expect(check(current('Bikes in service', value, unit, quote)), quote).toBe(false);
  });
  it('all three paths refuse goal targets, ceilings, option effects and add-roughly deltas', () => {
    for (const [label, value, unit, quote] of [
      ['Registered borrowers today', 20000, 'borrowers', 'Our goal is to have twenty thousand registered borrowers.'],
      ['Bikes in service', 340, 'bikes', 'We have at most three hundred and forty bikes in service.'],
      ['Bikes in service', 340, 'bikes', 'We could add three hundred and forty bikes in service.'],
      ['Bikes in service', 340, 'bikes', 'We add roughly three hundred and forty bikes in service.'],
      ['Net waiting-list change per month', -35, 'people/month', 'We could add roughly 35 people a month.'],
    ] as const) expect(check(current(label, value, unit, quote)), quote).toBe(false);
  });
  it('B3 keeps exact quote and compound-word neighbour uniqueness gates', () => {
    const m = bikes(); const quote = m.factors[0]!.baseline_evidence!.quote;
    expect(verify(m, quote.replace('have', 'own'))).toBe(false);
    expect(verify(m, `${quote} We mentioned three hundred and forty.`)).toBe(false);
    expect(verify(m, `${quote} We mentioned 340.`)).toBe(false);
    expect(verify(m, `${quote} Olumi suggested the number.`)).toBe(false);
  });
});

describe('B4 same-clause first-person ownership', () => {
  const current = (label: string, value: number, unit: string, quote: string) => model({ label, value, unit, quote, third: '' });
  const positives = [
    ['subordinate prefix before the owned net rate', 'Net waiting-list change per month', -35, 'people/month', 'Once new registrations are counted we work off a net 35 people a month.'],
    ['historical period before the owned net rate', 'Net borrower change per month', -120, 'borrowers/month', 'Over the last year we have been losing a net 120 borrowers a month.'],
    ['coordinated named current stock', 'First check-up waiting list today', 1150, 'people', 'We see 160 patients a week, and the waiting list for a first check-up stands at 1,150 people.'],
    ['explicit subject in a later clause', 'Registered borrowers today', 19000, 'borrowers', 'Our library service lends 14,800 items a month across five branches, and we currently have nineteen thousand registered borrowers.'],
    ['owned scheme current count in words', 'Bikes in service', 340, 'bikes', 'Our city bike-hire scheme has three hundred and forty bikes in service and averages 2,900 hires a week.'],
  ] as const;
  for (const [name, label, value, unit, quote] of positives) it(`credits ${name}`, () => {
    const m = current(label, value, unit, quote);
    expect(verify(m, quote)).toBe(true);
    const n = admitCandidateModel(m, {}, quote).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state?.source).toBe('brief_extraction');
    expect(n.observed_state?.user_material_unverified).toBeUndefined();
  });
  it('distinguishes a following historical period from a following bound', () => {
    const quote = 'We have nineteen thousand registered borrowers.';
    const m = current('Registered borrowers today', 19000, 'borrowers', quote);
    expect(verify(m, `${quote} Over the last year we have been losing a net 120 borrowers a month.`)).toBe(true);
    expect(verify(m, `${quote} At most.`)).toBe(false);
    expect(verify(m, `${quote} The county wants at least 20000 borrowers.`)).toBe(false);
    expect(verify(m, `${quote} We have over 20000 items.`)).toBe(false);
  });
  for (const quote of [
    'Our supplier claims 920 completed appointments each month.',
    'Our clinic reports 920 completed appointments each month.',
    'Our clinic says 920 completed appointments each month.',
    'According to our clinic we have 920 completed appointments each month.',
    'We have, according to our clinic, 920 completed appointments each month.',
    'They have 920 completed appointments each month.',
    'Our supplier’s completed appointments are 920 appointments each month.',
    'We would like 920 completed appointments each month.',
    'We aim for 920 completed appointments each month.',
    'We can add roughly 920 completed appointments each month.',
    'We plan for 920 completed appointments each month.',
    'We forecast 920 completed appointments each month.',
    'We have at most 920 completed appointments each month.',
    'We have a limit of 920 completed appointments each month.',
    'We have a target of 920 completed appointments each month.',
    'We have 920 completed appointments each month as a ceiling.',
    'While we complete appointments, the clinic completes 920 completed appointments each month.',
    'Once we count appointments, they have 920 completed appointments each month.',
    'We have completed appointments while another clinic has 920 completed appointments each month.',
    'Our clinic completes checks, and the other clinic has 920 completed appointments each month.',
  ]) it(`withholds credit: ${quote}`, () => {
    const m = current('Completed appointments', 920, 'appointments/month', quote);
    expect(verify(m, quote)).toBe(false);
    const n = admitCandidateModel(m, {}, quote).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state?.source).toBe('cee_inference');
    expect(n.observed_state?.user_material_unverified).toBe(true);
  });
  for (const [label, value, unit, quote] of [
    ['Rival e-scooters in zone', 340, 'scooters', 'The rival e-scooter operator runs three hundred and forty rival e-scooters in zone.'],
    ['Competitor monthly brewing volume', 6500, 'litres/month', 'Our nearest competitor brews six thousand five hundred litres a month.'],
    ['Bikes in service', 340, 'bikes', 'The council wants three hundred and forty bikes in service.'],
    ['Bikes in service', 340, 'bikes', 'Our supplier’s bikes in service are three hundred and forty bikes in service.'],
    ['Net waiting-list change per month', -35, 'people/month', 'Once new registrations are counted we have been gaining a net 35 people a month.'],
    ['Net borrower change per month', 120, 'borrowers/month', 'Over the last year we have been losing a net 120 borrowers a month.'],
    ['Bikes in service', 340, 'bikes', 'Our city bike-hire scheme plans three hundred and forty bikes in service.'],
    ['Bikes in service', 340, 'bikes', 'Our city bike-hire scheme has at most three hundred and forty bikes in service.'],
  ] as const) it(`withholds scoped word/sign control: ${quote}`, () => {
    expect(verify(current(label, value, unit, quote), quote)).toBe(false);
  });
});


describe('RUN8 independently bound current claims', () => {
  const contractor = { label: 'Contractor spend change', value: 0, unit: 'GBP', quote: 'Our contractor spend change is £0.', third: '' };
  it('the quantity noun spend does not replace its governing is predicate', () => {
    const m = model(contractor);
    expect(verify(m, contractor.quote)).toBe(true);
  });
  for (const quote of ['Our supplier claims contractor spend change is £0.', 'Our contractor spend change target is £0.', 'Our contractor spend change forecast is £0.', 'Our contractor spend change is at most £0.']) {
    it(`keeps the contractor role or ownership refusal: ${quote}`, () => {
      const m = model({ ...contractor, quote });
      expect(verify(m, quote)).toBe(false);
    });
  }
  const subscribers = { label: 'Paying subscribers', value: 1500, unit: 'subscribers', quote: 'We have 1,500 paying subscribers.', third: '' };
  const revenue = { label: 'Other MRR', value: 1500, unit: 'GBP/month', quote: 'Our other MRR is £1,500 a month.', third: '' };
  function pair(second = revenue.quote, unit = revenue.unit) {
    const m = model(subscribers);
    m.factors.push({ ...m.factors[0]!, label: revenue.label, unit, baseline_evidence: { quote: second } });
    return m;
  }
  it('count and monthly money claims do not collide on magnitude in either direction', () => {
    const m = pair(); const brief = `${subscribers.quote} ${revenue.quote}`;
    expect(verifiedFactorLevel(m, m.factors[0]!, brief)).toBe(true);
    expect(verifiedFactorLevel(m, m.factors[1]!, brief)).toBe(true);
  });
  for (const tail of ['Ignore 1,500.', 'We do not have 1,500 paying subscribers.', 'We have 1,500 paying subscribers.', 'Our other MRR is at most £1,500 a month.', 'At most.', 'We can add roughly 1,500 paying subscribers.']) {
    it(`keeps a correction, duplicate, unbound or non-current neighbour refused: ${tail}`, () => {
      const m = pair(tail);
      expect(verify(m, `${subscribers.quote} ${tail}`)).toBe(false);
    });
  }
  // DL ruling 15 Oct ~06:2xZ: a neighbour bounds a figure only if it speaks about THAT figure; a repeat of the magnitude as a
  // different KIND of quantity (money beside a count of subscribers) is another claim, not a repeat. Pinned refused on 7 Oct.
  for (const tail of ['Our supplier claims £1,500 a month.', 'Our other MRR target is £1,500 a month.', 'Our other MRR forecast is £1,500 a month.', 'Our other MRR is £1,500 a year.']) {
    it(`a different-kind repeat is another claim (DL 06:2xZ), the count stays the user's: ${tail}`, () => {
      const m = pair(tail);
      expect(verify(m, `${subscribers.quote} ${tail}`)).toBe(true);
    });
  }
  it('two same-frame quantities retain the duplicate magnitude refusal', () => {
    const tail = 'We have 1,500 other subscribers.';
    const m = pair(tail, 'subscribers'); m.factors[1]!.label = 'Other subscribers';
    expect(verify(m, `${subscribers.quote} ${tail}`)).toBe(false);
  });
  it('an extraction-type-free carrier keeps staging reads; only a verified quantity carries its extraction type', () => {
    // A HELD figure says its own provenance (the one rule); a figure-less carrier keeps the extraction type's display.
    expect(nodeProvenanceDisplay(undefined, { source: 'brief_extraction', value: 0 })).toBe('from_brief');
    expect(nodeProvenanceDisplay('explicit', { source: 'brief_extraction', extractionType: 'explicit', value: 0 })).toBe('from_brief');
    expect(nodeProvenanceDisplay(undefined, { source: 'brief_extraction' })).toBe('ai_inferred');
    expect(nodeProvenanceDisplay('inferred', { source: 'brief_extraction', value: 0 })).toBe('from_brief');
    expect(nodeProvenanceDisplay(undefined, { source: 'cee_inference', value: 0 })).toBe('ai_inferred');
    expect(nodeProvenanceDisplay(undefined, { source: 'cee_inference', value: 0, user_material_unverified: true })).toBe('unverified_brief');
  });
});
