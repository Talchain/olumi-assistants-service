/**
 * ⭐ A SET OF LINK STRENGTHS IS ONE APPROVAL AND ONE COMMIT, END TO END (DL #72 5871594233; seam Canonical 5871633483,
 * DL 5871661097; rows Canonical's five).
 *
 * Paul's production test (`64c5eccc`, `olumi-debug-64c5eccc-20260928.json`): he asked Olumi for "educated guesses" on
 * the links, said "I'm aligned with these. Please make these updates", then named the bands himself ("set human
 * capacity, delegable workload, delegation quality, and delegated hours effects to strong; all other listed effects to
 * moderate"). Four permissions recorded ONE link of eight: the Agent could hold one link per approval, and refused a band
 * the user had not typed.
 *
 * This drives the Agent's own propose → approve on his served model through the REAL in-process door
 * (`commitOptionLevelsInProcess` → the batch executor → the canonical link writer, once per link, in memory) and asserts
 * ONE row for the whole set, each link's strength and stamp, and that a refused link leaves the model byte-identical.
 *
 * Known-bad control (the mutant): a commit per link — the definitional-link row goes RED on a partial landing.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '64c5eccc-0000-4000-8000-000000000001';

/** Paul's served model (`payloads.cee_response.draft_graph`): 10 causal links, one his own, nine Olumi's ±0.5 defaults. */
const SERVED = JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/paul-64c5eccc-assistant-draft-graph.json', import.meta.url), 'utf8')) as { nodes: unknown[]; edges: unknown[] };
function servedGraph(): unknown {
  return projectGraphForPersistence({ ...GraphV3.parse({ nodes: SERVED.nodes, edges: SERVED.edges }), options: [] as Array<Record<string, unknown>> });
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

const currentHash = (): string => {
  const h = computeAnalysisAffectingGraphHash(persisted as never);
  if (h === null) throw new Error('fixture must have an analysis-affecting hash');
  return h;
};

type Edge = { from: string; to: string; strength: { mean: number; std?: number }; effect_direction?: string; defaulted?: boolean;
  exists_defaulted?: boolean; provenance?: { source?: string; magnitude?: string; reasoning?: unknown }; provenance_display?: string };
const edgeOf = (from: string, to: string): Edge =>
  (persisted as { edges: Edge[] }).edges.find((e) => e.from === from && e.to === to)!;

// Paul's eight, as he named them (strong ×4; moderate for the other four, two of them the negative links into quality).
const L = {
  capacityQuality: ['Human assistant capacity', 'Delegation quality', 'human_assistant_capacity', 'delegation_quality'],
  workloadHours: ['Delegable routine workload', 'Routine-work hours delegated', 'delegable_routine_workload', 'routine_work_hours_delegated'],
  qualityHours: ['Delegation quality', 'Routine-work hours delegated', 'delegation_quality', 'routine_work_hours_delegated'],
  hoursFocus: ['Routine-work hours delegated', 'ability to focus on high-value…', 'routine_work_hours_delegated', 'ability_to_focus_on_high_value_tasks'],
  capacityOverhead: ['Human assistant capacity', 'Assistant coordination overhead', 'human_assistant_capacity', 'assistant_coordination_overhead'],
  aiUseQuality: ['AI assistant use', 'Delegation quality', 'ai_assistant_use', 'delegation_quality'],
  riskQuality: ['AI output error risk', 'Delegation quality', 'ai_output_error_risk', 'delegation_quality'],
  overheadQuality: ['Assistant coordination overhead', 'Delegation quality', 'assistant_coordination_overhead', 'delegation_quality'],
} as const;
type Key = keyof typeof L;
const STRONG: Key[] = ['capacityQuality', 'workloadHours', 'qualityHours', 'hoursFocus'];
const MODERATE: Key[] = ['capacityOverhead', 'aiUseQuality', 'riskQuality', 'overheadQuality'];
const setOf = (keys: readonly Key[]) => keys.map((k) => ({
  from_label: L[k][0], to_label: L[k][1], strength: STRONG.includes(k) ? 'strong' : 'moderate' }));
const edge = (k: Key): Edge => edgeOf(L[k][2], L[k][3]);

describe('⭐ Paul\'s link set (64c5eccc) is ONE approval and ONE commit through the real door', () => {
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

  let doorCalls = 0;
  const agent = (userTurnText: string) => {
    const store = new ProposalStore();
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: currentHash() } });
    doorCalls = 0;
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => { doorCalls += 1; return commitOptionLevelsInProcess(input, 'req-agent'); },
    });
    return { caps, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: userTurnText, user_turn_text: userTurnText } };
  };

  it('RED (Paul\'s delegated set: "I\'m aligned with these. Please make these updates."): ONE proposal, ONE commit, each link Olumi\'s estimate — never his', async () => {
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf([...STRONG, ...MODERATE]) as never, rationale: 'the user agreed to Olumi\'s recommended strengths' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    // His own link already sits in "strong": an estimate never replaces it, and it is said, not written.
    expect(p.already, JSON.stringify(p)).toEqual([expect.stringContaining('"Human assistant capacity" → "Delegation quality" is already strong, as the user set it')]);
    expect(String(p.public_label)).toMatch(/^Record these 7 link strengths/);
    expect(String(p.public_label)).not.toContain('your estimate');
    const before = JSON.stringify(edge('capacityQuality'));
    const agreed = ['workloadHours', 'qualityHours', 'hoursFocus', 'capacityOverhead', 'aiUseQuality', 'riskQuality', 'overheadQuality'] as const;
    const was = Object.fromEntries(agreed.map((k) => [k, JSON.parse(JSON.stringify({ provenance: edge(k).provenance, display: edge(k).provenance_display }))])) as Record<string, { provenance?: Record<string, unknown>; display?: string }>;
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'seven links, ONE commit').toBe(1);
    expect(doorCalls, 'ONE door call').toBe(1);
    for (const k of ['workloadHours', 'qualityHours', 'hoursFocus'] as const) expect(edge(k).strength.mean, k).toBe(0.55);
    for (const k of ['capacityOverhead', 'aiUseQuality'] as const) expect(edge(k).strength.mean, k).toBe(0.3);
    // The negative links stay negative: a set never reverses a link.
    for (const k of ['riskQuality', 'overheadQuality'] as const) {
      expect(edge(k).strength.mean, k).toBe(-0.3);
      expect(edge(k).effect_direction, k).toBe('negative');
    }
    for (const k of ['workloadHours', 'qualityHours', 'hoursFocus', 'capacityOverhead', 'aiUseQuality', 'riskQuality', 'overheadQuality'] as const) {
      const e = edge(k);
      // Agreement is REVIEW (DL ruling 5873648311): provenance and display byte-identical, `defaulted` kept.
      const { natural_effect: _n, ...kept } = was[k]!.provenance ?? {};
      expect(e.provenance, k).toEqual(kept);
      expect(e.provenance_display, k).toEqual(was[k]!.display);
      expect(e.defaulted, k).toBe(true);
    }
    expect(JSON.stringify(edge('capacityQuality')), 'his own link is untouched').toBe(before);
    expect(String(out.follow_up)).toContain('Olumi’s estimates stay marked as Olumi’s, not yours');
  });

  // ⏳ R11 (DL 5873648311): the agreement is to be recorded as REVIEW — Canonical's `reviewed_by_user` — once its writer
  // lands (0 hits on staging `19750c68` at this PR). Until then nothing records it on the link; it never blocks the set.
  it.todo('R11: an agreed Olumi band carries reviewed_by_user (Canonical’s writer), with provenance and defaulted unchanged');

  it('R11 (DL 5873588605): agreeing to Olumi\'s bands moves no leader census and no placeholder reader — only the figures', async () => {
    const { censusConfidenceParameters, semanticQualitySufficient } = await import('../../../src/orchestrator-v5/admission/analysis-admission.js');
    const { classifyEdgeAuthorship } = await import('../../../src/orchestrator-v5/coaching/edge-strength-authorship.js');
    const before = censusConfidenceParameters(persisted);
    const adopted = ['workloadHours', 'qualityHours', 'hoursFocus', 'capacityOverhead', 'aiUseQuality', 'riskQuality', 'overheadQuality'] as const;
    const authorshipBefore = adopted.map((k) => classifyEdgeAuthorship(edge(k) as never));
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf([...STRONG, ...MODERATE]) as never, rationale: 'x' });
    expect((await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) })).ok).toBe(true);
    expect(edge('workloadHours').strength.mean, 'control: the figures did move').toBe(0.55);
    const after = censusConfidenceParameters(persisted);
    // The leader licence reads user-stated parameters: the approval added none.
    expect(after.confidence_parameters_user_stated).toBe(before.confidence_parameters_user_stated);
    expect(after.material_parameters_user_stated).toBe(before.material_parameters_user_stated);
    expect(semanticQualitySufficient(after)).toBe(semanticQualitySufficient(before));
    // The coaching card still reads every adopted link as Olumi-assumed.
    expect(adopted.map((k) => classifyEdgeAuthorship(edge(k) as never))).toEqual(authorshipBefore);
    expect(authorshipBefore.every((a) => a === 'olumi_assumed')).toBe(true);
  });

  /** Paul's graph with his one link put back to Olumi's placeholder, so the leader gate starts SHUT (the DL's probe base). */
  const placeholderBase = () => {
    const e = edge('capacityQuality');
    e.provenance = { source: 'cee_hypothesis' };
    e.defaulted = true;
    delete e.exists_defaulted; delete e.provenance_display; delete (e as { std_defaulted?: unknown }).std_defaulted;
  };
  const userStated = async () => (await import('../../../src/orchestrator-v5/admission/analysis-admission.js'))
    .censusConfidenceParameters(persisted).material_parameters_user_stated;
  const PAUL_STRONG = 'human capacity, delegable workload, delegation quality, and delegated hours effects to strong';

  it('RED (B1, Paul\'s own words "…to strong; all other listed effects to moderate."): naming the band a placeholder sits in is REVIEW — kept, never credited; "all other" names no link', async () => {
    placeholderBase();
    const census0 = await userStated();
    expect(census0, 'the gate starts shut').toBe(0);
    const { caps, ctx } = agent(`set ${PAUL_STRONG}; all other listed effects to moderate.`);
    const links = [
      ...STRONG.map((k) => ({ from_label: L[k][0], to_label: L[k][1], strength: 'strong', from_words: PAUL_STRONG })),
      ...MODERATE.map((k) => ({ from_label: L[k][0], to_label: L[k][1], strength: 'moderate', from_words: 'all other listed effects to moderate' })),
    ];
    const strongBefore = STRONG.map((k) => JSON.stringify(edge(k)));
    const p = await caps.proposeLinkStrengths!(ctx, { links: links as never, rationale: 'the user named the bands' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p.already, JSON.stringify(p)).toHaveLength(4);
    expect(String(p.public_label)).not.toContain('your estimate');
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(STRONG.map((k) => JSON.stringify(edge(k))), 'the in-band "strong" links are byte-identical').toEqual(strongBefore);
    for (const k of MODERATE) {
      expect(Math.abs(edge(k).strength.mean), k).toBe(0.3);
      expect(edge(k).provenance?.source, k).toBe('cee_hypothesis');
      expect(edge(k).defaulted, k).toBe(true);
    }
    expect(await userStated(), 'no confirm and no unnamed band licenses a leader').toBe(0);
  });

  it('CONTROL: a band the user names for a link, in words naming it, that MOVES it is theirs — and is credited', async () => {
    placeholderBase();
    const said = 'The effect of human assistant capacity on delegation quality is very strong.';
    const { caps, ctx } = agent(said);
    const p = await caps.proposeLinkStrengths!(ctx, { links: [{ from_label: L.capacityQuality[0], to_label: L.capacityQuality[1], strength: 'very strong',
      from_words: 'human assistant capacity on delegation quality is very strong' }] as never, rationale: said });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(String(p.public_label)).toContain('your estimate');
    expect((await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) })).ok).toBe(true);
    expect(edge('capacityQuality').strength.mean).toBe(0.85);
    expect(edge('capacityQuality').provenance?.source).toBe('user_specified');
    expect(await userStated()).toBe(1);
  });

  it('RED (B2): an agreement holding band words ("the strong and moderate calls look right") credits no link', async () => {
    placeholderBase();
    const said = 'I\'m aligned with these, the strong and moderate calls look right. Please make these updates.';
    const { caps, ctx } = agent(said);
    const links = [...STRONG, ...MODERATE].map((k) => ({ from_label: L[k][0], to_label: L[k][1], strength: STRONG.includes(k) ? 'strong' : 'moderate',
      from_words: 'the strong and moderate calls look right' }));
    const p = await caps.proposeLinkStrengths!(ctx, { links: links as never, rationale: said });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(String(p.public_label)).not.toContain('your estimate');
    expect((await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) })).ok).toBe(true);
    for (const k of [...STRONG, ...MODERATE]) expect(edge(k).provenance?.source, k).not.toBe('user_specified');
    expect(await userStated()).toBe(0);
  });

  it('RED (B3): a link that became the user\'s own after the proposal is never overwritten — the whole set refuses, 0 rows', async () => {
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(MODERATE) as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    // A canvas confirm since the proposal: mean and direction unchanged, the strength now the user's.
    const e = edge('aiUseQuality');
    e.provenance = { source: 'user_specified' }; e.provenance_display = 'user_set'; delete e.defaulted; e.exists_defaulted = true;
    const before = JSON.stringify(persisted);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(out.mutated).toBe(false);
    expect(String(out.detail)).toContain('"AI assistant use" \u2192 "Delegation quality" became the user\u2019s own strength');
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
  });

  it('RED (stale base): a link moved after the proposal — NOTHING is written, and the model is exactly the moved one', async () => {
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(MODERATE) as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    // Another writer moves one of the set's links after the proposal.
    edge('aiUseQuality').strength.mean = 0.9;
    const moved = JSON.stringify(persisted);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(out.mutated).toBe(false);
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(moved);
  });

  it('RED (a definitional link in the set): the WHOLE set is refused, naming it, and the model is byte-identical', async () => {
    // Hours delegated = workload × quality, declared: both links INTO it are definitions (R3-9), with no Run to withdraw it.
    const g = persisted as { nodes: Record<string, unknown>[] };
    g.nodes.find((n) => n.id === 'routine_work_hours_delegated')!.nonlinear_identity = { operation: 'product', factor_ids: ['delegable_routine_workload', 'delegation_quality'], stated_in_brief: false };
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    // The definition comes LAST, so a writer that committed per link would already have landed the others.
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(['capacityOverhead', 'aiUseQuality', 'riskQuality', 'qualityHours']) as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const before = JSON.stringify(persisted);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(out.mutated).toBe(false);
    expect(String(out.detail)).toContain('"Delegation quality" → "Routine-work hours delegated" is defined by a calculation');
    expect(String(out.detail)).toContain('none of these links was recorded');
    expect(rows.size, 'nothing committed').toBe(0);
    expect(JSON.stringify(persisted), 'byte-identical').toBe(before);
  });

  it('RED (scope): a set that would change anything but its own links — here, drop an identity `NodeV3` cannot parse — writes nothing', async () => {
    // A `sum` identity on the goal, off every link in the set: the raw graph keeps it, the link writer's GraphV3 pass drops it.
    const g = persisted as { nodes: Record<string, unknown>[] };
    g.nodes.find((n) => n.id === 'ability_to_focus_on_high_value_tasks')!.nonlinear_identity = {
      operation: 'sum', factor_ids: ['routine_work_hours_delegated'], addends: ['annual_assistant_tool_cost'], stated_in_brief: false };
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(['capacityOverhead', 'aiUseQuality']) as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const before = JSON.stringify(persisted);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(out.mutated).toBe(false);
    expect(rows.size, 'nothing committed').toBe(0);
    expect(JSON.stringify(persisted), 'byte-identical: the identity is still there').toBe(before);
  });

  it('RED (retry): approving the same set again adds no commit', async () => {
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(MODERATE) as never, rationale: 'x' });
    await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    const after = JSON.stringify(persisted);
    await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(rows.size).toBe(1);
    expect(JSON.stringify(persisted)).toBe(after);
  });

  it('an estimate never replaces a strength the user set: a different band on his own link refuses the whole set, naming it', async () => {
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, {
      links: [{ from_label: 'Human assistant capacity', to_label: 'Delegation quality', strength: 'moderate' }, ...setOf(['aiUseQuality'])] as never, rationale: 'x' });
    expect(p.ok).toBe(false);
    expect(p.refusal).toBe('users_own_strength');
    expect(String(p.detail)).toContain('Nothing was prepared for any of the links.');
  });
});

