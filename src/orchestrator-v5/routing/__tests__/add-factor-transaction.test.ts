/**
 * ⭐ PJ-E-FIG — A NEW FACTOR WITH THE FIGURE THE USER STATED, HELD ON THE PRODUCT'S OWN SEAM (DL #72 5866036457, on
 * Canonical 5866021645). The add-risk door's twin: journey E's "Senior engineers cost £120k a year each and juniors £65k a
 * year each." must land as two typed factors carrying the USER's figures, in ONE hold, ONE approval, ONE commit.
 *
 * These rows run the REAL builder, the REAL referee hold (`dispatchAddFactorTransaction`), `readGmHeldResume` and
 * `executeGmHeldResume` on journey E's served draft graph (`journey-e-e07-draft-graph.json`). The seam rows (the Agent
 * route, the store, the approval) are `agent-lane/__tests__/agent-add-factor-door-seam.test.ts`.
 *
 * ⛔ THE SOURCE LITERAL. The ruling names `observed_state.source: 'user_specified'`. That literal is NOT an
 * `ObservedStateV3.source` member under the pinned `@talchain/schemas` 0.60.0 (row S0 proves it), so every approval that
 * stamped it would be declined by the post-apply GraphV3 parse. The door stamps the product's existing literal for a figure
 * the user typed in chat, `USER_EDIT_SOURCE` (the goal-current-level precedent) — imported, never spelled here.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import type { PendingAction } from '../../session/pending-action.js';
import {
  buildAddFactorTransaction,
  GM_HELD_USER_TODAY_KEY,
  isUserTodayObservedState,
  readUserTodayMember,
  stampNewUserTodayLevels,
  USER_TODAY_SOURCE,
} from '../add-factor-transaction.js';
import { hypothesisEdgeValue } from '../add-option-transaction.js';
import { dispatchAddFactorTransaction } from '../../handlers/add-factor-dispatch.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { threadHoldsThroughMutatingCommit } from '../../handlers/hold-thread-through.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { framedObservedState, defaultFrameFor } from '../../agent-lane/admit-model.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import { ObservedStateV3 } from '../../../schemas/cee-v3.js';
import { _resetConfigCache } from '../../../config/index.js';

type Json = Record<string, any>;

const GRAPH = JSON.parse(
  readFileSync(new URL('../../agent-lane/__tests__/fixtures/journey-e-e07-draft-graph.json', import.meta.url), 'utf8'),
) as Json;
const STORED = projectGraphForPersistence(structuredClone(GRAPH)) as Json;
const HASH = computeAnalysisAffectingGraphHash(STORED as never)!;
const SCENARIO_ID = randomUUID();
const OUTCOME = 'incremental_platform_delivery_capacity';
const UNIT = 'GBP/year per engineer';

/** The ONE framing rule (ruling point 3), then the user's source. */
const userToday = (v: number): Json => ({
  ...framedObservedState({ baseline_value: v, unit: UNIT, provenance: 'explicit', plausible_max: v > 1 ? defaultFrameFor(v) : null }, 'human_authority'),
  source: USER_TODAY_SOURCE,
});
const SENIOR = userToday(120000);
const JUNIOR = userToday(65000);

const view = { nodes: STORED.nodes, edges: STORED.edges } as never;
const params = (overrides: Json = {}): Json => ({
  factors: [
    { label: 'Senior engineer salary', link: { to_id: OUTCOME, effect_direction: 'positive' } },
    { label: 'Junior engineer salary', link: { to_id: OUTCOME, effect_direction: 'positive' } },
  ],
  ...overrides,
});

const hold = (p: Json, levels: readonly Json[] = [SENIOR, JUNIOR]): Json => dispatchAddFactorTransaction({
  params: p, userToday: levels, currentGraph: STORED, currentGraphHash: HASH, freshness: 'none', mode: 'live',
  scenarioId: SCENARIO_ID, turnId: 't-propose', requestId: 'r-propose', stage: 'frame',
} as never) as Json;

const confirm = (pending: PendingAction): Json => {
  const read = readGmHeldResume(pending) as Json;
  expect(read.kind, JSON.stringify(read)).toBe('ok');
  return executeGmHeldResume({
    operations: read.operations,
    ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
    ...(read.userToday !== undefined ? { userToday: read.userToday } : {}),
    currentGraph: STORED, currentGraphHash: HASH, freshness: 'none', hasExistingAnalysis: false,
    scenarioId: SCENARIO_ID, turnId: 't-confirm', requestId: 'r-confirm',
  } as never) as Json;
};
const nodeOf = (g: Json, id: string): Json | undefined => (g.nodes as Json[]).find((n) => n.id === id);

