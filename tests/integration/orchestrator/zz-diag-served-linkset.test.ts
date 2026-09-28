/**
 * DIAGNOSTIC SCRATCH — reproduces CEE #2255's served refusal on staging (w2255-served-20260928).
 *
 * Served evidence (read-only, `/Users/paulslee/Documents/GitHub/output/olumi-handover-2026-09-25/openai-runtime/w2255-served-20260928/`):
 * an Agent link-set approve on a freshly-drafted scenario (NO analysis Run has ever completed on it) returned
 * `authorise_change` refusal `not_applied` / `reason: not_applied`, `assistant_text: "Not saved: none of it was applied."`,
 * and the `_diagnostic_trace` showed only 2 graph-read dispatches (both GET, no write, no read-back).
 *
 * This test drives the REAL in-process door (same harness as
 * `tests/integration/orchestrator/agent-link-set-is-one-commit.test.ts`) against the SERVED graph
 * (`graph-before.json`'s `.graph`), proposing exactly T2's six bands, and logs the FULL `authoriseChange` result.
 * It then re-runs the identical proposal WITH a prior successful `run_analysis` fact seeded — once where that Run
 * left the `pro_mrr` identity IN USE (not withdrawn) and once where it WITHDREW it — to isolate whether the
 * refusal is caused specifically by "no prior Run" (candidate 1) vs. "identity in use regardless of Run".
 *
 * NOT a RED row yet: no fixture file was added, and the assertions are commented observations first, hard
 * assertions second, so a successor can promote this directly.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '13acc577-f1d4-4859-b272-e34feafb38ce'; // the served scenario_id (T2/T3 requests)

const SERVED_EVIDENCE_DIR = '/Users/paulslee/Documents/GitHub/output/olumi-handover-2026-09-25/openai-runtime/w2255-served-20260928';
const servedBefore = JSON.parse(readFileSync(`${SERVED_EVIDENCE_DIR}/graph-before.json`, 'utf8')) as { graph: { nodes: unknown[]; edges: unknown[]; goal_constraints?: unknown[] } };

function servedGraph(): unknown {
  const g = servedBefore.graph;
  return projectGraphForPersistence({ ...GraphV3.parse({ nodes: g.nodes, edges: g.edges, goal_constraints: g.goal_constraints }), options: [] as Array<Record<string, unknown>> });
}

let persisted: unknown = servedGraph();
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      return (r.write.handler_facts ?? []) as unknown[];
    }),
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

// T2's six proposed bands, in T2's own listed order.
const BANDS = [
  { from_label: 'Pro plan price', to_label: 'Monthly churn', strength: 'moderate' as const },
  { from_label: 'Monthly churn', to_label: '12-month net Pro subscriber growth', strength: 'strong' as const },
  { from_label: '12-month net Pro subscriber growth', to_label: 'Pro paying subscribers', strength: 'very strong' as const },
  { from_label: 'Pro plan price', to_label: 'Pro MRR', strength: 'very strong' as const },
  { from_label: 'Pro paying subscribers', to_label: 'Pro MRR', strength: 'very strong' as const },
  { from_label: 'Pro MRR', to_label: 'MRR', strength: 'very strong' as const },
];

const RUN_AT = '2026-09-28T17:00:00.000Z';
/** A successful run_analysis fact. `withdrawPro MRR` controls whether that Run withdrew pro_mrr's identity. */
const runFact = (withdrawProMrr: boolean) => RunAnalysisHandlerFactSchema.parse({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: SCENARIO_ID, computed_at: RUN_AT,
    graph_hash_at_run: computeAnalysisAffectingGraphHash(persisted as never),
    leading_option_id: null, summary: 'First pass.',
    enrichment: {
      analysis_status: 'completed',
      identity_evaluations: [{ node_id: 'pro_mrr', evaluated: !withdrawProMrr }],
      ...(withdrawProMrr ? { _meta: { identities_not_forwarded: [{ node_id: 'pro_mrr', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['pro_plan_price'] }] } } : {}),
    },
  },
});

