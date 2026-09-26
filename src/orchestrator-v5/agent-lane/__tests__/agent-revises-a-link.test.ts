/**
 * ⭐ CHALLENGE → AUTHORISED REVISION: the user says how strong a link is, and it is recorded AS THEIRS.
 *
 * Served (F) on CEE `319dde1` (run f-20260926T013304Z, row F8): asked "Its effect is strong. Please record that
 * link as strong, as my own estimate", the Agent answered "I could not record 'strong' separately". It had no
 * way to reach the product's own link-strength writer (`edge_strength_edit`, the inspector's canonical D1 edge
 * writer with its expected-before tuple).
 *
 * `propose_link_strength` prepares ONE change the user approves once, and the approval sends exactly that typed
 * event. Nothing numeric is invented silently:
 * - the user's word names a band on the product's own thresholds (`INFLUENCE_BAND_THRESHOLDS`);
 * - when the link already sits in that band, its strength is KEPT and only recorded as the user's
 *   (`confirm_current`);
 * - otherwise it is set to that band's midpoint, and the preview says so before the user approves.
 *
 * Every event the Agent sends is parsed by the REAL boundary schema (`OrchestratorTurnPayloadSchema`), so the wire
 * shape — including the cross-field rules a `confirm_current` must meet — is the contract's, not this test's.
 */
import { describe, it, expect } from 'vitest';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440077';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r' };

type Edge = { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number; effect_direction: 'positive' | 'negative'; provenance?: { source: string }; defaulted?: boolean };
const graphWith = (mean: number, dir: 'positive' | 'negative' = 'positive') => ({
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Price decision' },
    { id: 'price', kind: 'factor', label: 'Pro plan price' },
    { id: 'mrr', kind: 'goal', label: 'MRR' },
  ],
  edges: [{ from: 'price', to: 'mrr', strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: dir, provenance: { source: 'cee_hypothesis' }, defaulted: true } as Edge],
});

/**
 * A recording dispatch over one stored graph. The link-strength writer is modelled only as far as its contract
 * states it: it sets the edge to ±magnitude (or keeps it, on confirm), stamps it the user's, and answers 200.
 */
function world(initial: ReturnType<typeof graphWith>) {
  let g = JSON.parse(JSON.stringify(initial)) as ReturnType<typeof graphWith>;
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    if (ev['kind'] === 'edge_strength_edit') {
      const e = g.edges.find((x) => x.from === ev['from'] && x.to === ev['to'])!;
      const dir = ev['direction_intent'] === 'preserve' ? e.effect_direction : ev['direction_intent'] as 'positive' | 'negative';
      const mag = Number(ev['magnitude']);
      g = { ...g, edges: g.edges.map((x) => (x === e ? { ...x, strength: { ...x.strength, mean: dir === 'negative' ? -mag : mag }, effect_direction: dir, provenance: { source: 'user_specified' }, defaulted: false } : x)) };
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.', graph_hash: `h${rev}` } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { d, sent, graph: () => g };
}

const parsesOnTheWire = (body: Record<string, unknown>) => {
  const r = OrchestratorTurnPayloadSchema.safeParse(body);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
};

describe('the Agent records a link\'s strength as the user\'s own, through the product\'s typed link writer', () => {
  it('RED: "strong" on a link Olumi assumed at 0.5 → ONE proposal (nothing written) → approve → set to the strong band\'s midpoint, recorded as the user\'s', async () => {
    const w = world(graphWith(0.5));
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'The user said so.' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(w.sent, 'a proposal writes nothing').toEqual([]);
    expect(String(p.public_label)).toMatch(/Pro plan price.*MRR.*strong/i);
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(w.sent).toHaveLength(1);
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual({ kind: 'edge_strength_edit', from: 'price', to: 'mrr', intent: 'set', direction_intent: 'preserve', magnitude: 0.825, expected: { mean: 0.5, effect_direction: 'positive' } });
    const e = w.graph().edges[0]!;
    expect(e.strength.mean).toBeCloseTo(0.825, 9);
    expect(e.provenance?.source).toBe('user_specified');
  });

  it('RED: the link already sits in the band the user named → its strength is KEPT and only recorded as theirs (confirm_current)', async () => {
    const w = world(graphWith(0.8));
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'x' });
    await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ intent: 'confirm_current', direction_intent: 'preserve', magnitude: 0.8 }));
    expect(w.graph().edges[0]!.strength.mean).toBe(0.8);
  });

  it('a stated reversal of direction is carried as the user said it; a negative link keeps its sign on the wire', async () => {
    const w = world(graphWith(-0.4, 'negative'));
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'weak', direction: 'positive', rationale: 'x' });
    await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ intent: 'set', direction_intent: 'positive', magnitude: 0.15, expected: { mean: -0.4, effect_direction: 'negative' } }));
  });

  it('the writer answers 200 but records nothing (its own refusal) → NOT reported as recorded', async () => {
    const w = world(graphWith(0.5));
    const refusing: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return w.d(path, body);
      w.sent.push(body as Record<string, unknown>);
      return { status: 200, json: { assistant_text: "I couldn't save that change, so I haven't changed anything.", graph_hash: 'h1' } };
    };
    const caps = createAgentCapabilities(refusing, new ProposalStore());
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'x' });
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'not_applied' }));
    expect(String(r.detail)).toMatch(/haven't changed anything/);
  });

  it('refuses, writing nothing, a link the model does not have — and says how to add it instead', async () => {
    const w = world(graphWith(0.5));
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'MRR', to_label: 'Pro plan price', strength: 'strong', rationale: 'x' });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'no_such_link' }));
    expect(String(p.detail)).toMatch(/propose_model_change/);
    expect(w.sent).toEqual([]);
  });

  it('an approval is never applied onto a model that moved since the offer (superseded, nothing written)', async () => {
    const w = world(graphWith(0.5));
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'x' });
    // Another writer moves the model.
    const other = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'weak', rationale: 'y' });
    await caps.authoriseChange(ctx, { proposal_id: String(other.proposal_id) });
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'superseded' }));
    expect(w.sent).toHaveLength(1);
  });
});
