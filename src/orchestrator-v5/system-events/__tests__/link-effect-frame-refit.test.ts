/**
 * ⭐ S5t — A FRAME NARROWER THAN THE USER'S STATED SIZE IS REFIT, NEVER A REFUSAL (DL; Science d5 to rule; Integrator class).
 * Served investor journey (Acceptance stg2, CEE d40fd7b, wire turn-008): "Every 1 percentage point more of Enterprise win
 * rate adds about £40,000 per quarter" was REFUSED as not representable. β = (40,000 / 3,500,000) / (1 / 100) = 1.14 on
 * the goal's £3.5M frame. The SAME sentence in a brief would fit: construction runs `refitFramesForStatedEffects`, which
 * widens the target's frame (a choice of UNITS) with every natural effect unchanged. Fixture: the turn-007 draft graph.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { prepareLinkEffectUnitReadings } from '../link-effect-unit-reading.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../link-effect-edit.js';
import { convertLinkEffect } from '../../../cee/magnitude/link-effect.js';
import { clampForPersist, refitFramesForStatedEffects } from '../../agent-lane/refit-frames.js';
import { linkEffectRefusalWords } from '../../agent-lane/runtime/agent-capabilities.js';
import { executeOptionInterventionBatch, linkEffectRefitPostimageIsScoped } from '../option-intervention-edit.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { approvalChipsFor } from '../../agent-lane/approval-chips.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../dispatch.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';

type Rec = Record<string, any>;
const FIXTURE = (): Rec => JSON.parse(readFileSync(new URL('./fixtures/s5t-investor-stg2-turn007-graph.json', import.meta.url), 'utf8'));
/** The fixture as the store HOLDS it (projected, every entity ref issued), the base a real commit reads. */
const STORED = (): Rec => assignEntityRefs(projectGraphForPersistence(FIXTURE()), { nodes: [], edges: [] }).graph as Rec;
const S5T = { amount: 40000, amount_unit: 'GBP/quarter', per_source_change: 1, per_source_change_unit: 'percentage points' } as const;
const QUOTE = 'Every 1 percentage point more of Enterprise win rate adds about £40,000 per quarter.';
function write(g: Rec, from = 'enterprise_win_rate', to = 'quarterly_revenue', effect: Rec = S5T, quote = QUOTE, frameRefit: boolean = true) {
  const p = { persistedGraph: g, from, to, effect: effect as never, quote,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, from, to)! } };
  return applyLinkEffectEdit({ ...p, reading_token: linkEffectReadingToken(p), ...(frameRefit ? { frameRefit: true as const } : {}) });
}
/** A stored base construction would ALREADY refit: a sibling the user sized at −£15,000 per point, stored clamped at −1. */
function baseWithAnotherCut(): Rec {
  const g = FIXTURE();
  const e = g.edges.find((x: Rec) => x.from === 'integration_step_abandonment_rate' && x.to === 'quarterly_revenue');
  const beta = convertLinkEffect(-150000, 1, 3500000, 100)!;
  e.strength = { ...e.strength, mean: -1 };
  e.provenance = { source: 'user_specified', magnitude: 'user_stated', clamped_from: beta, natural_effect: { amount: -150000,
    amount_unit: 'GBP/quarter', per_source_change: 1, per_source_change_unit: '%', strength_mean: beta, strength_mean_frame: 'edge_strength' } };
  return g;
}
const edge2 = (g: Rec, from: string, to: string): Rec => g.edges.find((x: Rec) => x.from === from && x.to === to);
const frameOfNode = (n: Rec): number => n.scale_frame ?? n.observed_state?.cap ?? n.goal_threshold_cap;
/** A link's natural size per one source unit, read off its β and the two frames: β · F_target / F_source. */
const naturalPerUnit = (g: Rec, e: Rec): number => {
  const byId = new Map(g.nodes.map((n: Rec) => [n.id, n]));
  return e.strength.mean * frameOfNode(byId.get(e.to) as Rec) / frameOfNode(byId.get(e.from) as Rec);
};

