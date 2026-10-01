/**
 * ⭐ PAUL'S SAVED TOTAL IS OFFERED AS ONE CARD, AND ONLY HIS YES WRITES IT (DL 380e54 #85 5932495794 item 1, which
 * REVERSES the read-time repair): "detect the broken total on read → ONE proposal card ("this total should be the sum of
 * its parts") → the user confirms → durable commit through the F1 write path → the Run goes stale → rerun. Rows: Paul's
 * `96c6f5f4` card; the pre-repair Run reads NOT current; shape-only normalisation stays silent."
 *
 * Paul's `96c6f5f4` (fixture: the CEE `/graph` read of his 1 Oct manual test) was saved before #2445: "Total sprint
 * capacity allocated" is a causal sink on Olumi's placeholder links at Olumi's 0%, while its parts hold his 10% and 50%.
 *
 * THE PATH: the Agent's real `dispatchTool` → `createAgentCapabilities` (real `ProposalStore`) → `propose_sum_total_repair`
 * → (a later turn: a fresh capability set) `authorise_change` → the REAL `/graph/register` route (Fastify inject) over a
 * stateful session-store double, with the REAL analysis and identity hashes. Every row binds the total and its parts BY
 * ID and the card BY ITS EXACT WORDS.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as unknown } }));
vi.mock('../../session/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSessionStore: () => storeRef.value };
});
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from '../../../routes/assist.v1.scenario-graph-register.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { deriveDecisionContextGraphHash } from '../../build-turn-context.js';
import { createAgentCapabilities, projectModelContext, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipIdFor, approvalChipsFor } from '../approval-chips.js';
import { proposalPendingAction, rehydrateProposals } from '../durable-proposal.js';
import { detectSumTotalRepair } from '../sum-totals.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-paul-sprint-96c6f5f4.json', import.meta.url), 'utf8')) as { graph: Rec }).graph;
const SEEDED = (JSON.parse(readFileSync(new URL('./fixtures/drafted-sprint-total-seeded.json', import.meta.url), 'utf8')) as { candidate: unknown }).candidate;
const SCENARIO = '96c6f5f4-0000-4000-8000-0000000000c1';
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2c';
const TOOL = 'propose_sum_total_repair';
const TOTAL = 'total_sprint_capacity_allocated';
const PARTS = ['ai_reporting_sprint_capacity', 'signup_bug_fix_sprint_capacity'];
const CARD = 'Make "Total sprint capacity allocated" the sum of its parts (AI reporting sprint capacity + Signup bug-fix sprint capacity): '
  + 'it becomes 60% of upcoming sprint';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nodeOf = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const partLinks = (g: Rec): Rec[] => PARTS.map((p) => g.edges.find((e: Rec) => e.from === p && e.to === TOTAL));
const analysisHash = (g: Rec): string | null => computeAnalysisAffectingGraphHash(g as never);
/** Every object's keys reversed, at every depth: the same graph, written in another key order. */
const reversedKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(reversedKeys)
  : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversedKeys((v as Rec)[k])])) : v);
const ctxFor = (requestId: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: requestId, user_text: 'Can you check the sprint total?' });

/** A session-store double the REAL register route writes and the read below reads: one stored row. */
function world(initial: Rec) {
  const row = { graph: clone(initial) as unknown };
  const appends: unknown[] = [];
  const store = {
    append: vi.fn(async (write: { graph: unknown }) => { appends.push(clone(write.graph)); row.graph = clone(write.graph); return { id: `turn-${appends.length}` }; }),
    loadGraph: vi.fn(async () => clone(row.graph)),
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(row.graph), briefText: null })),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    getScenarioOwner: vi.fn(async () => null),
    scenarioExists: vi.fn(async () => true),
    readCommittedTurn: vi.fn(async () => null),
  };
  storeRef.value = store;
  return { row, appends, store };
}

