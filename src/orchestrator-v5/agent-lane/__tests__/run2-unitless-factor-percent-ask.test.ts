import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placeholderAskWords, placeholderGoalWarning, unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { mediatorReadings } from '../mediator-reading.js';
import { linkSizeAsk } from '../link-size-ask.js';
import { sourceChangeWords } from '../say-figure.js';
import { notTargetTestableSentence, targetTestabilityOf } from '../../admission/target-testability.js';

type Rec = Record<string, unknown>;
type Graph = { nodes: Rec[]; edges: Rec[]; goal_constraints?: Rec[] };
type Link = { from: string; to: string };
const FX = JSON.parse(readFileSync(new URL('./fixtures/rewitness-2-run2-unitless-onboarding.json', import.meta.url), 'utf8')) as {
  draft_graph: Graph; served_assistant_text: string; graph_hash: string;
  placeholder_warning: { code: string; message: string; links: Link[]; option_ids: string[]; first_ask: Link & { kind: 'link' }; acceptable_links: Link[] };
};
const FROM = 'productivity_lost_to_onboarding';
const TO = 'productivity';
const FIRST = { kind: 'link', from: FROM, to: TO };
const BAD = 'each 1% of ‘Productivity lost to onboarding’';
const ROUTE = 'On the canvas, click the link from ‘Productivity lost to onboarding’ to ‘productivity’; under “How strong is this effect?” choose Slight, Moderate, Strong or Very strong.';
const node = (g: Graph, id: string): Rec => {
  const n = g.nodes.find(n => n.id === id);
  if (n === undefined) throw new Error(`Missing witnessed node ${id}`);
  return n;
};
const warning = (g = FX.draft_graph, productBlocks = false) => placeholderGoalWarning(
  g, unsizedLeaderGoalPaths(g, FX.placeholder_warning.option_ids), FX.placeholder_warning.code, productBlocks,
);

