/**
 * R7 reader rows bind Price→Revenue to the review-r6 record and isolate capability words/readback.
 * The real approval-door regression lives in agent-link-set-is-one-commit.test.ts; this harness records
 * exactly the typed input and lets each readback shape exercise the capability's own sizing reader.
 */
import { describe, expect, it } from 'vitest';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { composeProposalReply } from '../proposal-reply.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440077';
const STRONG_WORDS = 'Price has a strong effect on Revenue.';
const WEAK_WORDS = 'Price has a weak effect on Revenue.';
const ctx = (words: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r7-readers',
  user_text: words, user_turn_text: words });
type Edge = { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number;
  effect_direction: 'positive'; provenance: Record<string, unknown> };
const priceRevenue = (projected = true): Edge => ({ from: 'price', to: 'revenue', strength: { mean: 0.5, std: 0.125 },
  exists_probability: 1, effect_direction: 'positive',
  provenance: { source: 'user_specified', ...(projected ? { mean_projected: true } : {}) } });
const labels = { from_label: 'Price', to_label: 'Revenue' };
const proposalArgs = (strength: 'strong' | 'weak', fromWords?: string) => ({ links: [{ ...labels, strength,
  ...(fromWords === undefined ? {} : { from_words: fromWords }) }], rationale: 'identity-bound R7 reader row' });

