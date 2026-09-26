/**
 * ⛔ A WRITE THAT LANDED IS NEVER "NOT SAVED" BECAUSE ANOTHER WRITER MOVED THE MODEL AFTERWARDS (round-2 review of
 * fix/agent-never-shows-instructions-or-codes, blocker 2, and its class).
 *
 * Probed by the reviewer through the REAL capability: the link write answered 200 with its revision, another writer
 * moved the model before the read-back, the link held exactly the approved 0.825 stamped `user_specified` — and the
 * result was `not_applied, mutated:false`, read by the user as "Not saved: none of it was applied."
 *
 * THE RULE, the same in every branch of `authoriseChange`, once the write answered 200:
 *   · the read-back holds exactly what was approved → LANDED (and the proposal is marked applied);
 *   · otherwise, if THIS write's own response shows it committed (its committed post-state holds the change, or its
 *     revision moved from the approved one) → "could not be confirmed" (`not_verified`, `mutated: true`) — never
 *     "Not saved"; a read-back that failed outright → `not_confirmed`;
 *   · otherwise the response shows nothing was committed, and "Not saved" is true.
 *
 * MANIFEST — every branch of `authoriseChange` that decides landed-ness (grep of `runtime/agent-capabilities.ts` for
 * `landed`, `graph_hash`, `not_applied`, `markApplied`):
 *   · link strength (`update_edge` → `edge_strength_edit`) — decided by HASH EQUALITY with the read-back ⇒ fixed;
 *     rows below, and [f2-race] / [f2-race-moved] on the real route (`agent-never-shows-instructions-or-codes.test.ts`).
 *   · add a link (`structural_add_edge`) — decided by read-back existence alone: a committed link another writer then
 *     removed, or a read-back that failed, read "Not saved" ⇒ fixed; rows below.
 *   · compound level whose write committed nothing (`applyCompound`, the verified no-op) — decided by HASH EQUALITY
 *     first ⇒ fixed; rows in `one-approval-starting-point.test.ts` (round-2 blocker 2 class).
 *   · compound values / committed levels — decided by THIS write's own response (register 200, the level's own
 *     `graph_hash`), never the read-back hash; unchanged.
 *   · `set_option_intervention` — own response's committed hash (`ownLevelWrite`); a later writer only annotates
 *     (`option-interventions.test.ts`: "a level we saved that someone else then removed is ours"); unchanged.
 *   · `set_factor_value` — own response's applied `graph_patch` (`valueWriteCommittedByThisRequest`;
 *     `value-write-proven-by-its-own-response.test.ts`); unchanged.
 *   · held add-option (`confirmHeld`) — own response's `draft_graph`; a moved model after it is `not_verified`,
 *     `mutated: true`, read as "could not be confirmed" ([c3b], `agent-add-option-held-seam.test.ts`). Never "Not
 *     saved". It is NOT upgraded to landed on the read-back, because its read-back (`holdsAll`) checks the option ids
 *     and decision links only — not the levels — so it cannot establish "exactly what was approved".
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { narrateWriteOutcome, withWriteOutcome } from '../write-outcome.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400a2';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_turn_text: 'Pro plan price has a strong effect on MRR.' };

/** Exactly what the user reads for one approval's result (the fast path's status line). */
const said = (r: Record<string, unknown>): string => {
  const n = narrateWriteOutcome('', [{ name: 'authorise_change' }], [r as never], { versioned: false });
  return withWriteOutcome(n.text, n.status);
};

type Edge = { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number; effect_direction: 'positive' | 'negative'; provenance?: { source: string } };
type G = { nodes: { id: string; kind: string; label: string }[]; edges: Edge[] };

/**
 * One stored model and its revision. `onWrite` is the link/edge writer, modelled only as far as its contract states it;
 * `thenAnotherWriter` runs AFTER the write has answered and BEFORE the capability reads the model back.
 */
