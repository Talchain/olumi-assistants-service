/**
 * ⛔ EVERY PROPOSER'S CHANGE WAITS FOR THE USER — the Agent can never approve, in the request that minted it, a
 * change ANY proposer prepared (`agent-cannot-approve-its-own-proposal.test.ts` states the rule and pins it on the
 * route).
 *
 * Why this file exists (independent review of 8566fc35, round 2, CHANGES_REQUIRED): only `propose_model_change`
 * (`prop_`) and `propose_new_option` (`gmh_`, [sa1]) had a row that failed without the rule. The reviewer's mutant
 * M2 put `proposals.put(x)` back in place of `holdForApproval(ctx, x)` for `propose_link_strength`,
 * `propose_assumptions`, the combined starting point and `propose_option_interventions`: 41 files, 503 of 503 tests
 * stayed green. Under that mutant a typed brief turn can `propose_starting_point` and then
 * `authorise_change(prop_<compound>)` in ONE reply, and the starting figures are written before the user saw them.
 *
 * So the rows below are DRIVEN FROM `MUTATION_TOOLS` minus `authorise_change`: every proposer the Agent is given
 * has one, and a new proposer without one fails the coverage row. Each goes through `dispatchTool` — the path the
 * Agent loop calls — against the REAL `createAgentCapabilities` over a recording fake product:
 *   RED       — propose under request 1, then `authorise_change` of THAT id under request 1 → refused
 *               `awaiting_your_approval`, nothing sent, the model unchanged, the change still waiting; request 2
 *               then applies exactly it.
 *   CONTRAST  — propose under request 1, approve under request 2 (the approve chip / a typed "yes") → applied, with
 *               exactly the write the proposal describes.
 * The starting point has three rows: the combined proposal, and each one-half path (values only, levels only),
 * whose id is minted by the half's own proposer.
 */
import { describe, it, expect } from 'vitest';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, MUTATION_TOOLS, type AgentCapabilities, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { buildAddOptionsTransaction } from '../../routing/add-option-transaction.js';
import { AGENT_ADD_OPTION_CHIP_ID } from '../../handlers/agent-chip-ids.js';
import { GM_HELD_HANDLER_ID, gmHeldProposalRef } from '../../handlers/edit-graph-referee-gate.js';
import type { PendingAction } from '../../session/pending-action.js';
import { committedValueWrite } from './fixtures/served-value-write.js';

const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c';
const USER = 'user-a';
/** The request that proposes, and the user's NEXT request (the approve chip, or a typed "yes"). */
const REQ1 = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'req-1' };
const REQ2 = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'req-2' };

/** What a case's product lets a row observe. `writes` is every write the product received, in order. */
interface Product {
  readonly d: InternalDispatch;
  readonly writes: () => readonly unknown[];
  /** The approved change is in the stored model. */
  readonly landed: () => boolean;
  /** The ids still waiting for the user's approval (the proposal store, or the product's live holds). */
  readonly waiting: (store: ProposalStore) => readonly string[];
  readonly readPendingActions?: (scenarioId: string) => Promise<readonly PendingAction[]>;
}

// ── A link's strength (`edge_strength_edit`, the product's typed link writer) ──────────────────────────────
function linkProduct(): Product {
  let edge = { from: 'price', to: 'mrr', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } };
  let rev = 1;
  const sent: unknown[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) {
      return { status: 200, json: { graph: { nodes: [
        { id: 'dec', kind: 'decision', label: 'Price decision' },
        { id: 'price', kind: 'factor', label: 'Pro plan price' },
        { id: 'mrr', kind: 'goal', label: 'MRR' },
      ], edges: [edge] }, graph_hash: `h${rev}` } };
    }
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    sent.push(ev);
    if (ev['kind'] === 'edge_strength_edit') {
      edge = { ...edge, strength: { ...edge.strength, mean: Number(ev['magnitude']) }, provenance: { source: 'user_specified' } };
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.', graph_hash: `h${rev}` } };
    }
    return { status: 400, json: {} };
  };
  return { d, writes: () => sent, landed: () => edge.strength.mean === 0.825 && edge.provenance.source === 'user_specified',
    waiting: (s) => s.outstanding(SCENARIO, USER).map((w) => w.proposal_id) };
}

