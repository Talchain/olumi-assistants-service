// Shared assertions let the authorized node/tsx check execute the exact Vitest rows
// without loading Vitest. Only CONTROL rows perturb the verbatim cohort candidates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CandidateModel, AdmittedModel, AdmittedNode, ConstructedLevel } from '../../admit-model.js';
import { admitCandidateModel } from '../../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate, withCountInterventionRanges } from '../../runtime/build-model.js';
import type { InternalDispatch } from '../../runtime/agent-capabilities.js';
import { Ajv } from 'ajv';

interface Answer { cohort_file: string; output_sha256: string; brief_sha256: string; brief: string; output_text: string }
const fixture: { answers: Answer[] } = JSON.parse(readFileSync(new URL('./class1-known-zero-raw.json', import.meta.url), 'utf8'));
const answers = fixture.answers;
type Option = CandidateModel['options'][number];
type Iv = NonNullable<Option['interventions']>[number] & { value_kind?: 'absolute' | 'additional' };
type RawModel = Omit<CandidateModel, 'options'> & { options: (Omit<Option, 'interventions'> & { interventions?: Iv[] })[] };
const candidate = (answer: Answer): RawModel => JSON.parse(answer.output_text);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const validate = new Ajv({ strict: false }).compile(buildCandidateSchema());
type PreparedIv = Iv & { derived_total?: boolean };
const level = (c: CandidateModel, option: string, factor: string): PreparedIv => {
  const found = c.options.find((o) => o.label === option)?.interventions?.find((i) => i.factor_label === factor);
  assert.ok(found, `${option} -> ${factor} must survive preparation`);
  return found;
};

function statedZero(answer: Answer): void {
  assert.equal(sha(answer.output_text), answer.output_sha256, 'raw provider bytes');
  assert.equal(sha(answer.brief), answer.brief_sha256, 'original brief bytes');
  const raw = candidate(answer);
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  const before = structuredClone(raw);
  const prepared = prepareProvisionalCandidate(raw);
  let checked = 0;
  for (const o of raw.options) for (const i of o.interventions ?? []) {
    const f = raw.factors.find((f) => f.label === i.factor_label);
    if (i.value_kind !== 'additional' || i.provenance !== 'explicit' || f?.baseline_known !== true || f.baseline_value !== 0) continue;
    const actual = level(prepared.candidate, o.label, i.factor_label);
    assert.deepEqual(actual, { ...i, value_kind: 'absolute' }, 'stated figure, author, and all other fields retained; no computed marker');
    checked++;
  }
  assert.equal(checked, 2, 'both raw settings exercise the class');
  assert.deepEqual(raw, before, 'preparation must not mutate the provider answer');
  assert.deepEqual(prepareProvisionalCandidate(prepared.candidate).candidate, prepared.candidate, 'idempotent preparation');
}

// A controlled single setting from the bakery answer; the rest of the candidate
// stays intact. These rows distinguish the ruling from a general provenance rewrite.
function control(factorPatch: Partial<CandidateModel['factors'][number]>, ivPatch: Partial<Iv> = {}) {
  const c = candidate(answers[1]!);
  const option = c.options.find((o) => o.label === 'Extra weekly oven shift')!;
  const i = option.interventions![0]!;
  const factor = c.factors.find((f) => f.label === i.factor_label)!;
  Object.assign(factor, factorPatch);
  Object.assign(i, ivPatch);
  return { c, option: option.label, factor: i.factor_label, original: structuredClone(i) };
}
function converted(factorPatch: Partial<CandidateModel['factors'][number]>, provenance: string, value: number, ivPatch: Partial<Iv> = {}): void {
  const { c, option, factor, original } = control(factorPatch, ivPatch);
  assert.deepEqual(level(prepareProvisionalCandidate(c).candidate, option, factor), {
    ...original, value_kind: 'absolute', value, provenance, derived_total: true,
  });
}

