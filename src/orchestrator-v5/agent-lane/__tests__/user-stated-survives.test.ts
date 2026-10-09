import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, it } from 'vitest';
import { userStatedOptionLevel } from '../user-stated-option-level.js';
import { prepareProvisionalCandidate } from '../runtime/build-model.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { countsInWords } from '../stated-by-user.js';
import { findStatedAmounts } from '../../../cee/provenance/stated-amounts.js';
import { slugId, type CandidateModel } from '../admit-model.js';

type Rec = Record<string, unknown>;
type Iv = NonNullable<CandidateModel['options'][number]['interventions']>[number];
interface Row { id: string; brief: string; drafter_texts: string[] }
function valid(i: Iv, brief: string): boolean {
  const e = i.stated_evidence;
  if (!e || !e.quote || !e.option_quote) return false;
  const at = brief.indexOf(e.quote); const own = e.quote.indexOf(e.option_quote);
  if (at < 0 || brief.indexOf(e.quote, at + 1) >= 0 || own < 0 || e.quote.indexOf(e.option_quote, own + 1) >= 0) return false;
  return [...findStatedAmounts(e.option_quote), ...countsInWords(e.option_quote)].some(a => a.magnitude === i.value);
}
async function replay(row: Row) {
  let registered: Rec | null = null; let index = 0;
  const dispatch = async (p: string, body: unknown) => {
    if (p.endsWith('/graph/register')) { registered = body as Rec; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (p.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (p.endsWith('/graph')) return { status: 200, json: { graph: (registered?.graph as Rec | undefined) ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
    return { status: 404, json: {} };
  };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-000000000077', row.brief, dispatch as never,
    (async () => ({ text: row.drafter_texts[Math.min(index++, row.drafter_texts.length - 1)]!, status: 'completed' })) as never);
  return { graph: ((registered as Rec | null)?.graph as Rec | undefined) ?? null, result };
}
// Explicit bench witnesses for the next reader slice, not a new prose parser.
// Admission still uses the unchanged shared readers. Both captured splits are user-stated 3 + 3.
function pendingAndAmount(row: Row, option: CandidateModel['options'][number], i: Iv): boolean {
  const expected = row.id === 'compound-A' ? ['Three and three split', 'or split them three and three.']
    : row.id === 'compound-B' ? ['Three-three split', 'split them three and three'] : undefined;
  const e = i.stated_evidence;
  return expected !== undefined && option.label === expected[0] && i.value === 3
    && ['Engineers on reliability work', 'Engineers on prototype'].includes(i.factor_label)
    && e?.option_quote === expected[1] && row.brief.indexOf(e.quote) >= 0
    && row.brief.indexOf(e.quote) === row.brief.lastIndexOf(e.quote)
    && e.quote.indexOf(e.option_quote) >= 0 && e.quote.indexOf(e.option_quote) === e.quote.lastIndexOf(e.option_quote);
}
function losses(row: Row, graph: Rec | null, result: unknown): string[] {
  const draft = JSON.parse(row.drafter_texts[0]!) as CandidateModel;
  const nodes = (graph?.nodes ?? []) as Rec[];
  const demoted = (result as { provenance_demoted?: {option: string; factor: string}[] }).provenance_demoted ?? [];
  return draft.options.flatMap(o => (o.interventions ?? []).flatMap(i => {
    if (i.provenance !== 'explicit' || (!valid(i, row.brief) && !pendingAndAmount(row, o, i))) return [];
    const option = nodes.find(n => n.label === o.label);
    const factor = nodes.find(n => n.label === i.factor_label);
    const served = (option?.interventions as Record<string, Rec> | undefined)?.[String(factor?.id)];
    const id = `${String(option?.id ?? slugId(o.label))}.${String(factor?.id ?? slugId(i.factor_label))}`;
    const f = draft.factors.find(f => f.label === i.factor_label);
    const stockMember = draft.identities?.some(d => d.factors.includes(i.factor_label)
      || (d.operation === 'accumulation' && d.outcome === i.factor_label));
    const addition = (i as Iv & { value_kind?: string }).value_kind === 'additional';
    if (addition) {
      // Typed known zero licenses amount-as-level; identity/accumulation membership wins.
      const flow = f?.baseline_known === true && f.baseline_value === 0 && !stockMember;
      const baseline = factor?.observed_state as Rec | undefined;
      const userBaseline = f?.baseline_known === true && f.provenance === 'explicit'
        && baseline?.source === 'brief_extraction';
      const r = result as { open_questions?: string[]; not_represented?: string[] };
      const asks = [...(r.open_questions ?? []), ...(r.not_represented ?? [])]
        .some(q => q.includes(`Tell me the current level of "${i.factor_label}"`));
      const preserved = flow ? served?.raw_value === i.value && served.source === 'brief_extraction'
        : userBaseline ? served?.raw_value === Number(baseline?.raw_value ?? baseline?.value) + i.value
          && served.source === 'brief_extraction'
        : asks && !served;
      return preserved ? [] : [id];
    }
    return !served || served.source !== 'brief_extraction' || served.raw_value !== i.value
      || demoted.some(d => d.option === o.label && d.factor === i.factor_label) ? [id] : [];
  }));
}
const r2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/s7-user-stated-r2.json'), 'utf8')) as Row[];
/** Ship cut: all six ×2 are user-stated; the two split 3s stay demoted.
 * Follow-up: the shared countsInWords "N and N" reader row (three and three = two amounts).
 */
it('compound-A first differing intervention and identity-bound row', async () => {
  const row = r2[0]!; const served = await replay(row);
  const raw = (JSON.parse(row.drafter_texts[0]!) as CandidateModel).options[0]!.interventions![0]!;
  const node = (served.graph?.nodes as Rec[]).find(n => n.id === 'all_reliability');
  const intervention = (node?.interventions as Rec)?.engineers_on_reliability_work;
  fs.writeFileSync('/private/tmp/s7-first-diff.json', JSON.stringify({ raw, admitted: intervention, result: served.result }, null, 2));
  expect(intervention).toMatchObject({ source: 'brief_extraction', raw_value: 6 });
  for (const [optionId, factorId, value] of [
    ['all_reliability', 'engineers_on_reliability_work', 6],
    ['all_prototype', 'engineers_on_prototype', 6],
      ] as const) {
    const option = (served.graph?.nodes as Rec[]).find(n => n.id === optionId);
    expect((option?.interventions as Record<string, Rec>)?.[factorId], `${optionId}.${factorId}`)
      .toMatchObject({ source: 'brief_extraction', raw_value: value });
  }
  for (const factor of ['engineers_on_reliability_work', 'engineers_on_prototype']) {
    const split = (served.graph?.nodes as Rec[]).find(n => n.id === 'three_and_three_split');
    expect((split?.interventions as Record<string, Rec>)[factor]).toMatchObject({ source: 'cee_hypothesis', raw_value: 3 });
  }
  expect((served.result as {provenance_demoted?: unknown[]}).provenance_demoted).toEqual([
    { option: 'Three and three split', factor: 'Engineers on reliability work', value: 3 },
    { option: 'Three and three split', factor: 'Engineers on prototype', value: 3 },
  ]);
  expect(losses(row, served.graph, served.result)).toEqual([
    'three_and_three_split.engineers_on_reliability_work', 'three_and_three_split.engineers_on_prototype',
  ]);
});
/** Science §(af): a flow-count addition is PRESERVED when its amount is the stored level.
 * A stock addition is PRESERVED when stored S₀ + amount uses the user's S₀, or a baseline
 * question names that factor and no level is invented. Otherwise LOST.
 * Classification uses typed baseline knowledge/value/provenance and identity membership, never label words.
 */
it('served property census', async () => {
  const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/s7-construction-census/corpus.json.gz'))).toString()) as Row[];
  expect(corpus).toHaveLength(116); expect(r2).toHaveLength(8);
  const counts: Record<string, number> = {};
  const ids: Record<string, string[]> = {};
  for (const row of [...r2, ...corpus]) { const s = await replay(row); ids[row.id] = losses(row, s.graph, s.result); counts[row.id] = ids[row.id]!.length; if (ids[row.id]!.length) fs.writeFileSync(`/private/tmp/s7-r3-residual-${slugId(row.id)}.json`, JSON.stringify({ row, ...s }, null, 2)); }
  fs.writeFileSync('/private/tmp/s7-user-stated-counts.json', JSON.stringify(counts, null, 2));
  fs.writeFileSync('/private/tmp/s7-user-stated-ids.json', JSON.stringify(ids, null, 2));
  console.log('USER-STATED LOSS', JSON.stringify(counts));
  const failing = Object.entries(counts).filter(([,n]) => n > 0).map(([id]) => id);
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../scripts/ci/user-stated-survives-baseline.json'), 'utf8')) as Baseline;
  expect(baseline.failing_ids).toHaveLength(baseline.failing_count);
  expect(ratchet(failing, baseline)).toEqual([]);
  expect(countRegressions(counts, baseline.loss_counts ?? {})).toEqual([]);
  expect(Object.fromEntries(Object.entries(ids).filter(([, pairs]) => pairs.length))).toEqual(baseline.residual_ids);
}, 120_000);

interface Baseline { failing_count: number; failing_ids: string[]; loss_counts?: Record<string, number>; residual_ids?: Record<string, string[]> }
function countRegressions(counts: Record<string, number>, baseline: Record<string, number>): string[] {
  return Object.entries(counts).filter(([id, n]) => n > (baseline[id] ?? 0)).map(([id, n]) => `${id}: losses ${n} > baseline ${baseline[id] ?? 0}`);
}
function ratchet(ids: string[], baseline: Baseline): string[] {
  const failures = ids.filter(id => !baseline.failing_ids.includes(id)).map(id => `newly failing: ${id}`);
  if (ids.length > baseline.failing_count) failures.push(`failing ${ids.length} > baseline ${baseline.failing_count}`);
  const stale = baseline.failing_ids.filter(id => !ids.includes(id));
  if (stale.length) failures.push(`stale baseline: remove ids ${stale.join(', ')}`);
  return failures;
}
it('ratchet: zero, planted, stale, removed and re-fail controls', () => {
  const empty: Baseline = { failing_count: 0, failing_ids: [] };
  expect(ratchet([], empty)).toEqual([]);
  expect(ratchet(['planted'], empty)).toEqual(['newly failing: planted', 'failing 1 > baseline 0']);
  expect(ratchet([], { failing_count: 1, failing_ids: ['planted'] })).toEqual(['stale baseline: remove ids planted']);
  expect(ratchet([], empty)).toEqual([]);
  expect(ratchet(['planted'], empty)).toEqual(['newly failing: planted', 'failing 1 > baseline 0']);
  expect(countRegressions({ existing: 2 }, { existing: 1 })).toEqual(['existing: losses 2 > baseline 1']);
});
function plantedRow(label: string): Row {
  const draft = JSON.parse(r2[0]!.drafter_texts[0]!) as CandidateModel;
  const brief = 'Set reliability allocation to 6 engineers.';
  const option = draft.options[0]!;
  const i = option.interventions![0]!;
  const evidence = { quote: brief, start: 0, end: brief.length, option_quote: brief,
    option_start: 0, option_end: brief.length, amount_start: brief.indexOf('6') };
  return { id: label, brief, drafter_texts: [JSON.stringify({ ...draft, options: [{ ...option, label,
    interventions: [{ ...i, stated_evidence: evidence }] }] })] };
}
it('planted loss is detected in the served object, including shared goal/limit words', async () => {
  for (const label of ['Reliability allocation', 'Annual support contract total allocated engineers reliability allocation']) {
    const row = plantedRow(label); const s = await replay(row);
    expect(losses(row, s.graph, s.result)).toEqual([]);
    const graph = structuredClone(s.graph)!;
    const option = (graph.nodes as Rec[]).find(n => n.id === slugId(label))!;
    const iv = option.interventions as Record<string, Rec>;
    iv.engineers_on_reliability_work = { ...iv.engineers_on_reliability_work, source: 'cee_hypothesis' };
    expect(losses(row, graph, s.result)).toEqual([`${slugId(label)}.engineers_on_reliability_work`]);
    delete iv.engineers_on_reliability_work;
    expect(losses(row, graph, s.result)).toEqual([`${slugId(label)}.engineers_on_reliability_work`]);
  }
});
it('contrast: addition without total evidence, absent quote, amount outside own option span stay demoted by exact id', async () => {
  for (const kind of ['addition', 'absent-quote', 'outside-option', 'ambiguous-quote', 'option-outside-quote', 'ambiguous-option']) {
    const row = plantedRow(`Contrast ${kind}`);
    const draft = JSON.parse(row.drafter_texts[0]!) as CandidateModel;
    const iv = draft.options[0]!.interventions![0]!;
    if (kind === 'addition') { row.brief = 'Add +2 engineers to reliability.'; iv.value = 2; iv.stated_evidence = null; }
    if (kind === 'absent-quote') iv.stated_evidence = { ...iv.stated_evidence!, quote: 'Set prototype allocation to 6 engineers.' };
    if (kind === 'outside-option') iv.stated_evidence = { ...iv.stated_evidence!, option_quote: 'Set reliability allocation', option_end: 26 };
    if (kind === 'ambiguous-quote') row.brief += ' ' + row.brief;
    if (kind === 'option-outside-quote') iv.stated_evidence = { ...iv.stated_evidence!, quote: 'Set reliability allocation' };
    if (kind === 'ambiguous-option') {
      row.brief += ' ' + row.brief;
      iv.stated_evidence = { ...iv.stated_evidence!, quote: row.brief };
    }
    expect(userStatedOptionLevel(iv, row.brief)).toBe(false);
    expect(prepareProvisionalCandidate(draft, row.brief).provenance_demoted).toEqual([
      { option: draft.options[0]!.label, factor: iv.factor_label, value: iv.value },
    ]);
    row.drafter_texts = [JSON.stringify(draft)]; const s = await replay(row);
    const option = (s.graph?.nodes as Rec[]).find(n => n.id === slugId(draft.options[0]!.label));
    expect((option?.interventions as Record<string, Rec>).engineers_on_reliability_work).toMatchObject({ source: 'cee_hypothesis', raw_value: iv.value });
  }
});
it('shared number readers verify both digits and number words, and offsets are ignored', () => {
  for (const word of ['6', 'six']) {
    const row = plantedRow('Allocation'); const draft = JSON.parse(row.drafter_texts[0]!) as CandidateModel;
    const i = draft.options[0]!.interventions![0]!; const brief = row.brief.replace('6', word);
    i.stated_evidence = { ...i.stated_evidence!, quote: brief, end: brief.length, option_quote: brief, option_end: brief.length };
    expect(valid(i, brief)).toBe(true); expect(userStatedOptionLevel(i, brief)).toBe(true);
    i.stated_evidence = { ...i.stated_evidence, amount_start: i.stated_evidence.amount_start - 1 };
    expect(userStatedOptionLevel(i, brief)).toBe(true);
  }
});

function additionRow(baseline: number | null, known: boolean, stock: boolean): Row {
  const draft = JSON.parse(r2[0]!.drafter_texts[0]!) as CandidateModel;
  const label = stock ? 'Team headcount' : 'Senior hires';
  const brief = stock ? 'Team headcount is 8. Add +2 to team headcount.' : 'Hire two seniors.';
  const own = stock ? 'Add +2 to team headcount.' : brief;
  return { id: stock ? 'stock-addition' : 'flow-addition', brief, drafter_texts: [JSON.stringify({
    ...draft, options: [{ ...draft.options[0], label: 'Add capacity', changes: [], interventions: [{
      factor_label: label, value: 2, value_kind: 'additional', unit: 'people', provenance: 'explicit',
      stated_evidence: { quote: brief, option_quote: own },
    }] }, { ...draft.options[1], label: 'Keep capacity', is_status_quo: true, changes: [], interventions: [] }], factors: [{ label, role: 'controllable', baseline_known: known, baseline_value: baseline,
      unit: 'people', provenance: known ? 'explicit' : 'ai_proposed', plausible_max: 20 }],
    links: [{ ...draft.links[0], from: 'Add capacity', to: label }, { ...draft.links[0], from: label, to: draft.goal.metric }],
    identities: [],
  })] };
}
it('Science af: flow count stores 2 with no baseline ask; stock stores user 8 + 2 = 10', async () => {
  for (const stock of [false, true]) {
    const row = additionRow(stock ? 8 : 0, true, stock); const s = await replay(row);
    fs.writeFileSync(`/private/tmp/s7-r3-${stock ? 'stock' : 'flow'}-served.json`, JSON.stringify({ row, ...s }, null, 2));
    const option = (s.graph?.nodes as Rec[]).find(n => n.id === 'add_capacity');
    const factorId = stock ? 'team_headcount' : 'senior_hires';
    expect((option?.interventions as Record<string, Rec>)[factorId]).toMatchObject({ raw_value: stock ? 10 : 2, source: 'brief_extraction' });
    expect(losses(row, s.graph, s.result)).toEqual([]);
    if (!stock) expect([...(s.result as { open_questions?: string[] }).open_questions ?? [],
      ...(s.result as { not_represented?: string[] }).not_represented ?? []]
      .some(q => q.includes('current level of "Senior hires"'))).toBe(false);
    if (stock) {
      const mutant = structuredClone(s.graph)!;
      const iv = ((mutant.nodes as Rec[]).find(n => n.id === 'add_capacity')!.interventions as Record<string, Rec>).team_headcount!;
      iv.raw_value = 2; iv.value = 0.1;
      expect(losses(row, mutant, s.result)).toEqual(['add_capacity.team_headcount']);
    }
  }
});
it('Science af: stock without user S0 asks its baseline and invents no level', async () => {
  for (const estimate of [null, 4]) {
    const row = additionRow(estimate, false, true);
    row.brief = 'Add +2 to team headcount.';
    const draft = JSON.parse(row.drafter_texts[0]!);
    draft.options[0].interventions[0].stated_evidence.quote = row.brief;
    row.drafter_texts = [JSON.stringify(draft)];
    const s = await replay(row);
    fs.writeFileSync(`/private/tmp/s7-r3-unknown-${estimate}-served.json`, JSON.stringify({ row, ...s }, null, 2));
    const option = (s.graph?.nodes as Rec[]).find(n => n.id === 'add_capacity');
    expect((option?.interventions as Record<string, Rec> | undefined)?.team_headcount).toBeUndefined();
    expect(((s.result as { not_represented?: string[] }).not_represented ?? []).join(' ')).toContain('Tell me the current level of "Team headcount"');
    expect(losses(row, s.graph, s.result)).toEqual([]);
  }
});
