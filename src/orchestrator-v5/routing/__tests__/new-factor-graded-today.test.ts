/**
 * ⭐ PJ-A1 £49 — A NEW GRADED FACTOR ENTERS THE MODEL WITH ITS STATUS-QUO LEVEL, WHEN THE USER STATED IT, IN THE SAME
 * COMMIT AS THE OPTION (DL #70 5860365834; AIQ 5860384275 / 5860839793).
 *
 * WIRE (DL run pj-20260927T223136Z, journey A): "£59 for new Pro customers; grandfather existing customers" minted the
 * NEW graded factor `fac_new_pro_customer_price` with no `observed_state`; ISL defaulted it to 0 and named it in
 * GOAL_ANCESTOR_DATA_GAP, so the status quo was measured from £0. The user's brief says "from £49 to £59".
 *
 * THE CARRIER mirrors A1's switch: the Agent's in-process context → the typed dispatch records `graded_today` on the hold
 * (never read from `parameters`) → the confirm stamps it into the factor's `add_node`, after the re-referee, before the
 * apply (`stampNewGradedTodayLevels`) → ONE commit. The level is exactly what admission writes for a baseline the brief
 * states (`framedObservedState`, `brief_extraction`).
 *
 * FIXTURE: Paul's persisted graph for scenario a295e4a1 without its grandfathering transaction (see `_provenance`), the
 * same base A1's rows use. Every row runs the REAL builder, dispatch/referee hold, `readGmHeldResume` and
 * `executeGmHeldResume`; the consent-all row runs the REAL turn executor.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import type { PendingAction } from '../../session/pending-action.js';

import {
  buildAddOptionsTransaction,
  GM_HELD_GRADED_TODAY_KEY,
  GM_HELD_SWITCH_FACTORS_KEY,
  readGradedTodayMember,
  stampNewGradedTodayLevels,
  stampNewSwitchFactors,
} from '../add-option-transaction.js';
import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { checkPersistedGraphInvariants } from '../../persisted-graph-invariants.js';
import { deriveInferredValues } from '../../coaching/inferred-value-disclosure.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { framedObservedState, defaultFrameFor } from '../../agent-lane/admit-model.js';
import { _resetConfigCache } from '../../../config/index.js';

type Json = Record<string, any>;

const FX = JSON.parse(
  readFileSync(new URL('./fixtures/paul-a295e4a1-before-grandfathering.json', import.meta.url), 'utf8'),
) as Json;
const { _provenance: _p, ...GRAPH } = FX;
const STORED = projectGraphForPersistence(structuredClone(GRAPH)) as Json;
const HASH = computeAnalysisAffectingGraphHash(STORED as never)!;
const BASE = JSON.parse(
  readFileSync(new URL('./fixtures/a1-base-contrast-770a477c.json', import.meta.url), 'utf8'),
) as { specs: Record<string, Json> };

const SCENARIO_ID = randomUUID();
const OPT = 'np570001';
const FAC = 'fac_new_pro_customer_price';
const LABEL = 'New Pro customer price';
const SWITCH_FAC = 'fac_existing_customers_grandfathered';

/** Today's £49 exactly as admission writes a baseline the brief states — by the one framer, on its default range. */
const STATED = framedObservedState({ baseline_value: 49, unit: 'GBP per month', provenance: 'explicit', plausible_max: defaultFrameFor(59) });

/** The Agent's graded add: the price at £57 (a distinct choice) and the NEW graded factor it acts on, with no level. */
const GRADED_SPEC = (withSwitch = false): Json => ({
  parent_decision_id: 'decision_mrr',
  label: '£57 for new Pro customers',
  option_id: OPT,
  interventions: [
    { factor_id: 'pro_plan_price', value: 0.285, raw_value: 57, unit: 'GBP per month' },
    { factor_key: 'new_pro_customer_price', value: null, source: 'cee_hypothesis' },
    ...(withSwitch ? [{ factor_key: 'existing_customers_grandfathered', value: 1 }] : []),
  ],
  new_factors: [
    { key: 'new_pro_customer_price', label: LABEL, affects: [{ node_id: 'mrr', effect_direction: 'positive' }] },
    ...(withSwitch ? [{ key: 'existing_customers_grandfathered', label: 'Existing customers grandfathered', kind: 'switch',
      affects: [{ node_id: 'monthly_churn', effect_direction: 'negative' }] }] : []),
  ],
});