describe('X2: exact re-witness 2 N1 wire — a parent estimate is not a unitless factor’s percent basis', () => {
  it('PRECONDITION: the captured change goal, level, unitless risk and Olumi percent estimate are retained verbatim', () => {
    expect(FX.graph_hash).toBe('bf2e52d544901caa');
    expect(node(FX.draft_graph, TO)).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1,
      observed_state: { unit: 'small-update equivalents per sprint', raw_value: 16, cap: 22, source: 'user_override' } });
    const risk = node(FX.draft_graph, FROM);
    expect(risk).toMatchObject({ kind: 'risk', provenance: 'ai_inferred', scale_frame: 30 });
    expect(risk).not.toHaveProperty('observed_state');
    expect(risk).not.toHaveProperty('unit');
    expect(mediatorReadings(FX.draft_graph).get(FROM)).toEqual({ via: 'sized_parents', unit: '%', child: TO, parents: ['developer_hires'] });
    expect(FX.placeholder_warning.message).toContain(BAD);
    expect(FX.served_assistant_text).toContain(FX.placeholder_warning.message);
  });

  it('RED: Run warning takes the existing link strength route instead of asking per invented 1%', () => {
    const w = warning();
    expect(w.message).toContain(ROUTE);
    expect(w.message).toContain('That records your judgement of the link’s strength.');
    expect(w.message).not.toContain(BAD);
    expect(w.message).not.toContain('Olumi measures');
    expect(w.message).not.toContain('today’s level');
    expect(w.message.length).toBeLessThanOrEqual(400);
    expect(w.first_ask).toEqual(FIRST);
    expect(w.links).toEqual(FX.placeholder_warning.links);
    // Nothing changes admission, the target, or the links eligible for the existing approval offer.
    expect(w.acceptable_links).toEqual(FX.placeholder_warning.acceptable_links);
    expect(w.option_ids).toEqual(FX.placeholder_warning.option_ids);
  });

  it('RED: the shared producer used by the agent’s withhold reply says the same qualitative route on the captured links', () => {
    const before = JSON.stringify(FX.draft_graph);
    const words = placeholderAskWords(FX.draft_graph, FX.placeholder_warning.links)!;
    expect(words.message).toContain(ROUTE);
    expect(words.message).toBe(warning().message);
    expect(words.first).toEqual(FIRST);
    expect(words.gaugeLinks.size).toBe(0);
    expect(JSON.stringify(FX.draft_graph)).toBe(before);
  });

  it('CONTROL: an actual user percent unit still asks the percent change; it is not sent to qualitative sizing', () => {
    const g = structuredClone(FX.draft_graph);
    node(g, FROM).observed_state = { unit: '%', raw_value: 10, value: 0.1, cap: 100, source: 'user_override' };
    expect(linkSizeAsk(g, { message: 'Tell me about the link from Productivity lost to onboarding to productivity.',
      restingText: '', awaitingApproval: false }))
      .toBe('How much does "productivity" change when "Productivity lost to onboarding" goes up by one percentage point?');
    expect(sourceChangeWords('‘Productivity lost to onboarding’', '%', false).eachOf).toBe(BAD);
    expect(warning(g).message).not.toContain('On the canvas');
  });

  it('CONTROL: a real user percent source still reaches the upstream numeric % ask', () => {
    const g = JSON.parse(readFileSync(new URL('../../admission/__tests__/fixtures/bprime-d3-guessed-upstream-link.json', import.meta.url), 'utf8')) as Graph;
    const e = g.edges.find(e => e.from === 'existing_price_increase' && e.to === 'monthly_recurring_revenue')!;
    e.provenance = { ...(e.provenance as Rec), magnitude: 'user_stated' };
    node(g, 'starter_tier_monthly_recurring_revenue').observed_state = { unit: '£/month', value: 0, raw_value: 0, cap: 50000, source: 'cee_inference' };
    node(g, 'starter_monthly_price').observed_state = { unit: '%', value: 0.1, raw_value: 10, cap: 100, source: 'user_override' };
    // Remove the fixture's old money unit: the user's stored percent is now the source's own native unit.
    node(g, 'starter_monthly_price').unit = '%';
    expect(notTargetTestableSentence(g, targetTestabilityOf(g)))
      .toContain('when Starter monthly price rises by 1%?');
  });

  it.each(['£/month', 'weeks'])('CONTROL: an Olumi-derived non-percent unit (%s) keeps its numeric sizing question', unit => {
    const g = structuredClone(FX.draft_graph);
    const e = g.edges.find(e => e.from === 'developer_hires' && e.to === FROM)!;
    const p = e.provenance as Rec;
    e.provenance = { ...p, natural_effect: { ...(p.natural_effect as Rec), amount_unit: unit } };
    const w = warning(g);
    // The existing 400-character fitter may compact the repeated source label for a longer money unit.
    expect(w.message).toContain('Olumi measures ‘Productivity lost to');
    expect(w.message).toContain(`’ in ${unit}, from its own estimate`);
    expect(w.message).toContain(`Roughly how much does ${sourceChangeWords('', unit, false).eachOf}`);
    expect(w.message).toContain('change ‘productivity’, in small-update equivalents per sprint?');
    expect(w.message).not.toContain('On the canvas');
    expect(w.first_ask).toEqual(FIRST);
  });

  it('CONTROL: the route survives long labels within the warning carrier, still on the same typed link', () => {
    const g = structuredClone(FX.draft_graph);
    node(g, FROM).label = 'Onboarding disruption '.repeat(8);
    node(g, TO).label = 'Sprint delivery '.repeat(10);
    const w = warning(g);
    expect(w.message).toContain('On the canvas, click the link from');
    expect(w.message).toContain('choose Slight, Moderate, Strong or Very strong.');
    expect(w.message).toContain('That records your judgement of the link’s strength.');
    expect(w.message.length).toBeLessThanOrEqual(400);
    expect(w.first_ask).toEqual(FIRST);
  });

  it('CONTROL: while a product gate blocks, there is still no invitation or first ask', () => {
    const w = warning(FX.draft_graph, true);
    expect(w.message).not.toContain('On the canvas');
    expect(w).not.toHaveProperty('first_ask');
    expect(w).not.toHaveProperty('acceptable_links');
  });
});
