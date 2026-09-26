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
import { bandTheUserWrote, userWordsOf } from '../stated-by-user.js';
import { readFileSync } from 'node:fs';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440077';
// The user's own words, verbatim from served (F) row F8 — the band is recorded as theirs only when they named it.
const F8 = 'I am confident about one link: Pro plan price \u2192 MRR. Its effect is strong. Please record that link as strong, as my own estimate.';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: F8, user_turn_text: F8 };
const WEAK = 'Price barely affects MRR, and it pushes the other way.';
const ctxWeak = { ...ctx, user_text: WEAK, user_turn_text: WEAK };

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
    const p = await caps.proposeLinkStrength!(ctxWeak, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'weak', direction: 'positive', rationale: 'x' });
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

  it('the write answers 200 but the model cannot be read back → "could not confirm", never "as it was"', async () => {
    const w = world(graphWith(0.5));
    let reads = 0;
    const blind: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) { reads += 1; return reads <= 2 ? w.d(path, body) : { status: 503, json: {} }; }
      return w.d(path, body);
    };
    const caps = createAgentCapabilities(blind, new ProposalStore());
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'x' });
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'not_confirmed' }));
    expect(String(r.detail)).toMatch(/could not be confirmed/);
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
    const other = await caps.proposeLinkStrength!(ctxWeak, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'weak', rationale: 'y' });
    await caps.authoriseChange(ctx, { proposal_id: String(other.proposal_id) });
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'superseded' }));
    expect(w.sent).toHaveLength(1);
  });
});

describe('a link-strength proposal is approvable like every other: one button, carried across a restart (review of #1950)', () => {
  it('RED: approve chip + awaiting flag + a persisted carrier that restores, and the restored proposal applies the same event', async () => {
    const { approvalChipsFor, proposalsAwaitingApproval } = await import('../approval-chips.js');
    const { proposalPendingAction, rehydrateProposals } = await import('../durable-proposal.js');
    const { parsePendingAction } = await import('../../session/pending-action.js');
    const { leavesProposalAwaitingApproval } = await import('../../../routes/agent-v1-turn.js');
    const w = world(graphWith(0.5));
    const store = new ProposalStore();
    const caps = createAgentCapabilities(w.d, store);
    const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'x' });
    const calls = [{ name: 'propose_link_strength', ok: true, mutated: false, proposal_id: String(p.proposal_id) }];
    const chips = approvalChipsFor(calls);
    expect(chips.map((c) => c.id), 'ONE approve button, plus amend').toEqual([`agent-approve-proposal:${String(p.proposal_id)}`, 'agent-amend-proposal']);
    expect(proposalsAwaitingApproval(calls).size).toBe(1);
    expect(leavesProposalAwaitingApproval(calls), 'the reply keeps the approval question in view').toBe(true);
    // The carrier the answer row persists, through the REAL parser, restores into a fresh process's store…
    const stored = store.get(String(p.proposal_id))!;
    const pa = parsePendingAction(JSON.parse(JSON.stringify(proposalPendingAction(stored, chips[0]!, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() }))));
    expect(pa, 'the production read would drop it').not.toBeNull();
    const fresh = new ProposalStore();
    expect(rehydrateProposals([pa!], fresh, { scenario_id: SCENARIO, user_id: null })).toBe(1);
    // …and the restored proposal applies exactly the approved event.
    const r = await createAgentCapabilities(w.d, fresh).authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ kind: 'edge_strength_edit', intent: 'set', magnitude: 0.825, expected: { mean: 0.5, effect_direction: 'positive' } }));
  });
});

