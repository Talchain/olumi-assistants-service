/**
 * ⭐ THE LINK'S OWN RATE IS NO OTHER QUANTITY (DL-3, after C5's rate diagnosis; step 8 replay of the served capacity draft cfa31dfb on
 * d2cb10ef). "Each additional specialist resolves about 20 tickets per week, between 10 and 30." names every word of the drafter's
 * rate factor ‘Tickets resolved per additional specialist’, so the binder refused the sentence as naming another quantity: the user's
 * 20 reached the Run as Olumi's placeholder (natural 12.5), and their 10–30 was never carried. That factor is the link's own rate (it
 * feeds the same target, unsized, in the target's unit PER the source's), the figure the sentence states, never a second quantity.
 * Real path: construction → saved bytes (the user's 20, theirs, with their range). Negatives: every other shape still refuses.
 * SYNTHETIC wording apart from the served draft's own fixture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { bindStatedLinkSizes, type StatedSizeBindingLink, type StatedSizeBindingNode } from '../stated-size-binding.js';
import type { StatedRangeEnd } from '../../../cee/magnitude/link-effect.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../../routes/__tests__/fixtures/capacity-cfa31dfb-first-draft.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };

describe('real path: the served capacity draft saves the user\'s rate on its link as theirs, with their range', () => {
  it('+1 specialist moves the capacity by the user\'s 20 tickets per week, user_stated, their 10–30 kept around it', async () => {
    let saved: Rec | undefined;
    const out = await buildModelFromBrief('cd3d9c25-0000-4000-8000-0000000012c3', FX.brief, (async (path: string, body: Rec) => {
      if (path.endsWith('/graph/register')) { saved = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    }) as never, (async () => ({ text: FX.raw_text })) as never) as Rec;
    expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
    const edge = (saved!.edges as Rec[]).find((e) => e.from === 'additional_specialists' && e.to === 'additional_specialist_capacity');
    expect(edge?.provenance?.magnitude).toBe('user_stated');
    expect(edge?.provenance?.natural_effect).toMatchObject({ amount: 20, amount_unit: 'tickets per week', per_source_change: 1 });
    expect(edge?.provenance?.natural_effect?.stated_range).toMatchObject({ low: 10, high: 30, end: 'centre' });
  });
});

const SENTENCE = 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.';
const node = (id: string, label: string, unit: string, kind = 'factor'): StatedSizeBindingNode => ({ id, label, unit, kind });
const BASE_NODES = [
  node('s', 'Additional specialists', 'specialists'),
  node('t', 'Additional specialist capacity', 'tickets per week'),
  node('r', 'Tickets resolved per additional specialist', 'tickets per week per specialist'),
  node('g', 'Weekly support capacity', 'tickets per week', 'goal'),
];
const SIZED: StatedSizeBindingLink = { from: 's', to: 't', effect_direction: 'positive',
  natural_effect: { amount: 20, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'specialists' } };
const RATE_LINK: StatedSizeBindingLink = { from: 'r', to: 't', effect_direction: 'positive' };
const ONWARD: StatedSizeBindingLink = { from: 't', to: 'g', effect_direction: 'positive' };

function bind(links: readonly StatedSizeBindingLink[], nodes: readonly StatedSizeBindingNode[], brief = SENTENCE) {
  const centreRanges = new Map<number, StatedRangeEnd>();
  const bound = bindStatedLinkSizes(links, nodes, brief, [], { centreRanges });
  return { bound: bound.has(0), range: centreRanges.get(0) };
}

describe('the binder: a sentence naming only the link\'s own rate binds the link; every other shape still refuses', () => {
  it('⭐ the rate feeding the same target, unsized, in the target\'s unit per the source\'s: bound, with the user\'s range', () => {
    expect(bind([SIZED, RATE_LINK, ONWARD], BASE_NODES)).toMatchObject({ bound: true, range: { low: 10, high: 30, end: 'centre' } });
  });
  it('CONTROL no rate node in the model: the sentence names no other quantity and binds, as before', () => {
    expect(bind([SIZED, ONWARD], BASE_NODES.filter((n) => n.id !== 'r')).bound).toBe(true);
  });
  it.each([
    ['the rate\'s unit is not the target\'s per the source\'s (no "per specialist")', [SIZED, RATE_LINK, ONWARD],
      BASE_NODES.map((n) => (n.id === 'r' ? { ...n, unit: 'tickets per week' } : n))],
    ['the rate\'s unit is per another noun', [SIZED, RATE_LINK, ONWARD],
      BASE_NODES.map((n) => (n.id === 'r' ? { ...n, unit: 'tickets per week per agent' } : n))],
    ['the rate does not feed the link\'s target', [SIZED, { ...RATE_LINK, to: 'g' }, ONWARD], BASE_NODES],
    ['the rate\'s own link carries a size of its own', [SIZED, { ...RATE_LINK, natural_effect: { amount: 1, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'tickets per week per specialist' } }, ONWARD], BASE_NODES],
    ['two such rates feed the target', [SIZED, RATE_LINK, { from: 'r2', to: 't', effect_direction: 'positive' }, ONWARD],
      [...BASE_NODES, node('r2', 'Tickets closed per additional specialist', 'tickets per week per specialist')]],
  ])('REFUSED: %s', (_case, links, nodes) => {
    expect(bind(links as StatedSizeBindingLink[], nodes as StatedSizeBindingNode[]).bound).toBe(false);
  });
  it('REFUSED: the sentence names a further quantity beside the rate', () => {
    const named = 'Each additional specialist resolves about 20 tickets per week of weekly support capacity, between 10 and 30.';
    expect(bind([SIZED, RATE_LINK, ONWARD], BASE_NODES, named).bound).toBe(false);
  });
});
