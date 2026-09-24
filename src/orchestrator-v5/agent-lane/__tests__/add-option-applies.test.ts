/**
 * ⭐ THE APPLY ROUTE for "add that option".
 *
 * ⛔ THE THING MOST LIKELY TO BE WRONG, AND THEREFORE THE THING PINNED HARDEST:
 * the base hash moves on every write. `structural_add_edge` refuses
 * `BASE_HASH_DIVERGED` against a stale base, and the node write moves the hash —
 * so reusing the proposal's base hash for the edges would refuse every edge AFTER
 * the user approved. The fake below CHECKS the hash it is handed and refuses a
 * stale one, exactly as the served writer does. Without the re-read, these go red.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' };

type N = { id: string; kind: string; label: string };
type E = { from: string; to: string; effect_direction?: string };

/** Mirrors the served writers: every write moves the hash, and a stale base refuses. */
/**
 * A VALID `model_version_mutation_receipt.v1`. Built to the real schema rather than
 * a shape I invented — `receiptSummaryOf` parses it strictly, so an invented one
 * would silently yield zero receipts and make the array assertions vacuous.
 */
const uuid = (n: number, tag: string): string =>
  `${tag.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
function receipt(rev: number) {
  return {
    model_version_receipt: {
      schema: 'model_version_mutation_receipt.v1',
      scenario_id: SCENARIO,
      mutation_id: uuid(rev, 'aaaaaaaa'),
      version_id: uuid(rev, 'bbbbbbbb'),
      sequence: rev,
      graph: { nodes: [], edges: [] },
      full_hash: 'a'.repeat(64),
      hash_algorithm: 'sha256',
      identity_projection_version: '1',
      identity_normaliser_version: '1',
      graph_schema_version: '3',
      // The remaining REQUIRED fields of the strict v1 schema (mutation-receipt.ts) — without them
      // every receipt parsed to nothing and any receipt COUNT here was vacuous.
      analysis_affecting_hash: 'b'.repeat(64),
      actor: { kind: 'system' },
      creation: { kind: 'committed_mutation' },
      source_turn_id: `turn-${rev}`,
      lineage: { kind: 'unknown' },
      undo_version_id: null,
      event_id: `event-${rev}`,
    },
  };
}

function fakeProduct(refuseEdgeToInit: string | null = null) {
  let refuseEdgeTo = refuseEdgeToInit;
  // A foreign author edits the model at the very moment this edge write arrives (the window Codex named).
  let foreignDuringEdgeTo: string | null = null;
  let nodes: N[] = [
    { id: 'goal', kind: 'goal', label: 'Increase velocity' },
    { id: 'dev_headcount', kind: 'factor', label: 'Developer headcount' },
    { id: 'lead_time', kind: 'factor', label: 'Lead time' },
  ];
  let edges: E[] = [];
  let rev = 0;
  const refusedStale: string[] = [];
  const writes: string[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, string>;
      if (ev.kind === 'structural_add_edge' && foreignDuringEdgeTo !== null && ev.to === foreignDuringEdgeTo) {
        foreignDuringEdgeTo = null;
        nodes = [...nodes, { id: 'someone_elses', kind: 'factor', label: 'Someone else\'s factor' }]; rev += 1;
      }
      if (ev.base_graph_hash !== `h${rev}`) {
        refusedStale.push(`${ev.kind}:${ev.base_graph_hash}`);
        return { status: 200, json: { assistant_text: 'BASE_HASH_DIVERGED — nothing was written.' } };
      }
      if (ev.kind === 'structural_add') { nodes = [...nodes, { id: ev.node_id, kind: ev.node_kind, label: ev.label }]; rev += 1; writes.push(ev.kind); return { status: 200, json: { assistant_text: 'Added.', ...receipt(rev) } }; }
      if (ev.kind === 'structural_add_edge') {
        if (refuseEdgeTo !== null && ev.to === refuseEdgeTo) return { status: 200, json: { assistant_text: 'That link was refused.' } };
        edges = [...edges, { from: ev.from, to: ev.to, effect_direction: ev.effect_direction }]; rev += 1; writes.push(ev.kind);
        return { status: 200, json: { assistant_text: 'Linked.', ...receipt(rev) } };
      }
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
  };
  /** Stop refusing (the served cause of a refused link has cleared). */
  const allowAll = () => { refuseEdgeTo = null; };
  /** Someone ELSE changes the model: a new revision this proposal did not write. */
  const foreignEdit = () => { nodes = [...nodes, { id: 'unrelated', kind: 'factor', label: 'Unrelated' }]; rev += 1; };
  const foreignDuringEdge = (to: string) => { foreignDuringEdgeTo = to; };
  return { d, read: () => ({ nodes, edges }), refusedStale, writes, allowAll, foreignEdit, foreignDuringEdge };
}

const ASK = {
  label: 'Hire a contractor',
  acts_on: [
    { factor_label: 'Developer headcount', direction: 'positive' as const },
    { factor_label: 'Lead time', direction: 'negative' as const },
  ],
  rationale: 'a faster route to capacity',
};

describe('adding an option the user picked', () => {
  it('⭐ the option and BOTH links land — the hash re-read is what makes this pass', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    expect(prop.ok, JSON.stringify(prop)).toBe(true);
    // Proposal only — nothing written yet.
    expect(p.read().nodes.some((n) => n.kind === 'option')).toBe(false);

    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    const { nodes, edges } = p.read();
    const opt = nodes.find((n) => n.kind === 'option' && n.label === 'Hire a contractor');
    expect(opt, 'the option must exist').toBeDefined();
    expect(edges.map((e) => e.to).sort()).toEqual(['dev_headcount', 'lead_time']);
    // ⛔ THE DISCRIMINATOR: no write was ever refused for a stale base.
    expect(p.refusedStale).toEqual([]);
  });

  it('⭐ the STATED direction reaches the wire, per link — not one default for both', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    const byTo = Object.fromEntries(p.read().edges.map((e) => [e.to, e.effect_direction]));
    expect(byTo).toEqual({ dev_headcount: 'positive', lead_time: 'negative' });
  });

  it('⛔ the result says it CANNOT be compared yet — a receipt, not a reassurance', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(String(applied.follow_up)).toContain('cannot be compared yet');
    expect(applied.option).toEqual({ label: 'Hire a contractor', linked_to: ['Developer headcount', 'Lead time'] });
  });

  it('⛔ CONTROL: if the node write does not land, NO edges are attempted', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    // Make the node write refuse by moving the graph under the proposal.
    await p.d('/orchestrate/v2/turn', { kind: 'system_event', event: { kind: 'structural_add', node_id: 'x', node_kind: 'factor', label: 'X', base_graph_hash: 'h0' } });
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.ok).toBe(false);
    // ⛔ THE INVARIANT: a refused start writes NO edges. An option linked to some
    // of what was approved is not what the user agreed to.
    expect(p.read().edges).toEqual([]);
    expect(p.read().nodes.some((n) => n.kind === 'option')).toBe(false);
  });
});


/**
 * ⛔ CODEX'S DISCRIMINATING CONTROL, verbatim from the finding at `5c908d1a`:
 * "approve an option plus two factor links, read back node/edges and version
 * receipts, then retry the same proposal and require already_applied with identical
 * receipts and no second write. Conversely, a genuinely stale unapproved proposal
 * must remain superseded. Refuse one edge after the node lands and require an
 * explicit partial outcome naming that edge, never an unqualified Saved."
 */
describe('an approved add is complete, replayable and honest about a partial', () => {
  it('⭐ RETRY returns already_applied with IDENTICAL receipts and writes nothing more', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    const first = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(first.applied).toBe(true);
    const receiptsFirst = first.receipts as unknown[];
    /**
     * ⛔ THE DEFECT: this was a single OBJECT from `receiptSummaryOf`, while
     * `write-outcome.ts:48-50` consumes only an ARRAY — so `:153-157` said
     * "Saved. No version number was recorded" even when the write minted one.
     *
     * ⚠ SCOPE OF THIS ASSERTION, stated rather than implied: it pins the SHAPE and
     * that the same array replays. It does NOT pin a receipt COUNT — the local fake
     * does not mint a schema-valid `model_version_mutation_receipt.v1` (strict: uuids,
     * sha256, verbatim graph, six version fields), so a count here would be vacuous.
     * The real collection path is already covered by the edge route's own specs.
     */
    expect(Array.isArray(receiptsFirst)).toBe(true);
    const writesAfterFirst = [...p.writes];

    const retry = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    // Before the fix this returned `superseded` — the add moves the hash, and
    // `ProposalStore.authorise` checks the applied map BEFORE the base hash.
    expect(String(retry.refusal ?? '')).not.toBe('superseded');
    expect(retry.receipts).toEqual(receiptsFirst);
    expect(p.writes).toEqual(writesAfterFirst); // NO second write
  });

  it('⛔ a PARTIAL is never an unqualified success — it names the edge and stays unapplied', async () => {
    const p = fakeProduct('lead_time');
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    const r = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    // The status line reads `failures`; without it a partial could say "Saved".
    expect(r.failures).toBeDefined();
    expect(String(JSON.stringify(r.failures))).toContain('Lead time');
    expect(String(r.detail)).toContain('will not add the option twice');
  });

  it('⭐ CONTINUATION after a partial adds ONLY the missing link — never a second node', async () => {
    const p = fakeProduct('lead_time');
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    const nodesAfterPartial = p.read().nodes.filter((n) => n.kind === 'option').length;
    expect(nodesAfterPartial).toBe(1);
    const addWrites = p.writes.filter((w) => w === 'structural_add').length;
    // Retry: the node already exists, so `structural_add` must be SKIPPED —
    // it would refuse `node_id_collision` and strand the user.
    await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(p.read().nodes.filter((n) => n.kind === 'option').length).toBe(1);
    expect(p.writes.filter((w) => w === 'structural_add').length).toBe(addWrites);
  });
});

/**
 * ⛔ Independent review of #1788 (5806071796): after a partial, the proposal's OWN write moved the
 * hash, so a retry of that same proposal was refused `superseded` before it reached the missing
 * link — the promised continuation was unreachable, and the old spec (no second node) was satisfied
 * by a superseded no-op. These pin the OUTCOME: the missing link lands, the proposal completes with
 * every receipt, and a foreign edit still refuses.
 */
describe('a partially added option is completed by approving the SAME proposal again', () => {
  it('CONTROL: the fixture receipt is schema-valid, so receipt counts below measure something', async () => {
    const { receiptSummaryOf } = await import('../runtime/agent-capabilities.js');
    expect(receiptSummaryOf(receipt(7))).toMatchObject({ summary: { version: 7 }, unreadable: false });
  });

  const partial = async () => {
    const p = fakeProduct('lead_time');
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const prop = await caps.proposeNewOption(ctx, ASK);
    const first = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(first.ok, 'the control: the first approval really was partial').toBe(false);
    return { p, caps, id: String(prop.proposal_id), first };
  };

  it('RED: the retry LANDS the missing link, completes the proposal, and every receipt is kept — no second node, no duplicate link', async () => {
    const { p, caps, id, first } = await partial();
    p.allowAll();
    const retry = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(retry, JSON.stringify(retry).slice(0, 300)).toMatchObject({ ok: true, applied: true });
    const { nodes, edges } = p.read();
    expect(nodes.filter((n) => n.kind === 'option')).toHaveLength(1);
    const optionId = nodes.find((n) => n.kind === 'option')!.id;
    expect(edges.filter((e) => e.from === optionId).map((e) => e.to).sort()).toEqual(['dev_headcount', 'lead_time']);
    expect(p.writes.filter((w) => w === 'structural_add')).toHaveLength(1);
    expect(p.writes.filter((w) => w === 'structural_add_edge')).toHaveLength(2);
    const firstVersions = (first.receipts as { version: number }[]).map((r) => r.version);
    const allVersions = (retry.receipts as { version: number }[]).map((r) => r.version);
    expect(allVersions.slice(0, firstVersions.length), 'the original receipts carry over').toEqual(firstVersions);
    expect(allVersions).toHaveLength(3); // node + two links
    const again = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(again, 'now complete: it replays').toMatchObject({ ok: true, already_applied: true });
    expect((again.receipts as { version: number }[]).map((r) => r.version)).toEqual(allVersions);
    expect(p.writes).toHaveLength(3);
  });

  it('CONTRAST: someone else changed the model after the partial → still superseded, nothing written', async () => {
    const { p, caps, id } = await partial();
    p.allowAll();
    p.foreignEdit();
    const writes = p.writes.length;
    const retry = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(retry).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(p.writes).toHaveLength(writes);
  });

  it('CONTRAST: a fully completed proposal replays with its identical receipts and writes nothing', async () => {
    const p = fakeProduct(null);
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    const done = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(done).toMatchObject({ ok: true, applied: true });
    const writes = p.writes.length;
    const again = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(again).toMatchObject({ ok: true, already_applied: true });
    expect(again.receipts).toEqual(done.receipts);
    expect(p.writes).toHaveLength(writes);
  });

  it('the authoritative status line names what landed and what remains — never "unknown reason"', async () => {
    const { first } = await partial();
    const { narrateWriteOutcome } = await import('../write-outcome.js');
    const status = narrateWriteOutcome('', [{ name: 'authorise_change' }], [first]).status ?? '';
    expect(status).toMatch(/^Partly saved/);
    expect(status).toContain('"Hire a contractor" was added and linked to Developer headcount');
    expect(status).toContain('not yet linked to Lead time');
    expect(status).toContain('will try only the missing link');
    expect(status).not.toMatch(/unknown reason/);
  });
  /**
   * ⛔ Independent review of #1788 (5807353449): a foreign edit DURING the continuation made the
   * missing link's CAS refuse; the route then read the foreign revision and recorded it as this
   * proposal's own progress, so the NEXT approval would apply the link to a model the user never
   * approved. Progress may only ever sit at a revision this proposal's own confirmed write produced.
   */
  it('RED: a foreign edit DURING the retry → the missing link refuses, and a further approval writes nothing and reports superseded', async () => {
    const { p, caps, id } = await partial();
    p.allowAll();
    p.foreignDuringEdge('lead_time'); // someone else edits at the moment the missing link is written
    const retry = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(retry.ok, 'the missing link could not land on a moved model').toBe(false);
    const writes = p.writes.length;
    const again = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(again, 'never continue on a revision this proposal did not write').toMatchObject({ ok: false, refusal: 'superseded' });
    expect(p.writes, 'nothing written on the foreign-edited model').toHaveLength(writes);
  });

  it('the partial status line never promises the retry WILL add the link', async () => {
    const { first } = await partial();
    const { narrateWriteOutcome } = await import('../write-outcome.js');
    const status = narrateWriteOutcome('', [{ name: 'authorise_change' }], [first]).status ?? '';
    expect(status).not.toMatch(/adds only the missing link/);
    expect(status).toMatch(/if the model has changed since, you will be asked to confirm again/);
  });
});