// ── A new link (`structural_add_edge`) ────────────────────────────────────────────────────────────────────
function linkAddProduct(): Product {
  let edges: { from: string; to: string }[] = [];
  const sent: unknown[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as { kind?: string; event?: { kind?: string; from: string; to: string } };
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      sent.push(b.event);
      if (b.event?.kind === 'structural_add_edge') {
        edges = [...edges, { from: b.event.from, to: b.event.to }];
        return { status: 200, json: { assistant_text: 'Added.' } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes: [{ id: 'f2', kind: 'factor', label: 'Morale' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges }, graph_hash: `h${edges.length}` } };
  };
  return { d, writes: () => sent, landed: () => edges.some((e) => e.from === 'f2' && e.to === 'o1'),
    waiting: (s) => s.outstanding(SCENARIO, USER).map((w) => w.proposal_id) };
}

// ── Starting values and option levels (the conditional registration + CAS-gated `option_intervention_edit`) ──
type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number; interventions?: Record<string, unknown> | null };
const BASE: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'hire_lead', kind: 'option', label: 'Hire a Tech Lead' },
];
/** The same model with both options' levels already set: a values-only starting point is then complete. */
const LEVELLED: Node[] = BASE.map((n) => (n.kind === 'option' ? { ...n, interventions: { team_size: { value: n.id === 'hire_two' ? 0.7 : 0.6 } } } : n));
/** Every option acts on Team size (never on Coordination load, which is only ever a value target here). */
const wired = (ns: Node[]) => ns.filter((o) => o.kind === 'option').flatMap((o) => ns.filter((f) => f.kind === 'factor' && f.id !== 'coordination_load')
  .map((f) => ({ from: o.id, to: f.id, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' })));

function figuresProduct(base: Node[] = BASE): Product & { read: () => Node[] } {
  const sent: unknown[] = [];
  let nodes: Node[] = base.map((n) => ({ ...n }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      sent.push({ kind: 'register', expected_graph_hash: b.expected_graph_hash });
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'factor_value_edit') {
        sent.push({ kind: 'factor_value_edit', target_id: ev.target_id, value: ev.value });
        nodes = nodes.map((n) => (n.id === ev.target_id ? { ...n, observed_state: { ...n.observed_state, value: ev.value as number } } : n));
        rev += 1;
        return { status: 200, json: committedValueWrite(String(ev.target_id), { graph_hash: `h${rev}` }) };
      }
      if (ev.kind === 'option_intervention_edit') {
        sent.push({ kind: 'option_intervention_edit', option_id: ev.option_id, factor_id: ev.factor_id, base_graph_hash: ev.base_graph_hash });
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        nodes = nodes.map((n) => (n.id === ev.option_id ? { ...n, interventions: { ...(n.interventions ?? {}), [String(ev.factor_id)]: { value: ev.value } } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      sent.push(ev);
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges: wired(nodes) }, graph_hash: `h${rev}` } };
  };
  return { d, read: () => nodes, writes: () => sent, landed: () => false,
    waiting: (s) => s.outstanding(SCENARIO, USER).map((w) => w.proposal_id) };
}
const byId = (p: { read: () => Node[] }) => Object.fromEntries(p.read().map((n) => [n.id, n]));
/** Coordination load had no value; the approved 40 is now stored (as the registered raw figure, or the edit's value). */
const valueLanded = (p: { read: () => Node[] }) => {
  const os = byId(p).coordination_load?.observed_state;
  return os !== undefined && (os.raw_value === 40 || os.value === 40);
};
const levelsLanded = (p: { read: () => Node[] }) => Object.keys(byId(p).hire_two?.interventions ?? {}).includes('team_size')
  && Object.keys(byId(p).hire_lead?.interventions ?? {}).includes('team_size');
const withLanded = (p: ReturnType<typeof figuresProduct>, landed: () => boolean): Product => ({ ...p, landed });

const ASSUMPTIONS = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team with one lead' }];
const LEVELS = [
  { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five today plus two hires' },
  { option_label: 'Hire a Tech Lead', factor_label: 'Team size', value: 6, basis: 'five today plus one hire' },
];

// ── A held add-option (`gmh_`): route-v2's typed add-option transaction, held as `graph_management_held_v1` ──
const OPTION_GRAPH = () => ({
  nodes: [
    { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
    { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
    { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
  ] as { id: string; kind: string; label: string; [k: string]: unknown }[],
  edges: [
    { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'fac_price', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_price', to: 'goal_x', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ] as { from: string; to: string; [k: string]: unknown }[],
});
/**
 * A product that HOLDS an add-option exactly as the capability checks it (a live `apply_proposed_change` pending on
 * the handler `graph_management_held_v1`, chip id = its `gmh_` handle) and commits the held batch on the confirm
 * for that handle. `heldUnder` names the hold's handle: the add-option transaction's own (`node:<option id>`), or —
 * modelling route-v2's fall-through to the free-text edit lane (route-v2.ts `fell_through:*`) — another target.
 * `respond: 'lost'` holds it and then answers 500 with no body, so the capability never sees the chip.
 */
function heldOptionProduct(heldUnder: 'the_add_option_handle' | 'another_handle', respond: 'offered' | 'lost' = 'offered'): Product & { heldRef: () => string | undefined; heldOptionId: () => string | undefined } {
  const g = OPTION_GRAPH();
  let rev = 0;
  let pendings: PendingAction[] = [];
  const confirms: unknown[] = [];
  let heldRef: string | undefined;
  let heldOptionId: string | undefined;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: `h${rev}` } };
    const b = (body ?? {}) as { kind?: string; message?: string; chip?: { id?: string; parameters?: unknown } };
    if (path === '/orchestrate/v2/turn' && b.kind === 'message' && b.chip?.id === AGENT_ADD_OPTION_CHIP_ID) {
      const built = buildAddOptionsTransaction(b.chip.parameters, { nodes: g.nodes as never, edges: g.edges as never });
      if (!built.matched) return { status: 200, json: { assistant_text: 'Not held.', suggested_actions: [] } };
      const ops = built.operations as { op: string; path: string; value?: { kind?: string } }[];
      heldOptionId = ops.find((o) => o.op === 'add_node' && o.value?.kind === 'option')?.path;
      heldRef = gmHeldProposalRef(SCENARIO, heldUnder === 'the_add_option_handle' ? `node:${String(heldOptionId)}` : `edit:${String(heldOptionId)}`);
      const now = new Date().toISOString();
      pendings = [{
        id: 'pa-1' as never, scenario_id: SCENARIO, chip_id: heldRef,
        action: { kind: 'apply_proposed_change', inline_patch: { handler_id: GM_HELD_HANDLER_ID, operations: ops }, public_label: 'Add the option', public_message: 'Add the option.' } as never,
        preconditions: { graph_hash: `h${rev}` } as never,
        expires_at_turn_count: 4, expires_at_iso: new Date(Date.now() + 3_600_000).toISOString(), emitted_at_iso: now,
      }];
      if (respond === 'lost') return { status: 500, json: {} };
      return { status: 200, json: { assistant_text: 'Here is the option to add.', suggested_actions: [{ id: heldRef, label: 'Add the option', message: 'Add the option.' }] } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'message' && b.chip?.id !== undefined && b.chip.id === heldRef) {
      confirms.push({ chip_id: b.chip.id, message: b.message });
      const hold = pendings.find((p) => p.chip_id === heldRef);
      for (const o of ((hold?.action as { inline_patch?: { operations?: { op: string; path: string; value?: Record<string, unknown> }[] } } | undefined)?.inline_patch?.operations ?? [])) {
        if (o.op === 'add_node') g.nodes.push({ ...(o.value ?? {}), id: o.path } as never);
        if (o.op === 'add_edge') { const [from, to] = o.path.split('::') as [string, string]; g.edges.push({ ...(o.value ?? {}), from, to }); }
      }
      pendings = [];
      rev += 1;
      return { status: 200, json: { assistant_text: 'Added.', draft_graph: g, graph_hash: `h${rev}` } };
    }
    return { status: 400, json: {} };
  };
  return {
    d, writes: () => confirms, heldRef: () => heldRef, heldOptionId: () => heldOptionId,
    landed: () => heldOptionId !== undefined && g.nodes.some((n) => n.id === heldOptionId) && g.edges.some((e) => e.from === 'dec_x' && e.to === heldOptionId),
    waiting: () => pendings.map((p) => p.chip_id),
    readPendingActions: async () => pendings,
  };
}
const NEW_OPTION = { label: 'Raise to £59', acts_on: [{ factor_label: 'Price', direction: 'positive' }], rationale: 'The user asked to compare it.' };

/** One row per proposer (and per way a starting point is minted). The Agent's own arguments, as it sends them. */
interface Case {
  readonly name: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly product: () => Product;
  readonly id: RegExp;
  /** Exactly what the approval sends, by identity (`writes()` of the product after request 2). */
  readonly applies: readonly unknown[];
}
const PROP = /^prop_[0-9a-f]{32}$/;
const CASES: readonly Case[] = [
  {
    name: 'propose_link_strength', tool: 'propose_link_strength', id: PROP, product: linkProduct,
    args: { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'The user said it is strong.' },
    applies: [{ kind: 'edge_strength_edit', from: 'price', to: 'mrr', intent: 'set', direction_intent: 'preserve', magnitude: 0.825, expected: { mean: 0.5, effect_direction: 'positive' } }],
  },
  {
    name: 'propose_model_change', tool: 'propose_model_change', id: PROP, product: linkAddProduct,
    args: { from_label: 'Morale', to_label: 'Velocity', direction: 'positive', rationale: 'The user said morale drives velocity.' },
    applies: [expect.objectContaining({ kind: 'structural_add_edge', from: 'f2', to: 'o1' })],
  },
  {
    name: 'propose_assumptions', tool: 'propose_assumptions', id: PROP,
    product: () => { const p = figuresProduct(); return withLanded(p, () => valueLanded(p)); },
    args: { assumptions: ASSUMPTIONS },
    applies: [{ kind: 'factor_value_edit', target_id: 'coordination_load', value: 40 }],
  },
  {
    name: 'propose_option_interventions', tool: 'propose_option_interventions', id: PROP,
    product: () => { const p = figuresProduct(); return withLanded(p, () => levelsLanded(p)); },
    args: { interventions: LEVELS },
    applies: [
      { kind: 'option_intervention_edit', option_id: 'hire_lead', factor_id: 'team_size', base_graph_hash: 'h0' },
      { kind: 'option_intervention_edit', option_id: 'hire_two', factor_id: 'team_size', base_graph_hash: 'h1' },
    ],
  },
  {
    name: 'propose_starting_point (the combined proposal)', tool: 'propose_starting_point', id: PROP,
    product: () => { const p = figuresProduct(); return withLanded(p, () => valueLanded(p) && levelsLanded(p)); },
    args: { assumptions: ASSUMPTIONS, option_levels: LEVELS },
    applies: [
      { kind: 'register', expected_graph_hash: 'h0' },
      { kind: 'option_intervention_edit', option_id: 'hire_lead', factor_id: 'team_size', base_graph_hash: 'h1' },
      { kind: 'option_intervention_edit', option_id: 'hire_two', factor_id: 'team_size', base_graph_hash: 'h2' },
    ],
  },
  {
    name: 'propose_starting_point (one half: values only)', tool: 'propose_starting_point', id: PROP,
    product: () => { const p = figuresProduct(LEVELLED); return withLanded(p, () => valueLanded(p)); },
    args: { assumptions: ASSUMPTIONS, option_levels: [] },
    applies: [{ kind: 'factor_value_edit', target_id: 'coordination_load', value: 40 }],
  },
  {
    name: 'propose_starting_point (one half: levels only)', tool: 'propose_starting_point', id: PROP,
    product: () => { const p = figuresProduct(); return withLanded(p, () => levelsLanded(p)); },
    args: { assumptions: [], option_levels: LEVELS },
    applies: [
      { kind: 'option_intervention_edit', option_id: 'hire_lead', factor_id: 'team_size', base_graph_hash: 'h0' },
      { kind: 'option_intervention_edit', option_id: 'hire_two', factor_id: 'team_size', base_graph_hash: 'h1' },
    ],
  },
  {
    name: 'propose_new_option (a held gmh_)', tool: 'propose_new_option', id: /^gmh_[0-9a-f]{12}$/,
    product: () => heldOptionProduct('the_add_option_handle'),
    args: NEW_OPTION,
    applies: [{ chip_id: expect.stringMatching(/^gmh_[0-9a-f]{12}$/), message: 'Add the option.' }],
  },
];

const capsOf = (p: Product, store: ProposalStore): AgentCapabilities =>
  createAgentCapabilities(p.d, store, undefined, 'full', undefined, p.readPendingActions !== undefined ? { readPendingActions: p.readPendingActions } : {});
const call = (caps: AgentCapabilities, tool: string, args: Record<string, unknown>, ctx: typeof REQ1): Promise<ToolResult> =>
  dispatchTool(tool, JSON.stringify(args), ctx, caps);

/** Propose under request 1 through the Agent's own dispatch; nothing is written by a proposal. */
async function minted(c: Case) {
  const p = c.product();
  const store = new ProposalStore();
  const caps = capsOf(p, store);
  const made = await call(caps, c.tool, c.args, REQ1);
  expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
  const id = String(made.proposal_id);
  expect(id, 'control: a real proposal was minted').toMatch(c.id);
  expect(p.writes(), 'control: a proposal writes nothing').toEqual([]);
  expect(p.waiting(store), 'control: exactly this change is waiting').toEqual([id]);
  return { p, store, caps, id };
}

describe('every proposer the Agent is given has a same-request row (MUTATION_TOOLS minus authorise_change)', () => {
  it('COVERAGE: the rows below name exactly the proposers `MUTATION_TOOLS` gives the Agent — a new proposer without a row fails here', () => {
    const proposers = MUTATION_TOOLS.filter((t) => t !== 'authorise_change');
    expect([...new Set(CASES.map((c) => c.tool))].sort()).toEqual([...proposers].sort());
    expect(proposers, 'control: authorise_change is a mutation tool and the only non-proposer').toHaveLength(MUTATION_TOOLS.length - 1);
  });
  it('COVERAGE: the starting point is covered on all three ways it mints an id — combined, values only, levels only', () => {
    expect(CASES.filter((c) => c.tool === 'propose_starting_point').map((c) => c.name)).toEqual([
      'propose_starting_point (the combined proposal)',
      'propose_starting_point (one half: values only)',
      'propose_starting_point (one half: levels only)',
    ]);
  });
});

describe.each(CASES)('$name', (c) => {
  it('RED: authorise_change of the id it just minted, in the SAME request → refused awaiting_your_approval, nothing sent, still waiting; the NEXT request applies exactly it', async () => {
    const { p, store, caps, id } = await minted(c);
    const same = await call(caps, 'authorise_change', { proposal_id: id }, REQ1);
    expect(same, JSON.stringify(same)).toEqual({
      ok: false, mutated: false, refusal: 'awaiting_your_approval', proposal_id: id,
      detail: expect.stringContaining('This change was prepared in this same reply, so the user has not seen it and cannot have approved it.'),
    });
    expect(p.writes(), 'nothing was sent').toEqual([]);
    expect(p.landed(), 'the model is unchanged').toBe(false);
    expect(p.waiting(store), 'the refusal consumed nothing: the same change still waits').toEqual([id]);
    const next = await call(caps, 'authorise_change', { proposal_id: id }, REQ2);
    expect(next, JSON.stringify(next)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(p.writes()).toEqual(c.applies);
    expect(p.landed()).toBe(true);
  });

  it('CONTRAST: approved on a LATER request (the approve chip, or a typed "yes") → applied, exactly the write the proposal describes', async () => {
    const { p, store, caps, id } = await minted(c);
    const next = await call(caps, 'authorise_change', { proposal_id: id }, REQ2);
    expect(next, JSON.stringify(next)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(p.writes()).toEqual(c.applies);
    expect(p.landed()).toBe(true);
    expect(p.waiting(store)).toEqual([]);
  });
});

/**
 * ⛔ A HOLD THE ADD-OPTION TURN MADE IS THIS REQUEST'S, WHATEVER HANDLE IT CARRIES AND WHATEVER CAME BACK (review of
 * 8566fc35, non-blocking 1). The capability recorded only the handle it computes itself (`node:<option id>`). When
 * route-v2's add-option transaction falls through to the free-text edit lane (route-v2.ts `fell_through:*`), that
 * lane can hold the change under ANOTHER `gmh_`, offered as the response's chip (edit-graph-dispatch.ts maps
 * `gmDecision.suggestedActions`, whose chip id is the hold's `proposalRef`, edit-graph-referee-gate.ts). The
 * capability then reports `not_prepared`, but `get_canonical_state` lists the hold as awaiting approval, and
 * `authorise_change` of it went straight to the product's confirm in the SAME request. That fall-through response is
 * modelled from the code read; no served capture of it exists.
 *
 * The second variant pins the OWN handle when the response never arrives with its chip (500 after the hold): only
 * the handle the capability computes records it then.
 */
const HELD_VARIANTS = [
  { name: 'held under ANOTHER handle and offered in the response (the edit-lane fall-through)', heldUnder: 'another_handle', respond: 'offered' },
  { name: 'held under its OWN handle, but the response is lost (500 after the hold)', heldUnder: 'the_add_option_handle', respond: 'lost' },
] as const;
describe.each(HELD_VARIANTS)('propose_new_option: $name', (v) => {
  it('RED: propose reports not_prepared; the Agent reads the hold from get_canonical_state and authorises it in the SAME request → refused, no confirm sent, still held', async () => {
    const p = heldOptionProduct(v.heldUnder, v.respond);
    const store = new ProposalStore();
    const caps = capsOf(p, store);
    const made = await call(caps, 'propose_new_option', NEW_OPTION, REQ1);
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'not_prepared' }));
    const held = p.heldRef();
    const ownHandle = gmHeldProposalRef(SCENARIO, `node:${String(p.heldOptionId())}`);
    expect(held, 'control: the product holds it').toMatch(/^gmh_[0-9a-f]{12}$/);
    expect(held === ownHandle, 'control: under the handle this variant names').toBe(v.heldUnder === 'the_add_option_handle');
    const state = await call(caps, 'get_canonical_state', {}, REQ1);
    expect((state.awaiting_your_approval as { proposal_id: string }[]).map((x) => x.proposal_id), 'the Agent can see it').toEqual([held]);
    const same = await call(caps, 'authorise_change', { proposal_id: String(held) }, REQ1);
    expect(same, JSON.stringify(same)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'awaiting_your_approval', proposal_id: held }));
    expect(p.writes(), 'the product\'s confirm was never sent').toEqual([]);
    expect(p.landed(), 'nothing was added').toBe(false);
    expect(p.waiting(store), 'the hold still waits').toEqual([held]);
  });

  it('CONTRAST: the same hold approved on the NEXT request → confirmed and added', async () => {
    const p = heldOptionProduct(v.heldUnder, v.respond);
    const caps = capsOf(p, new ProposalStore());
    await call(caps, 'propose_new_option', NEW_OPTION, REQ1);
    const held = String(p.heldRef());
    const next = await call(caps, 'authorise_change', { proposal_id: held }, REQ2);
    expect(next, JSON.stringify(next)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true, proposal_id: held }));
    expect(p.writes()).toEqual([{ chip_id: held, message: 'Add the option.' }]);
    expect(p.landed()).toBe(true);
  });
});
