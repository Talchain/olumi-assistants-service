import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, it } from 'vitest';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { prepareProvisionalCandidate } from '../runtime/build-model.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { countsInWords } from '../stated-by-user.js';
import { findStatedAmounts } from '../../../cee/provenance/stated-amounts.js';
import { slugId, type CandidateModel, type StatedOptionEvidence } from '../admit-model.js';
import { verifiedFactorLevel, verifiedOptionSetting, verifiedOptionTotal } from '../verified-option-setting.js';

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
interface PreservationOutcomes { LOST: string[]; MISCREDITED: string[]; PRESERVED_UNVERIFIED: string[] }
function preservationOutcomes(row: Row, graph: Rec | null, result: unknown): PreservationOutcomes {
  const draft = JSON.parse(row.drafter_texts[0]!) as CandidateModel;
  const nodes = (graph?.nodes ?? []) as Rec[];
  const r = result as { provenance_demoted?: { option: string; factor: string; value: number }[];
    open_questions?: string[]; not_represented?: string[] };
  const outcomes: PreservationOutcomes = { LOST: [], MISCREDITED: [], PRESERVED_UNVERIFIED: [] };
  for (const o of draft.options) for (const i of o.interventions ?? []) {
    if (i.provenance !== 'explicit' || (!valid(i, row.brief) && !pendingAndAmount(row, o, i))) continue;
    const option = nodes.find(n => n.label === o.label);
    const factor = nodes.find(n => n.label === i.factor_label);
    const served = (option?.interventions as Record<string, Rec> | undefined)?.[String(factor?.id)];
    const id = `${String(option?.id ?? slugId(o.label))}.${String(factor?.id ?? slugId(i.factor_label))}`;
    const f = draft.factors.find(f => f.label === i.factor_label);
    const stockMember = draft.identities?.some(d => d.factors.includes(i.factor_label)
      || (d.operation === 'accumulation' && d.outcome === i.factor_label));
    const addition = i.value_kind === 'additional';
    const baseline = factor?.observed_state as Rec | undefined;
    const flow = addition && f?.baseline_known === true && f.baseline_value === 0 && !stockMember;
    const userBaseline = f?.baseline_known === true && f.provenance === 'explicit'
      && baseline?.source === 'brief_extraction' && verifiedFactorLevel(draft, f, row.brief);
    const asks = [...(r.open_questions ?? []), ...(r.not_represented ?? [])]
      .some(q => q.includes(`Tell me the current level of "${i.factor_label}"`));
    // No claimed total exists without S0: asking it and inventing no total remains the existing honest withholding.
    if (addition && !flow && !userBaseline && asks && !served) continue;
    const expected = !addition || flow ? i.value : userBaseline
      ? Number(baseline?.raw_value ?? baseline?.value) + i.value : undefined;
    const cap = baseline?.cap ?? factor?.scale_frame;
    const numeric = served !== undefined && expected !== undefined && served.raw_value === expected
      && served.value === (typeof cap === 'number' ? expected / cap : expected);
    const credited = served?.source === 'brief_extraction' || served?.source === 'user_specified';
    const verified = addition ? verifiedOptionTotal(draft, o, i, row.brief).verified
      : verifiedOptionSetting(draft, o, i, row.brief);
    if (!numeric) { outcomes.LOST.push(id); continue; }
    if (credited) {
      if (!verified) outcomes.MISCREDITED.push(id);
      continue;
    }
    // Carrier AND existing narrated readback must identify this operand; a baseline marker is never borrowed.
    const disclosed = served.user_material_unverified === true
      || ((r.provenance_demoted ?? []).some(d => d.option === o.label && d.factor === i.factor_label && d.value === i.value)
        && (r.not_represented ?? []).some(q => q === `"${i.factor_label}": Not confirmed from your brief`
          || (q.includes(`"${o.label}"`) && q.includes(`"${i.factor_label}"`)
            && q.includes('as a working figure') && q.includes("confirm it and I'll mark it as yours"))));
    if ((served.source === 'cee_hypothesis' || served.source === undefined) && disclosed) {
      outcomes.PRESERVED_UNVERIFIED.push(id);
    } else outcomes.LOST.push(id);
  }
  return outcomes;
}
function losses(row: Row, graph: Rec | null, result: unknown): string[] {
  return preservationOutcomes(row, graph, result).LOST;
}
const r2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/s7-user-stated-r2.json'), 'utf8')) as Row[];
/** Ship cut: all six ×2 are user-stated; the two split 3s stay demoted.
 * Follow-up: the shared countsInWords "N and N" reader row (three and three = two amounts).
 */
