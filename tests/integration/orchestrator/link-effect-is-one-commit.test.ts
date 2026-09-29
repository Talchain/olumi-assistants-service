/**
 * ⭐ ONE USER-STATED LINK EFFECT IS ONE COMMIT THROUGH THE REAL LEVEL DOOR (Canonical #72 5882780438 / 5882965890 /
 * 5882989451). Runtime's answer handler calls `commitOptionLevels` with `link_effect`; the door checks the base, sizes the
 * link with the canonical writer in memory, scopes the postimage to that one link, and writes ONE append — or nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { linkEffectEdgeToken, linkEffectReadingToken } from '../../../src/orchestrator-v5/system-events/link-effect-edit.js';

const SCENARIO_ID = '64c5eccc-0000-4000-8000-0000000000e1';

function servedShape(): unknown {
  return projectGraphForPersistence({ ...GraphV3.parse({
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
      { id: 'subs', kind: 'factor', label: 'Pro subscribers', observed_state: { value: 0.5, raw_value: 5000, cap: 10000, unit: 'subscribers', source: 'cee_inference' } },
    ],
    edges: [
      { from: 'price', to: 'subs', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative',
        defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', reasoning: 'Olumi: price sensitivity' } },
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


type Edge = { from: string; to: string; strength: { mean: number; std?: number }; provenance?: Record<string, unknown> };
const edgeOf = (from: string, to: string): Edge => (persisted as { edges: Edge[] }).edges.find((e) => e.from === from && e.to === to)!;
const baseHash = (): string => computeAnalysisAffectingGraphHash(persisted as never)!;

describe('⭐ a user-stated link effect is ONE commit through the real level door', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
  });
  beforeEach(() => {
    persisted = servedShape();
    rows.clear();
  });

  /** The approval carries the token of the reading its card SHOWED (AIQ 5885290014); here, of exactly the write asked. */
  const input = (over: Record<string, unknown> = {}) => {
    const i = {
      scenario_id: SCENARIO_ID, base_graph_hash: baseHash(), turn_id: 'agent-authorise:le-1', links: [], levels: [],
      link_effect: { from: 'price', to: 'subs', effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: '£' },
        edge_token: linkEffectEdgeToken(persisted, 'price', 'subs')!, quote: 'every £1 on the price loses us about 50 subscribers' },
      ...over,
    } as Record<string, any>;
    const le = i.link_effect;
    return (le !== undefined && !Object.hasOwn(le, 'reading_token') ? { ...i, link_effect: { ...le, reading_token: linkEffectReadingToken(le) } } : i) as never;
  };

  it('RED: commits ONE append — the link is the user\'s size, with its natural effect, the quote on the receipt, and the revision moves', async () => {
    const before = baseHash();
    const res = await commitOptionLevelsInProcess(input(), 'req-le-1');
    expect(res.status, JSON.stringify(res)).toBe('committed');
    expect(rows.size).toBe(1);
    const e = edgeOf('price', 'subs');
    expect(e.strength.mean).toBeCloseTo(-0.5, 12);
    expect(e.provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated' });
    expect((e.provenance!.natural_effect as { amount_unit: string }).amount_unit).toBe('subscribers');
    const facts = ([...rows.values()][0]!.write.handler_facts ?? []) as Array<{ fact_type: string; result: { after: { stated_quote?: string } } }>;
    expect(facts.map((f) => f.fact_type)).toEqual(['adjust_edge_strength']);
    expect(facts[0]!.result.after.stated_quote).toBe('every £1 on the price loses us about 50 subscribers');
    expect(res.status === 'committed' ? res.graph_hash : null).toBe(baseHash());
    expect(baseHash()).not.toBe(before);
  });

  it('an approval with NO reading shown (no token) is refused at the real door — `user_stated` is never stamped', async () => {
    const res = await commitOptionLevelsInProcess(input({ link_effect: { from: 'price', to: 'subs',
      effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: '£' },
      edge_token: linkEffectEdgeToken(persisted, 'price', 'subs')!, quote: 'every £1 on the price loses us about 50 subscribers',
      reading_token: undefined } }), 'req-le-6');
    expect(res).toMatchObject({ status: 'refused', reason: 'link_reading_not_confirmed', link: { from: 'price', to: 'subs' } });
    expect(rows.size).toBe(0);
    expect(edgeOf('price', 'subs').strength.mean).toBe(-0.3);
  });

  it('a stale base is `stale` and writes nothing', async () => {
    const res = await commitOptionLevelsInProcess(input({ base_graph_hash: 'f'.repeat(64) }), 'req-le-2');
    expect(res.status).toBe('stale');
    expect(rows.size).toBe(0);
  });

  it('a writer refusal is `refused` with `link_<reason>` naming the link, and writes nothing', async () => {
    const res = await commitOptionLevelsInProcess(input({ link_effect: { from: 'price', to: 'subs',
      effect: { amount: -50, amount_unit: 'customers', per_source_change: 1, per_source_change_unit: '£' },
      edge_token: linkEffectEdgeToken(persisted, 'price', 'subs')!, quote: 'every £1 loses 50 customers' } }), 'req-le-3');
    expect(res).toMatchObject({ status: 'refused', reason: 'link_unit_mismatch', link: { from: 'price', to: 'subs' } });
    expect(rows.size).toBe(0);
    expect(edgeOf('price', 'subs').strength.mean).toBe(-0.3);
  });

  it('the link changed since the ask in a byte the analysis hash does not read (Olumi\'s reasoning) → `link_superseded`, nothing written', async () => {
    const token = linkEffectEdgeToken(persisted, 'price', 'subs')!;
    (edgeOf('price', 'subs').provenance as Record<string, unknown>).reasoning = 'Olumi: revised since the ask';
    const res = await commitOptionLevelsInProcess(input({ link_effect: { from: 'price', to: 'subs',
      effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: '£' }, edge_token: token,
      quote: 'every £1 on the price loses us about 50 subscribers' } }), 'req-le-4');
    expect(res).toMatchObject({ status: 'refused', reason: 'link_superseded' });
    expect(rows.size).toBe(0);
  });

  it('never half of a mixed approval: with a strength set it is refused whole', async () => {
    const res = await commitOptionLevelsInProcess(input({ link_strengths: [{ from: 'subs', to: 'mrr', magnitude: 0.7, intent: 'confirm_current',
      expected: { mean: 0.7, effect_direction: 'positive' }, band: 'strong', author: 'user_specified' }] }), 'req-le-5');
    expect(res.status).toBe('refused');
    expect(rows.size).toBe(0);
  });
});