const apps: FastifyInstance[] = [];
/** `beforeRegister` lands another writer between the approval's read and its register (the 409 row). */
async function harness(initial: Rec, opts: { beforeRegister?: (row: { graph: unknown }) => void } = {}) {
  const w = world(initial);
  const app = Fastify();
  apps.push(app);
  await registerRoute(app);
  await app.ready();
  const registers: Rec[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      const g = clone(w.row.graph) as Rec;
      return { status: 200, json: { graph: g, graph_hash: analysisHash(g), graph_identity_hash: computeGraphIdentityHash(g as never) } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      registers.push(clone(body) as Rec);
      opts.beforeRegister?.(w.row);
      const res = await app.inject({ method: 'POST', url: path, payload: body as Record<string, unknown> });
      return { status: res.statusCode, json: res.json() as Record<string, unknown> };
    }
    return { status: 500, json: {} };
  };
  const proposals = new ProposalStore();
  /** One request = one capability set (the route makes one per turn); the proposal store outlives it. */
  const turn = (requestId: string, store: ProposalStore = proposals) => {
    const caps = createAgentCapabilities(dispatch, store);
    return (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctxFor(requestId), caps);
  };
  return { ...w, registers, proposals, turn, stored: (): Rec => w.row.graph as Rec };
}

beforeEach(() => { resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OWNER }); });
afterEach(async () => { while (apps.length > 0) await apps.pop()!.close(); });

/** The graph #2445 shapes (identity, definitional links, level Σ parts): Paul's total as it reads once repaired. */
const shaped = (): Rec => clone(detectSumTotalRepair(clone(SERVED))!.repaired_graph);

describe('precondition: Paul\'s saved total is the pre-#2445 shape', () => {
  it('no identity, both part links Olumi placeholders, the total at Olumi\'s 0% while its parts hold his 10% and 50%', () => {
    const total = nodeOf(SERVED, TOTAL);
    expect(total.nonlinear_identity).toBeUndefined();
    expect(total.observed_state).toMatchObject({ value: 0, raw_value: 0, source: 'cee_inference' });
    for (const e of partLinks(SERVED)) expect(e).toMatchObject({ defaulted: true, strength: { mean: 0.85 }, exists_probability: 0.8, provenance: { magnitude: 'olumi_placeholder' } });
    expect(nodeOf(SERVED, PARTS[0]!).observed_state).toMatchObject({ raw_value: 10, source: 'user_override' });
    expect(nodeOf(SERVED, PARTS[1]!).observed_state).toMatchObject({ raw_value: 50, source: 'user_override' });
  });
});

describe('DETECT (pure, 0 writes) on Paul\'s stored graph', () => {
  it('ONE repair for the total, by id: its sum identity, both part links as their definition, its level 10% + 50% = 60%', () => {
    const before = JSON.stringify(SERVED);
    const r = detectSumTotalRepair(SERVED)!;
    expect(r).not.toBeNull();
    expect(JSON.stringify(SERVED), 'detection never mutates the stored graph').toBe(before);
    expect({ id: r.total_id, label: r.total_label, parts: r.part_ids, part_labels: r.part_labels })
      .toEqual({ id: TOTAL, label: 'Total sprint capacity allocated', parts: PARTS, part_labels: ['AI reporting sprint capacity', 'Signup bug-fix sprint capacity'] });
    expect(r.level_after).toEqual({ raw_value: 60, value: 0.6, unit: '% of upcoming sprint' });
    expect(r.changes).toEqual({ identity: true, part_links: PARTS, level: true });
    const g = r.repaired_graph;
    expect(nodeOf(g, TOTAL).nonlinear_identity).toEqual({ operation: 'sum', factor_ids: PARTS, stated_in_brief: false });
    expect(nodeOf(g, TOTAL).observed_state).toEqual({ ...nodeOf(SERVED, TOTAL).observed_state, value: 0.6, raw_value: 60 });
    for (const e of partLinks(g)) {
      expect(e).toMatchObject({ strength: { mean: 1, std: 0.001 }, exists_probability: 1, effect_direction: 'positive' });
      expect(e.provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true,
        natural_effect: { amount: 1, amount_unit: '% of upcoming sprint', per_source_change: 1, strength_mean: 1 } });
    }
    // Every other node and link is the stored one, byte for byte.
    expect(g.nodes.filter((n: Rec) => n.id !== TOTAL)).toEqual(SERVED.nodes.filter((n: Rec) => n.id !== TOTAL));
    expect(g.edges.filter((e: Rec) => e.to !== TOTAL)).toEqual(SERVED.edges.filter((e: Rec) => e.to !== TOTAL));
  });

  it('the Agent is told: `totals_not_summed` names the total, its parts and what it would be (no ids)', () => {
    const ctx = projectModelContext({ nodes: SERVED.nodes, edges: SERVED.edges, raw: SERVED, analysis_state: undefined, analysis_ready: undefined } as never);
    expect(ctx.totals_not_summed).toEqual([{ label: 'Total sprint capacity allocated', parts: ['AI reporting sprint capacity', 'Signup bug-fix sprint capacity'], would_be: '60% of upcoming sprint' }]);
  });
});

