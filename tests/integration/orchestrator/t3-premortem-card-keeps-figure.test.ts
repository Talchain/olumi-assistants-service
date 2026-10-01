/**
 * T3 round 2 (CODEX_CLI_OVERFLOW P1 #2 on #2480; DL 5939415083 (3)): the pre-mortem's ONE link card, through the REAL
 * door, on R3's SERVED D1 graph. D1's top link (`ai_reporting_module_availability -> enterprise_prospect_signing_likelihood`)
 * is Olumi's estimate at μ 0.6, σ 0.3 with its `natural_effect`. The card offers it at the band it already sits in
 * (strong); the stored proposal says exactly that, and approving it keeps the figure — 0.6 stays 0.6 (#2473's
 * `confirm_current`), not the band's 0.55 midpoint.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { CANVAS_BAND_WORD } from '../../../src/orchestrator-v5/format/edge-strength-bands.js';
import { assignEntityRefs } from '../../../src/orchestrator-v5/graph/entity-refs.js';

const SCENARIO_ID = '7a1e2d3c-0000-4000-8000-0000000000d1';
const SERVED = JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/turn-context/__tests__/fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: { id: string; capture_sha_matches_case: boolean; body: Record<string, any> }[] };
const D1 = SERVED.cases.find((c) => c.id === 'A-Q-D1-BUILD')!;
const FROM = 'ai_reporting_module_availability';
const TO = 'enterprise_prospect_signing_likelihood';

/**
 * The stored row, rebuilt from the capture. The capture is the WIRE projection, which carries every node's `ref` but
 * not the counter `ref_high_water`; every writer stamps that counter into the stored row (`graph/entity-refs.ts`), so
 * the row is rebuilt through the writers' own `assignEntityRefs` (base = itself: refs carried, nodes untouched).
 */
function servedGraph(): unknown {
  const g = D1.body.draft_graph as { nodes: unknown[]; edges: unknown[] };
  const wire = projectGraphForPersistence({ ...GraphV3.parse({ nodes: g.nodes, edges: g.edges }), options: [] as Array<Record<string, unknown>> });
  return assignEntityRefs(wire, wire).graph;
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
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-10-01T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-10-01T00:00:00.000Z', fact }));
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

const currentHash = (): string => {
  const h = computeAnalysisAffectingGraphHash(persisted as never);
  if (h === null) throw new Error('fixture must have an analysis-affecting hash');
  return h;
};
type Edge = { from: string; to: string; strength: { mean: number; std?: number }; provenance?: Record<string, unknown> } & Record<string, unknown>;
const edgeOf = (from: string, to: string): Edge => (persisted as { edges: Edge[] }).edges.find((e) => e.from === from && e.to === to)!;

describe('T3 pre-mortem card on the SERVED D1 graph, through the real door', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  let mt: typeof import('../../../src/orchestrator-v5/agent-lane/method-turn/method-turn.js');
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
    mt = await import('../../../src/orchestrator-v5/agent-lane/method-turn/method-turn.js');
  });
  beforeEach(() => { persisted = servedGraph(); rows.clear(); });

  const agent = (userTurnText: string) => {
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: currentHash() } });
    const caps = createAgentCapabilities(d as never, new ProposalStore(), undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-agent'),
    });
    return { caps, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: userTurnText, user_turn_text: userTurnText } };
  };

  it('the corpus: the served capture, and its top link is Olumi\'s estimate at μ 0.6', () => {
    expect(D1.capture_sha_matches_case).toBe(true);
    const { ref_high_water: counter, ...rest } = persisted as Record<string, unknown>;
    expect(counter, 'the stored row carries the writers\' counter').toBeDefined();
    const g = D1.body.draft_graph as { nodes: { id: string; ref?: string }[] };
    expect((rest.nodes as { id: string; ref?: string }[]).map((x) => [x.id, x.ref]), 'refs carried, never reissued').toEqual(g.nodes.map((x) => [x.id, x.ref]));
    expect(edgeOf(FROM, TO).strength).toEqual({ mean: 0.6, std: 0.3 });
    expect(edgeOf(FROM, TO).provenance?.magnitude).toBe('olumi_estimate');
  });

  it('ROW K1 (DL (3)): the T3 card for that link discloses the link + its band, and approving it keeps 0.6 (never the 0.55 midpoint)', async () => {
    const turn = mt.planMethodTurn({ chipId: mt.planPickChipId('ai_reporting_module_sprint'), signalInputs: {
      offeredSpecific: [], graph: D1.body.draft_graph, analysisState: D1.body.analysis_state, analysisResult: D1.body.analysis_result,
      optionParticipation: D1.body.option_participation, leaderLicensed: false } });
    if (turn?.kind !== 'run') throw new Error('expected a run');
    const item = turn.context.supplied_items.find((i) => i.id === `${FROM}->${TO}`)!;
    const card = mt.cardCallFor(item, persisted);
    expect(card?.tool).toBe('propose_link_strengths');
    if (card?.tool !== 'propose_link_strengths') return;
    const before = JSON.parse(JSON.stringify(edgeOf(FROM, TO))) as Edge;
    const { caps, ctx } = agent('Run a pre-mortem on ‘AI Reporting Module Sprint’.');
    const p = await caps.proposeLinkStrengths!(ctx, card.args as never);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(String(p.public_label)).toContain(`"${card.args.links[0].from_label}" → "${card.args.links[0].to_label}" as ${CANVAS_BAND_WORD.strong}`);
    expect(String(p.public_label)).toContain('Olumi’s estimate');
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const after = edgeOf(FROM, TO);
    expect(after.strength, 'μ 0.6 and σ 0.3 held exactly').toEqual(before.strength);
    expect(after.strength.mean).toBe(0.6);
  });
});
