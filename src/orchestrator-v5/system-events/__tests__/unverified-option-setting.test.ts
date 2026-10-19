/**
 * R3 SEAM (C5, DL lease 19 Oct; buddy AMEND CODEX-BUDDY-C5-R3-SWEEP, PL 16:05): an option's setting taken from someone's
 * words whose speaker or binding is not established is stored as ORIGIN UNKNOWN — `cee_hypothesis` beside
 * `user_material_unverified`, the estate's existing pairing (routing/add-option-transaction.ts) — never as Olumi's estimate
 * and never as the user's verified figure.
 *  · ONE provenance replacement: the level writer's single matched adoption record carries source and marker together; the
 *    encoder carries the marker only beside that source and never inherits an old one.
 *  · An equal figure never erases a source-only change: it is refused, never silently "unchanged".
 *  · The analysis-ready projection never reads the pairing as Olumi's.
 * Through the REAL batch door (`commitOptionLevelsInProcess`), the real writers and encoder; only the store is a double.
 * SYNTHETIC wording.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { settingProvenanceOf } from '../../../cee/provenance/provenance-of.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { buildAnalysisReadyPayload, transformOptionToAnalysisReady } from '../../../cee/transforms/analysis-ready.js';

type Rec = Record<string, unknown>;
const SCN = '5c5c5c5c-0000-4000-8000-0000000000b3';
let persisted: unknown;
const rows = new Map<string, { id: string; write: Rec }>();

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [...rows.values()].reverse().map((r) => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms, assistant_message: null, created_at: '2026-10-19T12:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap((r) => !ids.includes(r.id) ? []
      : ((r.write.handler_facts ?? []) as unknown[]).map((fact) => ({ turn_id: r.id, fact_created_at: '2026-10-19T12:00:00.000Z', fact }))),
    append: async (write: Rec) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id, replayedPriorTurn: true };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) as Rec });
      if (write.graph !== undefined) persisted = write.graph;
      return { id };
    },
    getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const STAFF_CELL = { value: 0.2, raw_value: 2, cap: 10, unit: 'people', source: 'brief_extraction' };
function stored(): unknown {
  const options = [
    { id: 'add_staff', kind: 'option', label: 'Add a second assistant', interventions: { staff: STAFF_CELL } },
    { id: 'carry_on', kind: 'option', label: 'Carry on as now', interventions: { staff: { value: 0.1, source: 'cee_hypothesis',
      target_match: { node_id: 'staff', match_type: 'exact_id', confidence: 'high' } } } },
  ];
  const g = {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Staffing' },
      { id: 'goal', kind: 'goal', label: 'Serve every visitor on the day' },
      { id: 'staff', kind: 'factor', label: 'Assistants on shift', category: 'controllable',
        observed_state: { value: 0.1, raw_value: 1, unit: 'people', cap: 10, source: 'brief_extraction', extractionType: 'explicit' } },
      ...options,
    ],
    edges: [
      ...options.map((o) => ({ from: 'decision', to: o.id, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      ...options.map((o) => ({ from: o.id, to: 'staff', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      { from: 'staff', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  };
  return projectGraphForPersistence({ ...GraphV3.parse(g), options: [] as Rec[] });
}
const cell = (optionId: string, factorId: string): Rec =>
  (((persisted as { nodes: Rec[] }).nodes.find((n) => n.id === optionId)!.interventions as Rec)[factorId]) as Rec;
const staff = (): Rec => (persisted as { nodes: Rec[] }).nodes.find((n) => n.id === 'staff')!;

let commitOptionLevelsInProcess: typeof import('../dispatch.js').commitOptionLevelsInProcess;
beforeAll(async () => { ({ commitOptionLevelsInProcess } = await import('../dispatch.js')); });
beforeEach(() => { persisted = stored(); rows.clear(); });

const level = (author: 'user_specified' | 'model_proposed' | 'unverified', raw = 3) => commitOptionLevelsInProcess({
  scenario_id: SCN, base_graph_hash: computeAnalysisAffectingGraphHash(persisted as never)!, turn_id: `turn-${author}-${raw}`, links: [],
  levels: [{ option_id: 'add_staff', factor_id: 'staff', value: raw / 10, raw_value: raw, cap: 10, unit: 'people', author }],
}, 'req-r3');

describe('a level from words of unestablished origin is stored as origin unknown', () => {
  it('RED: author "unverified" → cee_hypothesis beside the marker; the ONE authority reads unknown, never Olumi’s or the user’s', async () => {
    const out = await level('unverified');
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'committed', already_applied: false });
    expect(cell('add_staff', 'staff')).toMatchObject({ value: 0.3, raw_value: 3, source: 'cee_hypothesis', user_material_unverified: true });
    expect(settingProvenanceOf(cell('add_staff', 'staff'), staff())).toMatchObject({ origin: 'unknown' });
  });

  it.each([
    ['Olumi’s adopted level', 'model_proposed', 'ai'],
    ['the user’s own level', 'user_specified', 'human'],
  ] as const)('contrast: %s keeps its own reading, with no marker', async (_name, author, origin) => {
    await level(author);
    expect(cell('add_staff', 'staff').user_material_unverified).toBeUndefined();
    expect(settingProvenanceOf(cell('add_staff', 'staff'), staff()).origin).toBe(origin);
  });

  it('a later write by the user retires the marker: one replacement, never an inherited unknown', async () => {
    await level('unverified');
    await level('user_specified', 4);
    expect(cell('add_staff', 'staff')).toMatchObject({ raw_value: 4, source: 'user_specified' });
    expect(cell('add_staff', 'staff').user_material_unverified).toBeUndefined();
  });

  it('an equal figure never erases a source-only change: refused, the model unchanged', async () => {
    const before = JSON.stringify(persisted);
    const out = await level('unverified', 2);
    expect(out).toMatchObject({ status: 'refused', reason: 'same_figure_other_source' });
    expect(JSON.stringify(persisted)).toBe(before);
  });
});

describe('the encoder replaces source and marker together', () => {
  const graphWith = (node: Rec): Rec => ({ ...(stored() as Rec), nodes: ((stored() as { nodes: Rec[] }).nodes).map((n) =>
    n.id === 'add_staff' ? { ...n, ...node } : n) });
  const rebuilt = (g: Rec): Rec => (((encodeOptionInterventionsForEdit(g).graph as { nodes: Rec[] }).nodes
    .find((n) => n.id === 'add_staff')!.interventions as Rec).staff) as Rec;
  it('a reconstructed cell keeps the marker beside cee_hypothesis', () => {
    expect(rebuilt(graphWith({ interventions: { staff: { raw_value: 3, cap: 10, unit: 'people', source: 'cee_hypothesis', user_material_unverified: true } } })))
      .toMatchObject({ value: 0.3, source: 'cee_hypothesis', user_material_unverified: true });
  });
  it('a new figure over a marked cell never inherits the old marker (the old cell\u2019s claim is about the old figure)', () => {
    const out = rebuilt(graphWith({
      interventions: { staff: { value: 0.3, raw_value: 3, cap: 10, unit: 'people', source: 'cee_hypothesis', user_material_unverified: true,
        target_match: { node_id: 'staff', match_type: 'exact_id', confidence: 'high' } } },
      data: { interventions: { staff: { raw_value: 4, cap: 10, unit: 'people' } } },
    }));
    expect(out).toMatchObject({ value: 0.4, source: 'user_specified' });
    expect(out.user_material_unverified).toBeUndefined();
  });
  it('a marker beside any other source is never carried into the rebuilt cell', () => {
    const out = rebuilt(graphWith({ interventions: { staff: { raw_value: 3, cap: 10, unit: 'people', source: 'user_specified', user_material_unverified: true } } }));
    expect(out.user_material_unverified).toBeUndefined();
  });
});

describe('the analysis-ready projection never reads the pairing as Olumi\u2019s', () => {
  const optionsOf = (g: unknown) => ((g as { nodes: Rec[] }).nodes.filter((n) => n.kind === 'option')
    .map((n) => ({ id: n.id, label: n.label, status: 'ready', interventions: n.interventions }))) as never[];
  it.each([
    ['origin unknown', 'unverified', undefined],
    ['contrast: Olumi\u2019s adopted level', 'model_proposed', 'cee_hypothesis'],
  ] as const)('%s: attribution on the option and on the displayed setting', async (_name, author, attributed) => {
    await level(author);
    const option = optionsOf(persisted).find((o) => (o as Rec).id === 'add_staff')!;
    expect((transformOptionToAnalysisReady(option) as Rec).extraction_metadata
      ? ((transformOptionToAnalysisReady(option) as Rec).extraction_metadata as Rec).source : undefined).toBe(attributed);
    const payload = buildAnalysisReadyPayload(optionsOf(persisted), 'goal', persisted as never);
    const shown = (payload.options.find((o) => o.id === 'add_staff')!.interventions as Rec).staff;
    expect(typeof shown === 'object' && shown !== null, JSON.stringify(shown)).toBe(true);
    expect((shown as Rec).source).toBe(attributed);
  });
});
