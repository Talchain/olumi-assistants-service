/**
 * ⭐ A1 ON THE CONSENT-ALL ROUTE — "all of them" threads each hold's new switches into ITS step of the ONE commit.
 *
 * Independent verification of A1, round 2: deleting the `switchFactorIds` threading in `commitGmHeldResumeAll`
 * (turn-executor, the consent-all path) turned 0 of 72 tests RED. This row pins it through the REAL turn executor.
 *
 * Two live GM holds, both pinned to the same base (Paul's persisted graph, scenario a295e4a1, without the grandfathering
 * transaction — see the fixture's `_provenance`):
 *   1. "Increase price to £64" — graded, on the existing `pro_plan_price` (no switch; its hold names none);
 *   2. Paul's grandfathering add, the new factor declared a SWITCH (its hold names it under `switch_factors`).
 * The user says "Yes, all of them.". The ONE commit must carry the switch's today-0 as Olumi's (`cee_inference`) and the
 * option at level 1. Without the threading, the second step's confirm is not told about the switch, so the factor lands
 * with no today value — RED. The switch hold is SECOND on purpose: its step runs against the working graph the first
 * step produced, and it must read its OWN hold's member (`reads[i]`), never the first hold's.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import type { PendingAction } from '../../session/pending-action.js';

import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { GM_HELD_SWITCH_FACTORS_KEY } from '../add-option-transaction.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
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
const OPT = '146aa89d';
const FAC = 'fac_existing_customers_grandfathered';

/** Paul's grandfathering add as the Agent now sends it (the same spec as `new-factor-switch-a1.test.ts` SWITCH_SPEC). */
const SWITCH_SPEC = (): Json => ({
  parent_decision_id: 'decision_mrr',
  label: '£59 for new Pro customers; grandfather existing customers',
  option_id: OPT,
  interventions: [
    { factor_id: 'pro_plan_price', value: 0.295, raw_value: 59, unit: 'GBP per month' },
    { factor_key: 'existing_customers_grandfathered', value: 1, source: 'cee_hypothesis' },
  ],
  new_factors: [{
    key: 'existing_customers_grandfathered',
    label: 'Existing customers grandfathered',
    kind: 'switch',
    affects: [
      { node_id: 'monthly_churn', effect_direction: 'negative' },
      { node_id: 'mrr', effect_direction: 'negative' },
    ],
  }],
});

/** The real typed dispatch's hold (referee-gated), exactly as route-v2 persists it. */
const holdOf = (spec: Json): PendingAction => {
  const held = dispatchAddOptionTransaction({
    parameters: spec, currentGraph: STORED, currentGraphHash: HASH, freshness: 'none',
    mode: 'live', scenarioId: SCENARIO_ID, turnId: 't-propose', requestId: 'r-propose', stage: 'decide',
  } as never) as Json;
  expect(held.kind, JSON.stringify(held.reason ?? held.governing ?? '')).toBe('held');
  expect(held.pendingActions).toHaveLength(1);
  return held.pendingActions[0] as PendingAction;
};

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
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on a deterministic consent-all resume');
      }),
  };
}

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

describe('A1 — consent-all ("all of them") over two live GM holds, one of them Paul\'s switch add', () => {
  it('RED: the ONE commit carries the switch\'s today-0 as Olumi\'s (cee_inference) and 146aa89d at level 1', async () => {
    const graded = holdOf(structuredClone(BASE.specs.existing!));
    const sw = holdOf(SWITCH_SPEC());
    // Preconditions: two distinct live holds on the same base; ONLY the switch hold names its switch.
    expect(graded.chip_id).not.toBe(sw.chip_id);
    expect(graded.preconditions.graph_hash).toBe(HASH);
    expect(sw.preconditions.graph_hash).toBe(HASH);
    expect((graded.action as Json).inline_patch[GM_HELD_SWITCH_FACTORS_KEY]).toBeUndefined();
    expect((sw.action as Json).inline_patch[GM_HELD_SWITCH_FACTORS_KEY]).toEqual([FAC]);
    pendingActionsForRead = [graded, sw];

    await runTurnExecutor(payload('Yes, all of them.'), 'req-a1-consent-all', {
      routingAdapter: throwingRoutingAdapter(),
    });

    // ONE commit, carrying both holds.
    const commits = appendCalls.filter((w) => w.graph !== undefined && w.graph !== null);
    expect(commits, JSON.stringify(appendCalls.map((w) => w.assistantMessage))).toHaveLength(1);
    const g = commits[0]!.graph as Json;
    const node = (id: string): Json | undefined => (g.nodes as Json[]).find((n) => n.id === id);
    expect(node('opt64')?.interventions?.pro_plan_price).toMatchObject({ value: 0.32, raw_value: 64 });
    // The switch: off today, Olumi's reading, through the value writer's own members — and on under the option.
    expect(node(FAC)?.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    expect(node(FAC)?.provenance).toBe('ai_inferred');
    expect(node(OPT)?.interventions?.[FAC]).toMatchObject({ value: 1, source: 'cee_hypothesis' });
  });
});
