/**
 * ⭐ THE USER ASKS THE AGENT TO REMOVE A LINK OR AN OPTION — one proposal, one approval, the product's typed removal writer.
 *
 * Before this, the Agent had no removal tool at all: asked to drop an option or a link it could only say it could not.
 * `propose_removal` prepares ONE change the user approves once; the approval sends exactly ONE `structural_delete`
 * system event (schemas 0.59) through `/orchestrate/v2/turn`, the same seam the canvas delete uses, carrying the
 * proposal's own base hash. The adapter (`structural-delete.ts`, `applyRemoveNode`) owns the incident-edge cascade,
 * so an option is sent as a node id and its links are never listed.
 *
 * Every event is parsed by the REAL boundary schemas (`SystemEventTurnPayloadSchema` and the root
 * `OrchestratorTurnPayloadSchema`, which carries the cross-field "a delete must remove something" rule). The fake
 * writer below is modelled only as far as the product's contract states it; the companion
 * `agent-removes-real-dispatch.test.ts` drives the REAL route-v2 dispatch in-process.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OrchestratorTurnPayloadSchema, SystemEventTurnPayloadSchema } from '@talchain/schemas/boundary';
import { authorisationTurnId, createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS, MUTATION_TOOLS, dispatchTool, toolsFor, type AgentCapabilities } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipIdFor, approvalChipsFor, proposalsAwaitingApproval } from '../approval-chips.js';
import { narrateWriteOutcome } from '../write-outcome.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440088';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: 'Remove that.', user_turn_text: 'Remove that.' };

type Edge = { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number; effect_direction: 'positive' | 'negative' };
type Node = { id: string; kind: string; label: string };
type G = { nodes: Node[]; edges: Edge[] };
const e = (from: string, to: string): Edge => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
const seed = (): G => ({
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Pricing decision' },
    { id: 'goal', kind: 'goal', label: 'MRR' },
    { id: 'price', kind: 'factor', label: 'Pro plan price' },
    { id: 'churn', kind: 'factor', label: 'Monthly churn' },
    { id: 'opt_keep', kind: 'option', label: 'Keep £49' },
    { id: 'opt_raise', kind: 'option', label: 'Raise to £59' },
    { id: 'opt_trial', kind: 'option', label: 'Free trial' },
  ],
  edges: [
    e('dec', 'opt_keep'), e('dec', 'opt_raise'), e('dec', 'opt_trial'),
    e('opt_keep', 'price'), e('opt_raise', 'price'), e('opt_trial', 'churn'),
    e('price', 'goal'), e('churn', 'goal'), e('price', 'churn'),
  ],
});

/** The product's own words for two of its outcomes (`structural-delete.ts`), verbatim. */
const PRODUCT_REFUSAL = 'I couldn’t match every connection you deleted to the saved model, so I haven’t removed anything. Reload it and try again.';

/**
 * A recording dispatch over one stored graph. The removal writer is modelled as its contract states it: a stale base
 * is a 409; otherwise the named nodes go with every incident edge (the cascade), the named edges go, the response
 * carries the committed graph as `draft_graph`, and the model's revision moves. Modes: `claim_only` answers exactly as
 * a commit would but the stored model does not change (what the dispatch's own receipt check cannot see: it compares
 * its projection, not a read-back); `refuse` is the product's committed refusal (200, its sentence, no graph).
 */