/**
 * ⛔ S7 census at TODAY's behaviour (DL 87114, 9 Oct). #2905's evidence helper credited spans the vetted
 * `verifiedOptionSetting` authority refuses (its 28 FALSE-CREDIT probes), so it was withdrawn. Crediting an enumerated
 * multi-option sentence ("all six …; all six …; or three and three") is a Science/DL design item (A3).
 * ELIGIBILITY in this census (`valid`) is a CANDIDATE set: explicit + a unique verbatim quote + the amount in the
 * option's own span. It is NOT an authorship authority. A fix must lower the count WITHOUT reopening the false-credit
 * probes (run verified-option-setting.test.ts by name before REVIEW-READY).
 */
it('compound-A today: every stated allocation is demoted to a hypothesis (the A3 design row)', async () => {
  const row = r2[0]!; const served = await replay(row);
  for (const [optionId, factorId, value] of [
    ['all_reliability', 'engineers_on_reliability_work', 6],
    ['all_prototype', 'engineers_on_prototype', 6],
    ['three_and_three_split', 'engineers_on_reliability_work', 3],
    ['three_and_three_split', 'engineers_on_prototype', 3],
  ] as const) {
    const option = (served.graph?.nodes as Rec[]).find(n => n.id === optionId);
    expect((option?.interventions as Record<string, Rec>)?.[factorId], `${optionId}.${factorId}`)
      .toMatchObject({ source: 'cee_hypothesis', raw_value: value });
  }
  expect((served.result as {provenance_demoted?: unknown[]}).provenance_demoted).toHaveLength(4);
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
  const outcomesByCase: Record<string, PreservationOutcomes> = {};
  for (const row of [...r2, ...corpus]) {
    const s = await replay(row); const outcomes = preservationOutcomes(row, s.graph, s.result);
    outcomesByCase[row.id] = outcomes;
    // The retained quality-gap baseline still names every gap; disclosed retention is reported separately, not erased.
    ids[row.id] = [...outcomes.LOST, ...outcomes.PRESERVED_UNVERIFIED]; counts[row.id] = ids[row.id]!.length;
  }
  console.log('USER-STATED OUTCOMES', JSON.stringify(Object.fromEntries(Object.entries(outcomesByCase)
    .map(([id, o]) => [id, { LOST: o.LOST.length, MISCREDITED: o.MISCREDITED.length,
      PRESERVED_UNVERIFIED: o.PRESERVED_UNVERIFIED.length }]))));
  expect.soft(Object.fromEntries(Object.entries(outcomesByCase).filter(([, o]) => o.MISCREDITED.length)
    .map(([id, o]) => [id, o.MISCREDITED]))).toStrictEqual({});
  expect(Object.fromEntries(Object.entries(outcomesByCase).filter(([, o]) => o.PRESERVED_UNVERIFIED.length)
    .map(([id, o]) => [id, o.PRESERVED_UNVERIFIED]))).toStrictEqual(PRESERVED_UNVERIFIED_BY_CASE);
  const failing = Object.entries(counts).filter(([,n]) => n > 0).map(([id]) => id);
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../scripts/ci/user-stated-survives-baseline.json'), 'utf8')) as Baseline;
  expect(baseline.failing_ids).toHaveLength(baseline.failing_count);
  expect(ratchet(failing, baseline)).toEqual([]);
  expect(countRegressions(counts, baseline.loss_counts ?? {})).toEqual([]);
  expect(Object.fromEntries(Object.entries(ids).filter(([, pairs]) => pairs.length))).toEqual(baseline.residual_ids);
}, 120_000);