const SCENARIO = '0c6dcb3d-de66-4b46-8860-4b7dce0bb107';
const ctxSaying = (user_text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 's5t', user_text });
/** The real proposer, card, approval and commit door over a serialized SessionStore (as link-effect-size-by-chat's world). */
function world(initial: Rec) {
  let graphJson = JSON.stringify(initial);
  const graph = () => JSON.parse(graphJson) as Rec;
  const proposals = new ProposalStore();
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [],
    readAnalysisInvalidatedAt: async () => null,
    getScenarioOwner: async () => null,
    append: async (write) => {
      const stored = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      const id = `s5t-row-${rows.length + 1}`;
      rows.push({ id, write: stored });
      if (stored.graph !== undefined) graphJson = JSON.stringify(stored.graph);
      return { id };
    },
    readRecent: async () => rows.map(({ id, write }) => makeSessionTurnRow({ id, scenario_id: write.scenario_id,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id,
      request_hash: write.request_hash, response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((row) => ids.includes(row.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-06T00:00:00.000Z', fact }))),
  });
  const commits: CommitOptionLevelsInput[] = [];
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    const out = await executeOptionInterventionBatch({ scenarioId: input.scenario_id, turnId: input.turn_id,
      requestId: 's5t-real-commit', requestHash: `s5t:${input.turn_id}`, stage: 'frame',
      freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.link_effect !== undefined ? { linkEffect: input.link_effect } : {}),
      ...(input.link_effects !== undefined ? { linkEffects: input.link_effects } : {}),
    }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind !== 'committed') throw new Error(`Real commit did not verify: ${JSON.stringify(out)}`);
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false,
      committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    const read = graph();
    return { status: 200, json: { graph: read, graph_hash: computeAnalysisAffectingGraphHash(read as never) } };
  };
  return { caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels }), proposals, commits, graph };
}