function world(initial: G, onWrite: (g: G, ev: Record<string, unknown>) => { g: G; committed: boolean; moved: boolean; json?: Record<string, unknown> }) {
  let g = JSON.parse(JSON.stringify(initial)) as G;
  let rev = 1;
  let thenAnotherWriter: ((g: G) => G) | undefined;
  let writes = 0;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: `h${rev}` } };
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    writes += 1;
    const out = onWrite(g, ev);
    g = out.g;
    if (out.moved) rev += 1;
    const answered = { status: 200, json: { assistant_text: out.committed ? 'Updated.' : "I couldn't save that change, so I haven't changed anything.", graph_hash: `h${rev}`, ...(out.json ?? {}) } };
    if (thenAnotherWriter !== undefined) { g = thenAnotherWriter(g); rev += 1; }
    return answered;
  };
  return { d, set: (f: ((g: G) => G) | undefined) => { thenAnotherWriter = f; }, graph: () => g, writes: () => writes };
}

const NODES = [
  { id: 'dec', kind: 'decision', label: 'Price decision' },
  { id: 'price', kind: 'factor', label: 'Pro plan price' },
  { id: 'mrr', kind: 'goal', label: 'MRR' },
];
const linkAt = (mean: number, source = 'cee_hypothesis'): G => ({ nodes: NODES,
  edges: [{ from: 'price', to: 'mrr', strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source } }] });

/** The product's link-strength writer: sets ±magnitude (or keeps it, on confirm) and stamps it the user's. */
const linkWriter = (opts: { refuse?: boolean; draft?: boolean } = {}) => (g: G, ev: Record<string, unknown>) => {
  if (opts.refuse === true) return { g, committed: false, moved: false };
  const next: G = { ...g, edges: g.edges.map((e) => (e.from === ev['from'] && e.to === ev['to']
    ? { ...e, strength: { ...e.strength, mean: Number(ev['magnitude']) }, provenance: { source: 'user_specified' } } : e)) };
  // A provenance-only confirm leaves the ANALYSIS hash where it was (provenance is outside its projection).
  const moved = ev['intent'] !== 'confirm_current';
  return { g: next, committed: true, moved, ...(opts.draft === true ? { json: { draft_graph: next } } : {}) };
};

const anotherWriterMovesSomethingElse = (g: G): G => g;
const anotherWriterChangesTheLink = (g: G): G => ({ ...g, edges: g.edges.map((e) => ({ ...e, strength: { ...e.strength, mean: 0.3 }, provenance: { source: 'cee_hypothesis' } })) });

describe('link strength: landed is what the model holds, never whether two revisions are equal', () => {
  // ONE EDGE-STRENGTH VOCABULARY (#2003): bands are the canvas's (0.2 / 0.4 / 0.7). A value-write row starts at 0.25
  // (Moderate, and not the other writer's 0.3), so "strong" writes 0.55; the provenance-only row starts at 0.5, already Strong.
  const propose = async (w: ReturnType<typeof world>, store: ProposalStore) => {
    const caps = createAgentCapabilities(w.d, store);
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'The user said so.' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    return { caps, id: String(p.proposal_id) };
  };

  it('RED (the reviewer\'s probe): 200 + another writer moves the model + the link holds exactly 0.825, the user\'s → LANDED, marked applied, "Saved."', async () => {
    const w = world(linkAt(0.25), linkWriter());
    const store = new ProposalStore();
    const { caps, id } = await propose(w, store);
    w.set(anotherWriterMovesSomethingElse);
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true, proposal_id: id }));
    expect(r.follow_up).toBe('Recorded "Pro plan price" → "MRR" as strong (0.55 on Olumi\'s 0–1 scale), as your own estimate.');
    expect(said(r)).toBe('Saved.');
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
  });

  it('RED: 200 + another writer then changes THAT link → not_verified, mutated:true, "could not be confirmed" — never "Not saved"; NOT marked applied', async () => {
    const w = world(linkAt(0.25), linkWriter());
    const store = new ProposalStore();
    const { caps, id } = await propose(w, store);
    w.set(anotherWriterChangesTheLink);
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_verified', proposal_id: id }));
    expect(r.follow_up).toBeUndefined();
    expect(said(r)).toMatch(/^The change was sent, but it could not be confirmed/);
    expect(said(r)).not.toMatch(/Not saved|Saved\./);
    expect(store.outstanding(SCENARIO, null).map((x) => x.proposal_id)).toEqual([id]);
  });

  it('RED: a provenance-only confirm (the revision does not move) whose own committed post-state holds the change, then another writer changes the link → not_verified, never "Not saved"', async () => {
    const w = world(linkAt(0.5), linkWriter({ draft: true }));
    const { caps, id } = await propose(w, new ProposalStore());
    w.set(anotherWriterChangesTheLink);
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, refusal: 'not_verified' }));
  });

  it('CONTRAST (passes at base): the writer refuses (200, revision unmoved) while another writer moves the model → "Not saved", mutated:false — the response shows nothing was committed', async () => {
    const w = world(linkAt(0.25), linkWriter({ refuse: true }));
    const store = new ProposalStore();
    const { caps, id } = await propose(w, store);
    w.set(anotherWriterMovesSomethingElse);
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'not_applied' }));
    expect(said(r)).toBe('Not saved: none of it was applied.');
    expect(store.outstanding(SCENARIO, null).map((x) => x.proposal_id)).toEqual([id]);
  });

  it('CONTROL (passes at base): no other writer → landed, "Saved."', async () => {
    const w = world(linkAt(0.25), linkWriter());
    const { caps, id } = await propose(w, new ProposalStore());
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
  });
});

