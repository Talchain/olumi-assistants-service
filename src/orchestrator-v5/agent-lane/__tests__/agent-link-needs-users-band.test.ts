/**
 * ⛔ A NEW LINK IS PROPOSED ONLY WITH THE BAND THE USER TYPED THIS TURN.
 *
 * RULING (Delivery Lead #70 5845493088, agreed by Canonical 5845487856): "The Agent proposes a link only with the band
 * the user typed THIS turn (bandTheUserWrote, the midpoint mapping). With no band it asks 'how strong…?'. The
 * user_specified stamp is then TRUE."
 *
 * Before (code-read at fd26a3ea): `propose_model_change` took only a direction; an approval sent `structural_add_edge`
 * with a FIXED magnitude 0.5, and the link writer (`structural-add-edge.ts`) stamps every link it adds
 * `provenance.source: 'user_specified'` — so Olumi's 0.5 placeholder was stored as the user's own estimate.
 *
 * Now the proposer takes `strength` and refuses (`strength_not_stated`, nothing prepared) unless that band is named in
 * THIS turn's typed words by the one matcher (`bandTheUserWrote`), and the approval sends that band's midpoint. A
 * proposal restored from the durable carrier that predates this (no magnitude) keeps the 0.5 and its disclosure.
 *
 * Every event the Agent sends is parsed by the REAL boundary schema (`OrchestratorTurnPayloadSchema`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';
import { ProposalStore, createProposal } from '../proposal.js';
import { userWordsOf } from '../stated-by-user.js';
import { disclosuresFor, PLACEHOLDER_STRENGTH_DISCLOSURE } from '../disclosure.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440088';
const said = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text });
const LINK = { from_label: 'Pro plan price', to_label: 'Monthly churn', direction: 'positive' as const, rationale: 'The user said so.' };

type Edge = { from: string; to: string; strength: { mean: number; std: number }; effect_direction: 'positive' | 'negative'; provenance: { source: string } };

/** One stored graph with no link yet; the link writer is modelled only as far as its contract states it. */
function world() {
  let edges: Edge[] = [];
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) {
      return { status: 200, json: { graph: { nodes: [
        { id: 'dec', kind: 'decision', label: 'Price decision' },
        { id: 'price', kind: 'factor', label: 'Pro plan price' },
        { id: 'churn', kind: 'factor', label: 'Monthly churn' },
      ], edges }, graph_hash: `h${edges.length}` } };
    }
    sent.push(body as Record<string, unknown>);
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    if (ev['kind'] === 'structural_add_edge') {
      const mag = Number(ev['magnitude']);
      const dir = ev['effect_direction'] as 'positive' | 'negative';
      // `signedMeanFor` + the edge-level origin stamp, exactly as `structural-add-edge.ts` writes them.
      edges = [...edges, { from: String(ev['from']), to: String(ev['to']), strength: { mean: dir === 'negative' ? -mag : mag, std: 0.1 }, effect_direction: dir, provenance: { source: 'user_specified' } }];
      return { status: 200, json: { assistant_text: 'Connected.', graph_hash: `h${edges.length}` } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { d, sent, edges: () => edges };
}

const parsesOnTheWire = (body: Record<string, unknown>) => {
  const r = OrchestratorTurnPayloadSchema.safeParse(body);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
};

describe('⛔ propose_model_change records a link\'s strength only as the band the user typed THIS turn (#70 5845493088)', () => {
  it('RED (a): "Price affects churn." then strength "strong" → strength_not_stated, nothing prepared, nothing sent', async () => {
    const w = world();
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeModelChange(said('Price affects churn.'), { ...LINK, strength: 'strong' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'strength_not_stated' }));
    expect(String(p.detail)).toContain('how strong is that effect: weak, moderate, strong or very strong?');
    expect(String(p.detail)).toMatch(/never offer a band as theirs/);
    expect(p).not.toHaveProperty('proposal_id');
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('RED (a): no strength at all, or a word that is not a band, → the same refusal; nothing prepared', async () => {
    for (const strength of [undefined, 'huge', '']) {
      const w = world();
      const store = new ProposalStore();
      const p = await createAgentCapabilities(w.d, store).proposeModelChange(said('Price strongly raises churn.'), { ...LINK, ...(strength === undefined ? {} : { strength }) } as never);
      expect(p.refusal, String(strength)).toBe('strength_not_stated');
      expect(store.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.sent).toEqual([]);
    }
  });

  it('RED (a): the SAME rules as propose_link_strength — a denied or asked band, or "very strong" for "strong", grounds nothing', async () => {
    for (const [text, band] of [
      ['Price doesn\'t strongly affect churn.', 'strong'],
      ['Is the price effect on churn strong?', 'strong'],
      ['Price has a very strong effect on churn.', 'strong'],
      ['Price strongly raises churn.', 'weak'],
    ] as const) {
      const w = world();
      const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeModelChange(said(text), { ...LINK, strength: band });
      expect(p.refusal, `${band} after "${text}"`).toBe('strength_not_stated');
      expect(w.sent).toEqual([]);
    }
  });

  it('RED (b): "Price strongly raises churn." + strong → approve → structural_add_edge carries strong\'s midpoint (0.825, not 0.5), no placeholder', async () => {
    const w = world();
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const ctx = said('Price strongly raises churn.');
    const p = await caps.proposeModelChange(ctx, { ...LINK, strength: 'strong' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(w.sent, 'a proposal writes nothing').toEqual([]);
    expect(String(p.public_label)).toBe('Connect "Pro plan price" to "Monthly churn" (positive) as strong, your own estimate');
    expect(String(p.note)).toMatch(/strong, which Olumi stores as 0\.825 on its 0–1 strength scale, as their own estimate/);
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(w.sent).toHaveLength(1);
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ kind: 'structural_add_edge', from: 'price', to: 'churn', magnitude: 0.825, effect_direction: 'positive' }));
    expect(r).not.toHaveProperty('placeholder_strength');
    expect(r).not.toHaveProperty('not_represented');
    expect(disclosuresFor([r]), 'no placeholder disclosure: the strength is the user\'s').toEqual([]);
    expect(w.edges()).toEqual([expect.objectContaining({ from: 'price', to: 'churn', strength: { mean: 0.825, std: 0.1 }, provenance: { source: 'user_specified' } })]);
  });

  it('(b) every band maps to its own midpoint on the product thresholds; a negative link keeps its sign on the wire', async () => {
    for (const [text, band, mid, direction] of [
      ['Price barely affects churn.', 'weak', 0.15, 'negative'],
      ['It is a moderate effect.', 'moderate', 0.5, 'positive'],
      ['Price strongly raises churn.', 'strong', 0.825, 'negative'],
      ['Price has a very strong effect on churn.', 'very strong', 0.975, 'positive'],
    ] as const) {
      const w = world();
      const caps = createAgentCapabilities(w.d, new ProposalStore());
      const p = await caps.proposeModelChange(said(text), { ...LINK, direction, strength: band });
      expect(p.ok, `${band}: ${JSON.stringify(p)}`).toBe(true);
      const r = await caps.authoriseChange(said('Yes.'), { proposal_id: String(p.proposal_id) });
      parsesOnTheWire(w.sent[0]!);
      expect(w.sent[0]!['event'], band).toEqual(expect.objectContaining({ magnitude: mid, effect_direction: direction }));
      // "moderate" is 0.5 too: the placeholder flag, not the number, is what says whose figure it is.
      expect(r, band).not.toHaveProperty('placeholder_strength');
      expect(w.edges()[0]!.strength.mean).toBe(direction === 'negative' ? -mid : mid);
    }
  });

  it('RED (c): a band typed only in an EARLIER turn, with nothing typed this turn (or only "Yes, add it."), is refused', async () => {
    for (const now of ['', 'Yes, add it.']) {
      const w = world();
      const store = new ProposalStore();
      // Exactly as the route binds them: the whole typed conversation, and this turn's own typed message.
      const ctx = { ...said(now), user_text: userWordsOf(['Price strongly raises churn.'], now === '' ? null : now), user_turn_text: now };
      const p = await createAgentCapabilities(w.d, store).proposeModelChange(ctx, { ...LINK, strength: 'strong' });
      expect(p.refusal, JSON.stringify(now)).toBe('strength_not_stated');
      expect(store.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.sent).toEqual([]);
    }
  });

  it('a link that cannot be added is refused for THAT reason first — the user is never asked how strong a link that will not be proposed is', async () => {
    const w = world();
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeModelChange(said('Price affects churn.'), { ...LINK, to_label: 'Nowhere' });
    expect(p.refusal).toBe('unresolved_entity');
  });
});

/**
 * ⛔ ROUND-2 REVIEW of a2a46135 (CHANGES_REQUIRED): reproduced end to end — "Connect price to churn, you decide how
 * strong." with the Agent passing strong prepared the link, sent magnitude 0.825 and stored it stamped user_specified,
 * with no disclosure; "Moderate or strong, you pick." grounded either band. A band that follows "how"/"whether", sits
 * among alternatives, or is in a turn that hands the choice to Olumi names nothing, so the Agent asks. The fix is in the
 * shared matcher (`bandTheUserWrote`), which propose_link_strength uses too (agent-revises-a-link.test.ts).
 */
describe('⛔ round-2 review: a band the user leaves to Olumi, asks about, or offers among alternatives is never theirs', () => {
  async function attempt(text: string, band: 'weak' | 'moderate' | 'strong' | 'very strong') {
    const w = world();
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeModelChange(said(text), { ...LINK, strength: band });
    return { refusal: p.refusal ?? null, prepared: store.outstanding(SCENARIO, null).length, sent: w.sent.length };
  }
  const refused = { refusal: 'strength_not_stated', prepared: 0, sent: 0 };

  it('RED: the reviewer\'s two probes are refused — nothing prepared, nothing sent; the reviewer\'s control still refuses', async () => {
    expect({
      'strong ← Connect price to churn, you decide how strong.': await attempt('Connect price to churn, you decide how strong.', 'strong'),
      'moderate ← Connect price to churn. Moderate or strong, you pick.': await attempt('Connect price to churn. Moderate or strong, you pick.', 'moderate'),
      'strong ← Connect price to churn. Moderate or strong, you pick.': await attempt('Connect price to churn. Moderate or strong, you pick.', 'strong'),
      'strong ← Connect price to churn.': await attempt('Connect price to churn.', 'strong'),
    }).toEqual({
      'strong ← Connect price to churn, you decide how strong.': refused,
      'moderate ← Connect price to churn. Moderate or strong, you pick.': refused,
      'strong ← Connect price to churn. Moderate or strong, you pick.': refused,
      'strong ← Connect price to churn.': refused,
    });
  });

  it('RED (i): a band after "how" or "whether" is asked about, not named', async () => {
    const rows = [
      ['I wonder how strongly price raises churn.', 'strong'],
      ['Tell me whether price strongly raises churn.', 'strong'],
    ] as const;
    const got: Record<string, unknown> = {};
    for (const [text, band] of rows) got[`${band} ← ${text}`] = await attempt(text, band);
    expect(got).toEqual(Object.fromEntries(rows.map(([text, band]) => [`${band} ← ${text}`, refused])));
  });

  it('RED (ii): band words offered as alternatives name neither', async () => {
    const rows = [
      ['Price raises churn, either weak or moderate.', 'weak'],
      ['Price raises churn, either weak or moderate.', 'moderate'],
      ['Price raises churn: strong/weak.', 'strong'],
    ] as const;
    const got: Record<string, unknown> = {};
    for (const [text, band] of rows) got[`${band} ← ${text}`] = await attempt(text, band);
    expect(got).toEqual(Object.fromEntries(rows.map(([text, band]) => [`${band} ← ${text}`, refused])));
  });

  it('RED (iii): a turn that hands the choice to Olumi names no band, wherever the band word sits', async () => {
    const rows = [
      ['Price strongly raises churn. Your call.', 'strong'],
      ['Price strongly raises churn, but up to you.', 'strong'],
      ['Price strongly raises churn, whatever you think.', 'strong'],
      ['I don\'t know how strong. Price strongly raises churn.', 'strong'],
    ] as const;
    const got: Record<string, unknown> = {};
    for (const [text, band] of rows) got[`${band} ← ${text}`] = await attempt(text, band);
    expect(got).toEqual(Object.fromEntries(rows.map(([text, band]) => [`${band} ← ${text}`, refused])));
  });

  it('RED (same class): a band set aside by "rather than" is not named', async () => {
    expect(await attempt('Price raises churn: strong rather than moderate.', 'moderate')).toEqual(refused);
  });

  it('contrasts still ground end to end: approve → strong\'s midpoint, stored as the user\'s; "strong, not moderate" never grounds moderate', async () => {
    const got: Record<string, unknown> = {};
    for (const text of ['Price strongly raises churn.', 'Make it strong.', 'Can you record it as strong?', 'It is strong, not moderate.']) {
      const w = world();
      const caps = createAgentCapabilities(w.d, new ProposalStore());
      const p = await caps.proposeModelChange(said(text), { ...LINK, strength: 'strong' });
      const r = p.ok ? await caps.authoriseChange(said('Yes.'), { proposal_id: String(p.proposal_id) }) : p;
      const ev = (w.sent[0]?.['event'] ?? {}) as Record<string, unknown>;
      got[text] = { applied: r.applied ?? false, kind: ev['kind'] ?? null, magnitude: ev['magnitude'] ?? null, placeholder: r.placeholder_strength ?? null, stored: w.edges()[0]?.provenance.source ?? null };
    }
    const grounded = { applied: true, kind: 'structural_add_edge', magnitude: 0.825, placeholder: null, stored: 'user_specified' };
    expect(got).toEqual({
      'Price strongly raises churn.': grounded,
      'Make it strong.': grounded,
      'Can you record it as strong?': grounded,
      'It is strong, not moderate.': grounded,
    });
    expect(await attempt('It is strong, not moderate.', 'moderate')).toEqual(refused);
  });
});

describe('a link proposed with the user\'s band survives a restart; one proposed before this change keeps its placeholder', () => {
  async function restored(proposal: ReturnType<typeof createProposal>) {
    const { proposalPendingAction, rehydrateProposals } = await import('../durable-proposal.js');
    const { parsePendingAction } = await import('../../session/pending-action.js');
    const chip = { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Make this change', message: 'Yes, make that change.' };
    const pa = parsePendingAction(JSON.parse(JSON.stringify(proposalPendingAction(proposal, chip, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() }))));
    expect(pa, 'the production read would drop it').not.toBeNull();
    const fresh = new ProposalStore();
    expect(rehydrateProposals([pa!], fresh, { scenario_id: SCENARIO, user_id: null })).toBe(1);
    return fresh;
  }

  it('a new proposal restored from the carrier applies the user\'s band, not the placeholder', async () => {
    const w = world();
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeModelChange(said('Price strongly raises churn.'), { ...LINK, strength: 'strong' });
    const fresh = await restored(store.get(String(p.proposal_id))!);
    const r = await createAgentCapabilities(w.d, fresh).authoriseChange(said('Yes.'), { proposal_id: String(p.proposal_id) });
    expect(r).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ kind: 'structural_add_edge', magnitude: 0.825 }));
    expect(r).not.toHaveProperty('placeholder_strength');
  });

  it('(d) a proposal restored from BEFORE this change (no magnitude) → 0.5 + placeholder_strength, and the disclosure is still owed', async () => {
    const w = world();
    // The exact pre-change shape `proposeModelChange` stored: a direction and nothing else.
    const legacy = createProposal({
      scenario_id: SCENARIO, user_id: null, base_graph_identity_hash: 'h0',
      operations: [{ op: 'add_edge', path: 'price::churn', value: { effect_direction: 'positive' } }],
      provenance: { authored_by: 'model_proposed', basis: 'x' },
      validation: { admitted: true, loss_count: 0, refusals: [] },
      public_label: 'Connect "Pro plan price" to "Monthly churn" (positive)',
    });
    const fresh = await restored(legacy);
    const r = await createAgentCapabilities(w.d, fresh).authoriseChange(said('Yes.'), { proposal_id: legacy.proposal_id });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true, placeholder_strength: true }));
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ kind: 'structural_add_edge', magnitude: 0.5, effect_direction: 'positive' }));
    expect(String(r.not_represented)).toMatch(/placeholder strength/);
    expect(disclosuresFor([r])).toEqual([PLACEHOLDER_STRENGTH_DISCLOSURE]);
  });
});

describe('the Agent is told to ask for the band when the user gave none', () => {
  it('the tool declares `strength` as the four bands, described as what the user said THIS turn', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'propose_model_change')!;
    const strength = (tool.parameters as { properties: Record<string, { enum?: string[]; description?: string }> }).properties['strength'];
    expect(strength?.enum).toEqual(['weak', 'moderate', 'strong', 'very strong']);
    expect(String(strength?.description)).toMatch(/THIS/);
    expect(tool.description).toMatch(/how strong/);
  });

  it('the route\'s instruction for propose_model_change says to ask how strong when the user named no band', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toMatch(/propose_model_change for a link \(with the strength band the user named; if they named none, ask how strong first\)/);
  });
});
