/**
 * ⛔ THE LOST £10, END TO END — the permanent regression DL's ledger closes on (#70 5848702999; AI Conversation
 * 5848429576, served 5f941f2 `bf5-ui-ATOMIC-cd6a82e4-5f941f2-1740` turns[3]→[4]).
 *
 * The user typed "it sets Paid AI add-on price to £10 per month" for an option acting on a NEW factor with no value,
 * range or unit. One approval stored `{value: 0.1, source: cee_hypothesis}` — no raw value, no unit — and the canvas
 * read "0.1 · Olumi estimate". This drives the Agent's OWN propose → approve through the REAL in-process door
 * (`commitOptionLevelsInProcess`, CEE #2024) into the persisted graph, and asserts: ONE commit, the hash moves, the
 * version receipt, the persisted cell (the user's 10, "£ per month", its range, `user_specified`), the Agent's
 * read-back, and the narration the user reads.
 *
 * Known-bad control: RED with #2025's src reverted to #2024 (the cell is `cee_hypothesis`, without raw_value or unit).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const ADD_ON = 'Keep £49 and add a paid AI add-on';
const TEXT = 'For "Keep £49 and add a paid AI add-on": it sets Paid AI add-on price to £10 per month.';

/** The served shape: an option on the price, and a NEW add-on price factor with no value, no range, no unit. */
function servedGraph() {
  return projectGraphForPersistence({
    ...GraphV3.parse({
      nodes: [
        { id: 'goal_mrr', kind: 'goal', label: 'MRR', goal_threshold: 0.1 },
        {
          id: 'opt_add_on', kind: 'option', label: ADD_ON, provenance: 'ai_inferred',
          interventions: { fac_price: { value: 0.245, source: 'user_specified', target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' } } },
        },
        { id: 'fac_price', kind: 'factor', label: 'Pro plan monthly price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP per month', source: 'user_override' } },
        { id: 'fac_churn', kind: 'factor', label: 'Monthly churn rate', observed_state: { value: 0.05, source: 'brief_extraction' } },
        { id: 'fac_add_on_price', kind: 'factor', label: 'Paid AI add-on price' },
      ],
      edges: [['opt_add_on', 'fac_price'], ['fac_price', 'goal_mrr'], ['fac_churn', 'goal_mrr'], ['fac_add_on_price', 'goal_mrr']]
        .map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
    }),
    options: [] as Array<Record<string, unknown>>,
  });
}

let persisted: unknown = servedGraph();
let receiptFor: ((write: Record<string, unknown>) => Record<string, unknown>) | undefined;
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    // The door verifies its OWN row and fact through these (as `route-v2-option-intervention-edit.test.ts` models them).
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-09-26T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-26T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id, ...(receiptFor !== undefined ? { modelVersionReceipt: receiptFor(write) } : {}) };
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

const currentHash = (): string => {
  const h = computeAnalysisAffectingGraphHash(persisted as never);
  if (h === null) throw new Error('fixture must have an analysis-affecting hash');
  return h;
};

describe('the lost £10: the user\'s figure survives propose → ONE approval → the real door → the persisted cell → read-back → narration', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  let narrateWriteOutcome: typeof import('../../../src/orchestrator-v5/agent-lane/write-outcome.js').narrateWriteOutcome;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
    ({ narrateWriteOutcome } = await import('../../../src/orchestrator-v5/agent-lane/write-outcome.js'));
  });
  beforeEach(() => {
    persisted = servedGraph();
    rows.clear();
    receiptFor = (write) => ({
      mutation_id: '33333333-3333-4333-8333-333333333333', version_id: '44444444-4444-4444-8444-444444444444', version_number: 7,
      graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64), hash_algorithm: 'sha256',
      identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
      actor_kind: 'system', authored_by: null, creation_kind: 'committed_mutation', source_version_id: null,
      parent_version_id: null, root_version_id: null, undo_version_id: null, event_id: 'evt-agent',
      graph: write.graph, source_turn_id: write.turn_id,
    });
  });

  it('RED (served turns[3]→[4]): ONE commit holds the link and the cell {10 of its range, "£ per month", user_specified}; the hash moves; the receipt, read-back and narration agree', async () => {
    const store = new ProposalStore();
    const read = async () => ({ status: 200, json: { graph: persisted, graph_hash: currentHash() } });
    const caps = createAgentCapabilities(read as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-agent'),
    });
    const ctx = { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: TEXT };
    const before = currentHash();

    const proposed = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: ADD_ON, factor_label: 'Paid AI add-on price', value: 10, unit: '£ per month', basis: 'the user: £10 per month', user_stated: true },
    ] });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.mutated).toBe(true);

    // ONE commit, and the model moved.
    expect(rows.size, 'the link and the level are ONE commit').toBe(1);
    expect(currentHash()).not.toBe(before);

    // The persisted cell keeps the user's figure, its unit and range, as THEIRS.
    const g = persisted as { nodes: { id: string; interventions?: Record<string, Record<string, unknown>> }[]; edges: { from: string; to: string }[] };
    const cell = g.nodes.find((n) => n.id === 'opt_add_on')!.interventions!.fac_add_on_price!;
    expect(cell, JSON.stringify(cell)).toMatchObject({ raw_value: 10, unit: '£ per month', source: 'user_specified' });
    // The range the proposal disclosed ("range taken from your figure") is the one the cell's level is read on, and the
    // cell KEEPS it (DL 5848777655): `cap` persists beside `raw_value`, so value == raw_value / cap re-checks on readback.
    const range = ((proposed.interventions as { model_range?: unknown }[] | undefined)?.[0]?.model_range) as number;
    expect(range).toBeGreaterThan(10);
    expect(cell.cap, JSON.stringify(cell)).toBe(range);
    expect(cell.value).toBe(10 / range);
    expect(cell.value).toBe((cell.raw_value as number) / (cell.cap as number));
    expect(g.edges.filter((e) => e.from === 'opt_add_on' && e.to === 'fac_add_on_price')).toHaveLength(1);

    // The version receipt of that ONE commit.
    expect(JSON.stringify(out)).toContain('44444444-4444-4444-8444-444444444444');

    // The read-back and the narration the user reads: saved, and never called Olumi's estimate.
    const said = narrateWriteOutcome('', [{ name: 'authorise_change' }], [out], { versioned: true });
    expect(JSON.stringify(said)).toMatch(/Saved/);
    expect(JSON.stringify(said)).not.toMatch(/Olumi(?:’|')?s? estimate|estimate not yet confirmed/i);
    expect(JSON.stringify(out)).not.toMatch(/Olumi(?:’|')?s? estimate/i);
  });
});
