/**
 * ⭐ "ADD TO COMPARISON" IS ONE COMMIT THROUGH THE REAL LEVEL DOOR (DL #72 5887489508 / 5887510885; hash contract DL
 * 5887534233, schemas 0.64.0). Runtime's approval-card path calls `commitOptionLevels` with `adopt_option`; the door
 * checks the base, removes the option's `proposed_by` mark with the canonical writer in memory, scopes the postimage to
 * that one mark, and writes ONE append — or nothing. The adopted option then belongs to the user, and the analysis
 * revision moves (so the Run that excluded it reads stale).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { optionAdoptReadingToken } from '../../../src/orchestrator-v5/system-events/option-adopt-edit.js';

const SCENARIO_ID = '64c5eccc-0000-4000-8000-0000000000a3';
const WORDS = 'Olumi suggests also comparing \u2018£54 Pro release\u2019. Add it to the comparison?';

/** Paul's pricing shape: two user options and £54, which Olumi added and marked (MG #2295, on the option NODE). */
function servedShape(): unknown {
  const g = projectGraphForPersistence({ ...GraphV3.parse({
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: 'price', kind: 'factor', label: 'Pro price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
      { id: 'raise_59', kind: 'option', label: 'Raise to £59', interventions: { price: 0.59 } },
      { id: 'keep_49', kind: 'option', label: 'Keep £49', interventions: { price: 0.49 } },
      { id: 'mod_54', kind: 'option', label: '£54 Pro release', interventions: { price: 0.54 } },
    ],
    edges: [
      { from: 'raise_59', to: 'price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'keep_49', to: 'price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'mod_54', to: 'price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'price', to: 'mrr', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.95, effect_direction: 'positive' },
    ],
  }), options: [] as Array<Record<string, unknown>> }) as { nodes: Array<Record<string, unknown>> };
  // The construction mark rides on the stored bytes (#2295 declares it on NodeV3; set here on the raw stored graph).
  g.nodes = g.nodes.map((n) => (n.id === 'mod_54' ? { ...n, proposed_by: 'olumi' } : n));
  return g;
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


type Node = { id: string; proposed_by?: unknown };
const nodeOf = (id: string): Node => (persisted as { nodes: Node[] }).nodes.find((n) => n.id === id)!;
const baseHash = (): string => computeAnalysisAffectingGraphHash(persisted as never)!;

describe('⭐ "add to comparison" is ONE commit through the real level door', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
  });
  beforeEach(() => {
    persisted = servedShape();
    rows.clear();
  });

  const input = (over: Record<string, unknown> = {}, reading: Record<string, unknown> = {}) => {
    const card = { option_id: 'mod_54', words: WORDS, ...reading };
    const withToken = Object.hasOwn(card, 'reading_token') ? card : { ...card, reading_token: optionAdoptReadingToken(card as never) };
    return { scenario_id: SCENARIO_ID, base_graph_hash: baseHash(), turn_id: 'agent-authorise:adopt-1', links: [], levels: [],
      adopt_option: withToken, ...over } as never;
  };

  it('PRECONDITION: the stored graph carries the mark on £54 only', () => {
    expect(nodeOf('mod_54').proposed_by).toBe('olumi');
    expect(nodeOf('raise_59').proposed_by).toBeUndefined();
  });

  it('ONE WRITE: the approved card removes the mark in ONE append; the reload has it gone and the revision MOVES', async () => {
    const before = baseHash();
    const res = await commitOptionLevelsInProcess(input(), 'req-adopt-1');
    expect(res.status, JSON.stringify(res)).toBe('committed');
    expect(rows.size).toBe(1);
    expect(nodeOf('mod_54').proposed_by).toBeUndefined();
    expect(baseHash()).not.toBe(before);
    expect(res.status === 'committed' ? res.graph_hash : null).toBe(baseHash());
    const facts = ([...rows.values()][0]!.write.handler_facts ?? []) as Array<{ fact_type: string; result: Record<string, unknown> }>;
    expect(facts.map((f) => f.fact_type)).toEqual(['edit_graph']);
    expect(facts[0]!.result).toMatchObject({ edit_kind: 'option_configuration', status: 'applied', rerun_recommended: true,
      graph_hash_before: before, graph_hash_after: baseHash() });
    const message = JSON.stringify([...rows.values()][0]!.write.assistantMessage ?? null);
    expect(message).toContain('confirmed on the card');
  });

  it('NO WRITE: no card shown (no token), or the token of OTHER words, is refused at the real door', async () => {
    const none = await commitOptionLevelsInProcess(input({}, { reading_token: undefined }), 'req-adopt-2');
    expect(none).toMatchObject({ status: 'refused', reason: 'adopt_reading_not_confirmed' });
    const other = optionAdoptReadingToken({ option_id: 'mod_54', words: 'Yes, add it.' });
    const res = await commitOptionLevelsInProcess(input({}, { reading_token: other }), 'req-adopt-3');
    expect(res).toMatchObject({ status: 'refused', reason: 'adopt_reading_not_confirmed' });
    expect(rows.size).toBe(0);
    expect(nodeOf('mod_54').proposed_by).toBe('olumi');
  });

  it('NO SECOND WRITE: the same card pressed again after it committed writes nothing', async () => {
    const card = input();
    expect((await commitOptionLevelsInProcess(card, 'req-adopt-4')).status).toBe('committed');
    const after = JSON.stringify(persisted);
    const again = await commitOptionLevelsInProcess({ ...(card as object), turn_id: 'agent-authorise:adopt-2' } as never, 'req-adopt-5');
    expect(again.status).not.toBe('committed');
    expect(rows.size).toBe(1);
    expect(JSON.stringify(persisted)).toBe(after);
  });

  it('NO WRITE: the user\'s own option is never "adopted" (nothing to adopt)', async () => {
    const res = await commitOptionLevelsInProcess(input({}, { option_id: 'raise_59' }), 'req-adopt-6');
    expect(res).toMatchObject({ status: 'refused', reason: 'adopt_not_proposed' });
    expect(rows.size).toBe(0);
  });

  it('NO WRITE: an unknown option id is refused', async () => {
    const res = await commitOptionLevelsInProcess(input({}, { option_id: 'gone' }), 'req-adopt-7');
    expect(res).toMatchObject({ status: 'refused', reason: 'adopt_option_not_found' });
    expect(rows.size).toBe(0);
  });

  it('never half of a mixed approval: with a level it is refused whole', async () => {
    const res = await commitOptionLevelsInProcess(input({ levels: [{ option_id: 'raise_59', factor_id: 'price', value: 0.6, author: 'user_specified' }] }), 'req-adopt-8');
    expect(res.status).toBe('refused');
    expect(rows.size).toBe(0);
  });

  it('a stale base is `stale` and writes nothing', async () => {
    const res = await commitOptionLevelsInProcess(input({ base_graph_hash: 'f'.repeat(64) }), 'req-adopt-9');
    expect(res.status).toBe('stale');
    expect(rows.size).toBe(0);
  });
});
