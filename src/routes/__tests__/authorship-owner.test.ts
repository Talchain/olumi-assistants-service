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
import { draftStatements, figureSource, sourceMapOf, subjectKey } from '../../orchestrator-v5/agent-lane/construction-source-map.js';
import { goalLevelOwner, type CandidateModel } from '../../orchestrator-v5/agent-lane/admit-model.js';
import { settingAuthorshipOf, settingDisplayOf } from '../../cee/provenance/provenance-of.js';

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

/**
 * ⭐ G3 #4 (TL 14:17Z / DL-3 14:21Z; served a75de9cb, #3290 live): three stated option costs, one per year, one over the period, one
 * one-off, drafted `inferred` with NO statement for them, were stored `cee_hypothesis` and said as "Olumi estimate". SYNTHETIC rows in
 * those shapes (the brief's cost sentence rewritten here; never the unseen brief): the owner verifies each cost the AI states, and a
 * cost it does not state is UNKNOWN, never Olumi's ("inferred" means read out of the brief); only `ai_proposed` is Olumi's own.
 */
describe('G3 #4: option costs written per year, over the period and one-off', () => {
  const SHAPED = 'The evening shift would cost around £90k a year in wages. The software would cost about £60k over the two years of the licence. '
    + 'The micro-hubs are a one-off £140k to set up.';
  const ORIGINAL = 'The evening shift would cost around £90k a year in wages, the software about £60k, and the micro-hubs probably £140k to set up.';
  const BRIEF = COSTS.brief_text.replace(ORIGINAL, SHAPED);
  const SENTENCE: Readonly<Record<string, string>> = {
    'Evening sort shift': 'The evening shift would cost around £90k a year in wages.',
    'Route-planning software': 'The software would cost about £60k over the two years of the licence.',
    'Micro-hubs and cargo bikes': 'The micro-hubs are a one-off £140k to set up.',
  };
  const COST = { 'Evening sort shift': 90000, 'Route-planning software': 60000, 'Micro-hubs and cargo bikes': 140000 } as const;
  const shaped = (keep: 'statements' | 'none', provenance = 'inferred'): Rec => {
    const m = draftOf(COSTS);
    m.statements = (m.statements as Rec[]).flatMap((st) => {
      const label = st.subject.kind === 'option' && st.subject.factor_label === 'Total financial-year spend' ? st.subject.label as string : undefined;
      if (label === undefined) return [st];
      return keep === 'none' ? [] : [{ ...st, quote: SENTENCE[label] }];
    });
    for (const o of m.options as Rec[]) for (const i of o.interventions as Rec[]) if (i.factor_label === 'Total financial-year spend') i.provenance = provenance;
    return m;
  };
  it('precondition: the synthetic brief writes each cost in its own shape, and the original sentence is gone', () => {
    expect(BRIEF).not.toContain(ORIGINAL);
    for (const sentence of Object.values(SENTENCE)) expect(BRIEF).toContain(sentence);
  });
  it('⭐ the owner verifies each stated cost, a year / over the period / one-off: all three are the user\u2019s', async () => {
    const out = await construct(BRIEF, [shaped('statements') as unknown as CandidateModel]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    for (const [label, raw] of Object.entries(COST)) {
      const setting = settingOf(out.graph, label, SPEND);
      expect(setting, label).toMatchObject({ raw_value: raw, source: 'brief_extraction' });
      expect(setting.user_material_unverified, label).toBeUndefined();
      expect(settingAuthorshipOf(setting), label).toBe('user');
    }
  });
  it('⭐ RED→GREEN (the served shape): costs drafted `inferred` with no statement are UNKNOWN, never Olumi\u2019s, in store and display', async () => {
    const out = await construct(BRIEF, [shaped('none') as unknown as CandidateModel]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    for (const [label, raw] of Object.entries(COST)) {
      const setting = settingOf(out.graph, label, SPEND);
      expect(setting, label).toMatchObject({ raw_value: raw, user_material_unverified: true });
      expect(settingAuthorshipOf(setting), label).toBe('unknown');
      expect(settingDisplayOf(setting), label).toBe('unverified_brief');
    }
  });
  it('a total computed from an addition the draft read from the brief but did not state is UNKNOWN too, never Olumi\u2019s', async () => {
    const m = shaped('none');
    const factor = (m.factors as Rec[]).find((f) => f.label === 'Total financial-year spend')!;
    const iv = (m.options as Rec[]).find((o) => o.label === 'Evening sort shift')!.interventions.find((i: Rec) => i.factor_label === 'Total financial-year spend');
    Object.assign(iv, { value_kind: 'additional', unit: factor.unit });
    const out = await construct(BRIEF, [m as unknown as CandidateModel]);
    const setting = settingOf(out.graph, 'Evening sort shift', SPEND);
    expect(setting, 'the derived total').toMatchObject({ raw_value: 90000, user_material_unverified: true });
    expect(settingAuthorshipOf(setting)).toBe('unknown');
  });
  it('CONTRAST: the same costs drafted `ai_proposed` (the AI\u2019s own figures) are Olumi\u2019s', async () => {
    const out = await construct(BRIEF, [shaped('none', 'ai_proposed') as unknown as CandidateModel]);
    for (const label of Object.keys(COST)) {
      const setting = settingOf(out.graph, label, SPEND);
      expect(setting.user_material_unverified, label).toBeUndefined();
      expect(settingAuthorshipOf(setting), label).toBe('olumi_estimate');
    }
  });
  it('goal level: one the draft says it read from the brief (`inferred`), with no statement, is said as unconfirmed, never as Olumi\u2019s estimate', async () => {
    const level = (baselineProvenance: string): Rec => {
      const m = draftOf(SCRAP);
      m.statements = (m.statements as Rec[]).filter((st) => !(st.subject.kind === 'goal' && st.field === 'level'));
      m.goal.baseline_provenance = baselineProvenance;
      return m;
    };
    const read = await construct(SCRAP.brief_text, [level('inferred') as unknown as CandidateModel]);
    expect(read.graph!.nodes.find((n: Rec) => n.kind === 'goal').observed_state).toBeUndefined();
    expect(JSON.stringify(read.result.not_represented)).toContain('could not be confirmed from your brief');
    expect(JSON.stringify(read.result.not_represented)).not.toContain('Olumi\'s own estimate of the current level');
    const own = await construct(SCRAP.brief_text, [level('ai_proposed') as unknown as CandidateModel]);
    expect(JSON.stringify(own.result.not_represented), 'CONTRAST: the AI\u2019s own level is Olumi\u2019s').toContain('Olumi\'s own estimate of the current level');
  });
});

describe('the one authorship owner: a figure the user wrote is theirs, whatever the draft\u2019s own flags say', () => {
  it('precondition: the served draft marks the three costs "inferred", and its own statements quote the user for each', () => {
    const m = draftOf(COSTS);
    const costs = (m.options as Rec[]).flatMap((o) => (o.interventions as Rec[]).filter((i) => i.factor_label === 'Total financial-year spend').map((i) => [o.label, i.value, i.provenance]));
    expect(costs).toEqual([['Evening sort shift', 90000, 'inferred'], ['Route-planning software', 60000, 'inferred'], ['Micro-hubs and cargo bikes', 140000, 'inferred']]);
    expect((m.statements as Rec[]).filter((s) => s.subject.kind === 'option' && s.subject.factor_label === 'Total financial-year spend').map((s) => s.value)).toEqual([90000, 60000, 140000]);
  });
  it('⭐ RED→GREEN (G3 #3): the user\u2019s £90k, £60k and £140k are saved as the user\u2019s; a switch with no statement is never stamped theirs', async () => {
    const out = await construct(COSTS.brief_text, [draftOf(COSTS) as unknown as CandidateModel]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    for (const [label, raw] of [['Evening sort shift', 90000], ['Route-planning software', 60000], ['Micro-hubs and cargo bikes', 140000]] as const) {
      const setting = settingOf(out.graph, label, SPEND);
      expect(setting, label).toMatchObject({ raw_value: raw, source: 'brief_extraction' });
      expect(setting.user_material_unverified, label).toBeUndefined();
    }
    // TL 13:18Z fail-safe: the draft's `explicit` on a switch with no statement is not proof; its origin is unknown, not the user's.
    expect(settingOf(out.graph, 'Evening sort shift', 'evening_sort_shift_deployed')).toMatchObject({ value: 1, source: 'cee_hypothesis', user_material_unverified: true });
  });
  it('CONTRAST: a figure the AI produced itself, with no statement claiming it, stays Olumi\u2019s', async () => {
    const m = draftOf(COSTS);
    m.statements = (m.statements as Rec[]).filter((s) => !(s.subject.kind === 'option' && s.subject.label === 'Micro-hubs and cargo bikes'));
    // TL 14:17Z: the drafter's contract is "inferred for what you read out of the brief, ai_proposed for anything you added beyond
    // it", so the AI's OWN figure is `ai_proposed` (was left `inferred` here, which claims the brief: see the G3 #4 rows below).
    (m.options as Rec[]).find((o) => o.label === 'Micro-hubs and cargo bikes')!.interventions.find((i: Rec) => i.factor_label === 'Total financial-year spend').provenance = 'ai_proposed';
    const out = await construct(COSTS.brief_text, [m as unknown as CandidateModel]);
    expect(settingOf(out.graph, 'Micro-hubs and cargo bikes', SPEND)).toMatchObject({ raw_value: 140000, source: 'cee_hypothesis' });
    expect(settingOf(out.graph, 'Micro-hubs and cargo bikes', SPEND).user_material_unverified).toBeUndefined();
    expect(settingOf(out.graph, 'Evening sort shift', SPEND), 'control').toMatchObject({ source: 'brief_extraction' });
  });
  it('NEGATIVE: a figure the AI claimed for the user that no verified statement states is UNKNOWN, never theirs and never Olumi\u2019s', async () => {
    const m = draftOf(COSTS);
    (m.options as Rec[]).find((o) => o.label === 'Route-planning software')!.interventions.find((i: Rec) => i.factor_label === 'Total financial-year spend').value = 65000;
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
    expect(JSON.stringify(out.result.not_represented)).toContain('The current level of \\"scrap rate on Line 2\\" (7) could not be confirmed from your brief');
  });
  const noLevelStatement = (m: Rec): Rec => ({ ...m, statements: (m.statements as Rec[]).filter((st) => !(st.subject.kind === 'goal' && st.field === 'level')) });
  it('NEGATIVE (BUDDY-A #3290 r2, same native family): with NO goal-level statement at all, the drafted 7% is not stamped theirs by its `explicit` flag', async () => {
    const m = noLevelStatement(draftOf(SCRAP));
    m.goal.baseline_value = 7;
    expect(figureSource(m, SCRAP.brief_text, { kind: 'goal', label: 'scrap rate on Line 2' }, 'level', 7)).toBe('unclaimed');
    const out = await construct(SCRAP.brief_text, [m as unknown as CandidateModel]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    expect(out.graph!.nodes.find((n: Rec) => n.kind === 'goal').observed_state).toBeUndefined();
    expect(JSON.stringify(out.result.not_represented)).toContain('The current level of \\"scrap rate on Line 2\\" (7) could not be confirmed from your brief');
  });
  it('the same omission on the user\u2019s real 6.5%: no proof, so it is not stamped theirs either; the user is asked to confirm it (the drafter\u2019s statement is the proof)', async () => {
    const out = await construct(SCRAP.brief_text, [noLevelStatement(draftOf(SCRAP)) as unknown as CandidateModel]);
    expect(out.graph!.nodes.find((n: Rec) => n.kind === 'goal').observed_state).toBeUndefined();
    expect(JSON.stringify(out.result.not_represented)).toContain('Confirm the current level of \\"scrap rate on Line 2\\"');
  });
  it('CONTROL (served capacity cfa31dfb, row 5d0a23b7): a goal level with no goal-level statement is still theirs as the total of their own declared sum', async () => {
    const fx = JSON.parse(readFileSync(new URL('./fixtures/capacity-cfa31dfb-first-draft.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };
    const m = JSON.parse(fx.raw_text) as Rec;
    expect(figureSource(m, fx.brief, { kind: 'goal', label: 'Weekly support capacity' }, 'level', 80)).toBe('unclaimed');
    expect(goalLevelOwner(m as never, fx.brief, 80), 'the owner, through the declared sum').toBe('user');
    const out = await construct(fx.brief, [m as unknown as CandidateModel]);
    expect(out.result, JSON.stringify(out.result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    expect(out.graph!.nodes.find((n: Rec) => n.kind === 'goal').observed_state).toMatchObject({ raw_value: 80, source: 'brief_extraction' });
  });
  it('NEGATIVE (settings, same rule): a cost flagged `explicit` with no statement for it is UNKNOWN, as is its switch', async () => {
    const m = draftOf(COSTS);
    m.statements = (m.statements as Rec[]).filter((st) => !(st.subject.kind === 'option' && st.subject.label === 'Route-planning software'));
    (m.options as Rec[]).find((o) => o.label === 'Route-planning software')!.interventions.find((i: Rec) => i.factor_label === 'Total financial-year spend').provenance = 'explicit';
    const out = await construct(COSTS.brief_text, [m as unknown as CandidateModel]);
    expect(settingOf(out.graph, 'Route-planning software', SPEND)).toMatchObject({ raw_value: 60000, source: 'cee_hypothesis', user_material_unverified: true });
    expect(settingOf(out.graph, 'Route-planning software', 'route_planning_software_deployed')).toMatchObject({ value: 1, source: 'cee_hypothesis', user_material_unverified: true });
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
    expect(figureSource(m, COSTS.brief_text, option, 'level', -90000), 'SIGN (#3243): the verifier\u2019s sign decides, never the magnitude').toBe('unverified');
    expect(figureSource(m, COSTS.brief_text, { kind: 'goal', label: 'On-time delivery rate' }, 'target', 94)).toBe('user');
    expect(figureSource(m, COSTS.brief_text, { kind: 'factor', label: 'Evening sort shift deployed' }, 'level', 1)).toBe('unclaimed');
    expect(figureSource({ ...m, statements: undefined }, COSTS.brief_text, option, 'level', 90000), 'a draft before SYSTEM 2').toBeUndefined();
  });
  it('the owner and a stated RANGE (AIE range disposition): neither end of the user\u2019s verified "1.5 to 2.5" is their single figure', () => {
    const m = draftOf(SCRAP);
    const link = { kind: 'link', label: 'Camera retrofit installed', to_label: 'scrap rate on Line 2' } as const;
    // Positive control: the joined range IS verified as the user's statement (so the refusal below is the end rule, not a miss).
    expect((sourceMapOf(draftStatements(m), SCRAP.brief_text).verified.get(subjectKey(link, 'effect')) ?? []).map((st) => [st.form, Math.abs(st.low!), Math.abs(st.high!)]))
      .toEqual([['range', 1.5, 2.5]]);
    for (const end of [1.5, 2.5, -1.5, -2.5]) expect(figureSource(m, SCRAP.brief_text, link, 'effect', end), String(end)).toBe('unverified');
  });
  it('CONTROL: the user\u2019s own 6.5% is still their current level', async () => {
    const out = await construct(SCRAP.brief_text, [draftOf(SCRAP) as unknown as CandidateModel]);
    expect(out.graph!.nodes.find((n: Rec) => n.kind === 'goal').observed_state).toMatchObject({ raw_value: 6.5, source: 'brief_extraction' });
  });
});