function seedRunFact(fact: unknown): void {
  const id = `seed-run-${rows.size + 1}`;
  rows.set(`${SCENARIO_ID}/${id}`, {
    id,
    write: {
      scenario_id: SCENARIO_ID, turn_id: id, turn_class: 'analyse', handler_id: 'run_analysis',
      request_hash: 'seed', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
      handler_facts: [fact],
    },
  });
}

describe('DIAGNOSTIC: served w2255 link-set refusal, reproduced against the served graph', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
  });
  beforeEach(() => {
    persisted = servedGraph();
    rows.clear();
  });

  const agent = (userTurnText: string) => {
    const store = new ProposalStore();
    const currentHash = (): string => {
      const h = computeAnalysisAffectingGraphHash(persisted as never);
      if (h === null) throw new Error('served fixture must have an analysis-affecting hash');
      return h;
    };
    let readCalls = 0;
    const d = async () => { readCalls += 1; return { status: 200, json: { graph: persisted, graph_hash: currentHash() } }; };
    let doorCalls = 0;
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => { doorCalls += 1; return commitOptionLevelsInProcess(input, 'req-diag'); },
    });
    return {
      caps,
      ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: userTurnText, user_turn_text: userTurnText },
      readCalls: () => readCalls, doorCalls: () => doorCalls,
    };
  };

  it('1. NO prior Run (matches served: never_run) — reproduces the refusal', async () => {
    const { caps, ctx, readCalls, doorCalls } = agent('We need to make educated guesses on all of these link strengths. What do you recommend?');
    const p = await caps.proposeLinkStrengths!(ctx, { links: BANDS as never, rationale: 'Agent-recommended bands (T2)' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const before = JSON.stringify(persisted);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    // eslint-disable-next-line no-console
    console.log('[DIAG 1/no-run] authoriseChange result:', JSON.stringify(out, null, 2));
    // eslint-disable-next-line no-console
    console.log('[DIAG 1/no-run] read dispatches:', readCalls(), 'commitOptionLevels calls:', doorCalls(), 'rows committed:', rows.size);
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(out.refusal).toBe('not_applied');
    expect(String(out.detail)).toContain('is defined by a calculation');
    expect(String((out as { refused_link?: string }).refused_link)).toBe('"Pro plan price" → "Pro MRR"');
    expect(rows.size, 'nothing committed').toBe(0);
    expect(JSON.stringify(persisted), 'byte-identical').toBe(before);
  });

  it('2. WITH a prior successful Run that left pro_mrr IN USE (not withdrawn) — still refuses (identity in use, Run or no Run)', async () => {
    seedRunFact(runFact(false));
    const { caps, ctx } = agent('We need to make educated guesses on all of these link strengths. What do you recommend?');
    const p = await caps.proposeLinkStrengths!(ctx, { links: BANDS as never, rationale: 'Agent-recommended bands (T2)' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    // eslint-disable-next-line no-console
    console.log('[DIAG 2/run-not-withdrawn] authoriseChange result:', JSON.stringify(out, null, 2));
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(String(out.detail)).toContain('is defined by a calculation');
  });

  it('3. WITH a prior successful Run that WITHDREW pro_mrr\'s identity — the definitional refusal lifts; the set commits', async () => {
    seedRunFact(runFact(true));
    const { caps, ctx } = agent('We need to make educated guesses on all of these link strengths. What do you recommend?');
    const p = await caps.proposeLinkStrengths!(ctx, { links: BANDS as never, rationale: 'Agent-recommended bands (T2)' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    // eslint-disable-next-line no-console
    console.log('[DIAG 3/run-withdrawn] authoriseChange result:', JSON.stringify(out, null, 2));
    console.log('[DIAG 3/run-withdrawn] rows committed:', rows.size);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    // rows.size is 2 here: row 1 is the run fact WE seeded via seedRunFact() (not a real prior turn on the
    // served scenario, which had none), row 2 is the ONE link-set commit. Only one door call / one commit happens.
    expect(rows.size, 'seeded run-fact row + one link-set commit').toBe(2);
  });
});
