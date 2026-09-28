/**
 * ⛔ A LINK'S DIRECTION IS REVERSED ONLY IN THE USER'S OWN WORDS (DL #72 5863691992; Runtime claim 5863711801; the
 * capability half banked by Model Generation, 5863728619).
 *
 * Served `137d3a5` (DL run `pj-20260928T044420Z`, A16): the user wrote "Get on and update it to very strong. And the
 * potential churn increase". The risk "Competitors undercut price or discount AI features" → MRR LOWERED MRR
 * (−0.5, Olumi's estimate). The Agent sent `direction: 'positive'`, and `propose_link_strength` prepared the link
 * "pushing up". The band was grounded in the user's words; the direction was taken from the model unchecked. The
 * reply then said "do not approve that proposal" while still offering its approve chip. The harness approved it,
 * and the final Run reported the reversal as a modelling error.
 *
 * The rule under test: a direction other than the link's own is prepared ONLY with the user's phrase for it in
 * THIS message (`direction_from_words`, checked by the one matcher `wordsTheUserWrote`). The preview then says
 * plainly that it REVERSES the link. Otherwise nothing is prepared, and the refusal names the next call: the same
 * arguments without `direction`.
 */
import { describe, it, expect } from 'vitest';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c6';
const RISK = 'Competitors undercut price or discount AI features';
/** The user's words at the served A16, verbatim. */
const A16 = 'Get on and update it to very strong. And the potential churn increase';
const said = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text });

type Edge = { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number; effect_direction: 'positive' | 'negative'; provenance?: { source: string }; defaulted?: boolean };

/** The served A16 link: the risk LOWERS MRR, at Olumi's −0.5 estimate. */
function world() {
  let edges: Edge[] = [{
    from: 'risk_competitors', to: 'mrr', strength: { mean: -0.5, std: 0.125 }, exists_probability: 1,
    effect_direction: 'negative', provenance: { source: 'cee_hypothesis' }, defaulted: true,
  }];
  const nodes = [
    { id: 'dec', kind: 'decision', label: 'Price decision' },
    { id: 'risk_competitors', kind: 'risk', label: RISK },
    { id: 'mrr', kind: 'goal', label: 'MRR' },
  ];
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    if (ev['kind'] === 'edge_strength_edit') {
      // The link writer as its contract states it: ±magnitude in the direction asked for (or kept), stamped the user's.
      const e = edges[0]!;
      const dir = ev['direction_intent'] === 'preserve' ? e.effect_direction : ev['direction_intent'] as 'positive' | 'negative';
      const mag = Number(ev['magnitude']);
      edges = [{ ...e, strength: { ...e.strength, mean: dir === 'negative' ? -mag : mag }, effect_direction: dir, provenance: { source: 'user_specified' }, defaulted: false }];
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.', graph_hash: `h${rev}` } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  return { caps: createAgentCapabilities(d, proposals), proposals, sent, edge: () => edges[0]! };
}

const parsesOnTheWire = (body: Record<string, unknown>) => {
  const r = OrchestratorTurnPayloadSchema.safeParse(body);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
};

describe('⛔ propose_link_strength reverses a link only in the user\'s own words', () => {
  it('⭐ RED (served A16): "update it to very strong" + direction "positive" on a link that LOWERS MRR → refused, nothing prepared, the next call named', async () => {
    const w = world();
    const p = await w.caps.proposeLinkStrength!(said(A16), {
      from_label: RISK, to_label: 'MRR', strength: 'very strong', direction: 'positive', rationale: A16,
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'direction_not_stated' }));
    expect(p).not.toHaveProperty('proposal_id');
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
    expect(String(p.detail)).toContain('leave out "direction"');
    expect(w.sent).toEqual([]);
  });

  it('RED: reversal words the user did NOT write this turn are refused, however apt', async () => {
    const w = world();
    const p = await w.caps.proposeLinkStrength!(said(A16), {
      from_label: RISK, to_label: 'MRR', strength: 'very strong', direction: 'positive',
      direction_from_words: 'it actually raises MRR', rationale: A16,
    });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'direction_not_stated' }));
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
  });

  it('⭐ RED: a reversal the user DID state is prepared, the preview says it REVERSES the link, and approval writes it that way', async () => {
    const w = world();
    const turn = 'I think we have it backwards: competitors undercutting us actually pushes MRR up, and the effect is very strong.';
    const p = await w.caps.proposeLinkStrength!(said(turn), {
      from_label: RISK, to_label: 'MRR', strength: 'very strong', direction: 'positive',
      direction_from_words: 'actually pushes MRR up', rationale: turn,
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(String(p.public_label)).toContain('REVERSE its direction so that it raises');
    const r = await w.caps.authoriseChange(said('Yes, record that.'), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true }));
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ kind: 'edge_strength_edit', intent: 'set', direction_intent: 'positive', magnitude: 0.85 }));
  });

  it('CONTROL (the refusal\'s next call): the same A16 turn with NO direction → the strength alone, and the link keeps LOWERING MRR', async () => {
    const w = world();
    const p = await w.caps.proposeLinkStrength!(said(A16), { from_label: RISK, to_label: 'MRR', strength: 'very strong', rationale: A16 });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(String(p.public_label)).not.toMatch(/REVERSE|pushing up/);
    await w.caps.authoriseChange(said('Yes, record that.'), { proposal_id: String(p.proposal_id) });
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ intent: 'set', direction_intent: 'preserve', magnitude: 0.85, expected: { mean: -0.5, effect_direction: 'negative' } }));
    expect([w.edge().strength.mean, w.edge().effect_direction]).toEqual([-0.85, 'negative']);
  });

  it('CONTROL: naming the link\'s OWN direction is not a reversal and needs no words for it', async () => {
    const w = world();
    const p = await w.caps.proposeLinkStrength!(said(A16), {
      from_label: RISK, to_label: 'MRR', strength: 'very strong', direction: 'negative', rationale: A16,
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
  });
});