function world(initial: G, mode: 'apply' | 'claim_only' | 'refuse' | 'diverged' = 'apply') {
  let g = JSON.parse(JSON.stringify(initial)) as G;
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const ev = ((body as { event?: Record<string, unknown> }).event ?? {}) as { kind?: string; removed_node_ids?: string[]; removed_edges?: { from: string; to: string }[]; base_graph_hash?: string };
    if (ev.kind !== 'structural_delete') throw new Error(`unexpected dispatch ${path} ${JSON.stringify(body)}`);
    if (mode === 'diverged' || ev.base_graph_hash !== `h${rev}`) {
      return { status: 409, json: { error: 'GRAPH_DIVERGED', boundary: 'B1', details: { reason: 'graph_write_conflict', conflict_category: 'BASE_HASH_DIVERGED' } } };
    }
    if (mode === 'refuse') return { status: 200, json: { assistant_text: PRODUCT_REFUSAL, blocks: [], graph_hash: `h${rev}` } };
    const drop = new Set(ev.removed_node_ids ?? []);
    const dropEdges = new Set((ev.removed_edges ?? []).map((x) => `${x.from}::${x.to}`));
    const next: G = {
      nodes: g.nodes.filter((n) => !drop.has(n.id)),
      edges: g.edges.filter((x) => !drop.has(x.from) && !drop.has(x.to) && !dropEdges.has(`${x.from}::${x.to}`)),
    };
    const json = { assistant_text: 'Removed it from your model. That change is saved, so it stays removed when you re-run.', blocks: [], graph_hash: `h${rev + 1}`, draft_graph: next };
    if (mode === 'claim_only') return { status: 200, json };
    g = next;
    rev += 1;
    return { status: 200, json };
  };
  /** Another writer changes the model (an analysis-affecting change moves the revision). */
  const move = (): void => { g = { ...g, edges: g.edges.map((x) => (x.from === 'price' && x.to === 'goal' ? { ...x, strength: { mean: 0.7, std: 0.1 } } : x)) }; rev += 1; };
  return { d, sent, graph: () => g, move };
}

const parsesOnTheWire = (body: Record<string, unknown>): void => {
  const a = SystemEventTurnPayloadSchema.safeParse(body);
  expect(a.success, a.success ? '' : JSON.stringify(a.error.issues)).toBe(true);
  const b = OrchestratorTurnPayloadSchema.safeParse(body);
  expect(b.success, b.success ? '' : JSON.stringify(b.error.issues)).toBe(true);
};
const hasEdge = (g: G, from: string, to: string): boolean => g.edges.some((x) => x.from === from && x.to === to);
/** A raw machine code in user-facing words: snake_case or SHOUTING_CASE. */
const RAW_CODE = /\b[a-z]+(?:_[a-z]+)+\b|\b[A-Z]+(?:_[A-Z]+)+\b/;
const propose = (caps: AgentCapabilities, args: Record<string, unknown>) => {
  expect(caps.proposeRemoval, 'the capability exists').toBeTypeOf('function');
  return caps.proposeRemoval!(ctx, args as never);
};