describe('the link writer never stamps an adopted estimate as the user\'s', () => {
  it('RED: an adoption on a confirm (not a set) is refused with nothing written — it would otherwise take the user\'s stamp', async () => {
    const { applyEdgeStrengthEdit } = await import('../../../src/orchestrator-v5/system-events/edge-strength-edit.js');
    const { runWithApprovedLinkAdoptions } = await import('../../../src/orchestrator-v5/agent-lane/approved-adoption-context.js');
    const g = servedGraph();
    const event = { kind: 'edge_strength_edit', from: 'delegation_quality', to: 'routine_work_hours_delegated', intent: 'confirm_current',
      direction_intent: 'preserve', magnitude: 0.5, expected: { mean: 0.5, effect_direction: 'positive' } };
    const res = await runWithApprovedLinkAdoptions(
      [{ scenarioId: SCENARIO_ID, proposalId: 'p', from: 'delegation_quality', to: 'routine_work_hours_delegated', magnitude: 0.5 }],
      () => applyEdgeStrengthEdit({ payload: { kind: 'system_event', turn_id: 't', scenario_id: SCENARIO_ID, stage: 'frame', event } as never,
        event: event as never, requestId: 'r', persistedGraph: g, lastRunIdentityUse: null }),
    );
    expect(res.kind).toBe('refused');
    expect((res as { reason?: string }).reason).toBe('adopted_estimate_not_a_set');
  });

  it('CONTROL: the same link written with no adoption is the user\'s, exactly as the canvas writes it', async () => {
    const { applyEdgeStrengthEdit } = await import('../../../src/orchestrator-v5/system-events/edge-strength-edit.js');
    const g = servedGraph();
    const event = { kind: 'edge_strength_edit', from: 'delegation_quality', to: 'routine_work_hours_delegated', intent: 'set',
      direction_intent: 'preserve', magnitude: 0.3, expected: { mean: 0.5, effect_direction: 'positive' } };
    const res = await applyEdgeStrengthEdit({ payload: { kind: 'system_event', turn_id: 't', scenario_id: SCENARIO_ID, stage: 'frame', event } as never,
      event: event as never, requestId: 'r', persistedGraph: g, lastRunIdentityUse: null });
    expect(res.kind).toBe('mutated');
    const e = ((res as { mutatedGraph: { edges: Edge[] } }).mutatedGraph.edges).find((x) => x.from === 'delegation_quality' && x.to === 'routine_work_hours_delegated')!;
    expect(e.provenance?.source).toBe('user_specified');
    expect(e.provenance?.magnitude).toBeUndefined();
  });
});
