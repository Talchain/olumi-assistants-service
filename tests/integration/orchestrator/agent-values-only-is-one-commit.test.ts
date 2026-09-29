/**
 * ⛔ A VALUES-ONLY APPROVAL IS ONE COMMIT, END TO END (Canonical #70 5850018984; DL GO 5850026671; ChatGPT 5850029446).
 * DL's joined run F1s approved Olumi's three starting figures and the model gained THREE versions. This drives the
 * Agent's own propose → approve on that served model through the REAL in-process door (`commitOptionLevelsInProcess`,
 * with Canonical's values-only batch, CEE #2043) and asserts ONE row, ONE receipt, every value on the model, and a retry
 * that adds nothing. The door's own refusal on this shape (one value refused → persisted byte-identical) is pinned in
 * `route-v2-option-intervention-edit.test.ts` (#2043); the consumer's refusal (nothing written) in
 * `values-only-approval-is-one-commit.test.ts`.
 *
 * Known-bad control: RED with the consumer reverted — three `factor_value_edit` writes, three rows.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '38b6c2a6-0000-4000-8000-000000000002';
import { readFileSync } from 'node:fs';

/** The served model F1s approved against (DL's joined run f-20260926T201724Z, 01-F1-brief.json draft_graph). */
const SERVED = JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/served-f1s-before-approval-d6b09c0.json', import.meta.url), 'utf8')) as { nodes: unknown[]; edges: unknown[] };
function pricingGraph() {
  return projectGraphForPersistence({ ...GraphV3.parse({ nodes: SERVED.nodes, edges: SERVED.edges }), options: [] as Array<Record<string, unknown>> });
}

let persisted: unknown = pricingGraph();
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

describe('Olumi\'s starting point with NO levels (served F1s) is ONE commit through the real door', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
  });
  beforeEach(() => {
    persisted = pricingGraph();
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

  /**
   * The Agent over this harness. Reads return the persisted graph. `/graph/register` is the whole-graph writer it is on
   * staging: it persists the caller's graph as its OWN commit (a row) — so a second write path is visible as a second row.
   */
  const agent = () => {
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
    return { caps, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: 'Work out whether £59 improves MRR.' } };
  };
  const nodeOf = (id: string) => (persisted as { nodes: { id: string; observed_state?: Record<string, unknown>; interventions?: Record<string, Record<string, unknown>> }[] }).nodes.find((n) => n.id === id)!;

  const F1S = { assumptions: [
    { factor_label: 'AI feature availability', value: 0, basis: 'not available today; the release options set it' },
    { factor_label: 'Pro paying subscribers', value: 300, basis: 'a working baseline' },
    { factor_label: 'Monthly churn', value: 7, unit: '%', basis: 'below the 10% limit, to test price sensitivity' },
  ], option_levels: [] };

  it('RED (served F1s): the three starting figures land in ONE commit with ONE receipt, every value on the model', async () => {
    const { caps, ctx } = agent();
    const before = currentHash();
    const p = await caps.proposeStartingPoint(ctx, F1S as never);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'three values, ONE commit').toBe(1);
    expect(currentHash()).not.toBe(before);
    expect(nodeOf('pro_paying_subscribers').observed_state?.raw_value ?? nodeOf('pro_paying_subscribers').observed_state?.value).toBe(300);
    expect(nodeOf('ai_feature_availability').observed_state?.value).toBe(0);
    expect(nodeOf('monthly_churn').observed_state, JSON.stringify(nodeOf('monthly_churn'))).toBeDefined();
    expect((out.receipts as unknown[] | undefined)?.length, JSON.stringify(out.receipts)).toBe(1);
  });

  /**
   * ⭐ A2 / P1-a (DL #70 5850069309, finish ledger 5850221324): the SERVED shape — after the starting point, the user's
   * 12% churn (DL's `201724Z` "12% approval") re-sizes Olumi's own links into churn. The door names them; the Agent
   * route states them from `state_facts`, in the door's own words. RED before: nothing carried them past the door.
   */
  it('RED (A2, the 12% approval): the links Olumi re-sized are carried to the reply — structured AND said, in the door\'s words', async () => {
    const { collectTurnStateFacts } = await import('../../../src/orchestrator-v5/agent-lane/turn-state-facts.js');
    const { valueChangeDisclosures } = await import('../../../src/orchestrator-v5/agent-lane/disclosure.js');
    const { caps, ctx } = agent();
    const p = await caps.proposeStartingPoint(ctx, F1S as never);
    expect((await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) })).ok).toBe(true);
    const twelve = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn', value: 12, unit: '%', basis: 'the user said 12%', revise: true }] } as never);
    expect(twelve.ok, JSON.stringify(twelve)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(twelve.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const churn = ((out as { links_resized?: { factor: string; direction: string; links: string[] }[] }).links_resized ?? [])
      .find((g) => g.factor === 'Monthly churn');
    expect(churn, JSON.stringify(out)).toBeDefined();
    // The SERVED FIELD DL's harness checks (#2043 body): both links INTO churn, and nothing else under churn.
    expect({ ...churn!, links: [...churn!.links].sort() }).toEqual({ factor: 'Monthly churn', direction: 'into', links: ['AI feature availability', 'Price sensitivity'] });
    const facts = collectTurnStateFacts([out]);
    expect(facts.links_resized, JSON.stringify(facts)).toContainEqual(churn);
    const said = valueChangeDisclosures(facts).join(' ');
    expect(said).toContain('Olumi also re-sized its own placeholder links');
    expect(said).toContain('"Monthly churn" so they fit the new level');
    expect(said).toContain('"Price sensitivity"');
    expect(said).toContain('"AI feature availability"');
    expect(said).toContain('They are Olumi\'s placeholders, not measurements.');
  });

  it('CONTRAST (A2): a value on a factor with no Olumi-sized link carries no links_resized and says nothing about links', async () => {
    const { collectTurnStateFacts } = await import('../../../src/orchestrator-v5/agent-lane/turn-state-facts.js');
    const { valueChangeDisclosures } = await import('../../../src/orchestrator-v5/agent-lane/disclosure.js');
    const g = persisted as { nodes: { id: string }[]; edges: { from: string; to: string; provenance?: unknown }[] };
    // Every link on churn is the user's own: nothing of Olumi's to re-size.
    for (const e of g.edges) if (e.from === 'monthly_churn' || e.to === 'monthly_churn') e.provenance = { source: 'user_specified' };
    const { caps, ctx } = agent();
    const p = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn', value: 12, unit: '%', basis: 'the user said 12%', revise: true }] } as never);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(Object.hasOwn(out, 'links_resized'), JSON.stringify(out)).toBe(false);
    const facts = collectTurnStateFacts([out]);
    expect(Object.hasOwn(facts, 'links_resized')).toBe(false);
    expect(valueChangeDisclosures(facts).join(' ')).not.toContain('re-sized');
  });

  it('RED (retry): approving the same starting point again adds no commit', async () => {
    const { caps, ctx } = agent();
    const p = await caps.proposeStartingPoint(ctx, F1S as never);
    await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    const after = JSON.stringify(persisted);
    await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(rows.size).toBe(1);
    expect(JSON.stringify(persisted)).toBe(after);
  });
});