describe('⛔ a band is recorded as the user\'s only when the user named it (AI Quality on #1978, 5844682410)', () => {
  it('RED: the Agent passes "strong" and the user said only "Yes." → refused, nothing prepared, nothing sent', async () => {
    const w = world(graphWith(0.5));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!({ ...ctx, user_text: 'Yes.', user_turn_text: 'Yes.' }, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'x' });
    expect(p).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'strength_not_stated' }));
    expect(String(p.detail)).toMatch(/Ask them how strong they think it is/);
    expect(p).not.toHaveProperty('proposal_id');
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('RED: no words bound at all → refused (no text proves nothing)', async () => {
    const w = world(graphWith(0.5));
    const { user_text: _omit, user_turn_text: _omit2, ...bare } = ctx;
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeLinkStrength!(bare, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'x' });
    expect(p.refusal).toBe('strength_not_stated');
  });

  it('RED (#1984 review B1): a band word in the BRIEF or an earlier turn, then "Yes." → refused (only this turn\'s words name a band)', async () => {
    for (const brief of ['We are a B2B SaaS with strong retention and a moderate marketing budget.', 'Demand is weak this quarter.', F8]) {
      for (const band of ['strong', 'weak', 'moderate'] as const) {
        const w = world(graphWith(0.5));
        // Exactly as the route binds them: the whole typed conversation, and this turn's own typed message.
        const turnCtx = { ...ctx, user_text: userWordsOf([brief], 'Yes.'), user_turn_text: 'Yes.' };
        const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeLinkStrength!(turnCtx, { from_label: 'Pro plan price', to_label: 'MRR', strength: band, rationale: 'x' });
        expect(p.refusal, `${band} after "${brief}"`).toBe('strength_not_stated');
        expect(w.sent).toEqual([]);
      }
    }
  });

  it('the route binds this turn\'s typed message as user_turn_text (a chip click binds nothing)', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain("user_turn_text: typedNow ?? '', user_text: userWordsOf(histories.typedWords(sessionId), typedNow) };");
  });

  it('RED (#1984 review B2): a denial anywhere earlier in the clause, or a question, names no band', () => {
    for (const text of [
      'Price doesn\'t have a strong effect on churn.',
      'It is not as strong as you think.',
      'Price isn\'t a strong driver of churn.',
      'Is it strong or weak?',
      'I would never call that link strong.',
    ]) {
      expect(bandTheUserWrote('strong', text), text).toBe(false);
    }
    expect(bandTheUserWrote('weak', 'Is it strong or weak?')).toBe(false);
    // Contrasts: an affirmation after a denial of something else, and after "No," as an answer.
    expect(bandTheUserWrote('strong', 'That is not a guess, it is strong.')).toBe(true);
    expect(bandTheUserWrote('strong', 'No, it is strong.')).toBe(true);
    expect(bandTheUserWrote('strong', 'Price strongly affects churn.')).toBe(true);
  });

  it('band-exact on the served wording and its near misses', () => {
    // Named: served F8, the prompt's own examples.
    expect(bandTheUserWrote('strong', F8)).toBe(true);
    expect(bandTheUserWrote('strong', 'that effect is strong')).toBe(true);
    expect(bandTheUserWrote('weak', 'price barely affects churn')).toBe(true);
    expect(bandTheUserWrote('moderate', 'It is moderately strong? No — moderate.')).toBe(true);
    expect(bandTheUserWrote('very strong', 'It has a very strong effect.')).toBe(true);
    // Not named: another band, a comparative, a served hypothetical, a negation, and "very strong" for "strong".
    expect(bandTheUserWrote('weak', F8)).toBe(false);
    expect(bandTheUserWrote('strong', 'Talk me through what would change if the link from Pro plan price to MRR were weaker or stronger.')).toBe(false);
    expect(bandTheUserWrote('weak', 'Talk me through what would change if the link from Pro plan price to MRR were weaker or stronger.')).toBe(false);
    expect(bandTheUserWrote('strong', 'It is not strong.')).toBe(false);
    expect(bandTheUserWrote('strong', 'It isn\u2019t very strong.')).toBe(false);
    expect(bandTheUserWrote('very strong', 'It isn\'t very strong.')).toBe(false);
    expect(bandTheUserWrote('strong', 'It has a very strong effect.')).toBe(false);
    expect(bandTheUserWrote('strong', null)).toBe(false);
  });
});
