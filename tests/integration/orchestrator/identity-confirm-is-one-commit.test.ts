/**
 * ⭐ A USER-CONFIRMED PRODUCT IS ONE COMMIT THROUGH THE REAL LEVEL DOOR (DL #72 5887510885; contract Canonical
 * 5887564539). Runtime's approval-card path calls `commitOptionLevels` with `identity_confirm`; the door checks the base,
 * writes the carrier with the canonical writer in memory, scopes the postimage to that one carrier, and writes ONE append
 * — or nothing. The rows the DL asked for: no card / other words → NO write; the approved card → ONE write whose reload
 * carries the user's carrier and a new revision; the same card pressed again → no second write.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { identityConfirmReadingToken } from '../../../src/orchestrator-v5/system-events/identity-confirm-edit.js';

const SCENARIO_ID = '64c5eccc-0000-4000-8000-0000000000f2';
const WORDS = 'MRR is Pro plan price times Pro subscribers.';

/** Paul's served shape with NO identity (R3's 4/5): both inputs feed MRR, and nothing says it multiplies. */
function servedShape(carrier?: Record<string, unknown>): unknown {
  return projectGraphForPersistence({ ...GraphV3.parse({
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR', ...(carrier !== undefined ? { nonlinear_identity: carrier } : {}) },
      { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
      { id: 'subs', kind: 'factor', label: 'Pro subscribers', observed_state: { value: 0.5, raw_value: 5000, cap: 10000, unit: 'subscribers', source: 'cee_inference' } },
      { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.04 } },
    ],
    edges: [
      { from: 'price', to: 'subs', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
      { from: 'price', to: 'mrr', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.95, effect_direction: 'positive' },
      { from: 'subs', to: 'mrr', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.95, effect_direction: 'positive' },
    ],
  }), options: [] as Array<Record<string, unknown>> });
}

let persisted: unknown = servedShape();
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-09-28T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-28T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
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

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));


type Node = { id: string; nonlinear_identity?: unknown };
const nodeOf = (id: string): Node => (persisted as { nodes: Node[] }).nodes.find((n) => n.id === id)!;
const baseHash = (): string => computeAnalysisAffectingGraphHash(persisted as never)!;