async function registeredBakery(): Promise<void> {
  const answer = answers[1]!;
  let graph: Pick<AdmittedModel, 'nodes' | 'edges'> | undefined;
  let calls = 0;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = (body as { graph: NonNullable<typeof graph> }).graph;
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (path.endsWith('/graph')) return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'offline-class1' } };
    throw new Error(`Unexpected dispatch: ${path}`);
  };
  const result = await buildModelFromBrief('11111111-1111-4111-8111-111111111111', answer.brief, dispatch, async () => {
    assert.equal(++calls, 1, 'no fabricated retry answer');
    return { text: answer.output_text };
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(calls, 1);
  assert.ok(graph);
  for (const [option, factor, value] of [
    ['Extra weekly oven shift', 'Additional weekly oven hours', 12],
    ['Distributor', 'Additional stores served', 8],
  ] as const) {
    const target: AdmittedNode = graph.nodes.find((n) => n.label === factor)!;
    const cell: ConstructedLevel | undefined = graph.nodes.find((n) => n.label === option)?.interventions?.[target.id];
    assert.ok(cell, `${option} -> ${factor} registered cell`);
    assert.equal(cell.source, 'brief_extraction');
    assert.equal(cell.raw_value, value);
    assert.equal(Object.hasOwn(cell, 'value_confidence'), false, 'stated addition is not a computed total');
    assert.deepEqual(cell.target_match, { node_id: target.id, match_type: 'exact_id', confidence: 'high' });
  }
}

export const class1Rows: { name: string; check: () => void | Promise<void> }[] = [
  ...answers.map((a) => ({ name: `RAW ${a.cohort_file}: both known-zero additions stay the user's`, check: () => statedZero(a) })),
  { name: 'BUILD bakery: both registered cells are brief_extraction without a computed marker', check: registeredBakery },
  { name: 'RANGE raw sealed: unchanged stated count can carry its own written 80–250 range', check: () => {
    const answer = answers[2]!;
    const c = withCountInterventionRanges(prepareProvisionalCandidate(candidate(answer)).candidate, answer.brief);
    assert.deepEqual(level(c, 'Launch starter tier', 'Starter-tier subscribers').range, {
      low: 80, high: 250, meaning: 'likely_range', source: 'brief_extraction',
      source_quote: 'The starter tier would win about 150 new subscribers, between 80 and 250.',
    });
  } },
  { name: 'CONTROL known non-zero estimated baseline still produces Olumi\'s total', check: () => converted({ baseline_value: 5 }, 'ai_proposed', 17) },
  { name: 'CONTROL unknown zero baseline still produces Olumi\'s total', check: () => converted({ baseline_known: false }, 'ai_proposed', 12) },
  { name: 'CONTROL unknown non-zero baseline still produces Olumi\'s total', check: () => converted({ baseline_known: false, baseline_value: 5 }, 'ai_proposed', 17) },
  { name: 'CONTROL null baseline still withholds the level', check: () => {
    const { c, option, factor } = control({ baseline_known: false, baseline_value: null });
    const p = prepareProvisionalCandidate(c);
    assert.equal(p.candidate.options.find((o) => o.label === option)?.interventions?.length, 0);
    assert.ok(p.candidate.options.find((o) => o.label === option)?.changes?.includes(factor));
    assert.deepEqual(p.additions_without_total, [{ option, factor, value: 12, reason: 'baseline_unknown', unit: 'hours/week', factor_unit: 'hours/week' }]);
  } },
  { name: 'CONTROL absolute launch at £49 on unknown baseline is still demoted', check: () => {
    const { c, option, factor, original } = control({ baseline_known: false, unit: 'GBP/month' }, { value_kind: 'absolute', value: 49, unit: 'GBP/month' });
    const p = prepareProvisionalCandidate(c);
    assert.deepEqual(level(p.candidate, option, factor), { ...original, provenance: 'ai_proposed' });
    assert.deepEqual(p.provenance_demoted, [{ option, factor, value: 49 }]);
  } },
  { name: 'CONTROL absolute £49 on known baseline stays explicit without computed marker', check: () => {
    const { c, option, factor, original } = control({ unit: 'GBP/month' }, { value_kind: 'absolute', value: 49, unit: 'GBP/month' });
    assert.deepEqual(level(prepareProvisionalCandidate(c).candidate, option, factor), original);
  } },
  { name: 'CONTROL factor-explicit non-zero path retains user source and medium computed confidence', check: () => {
    converted({ baseline_value: 5, provenance: 'explicit' }, 'explicit', 17);
    const { c, option, factor } = control({ baseline_value: 5, provenance: 'explicit' });
    const admitted = admitCandidateModel(prepareProvisionalCandidate(c).candidate, {});
    const id = admitted.nodes.find((n) => n.label === factor)!.id;
    const cell = admitted.nodes.find((n) => n.label === option)?.interventions?.[id];
    assert.equal(cell?.source, 'brief_extraction');
    assert.equal(cell?.value_confidence, 'medium');
  } },
  { name: 'factor-explicit known-zero stated figure has no computed marker', check: () => {
    const { c, option, factor, original } = control({ provenance: 'explicit' });
    assert.deepEqual(level(prepareProvisionalCandidate(c).candidate, option, factor), { ...original, value_kind: 'absolute' });
  } },
  ...(['inferred', 'ai_proposed'] as const).map((provenance) => ({
    name: `CONTROL ${provenance} addition on known zero is still Olumi's computed total`,
    check: () => converted({}, 'ai_proposed', 12, { provenance }),
  })),
  { name: 'CONTROL known-zero unit mismatch still withholds the level', check: () => {
    const { c, option } = control({}, { unit: 'stores' });
    const p = prepareProvisionalCandidate(c);
    assert.equal(p.candidate.options.find((o) => o.label === option)?.interventions?.length, 0);
    assert.equal(p.additions_without_total[0]?.reason, 'unit_mismatch');
  } },
];
