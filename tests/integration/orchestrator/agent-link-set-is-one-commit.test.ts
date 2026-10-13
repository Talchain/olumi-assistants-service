import type { AgentToolContext } from '../../../src/orchestrator-v5/agent-lane/runtime/agent-tools.js';
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
import { edgeStrengthProvenance, earnsAuthorshipCredit } from '../../../src/cee/graph-readiness/obligation-provenance.js';
import { linkSizing } from '../../../src/cee/magnitude/link-sizing.js';

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
  const agent = (userTurnText: string, store = new ProposalStore(), interaction: Partial<AgentToolContext> = {}) => {
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: currentHash() } });
    doorCalls = 0;
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => { doorCalls += 1; return commitOptionLevelsInProcess(input, 'req-agent'); },
    });
    return { caps, store, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: userTurnText, user_turn_text: userTurnText, ...interaction } };
  };

  it('RED (Paul\'s delegated set: "I\'m aligned with these. Please make these updates."): ONE proposal, ONE commit, every placeholder sized as Olumi\'s accepted estimate (D1)', async () => {
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf([...STRONG, ...MODERATE]) as never, rationale: 'the user agreed to Olumi\'s recommended strengths' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    // His own link already sits in "strong": an estimate never replaces it, and it is said, not written.
    expect(p.already, JSON.stringify(p)).toEqual([expect.stringContaining('"Human assistant capacity" → "Delegation quality" is already strong, as the user set it')]);
    // D1 (DL ruling 12 Oct, Batch D, amending Batch A ruling 1/5 · L4 (c)): a placeholder has no current band, so the
    // three 0.5 defaults Olumi called "strong" are no longer reviews ("Record 4 link strengths and 3 reviews"): all seven
    // are Olumi's first estimates. The count still follows what is stored (A′ (b), AIE text contract #94 6115788987).
    expect(String(p.public_label)).toMatch(/^Record these 7 link strengths: /);
    expect(String(p.public_label)).not.toContain('kept as it is');
    expect(String(p.public_label)).not.toContain('your estimate');
    const before = JSON.stringify(edge('capacityQuality'));
    const agreed = ['workloadHours', 'qualityHours', 'hoursFocus', 'capacityOverhead', 'aiUseQuality', 'riskQuality', 'overheadQuality'] as const;
    const was = Object.fromEntries(agreed.map((k) => [k, JSON.parse(JSON.stringify({ provenance: edge(k).provenance, display: edge(k).provenance_display, strength: edge(k).strength }))])) as Record<string, { provenance?: Record<string, unknown>; display?: string; strength: Edge['strength'] }>;
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'seven links, ONE commit').toBe(1);
    expect(doorCalls, 'ONE door call').toBe(1);
    // D1: Olumi's 0.5 placeholders read "strong" [0.4, 0.7) only because of their default, so approving strong SIZES them
    // at the band's 0.55 midpoint (Batch A ruling 1 kept them at 0.5 as a review, and the link stayed unsized). R3 DEFECT 1
    // still holds for a SIZED link: the next test holds Olumi's sized estimate byte-equal on the same approval.
    for (const k of ['workloadHours', 'qualityHours', 'hoursFocus'] as const) {
      expect(was[k]!.strength.mean, `${k}: precondition, its 0.5 default`).toBe(0.5);
      expect(edge(k).strength.mean, k).toBe(0.55);
    }
    // 0.5 is not "moderate" [0.2, 0.4): those links MOVE, to the band's midpoint.
    for (const k of ['capacityOverhead', 'aiUseQuality'] as const) expect(edge(k).strength.mean, k).toBe(0.3);
    // The negative links stay negative: a set never reverses a link.
    for (const k of ['riskQuality', 'overheadQuality'] as const) {
      expect(edge(k).strength.mean, k).toBe(-0.3);
      expect(edge(k).effect_direction, k).toBe('negative');
    }
    for (const k of ['workloadHours', 'qualityHours', 'hoursFocus', 'capacityOverhead', 'aiUseQuality', 'riskQuality', 'overheadQuality'] as const) {
      const e = edge(k);
      // Agreement is REVIEW (DL ruling 5873648311; #2257's record): every authorship byte kept, `defaulted` kept, and
      // the agreement recorded as `reviewed_by_user` with Olumi's band.
      const { natural_effect: _n, ...kept } = was[k]!.provenance ?? {};
      const { reviewed_by_user: review, ...rest } = (e.provenance ?? {}) as Record<string, unknown>;
      // Batch A rulings 4–5: only a newly adopted different mean sizes a placeholder (D1: every one here is).
      // Authorship (`source`, `reasoning`, display) is still kept byte for byte.
      const unsized = (kept as Record<string, unknown>).magnitude === undefined || (kept as Record<string, unknown>).magnitude === 'olumi_placeholder';
      expect(unsized, `${k}: precondition, a placeholder`).toBe(true);
      expect(rest, k).toEqual({ ...kept, magnitude: 'olumi_estimate' });
      // Every link records Olumi's band it was sized at, as the adoption always has — never stored as the user's.
      expect(review, k).toMatchObject({ intent: 'confirm', band: (STRONG as readonly string[]).includes(k) ? 'strong' : 'moderate' });
      expect(e.provenance_display, k).toEqual(was[k]!.display);
      expect(e.defaulted, k).toBe(true);
    }
    expect(JSON.stringify(edge('capacityQuality')), 'his own link is untouched').toBe(before);
    expect(String(out.follow_up)).toContain('Olumi’s estimates stay marked as Olumi’s, not yours');
    // M1 Accept receipt (Codex pre-review 2 P1): each link STORED as Olumi's accepted estimate says RC's sentence, read off
    // the stored link (never the card), and the boundary shows it whole.
    const { acceptedOlumiEstimateSentence } = await import('../../../src/orchestrator-v5/agent-lane/rerun-explanation.js');
    const { linkSizing } = await import('../../../src/cee/magnitude/link-sizing.js');
    const { withoutAgentDirections } = await import('../../../src/orchestrator-v5/agent-lane/write-outcome.js');
    for (const k of agreed) {
      // D1: no placeholder stays unsized on Olumi's band; each is stored as Olumi's accepted estimate and says so.
      expect(linkSizing(edge(k)), k).toBe('olumi_accepted');
      expect(String(out.follow_up), k).toContain(acceptedOlumiEstimateSentence(`"${L[k][0]}"`, `"${L[k][1]}"`));
    }
    expect(String(out.follow_up).match(/You accepted Olumi's estimate/g)).toHaveLength(7);
    expect(String(out.follow_up)).not.toMatch(/still unsized|review/i);
    expect(String(out.follow_up)).not.toContain('your estimate');
    expect(withoutAgentDirections(String(out.follow_up)).dropped).toEqual([]);
  });

  /**
   * ⛔ R3 DEFECT 1 (5936673643, served dcd72dc3 on CEE b410b1c5): Olumi's estimate ALREADY SIZED inside the band the set
   * names (μ 0.6, σ 0.3, `olumi_estimate` + its `natural_effect`, band strong) was re-set to the band's midpoint (0.55,
   * σ 0.275, `natural_effect` dropped): a no-change approval moved the figure and staled the Run. Approving the band a
   * sized estimate already sits in is a REVIEW: the figure, its spread and Olumi's sizing note are held byte-equal, and
   * only the review is recorded. (A placeholder is not sized, so it has no band to sit in: D1 sizes it, test above.)
   */
  it('RED (R3 DEFECT 1): a SIZED Olumi estimate already in the named band is held byte-equal — the approval records only the review', async () => {
    const e = edge('workloadHours') as Edge & Record<string, unknown>;
    e.strength = { mean: 0.6, std: 0.3 };
    e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
      natural_effect: { amount: 60, amount_unit: 'percentage points', strength_mean: 0.6, per_source_change: 1, strength_mean_frame: 'edge_strength', per_source_change_unit: 'switch' } } as never;
    e.defaulted = true;
    e.effect_direction = 'positive';
    const before = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
    const { caps, ctx } = agent('Keep those as they are.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(['workloadHours']) as never, rationale: 'the user accepts Olumi\'s estimate as it stands' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const after = edge('workloadHours') as Edge & Record<string, unknown>;
    expect(after.strength, 'μ and σ held exactly').toEqual(before.strength);
    const { reviewed_by_user: review, ...provenanceRest } = (after.provenance ?? {}) as Record<string, unknown>;
    expect(provenanceRest, 'Olumi\'s authorship and sizing note held byte-equal').toEqual(before.provenance);
    expect(review).toMatchObject({ intent: 'confirm' });
    const { provenance: _a, ...restAfter } = after;
    const { provenance: _b, ...restBefore } = before;
    expect(restAfter, 'nothing else on the link moved').toEqual(restBefore);
  });

  it('CONTRAST (DEFECT 1, DL): the USER\'s own link sitting in the same band, through the same door, is byte-equal — "already", nothing written', async () => {
    const e = edge('workloadHours') as Edge & Record<string, unknown>;
    e.strength = { mean: 0.6, std: 0.2 };
    e.provenance = { source: 'user_specified' } as never;
    delete e.defaulted;
    e.provenance_display = 'user_set';
    const before = JSON.stringify(e);
    const { caps, ctx } = agent('Keep those as they are.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(['workloadHours', 'capacityOverhead']) as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p.already, JSON.stringify(p)).toEqual(expect.arrayContaining([expect.stringContaining('is already strong, as the user set it')]));
    expect((await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) })).ok).toBe(true);
    expect(JSON.stringify(edge('workloadHours')), 'the user\'s own link is untouched').toBe(before);
    expect(edge('capacityOverhead').strength.mean, 'control: the other link in the set did land').toBe(0.3);
  });

  /**
   * ⛔ #2473 CR (CODEX_CLI_OVERFLOW 5937437431, DL concur): "no-change confirm = byte-equal" held only for Olumi's own
   * confirm. The user NAMING the band a link already sits in ("Keep Delegable routine workload strong", `from_words`)
   * took the user-stated door, and its approval moved σ 0.3 → 0.0866 and staled the Run. Every door, every author.
   */
  const sizedEstimate = () => {
    const e = edge('workloadHours') as Edge & Record<string, unknown>;
    e.strength = { mean: 0.6, std: 0.3 };
    e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
      natural_effect: { amount: 60, amount_unit: 'percentage points', strength_mean: 0.6, per_source_change: 1, strength_mean_frame: 'edge_strength', per_source_change_unit: 'switch' } } as never;
    e.defaulted = true;
    e.effect_direction = 'positive';
    return JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
  };
  // The inspector/review card grounds this shorthand; model argument labels do not.
  const workloadReview = () => ({
    grounded_selection: { element_ids: [], unresolved: 'none' as const },
    grounded_links: [{ from: edge('workloadHours').from, to: edge('workloadHours').to }],
  });
  const NAMED = 'Keep Delegable routine workload strong';
  const named = [{ from_label: L.workloadHours[0], to_label: L.workloadHours[1], strength: 'strong', from_words: NAMED }];
  const expectHeldByteEqual = (before: Record<string, unknown>, hashBefore: string) => {
    const after = edge('workloadHours') as Edge & Record<string, unknown>;
    expect(after.strength, 'μ and σ held exactly (σ was once the band\'s spread, 0.0866)').toEqual(before.strength);
    const { reviewed_by_user: review, ...provenanceRest } = (after.provenance ?? {}) as Record<string, unknown>;
    expect(provenanceRest, 'Olumi\'s authorship and natural_effect held byte-equal').toEqual(before.provenance);
    expect(review, 'the review records the band the user named').toMatchObject({ intent: 'confirm', band: 'strong' });
    const { provenance: _a, ...restAfter } = after;
    const { provenance: _b, ...restBefore } = before;
    expect(restAfter, 'nothing else on the link moved').toEqual(restBefore);
    expect(currentHash(), 'the analysis hash did not move: the Run is not staled').toBe(hashBefore);
  };

  it('RED (#2473 P1, chat words): the user NAMES the band a sized estimate already sits in — approval holds it byte-equal', async () => {
    const before = sizedEstimate();
    const hashBefore = currentHash();
    const { caps, ctx } = agent(NAMED, undefined, workloadReview());
    const p = await caps.proposeLinkStrengths!(ctx, { links: named as never, rationale: 'the user named the band it already sits in' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    // M1 Accept receipt (Codex pre-review P2): naming the band is review, so the kept figure stays Olumi's — never "yours".
    expect((p as unknown as { links: { whose: unknown; keeps_current_strength: unknown }[] }).links)
      .toEqual([expect.objectContaining({ whose: 'Olumi\u2019s estimate', keeps_current_strength: true })]);
    expect(String(p.note)).toContain('is never the user\u2019s own (`whose`)');
    // The approval both the chip and a typed "yes" reach (`authorise_change`).
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expectHeldByteEqual(before, hashBefore);
    // M1 Accept receipt (Codex pre-review 2 P1): stored olumi_accepted → RC's sentence; never "reviewed by you" alone.
    expect(out.follow_up).toBe('Recorded this link strength: "Delegable routine workload" \u2192 "Routine-work hours delegated" as strong. '
      + 'You accepted Olumi\'s estimate for how much "Delegable routine workload" changes "Routine-work hours delegated".');
  });

  it('RED (#2473 P1, restored proposal): the same named-band approval, restored into a fresh process, holds it byte-equal', async () => {
    const { proposalPendingAction, rehydrateProposals } = await import('../../../src/orchestrator-v5/agent-lane/durable-proposal.js');
    const before = sizedEstimate();
    const hashBefore = currentHash();
    const first = agent(NAMED, undefined, workloadReview());
    const p = await first.caps.proposeLinkStrengths!(first.ctx, { links: named as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const offered = first.store.get(String(p.proposal_id))!;
    const pending = proposalPendingAction(offered, { id: 'agent-approve-proposal:x', label: 'Approve', message: 'Approve' } as never,
      { scenario_id: SCENARIO_ID, emitted_at_iso: new Date().toISOString() });
    const second = agent(NAMED);
    expect(second.store.get(String(p.proposal_id)), 'precondition: the fresh process does not hold it').toBeUndefined();
    expect(rehydrateProposals([pending], second.store, { scenario_id: SCENARIO_ID, user_id: 'user-a' }), 'restored').toBe(1);
    const out = await second.caps.authoriseChange(second.ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expectHeldByteEqual(before, hashBefore);
  });

  it('CONTRAST (#2473 P1, chat words): the USER\'s own link, named in the band it sits in, is "already" — nothing written', async () => {
    const e = edge('workloadHours') as Edge & Record<string, unknown>;
    e.strength = { mean: 0.6, std: 0.3 };
    e.provenance = { source: 'user_specified' } as never;
    delete e.defaulted;
    e.provenance_display = 'user_set';
    const before = JSON.stringify(e);
    const { caps, ctx } = agent(NAMED);
    const p = await caps.proposeLinkStrengths!(ctx, { links: [...named, ...setOf(['capacityOverhead'])] as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p.already, JSON.stringify(p)).toEqual(expect.arrayContaining([expect.stringContaining('is already strong, as the user set it')]));
    expect((await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) })).ok).toBe(true);
    expect(JSON.stringify(edge('workloadHours')), 'the user\'s own link is untouched').toBe(before);
    expect(edge('capacityOverhead').strength.mean, 'control: the other link in the set did land').toBe(0.3);
  });

  it('CONTROL (M1 Accept receipt, Codex pre-review 3 P1): a model-proposed link the sizer never marked, kept in its band → stored unmarked → no authorship claim', async () => {
    const e = edge('workloadHours') as Edge & Record<string, unknown>;
    e.strength = { mean: 0.55, std: 0.3 };
    e.provenance = { source: 'cee_hypothesis' } as never;
    delete e.defaulted;
    e.effect_direction = 'positive';
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(['workloadHours']) as never, rationale: 'agreed' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const { linkSizing } = await import('../../../src/cee/magnitude/link-sizing.js');
    expect(linkSizing(edge('workloadHours'))).toBe('unmarked');
    expect(out.follow_up).toBe('Recorded this link strength: "Delegable routine workload" \u2192 "Routine-work hours delegated" as strong.');
  });

  it('CONTROL (#2473): a named band that MOVES the link still writes it — the user\'s band, its spread', async () => {
    sizedEstimate();
    const words = 'Make Delegable routine workload very strong';
    const { caps, ctx } = agent(words, undefined, workloadReview());
    const p = await caps.proposeLinkStrengths!(ctx, { links: [{ ...named[0], strength: 'very strong', from_words: words }] as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(Math.abs(edge('workloadHours').strength.mean), 'moved to the very-strong band').toBeGreaterThanOrEqual(0.7);
    expect(edge('workloadHours').strength.std, 'a band that moves the link stores its spread').not.toBe(0.3);
    // CONTROL (M1 Accept receipt): stored as the user's → "your estimate", and no accept sentence.
    expect(out.follow_up).toBe('Recorded this link strength: "Delegable routine workload" \u2192 "Routine-work hours delegated" as very strong, your estimate.');
  });

  it('R11 × P1-a (Canonical 5874263009, DL 5874274221): the band the user agreed to is their settled view — the magnitude contract never re-sizes it', async () => {
    const { frameDefaultedLinks } = await import('../../../src/cee/magnitude/frame-defaulted-links.js');
    // Science 393023 LICENCE (a)/(b), 7 Oct: std 0.125 → 0.1 on this test clone keeps R11's actual re-sizing control.
    // A magnitude-contract placeholder, as a served draft stamps it.
    const e = edge('capacityOverhead');
    e.strength.std = 0.1;
    e.provenance = { ...(e.provenance ?? {}), magnitude: 'olumi_placeholder' };
    const id = 'human_assistant_capacity::assistant_coordination_overhead';
    // CONTROL: before the approval, a level move on "Human assistant capacity" re-sizes this placeholder (the value writer's own step).
    expect(frameDefaultedLinks(persisted, 'human_assistant_capacity').sized, 'control: re-sized while it is only a placeholder').toContain(id);
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(['capacityOverhead']) as never, rationale: 'x' });
    expect((await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) })).ok).toBe(true);
    expect(edge('capacityOverhead').strength.mean).toBe(0.3);
    expect((edge('capacityOverhead').provenance as Record<string, unknown>).reviewed_by_user).toMatchObject({ intent: 'confirm', band: 'moderate' });
    expect(frameDefaultedLinks(persisted, 'human_assistant_capacity').sized, 'the agreed band is never re-sized').not.toContain(id);
  });

  it('Science 393023: a served door default with no size change has no false re-sizing receipt', async () => {
    const { frameDefaultedLinks } = await import('../../../src/cee/magnitude/frame-defaulted-links.js');
    const e = edge('capacityOverhead');
    e.provenance = { ...(e.provenance ?? {}), magnitude: 'olumi_placeholder' };
    const before = JSON.stringify(e);
    expect(frameDefaultedLinks(persisted, 'human_assistant_capacity').sized).not.toContain('human_assistant_capacity::assistant_coordination_overhead');
    expect(JSON.stringify(e)).toBe(before);
  });

  it('RED (B3, review): a link the user REVIEWED after the proposal (a canvas confirm writes only that stamp) is not changed — 0 rows', async () => {
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(MODERATE) as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const e = edge('aiUseQuality');
    e.provenance = { ...(e.provenance ?? {}), reviewed_by_user: { intent: 'confirm', at: '2026-09-28T16:40:00.000Z' } } as never;
    const before = JSON.stringify(persisted);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(String(out.detail)).toContain('"AI assistant use" \u2192 "Delegation quality" was reviewed by the user after this was prepared');
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
  });

  it('R11 (DL 5873588605): agreeing to Olumi\'s bands moves no leader census and no placeholder reader — only the figures', async () => {
    const { censusConfidenceParameters, semanticQualitySufficient } = await import('../../../src/orchestrator-v5/admission/analysis-admission.js');
    const { edgeStrengthProvenance, edgeReviewedByUser } = await import('../../../src/cee/graph-readiness/obligation-provenance.js');
    const before = censusConfidenceParameters(persisted);
    const adopted = ['workloadHours', 'qualityHours', 'hoursFocus', 'capacityOverhead', 'aiUseQuality', 'riskQuality', 'overheadQuality'] as const;
    const authorshipBefore = adopted.map((k) => edgeStrengthProvenance(edge(k)));
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf([...STRONG, ...MODERATE]) as never, rationale: 'x' });
    expect((await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) })).ok).toBe(true);
    // Control: the figures that left their band did move (moderate → 0.3); the ones already in "strong" are kept (DEFECT 1).
    expect(edge('capacityOverhead').strength.mean, 'control: the figures did move').toBe(0.3);
    const after = censusConfidenceParameters(persisted);
    // The leader licence reads user-stated parameters: the approval added none.
    expect(after.confidence_parameters_user_stated).toBe(before.confidence_parameters_user_stated);
    expect(after.material_parameters_user_stated).toBe(before.material_parameters_user_stated);
    expect(semanticQualitySufficient(after)).toBe(semanticQualitySufficient(before));
    // R11's own authorship reader: every adopted link is still Olumi's size — reviewed, never authored.
    expect(adopted.map((k) => edgeStrengthProvenance(edge(k)))).toEqual(authorshipBefore);
    expect(authorshipBefore.every((a) => a === 'ai_drafted')).toBe(true);
    expect(adopted.every((k) => edgeReviewedByUser(edge(k)))).toBe(true);
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

  it('RED (B1 × D1, Paul\'s own words "…to strong; all other listed effects to moderate."): UNBOUND list supplies no exact link; placeholders remain Olumi estimates and a sized link stays a review', async () => {
    placeholderBase();
    const census0 = await userStated();
    expect(census0, 'the gate starts shut').toBe(0);
    const { censusConfidenceParameters } = await import('../../../src/orchestrator-v5/admission/analysis-admission.js');
    const confidenceUserStated = (): number => censusConfidenceParameters(persisted).confidence_parameters_user_stated;
    const confidence0 = confidenceUserStated();
    const { caps, ctx } = agent(`set ${PAUL_STRONG}; all other listed effects to moderate.`);
    const links = [
      ...STRONG.map((k) => ({ from_label: L[k][0], to_label: L[k][1], strength: 'strong', from_words: PAUL_STRONG })),
      ...MODERATE.map((k) => ({ from_label: L[k][0], to_label: L[k][1], strength: 'moderate', from_words: 'all other listed effects to moderate' })),
    ];
    // His own link, put back unmarked (`placeholderBase`), is not a placeholder: naming its band stays a REVIEW (#2257).
    // T2A2: no review card or per-link pair binds this list. The three 0.5 placeholders
    // still get sized under D1, but the model's proposed pairs remain Olumi's estimates.
    const NAMED_PLACEHOLDERS = ['workloadHours', 'qualityHours', 'hoursFocus'] as const;
    for (const k of NAMED_PLACEHOLDERS) expect(linkSizing(edge(k)), `${k}: precondition`).toBe('placeholder');
    expect(linkSizing(edge('capacityQuality')), 'precondition: not a placeholder').not.toBe('placeholder');
    const reviewedBefore = { mean: edge('capacityQuality').strength.mean, source: edge('capacityQuality').provenance?.source, defaulted: edge('capacityQuality').defaulted };
    const p = await caps.proposeLinkStrengths!(ctx, { links: links as never, rationale: 'the user named the bands' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    for (const k of NAMED_PLACEHOLDERS) expect(String(p.public_label), k).toContain(`"${L[k][0]}" \u2192 "${L[k][1]}" as strong, an estimate from Olumi that has not yet been applied`);
    expect(String(p.public_label)).not.toContain('kept as it is');
    expect(String(p.public_label), 'band words only (AIQ 5923931082)').not.toMatch(/\d\.\d|0–1|scale/);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    // The in-band pick on a link that is not a placeholder is REVIEW (#2257): figure, source and default flag unchanged.
    expect({ mean: edge('capacityQuality').strength.mean, source: edge('capacityQuality').provenance?.source, defaulted: edge('capacityQuality').defaulted }).toEqual(reviewedBefore);
    expect((edge('capacityQuality').provenance as Record<string, unknown>).reviewed_by_user).toMatchObject({ intent: 'confirm' });
    expect((edge('capacityQuality').provenance as { reviewed_by_user: { band?: unknown } }).reviewed_by_user.band).toBeUndefined();
    for (const k of NAMED_PLACEHOLDERS) {
      expect(edge(k).strength.mean, k).toBe(0.55);
      expect(linkSizing(edge(k)), k).toBe('olumi_accepted');
    }
    for (const k of MODERATE) {
      expect(Math.abs(edge(k).strength.mean), k).toBe(0.3);
      expect(edge(k).provenance?.source, k).toBe('cee_hypothesis');
      expect(edge(k).defaulted, k).toBe(true);
    }
    // Approval adopts estimates; the unbound list earns no authorship credit.
    expect(confidenceUserStated(), 'no exact link was bound by the user').toBe(confidence0);
    expect(await userStated(), 'the leader gate stays shut').toBe(0);
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

  const projectedPriceRevenue = () => {
    const e = edge('capacityQuality');
    e.strength = { mean: 0.5, std: 0.125 };
    e.effect_direction = 'positive';
    e.provenance = { source: 'user_specified', mean_projected: true } as never;
    delete e.defaulted;
    const nodes = (persisted as { nodes: { id: string; label: string }[] }).nodes;
    nodes.find(n => n.id === e.from)!.label = 'Price';
    nodes.find(n => n.id === e.to)!.label = 'Revenue';
    expect(linkSizing(e), 'identity: the drawn Price → Revenue prior is not user-sized').toBe('placeholder');
    return JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
  };

  it('RED (R7 finding 3 × D1, plural approval door): Price → Revenue same-band words SIZE the drawn placeholder as the user\'s band, never keep its 0.5 projection', async () => {
    const before = projectedPriceRevenue();
    const hashBefore = currentHash();
    const words = 'Price is strong.';
    // The user has the drawn link selected (DGAI `selected_elements` → the host-resolved `grounded_links`).
    const drawn = edge('capacityQuality');
    const { caps, ctx, store } = agent(words, undefined, { grounded_selection: { element_ids: [], unresolved: 'none' },
      grounded_links: [{ from: drawn.from, to: drawn.to }] });
    const p = await caps.proposeLinkStrengths!(ctx, { links: [{ from_label: 'Price', to_label: 'Revenue',
      strength: 'strong', from_words: words }], rationale: words });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const proposal = store.get(String(p.proposal_id))!;
    expect(proposal.scenario_id).toBe(SCENARIO_ID);
    expect(proposal.operations).toEqual([expect.objectContaining({ op: 'set_link_strength', path: `${edge('capacityQuality').from}::${edge('capacityQuality').to}`,
      value: expect.objectContaining({ magnitude: 0.55, intent: 'set', band: 'strong', author: 'user_stated' }) })]);
    // Science 393023 LICENCE ruling 3: the projected μ=0.5 is nobody's size (never the user's for being drawn by them).
    // D1 (DL 12 Oct, Batch D): so it has no current band either, and the band the user named in their own words sizes it
    // as theirs, at the band's midpoint (was: a review keeping 0.5/0.125 unsized). Olumi's band on the same link stays a
    // review, with no credit: the NEGATIVE (D1) test.
    const out = await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'one approval, one commit').toBe(1);
    expect(doorCalls).toBe(1);
    const after = edge('capacityQuality') as Edge & Record<string, unknown>;
    expect(before.strength).toStrictEqual({ mean: 0.5, std: 0.125 });
    expect(after.strength.mean).toBe(0.55);
    expect(after.provenance).not.toHaveProperty('mean_projected');
    expect(linkSizing(after)).toBe('user');
    expect(earnsAuthorshipCredit(edgeStrengthProvenance(after))).toBe(true);
    expect(currentHash(), 'a size moves the analysis identity').not.toBe(hashBefore);
    expect(String(out.follow_up)).toContain('as strong, your estimate');
  });

  it('T2A2: Price is strong. without a current drawn/reviewed link cannot borrow the stored drawing provenance', async () => {
    projectedPriceRevenue();
    const before = JSON.stringify(edge('capacityQuality'));
    const words = 'Price is strong.';
    const { caps, ctx, store } = agent(words);
    const p = await caps.proposeLinkStrengths!(ctx, { links: [{ from_label: 'Price', to_label: 'Revenue',
      strength: 'strong', from_words: words }], rationale: words });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(store.get(String(p.proposal_id))!.operations).toEqual([expect.objectContaining({
      value: expect.objectContaining({ author: 'model_proposed', intent: 'confirm_current', magnitude: 0.5 }),
    })]);
    expect(p.public_label).toBe('Record 1 review: "Price" → "Revenue", whose strength nobody has set yet (kept as it is)');
    expect(JSON.stringify(edge('capacityQuality'))).toBe(before);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(linkSizing(edge('capacityQuality'))).toBe('placeholder');
    expect(earnsAuthorshipCredit(edgeStrengthProvenance(edge('capacityQuality')))).toBe(false);
  });

  it('RED (R7 class reader): the adopted-strength door does not refuse projected Price → Revenue as the user’s own; genuine user-sized control refuses', async () => {
    projectedPriceRevenue();
    const link = edge('capacityQuality');
    const request = (turnId: string) => ({ scenario_id: SCENARIO_ID, base_graph_hash: currentHash(),
      turn_id: turnId, links: [], levels: [],
      link_strengths: [{ from: link.from, to: link.to, magnitude: 0.3, band: 'moderate' as const, intent: 'set' as const,
        author: 'model_proposed' as const, expected: { mean: 0.5, effect_direction: 'positive' as const } }] });
    // Science 393023 LICENCE ruling 3, re-derived:
    // source=user_specified + mean_projected used to trigger link_became_users_own; canonical sizing says placeholder,
    // so the real approved-strength writer may apply the offered band, still without user credit.
    const out = await commitOptionLevelsInProcess(request('33333333-3333-4333-8333-3333333333a7'), 'r7-projected-adoption');
    expect(out.status, JSON.stringify(out)).toBe('committed');
    expect(rows.size).toBe(1);
    expect(edge('capacityQuality').strength.mean).toBe(0.3);
    expect((edge('capacityQuality').provenance as Record<string, unknown>).reviewed_by_user).toMatchObject({ intent: 'confirm', band: 'moderate' });
    expect(linkSizing(edge('capacityQuality')), 'the projected structural origin remains fail-closed, never user-sized').toBe('placeholder');
    expect(earnsAuthorshipCredit(edgeStrengthProvenance(edge('capacityQuality')))).toBe(false);

    persisted = servedGraph();
    rows.clear();
    const userLink = edge('capacityQuality');
    userLink.strength = { mean: 0.5, std: 0.125 };
    userLink.effect_direction = 'positive';
    userLink.provenance = { source: 'user_specified' };
    delete userLink.defaulted;
    expect(linkSizing(userLink), 'CONTROL: source=user_specified without projection is user-sized').toBe('user');
    const before = JSON.stringify(persisted);
    const refused = await commitOptionLevelsInProcess(request('33333333-3333-4333-8333-3333333333b7'), 'r7-user-adoption-control');
    expect(refused).toMatchObject({ status: 'refused', reason: 'link_became_users_own' });
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
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
    // Since schemas 0.62.0 (projection v3) who sized a link (`provenance.source`) is an analysis-hash input, so this
    // canvas confirm MOVES THE BASE and the approval is refused whole at the base check — as a moved strength or a new
    // definition is (rows below) — before the per-link "became the user's own strength" check is reached. The
    // invariants are the point: nothing is written and the model is byte-identical.
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

  it('RED (a link becomes definitional AFTER the set was prepared): the approval is refused whole (the base moved) and the model is byte-identical', async () => {
    // The proposer leaves out links an identity in use defines (agent-link-set-leaves-out-definitional.test.ts); the writer
    // stays the backstop when one is declared between the proposal and the approval.
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    // The definition comes LAST, so a writer that committed per link would already have landed the others.
    const p = await caps.proposeLinkStrengths!(ctx, { links: setOf(['capacityOverhead', 'aiUseQuality', 'riskQuality', 'qualityHours']) as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    // Hours delegated = workload × quality, declared now: both links INTO it are definitions (R3-9), with no Run to withdraw it.
    const g = persisted as { nodes: Record<string, unknown>[] };
    g.nodes.find((n) => n.id === 'routine_work_hours_delegated')!.nonlinear_identity = { operation: 'product', factor_ids: ['delegable_routine_workload', 'delegation_quality'], stated_in_brief: false };
    const before = JSON.stringify(persisted);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(out.mutated).toBe(false);
    // Declaring the identity moved the analysis-affecting hash, so the approval's stale-base check refuses before the
    // writer's own definitional backstop is reached — either way, nothing lands.
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

  /**
   * ⭐ D1: A PLACEHOLDER HAS NO CURRENT BAND (DL ruling 12 Oct, recovery Batch D, amending Batch A ruling 1/5 · L4 (c) for
   * this case only). Served run 3 (2026-10-12T153555Z, hiring, CEE 3fdf0f38): the Agent proposed "strong" for the decisive
   * link "Tech leads hired" → "Leadership capacity". Its 0.5 default sits in "strong", so the chip said "(kept as it is)",
   * the approval recorded a review only, the link stayed a placeholder and every hiring chance stayed withheld
   * (`decisive-link/DIAGNOSIS.md` §1). The fixture is that served pre-approval read, the served user words and the served
   * three bands; the approval runs through the real door.
   */
  it('RED (D1, served run-3 hiring): Olumi\'s band for the decisive placeholder SIZES it as Olumi\'s accepted estimate, never "kept as it is", never its 0.5', async () => {
    const HIRING = JSON.parse(readFileSync(new URL('../../fixtures/batch-d/served-hiring-run3-20261012T153555Z.json', import.meta.url), 'utf8')) as {
      before: { graph: { nodes: { id: string; label: string }[] } }; served_user_message: string; served_chip_detail: string;
      served_ops: { from_id: string; to_id: string; band: string }[]; decisive_link_after_served_approval: Edge };
    persisted = structuredClone(HIRING.before.graph);
    const label = (id: string): string => HIRING.before.graph.nodes.find((n) => n.id === id)!.label;
    const decisive = () => edgeOf('tech_leads_hired', 'leadership_capacity');
    expect(linkSizing(decisive()), 'precondition: the decisive link is a placeholder').toBe('placeholder');
    expect(decisive().strength.mean, 'precondition: its default sits in "strong"').toBe(0.5);
    const hashBefore = currentHash();
    const { caps, ctx } = agent(HIRING.served_user_message);
    const p = await caps.proposeLinkStrengths!(ctx, { rationale: 'served run 3', links: HIRING.served_ops.map((o) =>
      ({ from_label: label(o.from_id), to_label: label(o.to_id), strength: o.band })) as never });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    // RED on staging 9bac9729: byte-equal to the served chip ("… (kept as it is)", review only).
    expect(String(p.public_label)).not.toBe(HIRING.served_chip_detail);
    expect(String(p.public_label)).toBe('Record these 3 link strengths: '
      + '"Tech leads hired" \u2192 "Leadership capacity" as strong, an estimate from Olumi that has not yet been applied; '
      + '"Developers hired" \u2192 "Code quality degradation" as slight, an estimate from Olumi that has not yet been applied; '
      + '"Code quality degradation" \u2192 "productivity" as moderate, an estimate from Olumi that has not yet been applied');
    expect((p as unknown as { links: Record<string, unknown>[] }).links[0]).toMatchObject({ from: 'Tech leads hired', to: 'Leadership capacity',
      becomes: { band: 'strong' }, whose: 'Olumi\u2019s first estimate for a link nobody had sized', keeps_current_strength: false,
      sizing_after_approval: 'olumi_accepted' });
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'one approval, one commit').toBe(1);
    // Bound by identity: the decisive link, stored as Olumi's accepted estimate at the band's midpoint.
    expect(linkSizing(decisive()), 'was placeholder after the served approval').toBe('olumi_accepted');
    expect(linkSizing(HIRING.decisive_link_after_served_approval), 'control: the served approval left it a placeholder').toBe('placeholder');
    expect(decisive().strength.mean).toBe(0.55);
    expect(decisive().provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm', band: 'strong' } });
    expect(decisive().provenance).not.toHaveProperty('mean_projected');
    expect(currentHash(), 'a new size moves the analysis identity, so the Run is stale and a new Run is needed').not.toBe(hashBefore);
    const { acceptedOlumiEstimateSentence } = await import('../../../src/orchestrator-v5/agent-lane/rerun-explanation.js');
    expect(String(out.follow_up)).toContain(acceptedOlumiEstimateSentence('"Tech leads hired"', '"Leadership capacity"'));
    expect(String(out.follow_up)).not.toMatch(/still unsized|kept as it is|your estimate/);
    // Nothing ever stamps a placeholder's default as an estimate: every link this approval sized moved off its default.
    const was = (HIRING.before.graph as unknown as { edges: Edge[] }).edges;
    const sized = (persisted as { edges: Edge[] }).edges.filter((e) => linkSizing(was.find((w) => w.from === e.from && w.to === e.to)) === 'placeholder'
      && linkSizing(e) !== 'placeholder');
    expect(sized.map((e) => `${e.from}->${e.to}`).sort()).toEqual(HIRING.served_ops.map((o) => `${o.from_id}->${o.to_id}`).sort());
    for (const e of sized) expect(e.strength.mean, `${e.from}->${e.to}`).not.toBe(was.find((w) => w.from === e.from && w.to === e.to)!.strength.mean);
  });

  it('NEGATIVE (D1): where the approval cannot size a placeholder, Olumi\'s band stays a review: a link the user drew, and a default already AT the midpoint', async () => {
    projectedPriceRevenue();
    const midpointDefault = edge('workloadHours');
    midpointDefault.strength = { mean: 0.55, std: 0.125 };
    midpointDefault.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true } as never;
    const before = JSON.parse(JSON.stringify(persisted)) as { edges: Edge[] };
    const hashBefore = currentHash();
    const { caps, ctx } = agent('I\'m aligned with these. Please make these updates.');
    const p = await caps.proposeLinkStrengths!(ctx, { links: [{ from_label: 'Price', to_label: 'Revenue', strength: 'strong' },
      ...setOf(['workloadHours'])] as never, rationale: 'x' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(String(p.public_label)).toMatch(/^Record 2 reviews: /);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    for (const k of ['capacityQuality', 'workloadHours'] as const) {
      const was = before.edges.find((e) => e.from === edge(k).from && e.to === edge(k).to)!;
      expect(edge(k).strength, k).toStrictEqual(was.strength);
      expect(linkSizing(edge(k)), k).toBe('placeholder');
      const { reviewed_by_user: review, ...kept } = edge(k).provenance as Record<string, unknown>;
      expect(review, k).toMatchObject({ intent: 'confirm' });
      expect(kept, k).toStrictEqual(was.provenance);
      expect(earnsAuthorshipCredit(edgeStrengthProvenance(edge(k))), k).toBe(false);
    }
    expect(currentHash(), 'a review keeps the analysis identity').toBe(hashBefore);
  });

  it('NEGATIVE (D1): a plain confirm of a placeholder (no band, the canvas\'s confirm) is a review and stays unsized; its 0.5 is never an estimate', async () => {
    const { applyEdgeStrengthEdit } = await import('../../../src/orchestrator-v5/system-events/edge-strength-edit.js');
    const g = servedGraph() as { edges: Edge[] };
    const e0 = g.edges.find((x) => x.from === 'delegation_quality' && x.to === 'routine_work_hours_delegated')!;
    expect(linkSizing(e0), 'precondition: a placeholder').toBe('placeholder');
    const event = { kind: 'edge_strength_edit', from: 'delegation_quality', to: 'routine_work_hours_delegated', intent: 'confirm_current',
      direction_intent: 'preserve', magnitude: 0.5, expected: { mean: 0.5, effect_direction: 'positive' } };
    const res = await applyEdgeStrengthEdit({ payload: { kind: 'system_event', turn_id: 't', scenario_id: SCENARIO_ID, stage: 'frame', event } as never,
      event: event as never, requestId: 'r', persistedGraph: g, lastRunIdentityUse: null });
    expect(res.kind, JSON.stringify(res)).toBe('mutated');
    const e = ((res as { mutatedGraph: { edges: Edge[] } }).mutatedGraph.edges).find((x) => x.from === 'delegation_quality' && x.to === 'routine_work_hours_delegated')!;
    expect(e.strength).toStrictEqual(e0.strength);
    expect(linkSizing(e)).toBe('placeholder');
    expect(e.provenance?.magnitude).not.toBe('olumi_estimate');
    expect((e.provenance as Record<string, unknown>).reviewed_by_user).toMatchObject({ intent: 'confirm' });
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
      [{ scenarioId: SCENARIO_ID, proposalId: 'p', from: 'delegation_quality', to: 'routine_work_hours_delegated', magnitude: 0.5, band: 'strong' }],
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