describe('⭐ a user-confirmed product is ONE commit through the real level door', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
  });
  beforeEach(() => {
    persisted = servedShape();
    rows.clear();
  });

  /** The approval carries the token of the reading its card SHOWED; here, of exactly the write asked unless overridden. */
  const input = (over: Record<string, unknown> = {}, reading: Record<string, unknown> = {}) => {
    const ic = { outcome_id: 'mrr', factor_ids: ['price', 'subs'], words: WORDS, ...reading };
    const withToken = Object.hasOwn(ic, 'reading_token') ? ic : { ...ic, reading_token: identityConfirmReadingToken(ic as never) };
    return { scenario_id: SCENARIO_ID, base_graph_hash: baseHash(), turn_id: 'agent-authorise:ic-1', links: [], levels: [],
      identity_confirm: withToken, ...over } as never;
  };

  it('ONE WRITE: the approved card commits ONE append; the reload carries the user\'s product and the revision moves', async () => {
    const before = baseHash();
    const res = await commitOptionLevelsInProcess(input(), 'req-ic-1');
    expect(res.status, JSON.stringify(res)).toBe('committed');
    expect(rows.size).toBe(1);
    // The reload is the store's own read-back of the committed bytes.
    expect(nodeOf('mrr').nonlinear_identity).toEqual({ operation: 'product', factor_ids: ['price', 'subs'], stated_in_brief: true });
    const facts = ([...rows.values()][0]!.write.handler_facts ?? []) as Array<{ fact_type: string; result: Record<string, unknown> }>;
    expect(facts.map((f) => f.fact_type)).toEqual(['edit_graph']);
    expect(facts[0]!.result).toMatchObject({ edit_kind: 'structural', status: 'applied', rerun_recommended: true,
      graph_hash_before: before, graph_hash_after: baseHash() });
    expect(baseHash()).not.toBe(before);
    expect(res.status === 'committed' ? res.graph_hash : null).toBe(baseHash());
    // AIQ 5887805333 (a): the committed row keeps the card's words and that they were confirmed on the card.
    const message = JSON.stringify([...rows.values()][0]!.write.assistantMessage ?? null);
    expect(message).toContain('confirmed on the card');
    expect(message).toContain(WORDS);
  });

  it('NO WRITE: an approval with NO reading shown (no token) is refused at the real door', async () => {
    const res = await commitOptionLevelsInProcess(input({}, { reading_token: undefined }), 'req-ic-2');
    expect(res).toMatchObject({ status: 'refused', reason: 'identity_reading_not_confirmed' });
    expect(rows.size).toBe(0);
    expect(nodeOf('mrr').nonlinear_identity).toBeUndefined();
  });

  it('NO WRITE: the card\'s token with OTHER words (or other factors) is refused', async () => {
    const token = identityConfirmReadingToken({ outcome_id: 'mrr', factor_ids: ['price', 'subs'], words: 'Yes, record that.' });
    const other = await commitOptionLevelsInProcess(input({}, { reading_token: token }), 'req-ic-3');
    expect(other).toMatchObject({ status: 'refused', reason: 'identity_reading_not_confirmed' });
    const swapped = identityConfirmReadingToken({ outcome_id: 'mrr', factor_ids: ['price', 'churn'], words: WORDS });
    const factors = await commitOptionLevelsInProcess(input({}, { reading_token: swapped }), 'req-ic-4');
    expect(factors).toMatchObject({ status: 'refused', reason: 'identity_reading_not_confirmed' });
    expect(rows.size).toBe(0);
  });

  it('NO SECOND WRITE: the same card pressed again after it committed (its revision moved) writes nothing', async () => {
    const card = input();
    expect((await commitOptionLevelsInProcess(card, 'req-ic-5')).status).toBe('committed');
    const after = JSON.stringify(persisted);
    const again = await commitOptionLevelsInProcess({ ...(card as object), turn_id: 'agent-authorise:ic-2' } as never, 'req-ic-6');
    expect(again.status).not.toBe('committed');
    expect(rows.size).toBe(1);
    expect(JSON.stringify(persisted)).toBe(after);
  });

  it('NO WRITE: a product construction would not admit (a factor that does not feed MRR) is refused with admission\'s reason', async () => {
    const res = await commitOptionLevelsInProcess(input({}, { factor_ids: ['price', 'churn'] }), 'req-ic-7');
    expect(res).toMatchObject({ status: 'refused', reason: 'identity_not_admissible' });
    expect(rows.size).toBe(0);
    expect(nodeOf('mrr').nonlinear_identity).toBeUndefined();
  });

  it('NO WRITE: a different carrier already on the node is never replaced', async () => {
    persisted = servedShape({ operation: 'sum', factor_ids: ['price', 'subs'], stated_in_brief: false });
    const res = await commitOptionLevelsInProcess(input(), 'req-ic-8');
    expect(res).toMatchObject({ status: 'refused', reason: 'identity_carrier_conflict' });
    expect(rows.size).toBe(0);
  });

  it('CONFIRMS OLUMI\'S READING: the same product held as Olumi\'s becomes the user\'s, in ONE write', async () => {
    persisted = servedShape({ operation: 'product', factor_ids: ['subs', 'price'], stated_in_brief: false });
    const before = baseHash();
    const res = await commitOptionLevelsInProcess(input(), 'req-ic-9');
    expect(res.status, JSON.stringify(res)).toBe('committed');
    expect(nodeOf('mrr').nonlinear_identity).toEqual({ operation: 'product', factor_ids: ['subs', 'price'], stated_in_brief: true });
    expect(baseHash()).not.toBe(before);
  });

  it('NO WRITE: the user\'s own identical product is already carried', async () => {
    persisted = servedShape({ operation: 'product', factor_ids: ['price', 'subs'], stated_in_brief: true });
    const res = await commitOptionLevelsInProcess(input(), 'req-ic-10');
    expect(res).toMatchObject({ status: 'refused', reason: 'identity_already_carried' });
    expect(rows.size).toBe(0);
  });

  it('never half of a mixed approval: with a level it is refused whole', async () => {
    const res = await commitOptionLevelsInProcess(input({ levels: [{ option_id: 'opt', factor_id: 'price', value: 0.59, author: 'user_specified' }] }), 'req-ic-11');
    expect(res.status).toBe('refused');
    expect(rows.size).toBe(0);
  });

  it('a stale base is `stale` and writes nothing', async () => {
    const res = await commitOptionLevelsInProcess(input({ base_graph_hash: 'f'.repeat(64) }), 'req-ic-12');
    expect(res.status).toBe('stale');
    expect(rows.size).toBe(0);
  });
});
