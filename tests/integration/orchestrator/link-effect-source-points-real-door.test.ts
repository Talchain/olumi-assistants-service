/**
 * ⛔ A % SOURCE ANSWERED IN POINTS IS RECORDED AND SAID AS RECORDED, THROUGH THE REAL DOOR (DL #2561 round 2, P1).
 * The link writer accepts a percentage-level SOURCE's change in "percentage points" (#2288) and the sizer stores it in
 * the level's own unit. The approval's read-back compared the stored unit with the STATED words, so an applied write
 * read back as not_verified, the proposal was never marked applied, and a retry was refused as superseded. Every row
 * here commits through `commitOptionLevelsInProcess` (the real writer and persistence), never a fake that echoes units.
 * Harness: `agent-link-effect-answer-round-trip.test.ts`'s mocked session store, unchanged.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '38b6c2a6-0000-4000-8000-0000000000c6';
import { readFileSync } from 'node:fs';

/** The served journey-C model (5411da8, D1 brief turn): a DIRECT, unsized price → paying-subscribers link. */
const SERVED = (JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/served-journey-c-price-subscribers-unsized-5411da8.json', import.meta.url), 'utf8')) as { graph: { nodes: unknown[]; edges: unknown[] } }).graph;
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

describe('a % source answered in points, through the real door: recorded, said as recorded, and a retry writes nothing', () => {
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
    persisted = pricingGraph();
    rows.clear();
    receiptFor = undefined;
  });
  const agent = (user_text: string) => {
    const store = new ProposalStore();
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: currentHash() } });
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-agent'),
    });
    return { caps, store, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text } };
  };
  const pressing = (a: ReturnType<typeof agent>, p: Record<string, any>) => {
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(p.proposal_id) }],
      (id) => ({ proposal: a.store.get(id), result: p as never }))[0]!;
    return { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: card.message,
      typed_approval_of: String(p.proposal_id), typed_approval_words: card.message };
  };
  const edgeOf = (from: string, to = 'pro_plan_paying_subscribers') => (persisted as { edges: { from: string; to: string; provenance?: Record<string, any> }[] })
    .edges.find((e) => e.from === from && e.to === to)!;
  // Wordings the (unchanged) statement rule binds: a source change in points, and the same link in % (link-effect-grouped).
  const CHURN_QUOTE = 'Each extra percentage point of Monthly churn loses about 40 Pro plan paying subscribers';
  const CHURN_PERCENT_QUOTE = 'Every 1% monthly churn loses about 40 Pro plan paying subscribers';
  const CHURN = { from_label: 'Monthly churn', to_label: 'Pro plan paying subscribers', amount: -40, amount_unit: 'subscribers',
    per_source_change: 1, per_source_change_unit: 'percentage points', quote: CHURN_QUOTE };
  const PRICE_QUOTE = 'every £1 on the Pro plan price loses us about 50 Pro plan paying subscribers';
  const PRICE = { from_label: 'Pro plan price', to_label: 'Pro plan paying subscribers', amount: -50, amount_unit: 'subscribers',
    per_source_change: 1, per_source_change_unit: 'GBP per month', quote: PRICE_QUOTE };

  it.each([
    ['percentage points', 'RED', CHURN_QUOTE], ['percent per month', 'control', CHURN_PERCENT_QUOTE],
  ] as const)('single, source said in "%s" (%s): ONE commit, applied: true, and a retry is already_applied with no second write', async (perUnit, _row, quote) => {
    const a = agent(`Honestly: ${quote}.`);
    const p = await a.caps.proposeLinkEffect!(a.ctx, { ...CHURN, per_source_change_unit: perUnit, quote }) as Record<string, any>;
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await a.caps.authoriseChange(pressing(a, p), { proposal_id: String(p.proposal_id) }) as Record<string, any>;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(rows.size, 'ONE commit').toBe(1);
    expect(edgeOf('monthly_churn').provenance).toEqual(expect.objectContaining({ source: 'user_specified', magnitude: 'user_stated' }));
    expect(edgeOf('monthly_churn').provenance?.natural_effect).toEqual(expect.objectContaining({ amount: -40, per_source_change: 1 }));
    const stored = JSON.stringify(persisted);
    const retry = await a.caps.authoriseChange(pressing(a, p), { proposal_id: String(p.proposal_id) }) as Record<string, any>;
    expect(retry, JSON.stringify(retry)).toEqual(expect.objectContaining({ ok: true, mutated: false, already_applied: true }));
    expect(rows.size, 'the retry writes nothing').toBe(1);
    expect(JSON.stringify(persisted)).toBe(stored);
  });

  it('RED grouped: a points source beside a £ source → ONE commit, applied: true; a retry is already_applied with no second write', async () => {
    const a = agent(`${CHURN_QUOTE}. And ${PRICE_QUOTE}.`);
    const p = await a.caps.proposeLinkEffect!(a.ctx, { links: [CHURN, PRICE] }) as Record<string, any>;
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(a.store.get(String(p.proposal_id))?.operations).toHaveLength(2);
    const out = await a.caps.authoriseChange(pressing(a, p), { proposal_id: String(p.proposal_id) }) as Record<string, any>;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(rows.size, 'ONE commit').toBe(1);
    for (const from of ['monthly_churn', 'pro_plan_price']) {
      expect(edgeOf(from).provenance).toEqual(expect.objectContaining({ source: 'user_specified', magnitude: 'user_stated' }));
    }
    const stored = JSON.stringify(persisted);
    const retry = await a.caps.authoriseChange(pressing(a, p), { proposal_id: String(p.proposal_id) }) as Record<string, any>;
    expect(retry, JSON.stringify(retry)).toEqual(expect.objectContaining({ ok: true, mutated: false, already_applied: true }));
    expect(rows.size, 'the retry writes nothing').toBe(1);
    expect(JSON.stringify(persisted)).toBe(stored);
  });

  it('control: a door that commits but stores ANOTHER figure is still not_verified (the read-back is not loosened)', async () => {
    const a = agent(`Honestly: ${CHURN_QUOTE}.`);
    const p = await a.caps.proposeLinkEffect!(a.ctx, CHURN) as Record<string, any>;
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const tampering = createAgentCapabilities((async () => ({ status: 200, json: { graph: persisted, graph_hash: currentHash() } })) as never, a.store,
      undefined, 'full', undefined, { commitOptionLevels: async (input) => {
        const r = await commitOptionLevelsInProcess(input, 'req-agent');
        const e = edgeOf('monthly_churn');
        e.provenance = { ...e.provenance, natural_effect: { ...e.provenance!.natural_effect, amount: -41 } };
        return r;
      } });
    const out = await tampering.authoriseChange(pressing(a, p), { proposal_id: String(p.proposal_id) }) as Record<string, any>;
    expect(out).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_verified' }));
  });
});
