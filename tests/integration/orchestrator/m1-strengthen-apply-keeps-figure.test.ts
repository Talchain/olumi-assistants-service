import { legacyDoorGraph } from '../../../src/orchestrator-v5/agent-lane/__tests__/licence-test-graphs.js';
/**
 * ⭐ M1 (#2481): APPLYING THE STRENGTHEN CARD KEEPS THE FIGURE AND SIZES THE LINK — through the REAL in-process door
 * (CODEX_CLI_OVERFLOW P1 #1 + DL ruling on #2481). D1's S1 link holds Olumi's placeholder 0.25 ("moderate"); the card
 * proposes that band, so Apply is a REVIEW (`confirm_current`, #2473): the link reads back 0.25, now Olumi's estimate
 * accepted by the user (`olumi_accepted`). The args are the press's own (`strengthenCardFor`), never re-derived here.
 * Harness: `agent-link-set-is-one-commit.test.ts`'s store + door, verbatim.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { assignEntityRefs } from '../../../src/orchestrator-v5/graph/entity-refs.js';

const SCENARIO_ID = 'd1d1d1d1-0000-4000-8000-000000000481';

/** RC's banked served D1 Run turn (capture `d1-sprint-1149Z-11-s5-run.json`): the M1 investor seed's shape. */
const D1 = (JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/m1-s1-served-graphs.json', import.meta.url), 'utf8')) as {
  cases: { id: string; graph: { nodes: unknown[]; edges: unknown[] } }[] }).cases.find((c) => c.id === 'D1-sprint-run')!;
/**
 * The STORED shape of that wire graph: the wire `draft_graph` carries each node's `ref` but omits the persistence-only
 * counter `ref_high_water` (`graph/entity-refs.ts`: out of both hashes). A stored graph always carries it, and every
 * writer carries it forward, so it is restored here by the writers' own rule (`assignEntityRefs` over itself).
 */
function servedGraph(): unknown {
  const projected = projectGraphForPersistence({ ...GraphV3.parse({ nodes: D1.graph.nodes, edges: legacyDoorGraph(D1.graph).edges }), options: [] as Array<Record<string, unknown>> });
  return assignEntityRefs(projected, projected).graph;
}

let persisted: unknown = servedGraph();
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

const edgeOf = (from: string, to: string) =>
  (persisted as { edges: { from: string; to: string; strength: { mean: number; std?: number }; provenance?: Record<string, unknown> }[] }).edges
    .find((e) => e.from === from && e.to === to)!;
const AI = { from: 'sprint_capacity_for_ai_reporting', to: 'ai_reporting_module_availability' };

describe('M1: Apply on the Strengthen card holds D1\'s 0.25 and sizes that link', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  let strengthenCardFor: typeof import('../../../src/orchestrator-v5/agent-lane/strengthen-press.js').strengthenCardFor;
  let linkSizing: typeof import('../../../src/cee/magnitude/link-sizing.js').linkSizing;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
    ({ strengthenCardFor } = await import('../../../src/orchestrator-v5/agent-lane/strengthen-press.js'));
    ({ linkSizing } = await import('../../../src/cee/magnitude/link-sizing.js'));
  });
  beforeEach(() => { persisted = servedGraph(); rows.clear(); });

  it('RED: press → Apply → the S1 link reads back 0.25 (μ and σ held), sized as Olumi\'s estimate you accepted', async () => {
    const before = JSON.parse(JSON.stringify(edgeOf(AI.from, AI.to))) as { strength: { mean: number; std?: number }; provenance?: Record<string, unknown> };
    expect(before.strength.mean, 'precondition: the served placeholder').toBe(0.25);
    expect(linkSizing(before), 'precondition').toBe('placeholder');
    const card = strengthenCardFor({ graph: persisted, analysisState: { run_state: { kind: 'complete_current' } },
      optionParticipation: [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }] });
    expect(card?.target, JSON.stringify(card)).toMatchObject({ from_id: AI.from, to_id: AI.to, band: 'moderate' });
    // The read returns the model as stored NOW (the write's own read-back confirms against it), as the harness does.
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: computeAnalysisAffectingGraphHash(persisted as never) } });
    const caps = createAgentCapabilities(d as never, new ProposalStore(), undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-m1'),
    });
    // A chip press: no typed words (`user_turn_text` empty), exactly as the route binds it.
    const ctx = { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: '', user_turn_text: '' };
    const p = await caps.proposeLinkStrengths!(ctx, card!.args as never);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const after = edgeOf(AI.from, AI.to);
    expect(after.strength, 'Apply keeps the figure: μ and σ').toEqual(before.strength);
    expect(linkSizing(after)).toBe('olumi_accepted');
    expect(after.provenance?.source, 'still Olumi\'s figure, never the user\'s').toBe(before.provenance?.source);
    expect(rows.size, 'ONE commit').toBe(1);
  });
});

it('Science 393023: as-served D1 sprint/moderate → prospect/revenue/strong before Apply', async () => {
  const { strengthenCardFor } = await import('../../../src/orchestrator-v5/agent-lane/strengthen-press.js');
  const card = strengthenCardFor({ graph: structuredClone(D1.graph), analysisState: { run_state: { kind: 'complete_current' } }, optionParticipation: [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }] });
  expect(card?.target).toMatchObject({ from_id: 'enterprise_prospect_signing_likelihood', to_id: 'quarterly_revenue', band: 'strong' });
});
