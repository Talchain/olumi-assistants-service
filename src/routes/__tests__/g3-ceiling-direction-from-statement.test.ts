/**
 * ⭐ G3 (TL 10:49Z; unseen brief 1663fe34 on 1fdc89b3, now SEEN): the goal's "at most" direction comes from the AI's own reading
 * of the user's target sentence. Served: the drafter wrote `operator: "<="` and verified "I want to bring it down to 4% or lower
 * by the end of June next year." as the goal's target, `upper_bound`; the host's ceiling word reader still dropped the
 * direction, so the user's stated 6.5% was refused ("a goal of that kind cannot be calculated correctly yet") and no chance was
 * shown until the user set "at most" by hand. Offline native build → admission → register, on the served first drafter call
 * (`fixtures/g3-unseen-1663fe34-first-draft.json`, cee_drafter_raw_responses d8522790, read-only). 0 provider calls.
 */
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

vi.mock('../../config/index.js', async original => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../orchestrator-v5/session/index.js', async original => ({
  ...await original<Record<string, unknown>>(), getSessionStore: () => withScenarioRevision(storeRef.value!),
}));
vi.mock('../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../../orchestrator-v5/drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { buildModelFromBrief } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import type { CandidateModel } from '../../orchestrator-v5/agent-lane/admit-model.js';
import { resolveGoalDirection } from '../../orchestrator-v5/goal-target/goal-direction.js';
import { figuresWritten } from '../../orchestrator-v5/agent-lane/construction-source-map.js';

type Rec = Record<string, any>;
const SID = '00000000-0000-4000-8000-000000000063';
const closed: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closed.splice(0)) await close(); });
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/g3-unseen-1663fe34-first-draft.json', import.meta.url), 'utf8')) as { brief_text: string; raw_text: string };
const BRIEF = SERVED.brief_text;
const TARGET_SENTENCE = 'I want to bring it down to 4% or lower by the end of June next year.';
const served = (): CandidateModel => JSON.parse(SERVED.raw_text) as CandidateModel;
/** The served draft with the AI's reading of the user's target sentence changed. */
const withTargetForm = (form: string): CandidateModel => {
  const m = served() as unknown as Rec;
  for (const s of m.statements as Rec[]) if (s.subject.kind === 'goal' && s.field === 'target') { s.form = form; if (form === 'point') { s.value = 4; s.high = null; } }
  return m as unknown as CandidateModel;
};
async function construct(brief: string, drafts: CandidateModel[]) {
  let stored: Rec | null = null;
  const writes: Rec[] = [];
  let writtenBrief: unknown;
  storeRef.value = {
    append: vi.fn(async (w: Rec) => { stored = structuredClone(w.graph); writes.push(w); return { id: w.turn_id }; }),
    loadGraph: async () => stored,
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true, readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [],
  };
  const app = Fastify();
  await registerRoute(app); await app.ready(); closed.push(() => app.close());
  const dispatch = async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) {
      writtenBrief = body.brief_text;
      const r = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body });
      return { status: r.statusCode, json: r.json() };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: stored ?? { nodes: [], edges: [] }, graph_hash: 's2' } };
  };
  let calls = 0;
  const call = async () => ({ text: JSON.stringify(drafts[Math.min(calls++, drafts.length - 1)]), status: 'completed' as const });
  const result = await buildModelFromBrief(SID, brief, dispatch as never, call) as Rec;
  return { result, graph: stored as Rec | null, writes, calls, writtenBrief };
}
const goalNode = (graph: Rec | null): Rec => {
  const goals = graph?.nodes.filter((n: Rec) => n.kind === 'goal') ?? [];
  expect(goals).toHaveLength(1);
  return goals[0];
};
const refusedLevel = (result: Rec): boolean => JSON.stringify(result).includes('cannot be calculated correctly yet');