describe('RED — Paul\'s 96c6f5f4: ONE card, approved on a later turn, ONE CAS-gated register, read back', () => {
  it('the card offers exactly the repair; the yes writes it once; the stored total is 60% and its identity is sum', async () => {
    const h = await harness(SERVED);
    const cardBase = analysisHash(SERVED);
    // Turn 1: the Agent reads the model, sees the finding, offers the card. Nothing is written.
    const t1 = h.turn('req-card-1');
    const state = await t1('get_canonical_state') as Rec;
    expect(state.totals_not_summed).toEqual([expect.objectContaining({ label: 'Total sprint capacity allocated', would_be: '60% of upcoming sprint' })]);
    const card = await t1(TOOL, { rationale: 'The total does not add up its parts.' }) as Rec;
    expect(card).toMatchObject({ ok: true, mutated: false, public_label: CARD, base_revision: cardBase,
      total: 'Total sprint capacity allocated', becomes: { value: 60, unit: '% of upcoming sprint' }, now: { value: 0, unit: '% of upcoming sprint' } });
    expect(h.appends, 'nothing is written before the user approves').toHaveLength(0);
    expect(h.registers).toHaveLength(0);
    const stored = h.proposals.get(card.proposal_id)!;
    expect(stored.operations).toHaveLength(1);
    expect(stored.operations[0]).toMatchObject({ op: 'repair_sum_total', path: TOTAL });
    expect(stored.base_graph_identity_hash).toBe(cardBase);
    // ONE approve button, carrying the card's own words.
    const chips = approvalChipsFor([{ name: TOOL, ok: true, mutated: false, proposal_id: card.proposal_id }],
      (id) => ({ proposal: h.proposals.get(id), result: card as ToolResult }));
    expect(chips[0]).toMatchObject({ id: approvalChipIdFor(card.proposal_id), label: 'Yes, make it the sum', detail: CARD });

    // Turn 2 (a later request, a fresh capability set): the user's yes.
    const applied = await h.turn('req-card-2')('authorise_change', { proposal_id: card.proposal_id }) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true, applied: true, total: 'Total sprint capacity allocated',
      recorded: { value: 60, unit: '% of upcoming sprint' } });
    expect(applied.follow_up).toBe('"Total sprint capacity allocated" is now worked out as the sum of its parts: 60% of upcoming sprint. '
      + 'Any earlier result was calculated before this change; run the analysis again to see it.');
    expect(h.registers, 'ONE register call').toHaveLength(1);
    expect(h.registers[0]!.expected_graph_hash, 'CAS on the analysis hash the card was read on').toBe(cardBase);
    expect(h.appends, 'ONE write landed').toHaveLength(1);
    // Read back: what the store now holds.
    const after = h.stored();
    expect(nodeOf(after, TOTAL).nonlinear_identity).toEqual({ operation: 'sum', factor_ids: PARTS, stated_in_brief: false });
    expect(nodeOf(after, TOTAL).observed_state).toMatchObject({ raw_value: 60, value: 0.6, unit: '% of upcoming sprint' });
    for (const e of partLinks(after)) expect(e.provenance).toMatchObject({ definitional: true, magnitude: 'olumi_estimate' });
    expect(detectSumTotalRepair(after), 'the stored graph no longer needs the card').toBeNull();
    // The parts keep the user's own figures; nothing else on the model moved.
    for (const p of PARTS) expect(nodeOf(after, p).observed_state).toEqual(nodeOf(SERVED, p).observed_state);
    // A second yes applies nothing twice.
    const again = await h.turn('req-card-3')('authorise_change', { proposal_id: card.proposal_id }) as Rec;
    expect(again).toMatchObject({ ok: true, mutated: false, already_applied: true });
    expect(h.appends).toHaveLength(1);
  });

  it('after a restart: the card carried on its answer row (stored in another key order) is rehydrated and applies', async () => {
    const h = await harness(SERVED);
    const card = await h.turn('req-restart-1')(TOOL) as Rec;
    expect(card.ok).toBe(true);
    const chip = approvalChipsFor([{ name: TOOL, ok: true, mutated: false, proposal_id: card.proposal_id }],
      (id) => ({ proposal: h.proposals.get(id), result: card as ToolResult }))[0]!;
    const carrier = reversedKeys(proposalPendingAction(h.proposals.get(card.proposal_id)!, chip, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() }));
    const fresh = new ProposalStore();
    expect(rehydrateProposals([carrier], fresh, { scenario_id: SCENARIO, user_id: null })).toBe(1);
    const applied = await h.turn('req-restart-2', fresh)('authorise_change', { proposal_id: card.proposal_id }) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, applied: true });
    expect(nodeOf(h.stored(), TOTAL).observed_state).toMatchObject({ raw_value: 60 });
  });
});