describe('the Agent removes a link or an option through the product\'s typed removal writer', () => {
  it('RED (happy path, link): propose → ONE approve chip → approve on a LATER turn → exactly ONE structural_delete with the proposal\'s base → read back → plain receipt', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { links: [{ from_label: 'Pro plan price', to_label: 'Monthly churn' }], rationale: 'The user asked to drop it.' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(p.public_label).toBe('Remove the link "Pro plan price" → "Monthly churn"');
    expect(w.sent, 'a proposal sends nothing').toEqual([]);
    const pid = String(p.proposal_id);
    const calls = [{ name: 'propose_removal', ok: true, mutated: false, proposal_id: pid }];
    expect(approvalChipsFor(calls).map((c) => c.id), 'ONE approve button, plus amend').toEqual([approvalChipIdFor(pid), 'agent-amend-proposal']);
    expect(proposalsAwaitingApproval(calls).get(pid)).toBe('propose_removal');

    // A LATER turn: a fresh request's capabilities over the same proposal store.
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctx, { proposal_id: pid });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true, proposal_id: pid }));
    expect(w.sent, 'exactly one typed event').toHaveLength(1);
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]).toEqual({
      kind: 'system_event', turn_id: authorisationTurnId(pid), scenario_id: SCENARIO, stage: 'frame',
      event: { kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'price', to: 'churn' }], base_graph_hash: 'h1' },
    });
    expect(hasEdge(w.graph(), 'price', 'churn')).toBe(false);
    expect(w.graph().edges, 'nothing else went').toHaveLength(seed().edges.length - 1);
    expect(r.follow_up).toBe('Removed the link "Pro plan price" → "Monthly churn".');
    const status = narrateWriteOutcome('', [{ name: 'authorise_change' }], [r], { versioned: false }).status;
    expect(status).toBe('Saved.');
    // A second approval of the same proposal applies nothing twice.
    const again = await createAgentCapabilities(w.d, store).authoriseChange(ctx, { proposal_id: pid });
    expect(again).toEqual(expect.objectContaining({ ok: true, already_applied: true, mutated: false }));
    expect(w.sent).toHaveLength(1);
  });

  it('RED (happy path, option): the option is sent as a node id and its links are NEVER listed — the product\'s cascade owns them', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { options: ['Free trial'], rationale: 'x' });
    expect(p.public_label).toBe('Remove the option "Free trial"');
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual({ kind: 'structural_delete', removed_node_ids: ['opt_trial'], removed_edges: [], base_graph_hash: 'h1' });
    expect(w.graph().nodes.map((n) => n.id)).not.toContain('opt_trial');
    expect(w.graph().edges.some((x) => x.from === 'opt_trial' || x.to === 'opt_trial')).toBe(false);
    expect(r.follow_up).toBe('Removed the option "Free trial" and its 2 links.');
  });

  it('an option and a link in one change: a link that the option\'s own removal takes is not listed; an unrelated link is', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), {
      options: ['Free trial'],
      links: [{ from_label: 'Free trial', to_label: 'Monthly churn' }, { from_label: 'Pro plan price', to_label: 'Monthly churn' }],
      rationale: 'x',
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true }));
    expect(p.public_label).toBe('Remove the option "Free trial"; Remove the link "Pro plan price" → "Monthly churn"');
    await createAgentCapabilities(w.d, store).authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual({ kind: 'structural_delete', removed_node_ids: ['opt_trial'], removed_edges: [{ from: 'price', to: 'churn' }], base_graph_hash: 'h1' });
  });
});

describe('⛔ scope: only an option or a link is removed here, and an option is never left unlinked', () => {
  it('RED: the decision → option link is refused — "to drop that option, remove the option" — nothing prepared, nothing sent', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { links: [{ from_label: 'Pricing decision', to_label: 'Free trial' }], rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    expect(p).not.toHaveProperty('proposal_id');
    expect(String(p.detail)).toMatch(/to drop that option, remove the option/i);
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('RED: a factor, the goal or the decision named as something to remove is refused and said (out of scope) — nothing prepared', async () => {
    for (const [label, kind] of [['Pro plan price', 'factor'], ['MRR', 'goal'], ['Pricing decision', 'decision']] as const) {
      const w = world(seed());
      const store = new ProposalStore();
      const p = await propose(createAgentCapabilities(w.d, store), { options: [label], rationale: 'x' });
      expect(p, `${label}: ${JSON.stringify(p)}`).toEqual(expect.objectContaining({ ok: false, mutated: false }));
      expect(p, label).not.toHaveProperty('proposal_id');
      expect(String(p.detail), label).toContain(`"${label}" is a ${kind}`);
      expect(store.outstanding(SCENARIO, null), label).toEqual([]);
      expect(w.sent, label).toEqual([]);
    }
  });
});

describe('⛔ unresolved or ambiguous: a refusal naming the candidates, nothing prepared, nothing sent', () => {
  it('RED: an option the model does not have → refused, naming the options it does have', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { options: ['Annual plan'], rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'unresolved_entity' }));
    expect(p.unresolved).toEqual([{ requested: 'Annual plan', candidates: ['Keep £49', 'Raise to £59', 'Free trial'] }]);
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('RED: a link the model does not have → refused, naming the links it has between those entities', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { links: [{ from_label: 'Monthly churn', to_label: 'Pro plan price' }], rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'unresolved_entity' }));
    const u = (p.unresolved as { requested: string; candidates: string[] }[])[0]!;
    expect(u.requested).toBe('"Monthly churn" → "Pro plan price"');
    expect(u.candidates).toEqual(expect.arrayContaining(['"Pro plan price" → "Monthly churn"']));
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('RED: two options answer to one name → ambiguous, every candidate named, nothing guessed', async () => {
    const g = seed();
    g.nodes.push({ id: 'opt_trial_2', kind: 'option', label: 'Free trial' });
    g.edges.push(e('dec', 'opt_trial_2'));
    const w = world(g);
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { options: ['Free trial'], rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'ambiguous_entity' }));
    const amb = (p.ambiguous_targets as { requested: string; candidates: { id: string }[] }[])[0]!;
    expect(amb.candidates.map((c) => c.id).sort()).toEqual(['opt_trial', 'opt_trial_2']);
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('nothing named, or more than 8 targets → refused, nothing prepared', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const caps = createAgentCapabilities(w.d, store);
    expect(await propose(caps, { rationale: 'x' })).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    const nine = await propose(caps, { options: Array.from({ length: 9 }, (_, i) => `Option ${i}`), rationale: 'x' });
    expect(nine).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    expect(String(nine.detail)).toMatch(/8/);
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('a proposal made for one subject is never applied for another (not the user\'s): refused, nothing sent', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { options: ['Free trial'], rationale: 'x' });
    const r = await createAgentCapabilities(w.d, store).authoriseChange({ ...ctx, authenticated_user_id: 'someone-else' }, { proposal_id: String(p.proposal_id) });
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'not_authorised' }));
    expect(w.sent).toEqual([]);
    expect(w.graph().nodes.map((n) => n.id)).toContain('opt_trial');
  });
});

