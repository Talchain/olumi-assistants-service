import { legacyDoorGraph } from '../../../src/orchestrator-v5/agent-lane/__tests__/licence-test-graphs.js';
/**
 * ⭐ M1 (#2481): an S1 Strengthen press asks for a size, never a card approving its placeholder prior. The independent
 * Apply claim stays through the REAL in-process door: a sized Olumi link supplies the pre-mortem's real card producer,
 * whose same-band Apply is a REVIEW (`confirm_current`, #2473) keeping μ and σ and recording the user's acceptance.
 * The args are the producer's own (`cardCallFor`), never re-derived here.
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

describe('M1: placeholder Strengthen asks for a size; a sized-link card Apply holds the figure', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  let strengthenCardFor: typeof import('../../../src/orchestrator-v5/agent-lane/strengthen-press.js').strengthenCardFor;
  let cardCallFor: typeof import('../../../src/orchestrator-v5/agent-lane/method-turn/method-turn.js').cardCallFor;
  let linkSizing: typeof import('../../../src/cee/magnitude/link-sizing.js').linkSizing;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
    ({ strengthenCardFor } = await import('../../../src/orchestrator-v5/agent-lane/strengthen-press.js'));
    ({ cardCallFor } = await import('../../../src/orchestrator-v5/agent-lane/method-turn/method-turn.js'));
    ({ linkSizing } = await import('../../../src/cee/magnitude/link-sizing.js'));
  });
  beforeEach(() => { persisted = servedGraph(); rows.clear(); llmChatMock.mockClear(); });

  // Science 393023 LICENCE ruling 3 (DL 6049287136 P0), re-derived: sprint/AI S1 offered band moderate -> this placeholder press is ask_only, with no band or proposal call.
  it('placeholder sprint/AI Strengthen asks for a size, with no proposal or model call', () => {
    const before = JSON.parse(JSON.stringify(edgeOf(AI.from, AI.to))) as { strength: { mean: number; std?: number }; provenance?: Record<string, unknown> };
    expect(before.strength.mean, 'precondition: the served placeholder').toBe(0.25);
    expect(linkSizing(before), 'precondition').toBe('placeholder');
    const card = strengthenCardFor({ graph: persisted, analysisState: { run_state: { kind: 'complete_current' } },
      optionParticipation: [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }] });
    expect(card, JSON.stringify(card)).toMatchObject({ ask_only: true, target: { from_id: AI.from, to_id: AI.to } });
    expect(card?.target).not.toHaveProperty('band');
    expect(card?.args.links[0]).not.toHaveProperty('strength');
    expect(card?.text).toContain(card!.target.from_label);
    expect(card?.text).toContain(card!.target.to_label);
    expect(card?.text).toMatch(/\?/);
    expect(cardCallFor({ id: `${AI.from}->${AI.to}`, kind: 'link',
      labels: [card!.target.from_label, card!.target.to_label], card: 'propose_link_strengths' }, persisted),
    'the real proposal-call producer refuses this unsized target').toBeNull();
    expect(edgeOf(AI.from, AI.to)).toEqual(before);
    expect(rows.size, 'no commit from the pure press').toBe(0);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  // Science 393023 LICENCE ruling 3 (DL 6049287136 P0), re-derived: S1 press -> Apply held the placeholder figure -> a sized-link pre-mortem card preserves the independent same-band Apply/figure/review claim.
  it('RED: sized-link pre-mortem card → Apply → 0.25 reads back (μ and σ held), reviewed without user authorship', async () => {
    const sized = edgeOf(AI.from, AI.to);
    const { mean_projected: _placeholderCarrier, ...provenance } = sized.provenance ?? {};
    sized.provenance = { ...provenance, magnitude: 'olumi_estimate' };
    const before = JSON.parse(JSON.stringify(sized)) as typeof sized;
    expect(before.strength.mean).toBe(0.25);
    expect(linkSizing(before), 'precondition: this separate control has a real Olumi size').toBe('olumi_estimate');
    const card = cardCallFor({ id: `${AI.from}->${AI.to}`, kind: 'link', labels: [], card: 'propose_link_strengths' }, persisted);
    expect(card, JSON.stringify(card)).toMatchObject({ tool: 'propose_link_strengths', args: { links: [{ strength: 'moderate' }] } });
    if (card?.tool !== 'propose_link_strengths') throw new Error('sized-link pre-mortem card missing');
    // The read returns the model as stored NOW (the write's own read-back confirms against it), as the harness does.
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: computeAnalysisAffectingGraphHash(persisted as never) } });
    const caps = createAgentCapabilities(d as never, new ProposalStore(), undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-m1'),
    });
    // A chip press: no typed words (`user_turn_text` empty), exactly as the route binds it.
    const ctx = { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: '', user_turn_text: '' };
    const p = await caps.proposeLinkStrengths!(ctx, card.args as never);
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

// Science 393023 LICENCE ruling 3 (DL 6049287136 P0), re-derived: as-served prospect/revenue S1 offered band strong -> the same identity is an ask_only size question, with no band or proposal call.
it('Science 393023: as-served D1 prospect/revenue is an ask_only size question', async () => {
  const { strengthenCardFor } = await import('../../../src/orchestrator-v5/agent-lane/strengthen-press.js');
  const { cardCallFor } = await import('../../../src/orchestrator-v5/agent-lane/method-turn/method-turn.js');
  llmChatMock.mockClear();
  const card = strengthenCardFor({ graph: structuredClone(D1.graph), analysisState: { run_state: { kind: 'complete_current' } }, optionParticipation: [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }] });
  expect(card).toMatchObject({ ask_only: true, target: { from_id: 'enterprise_prospect_signing_likelihood', to_id: 'quarterly_revenue' } });
  expect(card?.target).not.toHaveProperty('band');
  expect(card?.args.links[0]).not.toHaveProperty('strength');
  expect(card?.text).toContain(card!.target.from_label);
  expect(card?.text).toContain(card!.target.to_label);
  expect(card?.text).toMatch(/\?/);
  expect(cardCallFor({ id: 'enterprise_prospect_signing_likelihood->quarterly_revenue', kind: 'link',
    labels: [card!.target.from_label, card!.target.to_label], card: 'propose_link_strengths' }, D1.graph),
  'zero proposals: the real proposal-call producer refuses the served unsized target').toBeNull();
  expect(llmChatMock).not.toHaveBeenCalled();
});