describe('PJ-E-FIG — the figure and its frame', () => {
  it('S0: the ruling\'s "user_specified" is not a legal observed-state source; the door\'s literal (the chat-edit one) is', () => {
    expect(ObservedStateV3.safeParse({ ...SENIOR, source: 'user_specified' }).success).toBe(false);
    expect(ObservedStateV3.safeParse(SENIOR).success).toBe(true);
    expect(USER_TODAY_SOURCE).toBe(USER_EDIT_SOURCE);
  });

  it('S1: £120,000 and £65,000 frame exactly as the ruling says, on Olumi\'s default range, as the user\'s', () => {
    expect(SENIOR).toEqual({ value: 0.12, raw_value: 120000, cap: 1000000, declared_scale: 'unit_interval', unit: UNIT, source: USER_EDIT_SOURCE });
    expect(JUNIOR).toEqual({ value: 0.65, raw_value: 65000, cap: 100000, declared_scale: 'unit_interval', unit: UNIT, source: USER_EDIT_SOURCE });
    expect(isUserTodayObservedState(SENIOR)).toBe(true);
    expect(isUserTodayObservedState(JUNIOR)).toBe(true);
  });

  it('S2: only the user\'s framed figure is a door level — never the brief\'s source, never the illegal literal, never an extra member', () => {
    expect(isUserTodayObservedState({ ...SENIOR, source: 'brief_extraction' })).toBe(false);
    expect(isUserTodayObservedState({ ...SENIOR, source: 'user_specified' })).toBe(false);
    expect(isUserTodayObservedState({ ...SENIOR, provenance: 'user_set' })).toBe(false);
    expect(isUserTodayObservedState({ ...SENIOR, value: 0.5 })).toBe(false);
    expect(isUserTodayObservedState({ value: 120000, source: USER_TODAY_SOURCE })).toBe(false);
  });
});

