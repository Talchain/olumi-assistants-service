import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { linkEffectClarificationLineage, linkEffectClarificationOnRefusal } from '../link-effect-clarification.js';
import { linkEffectLatestFiguresDisclosure, type LinkEffectFloor } from '../link-effect-lower-bound.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectReadingToken } from '../../system-events/link-effect-edit.js';

type Json = Record<string, any>;
const graph = {
  goal_node_id: 'profit',
  nodes: [
    { id: 'profit', kind: 'goal', label: 'Daily profit' },
    { id: 'price', kind: 'factor', label: 'Café price',
      observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: '£', source: 'user_override' } },
    { id: 'margin', kind: 'factor', label: 'Gross margin',
      observed_state: { value: 0.3, raw_value: 30, cap: 100, unit: '%', source: 'user_override' } },
    { id: 'tax', kind: 'factor', label: 'Tax rate',
      observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '%', source: 'user_override' } },
  ],
  edges: ['margin', 'tax'].map(to => ({ from: 'price', to, strength: { mean: 0.2, std: 0.1 },
    exists_probability: 0.9, effect_direction: 'positive',
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } })),
};
const floor: LinkEffectFloor = {
  from_id: 'price', to_id: 'margin', value: 5, unit: 'percentage points', reading: 'points',
  words: 'at least 5 points', per_source_change: 1, per_source_change_unit: '£', reading_answer: 'points',
  from_label: 'Café price', target_label: 'Gross margin',
  source_quote: 'Raising the café price by £1 will increase gross margin by at least 5 points.',
};
const effect = { amount: 5, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£' };
const sentence = (words: string) => `Earlier you said ‘${words}’; Olumi now uses your latest figures.`;

function askFor(f: LinkEffectFloor) {
  return linkEffectClarificationOnRefusal({ scenarioId: 'scenario', graph,
    message: f.source_quote!, emittedAtIso: new Date().toISOString(), action: {
      from_id: f.from_id!, to_id: f.to_id!, from_label: f.from_label!, to_label: f.target_label!,
      quote: f.source_quote!, question: 'What is your best single guess, and the lowest and highest it could plausibly be?',
      resolved_reading: 'points', refusal: 'not_the_users_statement', floor: f,
    } })!;
}

async function prepare(amount: number, currentFloor: LinkEffectFloor, unrelated: boolean, grouped: boolean, checkLineage = false) {
  const pending = [askFor(currentFloor)];
  if (unrelated) pending.push(askFor({ ...floor, to_id: 'tax', target_label: 'Tax rate', value: 1000,
    words: 'at least 1000 points', source_quote: 'Raising the café price by £1 will increase tax rate by at least 1000 points.' }));
  expect(pending.every(Boolean)).toBe(true);
  const store = new ProposalStore();
  const dispatch: InternalDispatch = async path => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph,
      graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`Unexpected write: ${path}`);
  };
  const caps = createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { readPendingActions: async () => pending });
  const quote = `Raising the café price by £1 will increase gross margin by ${amount} points.`;
  const entry = { from_label: 'Café price', to_label: 'Gross margin', ...effect, amount, quote };
  const result = await caps.proposeLinkEffect!({ scenario_id: 'scenario', authenticated_user_id: null,
    request_id: 'disclosure', user_text: quote }, grouped ? { links: [entry] } : entry) as Json;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (checkLineage) expect(result.resolved_link_effect_lineages).toEqual([linkEffectClarificationLineage(pending[0]!)]);
  const value = store.get(String(result.proposal_id))!.operations[0]!.value as Json;
  const write = { persistedGraph: graph, from: value.from, to: value.to, effect: value.effect, quote: value.quote,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: value.edge_token },
    ...(value.clarification === undefined ? {} : { clarification: value.clarification }),
    ...(value.unit_readings === undefined ? {} : { unit_readings: value.unit_readings }) };
  expect(applyLinkEffectEdit({ ...write, reading_token: linkEffectReadingToken(write) }).kind).toBe('mutated');
  return result;
}

describe('RC2a fix2 latest-figures and exact-pair disclosure', () => {
  it('P2 RED: strict more-than-5 includes equality in latest-figures disclosure', () => {
    expect(linkEffectLatestFiguresDisclosure({ ...floor, exclusive: true, words: 'more than 5 points' },
      { ok: true, guess: 5 }, effect)).toBe(sentence('more than 5 points'));
    expect(linkEffectLatestFiguresDisclosure(floor, { ok: true, guess: 5 }, effect)).toBeUndefined();
  });

  it.each([false, true])('P2 RED: exact-pair latest sentence survives unrelated ask (grouped=%s)', async grouped => {
    const alone = await prepare(2, floor, false, grouped);
    const withOther = await prepare(2, floor, true, grouped);
    expect(alone.link_effect_latest_figure_disclosures).toEqual([sentence(floor.words)]);
    expect(withOther.link_effect_latest_figure_disclosures).toEqual(alone.link_effect_latest_figure_disclosures);
  });

  it.each([false, true])('P2 RED: strict equality writes and discloses for exact pair (grouped=%s)', async grouped => {
    const strict = { ...floor, exclusive: true as const, words: 'more than 5 points' };
    expect((await prepare(5, strict, true, grouped)).link_effect_latest_figure_disclosures)
      .toEqual([sentence(strict.words)]);
    expect((await prepare(5, floor, true, grouped)).link_effect_latest_figure_disclosures).toBeUndefined();
  });

  it.each([false, true])('unrelated floor never discloses for an above-floor current effect (grouped=%s)', async grouped => {
    expect((await prepare(6, floor, true, grouped)).link_effect_latest_figure_disclosures).toBeUndefined();
  });

  it.each([false, true])('P1 RED: consumption reports the exact selected clarification lineage (grouped=%s)', async grouped => {
    await prepare(2, floor, true, grouped, true);
  });

  it.each([false, true])('P2 RED: endpoints elsewhere do not disambiguate a short quoted answer (grouped=%s)', async grouped => {
    const pending = [askFor(floor), askFor({ ...floor, to_id: 'tax', target_label: 'Tax rate',
      source_quote: 'Raising the café price by £1 will increase tax rate by at least 5 points.' })];
    const store = new ProposalStore();
    const dispatch: InternalDispatch = async () => ({ status: 200, json: { graph,
      graph_hash: computeAnalysisAffectingGraphHash(graph as never) } });
    const caps = createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { readPendingActions: async () => pending });
    const entry = { from_label: 'Café price', to_label: 'Gross margin', ...effect, amount: 4, quote: '4' };
    const result = await caps.proposeLinkEffect!({ scenario_id: 'scenario', authenticated_user_id: null, request_id: 'ambiguous',
      user_text: 'Café price affects Gross margin and Tax rate. My best guess is 4.' }, grouped ? { links: [entry] } : entry) as Json;
    expect(result.ok, JSON.stringify(result)).toBe(false);
    expect(store.size()).toBe(0);
  });
});