const hold = (spec: Json, statedTodayLevels?: readonly { label: string; observed_state: Json }[]) => dispatchAddOptionTransaction({
  parameters: spec, currentGraph: STORED, currentGraphHash: HASH, freshness: 'none',
  mode: 'live', scenarioId: SCENARIO_ID, turnId: 't-propose', requestId: 'r-propose', stage: 'decide',
  ...(statedTodayLevels !== undefined ? { statedTodayLevels } : {}),
} as never) as Json;

const confirm = (pending: PendingAction): Json => {
  const read = readGmHeldResume(pending) as Json;
  expect(read.kind).toBe('ok');
  return executeGmHeldResume({
    operations: read.operations,
    ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
    ...(read.switchFactorIds !== undefined ? { switchFactorIds: read.switchFactorIds } : {}),
    ...(read.gradedToday !== undefined ? { gradedToday: read.gradedToday } : {}),
    currentGraph: STORED, currentGraphHash: HASH, freshness: 'none', hasExistingAnalysis: false,
    scenarioId: SCENARIO_ID, turnId: 't-confirm', requestId: 'r-confirm',
  }) as Json;
};

const nodeOf = (g: Json, id: string): Json | undefined => (g.nodes as Json[]).find((n) => n.id === id);

/** JSONB reorders keys: a key-order-insensitive canonical form. */
function canonical(x: unknown): string {
  const sort = (v: unknown): unknown => (Array.isArray(v)
    ? v.map(sort)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Json).sort().map((k) => [k, sort((v as Json)[k])]))
      : v);
  return JSON.stringify(sort(x));
}

describe('PJ-A1 £49 — the level itself', () => {
  it('is the framer\'s own stated-baseline shape: raw 49 kept, on 0–100, brief_extraction', () => {
    expect(STATED).toEqual({ value: 0.49, raw_value: 49, cap: 100, declared_scale: 'unit_interval', unit: 'GBP per month', source: 'brief_extraction' });
  });
});

describe('PJ-A1 £49 — the hold names the stated today level; the wire never can', () => {
  it('RED: the Agent\'s in-process level for the batch\'s new GRADED factor → the hold records it by id; the factor op stays bare (R4)', () => {
    const held = hold(GRADED_SPEC(), [{ label: LABEL, observed_state: STATED }]);
    expect(held.kind, JSON.stringify(held.reason ?? held.governing ?? '')).toBe('held');
    const ip = held.pendingActions[0].action.inline_patch as Json;
    expect(ip[GM_HELD_GRADED_TODAY_KEY]).toEqual([{ factor_id: FAC, observed_state: STATED }]);
    expect((ip.operations as Json[]).find((o) => o.op === 'add_node' && o.path === FAC)!.value)
      .toEqual({ id: FAC, kind: 'factor', label: LABEL, category: 'controllable' });
    expect((readGmHeldResume(held.pendingActions[0]) as Json).gradedToday).toEqual([{ factor_id: FAC, observed_state: STATED }]);
  });

  it('CONTRAST: no level (or an empty list) → no member, and the hold is byte-identical to one minted with no context at all', () => {
    const plain = hold(GRADED_SPEC());
    const empty = hold(GRADED_SPEC(), []);
    const strip = (h: Json) => { const { candidate_id: _c, ...rest } = h.pendingActions[0].action.inline_patch as Json; return canonical(rest); };
    expect((plain.pendingActions[0].action.inline_patch as Json)[GM_HELD_GRADED_TODAY_KEY]).toBeUndefined();
    expect(strip(empty)).toBe(strip(plain));
  });

  it.each([
    ['a label this batch does not add', [{ label: 'Pro plan price', observed_state: STATED }]],
    ['the batch\'s SWITCH (its today is Olumi\'s off)', [{ label: 'Existing customers grandfathered', observed_state: STATED }]],
    ['Olumi\'s estimate, not a stated level', [{ label: LABEL, observed_state: { ...STATED, source: 'cee_inference' } }]],
    ['a bare amount with no range', [{ label: LABEL, observed_state: { value: 49, source: 'brief_extraction' } }]],
    ['a frame that does not hold its own figure', [{ label: LABEL, observed_state: { ...STATED, value: 0.5 } }]],
    ['an extra member riding along', [{ label: LABEL, observed_state: { ...STATED, extractionType: 'explicit' } }]],
  ])('CONTRAST: %s → never recorded', (_name, levels) => {
    const held = hold(GRADED_SPEC(true), levels as never);
    expect(held.kind).toBe('held');
    const ip = held.pendingActions[0].action.inline_patch as Json;
    expect(ip[GM_HELD_GRADED_TODAY_KEY]).toBeUndefined();
    expect(ip[GM_HELD_SWITCH_FACTORS_KEY]).toEqual([SWITCH_FAC]);
  });

  it('J2 AT THE WIRE: a client that puts a today level in `new_factors` (strict) is refused by the builder — never read, never held', () => {
    for (const extra of [{ today: { value: 49, unit: 'GBP' } }, { observed_state: STATED }]) {
      const spec = GRADED_SPEC();
      spec.new_factors[0] = { ...spec.new_factors[0], ...extra };
      expect(buildAddOptionsTransaction(spec, STORED as never)).toEqual(expect.objectContaining({ matched: false, reason: 'parameters_invalid' }));
    }
  });
});

