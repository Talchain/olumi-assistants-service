import { describe, it, expect } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../../context/graph-hash.js';
import { PREMORTEM_PRESS_ID, methodTurnForReadback, methodPressOf, planPickChipId, planMethodTurn, settleMethodTurn } from '../../../method-turn/method-turn.js';
import { methodPlanOf } from '../../../guidance/plan.js';
import { PremortemWorksheetV1Schema, premortemProducerDirective, readPremortemProduction } from '../premortem.js';
import { OPTION, LINK, REPLY, ONE_STORY_REPLY, FAILURE, WARNING, captures, fixture, candidate, outside, worksheet } from './premortem-fixture.js';

describe('A2 producer and coverage', () => {
  it('chosen option outranks a different licensed plan in BOTH selectors; only chosen rows survive', () => {
    const { read } = fixture();
    const selected = planMethodTurn({ chipId: planPickChipId(OPTION), signalInputs: { ...read, offeredSpecific: [], graph: read.graph, analysisState: read.analysisState, analysisResult: read.analysisResult, leaderLicensed: true } });
    expect(selected?.kind).toBe('run');
    if (selected?.kind !== 'run') throw new Error('must run');
    expect(selected.context.plan).toMatchObject({ option_id: OPTION, basis: 'user_selected' });
    const licensedWithPick = { 'run.leader_licensed': true, 'run.leader_option_id': 'launch_starter_tier', 'user.selected_option_id': OPTION, 'model.non_sq_option_ids': [OPTION, 'launch_starter_tier'] } as const;
    // A2 r2 (DESIGN §2): only this turn's explicit worksheet press lets the pick outrank the licence; without it, base precedence.
    expect(methodPlanOf({ ...licensedWithPick, 'user.premortem_worksheet_press_id': planPickChipId(OPTION) })).toBe(OPTION);
    expect(methodPlanOf(licensedWithPick)).toBe('launch_starter_tier');
    expect(worksheet({ turn: selected, candidates: [candidate(), { ...candidate(), option_id: 'launch_starter_tier' }] })?.rows.map(r => r.option_id)).toEqual([OPTION]);
    expect(worksheet()?.coverage.find(c => c.option_id === 'launch_starter_tier')?.status).toBe('not_stress_tested');
  });
  it.each(['draw1', 'draw2'] as const)('generic %s retains W9 union without modifying scout bytes', key => {
    const c = captures[key], before = JSON.stringify(c);
    const turn = methodTurnForReadback(PREMORTEM_PRESS_ID, c);
    expect(turn?.kind).toBe('run');
    if (turn?.kind !== 'run') throw new Error('must run');
    expect(turn.context.plan).toBeNull();
    expect(turn.context.decision_level).toBe(true);
    // W9c #2724 (DL 7 Oct): an unlicensed decision puts the options' own levers FIRST, then keeps the W9 union intact.
    expect(turn.context.supplied_items.map(i => i.id)).toEqual(key === 'draw1' ? [LINK, 'customer_losses_from_price_rise'] : ['price_change_from_today', 'starter_tier_availability', 'monthly_recurring_revenue_lost_to_price_driven_churn->monthly_recurring_revenue', 'monthly_recurring_revenue_lost_to_price_driven_churn']);
    expect(JSON.stringify(c)).toBe(before);
  });
  it('all user-sized fixture still refuses; removed and ambiguous picks refuse even with a licence', () => {
    const c = structuredClone(captures.draw1);
    c.graph.nodes = c.graph.nodes.filter(n => n.kind !== 'risk');
    const ids = new Set(c.graph.nodes.map(n => n.id));
    c.graph.edges = c.graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => ({ ...e, defaulted: false, provenance: { source: 'user_specified', magnitude: 'user_stated' } }));
    c.graph.nodes = c.graph.nodes.map(n => n.kind === 'factor' ? { ...n, observed_state: { ...(n.observed_state as object), source: 'user_specified' } } : n);
    delete c.graph.goal_constraints;
    expect(methodTurnForReadback(PREMORTEM_PRESS_ID, c)).toMatchObject({ kind: 'unavailable', reason: 'no_grounded_item' });
    expect(methodTurnForReadback(planPickChipId('removed'), captures.draw1)).toMatchObject({ kind: 'choose_plan' });
    expect(methodPressOf(planPickChipId(OPTION), [OPTION, OPTION])).toEqual({ pick: null });
  });
  it('same-call appendix is separated, prose-only and malformed producer preserve the prose checker', () => {
    const { turn, read } = fixture();
    expect(premortemProducerDirective(turn, read.graph)).toContain(LINK);
    expect(readPremortemProduction(REPLY)).toEqual({ reply: REPLY, candidates: undefined });
    const output = readPremortemProduction(`${REPLY}\n<premortem_rows>${JSON.stringify([candidate()])}</premortem_rows>`);
    expect(output.reply).toBe(REPLY);
    expect(settleMethodTurn(turn, output.reply)).toMatchObject({ passed: true, reply: REPLY });
    const bad = readPremortemProduction(`${REPLY}\n<premortem_rows>broken`);
    expect(bad.reply).toBe(REPLY);
    expect(worksheet({ candidates: bad.candidates })).toBeUndefined();
  });
});