describe('RED — the pre-repair Run reads NOT current', () => {
  it('the commit moves the analysis hash and the Run\'s freshness hash; re-registering the same graph unchanged keeps both', async () => {
    const h = await harness(SERVED);
    const before = clone(h.stored());
    const card = await h.turn('req-stale-1')(TOOL) as Rec;
    await h.turn('req-stale-2')('authorise_change', { proposal_id: card.proposal_id });
    const after = clone(h.stored());
    expect(h.appends).toHaveLength(1);
    // A Run stamps `graph_hash_at_run` with `deriveDecisionContextGraphHash`; the read compares it with the stored graph's.
    const runStamp = deriveDecisionContextGraphHash(before);
    expect(runStamp).toMatch(/\S/);
    expect(deriveDecisionContextGraphHash(after), 'the Run computed before the card reads NOT current').not.toBe(runStamp);
    expect(analysisHash(after), 'the CAS / analysis hash moved').not.toBe(analysisHash(before));
    // Control: the same graph registered again, unchanged, through the same route, keeps both hashes.
    const reg = await apps[apps.length - 1]!.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`,
      payload: { graph: clone(after), expected_graph_hash: analysisHash(after) } });
    expect(reg.statusCode, reg.body).toBe(200);
    expect(h.appends, 'the control re-registration landed').toHaveLength(2);
    expect(deriveDecisionContextGraphHash(h.stored())).toBe(deriveDecisionContextGraphHash(after));
    expect(analysisHash(h.stored())).toBe(analysisHash(after));
  });
});

describe('shape-only normalisation stays silent: no finding, no card, the tool refuses', () => {
  const silent = async (g: Rec): Promise<void> => {
    expect(detectSumTotalRepair(g)).toBeNull();
    const ctx = projectModelContext({ nodes: g.nodes, edges: g.edges, raw: g, analysis_state: undefined, analysis_ready: undefined } as never);
    expect(ctx).not.toHaveProperty('totals_not_summed');
    const h = await harness(g);
    const r = await h.turn('req-silent')(TOOL) as Rec;
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'no_repair_needed' });
    expect(r).not.toHaveProperty('proposal_id');
    expect(h.registers).toHaveLength(0);
    expect(h.appends).toHaveLength(0);
  };

  it('a #2445-shaped total (identity, definitional links, level = Σ parts)', async () => { await silent(shaped()); });

  it('the same graph with every key re-ordered', async () => { await silent(reversedKeys(shaped()) as Rec); });

  it('the same graph carrying the projection markers the shaping drops (`defaulted`, a drafted `reasoning`)', async () => {
    const g = shaped();
    g.edges = g.edges.map((e: Rec) => (e.to === TOTAL ? { ...e, defaulted: true, provenance: { ...e.provenance, reasoning: 'drafted' } } : e));
    await silent(g);
  });

  it('a level that differs from Σ parts only in its last float bit', async () => {
    const g = shaped();
    nodeOf(g, TOTAL).observed_state.value = 0.6000000000000001;
    await silent(g);
  });

  it('what construction registers today (0-LLM seeded sprint draft): already the sum, nothing to offer', async () => {
    let graph: Rec | null = null;
    const fn = vi.fn(async () => ({ text: JSON.stringify(SEEDED) })) as unknown as CallStructuredModel;
    const dispatch = (async (path: string, body: unknown) => {
      if (path.endsWith('/graph/register')) { graph = (body as { graph: Rec }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
      if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
      return { status: 200, json: { versions: [] } };
    }) as unknown as InternalDispatch;
    await buildModelFromBrief(SCENARIO, 'sprint brief', dispatch, fn);
    expect(graph, 'construction registered').not.toBeNull();
    expect(graph!.nodes.some((n: Rec) => n.nonlinear_identity?.operation === 'sum'), 'precondition: construction minted a sum').toBe(true);
    expect(detectSumTotalRepair(graph)).toBeNull();
  });
});

describe('controls: totals the card never offers (detection null)', () => {
  const withTotal = (edit: (n: Rec) => Rec): Rec => ({ ...clone(SERVED), nodes: SERVED.nodes.map((n: Rec) => (n.id === TOTAL ? edit(clone(n)) : n)) });
  const withPartLink = (from: string, mark: Rec): Rec => ({ ...clone(SERVED),
    edges: SERVED.edges.map((e: Rec) => (e.from === from && e.to === TOTAL ? { ...e, provenance: { ...e.provenance, ...mark } } : e)) });

  it('a declared PRODUCT on the total wins', () => {
    expect(detectSumTotalRepair(withTotal((n) => ({ ...n, nonlinear_identity: { operation: 'product', factor_ids: PARTS, stated_in_brief: true } })))).toBeNull();
  });

  it.each([
    ['their own strength (source user_specified)', { source: 'user_specified' }],
    ['a size credited to them (magnitude user_stated)', { magnitude: 'user_stated' }],
  ])('a part link the USER sized — %s', (_n, mark) => {
    expect(detectSumTotalRepair(withPartLink(PARTS[0]!, mark))).toBeNull();
  });

  it('a total level the USER set themselves that is not Σ its parts (their 70% is never overwritten)', () => {
    expect(detectSumTotalRepair(withTotal((n) => ({ ...n, observed_state: { ...n.observed_state, value: 0.7, raw_value: 70, source: 'user_override' } })))).toBeNull();
  });

  it('no limit on the total (no tally)', () => {
    expect(detectSumTotalRepair({ ...clone(SERVED), goal_constraints: SERVED.goal_constraints.filter((c: Rec) => c.node_id !== TOTAL) })).toBeNull();
  });
});

describe('stale base: nothing else is written', () => {
  it('409 — another writer moved the model between the approval\'s read and its register: superseded, the other write stands', async () => {
    let other: Rec | null = null;
    const h = await harness(SERVED, {
      beforeRegister: (row) => {
        // Another writer: Paul sets the AI reporting part to 20% (an analysis-affecting change).
        const g = clone(row.graph) as Rec;
        nodeOf(g, PARTS[0]!).observed_state = { ...nodeOf(g, PARTS[0]!).observed_state, value: 0.2, raw_value: 20 };
        row.graph = g;
        other = clone(g);
      },
    });
    const card = await h.turn('req-409-1')(TOOL) as Rec;
    const r = await h.turn('req-409-2')('authorise_change', { proposal_id: card.proposal_id }) as Rec;
    expect(r).toMatchObject({ ok: false, mutated: false, applied: false, refusal: 'superseded' });
    expect(h.registers, 'one register was attempted').toHaveLength(1);
    expect(h.appends, 'and refused: nothing was written').toHaveLength(0);
    expect(h.stored()).toEqual(other);
    expect(nodeOf(h.stored(), TOTAL).nonlinear_identity).toBeUndefined();
  });

  it('the model moved between the card and the yes: superseded before any register', async () => {
    const h = await harness(SERVED);
    const card = await h.turn('req-moved-1')(TOOL) as Rec;
    const g = clone(h.stored());
    nodeOf(g, PARTS[1]!).observed_state = { ...nodeOf(g, PARTS[1]!).observed_state, value: 0.4, raw_value: 40 };
    h.row.graph = g;
    const r = await h.turn('req-moved-2')('authorise_change', { proposal_id: card.proposal_id }) as Rec;
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(h.registers).toHaveLength(0);
    expect(h.appends).toHaveLength(0);
  });

  it('a change outside the analysis hash (the total renamed) is not written over: re-detected, superseded', async () => {
    const h = await harness(SERVED);
    const card = await h.turn('req-renamed-1')(TOOL) as Rec;
    const g = clone(h.stored());
    nodeOf(g, TOTAL).label = 'Sprint capacity used';
    h.row.graph = g;
    expect(analysisHash(g), 'precondition: a label is outside the analysis hash').toBe(analysisHash(SERVED));
    const r = await h.turn('req-renamed-2')('authorise_change', { proposal_id: card.proposal_id }) as Rec;
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(h.registers).toHaveLength(0);
    expect(nodeOf(h.stored(), TOTAL).label).toBe('Sprint capacity used');
  });
});