describe('S5t: the chat writer refits the frame a stated size needs, exactly as construction does', () => {
  it('RED: £40,000 per point of win rate is RECORDED (the goal frame widens), never refused as not representable', () => {
    const r = write(FIXTURE());
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const e = (r.mutatedGraph as Rec).edges.find((x: Rec) => x.from === 'enterprise_win_rate' && x.to === 'quarterly_revenue');
    expect(e.provenance.magnitude).toBe('user_stated');
    expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    expect(naturalPerUnit(r.mutatedGraph as Rec, e)).toBeCloseTo(40000, 6);
  });
  it('INVARIANT: every link into or out of a re-framed node keeps its natural size; raw levels and the raw target stay', () => {
    const before = FIXTURE();
    const r = write(before);
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const after = r.mutatedGraph as Rec;
    const goalBefore = before.nodes.find((n: Rec) => n.id === 'quarterly_revenue');
    const goalAfter = after.nodes.find((n: Rec) => n.id === 'quarterly_revenue');
    expect(goalAfter.observed_state.raw_value).toBe(goalBefore.observed_state.raw_value);
    expect(goalAfter.goal_threshold_raw).toBe(goalBefore.goal_threshold_raw);
    const siblings = before.edges.filter((x: Rec) => (x.to === 'quarterly_revenue' || x.from === 'quarterly_revenue')
      && !(x.from === 'enterprise_win_rate' && x.to === 'quarterly_revenue') && typeof x.strength?.mean === 'number');
    expect(siblings.map((x: Rec) => x.from)).toEqual(['integration_step_abandonment_rate', 'quarterly_revenue_lost_to_roadmap_displacement']);
    for (const e of siblings) {
      const now = after.edges.find((x: Rec) => x.from === e.from && x.to === e.to);
      expect(naturalPerUnit(after, now), `${e.from}→${e.to}`).toBeCloseTo(naturalPerUnit(before, e), 9);
    }
  });

  it('PARITY (d5): the brief and the chat give the SAME frames and every β (construction\'s own call, no chat-only path)', () => {
    const chat = write(FIXTURE());
    if (chat.kind !== 'mutated') throw new Error(JSON.stringify(chat));
    // The brief path: construction admits the user's stated size at its full β, then refits and clamps at persist.
    const brief = FIXTURE();
    const e = brief.edges.find((x: Rec) => x.from === 'enterprise_win_rate' && x.to === 'quarterly_revenue');
    const beta = convertLinkEffect(40000, 1, 3500000, 100)!;
    e.strength = { ...e.strength, mean: beta };
    // As construction admits a size the brief STATES: the user's, with its natural size, before the refit.
    e.provenance = { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { amount: 40000, amount_unit: 'GBP/quarter',
      per_source_change: 1, per_source_change_unit: 'percentage points', strength_mean: beta, strength_mean_frame: 'edge_strength' } };
    const frames = (g: Rec) => g.nodes.map((n: Rec) => [n.id, n.scale_frame ?? null, n.observed_state?.cap ?? null, n.observed_state?.value ?? null,
      n.goal_threshold ?? null, n.goal_threshold_cap ?? null]);
    const betas = (g: Rec) => g.edges.map((x: Rec) => [x.from, x.to, x.strength?.mean ?? null]);
    const constructed = clampForPersist(refitFramesForStatedEffects(brief).graph) as Rec;
    expect(frames(chat.mutatedGraph as Rec)).toEqual(frames(constructed));
    for (const [[f, t, b], [, , c]] of betas(chat.mutatedGraph as Rec).map((x: unknown[], i: number) => [x, betas(constructed)[i]!] as const)) {
      expect(b as number, `${f}→${t}`).toBeCloseTo(c as number, 12);
    }
    const goal = (chat.mutatedGraph as Rec).nodes.find((n: Rec) => n.id === 'quarterly_revenue');
    expect(goal.observed_state.cap).toBe(5000000);
  });
  it('CHAIN (served turn-008 → approve): propose → card → approve → REAL door → stored → read-back; never link_scope_mismatch', async () => {
    const w = world(STORED());
    const r = await w.caps.proposeLinkEffect!(ctxSaying(QUOTE), { from_label: 'Enterprise win rate', to_label: 'quarterly revenue', ...S5T,
      quote: QUOTE }) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
      (id) => ({ proposal: w.proposals.get(id), result: r as never }))[0]!;
    const out = await w.caps.authoriseChange({ ...ctxSaying(card.message), typed_approval_of: String(r.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(w.commits.map((c) => c.link_effect !== undefined)).toEqual([true]); // the ONE-link door
    const stored = w.graph();
    const e = stored.edges.find((x: Rec) => x.from === 'enterprise_win_rate' && x.to === 'quarterly_revenue');
    expect(e.provenance.magnitude).toBe('user_stated');
    expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    expect(naturalPerUnit(stored, e)).toBeCloseTo(40000, 6);
    expect(stored.nodes.find((n: Rec) => n.id === 'quarterly_revenue').observed_state.cap).toBe(5000000);
  });
  it('OPT-IN: without `frameRefit` (the many-link door and its dry runs) the size is refused exactly as before', () => {
    const g = FIXTURE();
    const before = JSON.stringify(g);
    expect(write(g, undefined, undefined, undefined, undefined, false)).toMatchObject({ kind: 'refused', reason: 'not_representable' });
    expect(JSON.stringify(g)).toBe(before);
  });
  it('BASE-REFIT: a stored base construction would already refit (another user link) is refused — no other link moves', () => {
    const g = baseWithAnotherCut();
    expect(refitFramesForStatedEffects(g).refits.length).toBeGreaterThan(0); // precondition: the base itself refits
    expect(write(g)).toMatchObject({ kind: 'refused', reason: 'not_representable' });
  });
  it('DOOR GUARD admits construction\'s refit of the scoped write, and nothing else', () => {
    const before = FIXTURE();
    const r = write(before);
    if (r.kind !== 'mutated' || r.refitFrom === undefined) throw new Error(JSON.stringify(r));
    const link = { from: 'enterprise_win_rate', to: 'quarterly_revenue' };
    const after = projectGraphForPersistence(r.mutatedGraph) as Rec;
    expect(linkEffectRefitPostimageIsScoped(before, r.refitFrom, after, link)).toBe(true);
    // A chat-only frame (the exact £4M, not construction's £5M) → refused.
    const chatOnly = structuredClone(after);
    chatOnly.nodes.find((n: Rec) => n.id === 'quarterly_revenue').observed_state.cap = 4000000;
    expect(linkEffectRefitPostimageIsScoped(before, r.refitFrom, chatOnly, link)).toBe(false);
    // The user's write touched another node → refused, even though the stored graph is its exact refit.
    const wider = structuredClone(r.refitFrom) as Rec;
    wider.nodes.find((n: Rec) => n.id === 'integration_step_abandonment_rate').label = 'Not approved';
    const widerAfter = projectGraphForPersistence(clampForPersist(refitFramesForStatedEffects(wider).graph)) as Rec;
    expect(linkEffectRefitPostimageIsScoped(before, wider, widerAfter, link)).toBe(false);
    // A base that needed its own refit → refused: the user's write ON THAT BASE (scoped to the link) and its exact refit.
    const cutBase = baseWithAnotherCut();
    const onCut = structuredClone(cutBase);
    const i = onCut.edges.findIndex((x: Rec) => x.from === link.from && x.to === link.to);
    onCut.edges[i] = structuredClone((r.refitFrom as Rec).edges.find((x: Rec) => x.from === link.from && x.to === link.to));
    const onCutAfter = projectGraphForPersistence(clampForPersist(refitFramesForStatedEffects(onCut).graph)) as Rec;
    expect(linkEffectRefitPostimageIsScoped(cutBase, onCut, onCutAfter, link)).toBe(false);
  });
  it('CONTROL: a size the frames already hold writes no refit (every other node and link byte-identical)', () => {
    const before = FIXTURE();
    const r = write(before, 'enterprise_win_rate', 'quarterly_revenue', { ...S5T, amount: 20000 },
      'Every 1 percentage point more of Enterprise win rate adds about £20,000 per quarter.');
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const after = r.mutatedGraph as Rec;
    expect(JSON.stringify(after.nodes)).toBe(JSON.stringify(before.nodes));
    for (const e of before.edges.filter((x: Rec) => !(x.from === 'enterprise_win_rate' && x.to === 'quarterly_revenue'))) {
      expect(JSON.stringify(after.edges.find((x: Rec) => x.from === e.from && x.to === e.to))).toBe(JSON.stringify(e));
    }
  });
  it('v1 REFUSAL STANDS (a FACTOR target is never widened): nothing written, and the words give a real next step', () => {
    const g = FIXTURE();
    const before = JSON.stringify(g);
    const r = write(g, 'ai_reporting_module_availability', 'enterprise_win_rate',
      { amount: 150, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'switch' },
      'Having the AI reporting module adds 150 percentage points of Enterprise win rate.');
    expect(r).toMatchObject({ kind: 'refused', reason: 'not_representable' });
    expect(JSON.stringify(g)).toBe(before);
    const words = linkEffectRefusalWords('not_representable', g, { id: 'ai_reporting_module_availability', label: 'AI reporting module availability' },
      { id: 'enterprise_win_rate', label: 'Enterprise win rate' });
    expect(words).toContain('How strong is this effect?');
    expect(words).not.toContain('cannot be changed from this conversation');
  });

  // ── r2: Codex r1 on #2631 (three P1s), each its graph + a control ──
  const node = (id: string, kind: string, label: string, os?: Rec): Rec => ({ id, kind, label, ...(os ? { observed_state: os } : {}) });
  const framed = (raw: number, unit: string): Rec => ({ value: raw / 100, raw_value: raw, cap: 100, unit, source: 'user_override' });
  const ph = (from: string, to: string, mean: number): Rec => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 0.9,
    effect_direction: mean < 0 ? 'negative' : 'positive', defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
  const userStated = (from: string, to: string, mean: number, ne: Rec, clampedFrom?: number): Rec => ({ from, to,
    strength: { mean, std: 0.1 }, exists_probability: 0.9, effect_direction: mean < 0 ? 'negative' : 'positive',
    provenance: { source: 'user_specified', magnitude: 'user_stated', ...(clampedFrom !== undefined ? { clamped_from: clampedFrom } : {}),
      natural_effect: { ...ne, strength_mean: clampedFrom ?? mean, strength_mean_frame: 'edge_strength' } } });
  const sized = (g: Rec, from: string, to: string, amount: number, unit: string, per: string, quote: string) =>
    write(g, from, to, { amount, amount_unit: unit, per_source_change: 1, per_source_change_unit: per }, quote);

  /** P1-b: x → m → g; m → g is the user's £2 per £1, stored CLAMPED at 1 (a limit names g, so construction refused it). */
  function clampedSibling(): Rec {
    return { goal_node_id: 'g',
      nodes: [node('g', 'goal', 'Revenue', framed(50, '£')), node('x', 'factor', 'Customers', framed(50, 'customers')),
        node('m', 'outcome', 'New-customer revenue', framed(50, '£'))],
      edges: [ph('x', 'm', 0.2), userStated('m', 'g', 1, { amount: 2, amount_unit: '£', per_source_change: 1, per_source_change_unit: '£' }, 2)],
      goal_constraints: [{ constraint_id: 'c1', node_id: 'g', operator: '>=', value: 60, unit: '£' }] };
  }
  it('r2 P1-b CLAMPED SIBLING: a refit that would re-frame a clamped user link (its analysed size halves) is refused', () => {
    const g = clampedSibling();
    const base = refitFramesForStatedEffects(g);
    expect(base.refits).toEqual([]); // precondition: the base-refit check does NOT catch it…
    expect(base.refused.map((r) => r.link)).toEqual(['m→g']); // …because the sibling's own refit is refused
    const before = JSON.stringify(g);
    expect(sized(g, 'x', 'm', 2, '£', 'customers', 'Every 1 more customer adds £2 of new-customer revenue.'))
      .toMatchObject({ kind: 'refused', reason: 'not_representable' });
    expect(JSON.stringify(g)).toBe(before);
    // CONTROL: a size the frames hold refits nothing, and the clamped sibling is byte-identical.
    const ok = sized(clampedSibling(), 'x', 'm', 0.5, '£', 'customers', 'Every 1 more customer adds £0.50 of new-customer revenue.');
    expect(ok.kind, JSON.stringify(ok)).toBe('mutated');
    if (ok.kind === 'mutated') expect(JSON.stringify(edge2(ok.mutatedGraph as Rec, 'm', 'g'))).toBe(JSON.stringify(edge2(clampedSibling(), 'm', 'g')));
  });

  /** P1-c: x → g and a 0–1 switch b → g the user sized at £50 per switch; b has no stored frame (an implicit one). */
  function implicitSibling(): Rec {
    return { goal_node_id: 'g',
      nodes: [node('g', 'goal', 'Revenue', framed(50, '£')), node('x', 'factor', 'Customers', framed(50, 'customers')),
        node('b', 'factor', 'Reporting switch', { value: 0, unit: '0-1', source: 'user_override' })],
      edges: [ph('x', 'g', 0.2), userStated('b', 'g', 0.5, { amount: 50, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'switch' })] };
  }
  it('r2 P1-c IMPLICIT FRAME: a refit of the goal is refused while a sized link from a frameless node points at it', () => {
    const g = implicitSibling();
    const before = JSON.stringify(g);
    expect(sized(g, 'x', 'g', 2, '£', 'customers', 'Every 1 more customer adds £2 of revenue.'))
      .toMatchObject({ kind: 'refused', reason: 'not_representable' });
    expect(JSON.stringify(g)).toBe(before);
    const ok = sized(implicitSibling(), 'x', 'g', 0.5, '£', 'customers', 'Every 1 more customer adds £0.50 of revenue.');
    expect(ok.kind, JSON.stringify(ok)).toBe('mutated');
    if (ok.kind === 'mutated') expect(JSON.stringify(edge2(ok.mutatedGraph as Rec, 'b', 'g'))).toBe(JSON.stringify(edge2(implicitSibling(), 'b', 'g')));
  });

  it('r2 P1-a ONE PREIMAGE: a write whose option setting hides under data.interventions never passes the door guard', () => {
    const base = projectGraphForPersistence({ goal_node_id: 'g',
      nodes: [node('g', 'goal', 'Revenue', framed(50, '£')), node('x', 'factor', 'Customers', framed(50, 'customers')),
        { id: 'o', kind: 'option', label: 'Push upsell', interventions: { g: { value: 0.5, source: 'user_specified',
          target_match: { node_id: 'g', match_type: 'exact_id', confidence: 'high' } } } }],
      edges: [ph('x', 'g', 0.2)] }) as Rec;
    const link = { from: 'x', to: 'g' };
    const raw = structuredClone(base);
    const e = raw.edges.find((x: Rec) => x.from === 'x' && x.to === 'g');
    e.strength = { ...e.strength, mean: 2 };
    e.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 2, amount_unit: '£', per_source_change: 1,
      per_source_change_unit: 'customers', strength_mean: 2, strength_mean_frame: 'edge_strength' } };
    const o = raw.nodes.find((n: Rec) => n.id === 'o');
    o.data = { ...(o.data ?? {}), interventions: o.interventions };
    delete o.interventions;
    expect(refitFramesForStatedEffects(raw).refits.length).toBeGreaterThan(0); // precondition: the RAW shape widens g…
    expect(refitFramesForStatedEffects(projectGraphForPersistence(raw) as Rec).refits).toEqual([]); // …the canonical one refuses
    const after = projectGraphForPersistence(clampForPersist(refitFramesForStatedEffects(raw).graph)) as Rec;
    expect(linkEffectRefitPostimageIsScoped(base, raw, after, link)).toBe(false);
  });

  it('r2 P2 GAUGE + REFIT (Codex r1, closed by #2634): one end-to-end answer that needs a refit commits through the REAL door', async () => {
    const g0 = assignEntityRefs(projectGraphForPersistence({ goal_node_id: 'g',
      nodes: [node('g', 'goal', 'Revenue', framed(50, '£')), node('x', 'factor', 'Subscribers', framed(50, 'subscribers')),
        { id: 'm', kind: 'outcome', label: 'Account value', scale_frame: 100 }],
      edges: [ph('x', 'm', 0.2), ph('m', 'g', 0.5)] }), { nodes: [], edges: [] }).graph as Rec;
    const said = 'Every 1 more subscriber adds about £2 to revenue through account value.';
    const w = world(g0);
    const r = await w.caps.proposeLinkEffect!(ctxSaying(said), { from_label: 'Subscribers', to_label: 'Account value', amount: 2,
      amount_unit: '£', per_source_change: 1, per_source_change_unit: 'subscribers', quote: said }) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
      (id) => ({ proposal: w.proposals.get(id), result: r as never }))[0]!;
    const out = await w.caps.authoriseChange({ ...ctxSaying(card.message), typed_approval_of: String(r.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    const stored = w.graph();
    expect(edge2(stored, 'm', 'g').provenance.sized_by_identity).toEqual({ op: 'gauge' });
    expect(Math.abs(edge2(stored, 'x', 'm').strength.mean)).toBeLessThanOrEqual(1);
    expect(stored.nodes.find((n: Rec) => n.id === 'g').observed_state.cap).toBeGreaterThan(100); // the frame was refit
  });

  /** Codex r2 P1: the gauge path with UNEQUAL mediator and child frames (m 100, revenue 150). */
  function unequalGauge(): Rec {
    return assignEntityRefs(projectGraphForPersistence({ goal_node_id: 'g',
      nodes: [node('g', 'goal', 'Revenue', { value: 0.5, raw_value: 75, cap: 150, unit: '£', source: 'user_override' }),
        node('x', 'factor', 'Subscribers', framed(50, 'subscribers')), { id: 'm', kind: 'outcome', label: 'Account value', scale_frame: 100 }],
      edges: [ph('x', 'm', 0.2), ph('m', 'g', 0.5)] }), { nodes: [], edges: [] }).graph as Rec;
  }
  const GAUGE_SAID = 'Every 1 more subscriber adds about £2 to revenue through account value.';
  const gaugeWrite = (g: Rec) => {
    const effect = { amount: 2, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'subscribers' };
    const prepared = prepareLinkEffectUnitReadings(g, 'x', 'm', effect, GAUGE_SAID);
    const p = { persistedGraph: g, from: 'x', to: 'm', effect, quote: GAUGE_SAID, unit_readings: prepared.unit_readings,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'x', 'm')! } };
    return applyLinkEffectEdit({ ...p, reading_token: linkEffectReadingToken(p), frameRefit: true });
  };
  it('r2b GAUGE KEPT (Codex r2 P1): a refit that would take the gauge off ±1 (unequal frames) is refused, nothing written', () => {
    const g = unequalGauge();
    const before = JSON.stringify(g);
    expect(gaugeWrite(g)).toMatchObject({ kind: 'refused', reason: 'not_representable' });
    expect(JSON.stringify(g)).toBe(before);
  });
  it('r2b GAUGE KEPT at the door: the recomputed refit of an unequal-frame gauge write is out of scope', () => {
    const g = unequalGauge();
    // The user's pre-refit write as the writer builds it (gauge ±1 written with the answer), then construction's refit.
    const pre = structuredClone(g);
    const lever = edge2(pre, 'x', 'm');
    lever.strength = { ...lever.strength, mean: 2 * 100 / 150 * 1.5 };
    lever.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 2, amount_unit: '£', per_source_change: 1,
      per_source_change_unit: 'subscribers', strength_mean: lever.strength.mean, strength_mean_frame: 'edge_strength' } };
    const gauge = edge2(pre, 'm', 'g');
    gauge.strength = { ...gauge.strength, mean: 1 };
    gauge.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', sized_by_identity: { op: 'gauge' } };
    delete gauge.defaulted;
    const after = projectGraphForPersistence(clampForPersist(refitFramesForStatedEffects(projectGraphForPersistence(pre) as Rec).graph)) as Rec;
    expect(Math.abs(edge2(after, 'm', 'g').strength.mean)).not.toBe(1); // precondition: the refit broke the gauge
    expect(linkEffectRefitPostimageIsScoped(g, pre, after, { from: 'x', to: 'm' })).toBe(false);
  });
});