describe('A2 grounding and words', () => {
  it('accepts a bound row and a separate outside candidate with no model ids', () => {
    const out = worksheet({ candidates: [candidate(), outside()] });
    expect(out?.rows).toHaveLength(2);
    expect(out?.rows[1].grounding).toEqual({ kind: 'not_in_model', label: 'not in the model yet' });
    expect(out?.rows[1].risk_request.grounding_ids).toEqual([]);
    expect(out?.rows.every(r => r.provenance === 'olumi_hypothesis')).toBe(true);
    expect(PremortemWorksheetV1Schema.safeParse(out).success).toBe(true);
  });
  it.each([
    { ...candidate(), grounding: { kind: 'link', ids: ['fabricated->monthly_recurring_revenue'] } },
    { ...candidate(), early_warning: '' },
    { ...candidate(), early_warning: 'An unbound warning.' },
    { ...candidate(), failure_way: 'An unbound story.' },
    { ...candidate(), story_index: 3 },
    { ...candidate(), risk: { ...candidate().risk, label: 'An unrelated risk' } },
    { ...candidate(), risk: { ...candidate().risk, affected_node_id: 'price_rise' } },
    { ...outside(), grounding: { kind: 'not_in_model', ids: ['fabricated'] } },
    { ...outside(), failure_way: 'what could blindside this work?' },
  ])('withholds invalid row %# without repair', row => expect(worksheet({ candidates: [row] })).toBeUndefined());
  it('duplicate labels and stale supplied labels are withheld', () => {
    const { read, turn } = fixture();
    const graph = structuredClone(captures.draw1.graph);
    graph.nodes.push({ id: 'duplicate', kind: 'factor', label: 'monthly recurring revenue' });
    const graphHash = computeAnalysisAffectingGraphHash(graph as never)!;
    const duplicateRead = { ...read, graph, graphHash, analysisResult: { ...read.analysisResult as object, computed_against_hash: graphHash } };
    expect(worksheet({ initial: duplicateRead, final: duplicateRead })).toBeUndefined();
    const stale = { ...turn, context: { ...turn.context, supplied_items: turn.context.supplied_items.map(i => ({ ...i, id: 'stale', labels: ['stale'] })) } };
    // Initial turn's eligibility must agree with the final scoped items too.
    expect(worksheet({ turn: stale })).toBeUndefined();
  });
  it('generic story needs exactly one option and that option’s own path', () => {
    const { read, turn } = fixture();
    const generic = { ...turn, context: { ...turn.context, plan: null, decision_level: true } };
    expect(worksheet({ turn: generic })).toBeUndefined();
    const row = { ...candidate(), failure_way: `Raise prices: ${FAILURE}` };
    const reply = ONE_STORY_REPLY.replace(FAILURE, row.failure_way);
    expect(worksheet({ turn: generic, reply, candidates: [row] })?.rows).toHaveLength(1);
    expect(worksheet({ turn: generic, reply: reply.replace('Raise prices:', 'Launch starter tier:'), candidates: [{ ...row, option_id: 'launch_starter_tier', failure_way: `Launch starter tier: ${FAILURE}` }], initial: read, final: read })).toBeUndefined();
  });
  it.each(['most likely', 'best', 'winner', 'recommend', 'leads', 'ahead', 'beats', 'probability', '20%'])('drops injected %s in grounded AND outside rows', word => {
    const row = { ...candidate(), failure_way: `${FAILURE} ${word}` };
    expect(worksheet({ candidates: [row], reply: ONE_STORY_REPLY.replace(FAILURE, row.failure_way) })).toBeUndefined();
    expect(worksheet({ candidates: [{ ...outside(), early_warning: `${WARNING} ${word}` }] })).toBeUndefined();
  });
  it('an outside row cannot replace a dropped numbered story', () => expect(worksheet({ candidates: [{ ...candidate(), early_warning: '' }, outside()] })).toBeUndefined());
});

describe('A2 stamp and carrier validation', () => {
  it.each(['hash', 'time', 'graph', 'rerun', 'label'] as const)('withholds missing/moved %s', field => {
    const { read } = fixture();
    const final = structuredClone(read);
    if (field === 'hash') (final.analysisResult as Record<string, unknown>).computed_against_hash = undefined;
    if (field === 'time') (final.analysisState as Record<string, unknown>).run_state = { kind: 'complete_current' };
    if (field === 'rerun') (final.analysisState as Record<string, unknown>).run_state = { kind: 'complete_current', computed_at: '2026-10-07T02:00:00.000Z' };
    if (field === 'graph' || field === 'label') ((final.graph as typeof captures.draw1.graph).nodes.find(n => n.id === OPTION)!)[field === 'label' ? 'label' : 'interventions'] = field === 'label' ? 'Renamed' : {};
    expect(worksheet({ final })).toBeUndefined();
  });
  it('withholds absent turn id, refusal, non-method and unknown version', () => {
    expect(worksheet({ turnId: undefined })).toBeUndefined();
    expect(worksheet({ passed: false })).toBeUndefined();
    expect(worksheet({ turn: null })).toBeUndefined();
    const out = worksheet();
    expect(out).toBeDefined();
    expect(PremortemWorksheetV1Schema.safeParse({ ...out, version: 2 }).success).toBe(false);
  });
});
