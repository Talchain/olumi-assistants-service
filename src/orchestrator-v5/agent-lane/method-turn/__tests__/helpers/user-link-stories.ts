/**
 * AIE 19 Oct (prompt/AIE-PREMORTEM-HUMAN-SOURCE-GROUNDING-20261019-v1.json, AMEND): where nothing else grounds the pre-mortem, a
 * real relationship the USER sized on the scoped path grounds a hypothetical, qualitative story. These are the controls' common
 * terms, by identity: the turn runs; every item is a link on the graph that the link-sizing authority reads as the user's, with no
 * card (no approval, no write); the protocol citation stays unearned; and no link is called "nobody has sized this yet".
 */
import assert from 'node:assert/strict';

import { linkSizing } from '../../../../../cee/provenance/provenance-of.js';
import { cardCallFor, type MethodTurn, type RunMethodTurn } from '../../method-turn.js';

type Edge = { from?: unknown; to?: unknown };

export function assertUserLinkStories(out: MethodTurn | null, graph: { edges: readonly Edge[] }): RunMethodTurn {
  assert.equal(out?.kind, 'run');
  if (out?.kind !== 'run') throw new Error('expected story-only user links to ground the pre-mortem');
  const items = out.context.supplied_items;
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.kind, 'link', `${item.id} is not a link`);
    assert.equal(item.card, null, `${item.id} offers a card`);
    assert.equal(cardCallFor(item, graph as never), null, `${item.id} builds a card call`);
    const edge = graph.edges.find((e) => `${String(e.from)}->${String(e.to)}` === item.id);
    assert.ok(edge !== undefined, `${item.id} is not a link in the model`);
    assert.equal(linkSizing(edge), 'user', `${item.id} is not the user's link`);
  }
  assert.equal(out.context.dsk, null);
  assert.ok(!out.directive.includes('nobody has sized'), 'a link is called unsized');
  return out;
}