describe('add a link: a committed link is never "Not saved" because of what happened after it', () => {
  const G0: G = { nodes: [{ id: 'competitive_pricing', kind: 'factor', label: 'Competitive pricing' }, { id: 'monthly_churn', kind: 'factor', label: 'Monthly churn' }], edges: [] };
  const edgeWriter = (opts: { refuse?: boolean } = {}) => (g: G, ev: Record<string, unknown>) => (opts.refuse === true
    ? { g, committed: false, moved: false }
    : { g: { ...g, edges: [...g.edges, { from: String(ev['from']), to: String(ev['to']), strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' as const }] }, committed: true, moved: true });
  const linkCtx = { ...ctx, user_turn_text: 'Competitive pricing has a strong effect on monthly churn.' };
  const propose = async (d: InternalDispatch, store: ProposalStore) => {
    const caps = createAgentCapabilities(d, store);
    // #1996: a new link carries the band the user typed THIS turn.
    const p = await caps.proposeModelChange(linkCtx, { from_label: 'Competitive pricing', to_label: 'Monthly churn', direction: 'negative', strength: 'strong', rationale: 'competitor discounts raise churn' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    return { caps, id: String(p.proposal_id) };
  };

  it('RED: the link is written (200, the revision moves), then another writer removes it before the read-back → not_verified, mutated:true, "could not be confirmed"', async () => {
    const w = world(G0, edgeWriter());
    const store = new ProposalStore();
    const { caps, id } = await propose(w.d, store);
    w.set((g) => ({ ...g, edges: [] }));
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_verified' }));
    expect(said(r)).toMatch(/^The change was sent, but it could not be confirmed/);
    expect(said(r)).not.toMatch(/Not saved/);
  });

  it('RED: the link is written (200) and the read-back fails → not_confirmed, "could not be confirmed" — never "Not saved"', async () => {
    const w = world(G0, edgeWriter());
    let reads = 0;
    const blind: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) { reads += 1; if (reads > 2) return { status: 503, json: {} }; }
      return w.d(path, body);
    };
    const { caps, id } = await propose(blind, new ProposalStore());
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'not_confirmed' }));
    expect(said(r)).toMatch(/could not be confirmed/);
    expect(said(r)).not.toMatch(/Not saved/);
  });

  it('CONTRAST (passes at base): the writer refuses (200, revision unmoved) while another writer moves the model → "Not saved", mutated:false', async () => {
    const w = world(G0, edgeWriter({ refuse: true }));
    const { caps, id } = await propose(w.d, new ProposalStore());
    w.set(anotherWriterMovesSomethingElse);
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'not_applied' }));
    expect(said(r)).toMatch(/^Not saved/);
  });

  it('CONTROL (passes at base): written, another writer moves something else, the link is there → applied', async () => {
    const w = world(G0, edgeWriter());
    const { caps, id } = await propose(w.d, new ProposalStore());
    w.set(anotherWriterMovesSomethingElse);
    const r = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
  });
});