describe('PJ-A1 £49 — the confirm writes it in the SAME apply as the option', () => {
  it('RED: after the confirm the factor holds today\'s £49 as the user\'s (brief_extraction), framed; the option and links land with it', () => {
    const held = hold(GRADED_SPEC(true), [{ label: LABEL, observed_state: STATED }]);
    const executed = confirm(held.pendingActions[0]);
    expect(executed.status, JSON.stringify(executed.reason ?? '')).toBe('executed');
    const factor = nodeOf(executed.mutatedGraph, FAC)!;
    expect(factor.observed_state).toEqual(STATED);
    // The option's own level on it is untouched: that is its own write.
    expect(nodeOf(executed.mutatedGraph, OPT)!.interventions[FAC]).toBeUndefined();
    expect(nodeOf(executed.mutatedGraph, OPT)!.interventions.pro_plan_price).toMatchObject({ value: 0.285, raw_value: 57 });
    // CONTRAST, same commit: the switch is exactly A1's today-0, Olumi's.
    expect(nodeOf(executed.mutatedGraph, SWITCH_FAC)!.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    const edges = (executed.mutatedGraph.edges as Json[]).map((e) => `${e.from}->${e.to}`);
    for (const e of [`decision_mrr->${OPT}`, `${OPT}->${FAC}`, `${FAC}->mrr`]) expect(edges).toContain(e);
    const projected = projectGraphForPersistence(structuredClone(executed.mutatedGraph)) as Json;
    expect(checkPersistedGraphInvariants(projected, { baseGraph: STORED }).status).not.toBe('violated');
  });

  it('CONTRAST: the same hold with no level → the factor lands valueless (never 0), as before', () => {
    const executed = confirm(hold(GRADED_SPEC()).pendingActions[0]);
    expect(executed.status).toBe('executed');
    expect(nodeOf(executed.mutatedGraph, FAC)!.observed_state).toBeUndefined();
  });

  it('it is the USER\'s value: never counted in "I supplied N values"; and a later correction lands through the value writer as theirs', async () => {
    const executed = confirm(hold(GRADED_SPEC(), [{ label: LABEL, observed_state: STATED }]).pendingActions[0]);
    expect(deriveInferredValues(executed.mutatedGraph).map((r) => r.factor_id)).not.toContain(FAC);
    const payload = { kind: 'system_event', scenario_id: SCENARIO_ID, turn_id: 't-edit', stage: 'frame',
      // The editor's own shape for a framed factor (`forward-direct-manipulation.test.ts`): the value on the frame, the figure kept.
      event: { kind: 'factor_value_edit', target_id: FAC, value: 0.52, raw_value: 52, unit: 'GBP per month' } } as Json;
    const out = await applyFactorValueEdit({ payload: payload as never, event: payload.event as never, requestId: 'r-edit',
      persistedGraph: executed.mutatedGraph, priorFacts: [] }) as Json;
    expect(out.kind, JSON.stringify(out.reason ?? '')).toBe('mutated');
    const edited = nodeOf(out.mutatedGraph, FAC)!.observed_state;
    expect(edited).toMatchObject({ value: 0.52, raw_value: 52 });
    expect(String(edited.source)).toMatch(/^user/);
  });

  it('a malformed hold member is NO signal: the batch still lands whole, the factor valueless — never a guessed value', () => {
    const held = hold(GRADED_SPEC());
    const pending = structuredClone(held.pendingActions[0]) as Json;
    for (const bad of [[{ factor_id: FAC, observed_state: { value: 49 } }], [{ factor_id: '', observed_state: STATED }], 'x', [], [
      { factor_id: FAC, observed_state: STATED }, { factor_id: FAC, observed_state: STATED }]]) {
      pending.action.inline_patch[GM_HELD_GRADED_TODAY_KEY] = bad;
      const read = readGmHeldResume(pending as PendingAction) as Json;
      expect(read.kind).toBe('ok');
      expect(read.gradedToday, JSON.stringify(bad)).toBeUndefined();
    }
    expect(readGradedTodayMember([{ factor_id: FAC, observed_state: STATED }])).toEqual([{ factor_id: FAC, observed_state: STATED }]);
  });
});

describe('PJ-A1 £49 — stampNewGradedTodayLevels is fail-closed and by identity', () => {
  const ops = () => (hold(GRADED_SPEC(true)).pendingActions[0].action.inline_patch as Json).operations as Json[];

  it('stamps exactly the named factor\'s add_node, and nothing else; no levels → unchanged', () => {
    const before = ops();
    const r = stampNewGradedTodayLevels(before as never, [{ factor_id: FAC, observed_state: STATED }]) as Json;
    expect(r.ok).toBe(true);
    expect(r.operations.filter((o: Json, i: number) => canonical(o) !== canonical(before[i])).map((o: Json) => o.path)).toEqual([FAC]);
    expect(canonical(before), 'the input is never mutated').toBe(canonical(ops()));
    expect(stampNewGradedTodayLevels(before as never, [])).toEqual({ ok: true, operations: before });
  });

  it.each([
    ['a factor this batch does not add', [{ factor_id: 'pro_plan_price', observed_state: STATED }]],
    ['the same factor twice', [{ factor_id: FAC, observed_state: STATED }, { factor_id: FAC, observed_state: STATED }]],
    ['a level that is not a stated one', [{ factor_id: FAC, observed_state: { ...STATED, source: 'user_specified' } }]],
  ])('refuses %s', (_name, levels) => {
    expect(stampNewGradedTodayLevels(ops() as never, levels as never)).toEqual({ ok: false });
  });

  it('refuses a factor already valued in this apply — the switch, once its today-0 is stamped', () => {
    const switched = stampNewSwitchFactors(ops() as never, [SWITCH_FAC]) as Json;
    expect(switched.ok).toBe(true);
    expect(stampNewGradedTodayLevels(switched.operations, [{ factor_id: SWITCH_FAC, observed_state: STATED }])).toEqual({ ok: false });
  });

  it('refuses a factor no option in this batch links to', () => {
    const cut = ops().filter((o) => !(o.op === 'add_edge' && o.path === `${OPT}::${FAC}`));
    expect(stampNewGradedTodayLevels(cut as never, [{ factor_id: FAC, observed_state: STATED }])).toEqual({ ok: false });
  });

  it('a hold naming a level its batch cannot take is declined WHOLE by the confirm — nothing applied', () => {
    const held = hold(GRADED_SPEC());
    const pending = structuredClone(held.pendingActions[0]) as Json;
    pending.action.inline_patch[GM_HELD_GRADED_TODAY_KEY] = [{ factor_id: 'pro_plan_price', observed_state: STATED }];
    expect(confirm(pending as PendingAction)).toEqual(expect.objectContaining({ status: 'apply_failed', reason: 'apply_error' }));
  });
});

// ─── consent-all ("all of them"): each hold's own member reaches ITS step of the ONE commit ─────────────────────────
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
    storeDraftGraph: async () => undefined,
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

describe('PJ-A1 £49 — consent-all ("Yes, all of them.") over two live GM holds', () => {
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

  it('RED: the ONE commit carries the SECOND hold\'s stated £49 on its new graded factor, read from its own member', async () => {
    const graded = hold(structuredClone(BASE.specs.existing!)).pendingActions[0] as PendingAction;
    const withToday = hold(GRADED_SPEC(), [{ label: LABEL, observed_state: STATED }]).pendingActions[0] as PendingAction;
    expect(((graded.action as Json).inline_patch as Json)[GM_HELD_GRADED_TODAY_KEY]).toBeUndefined();
    expect(((withToday.action as Json).inline_patch as Json)[GM_HELD_GRADED_TODAY_KEY]).toEqual([{ factor_id: FAC, observed_state: STATED }]);
    pendingActionsForRead = [graded, withToday];

    await runTurnExecutor(payload('Yes, all of them.'), 'req-pj-a1-consent-all', {
      routingAdapter: {
        chatWithTools: vi.fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
          .mockImplementation(async () => { throw new Error('routing adapter must NOT be called on a deterministic consent-all resume'); }),
      },
    });

    const commits = appendCalls.filter((w) => w.graph !== undefined && w.graph !== null);
    expect(commits, JSON.stringify(appendCalls.map((w) => w.assistantMessage))).toHaveLength(1);
    const g = commits[0]!.graph as Json;
    expect(nodeOf(g, 'opt64')?.interventions?.pro_plan_price).toMatchObject({ value: 0.32, raw_value: 64 });
    expect(nodeOf(g, FAC)?.observed_state).toEqual(STATED);
  });
});
