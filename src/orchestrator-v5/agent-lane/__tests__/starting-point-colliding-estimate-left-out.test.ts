/**
 * ⭐ ONE COLLIDING ESTIMATE NEVER SINKS THE STARTING POINT (served marketing harness 2026-10-15T081857Z, CEE 09aa3118, turn 08).
 *
 * The "Suggest starting assumptions" press made `propose_starting_point` (the right tool: 5 option values + 1 factor level were
 * missing). Olumi's own estimates "Your campaign time = 25%" for ‘AI planning plus advertising’ and "Marketing experience = 25"
 * are the same number as Paul's brief, "I can't spend more than 25% of my time on this", so each half refused the WHOLE card
 * `origin_unknown`, and the reply told Paul "the source check returned unverified origin". Now an estimate Olumi declared as its
 * own (`user_stated: false`) that collides with a figure the user wrote is LEFT OUT, named with the user's words and asked; the
 * rest is offered; nothing left out is ever written. Every figure left out → the one refusal, as before (the K3 rows).
 * Inputs: the served model at the press (fixtures/marketing-harness-09aa3118-at-chip.json) with the values the served reply
 * listed; the served hiring read (fixtures/hiring-t1h-negative-r3-served-read-20261014.json), "Our budget is £200,000".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { UNKNOWN_ORIGIN_DETAIL } from '../runtime/statement-origin.js';

vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_c: unknown, _b: unknown, _o: unknown, call: unknown, build: (d: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
const read = (name: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
type Served = { scenario_id: string; brief_text: string; graph: Rec };
const MKT = read('marketing-harness-09aa3118-at-chip.json') as Served;
const HIRE_READ = read('hiring-t1h-negative-r3-served-read-20261014.json');
const HIRE: Served = { scenario_id: HIRE_READ.body.scenario_id as string, brief_text: HIRE_READ.body.brief_text as string, graph: HIRE_READ.body.graph as Rec };

function lane(fx: Served) {
  const graph = structuredClone(fx.graph);
  const before = JSON.stringify(graph);
  const dispatch: InternalDispatch = async (path) => (path === `/assist/v1/scenarios/${fx.scenario_id}/graph`
    ? { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: fx.brief_text,
      graph_identity_hash: computeGraphIdentityHash(graph as never) } }
    : { status: 404, json: {} });
  const store = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, store, (async () => ({ text: '{}' })) as never, 'full');
  // As the route builds it for a chip press: the chip's words are not typed, and the session's words are not complete.
  const ctx = { scenario_id: fx.scenario_id, authenticated_user_id: null, request_id: 'req-chip', turn_id: 'chip-turn',
    user_turn_text: '', user_text: fx.brief_text, unverified_user_text: '', user_text_complete: false };
  return { caps, store, ctx, unchanged: () => JSON.stringify(graph) === before };
}

const estimate = (option: string, factor: string, value: number) => ({ option_label: option, factor_label: factor, value, basis: 'Olumi’s estimate', user_stated: false });
/** The values the served reply listed (turn 08), as Olumi's declared estimates. */
const SERVED_LEVELS = [
  estimate('Hire marketing manager', 'Annual campaign spend', 90000), estimate('Hire marketing manager', 'Your campaign time', 15),
  estimate('AI planning plus advertising', 'Annual campaign spend', 90000), estimate('AI planning plus advertising', 'Advertising spend', 87000),
  estimate('AI planning plus advertising', 'Your campaign time', 25),
];
const SERVED_ASSUMPTIONS = [
  { factor_label: 'Marketing experience', value: 25, unit: 'score out of 100', basis: 'limited experience, as you said', user_stated: false },
  { factor_label: 'Campaign quality', value: 50, unit: 'score out of 100', basis: 'an untested reference point', user_stated: false },
];
const opsOf = (store: ProposalStore, id: unknown): Rec[] => store.get(String(id))!.operations.map((o): Rec => ({ ...o }));

