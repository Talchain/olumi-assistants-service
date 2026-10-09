/** Offline assertions shared with the Vitest rows. Captured bytes are never modified. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import type { CandidateModel, StatedOptionEvidence } from '../../admit-model.js';
import { admitCandidateModel } from '../../admit-model.js';
import { keepOptionsAndQuantitiesApart } from '../../keep-options-apart.js';
import { perOneLinksForConstantProducts } from '../../per-one-product.js';
import { findStatedAmounts } from '../../../../cee/provenance/stated-amounts.js';
import { verifiedOptionSetting } from '../../verified-option-setting.js';
import { creditStatedFactorLevels } from '../../stated-by-user.js';
import { buildCandidateSchema, buildModelFromBrief, carryFindingsAcrossRetry, prepareProvisionalCandidate, strictForTheDrafter, withCountInterventionRanges } from '../../runtime/build-model.js';
import type { InternalDispatch } from '../../runtime/agent-capabilities.js';
import { beforeDoorTag } from '../licence-test-graphs.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';

export const fixture = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = (path: string): any => JSON.parse(fixture(path));
export const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
export const manifest: { sc: string; brief_sha256: string; calls: { file: string; sha256: string }[] }[] = json('r5-census/manifest.json');
export const census: { sc: string; option: string; factor: string; value: number; expected: string }[] = json('r5-census/cases.json');
const annotations: { evidence: StatedOptionEvidence | null }[] = json('r5-stated-evidence.json');
export interface Probe { id: string; description: string; model: CandidateModel; brief: string; option: string; factor: string; expectation: string; evidence: StatedOptionEvidence }
export const probes: Probe[] = json('r5-verified-probes.json');
export type Row = { name: string; run: () => void | Promise<void> };
export const level = (m: CandidateModel, option: string, factor: string) => m.options.find(o => o.label === option)!.interventions!.find(i => i.factor_label === factor)!;
export const preflight = (m: CandidateModel, brief: string): CandidateModel => creditStatedFactorLevels(keepOptionsAndQuantitiesApart(perOneLinksForConstantProducts(m)).model, brief);
export const prepare = (m: CandidateModel, brief: string) => prepareProvisionalCandidate(preflight(m, brief), brief);
export const admitted = (m: CandidateModel, brief: string) => admitCandidateModel(withCountInterventionRanges(m, brief), {}, brief);
export function censusInput(index: number): { model: CandidateModel; brief: string } {
  const c = census[index]!;
  const m: CandidateModel = json(`r5-census/${c.sc}.json`);
  const brief = fixture(`r5-census/${manifest.find(r => r.sc === c.sc)!.brief_sha256}.txt`);
  Object.assign(level(m, c.option, c.factor), { stated_evidence: annotations[index]!.evidence });
  return { model: m, brief };
}
export function assertCell(m: CandidateModel, brief: string, option: string, factor: string, expected: string): void {
  const before = structuredClone(m.factors);
  const p = prepare(m, brief);
  const iv = level(p.candidate, option, factor);
  assert.equal(iv.provenance, expected);
  // The verifier neither replaces figures nor promotes an estimated baseline.
  assert.equal(iv.value, level(m, option, factor).value);
  assert.deepEqual(p.candidate.factors, preflight({ ...m, factors: before }, brief).factors);
  const a = admitted(p.candidate, brief);
  const f = a.nodes.find(n => n.label === factor)!; const o = a.nodes.find(n => n.label === option)!;
  const cell = o.interventions?.[f.id];
  assert.ok(cell);
  assert.equal(cell.source, expected === 'explicit' ? 'brief_extraction' : 'cee_hypothesis');
  assert.ok(!JSON.stringify(cell).includes('stated_evidence'));
}
const supportedProbes = new Set(['N0', 'N1a', 'N3', 'N5', 'N10c', 'B-N0']);
export const censusRows: Row[] = census.map((c, index) => {
  const underCredit = (c.sc === 'ca2cc3ca' && c.factor === 'Starter tier monthly price')
    || (c.sc === 'b7398aad' && c.factor === 'Starter-tier price');
  // Source blocks no longer have a fixture-specific exemption: imported rent is conservatively refused.
  const sourceBlock = c.sc === 'e63bd10a' && c.factor === 'Leeds monthly rent';
  const expected = underCredit || sourceBlock ? 'ai_proposed' : c.expected;
  return {
    name: `${sourceBlock ? 'SOURCE BLOCK REFUSAL (generic directContext) - ' : ''}${underCredit ? 'KNOWN UNDER-CREDIT (strict F: names the tier, not the price) — ' : ''}census ${c.sc}: ${c.option} -> ${c.factor} ${expected}`,
    run: () => { const { model, brief } = censusInput(index); assertCell(model, brief, c.option, c.factor, expected); },
  };
});
export const probeRows: Row[] = probes.map(p => ({
  name: `${p.id}: ${p.expectation === 'demote' ? 'must demote exact malicious span' : 'supported credit or conservative refusal'} — ${p.description}`,
  run: () => {
    assert.equal(p.brief.slice(p.evidence.start, p.evidence.end), p.evidence.quote);
    assert.equal(p.brief.slice(p.evidence.option_start, p.evidence.option_end), p.evidence.option_quote);
    const m = structuredClone(p.model);
    Object.assign(level(m, p.option, p.factor), { stated_evidence: p.evidence });
    assertCell(m, p.brief, p.option, p.factor, supportedProbes.has(p.id) ? 'explicit' : 'ai_proposed');
  },
}));
const positive = (): { model: CandidateModel; brief: string; evidence: StatedOptionEvidence } => {
  const input = censusInput(0);
  return { ...input, evidence: level(input.model, census[0]!.option, census[0]!.factor).stated_evidence! };
};
const mustDemote = (input: ReturnType<typeof positive>): void => assertCell(input.model, input.brief, census[0]!.option, census[0]!.factor, 'ai_proposed');
const corruptions: [string, (e: StatedOptionEvidence) => StatedOptionEvidence | null | undefined][] = [
  ['missing', () => undefined], ['null', () => null], ['paraphrased', e => ({ ...e, quote: e.quote.replace('We could', 'We might') })],
  ['forged offsets', e => ({ ...e, start: e.start + 1 })], ['forged anchor', e => ({ ...e, option_quote: 'Saturday option' })],
  ['truncated', e => ({ ...e, quote: e.quote.slice(0, -1), end: e.end - 1 })],
  ['wrong amount_start', e => ({ ...e, amount_start: e.amount_start + 1 })],
  ['noninteger', e => ({ ...e, amount_start: e.amount_start + 0.5 })], ['negative', e => ({ ...e, start: -1 })],
  ['out of bounds', e => ({ ...e, end: Number.MAX_SAFE_INTEGER })],
];
const ignoredEvidenceFields = new Set(['forged offsets', 'forged anchor', 'wrong amount_start', 'noninteger', 'negative', 'out of bounds']);
export const integrityRows: Row[] = corruptions.map(([name, corrupt]) => ({ name: `E: ${name} ${ignoredEvidenceFields.has(name) ? 'ignored; unique quote credits' : 'demotes'}`, run: () => {
  const input = positive(); Object.assign(level(input.model, census[0]!.option, census[0]!.factor), { stated_evidence: corrupt(input.evidence) });
  assertCell(input.model, input.brief, census[0]!.option, census[0]!.factor, ignoredEvidenceFields.has(name) ? 'explicit' : 'ai_proposed');
} }));
integrityRows.push(
  { name: 'E: duplicate assertion refuses even with correct offsets', run: () => { const i = positive(); i.brief += `\n${i.evidence.quote}`; mustDemote(i); } },
  { name: 'F: duplicate cell refuses', run: () => { const i = positive(); const o = i.model.options.find(o => o.label === census[0]!.option)!; Object.assign(o, { interventions: [...o.interventions!, structuredClone(o.interventions![0]!)] }); mustDemote(i); } },
  { name: 'F: duplicate factor refuses', run: () => { const i = positive(); Object.assign(i.model, { factors: [...i.model.factors, structuredClone(i.model.factors.find(f => f.label === census[0]!.factor)!)] }); const o = i.model.options.find(o => o.label === census[0]!.option)!; assert.equal(verifiedOptionSetting(i.model, o, level(i.model, census[0]!.option, census[0]!.factor), i.brief), false); } },
);
export const seamRows: Row[] = [
  { name: 'zero is required; nonzero/null estimated baseline demotes', run: () => {
    for (const value of [5, null]) { const i = positive(); Object.assign(i.model.factors.find(f => f.label === census[0]!.factor)!, { baseline_value: value }); mustDemote(i); }
  } },
  { name: 'known-baseline and missing-kind controls stay unchanged', run: () => {
    const i = positive(); const iv = level(i.model, census[0]!.option, census[0]!.factor);
    Object.assign(iv, { stated_evidence: null }); Object.assign(i.model.factors.find(f => f.label === census[0]!.factor)!, { baseline_known: true });
    assert.equal(level(prepare(i.model, i.brief).candidate, census[0]!.option, census[0]!.factor).provenance, 'explicit');
    Object.assign(i.model.factors.find(f => f.label === census[0]!.factor)!, { baseline_known: false });
    delete (iv as typeof iv & { value_kind?: string }).value_kind;
    assert.equal(level(prepare(i.model, i.brief).candidate, census[0]!.option, census[0]!.factor).provenance, 'explicit');
  } },
  { name: 'same-factor constraint equality refuses', run: () => { const i = positive(); Object.assign(i.model, { constraints: [{ metric: census[0]!.factor, value: 4, unit: 'sessions/month', operator: '<=', provenance: 'explicit', frame: 'level' }] }); mustDemote(i); } },
  { name: 'rename and changed retry value reverify; shifted unique quote still credits', run: () => {
    const i = positive(); const first = prepare(i.model, i.brief);
    const retry = structuredClone(i.model); Object.assign(level(retry, census[0]!.option, census[0]!.factor), { value: 2 });
    const p = carryFindingsAcrossRetry(first, prepare(retry, i.brief));
    assert.equal(level(p.candidate, census[0]!.option, census[0]!.factor).provenance, 'ai_proposed');
    Object.assign(i.model.options.find(o => o.label === census[0]!.option)!, { label: 'Light Saturday opening' });
    assert.equal(level(prepare(i.model, i.brief).candidate, 'Light Saturday opening', census[0]!.factor).provenance, 'ai_proposed');
    const j = positive(); j.brief = `Changed\n${j.brief}`; assertCell(j.model, j.brief, census[0]!.option, census[0]!.factor, 'explicit');
  } },
  { name: 'point credit changes source/count but leaves analysis hash; numeric positive control changes hash', run: () => {
    const i = positive(); const credited = admitted(prepare(i.model, i.brief).candidate, i.brief);
    Object.assign(level(i.model, census[0]!.option, census[0]!.factor), { stated_evidence: null });
    const demoted = admitted(prepare(i.model, i.brief).candidate, i.brief);
    const graph = (a: typeof credited): any => ({ nodes: a.nodes, edges: a.edges });
    assert.equal(computeAnalysisAffectingGraphHash(graph(credited)), computeAnalysisAffectingGraphHash(graph(demoted)));
    assert.equal(credited.nodes.filter(n => n.kind === 'option').flatMap(n => Object.values(n.interventions ?? {})).filter(i => i.source === 'brief_extraction').length,
      demoted.nodes.filter(n => n.kind === 'option').flatMap(n => Object.values(n.interventions ?? {})).filter(i => i.source === 'brief_extraction').length + 1);
    const changed = structuredClone(credited); const f = changed.nodes.find(n => n.label === census[0]!.factor)!; const o = changed.nodes.find(n => n.label === census[0]!.option)!;
    Object.assign(o.interventions![f.id]!, { value: o.interventions![f.id]!.value + 0.01, raw_value: 5 });
    assert.notEqual(computeAnalysisAffectingGraphHash(graph(changed)), computeAnalysisAffectingGraphHash(graph(credited)));
  } },
];
seamRows.push({ name: 'count centre credit leaves the original hashed range receipt unchanged', run: () => {
  const i = censusInput(3); const c = census[3]!;
  const users = admitted(prepare(i.model, i.brief).candidate, i.brief);
  Object.assign(level(i.model, c.option, c.factor), { stated_evidence: null });
  const estimates = admitted(prepare(i.model, i.brief).candidate, i.brief);
  const cell = (a: typeof users) => { const f = a.nodes.find(n => n.label === c.factor)!; return a.nodes.find(n => n.label === c.option)!.interventions![f.id]!; };
  assert.ok(cell(users).range); assert.deepEqual(cell(users).range, cell(estimates).range);
  assert.ok(!JSON.stringify(cell(users).range).includes('stated_evidence'));
  const graph = (a: typeof users): any => ({ nodes: a.nodes, edges: a.edges });
  assert.equal(computeAnalysisAffectingGraphHash(graph(users)), computeAnalysisAffectingGraphHash(graph(estimates)));
} });
for (const value of [80, 250]) seamRows.push({ name: `P: range endpoint ${value} cannot borrow independently stated centre 150`, run: () => {
  const i = censusInput(3); const c = census[3]!; const iv = level(i.model, c.option, c.factor); const e = iv.stated_evidence!;
  const at = findStatedAmounts(i.brief).find(a => a.magnitude === value && a.index >= e.start && a.index < e.end)!.index;
  Object.assign(iv, { value, stated_evidence: { ...e, amount_start: at } });
  assertCell(i.model, i.brief, c.option, c.factor, 'ai_proposed');
} });
export const rawRows: Row[] = manifest.flatMap(m => m.calls.map(c => ({
  name: `raw no-evidence ${c.file} ${c.sha256}`,
  run: () => {
    const bytes = fixture(`r5-census/${c.file}`); const brief = fixture(`r5-census/${m.brief_sha256}.txt`);
    assert.equal(digest(bytes), c.sha256); assert.equal(digest(brief), m.brief_sha256);
    const raw: CandidateModel = JSON.parse(bytes); assert.ok(!bytes.includes('stated_evidence'));
    assert.equal(new Ajv({ strict: false }).compile(buildCandidateSchema())(raw), true);
    const candidateSchema: any = strictForTheDrafter(buildCandidateSchema(), { providerBoundary: false });
    assert.ok(!candidateSchema.properties.options.items.properties.interventions.items.required.includes('stated_evidence'));
    const sent: any = strictForTheDrafter(buildCandidateSchema()); const intervention = sent.properties.options.items.properties.interventions.items;
    assert.ok(intervention.required.includes('stated_evidence')); assert.ok(intervention.properties.stated_evidence.anyOf.some((s: any) => s.type === 'null'));
    const sentIntervention = new Ajv({ strict: false }).compile(intervention);
    const oldCell = raw.options.find(o => (o.interventions?.length ?? 0) > 0)!.interventions![0]!;
    assert.equal(sentIntervention(oldCell), false);
    assert.equal(sentIntervention({ ...oldCell, stated_evidence: null }), true);
    const p = prepare(raw, brief); const a = admitted(p.candidate, brief);
    // H4 typed partials and stated-pair receipts change admitted provenance; original hashes remain retained.
    const baseline: Record<string, string> = json('r5-h4-no-evidence-baseline.json');
    assert.equal(digest(JSON.stringify({ p, a: beforeDoorTag(a) })), baseline[c.file]);
  },
})));
export const registrationRows: Row[] = probes.filter(p => p.id.startsWith('B-')).map(p => ({
  name: `${p.id}: construction -> registration source`, run: async () => {
    const m = structuredClone(p.model); Object.assign(level(m, p.option, p.factor), { stated_evidence: p.evidence });
    let graph: any; let calls = 0;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) { graph = (body as any).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      if (path.endsWith('/graph')) return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'offline' } };
      throw new Error(`Unexpected dispatch ${path}`);
    };
    await buildModelFromBrief('00000000-0000-4000-8000-000000000000', p.brief, dispatch, async () => { calls++; return { text: JSON.stringify(m) }; });
    assert.ok(graph); assert.ok(calls >= 1);
    const f = graph.nodes.find((n: any) => n.label === p.factor), o = graph.nodes.find((n: any) => n.label === p.option);
    assert.equal(o.interventions[f.id].source, p.id === 'B-N0' ? 'brief_extraction' : 'cee_hypothesis');
    assert.ok(!JSON.stringify(graph).includes('stated_evidence'));
  },
}));
export const allRows = [...censusRows, ...probeRows, ...integrityRows, ...seamRows, ...rawRows, ...registrationRows];