describe('⛔ an approval never lands on a model the user did not see, and a removal is confirmed from the model — never from a 200', () => {
  it('RED: the model moved since the proposal → superseded, NOTHING sent', async () => {
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { options: ['Free trial'], rationale: 'x' });
    w.move();
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'superseded' }));
    expect(w.sent).toEqual([]);
    expect(w.graph().nodes.map((n) => n.id)).toContain('opt_trial');
  });

  it('RED: a 200 that claims the removal while the model read back still holds it → "could not be confirmed" (mutated:true) — never "Removed", never "Not saved"', async () => {
    const w = world(seed(), 'claim_only');
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { options: ['Free trial'], rationale: 'x' });
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(w.sent).toHaveLength(1);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' }));
    const words = `${String(r.detail ?? '')} ${String(r.follow_up ?? '')}`;
    expect(words).toMatch(/could not be confirmed/i);
    expect(words).not.toMatch(/^Removed|\bRemoved the\b/);
    const status = String(narrateWriteOutcome('', [{ name: 'authorise_change' }], [r], { versioned: false }).status);
    expect(status).toMatch(/could not be confirmed/i);
    expect(status).not.toMatch(/Removed|Not saved|Partly saved|^Saved/);
    expect(status).not.toMatch(RAW_CODE);
  });

  it('RED: the product refuses (200, its own sentence, no graph) → its sentence is relayed in plain words, nothing removed, no code', async () => {
    const w = world(seed(), 'refuse');
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { links: [{ from_label: 'Pro plan price', to_label: 'Monthly churn' }], rationale: 'x' });
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false, refusal: 'not_applied' }));
    expect(String(r.detail)).toContain(PRODUCT_REFUSAL);
    expect(String(r.follow_up), 'the typed-approval path shows it too').toContain(PRODUCT_REFUSAL);
    const status = String(narrateWriteOutcome('', [{ name: 'authorise_change' }], [r], { versioned: false }).status);
    expect(status).toMatch(/^Not saved/);
    expect(`${String(r.detail)} ${String(r.follow_up)} ${status}`).not.toMatch(RAW_CODE);
    expect(hasEdge(w.graph(), 'price', 'churn')).toBe(true);
  });

  it('RED: the product answers 409 (the model moved between our read and its own) → plain words, nothing removed, no code', async () => {
    const w = world(seed(), 'diverged');
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { options: ['Free trial'], rationale: 'x' });
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false }));
    const status = String(narrateWriteOutcome('', [{ name: 'authorise_change' }], [r], { versioned: false }).status);
    const said = `${String(r.detail)} ${String(r.follow_up)} ${status}`;
    expect(said).toMatch(/changed/i);
    expect(said).not.toMatch(RAW_CODE);
    expect(said).not.toMatch(/\b409\b|http/i);
    expect(w.graph().nodes.map((n) => n.id)).toContain('opt_trial');
  });
});