// MISCREDITED → PRESERVED_UNVERIFIED under the one receipt authority, RUN 46; RUN47 adds exactly the 28 named RUN45 cells.
const PRESERVED_UNVERIFIED_BY_CASE: Record<string, string[]> = {
  "compound-A": [
    "all_reliability.engineers_on_reliability_work",
    "all_prototype.engineers_on_prototype",
    "three_and_three_split.engineers_on_reliability_work",
    "three_and_three_split.engineers_on_prototype"
  ],
  "compound-B": [
    "all_reliability.engineers_on_reliability_work",
    "all_prototype.engineers_on_prototype",
    "three_three_split.engineers_on_reliability_work",
    "three_three_split.engineers_on_prototype"
  ],
  "arm-mechanism-2842/sealedR-d2.json": [
    "launch_starter_tier.starter_monthly_price"
  ],
  "arm-mechanism/sealedR-d2.json": [
    "launch_starter_tier.starter_monthly_price"
  ],
  "arm-mechanism/sealedR-d3.json": [
    "launch_starter_tier.starter_monthly_price"
  ],
  "p44-lab-two-risks-20261008/arm2-floor-plus-line/sealed-d1.json": [
    "raise_prices_10.price_change",
    "launch_starter_tier.starter_tier_monthly_price"
  ],
  "p44-lab-two-risks-20261008/sealed-d1.json": [
    "raise_prices_10.price_increase_from_current_price",
    "launch_starter_tier.starter_tier_monthly_price"
  ],
  "B1-A": [
    "raise_pro_price_to_59.pro_plan_price"
  ],
  "B1-B": [
    "raise_pro_price_to_59.pro_plan_monthly_price"
  ],
  "B2-A": [
    "raise_prices_10.price_rise",
    "launch_starter_tier.starter_monthly_price"
  ],
  "B2-B": [
    "raise_prices_10.price_rise_from_current_pricing",
    "launch_starter_tier.starter_monthly_price"
  ],
  "arm-mechanism-2842/B1-d1.json": [
    "raise_pro_price_to_59.pro_plan_price"
  ],
  "arm-mechanism-2842/B1-d2.json": [
    "59_at_next_pro_release.pro_plan_price"
  ],
  "arm-mechanism-2842/B1-d3.json": [
    "raise_pro_price_to_59.pro_plan_price"
  ],
  "arm-mechanism-2842/sealedR-d1.json": [
    "launch_starter_tier.starter_monthly_price"
  ],
  "arm-mechanism-2842/sealedR-d3.json": [
    "launch_starter_tier.starter_monthly_price"
  ],
  "arm-mechanism/B1-d1.json": [
    "raise_pro_to_59.pro_plan_price"
  ],
  "arm-mechanism/B1-d2.json": [
    "raise_pro_price_to_59.pro_plan_price"
  ],
  "arm-mechanism/B1-d3.json": [
    "raise_pro_price_to_59.pro_plan_price"
  ],
  "arm-mechanism/sealedR-d1.json": [
    "launch_starter_tier.starter_monthly_price"
  ],
  "p44-lab-two-risks-20261008/B1-d1.json": [
    "raise_pro_price_to_59.pro_monthly_price"
  ],
  "p44-lab-two-risks-20261008/B1-d2.json": [
    "raise_pro_price_to_59.pro_plan_price"
  ],
  "p44-lab-two-risks-20261008/B1-d3.json": [
    "raise_pro_to_59.pro_plan_price"
  ],
  "p44-lab-two-risks-20261008/arm2-floor-plus-line/B1-d1.json": [
    "59_with_next_release.pro_plan_price"
  ],
  "p44-lab-two-risks-20261008/arm2-floor-plus-line/B1-d2.json": [
    "raise_pro_price_to_59.pro_plan_price"
  ],
  "p44-lab-two-risks-20261008/arm2-floor-plus-line/B1-d3.json": [
    "raise_pro_price_to_59.pro_plan_monthly_price"
  ],
  "p44-lab-two-risks-20261008/arm2-floor-plus-line/sealed-d2.json": [
    "launch_49_starter_tier.starter_tier_monthly_price"
  ],
  "p44-lab-two-risks-20261008/arm2-floor-plus-line/sealed-d3.json": [
    "raise_prices_10.price_increase",
    "launch_starter_tier.starter_monthly_price"
  ],
  "p44-lab-two-risks-20261008/sealed-d2.json": [
    "launch_starter_tier.starter_monthly_price"
  ],
  "p44-lab-two-risks-20261008/sealed-d3.json": [
    "launch_starter_tier.starter_tier_monthly_price"
  ]
};

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
async function verifiedPlantRow(label: string) {
  const probes: { id: string; model: CandidateModel; brief: string; option: string; factor: string; evidence: StatedOptionEvidence }[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/r5-verified-probes.json'), 'utf8'));
  const p = probes.find(p => p.id === 'N0')!; const model = structuredClone(p.model);
  const option = model.options.find(o => o.label === p.option)!;
  const iv = option.interventions!.find(i => i.factor_label === p.factor)!;
  iv.stated_evidence = p.evidence;
  model.factors.find(f => f.label === iv.factor_label)!.baseline_known = true;
  expect(verifiedOptionSetting(model, option, iv, p.brief)).toBe(true);
  expect(prepareProvisionalCandidate(model, p.brief).candidate.options.find(o => o.label === option.label)!
    .interventions!.find(i => i.factor_label === iv.factor_label)?.provenance).toBe('explicit');
  const row: Row = { id: label, brief: p.brief, drafter_texts: [JSON.stringify(model)] };
  const served = await replay(row); const nodes = served.graph!.nodes as Rec[];
  expect((nodes.find(n => n.label === option.label)!.interventions as Record<string, Rec>)[slugId(p.factor)]!.source)
    .toBe('brief_extraction');
  // Re-key graph slots only, including references. Actual N0 names, quantities, units, receipt and authorship stay intact.
  const aliases: Record<string, string> = { [slugId(p.factor)]: 'engineers_on_reliability_work', [slugId(p.option)]: slugId(label) };
  for (const n of nodes) {
    n.id = aliases[String(n.id)] ?? n.id;
    if (n.interventions) n.interventions = Object.fromEntries(Object.entries(n.interventions as Record<string, Rec>)
      .map(([id, cell]) => [aliases[id] ?? id, { ...cell, ...(cell.target_match ? { target_match: { ...(cell.target_match as Rec),
        node_id: aliases[String((cell.target_match as Rec).node_id)] ?? (cell.target_match as Rec).node_id } } : {}) }]));
  }
  for (const e of served.graph!.edges as Rec[]) { e.from = aliases[String(e.from)] ?? e.from; e.to = aliases[String(e.to)] ?? e.to; }
  return { row, served };
}
it('planted loss is detected in the served object, including shared goal/limit words', async () => {
  for (const label of ['Reliability allocation', 'Annual support contract total allocated engineers reliability allocation']) {
    // RUN47: a real N0 receipt survives preparation; arbitrary graph IDs retain the existing detector's exact matchers.
    const { row, served: s } = await verifiedPlantRow(label);
    expect(losses(row, s.graph, s.result)).toEqual([]);
    // Embedded plant-removal mutant: the unchanged LOST matcher MUST be RED against the untouched credited graph.
    expect(() => expect(losses(row, s.graph, s.result)).toEqual([`${slugId(label)}.engineers_on_reliability_work`])).toThrow();
    console.log('RUN47 plant-removal mutant RED; unplanted contrast preserved', label);
    const graph = structuredClone(s.graph)!;
    const option = (graph.nodes as Rec[]).find(n => n.id === slugId(label))!;
    const iv = option.interventions as Record<string, Rec>;
    iv.engineers_on_reliability_work = { ...iv.engineers_on_reliability_work, source: 'cee_hypothesis' };
    expect(losses(row, graph, s.result)).toEqual([`${slugId(label)}.engineers_on_reliability_work`]);
    delete iv.engineers_on_reliability_work;
    expect(losses(row, graph, s.result)).toEqual([`${slugId(label)}.engineers_on_reliability_work`]);
  }
});
it('contrast: addition without total evidence, absent/ambiguous quote, amount outside own option span are demoted by exact id', async () => {
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
    expect(prepareProvisionalCandidate(draft, row.brief).provenance_demoted).toEqual([
      { option: draft.options[0]!.label, factor: iv.factor_label, value: iv.value },
    ]);
    row.drafter_texts = [JSON.stringify(draft)]; const s = await replay(row);
    const option = (s.graph?.nodes as Rec[]).find(n => n.id === slugId(draft.options[0]!.label));
    expect((option?.interventions as Record<string, Rec>).engineers_on_reliability_work).toMatchObject({ source: 'cee_hypothesis', raw_value: iv.value });
  }
});
it('census eligibility reads digits and number words through the shared readers, and ignores offsets', () => {
  for (const word of ['6', 'six']) {
    const row = plantedRow('Allocation'); const draft = JSON.parse(row.drafter_texts[0]!) as CandidateModel;
    const i = draft.options[0]!.interventions![0]!; const brief = row.brief.replace('6', word);
    i.stated_evidence = { ...i.stated_evidence!, quote: brief, end: brief.length, option_quote: brief, option_end: brief.length };
    expect(valid(i, brief)).toBe(true);
    i.stated_evidence = { ...i.stated_evidence, amount_start: i.stated_evidence.amount_start - 1 };
    expect(valid(i, brief)).toBe(true);
  }
});