describe('marketing 09aa3118: the press\'s starting point is offered, with the two colliding estimates left out and asked', () => {
  it('⭐ RED→GREEN: one card for the rest; 25% (AI option\'s time) and 25 (Marketing experience) are named with Paul\'s words, never written', async () => {
    const { caps, store, ctx, unchanged } = lane(MKT);
    const r = await caps.proposeStartingPoint!(ctx as never, { assumptions: SERVED_ASSUMPTIONS, option_levels: SERVED_LEVELS } as never) as Rec;
    expect(r, JSON.stringify(r).slice(0, 900)).toMatchObject({ ok: true, mutated: false });
    const left = (r.figures_left_out as Rec[]).map((f) => [f.option ?? null, f.factor, f.value]);
    expect(left).toEqual(expect.arrayContaining([['AI planning plus advertising', 'Your campaign time', 25], [null, 'Marketing experience', 25]]));
    expect(left).toHaveLength(2);
    for (const f of r.figures_left_out as Rec[]) expect(f.your_words).toBe("I can't spend more than 25% of my time on this, and I'm not that experienced with marketing.");
    expect(String(r.figures_left_out_note)).not.toMatch(/^.*\bsource check\b.*must/);
    const ops = opsOf(store, r.proposal_id);
    const paths = ops.map((o) => o.path);
    expect(paths).not.toContain('ai_planning_plus_advertising::your_campaign_time');
    expect(paths.some((p) => String(p).includes('marketing_experience'))).toBe(false);
    expect(paths).toEqual(expect.arrayContaining(['hire_marketing_manager::your_campaign_time', 'ai_planning_plus_advertising::advertising_spend']));
    expect(ops.every((o) => (o.value as Rec)?.authored_by === undefined || (o.value as Rec).authored_by === 'model_proposed')).toBe(true);
    expect(unchanged()).toBe(true);
  });

  it('the option-levels half alone: the four non-colliding levels are offered, the one colliding level left out', async () => {
    const { caps, store, ctx } = lane(MKT);
    const r = await caps.proposeOptionInterventions!(ctx as never, { interventions: SERVED_LEVELS } as never) as Rec;
    expect(r, JSON.stringify(r).slice(0, 600)).toMatchObject({ ok: true, mutated: false });
    expect((r.figures_left_out as Rec[]).map((f) => [f.option, f.factor, f.value])).toEqual([['AI planning plus advertising', 'Your campaign time', 25]]);
    expect(opsOf(store, r.proposal_id).filter((o) => o.op !== 'add_edge').map((o) => o.path).sort()).toEqual([
      'ai_planning_plus_advertising::advertising_spend', 'ai_planning_plus_advertising::annual_campaign_spend',
      'hire_marketing_manager::annual_campaign_spend', 'hire_marketing_manager::your_campaign_time']);
  });

  it('CONTRAST: every figure colliding → the one refusal exactly as before, in plain words, and nothing stored', async () => {
    const { caps, store, ctx, unchanged } = lane(MKT);
    const r = await caps.proposeOptionInterventions!(ctx as never, { interventions: [estimate('AI planning plus advertising', 'Your campaign time', 25)] } as never);
    expect(r).toEqual({ ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL });
    expect(UNKNOWN_ORIGIN_DETAIL).not.toMatch(/retained source|origin stays|Ask for its source/);
    expect(store.outstanding(MKT.scenario_id, null)).toEqual([]);
    expect(unchanged()).toBe(true);
  });

  it('CONTRAST: an estimate NOT declared as Olumi\'s (user_stated missing) still refuses the whole card, as K3 requires', async () => {
    const { caps, ctx } = lane(MKT);
    const undeclared = SERVED_LEVELS.map((l) => (l.value === 25 ? { ...l, user_stated: undefined } : l));
    const r = await caps.proposeOptionInterventions!(ctx as never, { interventions: undeclared } as never);
    expect(r).toEqual({ ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL });
  });
});

describe('hiring (served read 14 Oct, second brief): Olumi\'s £200,000 for an option\'s hiring spend is the brief\'s budget figure', () => {
  it('the colliding £200,000 is left out with "Our budget is £200,000…"; the 9 developers (served level 8) is offered', async () => {
    const { caps, store, ctx, unchanged } = lane(HIRE);
    const r = await caps.proposeOptionInterventions!(ctx as never, { interventions: [
      estimate('Hire two developers', 'Annual hiring spend', 200000), estimate('Hire two developers', 'Developer headcount', 9)] } as never) as Rec;
    expect(r, JSON.stringify(r).slice(0, 600)).toMatchObject({ ok: true, mutated: false });
    expect((r.figures_left_out as Rec[]).map((f) => [f.option, f.factor, f.value, f.your_words])).toEqual([
      ['Hire two developers', 'Annual hiring spend', 200000, "Our budget is £200,000, but we'd like to spend less."]]);
    expect(opsOf(store, r.proposal_id).filter((o) => o.op !== 'add_edge').map((o) => o.path)).toEqual(['hire_two_developers::developer_headcount']);
    expect(unchanged()).toBe(true);
  });
});
