/**
 * ⭐ S2: THE USER'S EFFECTS, STATED THROUGH THE OPTIONS (served hiring negative r3, 14 Oct 18:54Z, scenario d9e685fb, turn 02).
 *
 * The user wrote the sentence below. On this model the levers are "Tech lead headcount" and "Developer headcount", and the
 * link-effect binder refused it (`not_the_users_statement`), so both effects stayed Olumi's placeholders and were asked again.
 * S2's one statement contract now reads it through the option that sets each source (`optionStatedLinkEffect`): the figure
 * governed by THAT option's clause, never the sentence's first one, and only the user's press records it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { applyLinkEffectEdit } from '../../system-events/link-effect-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { quoteIsNotTheUsersClaim } from '../../goal-target/input-claim-context.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/hiring-d9e685fb-negative-r3-turn02.json', import.meta.url), 'utf8')) as { graph: Json };
const SAID = 'For this model: hiring a Tech lead would raise productivity by about 8% of today’s, and each additional developer by about 3% of today’s.';
const SCENARIO = 'd9e685fb-4318-4975-932e-69f42e88f371';
const link = (from_label: string, amount: number, per_source_change_unit: string, quote = SAID) =>
  ({ from_label, to_label: 'Productivity', amount, amount_unit: '%', per_source_change: 1, per_source_change_unit, quote });

function world() {
  const graph = structuredClone(SERVED.graph);
  const store = new ProposalStore();
  let sent: CommitOptionLevelsInput | undefined;
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    sent = input;
    for (const item of input.link_effects ?? []) {
      const out = applyLinkEffectEdit({ persistedGraph: structuredClone(graph), from: item.from, to: item.to, effect: item.effect, quote: item.quote,
        expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: item.edge_token }, reading_token: item.reading_token,
        ...(item.unit_readings !== undefined ? { unit_readings: item.unit_readings } : {}) });
      if (out.kind !== 'mutated') throw new Error(`writer refused: ${JSON.stringify(out)}`);
      const i = (graph.edges as Json[]).findIndex((e) => e.from === item.from && e.to === item.to);
      graph.edges[i] = (out.mutatedGraph as Json).edges.find((x: Json) => x.from === item.from && x.to === item.to);
    }
    return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, receipt: null, already_applied: false, committed_levels: [] };
  };
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const caps = createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels });
  const ctx = (extra: Json = {}) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'hiring-neg-r3', user_text: SAID, user_turn_text: SAID, ...extra });
  return { graph, store, caps, ctx, sent: () => sent };
}

describe('⭐ real path: Paul\'s sentence on the served graph, one card, the real writer', () => {
  it('RED→GREEN: the Tech lead binds 8 and the developer binds 3; press → both goal links carry the user\'s figures', async () => {
    const w = world();
    const prepared = await w.caps.proposeLinkEffect!(w.ctx(), { links: [link('Tech lead headcount', 8, 'Tech lead'), link('Developer headcount', 3, 'developer')] }) as Json;
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    expect(prepared.not_prepared).toBeUndefined();
    // Each link is read in its source's own unit, from the option that adds it: Olumi's reading, on the card for the press.
    expect(prepared.links.map((l: Json) => [l.from, l.effect.amount, l.effect.per_source_change, l.effect.per_source_change_unit])).toEqual([
      ['Tech lead headcount', 8, 1, 'people'], ['Developer headcount', 3, 1, 'developers']]);
    // Nothing is recorded before the press.
    expect(w.sent()).toBeUndefined();
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(prepared.proposal_id) }],
      (id) => ({ proposal: w.store.get(id), result: prepared as never }))[0]!;
    const applied = await w.caps.authoriseChange!(w.ctx({ typed_approval_of: prepared.proposal_id, typed_approval_words: card.message }),
      { proposal_id: prepared.proposal_id }) as Json;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(w.sent()?.link_effects?.map((l) => [l.from, l.effect.amount])).toEqual([['tech_lead_headcount', 8], ['developer_headcount', 3]]);
    for (const [from, amount] of [['tech_lead_headcount', 8], ['developer_headcount', 3]] as const) {
      const edge = (w.graph.edges as Json[]).find((e) => e.from === from && e.to === 'productivity')!;
      expect(edge.provenance?.magnitude).not.toBe('olumi_placeholder');
      expect(edge.provenance?.natural_effect).toMatchObject({ amount, amount_unit: '%', per_source_change: 1 });
    }
  });
  it('⭐ RED→GREEN: the served refusal shape (the whole statement, the source in its own unit) binds through the option', async () => {
    // Binder alone: `not_the_users_statement` / `not_one_statement` (the colon), as served at 18:54Z.
    const w = world();
    const r = await w.caps.proposeLinkEffect!(w.ctx(), link('Tech lead headcount', 8, 'people')) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(w.store.get(String(r.proposal_id))?.operations[0]?.value).toMatchObject({ quote: SAID,
      effect: { amount: 8, amount_unit: '%', per_source_change: 1, per_source_change_unit: 'people' } });
  });
  it('the developer link alone binds 3 (single-link path)', async () => {
    const w = world();
    const r = await w.caps.proposeLinkEffect!(w.ctx(), link('Developer headcount', 3, 'developer')) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe('CONTRAST: a wrong number or a wrong link stays refused', () => {
  it('⛔ swapped: the Tech lead never takes the developer\'s 3, nor the developer the Tech lead\'s 8', async () => {
    for (const wrong of [link('Tech lead headcount', 3, 'Tech lead'), link('Developer headcount', 8, 'developer')]) {
      const r = await world().caps.proposeLinkEffect!(world().ctx(), wrong) as Json;
      expect(r.ok, JSON.stringify(r)).toBe(false);
      expect(r.refusal).toBe('not_the_users_statement');
    }
  });
  it('⛔ a link no named option sets (Code quality degradation → Productivity) is refused', async () => {
    const r = await world().caps.proposeLinkEffect!(world().ctx(), link('Code quality degradation', 8, 'unit')) as Json;
    expect(r.ok).toBe(false);
  });
  it('⛔ a quote that is not a whole statement of the user\'s words prepares nothing', async () => {
    const part = 'hiring a Tech lead would raise productivity by about 8% of today’s';
    const r = await world().caps.proposeLinkEffect!(world().ctx(), link('Tech lead headcount', 8, 'Tech lead', part)) as Json;
    expect(r.ok).toBe(false);
  });
  it('⛔ the user asking, or denying, prepares nothing', async () => {
    for (const said of ['Would hiring a Tech lead raise productivity by about 8% of today’s?', 'Hiring a Tech lead would not raise productivity by 8% of today’s.']) {
      const w = world();
      const r = await w.caps.proposeLinkEffect!(w.ctx({ user_text: said, user_turn_text: said }), link('Tech lead headcount', 8, 'Tech lead', said)) as Json;
      expect(r.ok, said).toBe(false);
    }
  });
});

describe('⛔ WRONG AUTHOR: Olumi\'s claim is never the user\'s figure (it bound on staging, for any unit the binder reads)', () => {
  const offer = async (said: string, unit: string) => {
    const w = world();
    return await w.caps.proposeLinkEffect!(w.ctx({ user_text: said, user_turn_text: said }),
      link('Tech lead headcount', 8, unit, said)) as Json;
  };
  it.each([
    'Olumi suggested that hiring a Tech lead would raise productivity by about 8% of today’s.',
    'You suggested: hiring a Tech lead would raise productivity by about 8% of today’s.',
    'Hiring a Tech lead would raise productivity by about 8% of today’s, according to Olumi.',
    'I disagree that hiring a Tech lead would raise productivity by about 8% of today’s.',
    'Hiring a Tech lead would raise productivity by about 8% of today’s. Is that right?',
  ])('RED→GREEN: %s → refused, whatever the unit', async (said) => {
    for (const unit of ['Tech lead', 'people']) {
      const r = await offer(said, unit);
      expect(r.ok, `${unit}: ${JSON.stringify(r)}`).toBe(false);
    }
  });
  it('CONTRAST: the user\'s own claim beside Olumi\'s, and the user\'s plain claim, are theirs', () => {
    const said = 'Olumi suggested 5%, but I think hiring a Tech lead would raise productivity by about 8% of today’s.';
    expect(quoteIsNotTheUsersClaim(said, 'I think hiring a Tech lead would raise productivity by about 8% of today’s.')).toBe(false);
    expect(quoteIsNotTheUsersClaim(said, said)).toBe(true);
    expect(quoteIsNotTheUsersClaim(SAID, SAID)).toBe(false);
    expect(quoteIsNotTheUsersClaim('I disagree. Hiring a Tech lead would raise productivity by about 8% of today’s.',
      'Hiring a Tech lead would raise productivity by about 8% of today’s.')).toBe(false);
  });
});
