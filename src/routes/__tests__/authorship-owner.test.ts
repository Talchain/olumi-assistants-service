/**
 * ⭐⭐ THE ONE AUTHORSHIP OWNER (TL 11:51Z SYSTEM RULING, S2/O4): a drafted figure's VALUE source is decided once, by
 * `figureSource` — the AI's statement, verified against the user's words, states it — never by the draft's own flags.
 * Served G3 #3 (unseen b0f78e1d, VERIFY-b0f78e1d-unseen.md first loss): the drafter marked the user's three option costs
 * "inferred" while its own verified statements quoted the user's sentence for each, and all three were saved as Olumi's
 * (`cee_hypothesis`), shown as "Olumi estimate". BUDDY-A #3290 B1: a drafted current level the brief never wrote (7%, beside
 * the user's 6.5%) was stamped as the user's. Offline native build → admission → register on the served drafter calls
 * (cee_drafter_raw_responses 8099f669 and d8522790, read-only). 0 provider calls.
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
import { figureSource } from '../../orchestrator-v5/agent-lane/construction-source-map.js';
import type { CandidateModel } from '../../orchestrator-v5/agent-lane/admit-model.js';

type Rec = Record<string, any>;
const SID = '00000000-0000-4000-8000-000000000064';
const closed: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closed.splice(0)) await close(); });
const COSTS = JSON.parse(readFileSync(new URL('./fixtures/g3-unseen-c89d53d8-first-draft.json', import.meta.url), 'utf8')) as { brief_text: string; raw_text: string };
const SCRAP = JSON.parse(readFileSync(new URL('./fixtures/g3-unseen-1663fe34-first-draft.json', import.meta.url), 'utf8')) as { brief_text: string; raw_text: string };
const draftOf = (fx: { raw_text: string }): Rec => JSON.parse(fx.raw_text) as Rec;
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
const SPEND = 'total_financial_year_spend';
const settingOf = (graph: Rec | null, optionLabel: string, factorId: string): Rec => {
  const option = graph!.nodes.find((n: Rec) => n.kind === 'option' && n.label === optionLabel);
  expect(option, optionLabel).toBeDefined();
  return (option.data?.interventions ?? option.interventions)[factorId];
};

describe('the one authorship owner: a figure the user wrote is theirs, whatever the draft\u2019s own flags say', () => {
  it('precondition: the served draft marks the three costs "inferred", and its own statements quote the user for each', () => {
    const m = draftOf(COSTS);
    const costs = (m.options as Rec[]).flatMap((o) => (o.interventions as Rec[]).filter((i) => i.factor_label === 'Total financial-year spend').map((i) => [o.label, i.value, i.provenance]));
    expect(costs).toEqual([['Evening sort shift', 90000, 'inferred'], ['Route-planning software', 60000, 'inferred'], ['Micro-hubs and cargo bikes', 140000, 'inferred']]);
    expect((m.statements as Rec[]).filter((s) => s.subject.kind === 'option' && s.subject.factor_label === 'Total financial-year spend').map((s) => s.value)).toEqual([90000, 60000, 140000]);
  });
  it('⭐ RED→GREEN (G3 #3): the user\u2019s £90k, £60k and £140k are saved as the user\u2019s; each switch keeps its own source', async () => {
    const out = await construct(COSTS.brief_text, [draftOf(COSTS) as unknown as CandidateModel]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    for (const [label, raw] of [['Evening sort shift', 90000], ['Route-planning software', 60000], ['Micro-hubs and cargo bikes', 140000]] as const) {
      const setting = settingOf(out.graph, label, SPEND);
      expect(setting, label).toMatchObject({ raw_value: raw, source: 'brief_extraction' });
      expect(setting.user_material_unverified, label).toBeUndefined();
    }
    expect(settingOf(out.graph, 'Evening sort shift', 'evening_sort_shift_deployed')).toMatchObject({ value: 1, source: 'brief_extraction' });
  });
  it('CONTRAST: a figure the AI produced itself, with no statement claiming it, stays Olumi\u2019s', async () => {
    const m = draftOf(COSTS);
    m.statements = (m.statements as Rec[]).filter((s) => !(s.subject.kind === 'option' && s.subject.label === 'Micro-hubs and cargo bikes'));
    const out = await construct(COSTS.brief_text, [m as unknown as CandidateModel]);
    expect(settingOf(out.graph, 'Micro-hubs and cargo bikes', SPEND)).toMatchObject({ raw_value: 140000, source: 'cee_hypothesis' });
    expect(settingOf(out.graph, 'Micro-hubs and cargo bikes', SPEND).user_material_unverified).toBeUndefined();
    expect(settingOf(out.graph, 'Evening sort shift', SPEND), 'control').toMatchObject({ source: 'brief_extraction' });
  });
  it('NEGATIVE: a figure the AI claimed for the user that no verified statement states is UNKNOWN, never theirs and never Olumi\u2019s', async () => {
    const m = draftOf(COSTS);
    (m.options as Rec[]).find((o) => o.label === 'Route-planning software').interventions.find((i: Rec) => i.factor_label === 'Total financial-year spend').value = 65000;
    const out = await construct(COSTS.brief_text, [m as unknown as CandidateModel]);
    expect(settingOf(out.graph, 'Route-planning software', SPEND)).toMatchObject({ raw_value: 65000, source: 'cee_hypothesis', user_material_unverified: true });
  });
  it('NEGATIVE (BUDDY-A #3290 B1): a drafted current level the brief never wrote (7%, beside the user\u2019s 6.5%) is not used as theirs, and that is said', async () => {
    const m = draftOf(SCRAP);
    m.goal.baseline_value = 7;
    const out = await construct(SCRAP.brief_text, [m as unknown as CandidateModel]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    const goal = out.graph!.nodes.find((n: Rec) => n.kind === 'goal');
    expect(goal.observed_state).toBeUndefined();
    expect(goal.goal_direction, 'the user\u2019s "at most" is still held').toBe('<=');
    expect(JSON.stringify(out.result.not_represented)).toContain('The current level of \\"scrap rate on Line 2\\" (7) is not one you stated');
  });
  it('⭐ OWNER OVER FLAGS: the user\u2019s 6.5%, which a verified statement states, is theirs even where the draft marks it an estimate', async () => {
    const m = draftOf(SCRAP);
    m.goal.baseline_known = false;
    m.goal.provenance = 'inferred';
    const out = await construct(SCRAP.brief_text, [m as unknown as CandidateModel]);
    expect(out.graph!.nodes.find((n: Rec) => n.kind === 'goal').observed_state).toMatchObject({ raw_value: 6.5, source: 'brief_extraction' });
    expect(JSON.stringify(out.result.not_represented ?? [])).not.toContain('own estimate of the current level');
  });
  it('the owner itself: a point or bound the user wrote is theirs; a figure they did not write, and a statement never made, are not', () => {
    const m = draftOf(COSTS);
    const option = { kind: 'option', label: 'Evening sort shift', factor_label: 'Total financial-year spend' } as const;
    expect(figureSource(m, COSTS.brief_text, option, 'level', 90000)).toBe('user');
    expect(figureSource(m, COSTS.brief_text, option, 'level', 90001)).toBe('unverified');
    expect(figureSource(m, COSTS.brief_text, { kind: 'goal', label: 'On-time delivery rate' }, 'target', 94)).toBe('user');
    expect(figureSource(m, COSTS.brief_text, { kind: 'factor', label: 'Evening sort shift deployed' }, 'level', 1)).toBe('unclaimed');
    expect(figureSource({ ...m, statements: undefined }, COSTS.brief_text, option, 'level', 90000), 'a draft before SYSTEM 2').toBeUndefined();
  });
  it('CONTROL: the user\u2019s own 6.5% is still their current level', async () => {
    const out = await construct(SCRAP.brief_text, [draftOf(SCRAP) as unknown as CandidateModel]);
    expect(out.graph!.nodes.find((n: Rec) => n.kind === 'goal').observed_state).toMatchObject({ raw_value: 6.5, source: 'brief_extraction' });
  });
});
