/**
 * ⭐ THE STORED PER-UNIT IS THE PROPOSED ONE, PROVEN THROUGH THE APPROVAL READ-BACK (CODEX #85 5926859038; fix-forward of #2439).
 * #2439 let a unitless count outcome ("Angel investor conversations") take "per conversation", then STORED its count noun
 * ("conversations"). `applyLinkEffect` reads the edge back and compares the stored unit with the PROPOSED one, so the write
 * landed and the approval said it was not verified: a false "not recorded" on Paul's step 2. These rows drive the REAL
 * propose → approve → read-back path, with spellings that differ from the label's noun.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '38b6c2a6-0000-4000-8000-0000000000c6';

const SRC = 'angel_investor_conversations';
/** The served 0643Z shape at the link-size turn (CEE 581c1873): a unitless count outcome with a stored frame, into the £ goal. */
function servedGraph(): unknown {
  return {
    goal_node_id: 'funding',
    nodes: [
      { id: 'funding', kind: 'goal', label: 'funding', goal_threshold_unit: '£', scale_frame: 20000000 },
      { id: SRC, kind: 'outcome', label: 'Angel investor conversations', scale_frame: 40 },
      { id: 'o-hold', kind: 'option', label: 'Continue firm outreach' },
    ],
    edges: [
      { from: SRC, to: 'funding', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
        defaulted: true, provenance: { source: 'cee_hypothesis' } },
    ],
  };
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

describe('step 2: the approved per-unit is stored exactly as proposed, so the read-back confirms it', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  let approvalChipsFor: typeof import('../../../src/orchestrator-v5/agent-lane/approval-chips.js').approvalChipsFor;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
    ({ approvalChipsFor } = await import('../../../src/orchestrator-v5/agent-lane/approval-chips.js'));
  });
  beforeEach(() => {
    persisted = servedGraph();
    rows.clear();
    receiptFor = (write) => ({
      mutation_id: '33333333-3333-4333-8333-333333333333', version_id: '44444444-4444-4444-8444-444444444444', version_number: 7,
      graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64), hash_algorithm: 'sha256',
      identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
      actor_kind: 'system', authored_by: null, creation_kind: 'committed_mutation', source_version_id: null,
      parent_version_id: null, root_version_id: null, undo_version_id: null, event_id: 'evt-compound',
      graph: write.graph, source_turn_id: write.turn_id,
    });
  });
  const agent = (user_text: string) => {
    const store = new ProposalStore();
    const d = async (path: string, body?: unknown) => {
      if (path.endsWith('/graph/register')) {
        const b = body as { graph: unknown; expected_graph_hash?: string; operation_id?: string };
        if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== currentHash()) return { status: 409, json: { code: 'GRAPH_STALE' } };
        persisted = b.graph;
        rows.set(`register/${String(b.operation_id)}`, { id: `row-${rows.size + 1}`, write: { scenario_id: SCENARIO_ID, turn_id: String(b.operation_id), graph: b.graph } });
        return { status: 200, json: { graph_hash: currentHash() } };
      }
      return { status: 200, json: { graph: persisted, graph_hash: currentHash() } };
    };
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-agent'),
    });
    return { caps, store, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text } };
  };
  const edgeOf = () => (persisted as { edges: { from: string; to: string; provenance?: Record<string, any> }[] })
    .edges.find((e) => e.from === SRC && e.to === 'funding')!;
  const pressing = (a: ReturnType<typeof agent>, p: Record<string, any>) => {
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(p.proposal_id) }],
      (id) => ({ proposal: a.store.get(id), result: p as never }))[0]!;
    return { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: card.message,
      typed_approval_of: String(p.proposal_id), typed_approval_words: card.message };
  };
  const SAID = 'Each extra conversation brings in about £20,000 towards funding.';
  const QUOTE = 'Each extra conversation brings in about £20,000 towards funding';

  // R3 #85 5926783007 (#2441 folded in): the unit may name the count in the source's own words, as Paul's card does.
  for (const unit of ['conversation', 'conversations', 'Conversation', 'investor conversation', 'extra investor conversations']) {
    it(`RED at #2439: proposed "per ${unit}" → approved → read back as recorded (never "not verified")`, async () => {
      expect(edgeOf().provenance?.magnitude).toBeUndefined(); // precondition: unsized on the served bytes
      const a = agent(SAID);
      const p = await a.caps.proposeLinkEffect!(a.ctx, { from_label: 'Angel investor conversations', to_label: 'funding',
        amount: 20000, amount_unit: '£', per_source_change: 1, per_source_change_unit: unit, quote: QUOTE });
      expect(p.ok, JSON.stringify(p)).toBe(true);
      const out = await a.caps.authoriseChange(pressing(a, p), { proposal_id: String(p.proposal_id) }) as Record<string, any>;
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: true, applied: true });
      expect(edgeOf().provenance?.natural_effect?.per_source_change_unit).toBe(unit);
    });
  }
});
