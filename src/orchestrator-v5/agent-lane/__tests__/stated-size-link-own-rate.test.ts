/**
 * ⭐ THE LINK'S OWN RATE IS NO OTHER QUANTITY (DL-3, after C5's rate diagnosis; step 8 replay of the served capacity draft cfa31dfb on
 * d2cb10ef). "Each additional specialist resolves about 20 tickets per week, between 10 and 30." names every word of the drafter's
 * rate factor ‘Tickets resolved per additional specialist’, so the binder refused the sentence as naming another quantity: the user's
 * 20 reached the Run as Olumi's placeholder (natural 12.5), and their 10–30 was never carried. That factor is the link's own rate (it
 * feeds the same target, unsized, in the target's unit PER the source's), the figure the sentence states, never a second quantity.
 * Real path: construction → saved bytes → readback → the Run request (the complete 20, the 10–30, the per-specialist unit, the quote and
 * the user's record). Negatives: every other shape still refuses.
 * SYNTHETIC wording apart from the served draft's own fixture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { bindStatedLinkSizes, type StatedSizeBindingLink, type StatedSizeBindingNode } from '../stated-size-binding.js';
import type { StatedRangeEnd } from '../../../cee/magnitude/link-effect.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../../routes/__tests__/fixtures/capacity-cfa31dfb-first-draft.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };

/** Construction → saved bytes → cold snapshot (readback) → the Run's PLoT request, as step 8's row runs it. */
async function savedAndRun(): Promise<{ saved: Rec; run: Rec }> {
  const SC = 'cd3d9c25-0000-4000-8000-0000000012c3';
  let saved: Rec | undefined;
  const out = await buildModelFromBrief(SC, FX.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { saved = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  }) as never, (async () => ({ text: FX.raw_text })) as never) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  const bytes = JSON.stringify(saved);
  const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: FX.brief, revision: 2 })), readMostRecentPendingActions: vi.fn(async () => []) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SC, 'req-own-rate', port as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({ plotClient: { run: vi.fn(), validatePatch: vi.fn() }, scenarioReader: async () => snapshot,
    probe: async (s: Rec) => { payload = s.plotPayload as Rec; } } as never);
  await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SC,
    request_id: 'req-own-rate', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-own-rate', scenario_id: SC, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-own-rate', signal: new AbortController().signal, orientationText: '' } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return { saved: JSON.parse(bytes) as Rec, run: (payload as Rec).graph as Rec };
}

describe('real path: the served capacity draft carries the user\'s rate on its link as theirs, with their range, to the Run', () => {
  it('the complete 20, the 10–30, the per-specialist unit, the quote and the user\'s record survive saved bytes → readback → Run', async () => {
    const { saved, run } = await savedAndRun();
    const quote = 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.';
    for (const [where, g] of [['saved', saved], ['Run request', run]] as const) {
      const edge = (g.edges as Rec[]).find((e) => e.from === 'additional_specialists' && e.to === 'additional_specialist_capacity');
      expect(edge?.provenance, where).toMatchObject({ magnitude: 'user_stated', source_quote: quote,
        natural_effect: { amount: 20, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'specialists',
          stated_range: { low: 10, high: 30, end: 'centre' } } });
      const source = (g.nodes as Rec[]).find((n) => n.id === 'additional_specialists');
      const record = (source?.user_statements as Rec[] | undefined)?.find((r) => r.subject_key === 'link|additional_specialists|additional_specialist_capacity||effect');
      expect(record?.statements, where).toEqual([expect.objectContaining({ speaker: 'user', quote, form: 'range', low: 10, high: 30 })]);
    }
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