describe('PJ-E-FIG — the builder (pure)', () => {
  it('B1: every new factor node FIRST ({id, kind, label, category: external} only), then ONE placeholder link each, new factor → target', () => {
    const r = buildAddFactorTransaction(params(), view);
    expect(r.matched, JSON.stringify(r)).toBe(true);
    if (!r.matched) return;
    const { operations, factors } = r.proposal;
    expect(factors.map((f) => f.id)).toEqual(['fac_senior_engineer_salary', 'fac_junior_engineer_salary']);
    expect(operations.map((o) => o.op)).toEqual(['add_node', 'add_node', 'add_edge', 'add_edge']);
    expect(operations[0]!.value).toEqual({ id: 'fac_senior_engineer_salary', kind: 'factor', label: 'Senior engineer salary', category: 'external' });
    expect(operations[2]).toEqual({ op: 'add_edge', path: `fac_senior_engineer_salary::${OUTCOME}`,
      value: hypothesisEdgeValue('fac_senior_engineer_salary', OUTCOME, 'positive') });
    expect(JSON.stringify(operations)).not.toContain('user_specified');
  });

  it.each([
    ['an option', 'hire_two_senior_engineers'],
    ['the decision', 'decision_ship_the_new_platform'],
    ['a risk', 'budget_cap_breach_risk'],
    ['a lever the options set (controllable factor)', 'annual_salary_spend'],
  ])('B2: a link INTO %s is refused by the builder itself — nothing built', (_what, target) => {
    const r = buildAddFactorTransaction(params({ factors: [{ label: 'Senior engineer salary', link: { to_id: target, effect_direction: 'positive' } }] }), view);
    expect(r).toEqual({ matched: false, reason: 'target_not_allowed' });
  });

  it('B3: an outcome and an observable/external factor are the targets it takes — and NOT the goal (no validator admits factor → goal)', () => {
    const withExternal = { nodes: [...STORED.nodes, { id: 'fac_market_rate', kind: 'factor', label: 'Market rate', category: 'external' }],
      edges: [...STORED.edges, { from: 'fac_market_rate', to: OUTCOME }] } as never;
    expect(buildAddFactorTransaction(params({ factors: [{ label: 'Senior engineer salary', link: { to_id: 'ship_the_new_platform', effect_direction: 'positive' } }] }), withExternal))
      .toEqual({ matched: false, reason: 'target_not_allowed' });
    for (const to of [OUTCOME, 'fac_market_rate']) {
      const r = buildAddFactorTransaction(params({ factors: [{ label: 'Senior engineer salary', link: { to_id: to, effect_direction: 'positive' } }] }), withExternal);
      expect(r.matched, `${to}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it('B4: a label the model already has, a label repeated in the call, no factor, four factors, an unknown target and a dead end are refused', () => {
    const one = (label: string, to = OUTCOME) => ({ label, link: { to_id: to, effect_direction: 'positive' } });
    expect(buildAddFactorTransaction({ factors: [one('Annual salary spend')] }, view)).toEqual({ matched: false, reason: 'factor_label_exists' });
    expect(buildAddFactorTransaction({ factors: [one('Salary'), one('salary')] }, view)).toEqual({ matched: false, reason: 'factor_label_repeated' });
    expect(buildAddFactorTransaction({ factors: [] }, view)).toEqual({ matched: false, reason: 'parameters_invalid' });
    expect(buildAddFactorTransaction({ factors: [one('A'), one('B'), one('C'), one('D')] }, view)).toEqual({ matched: false, reason: 'parameters_invalid' });
    expect(buildAddFactorTransaction({ factors: [one('A', 'nope')] }, view)).toEqual({ matched: false, reason: 'node_not_found' });
    const deadEnd = { nodes: [...STORED.nodes, { id: 'out_morale', kind: 'outcome', label: 'Morale' }], edges: STORED.edges } as never;
    expect(buildAddFactorTransaction({ factors: [one('A', 'out_morale')] }, deadEnd)).toEqual({ matched: false, reason: 'new_factor_unreachable' });
  });
});

describe('PJ-E-FIG — the hold carries the user\'s figures; the confirm lands them in ONE apply', () => {
  it('H1: ONE held pending keyed on the first factor; the ops stay bare (R4); the hold names each factor\'s figure by id', () => {
    const held = hold(params());
    expect(held.kind, JSON.stringify(held.reason ?? held.governing ?? '')).toBe('held');
    expect(held.pendingActions).toHaveLength(1);
    const ip = held.pendingActions[0].action.inline_patch as Json;
    expect(JSON.stringify(ip.operations)).not.toContain('observed_state');
    expect(ip[GM_HELD_USER_TODAY_KEY]).toEqual([
      { factor_id: 'fac_senior_engineer_salary', observed_state: SENIOR },
      { factor_id: 'fac_junior_engineer_salary', observed_state: JUNIOR },
    ]);
    expect(held.factorIds).toEqual(['fac_senior_engineer_salary', 'fac_junior_engineer_salary']);
  });

  it('H2: a door without every figure, or with a figure that is not the user\'s framed one, holds NOTHING', () => {
    expect(hold(params(), [SENIOR])).toEqual(expect.objectContaining({ kind: 'refused', reason: 'today_invalid' }));
    expect(hold(params(), [SENIOR, { ...JUNIOR, source: 'brief_extraction' }])).toEqual(expect.objectContaining({ kind: 'refused', reason: 'today_invalid' }));
    expect(hold(params(), [SENIOR, { ...JUNIOR, source: 'user_specified' }])).toEqual(expect.objectContaining({ kind: 'refused', reason: 'today_invalid' }));
  });

  it('H3 (PJ-E-FIG oracle): confirm → both factors land with raw 120000 / 65000 as the user\'s, each with ONE placeholder link; the spend and the limit are untouched', () => {
    const held = hold(params());
    const out = confirm(held.pendingActions[0]);
    expect(out.status, JSON.stringify(out)).toBe('executed');
    const g = out.mutatedGraph as Json;
    expect(nodeOf(g, 'fac_senior_engineer_salary')!.observed_state).toEqual(SENIOR);
    expect(nodeOf(g, 'fac_junior_engineer_salary')!.observed_state).toEqual(JUNIOR);
    expect(nodeOf(g, 'fac_senior_engineer_salary')!.observed_state.raw_value).toBe(120000);
    expect(nodeOf(g, 'fac_junior_engineer_salary')!.observed_state.raw_value).toBe(65000);
    for (const id of ['fac_senior_engineer_salary', 'fac_junior_engineer_salary']) {
      expect(nodeOf(g, id)!.provenance, 'no node-level authorship beyond the value').toBeUndefined();
      const out1 = (g.edges as Json[]).filter((e) => e.from === id);
      expect(out1).toHaveLength(1);
      expect(out1[0]).toMatchObject({ to: OUTCOME, defaulted: true, provenance: { source: 'cee_hypothesis' } });
      expect((g.edges as Json[]).filter((e) => e.to === id)).toHaveLength(0);
    }
    // Key-order-insensitive: the applier may reorder members; the spend node and the limit keep every value.
    expect(nodeOf(g, 'annual_salary_spend')).toEqual(nodeOf(STORED, 'annual_salary_spend'));
    expect(g.goal_constraints).toEqual(STORED.goal_constraints);
  });

  it('H4: the member is FAIL-CLOSED — a malformed or wrong-source member declines the hold (no_payload), never lands the factors valueless', () => {
    const held = hold(params());
    const p = held.pendingActions[0] as PendingAction;
    const withMember = (m: unknown): PendingAction => ({ ...p, action: { ...p.action, inline_patch: {
      ...(p.action as Json).inline_patch, [GM_HELD_USER_TODAY_KEY]: m } } } as PendingAction);
    expect(readGmHeldResume(withMember([{ factor_id: 'fac_senior_engineer_salary', observed_state: { ...SENIOR, source: 'user_specified' } }])).kind).toBe('no_payload');
    expect(readGmHeldResume(withMember([{ factor_id: 'fac_senior_engineer_salary', observed_state: { ...SENIOR, source: 'brief_extraction' } }])).kind).toBe('no_payload');
    expect(readGmHeldResume(withMember('x')).kind).toBe('no_payload');
    expect(readGmHeldResume(withMember([])).kind).toBe('no_payload');
    expect(readUserTodayMember(undefined)).toBeUndefined();
  });

  it('H5: the stamp is bound by IDENTITY — an id the batch does not add as a bare factor refuses the WHOLE batch; a factor-only batch needs no option', () => {
    const r = buildAddFactorTransaction(params(), view);
    if (!r.matched) throw new Error(r.reason);
    const ops = r.proposal.operations;
    const ok = stampNewUserTodayLevels(ops, [{ factor_id: 'fac_senior_engineer_salary', observed_state: SENIOR }]);
    expect(ok.ok).toBe(true);
    expect(stampNewUserTodayLevels(ops, [{ factor_id: 'nope', observed_state: SENIOR }])).toEqual({ ok: false });
    expect(stampNewUserTodayLevels(ops, [{ factor_id: OUTCOME, observed_state: SENIOR }])).toEqual({ ok: false });
    const valued = ops.map((o) => (o.path === 'fac_senior_engineer_salary' ? { ...o, value: { ...(o.value as Json), observed_state: { value: 0.5 } } } : o));
    expect(stampNewUserTodayLevels(valued, [{ factor_id: 'fac_senior_engineer_salary', observed_state: SENIOR }])).toEqual({ ok: false });
    expect(stampNewUserTodayLevels(ops, [
      { factor_id: 'fac_senior_engineer_salary', observed_state: SENIOR }, { factor_id: 'fac_senior_engineer_salary', observed_state: SENIOR },
    ])).toEqual({ ok: false });
  });
});

// ─── the door's own rules are re-run on the graph a hold is CONFIRMED or THREADED against (review finding 1) ─────────
describe('PJ-E-FIG — a hold is re-checked against the graph it lands on, never only the one it was proposed on', () => {
  /** The stored model after a canvas edit: one extra external factor (and its link to the outcome) under `label`. */
  const movedWith = (label: string): Json => ({
    ...STORED,
    nodes: [...(STORED.nodes as Json[]), { id: 'canvas_factor', kind: 'factor', label, category: 'external' }],
    edges: [...(STORED.edges as Json[]), { from: 'canvas_factor', to: OUTCOME, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
  });
  const confirmOn = (pending: PendingAction, g: Json): Json => {
    const read = readGmHeldResume(pending) as Json;
    expect(read.kind, JSON.stringify(read)).toBe('ok');
    return executeGmHeldResume({
      operations: read.operations,
      ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
      ...(read.userToday !== undefined ? { userToday: read.userToday } : {}),
      currentGraph: g, currentGraphHash: computeAnalysisAffectingGraphHash(g as never)!, freshness: 'none', hasExistingAnalysis: false,
      scenarioId: SCENARIO_ID, turnId: 't-confirm', requestId: 'r-confirm',
    } as never) as Json;
  };
  const thread = (pending: PendingAction, g: Json) => threadHoldsThroughMutatingCommit({
    priorPendingActions: [pending], graphAfterCommit: g, graphHashAfterCommit: computeAnalysisAffectingGraphHash(g as never)!,
    appliedOperations: [], nowMs: Date.now(), scenarioId: SCENARIO_ID, turnId: 't-canvas', requestId: 'r-canvas',
  });

  it('R1 RED: the confirm refuses the WHOLE batch when the model now has a node by a new factor\'s name (a second "Senior engineer salary" is never committed); CONTROL: an unrelated new node confirms', () => {
    const held = hold(params());
    const p = held.pendingActions[0] as PendingAction;
    const moved = movedWith('Senior engineer salary');
    const movedBytes = JSON.stringify(moved);
    const dup = confirmOn(p, moved);
    expect(dup.status, JSON.stringify(dup)).not.toBe('executed');
    expect(dup).toEqual({ status: 'apply_failed', reason: 'apply_error' });
    // C3 (DL on #2235): the refused confirm leaves the graph it was HANDED byte-identical — never a node or link pushed
    // into `currentGraph` in place (the caller's object is the persisted authority it re-reads).
    expect(JSON.stringify(moved), 'the input graph is untouched by a refused confirm').toBe(movedBytes);
    const ok = confirmOn(p, movedWith('Office rent'));
    expect(ok.status, JSON.stringify(ok)).toBe('executed');
    expect((ok.mutatedGraph.nodes as Json[]).filter((n) => n.label === 'Senior engineer salary')).toHaveLength(1);
  });

  it('R2 RED: a mutating commit that adds a node by a new factor\'s name LAPSES the hold (with the notice), never re-pins it; CONTROL: an unrelated add re-pins it', () => {
    const p = hold(params()).pendingActions[0] as PendingAction;
    const dup = thread(p, movedWith('senior engineer  salary'));
    expect(dup.threaded, 'the hold is not carried to the moved graph').toEqual([]);
    expect(dup.lapsed.map((l) => l.detail)).toEqual(['held_batch_invalid_post_mutation']);
    expect(dup.notice).toMatch(/has lapsed because the model changed/);
    const ok = thread(p, movedWith('Office rent'));
    expect(ok.lapsed).toEqual([]);
    expect(ok.threaded).toHaveLength(1);
    expect(ok.threaded[0]!.preconditions.graph_hash).toBe(computeAnalysisAffectingGraphHash(movedWith('Office rent') as never));
  });

  it('R3: every OTHER hold is untouched by the re-check — an add-risk-shaped hold without the member threads onto the same duplicate-name graph as before', () => {
    const p = hold(params()).pendingActions[0] as PendingAction;
    const ip = { ...(p.action as Json).inline_patch };
    delete ip[GM_HELD_USER_TODAY_KEY];
    const bare = { ...p, action: { ...p.action, inline_patch: ip } } as PendingAction;
    expect(thread(bare, movedWith('Senior engineer salary')).threaded).toHaveLength(1);
  });
});

// ─── consent-all ("all of them"): each hold's own figures reach ITS step of the ONE commit ───────────────────────────
let pendingActionsForRead: readonly PendingAction[] = [];
const appendCalls: Array<Record<string, unknown>> = [];

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    loadGraph: async () => structuredClone(STORED),
    loadGraphAndBriefText: async () => ({ graph: structuredClone(STORED), briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return { kind: 'message', source: 'composer', turn_id: `t-${randomUUID()}`, scenario_id: SCENARIO_ID, message, turn_class: 'decide', stage: 'analyse' };
}

describe('PJ-E-FIG — consent-all ("Yes, all of them.") over two live add-factor holds', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
    _resetConfigCache();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  it('C1: the ONE commit carries EACH hold\'s figure on its own factor, read from its own member — never a factor landed valueless', async () => {
    const one = (label: string) => ({ factors: [{ label, link: { to_id: OUTCOME, effect_direction: 'positive' } }] });
    const senior = hold(one('Senior engineer salary'), [SENIOR]).pendingActions[0] as PendingAction;
    const junior = hold(one('Junior engineer salary'), [JUNIOR]).pendingActions[0] as PendingAction;
    pendingActionsForRead = [senior, junior];

    await runTurnExecutor(payload('Yes, all of them.'), 'req-pj-e-fig-consent-all', {
      routingAdapter: {
        chatWithTools: vi.fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
          .mockImplementation(async () => { throw new Error('routing adapter must NOT be called on a deterministic consent-all resume'); }),
      },
    });

    const commits = appendCalls.filter((w) => w.graph !== undefined && w.graph !== null);
    expect(commits, JSON.stringify(appendCalls.map((w) => w.assistantMessage))).toHaveLength(1);
    const g = commits[0]!.graph as Json;
    expect(nodeOf(g, 'fac_senior_engineer_salary')?.observed_state).toEqual(SENIOR);
    expect(nodeOf(g, 'fac_junior_engineer_salary')?.observed_state).toEqual(JUNIOR);
  });
});

describe('DL ruling on #2235: the hold records WHY each figure is the user\'s — read back FAIL-CLOSED', () => {
  const os = { value: 0.12, raw_value: 120000, cap: 1000000, declared_scale: 'unit_interval', unit: 'GBP/year', source: 'user_override' };
  it('a pairing confirmed on the card carries the quote it showed; written_about and no record still read as before', () => {
    const quote = 'Record them as annual salaries: £120,000 per senior engineer and £65,000 per junior engineer.';
    expect(readUserTodayMember([{ factor_id: 'f1', observed_state: os, basis: 'confirmed_by_approval', quote }]))
      .toEqual([{ factor_id: 'f1', observed_state: os, basis: 'confirmed_by_approval', quote }]);
    expect(readUserTodayMember([{ factor_id: 'f1', observed_state: os, basis: 'written_about', quote }])?.[0]?.basis).toBe('written_about');
    expect(readUserTodayMember([{ factor_id: 'f1', observed_state: os }])).toEqual([{ factor_id: 'f1', observed_state: os }]);
  });
  it('RED: a confirmation with NO quote shown, an unknown basis, or an empty quote is a hold nothing can execute', () => {
    expect(readUserTodayMember([{ factor_id: 'f1', observed_state: os, basis: 'confirmed_by_approval' }])).toBeUndefined();
    expect(readUserTodayMember([{ factor_id: 'f1', observed_state: os, basis: 'user_said_so', quote: 'x' }])).toBeUndefined();
    expect(readUserTodayMember([{ factor_id: 'f1', observed_state: os, basis: 'confirmed_by_approval', quote: '  ' }])).toBeUndefined();
  });
});

describe('R11 × #2235: the committed node keeps HOW its figure became the user\'s', () => {
  const os = { value: 0.12, raw_value: 120000, cap: 1000000, declared_scale: 'unit_interval', unit: 'GBP/year', source: 'user_override' };
  const ops = () => [{ op: 'add_node', path: 'f1', value: { id: 'f1', kind: 'factor', label: 'Senior engineer salary' } }] as never[];
  it('RED: a pairing CONFIRMED on the card carries its quote into observed_state.reviewed_by_user', () => {
    const quote = 'Record them as annual salaries: £120,000 per senior engineer and £65,000 per junior engineer.';
    const r = stampNewUserTodayLevels(ops(), [{ factor_id: 'f1', observed_state: os, basis: 'confirmed_by_approval', quote }]);
    expect(r.ok).toBe(true);
    const stamped = ((r as { operations: { value: { observed_state: Record<string, unknown> } }[] }).operations[0]!.value.observed_state);
    expect(stamped).toEqual({ ...os, reviewed_by_user: { intent: 'confirm_pairing', quote } });
  });
  it('CONTROL: a figure written about this factor alone (and a legacy member with no record) records nothing', () => {
    for (const extra of [{ basis: 'written_about' as const, quote: '£120k for seniors' }, {}]) {
      const r = stampNewUserTodayLevels(ops(), [{ factor_id: 'f1', observed_state: os, ...extra }]);
      expect(((r as { operations: { value: { observed_state: Record<string, unknown> } }[] }).operations[0]!.value.observed_state)).toEqual(os);
    }
  });
});