function additionRow(baseline: number | null, known: boolean, stock: boolean): Row {
  const draft = JSON.parse(r2[0]!.drafter_texts[0]!) as CandidateModel;
  const label = stock ? 'Team headcount' : 'Senior hires';
  const baselineQuote = stock && known && baseline === 8 ? 'Our team has 8 people.' : null;
  const brief = stock ? 'Team headcount is 8. Add +2 to team headcount.' : 'Hire two seniors.';
  const own = stock ? 'Add +2 to team headcount.' : brief;
  return { id: stock ? 'stock-addition' : 'flow-addition', brief: baselineQuote ? `${baselineQuote}\n\n${brief}` : brief, drafter_texts: [JSON.stringify({
    ...draft, options: [{ ...draft.options[0], label: 'Add capacity', changes: [], interventions: [{
      factor_label: label, value: 2, value_kind: 'additional', unit: 'people', provenance: 'explicit',
      stated_evidence: { quote: brief, option_quote: own },
    }] }, { ...draft.options[1], label: 'Keep capacity', is_status_quo: true, changes: [], interventions: [] }], factors: [{ label, role: 'controllable', baseline_known: known, baseline_value: baseline,
      unit: 'people', provenance: known ? 'explicit' : 'ai_proposed', plausible_max: 20,
      ...(baselineQuote ? { baseline_evidence: { quote: baselineQuote } } : {}) }],
    links: [{ ...draft.links[0], from: 'Add capacity', to: label }, { ...draft.links[0], from: label, to: draft.goal.metric }],
    identities: [],
  })] };
}
it('Science af: flow count stores 2 with no baseline ask; stock stores user 8 + 2 = 10', async () => {
  for (const stock of [false, true]) {
    const row = additionRow(stock ? 8 : 0, true, stock); const s = await replay(row);
    const option = (s.graph?.nodes as Rec[]).find(n => n.id === 'add_capacity');
    const factorId = stock ? 'team_headcount' : 'senior_hires';
    // Operand receipts are unproved; arithmetic and no-baseline ask stay exact — #94 6102610518(4).
    expect((option?.interventions as Record<string, Rec>)[factorId]).toMatchObject({ raw_value: stock ? 10 : 2, source: 'cee_hypothesis' });
    expect(losses(row, s.graph, s.result)).toEqual([]);
    expect(preservationOutcomes(row, s.graph, s.result)).toStrictEqual({ LOST: [], MISCREDITED: [],
      PRESERVED_UNVERIFIED: [stock ? 'add_capacity.team_headcount' : 'add_capacity.senior_hires'] });
    if (stock) expect((option?.interventions as Record<string, Rec>)[factorId])
      .toMatchObject({ raw_value: 10, value: 0.5, value_confidence: 'medium' });
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
it('Science af: stock with NO baseline at all asks its baseline and invents no level', async () => {
  const row = additionRow(null, false, true);
  row.brief = 'Add +2 to team headcount.';
  const draft = JSON.parse(row.drafter_texts[0]!);
  draft.options[0].interventions[0].stated_evidence.quote = row.brief;
  row.drafter_texts = [JSON.stringify(draft)];
  const s = await replay(row);
  const option = (s.graph?.nodes as Rec[]).find(n => n.id === 'add_capacity');
  expect((option?.interventions as Record<string, Rec> | undefined)?.team_headcount).toBeUndefined();
  expect(((s.result as { not_represented?: string[] }).not_represented ?? []).join(' ')).toContain('Tell me the current level of "Team headcount"');
  expect(losses(row, s.graph, s.result)).toEqual([]);
});

// PARKED S7 row (DL 87114 + Science §(af) edge @84142351): with only Olumi's ESTIMATE of S₀, store COMPONENTS (Olumi's
// base + the user's exact +2) and ask for S₀. No option carrier holds a typed delta today (InterventionV3 holds levels),
// so that needs a contract field. Until then the old behaviour stands: one collapsed hypothesis level (4 + 2 = 6). The
// census counts it as a loss (heldout3-d2 is in the baseline) so the components slice must clear it.
it('Science af edge (parked): an estimate-only S0 keeps the old collapsed hypothesis level 4 + 2 = 6', async () => {
  const row = additionRow(4, false, true);
  row.brief = 'Add +2 to team headcount.';
  const draft = JSON.parse(row.drafter_texts[0]!);
  draft.options[0].interventions[0].stated_evidence.quote = row.brief;
  row.drafter_texts = [JSON.stringify(draft)];
  const s = await replay(row);
  const option = (s.graph?.nodes as Rec[]).find(n => n.id === 'add_capacity');
  expect((option?.interventions as Record<string, Rec> | undefined)?.team_headcount).toMatchObject({ raw_value: 6, source: 'cee_hypothesis' });
  expect(losses(row, s.graph, s.result)).not.toEqual([]);
});

// RUN44: a retained, unverified user operand must reach the existing disclosure carrier.
it('RUN44 B unverified additional totals disclose their original operands', () => {
  for (const stock of [false, true]) {
    const row = additionRow(stock ? 8 : 0, true, stock);
    const draft: CandidateModel = JSON.parse(row.drafter_texts[0]!);
    expect(prepareProvisionalCandidate(draft, row.brief).provenance_demoted).toStrictEqual([
      { option: 'Add capacity', factor: stock ? 'Team headcount' : 'Senior hires', value: 2 },
    ]);
  }
});
it('RUN44 B verified operand total is not demoted', () => {
  const current = 'We have 5 developers today.'; const addition = 'We could hire 2 more developers.';
  const brief = `${current} ${addition}`;
  const template: CandidateModel = JSON.parse(r2[0]!.drafter_texts[0]!);
  const draft: CandidateModel = { ...template, constraints: [], identities: [], outcomes: [], risks: [], links: [],
    factors: [{ label: 'Developers', role: 'controllable', unit: 'people', baseline_known: true,
      baseline_value: 5, provenance: 'explicit', baseline_evidence: { quote: current } }],
    options: [{ label: 'Hire two developers', provenance: 'explicit', interventions: [{ factor_label: 'Developers',
      value: 2, value_kind: 'additional', unit: 'people', provenance: 'explicit', stated_evidence: {
        quote: addition, start: current.length + 1, end: brief.length, amount_start: brief.indexOf('2'),
        option_quote: addition, option_start: current.length + 1, option_end: brief.length,
      } }] }],
  };
  expect(verifiedOptionTotal(draft, draft.options[0]!, draft.options[0]!.interventions![0]!, brief))
    .toMatchObject({ verified: true, derived: true });
  const prepared = prepareProvisionalCandidate(draft, brief);
  expect(prepared.provenance_demoted).toStrictEqual([]);
  expect(prepared.candidate.options[0]!.interventions![0]).toMatchObject({ value: 7, provenance: 'explicit', derived_total: true });
});

it('RUN44 A clinic old-path acceptance stays monotone and coordinated B3-d2 still credits', () => {
  const probes: { id: string; model: CandidateModel; brief: string; option: string; factor: string; evidence: StatedOptionEvidence }[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/r5-verified-probes.json'), 'utf8'));
  for (const id of ['N0', 'N3', 'N5', 'N10c', 'B-N0']) {
    const p = probes.find(p => p.id === id)!; const model = structuredClone(p.model);
    const option = model.options.find(o => o.label === p.option)!;
    const iv = option.interventions!.find(i => i.factor_label === p.factor)!;
    iv.stated_evidence = p.evidence;
    expect(verifiedOptionSetting(model, option, iv, p.brief), id).toBe(true);
  }
  const bank: { brief: string; output_text: string } = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../goal-target/__tests__/fixtures/event-b3-d2-20261008.json'), 'utf8'));
  const draft: CandidateModel = JSON.parse(bank.output_text);
  for (const o of draft.options) for (const i of o.interventions ?? []) {
    if (['Senior engineers hired', 'Junior engineers hired'].includes(i.factor_label) && i.stated_evidence != null)
      expect(verifiedOptionSetting(draft, o, i, bank.brief), `${o.label}.${i.factor_label}`).toBe(true);
  }
});
it('RUN44 outcomes detect unreceipted credit and disclosure removal without borrowing baseline markers', async () => {
  const row = additionRow(8, true, true); const s = await replay(row);
  const credited = structuredClone(s.graph)!;
  const option = (credited.nodes as Rec[]).find(n => n.id === 'add_capacity')!;
  (option.interventions as Record<string, Rec>).team_headcount!.source = 'brief_extraction';
  expect(preservationOutcomes(row, credited, s.result)).toStrictEqual({ LOST: [],
    MISCREDITED: ['add_capacity.team_headcount'], PRESERVED_UNVERIFIED: [] });
  expect(preservationOutcomes(row, s.graph, { ...s.result, provenance_demoted: [], not_represented: [] }))
    .toStrictEqual({ LOST: ['add_capacity.team_headcount'], MISCREDITED: [], PRESERVED_UNVERIFIED: [] });
});

it('RUN44 B Science af retained quantities have their own disclosure and exact preserved ids', async () => {
  for (const stock of [false, true]) {
    const row = additionRow(stock ? 8 : 0, true, stock); const s = await replay(row);
    expect(preservationOutcomes(row, s.graph, s.result)).toStrictEqual({ LOST: [], MISCREDITED: [],
      PRESERVED_UNVERIFIED: [stock ? 'add_capacity.team_headcount' : 'add_capacity.senior_hires'] });
  }
});

// DL RUN46: known baselines cannot bypass the public option receipt authority.
it('RUN46 known-baseline absolute refusal is demoted by identity; verified control stays explicit', () => {
  const refused = r2.find(r => r.id === 'B1-A')!;
  const draft: CandidateModel = JSON.parse(refused.drafter_texts[0]!);
  const option = draft.options.find(o => o.label === 'Raise Pro price to £59')!;
  const iv = option.interventions!.find(i => i.factor_label === 'Pro plan price')!;
  expect(draft.factors.find(f => f.label === iv.factor_label)?.baseline_known).toBe(true);
  expect(verifiedOptionSetting(draft, option, iv, refused.brief)).toBe(false);
  const prepared = prepareProvisionalCandidate(draft, refused.brief);
  expect(prepared.candidate.options.find(o => o.label === option.label)!.interventions!
    .find(i => i.factor_label === iv.factor_label && i.value === iv.value)?.provenance).toBe('ai_proposed');
  expect(prepared.provenance_demoted).toContainEqual({ option: option.label, factor: iv.factor_label, value: iv.value });

  const probes: { id: string; model: CandidateModel; brief: string; option: string; factor: string; evidence: StatedOptionEvidence }[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/r5-verified-probes.json'), 'utf8'));
  const control = probes.find(p => p.id === 'N0')!; const model = structuredClone(control.model);
  const o = model.options.find(o => o.label === control.option)!;
  const i = o.interventions!.find(i => i.factor_label === control.factor)!;
  i.stated_evidence = control.evidence;
  model.factors.find(f => f.label === i.factor_label)!.baseline_known = true;
  expect(i).toMatchObject({ value_kind: 'absolute', provenance: 'explicit' });
  expect(verifiedOptionSetting(model, o, i, control.brief)).toBe(true);
  const verified = prepareProvisionalCandidate(model, control.brief);
  expect(verified.candidate.options.find(p => p.label === o.label)!.interventions!
    .find(p => p.factor_label === i.factor_label && p.value === i.value)?.provenance).toBe('explicit');
  expect(verified.provenance_demoted).not.toContainEqual({ option: o.label, factor: i.factor_label, value: i.value });
});

// RUN48: graph bytes cannot substitute for checked human-entry authority.
it('RUN48 recovered user source needs authority for exactly the edited option/factor', () => {
  const graph = { nodes: [
    { id: 'factor', kind: 'factor', label: 'Capacity' },
    { id: 'option', kind: 'option', label: 'Increase capacity', data: {
      interventions: { factor: { value: 0.4, source: 'user_specified' } } } },
  ], edges: [] };
  const read = (authority: readonly { optionId: string; factorId: string }[]) => {
    const encoded = encodeOptionInterventionsForEdit(graph, new Set(['option']), undefined, authority).graph;
    const cell = (encoded.nodes.find(n => n.id === 'option') as Rec).interventions as Record<string, Rec>;
    expect(cell.factor!.value).toBe(0.4);
    return cell.factor!;
  };
  expect(read([]).source).toBeUndefined();
  expect(read([{ optionId: 'option', factorId: 'factor' }]).source).toBe('user_specified');
  expect(read([{ optionId: 'other', factorId: 'factor' }]).source).toBeUndefined();
  expect(read([{ optionId: 'option', factorId: 'other' }]).source).toBeUndefined();
  // Caller-to-encoder wiring: the checked identity is passed out of band, never recovered from a source stamp.
  const handler = fs.readFileSync(path.join(__dirname, '../../../orchestrator/tools/edit-graph.ts'), 'utf8');
  const caller = fs.readFileSync(path.join(__dirname, '../../handlers/edit-graph-dispatch.ts'), 'utf8');
  expect(handler).toContain('encodeOptionInterventionsForEdit(appliedGraph, touchedOptionIds, mustConfigureOptionIds, opts?.humanAuthority)');
  expect(caller).toContain('humanAuthority: optionEffectWrite === null ? []');
  expect(caller).toContain('[{ optionId: optionEffectWrite.optionId, factorId: optionEffectWrite.factorId }]');
});
it('RUN48 identical known-baseline factor disclosures are served once for one or two demoted options', async () => {
  const probes: { id: string; model: CandidateModel; brief: string; option: string; factor: string }[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/r5-verified-probes.json'), 'utf8'));
  const p = probes.find(p => p.id === 'N0')!;
  for (const values of [[4], [4, 6]]) {
    const model = structuredClone(p.model); const template = model.options.find(o => o.label === p.option)!;
    const iv = template.interventions!.find(i => i.factor_label === p.factor)!;
    model.factors.find(f => f.label === p.factor)!.baseline_known = true;
    const options = values.map(value => ({ ...template, label: `${template.label} ${value}`,
      interventions: [{ ...iv, value, stated_evidence: null }] }));
    const candidate: CandidateModel = { ...model, options };
    const row: Row = { id: 'RUN48 disclosure', brief: p.brief, drafter_texts: [JSON.stringify(candidate)] };
    const served = await replay(row);
    expect(served.result.provenance_demoted).toHaveLength(values.length);
    const lines = served.result.not_represented;
    if (!Array.isArray(lines)) throw new Error('Missing served disclosures');
    expect(lines.filter((line: unknown) => line === `"${p.factor}": Not confirmed from your brief`))
      .toStrictEqual([`"${p.factor}": Not confirmed from your brief`]);
  }
});