describe('G3: a ceiling goal\u2019s direction comes from the AI\u2019s verified reading of the user\u2019s target sentence', () => {
  it('precondition: the served draft says "<=" and reads the target sentence as an upper bound, verified', () => {
    const m = served() as unknown as Rec;
    expect(m.goal).toMatchObject({ operator: '<=', value: 4, target_stated: true, provenance: 'explicit' });
    expect((m.statements as Rec[]).filter((s) => s.subject.kind === 'goal' && s.field === 'target'))
      .toEqual([expect.objectContaining({ quote: TARGET_SENTENCE, form: 'upper_bound', value: 4 })]);
  });
  it('⭐ RED→GREEN: the served draft holds "at most" and the user\u2019s stated 6.5% is the goal\u2019s current level, not refused', async () => {
    const out = await construct(BRIEF, [served()]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    const goal = goalNode(out.graph);
    expect(goal).toMatchObject({ goal_direction: '<=', goal_threshold_raw: 4, threshold_source: 'brief_extraction' });
    expect(goal.observed_state, 'the user\u2019s stated level is the goal\u2019s current level, on its own 0–100% scale')
      .toMatchObject({ raw_value: 6.5, value: 0.065, baseline: 0.065, source: 'brief_extraction' });
    expect(resolveGoalDirection(out.graph, goal.id), 'the run scores it lower-is-better').toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
    expect(refusedLevel(out.result), 'no "cannot be calculated correctly yet" refusal').toBe(false);
  });
  it('NEGATIVE (AIQ 5872082179 kept): with the target NOT typed as a level, a "%" ceiling may be a change, so the level is not admitted', async () => {
    const m = served() as unknown as Rec;
    delete m.goal.frame;
    const out = await construct(BRIEF, [m as unknown as CandidateModel]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    expect(goalNode(out.graph).observed_state).toBeUndefined();
  });
  it('NEGATIVE: the drafter\u2019s "<=" alone, with the sentence read as a point, never holds a ceiling as the user\u2019s', async () => {
    const out = await construct(BRIEF, [withTargetForm('point')]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    expect(goalNode(out.graph).goal_direction).toBeUndefined();
    expect(goalNode(out.graph).observed_state, 'and its level is not read against a ceiling the goal does not hold').toBeUndefined();
  });
});

describe('G3: a link size that is one end of the user\u2019s range is said with that range (TL 10:49Z: ranges are kept)', () => {
  const camera = (graph: Rec | null): Rec => graph!.edges.find((e: Rec) => e.from === 'camera_retrofit_installed' && e.to === 'scrap_rate_on_line_2');
  /** The served draft with the AI's reading of the camera's effect sentence changed. */
  const withCameraEffect = (patch: Rec): CandidateModel => {
    const m = served() as unknown as Rec;
    Object.assign((m.statements as Rec[]).find((s) => s.subject.kind === 'link' && s.subject.to_label === 'scrap rate on Line 2' && s.field === 'effect')!, patch);
    return m as unknown as CandidateModel;
  };
  it('⭐ RED→GREEN: the AI read "1.5 to 2.5 percentage points" as a range; the camera link keeps it, its size the low end, numbers as before', async () => {
    const out = await construct(BRIEF, [served()]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    const edge = camera(out.graph);
    expect(edge.provenance.natural_effect.stated_range, 'both ends kept as written; the reported clause is words only, not stored').toEqual({ low: 1.5, high: 2.5, text: '1.5 to 2.5 percentage points', end: 'low' });
    expect(edge.provenance.natural_effect.amount).toBe(-1.5);
    expect(edge.strength, 'Science C1: a range sets no spread; the stated size stays the mean').toEqual({ mean: -0.015, std: 0.0075 });
    // AIE range disposition (16 Oct): said as the brief reports it, speaker and "reckons" kept, and the calculation's own figure
    // named as a separate approximation; never the user's single figure, never "the low end" or a floor.
    const said = JSON.stringify(out.result);
    expect(said).toContain('(the supplier quotes £180k and reckons it would cut scrap by 1.5 to 2.5 percentage points)\\", as the brief puts it. '
      + 'The current calculation uses a separate approximation, a change of \u22121.5 percentage points per switch, not that range.');
    expect(said).not.toContain('low end of your');
    expect(said).not.toMatch(/floor: at least|ceiling: at most/);
  });
  it('AIE 6180604131 kept: only figures JOINED as a range, low below high, pair; a change or two separate figures never do', () => {
    const ranges = (q: string) => figuresWritten(q).filter((f) => f.low < f.high);
    expect(ranges('it would cut scrap by 1.5 to 2.5 percentage points')).toEqual([{ low: 1.5, high: 2.5 }]);
    expect(ranges('between 3 and 5 weeks')).toEqual([{ low: 3, high: 5 }]);
    expect(figuresWritten('cut legacy from 25% to 15%'), 'a change, high to low: two figures, no pair').toEqual([{ low: 25, high: 25 }, { low: 15, high: 15 }]);
    expect(ranges('six developers and 25% legacy')).toEqual([]);
    expect(ranges('12 engineers, 20 contractors')).toEqual([]);
  });
  it('NEGATIVE: the same sentence read as a single figure invents no range', async () => {
    const out = await construct(BRIEF, [withCameraEffect({ form: 'point', value: 1.5, low: null, high: null })]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    expect(camera(out.graph).provenance.natural_effect.stated_range).toBeUndefined();
  });
});