function world(initial = priceRevenue(), setProvenance?: Record<string, unknown>) {
  let revision = 0;
  let graph = { nodes: [{ id: 'price', kind: 'factor', label: 'Price' }, { id: 'revenue', kind: 'goal', label: 'Revenue' }],
    edges: [structuredClone(initial)] };
  const sent: Record<string, unknown>[] = [];
  const store = new ProposalStore();
  const write = (intent: unknown, magnitude: unknown, adopted = false) => {
    const before = graph.edges[0]!;
    graph = { ...graph, edges: [{ ...before,
      strength: intent === 'confirm_current' ? before.strength : { ...before.strength, mean: Number(magnitude) },
      provenance: intent === 'confirm_current' || (adopted && setProvenance === undefined)
        ? { ...before.provenance, reviewed_by_user: { intent: 'confirm', at: '2026-10-08T00:00:00.000Z' } }
        : structuredClone(setProvenance ?? { source: 'user_specified' }) }] };
    revision += 1;
  };
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: `h${revision}` } };
    const input = body as Record<string, unknown>;
    sent.push(input);
    const event = input.event as Record<string, unknown>;
    expect(event.kind).toBe('edge_strength_edit');
    expect([event.from, event.to]).toEqual(['price', 'revenue']);
    write(event.intent, event.magnitude);
    return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${revision}` } };
  };
  const caps = createAgentCapabilities(dispatch, store, undefined, 'full', undefined, {
    commitOptionLevels: async (input) => {
      sent.push(input as unknown as Record<string, unknown>);
      expect(input.link_strengths).toHaveLength(1);
      const link = input.link_strengths![0]!;
      expect([link.from, link.to]).toEqual(['price', 'revenue']);
      write(link.intent, link.magnitude, link.author === 'model_proposed');
      return { status: 'committed', graph_hash: `h${revision}`, receipt: null, already_applied: false, committed_levels: [] };
    },
  });
  return { caps, store, sent, edge: () => graph.edges[0]! };
}

describe('R7 plural link ownership words', () => {
  // Science 393023 LICENCE ruling 3, re-derived: source user_specified + mean_projected means the user drew
  // Price→Revenue but did not size it. "already strong, as the user set it" → a kept 0.5 review proposal.
  it.each([undefined, STRONG_WORDS])('R7 RED: projected Price→Revenue strong is a review, with from_words %s', async (fromWords) => {
    const w = world();
    expect(linkSizing(w.edge())).toBe('placeholder');
    expect(w.edge()).not.toHaveProperty('defaulted');
    expect(w.edge().provenance).not.toHaveProperty('magnitude');
    const p = await w.caps.proposeLinkStrengths!(ctx(fromWords ?? 'Please suggest a strength.'), proposalArgs('strong', fromWords));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p).not.toHaveProperty('already');
    expect(String(p.public_label)).not.toContain('as the user set it');
    expect(String(p.public_label)).not.toContain('as your own estimate');
    expect(String(p.public_label)).not.toContain('as strong');
    expect(w.store.get(String(p.proposal_id))!.operations).toEqual([expect.objectContaining({ path: 'price::revenue',
      value: expect.objectContaining({ magnitude: 0.5, intent: 'confirm_current', expected: expect.objectContaining({ mean: 0.5 }) }) })]);
    expect((p.links as { was: Record<string, unknown> }[])[0]!.was).toEqual({ sizing: 'placeholder' });
    expect(p.links).toEqual([expect.objectContaining({ from: 'Price', to: 'Revenue',
      whose: 'review only; nobody has sized this link', keeps_current_strength: true, sizing_after_approval: 'placeholder',
      becomes: { sizing: 'placeholder' } })]);
    const text = composeProposalReply('propose_link_strengths', { ...proposalArgs('strong', fromWords), whole_request: true }, p,
      fromWords ?? 'Please suggest a strength.');
    expect(text).not.toBeNull();
    expect(text).toContain('approving records only your review');
    expect(text).not.toMatch(/as strong|Olumi[’']s (?:first )?estimate|as your own/);
    expect(w.sent).toEqual([]);
  });

  // Science 393023 LICENCE ruling 3, re-derived: the same unsized identity proposed weak is not a user-owned
  // strong band: users_own_strength / "the user's own (strong)" → an unsized-prior change without a prior band.
  it('R7 RED: projected Price→Revenue weak is not refused as the user\'s own strong link', async () => {
    const w = world();
    const p = await w.caps.proposeLinkStrengths!(ctx('Please suggest a strength.'), proposalArgs('weak'));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p).not.toHaveProperty('refusal');
    expect(JSON.stringify(p)).not.toContain('the user’s own (strong)');
    expect(String(p.public_label)).toContain('whose strength nobody has set yet');
    expect(String(p.public_label)).not.toMatch(/as slight|Olumi[’']s (?:first )?estimate/);
    expect((p.links as { was: Record<string, unknown> }[])[0]!.was).toEqual({ sizing: 'placeholder' });
    expect(w.store.get(String(p.proposal_id))!.operations[0]).toMatchObject({ path: 'price::revenue',
      value: { intent: 'set', magnitude: 0.1, sizing_after_approval: 'placeholder' } });
  });

  it('CONTROL: source user_specified without projection retains already/as-user-set-it and own-strength refusal', async () => {
    for (const fromWords of [undefined, STRONG_WORDS]) {
      const w = world(priceRevenue(false));
      expect(linkSizing(w.edge())).toBe('user');
      const p = await w.caps.proposeLinkStrengths!(ctx(fromWords ?? 'Please suggest a strength.'), proposalArgs('strong', fromWords));
      expect(p).toMatchObject({ ok: false, refusal: 'nothing_to_change',
        already: ['"Price" → "Revenue" is already strong, as the user set it'] });
      expect(w.sent).toEqual([]);
    }
    const w = world(priceRevenue(false));
    const weak = await w.caps.proposeLinkStrengths!(ctx('Please suggest a strength.'), proposalArgs('weak'));
    expect(weak).toMatchObject({ ok: false, refusal: 'users_own_strength' });
    expect(String(weak.detail)).toContain('the user’s own (strong)');
  });

  // Science 393023 LICENCE ruling 3, re-derived: the new review-only literal describes a kept placeholder
  // after the canonical review writer, not any arbitrary old placeholder; contradictory metadata keeps fallback.
  it('R7 RED: the composed review-only literal requires kept placeholder before and after review', async () => {
    const w = world();
    const p = await w.caps.proposeLinkStrengths!(ctx('Please suggest a strength.'), proposalArgs('strong'));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const link = (p.links as Record<string, unknown>[])[0]!;
    for (const edited of [
      { ...link, was: { sizing: 'olumi_estimate' } },
      { ...link, keeps_current_strength: false },
      { ...link, sizing_after_approval: 'user' },
      { ...link, sizing_after_approval: undefined },
      { ...link, whose: 'placeholder prior changed; nobody has sized this link' },
      { ...link, whose: 'Olumi’s first estimate for a link nobody had sized' },
    ]) {
      expect(composeProposalReply('propose_link_strengths', { whole_request: true, links: [] },
        { ...p, links: [edited] }, 'Please suggest a strength.'), JSON.stringify(edited)).toBeNull();
    }
  });

  it('CONTROL: a normal hypothesis placeholder keeps its first-estimate proposal and composed words', async () => {
    const initial = priceRevenue();
    initial.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' };
    const w = world(initial);
    const p = await w.caps.proposeLinkStrengths!(ctx('Please suggest a strength.'), proposalArgs('strong'));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p.links).toEqual([expect.objectContaining({ was: { sizing: 'placeholder' },
      whose: 'Olumi’s first estimate for a link nobody had sized', keeps_current_strength: true,
      sizing_after_approval: 'olumi_accepted' })]);
    expect(composeProposalReply('propose_link_strengths', { ...proposalArgs('strong'), whole_request: true }, p,
      'Please suggest a strength.')).toContain('For links nobody had sized, this offers Olumi’s first estimate');
  });

  // Science 393023 LICENCE ruling 3, re-derived: an unmarked .6 with no projection/size tag has no recorded author.
  // "Olumi's estimate" → no ownership claim and the existing untyped-ownership reply fallback.
  it('R7 RED: unmarked proposal words do not invent an Olumi estimate or an unsized placeholder', async () => {
    const initial = priceRevenue();
    initial.strength = { mean: 0.6, std: 0.2 };
    initial.provenance = { source: 'cee_hypothesis' };
    const w = world(initial);
    expect(linkSizing(w.edge())).toBe('unmarked');
    const p = await w.caps.proposeLinkStrengths!(ctx('Please suggest a strength.'), proposalArgs('strong'));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(String(p.public_label)).toContain('source of its size not recorded');
    expect(String(p.public_label)).not.toMatch(/Olumi[’']s estimate|placeholder/);
    expect((p.links as Record<string, unknown>[])[0]!.whose).toBeUndefined();
    expect(String(p.note)).not.toContain('Every strength here is Olumi’s estimate');
    expect(composeProposalReply('propose_link_strengths', { ...proposalArgs('strong'), whole_request: true }, p,
      'Please suggest a strength.')).toBeNull();
  });
});

describe('R7 approval readback follows the stored sizing class', () => {
  // Science 393023 LICENCE ruling 3, re-derived: B1 confirm keeps Price→Revenue at 0.5 and records review without
  // clearing mean_projected. A reviewed placeholder was rejected by the must-be-sized gate → successful review.
  it.each(['singular', 'plural-user', 'plural-model'] as const)('R7 RED: %s confirms the stored projected mean as review', async (kind) => {
    const w = world();
    const c = ctx(kind === 'plural-model' ? 'Please suggest a strength.' : STRONG_WORDS);
    const p = kind === 'singular'
      ? await w.caps.proposeLinkStrength!(c, { ...labels, strength: 'strong', rationale: 'B1 review' })
      : await w.caps.proposeLinkStrengths!(c, proposalArgs('strong', kind === 'plural-user' ? STRONG_WORDS : undefined));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await w.caps.authoriseChange(c, { proposal_id: String(p.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    expect(w.sent).toHaveLength(1);
    expect(w.edge()).toMatchObject({ from: 'price', to: 'revenue', strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'user_specified', mean_projected: true, reviewed_by_user: { intent: 'confirm' } } });
    expect(linkSizing(w.edge())).toBe('placeholder');
    expect(String(out.follow_up)).not.toMatch(/your estimate|your own|your judgement|Olumi[’']s estimate/);
  });

  // Science 393023 LICENCE ruling 3, re-derived: changing this user-drawn projected prior preserves its unsized
  // class under the canonical adoption writer. "first estimate" / must-be-sized readback failure → honest prior
  // change at 0.1, still placeholder, review recorded, and no estimate or user authorship claim.
  it('R7 RED: a model-proposed move of the projected Price→Revenue prior is confirmed as an unsized change', async () => {
    const w = world();
    const c = ctx('Please suggest a strength.');
    const args = { ...proposalArgs('weak'), whole_request: true };
    const p = await w.caps.proposeLinkStrengths!(c, args);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p.links).toEqual([expect.objectContaining({ from: 'Price', to: 'Revenue', was: { sizing: 'placeholder' },
      whose: 'placeholder prior changed; nobody has sized this link', keeps_current_strength: false,
      sizing_after_approval: 'placeholder', becomes: { sizing: 'placeholder' } })]);
    const op = w.store.get(String(p.proposal_id))!.operations[0]!;
    expect(op).toMatchObject({ op: 'set_link_strength', path: 'price::revenue',
      value: { magnitude: 0.1, intent: 'set', author: 'model_proposed', sizing_after_approval: 'placeholder' } });
    const held = w.store.get(String(p.proposal_id))!;
    const tampered = new ProposalStore();
    tampered.put({ ...held, operations: [{ ...op, value: { ...(op.value as Record<string, unknown>), sizing_after_approval: 'user' } }] });
    expect(tampered.authorise({ proposal_id: held.proposal_id, scenario_id: SCENARIO, authenticated_user_id: null,
      current_graph_identity_hash: held.base_graph_identity_hash }).status, 'the held post-approval class is content-hashed').toBe('integrity_failed');
    const changedLink = (p.links as Record<string, unknown>[])[0]!;
    for (const edited of [{ ...changedLink, keeps_current_strength: true }, { ...changedLink, sizing_after_approval: 'user' },
      { ...changedLink, was: { sizing: 'olumi_estimate' } }]) {
      expect(composeProposalReply('propose_link_strengths', args, { ...p, links: [edited] }, c.user_text)).toBeNull();
    }
    const text = composeProposalReply('propose_link_strengths', args, p, c.user_text);
    expect(text).not.toBeNull();
    expect(text).toContain('approving changes the stored placeholder strength and records your review');
    expect(text).not.toMatch(/as slight|Olumi[’']s (?:first )?estimate|as your own/);
    const out = await w.caps.authoriseChange(c, { proposal_id: String(p.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    expect(w.edge()).toMatchObject({ from: 'price', to: 'revenue', strength: { mean: 0.1 },
      provenance: { source: 'user_specified', mean_projected: true, reviewed_by_user: { intent: 'confirm' } } });
    expect(linkSizing(w.edge())).toBe('placeholder');
    expect(String(out.follow_up)).toContain('isn’t sized in the model yet');
    expect(String(out.follow_up)).not.toMatch(/your estimate|your own|your judgement|Olumi[’']s estimate/);
  });

  it('CONTROL: an unanticipated placeholder on a user-authored set still fails readback', async () => {
    const w = world(priceRevenue(), { source: 'user_specified', mean_projected: true });
    const c = ctx(WEAK_WORDS);
    const p = await w.caps.proposeLinkStrengths!(c, proposalArgs('weak', WEAK_WORDS));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await w.caps.authoriseChange(c, { proposal_id: String(p.proposal_id) });
    expect(out).toMatchObject({ ok: false, applied: false, refusal: 'not_verified' });
    expect(linkSizing(w.edge())).toBe('placeholder');
  });

  // Science 393023 LICENCE ruling 3, re-derived: a readback with magnitude user_stated is the user's size even
  // when its source is brief_extraction. Raw source rejected the applied size → predicate confirms it as theirs.
  it.each(['singular', 'plural'] as const)('R7 RED: %s set readback credits a stored user_stated magnitude', async (kind) => {
    const w = world(priceRevenue(), { source: 'brief_extraction', magnitude: 'user_stated' });
    const c = ctx(WEAK_WORDS);
    const p = kind === 'singular'
      ? await w.caps.proposeLinkStrength!(c, { ...labels, strength: 'weak', rationale: 'the user named weak' })
      : await w.caps.proposeLinkStrengths!(c, proposalArgs('weak', WEAK_WORDS));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await w.caps.authoriseChange(c, { proposal_id: String(p.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    expect(w.edge()).toMatchObject({ from: 'price', to: 'revenue', strength: { mean: 0.1 },
      provenance: { source: 'brief_extraction', magnitude: 'user_stated' } });
    expect(linkSizing(w.edge())).toBe('user');
  });

  it.each(['singular', 'plural'] as const)('CONTROL: %s set readback still accepts a genuinely user_specified size', async (kind) => {
    const w = world(priceRevenue(), { source: 'user_specified' });
    const c = ctx(WEAK_WORDS);
    const p = kind === 'singular'
      ? await w.caps.proposeLinkStrength!(c, { ...labels, strength: 'weak', rationale: 'user size' })
      : await w.caps.proposeLinkStrengths!(c, proposalArgs('weak', WEAK_WORDS));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await w.caps.authoriseChange(c, { proposal_id: String(p.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    expect(linkSizing(w.edge())).toBe('user');
  });
});
