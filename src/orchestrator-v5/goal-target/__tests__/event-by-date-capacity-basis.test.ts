/** E1: exact G1 B3-d2 provider bytes; one local spec, mocked provider and registration. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import * as EventModel from '../event-by-date-model.js';

type Rec = Record<string, any>;
const fixture = (name: string): Rec => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const raw = fixture('e1-b3-d2-raw.json');
const original = (): CandidateModel => JSON.parse(raw.output_text);
const sha = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const capacityEdges = (model: Rec): Rec[] => model.edges.filter((e: Rec) => e.from.startsWith('event_capacity_') && e.to === 'event_goal');
const expectedBasis = (option: CandidateModel['options'][number], deliverable: string): string => {
  const c = option.added_capacity!;
  return `Olumi provisional added-capacity estimate for "${option.label}": ${c.monthly_share_pct}% of ${deliverable} per month, after ${c.lead_months_low}–${c.lead_months_high} months of lead time.`;
};
const network = vi.fn(() => { throw new Error('E1 forbids network access'); });
const diffs: Rec[] = [];
beforeAll(() => vi.stubGlobal('fetch', network));
afterAll(() => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  if (process.env.E1_FIELD_DIFF_FILE) writeFileSync(process.env.E1_FIELD_DIFF_FILE, JSON.stringify(diffs, null, 2) + '\n');
});

async function replay(input = raw) {
  const admissions: Rec[] = [], registrations: Rec[] = [];
  const admit = EventModel.admitEventByDate;
  const spy = vi.spyOn(EventModel, 'admitEventByDate').mockImplementation((...args) => {
    const model = admit(...args);
    admissions.push(structuredClone(model));
    return model;
  });
  const call: CallStructuredModel = vi.fn(async () => ({ text: input.output_text }));
  try {
    const result = await buildModelFromBrief('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input.brief, async (path, body) => {
      if (path.endsWith('/graph/register')) {
        registrations.push((body as Rec).graph);
        return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
      }
      return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    }, call) as Rec;
    expect(call).toHaveBeenCalledOnce();
    return { admissions, registrations, result };
  } finally { spy.mockRestore(); }
}

function fieldDiff(before: any, after: any, path = ''): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return [path];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key =>
    fieldDiff(before[key], after[key], `${path}/${key}`));
}
function restoreOldProvenance(before: Rec, after: Rec): Rec {
  const restored = structuredClone(after);
  for (const edge of capacityEdges(restored)) {
    edge.provenance = before.edges.find((e: Rec) => e.from === edge.from && e.to === edge.to).provenance;
  }
  return restored;
}

describe('E1 event-by-date capacity carries its raw basis', () => {
  it('RED-first: the real B3-d2 output_text gives all three constructed capacity edges their basis', async () => {
    expect(createHash('sha256').update(raw.output_text).digest('hex')).toBe('60dfa3c26ed2619e0bc0ce0e3ce4d471f68a0d269c101e80e2d0fb8972270ac1');
    const replayed = await replay();
    const admitted = admitCandidateModel(original(), {}, raw.brief, undefined, undefined, undefined, undefined, undefined,
      { event_by_date_prompted: true });
    expect(replayed.admissions).toHaveLength(1);
    expect(replayed.registrations).toHaveLength(1);
    for (const model of [replayed.admissions[0], admitted, GraphV3.parse(admitted), replayed.registrations[0]]) {
      expect(capacityEdges(model)).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const edge = capacityEdges(model)[i];
        expect(edge.provenance).toEqual({ source: 'cee_hypothesis', magnitude: 'olumi_estimate',
          basis: expectedBasis(original().options[i]!, original().goal.deliverable!) });
        expect(edge.strength).toEqual({ mean: 0.5, std: 0.125 });
        expect(edge.defaulted).toBe(true);
        expect(edge.provenance.natural_effect).toBeUndefined();
      }
    }
    expect(replayed.result.open_questions).toContain(JSON.parse(raw.output_text).unknowns[3]);
    expect(replayed.result).toMatchObject({ ok: true, mutated: true });
  });

  it.each([null, undefined])('CONTRAST: added_capacity %s keeps an unsized placeholder and a magnitude question, with no invented basis', added_capacity => {
    const c = original();
    const missing = { ...c, options: c.options.map((o, i) => i === 0 ? { ...o, added_capacity } : o) };
    const model = EventModel.admitEventByDate(missing) as Rec;
    const edge = capacityEdges(model).find(e => e.from === 'event_capacity_1');
    expect(edge).toBeDefined();
    expect(edge).toMatchObject({ defaulted: true, strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
    expect(edge!.provenance.basis).toBeUndefined();
    expect(edge!.provenance.natural_effect).toBeUndefined();
    expect(model.nodes.find((n: Rec) => n.id === edge!.from).observed_state.extra_share_by_date).toBeUndefined();
    expect(model.loss.filter((l: Rec) => l.field_path === 'edges[event_capacity_1::event_goal].magnitude_question'))
      .toMatchObject([{ reason: expect.stringContaining('Olumi placeholder, unsized') }]);
    expect(EventModel.unresolvedEventOptionIds(model)).toContain('event_option_1');
    const dated = EventModel.withEventShareDate(model, '2027-09-30', '2026-10-11') as Rec;
    expect(capacityEdges(dated)[0]).toEqual(edge);
    expect(GraphV3.parse(model).edges.find(e => e.from === edge!.from)?.provenance?.magnitude).toBe('olumi_placeholder');
    // #2951's prompted admission preconditions/fallback remain intact.
    expect(EventModel.eventByDateAdmissionRefusal(missing)).toBe(EventModel.EVENT_BY_DATE_REFUSALS[1]);
  });

  it('field diff: baseline event digests move only for capacity provenance; every other byte survives', async () => {
    const before = fixture('e1-capacity-before.json');
    expect(sha(before)).toBe('1ecea25941164551d9c62076c0cdb53f292c2b348f723c291a4d9a0c5540038c');
    const replayed = await replay();
    const admitted = admitCandidateModel(original(), {}, raw.brief, undefined, undefined, undefined, undefined, undefined,
      { event_by_date_prompted: true });
    const oldFixture = fixture('event-b3-d2-20261008.json');
    const existing = admitCandidateModel(JSON.parse(oldFixture.output_text), {}, oldFixture.brief, undefined, undefined, undefined, undefined, undefined,
      { event_by_date_prompted: true });
    for (const [key, after] of Object.entries({ admitted, existing, dated: EventModel.withEventShareDate(admitted, '2027-09-30', '2026-10-11') })) {
      expectOnlyBasisChanges(before[key], after as Rec, key);
    }
    expect(JSON.stringify(replayed.result)).toBe(JSON.stringify(before.replayed.result));
    expect(replayed.registrations).toHaveLength(before.replayed.registrations.length);
    expect(replayed.admissions).toHaveLength(before.replayed.admissions.length);
    for (const key of ['admissions', 'registrations'] as const) {
      replayed[key].forEach((after, i) => expectOnlyBasisChanges(before.replayed[key][i], after, `${key}/${i}`));
    }
  });

  it('the existing event-b3-d2-20261008 registration digest stays unchanged', async () => {
    const { registrations } = await replay(fixture('event-b3-d2-20261008.json'));
    expect(registrations).toHaveLength(1);
    const g = structuredClone(registrations[0]);
    // Same historic digest normalization as event-by-date-typed-flag.test.ts: S7's two inferred levels.
    for (const id of ['senior_engineers_hired', 'junior_engineers_hired']) {
      const state = g.nodes.find((n: Rec) => n.id === id).observed_state;
      expect(state.extractionType).toBe('inferred');
      delete state.extractionType;
    }
    expect(sha(g).slice(0, 16)).toBe('beb8fd537da68f6d');
  });
});

function expectOnlyBasisChanges(before: Rec, after: Rec, label: string) {
  const expected = before.edges.flatMap((e: Rec, i: number) => e.from.startsWith('event_capacity_') && e.to === 'event_goal'
    ? [`/edges/${i}/provenance/basis`] : []);
  expect(fieldDiff(before, after), label).toEqual(expected);
  expect(JSON.stringify(restoreOldProvenance(before, after)), label).toBe(JSON.stringify(before));
  expect(sha(restoreOldProvenance(before, after)), label).toBe(sha(before));
  diffs.push({ label, before_sha256: sha(before), after_sha256: sha(after),
    restored_sha256: sha(restoreOldProvenance(before, after)), changes: fieldDiff(before, after).map(path => {
      const at = (model: Rec) => path.slice(1).split('/').reduce((v, key) => v?.[key], model) ?? null;
      return { path, before: at(before), after: at(after) };
    }) });
}
