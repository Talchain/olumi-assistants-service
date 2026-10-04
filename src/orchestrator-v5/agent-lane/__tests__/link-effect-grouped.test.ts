import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { linkEffectEdgeToken } from '../../system-events/link-effect-edit.js';
import { approvalChipsFor } from '../approval-chips.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';

type Json = Record<string, any>;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-price-subscribers-unsized-5411da8.json', import.meta.url), 'utf8')) as { graph: Json };
const BASE = fixture.graph;
const ctx = (user_text: string, extra: Json = {}) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', authenticated_user_id: null, request_id: 'grouped', user_text, ...extra });

const links = [
  { from_label: 'Pro plan price', to_label: 'Pro plan paying subscribers', amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month', quote: 'Every £1 on the Pro plan price loses us about 50 Pro plan paying subscribers' },
  { from_label: 'Monthly churn', to_label: 'Pro plan paying subscribers', amount: -40, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'percent per month', quote: 'Every 1% monthly churn loses about 40 Pro plan paying subscribers' },
  { from_label: 'Feature delivery scope', to_label: 'Monthly churn', amount: -0.75, amount_unit: 'percentage points', per_source_change: 100, per_source_change_unit: 'percent of proposed release', quote: 'Every 100% increase in Feature delivery scope loses about 0.75 percentage points of Monthly churn' },
] as const;

function world(graph: Json = structuredClone(BASE)) {
  const store = new ProposalStore();
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { store, d, graph, caps: createAgentCapabilities(d, store) };
}

describe('propose_link_effect grouped natural effects', () => {
  it('prepares three identity-bound operations in order and gives one approval card', async () => {
    const { caps, store } = world();
    const text = links.map((link) => link.quote).join('. ') + '.';
    const result = await caps.proposeLinkEffect!(ctx(text, { user_turn_text: text }), { links }) as Json;
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const proposal = store.get(String(result.proposal_id))!;
    expect(proposal.operations).toHaveLength(3);
    expect(proposal.operations.map((op) => op.path)).toEqual([
      'pro_plan_price::pro_plan_paying_subscribers',
      'monthly_churn::pro_plan_paying_subscribers',
      'feature_delivery_scope::monthly_churn',
    ]);
    expect(result.public_label).toBe('Record your figures for 3 links');
    expect(result.links).toHaveLength(3);
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(result.proposal_id) }],
      (id) => ({ proposal: store.get(id), result: result as never }))[0]!;
    expect(card.message).toContain('Yes — Record:');
    expect(card.message.split('\n')).toHaveLength(3);
    expect(card.detail).toContain(links[0].quote);
  });

  it('keeps passing links and reports one invalid link without storing it', async () => {
    const { caps, store } = world();
    const invalid = { ...links[1], quote: 'Every 100 Pro plan paying subscribers changes MRR somehow' };
    const text = `${links[0].quote}. ${invalid.quote}. ${links[2].quote}.`;
    const result = await caps.proposeLinkEffect!(ctx(text), { links: [links[0], invalid, links[2]] }) as Json;
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.links).toHaveLength(2);
    expect(result.not_prepared).toEqual([expect.objectContaining({ from_label: invalid.from_label, to_label: invalid.to_label, refusal: 'not_the_users_figure' })]);
    expect(store.get(String(result.proposal_id))?.operations).toHaveLength(2);
  });

  it('single-link calls retain their existing one-operation shape', async () => {
    const { caps, store } = world();
    const single = links[0];
    const result = await caps.proposeLinkEffect!(ctx(single.quote), single) as Json;
    expect(result.ok).toBe(true);
    expect(store.get(String(result.proposal_id))?.operations).toHaveLength(1);
    expect(result.link).toEqual(expect.objectContaining({ from: single.from_label, to: single.to_label, your_words: single.quote }));
  });

  it('approval sends all effects through one door call and stale link two writes nothing', async () => {
    const { store, graph } = world();
    let calls = 0;
    let sent: CommitOptionLevelsInput | undefined;
    const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      calls += 1;
      sent = input;
      for (const item of input.link_effects ?? []) {
        const edge = (graph.edges as Json[]).find((candidate) => candidate.from === item.from && candidate.to === item.to)!;
        edge.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: item.effect };
      }
      return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, receipt: null, already_applied: false, committed_levels: [] };
    };
    const withDoor = createAgentCapabilities((async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
      throw new Error(`unexpected dispatch ${path}`);
    }) as InternalDispatch, store, undefined, 'full', undefined, { commitOptionLevels });
    const text = links.map((link) => link.quote).join('. ') + '.';
    const prepared = await withDoor.proposeLinkEffect!(ctx(text), { links }) as Json;
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(prepared.proposal_id) }],
      (id) => ({ proposal: store.get(id), result: prepared as never }))[0]!;
    const applied = await withDoor.authoriseChange!(ctx(card.message, { typed_approval_of: prepared.proposal_id, typed_approval_words: card.message }), { proposal_id: prepared.proposal_id }) as Json;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(calls).toBe(1);
    expect(sent?.link_effects).toHaveLength(3);
    expect(sent?.link_effect).toBeUndefined();

    const staleWorld = world();
    const staleCaps = createAgentCapabilities(staleWorld.d, staleWorld.store, undefined, 'full', undefined, {
      commitOptionLevels: async () => ({ status: 'stale' } as CommitOptionLevelsResult),
    });
    const stalePrepared = await staleCaps.proposeLinkEffect!(ctx(text), { links }) as Json;
    const staleProposal = staleWorld.store.get(String(stalePrepared.proposal_id))!;
    const second = staleProposal.operations[1]!.value as Json;
    const staleEdge = (staleWorld.graph.edges as Json[]).find((edge) => edge.from === second.from && edge.to === second.to)!;
    staleEdge.reasoning = 'changed after the card';
    const staleCard = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(stalePrepared.proposal_id) }],
      (id) => ({ proposal: staleWorld.store.get(id), result: stalePrepared as never }))[0]!;
    const refused = await staleCaps.authoriseChange!(ctx(staleCard.message, { typed_approval_of: stalePrepared.proposal_id, typed_approval_words: staleCard.message }), { proposal_id: stalePrepared.proposal_id }) as Json;
    expect(refused.ok).toBe(false);
    expect(refused).toEqual(expect.objectContaining({ refusal: 'not_applied', reason: 'link_effect_refused' }));
    expect(staleWorld.store.size()).toBe(1);
    expect(linkEffectEdgeToken(staleWorld.graph, second.from, second.to)).not.toBe(second.edge_token);
  });
});