describe('a removal proposal survives the durable carrier round trip, like every other proposal', () => {
  it('RED: the carrier the answer row persists (JSONB-reordered, through the REAL parser) restores into a fresh process and applies the same event', async () => {
    const { proposalPendingAction, rehydrateProposals } = await import('../durable-proposal.js');
    const { parsePendingAction } = await import('../../session/pending-action.js');
    const jsonbOrder = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(jsonbOrder)
        : v !== null && typeof v === 'object'
          ? Object.fromEntries(Object.keys(v as Record<string, unknown>).filter((k) => (v as Record<string, unknown>)[k] !== undefined)
            .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
          : v;
    const w = world(seed());
    const store = new ProposalStore();
    const p = await propose(createAgentCapabilities(w.d, store), { options: ['Free trial'], links: [{ from_label: 'Pro plan price', to_label: 'Monthly churn' }], rationale: 'x' });
    const pid = String(p.proposal_id);
    const chip = approvalChipsFor([{ name: 'propose_removal', ok: true, mutated: false, proposal_id: pid }])[0]!;
    const pa = parsePendingAction(jsonbOrder(JSON.parse(JSON.stringify(proposalPendingAction(store.get(pid)!, chip, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() })))));
    expect(pa, 'the production read would drop it').not.toBeNull();
    const fresh = new ProposalStore();
    expect(rehydrateProposals([pa!], fresh, { scenario_id: SCENARIO, user_id: null })).toBe(1);
    const r = await createAgentCapabilities(w.d, fresh).authoriseChange(ctx, { proposal_id: pid });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual({ kind: 'structural_delete', removed_node_ids: ['opt_trial'], removed_edges: [{ from: 'price', to: 'churn' }], base_graph_hash: 'h1' });
  });
});

describe('the tool is registered and the route names it', () => {
  it('RED: propose_removal is declared (links, options, rationale), is a mutation tool (absent from preview), and dispatch reaches the capability', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'propose_removal');
    expect(tool, 'declared').toBeDefined();
    const params = tool!.parameters as { properties: Record<string, { items?: { required?: string[] } }>; required: string[] };
    expect(Object.keys(params.properties).sort()).toEqual(['links', 'options', 'rationale']);
    expect(params.required).toEqual(['rationale']);
    expect(params.properties['links']!.items!.required).toEqual(['from_label', 'to_label']);
    expect(MUTATION_TOOLS).toContain('propose_removal');
    expect(toolsFor('preview').map((t) => t.name)).not.toContain('propose_removal');
    let reached: unknown;
    const caps = { proposeRemoval: async (_c: unknown, a: unknown) => { reached = a; return { ok: true, mutated: false }; } } as unknown as AgentCapabilities;
    await dispatchTool('propose_removal', JSON.stringify({ options: ['Free trial'], rationale: 'x' }), ctx, caps, 'full');
    expect(reached).toEqual({ options: ['Free trial'], rationale: 'x' });
    expect(await dispatchTool('propose_removal', '{}', ctx, caps, 'preview')).toEqual(expect.objectContaining({ ok: false, refusal: 'read_only_preview' }));
  });

  it('RED: the route\'s MUTATION_INSTRUCTION names propose_removal (the full-mode clause)', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const start = route.indexOf('const MUTATION_INSTRUCTION =');
    expect(start).toBeGreaterThan(-1);
    const decl = route.slice(start, route.indexOf(';\n', start));
    // `preview ? '<read-only line>' : '<full-mode line>'` — the full-mode branch is the one after the ternary's `:` line.
    const fullMode = /\n\s+:\s+(['`])([\s\S]*)$/.exec(decl)?.[2] ?? '';
    expect(fullMode, decl).toMatch(/^To change the model/);
    expect(fullMode).toContain('propose_removal');
  });
});
