import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { targetTestabilityOf, notTargetTestableSentence } from '../../../admission/target-testability.js';
import { linkList, legacyLinkSentence } from '../../../agent-lane/unsized-path-cause.js';
import { runP0Graph } from './mc-p0-run-helper.js';

type R = Record<string, any>;
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8,
  effect_direction: 'positive', defaulted: true, provenance: { source: 'cee_hypothesis', mean_projected: true } });
function graph(count: number, repeat = 1): R {
  return { nodes: [
    { id: 'g', kind: 'goal', label: 'Revenue'.repeat(repeat) },
    ...Array.from({ length: count }, (_, i) => ({ id: `x${i}`, kind: 'factor', label: `Capacity ${i}`.repeat(repeat), observed_state: { value: 0.1, source: 'user_override' } })),
    { id: 'a', kind: 'option', label: 'Expand', interventions: { x0: { value: 0.8, source: 'brief_extraction' } } },
    { id: 'b', kind: 'option', label: 'Pilot', interventions: { x0: { value: 0.4, source: 'brief_extraction' } } },
    { id: 'd', kind: 'decision', label: 'Compare capacity options' },
  ], edges: [edge('d', 'a'), edge('d', 'b'), edge('a', 'x0'), edge('b', 'x0'),
    ...Array.from({ length: count }, (_, i) => edge(`x${i}`, i + 1 === count ? 'g' : `x${i + 1}`)),
  ], goal_node_id: 'g' };
}
function accounting(sentence: string, links: R[]): void {
  const pairs = [...sentence.matchAll(/from ‘([^’]*)’ to ‘([^’]*)’/g)];
  const rest = Number(sentence.match(/ and (\d+) more/)?.[1] ?? 0);
  expect(pairs.length + rest).toBe(5);
  expect(rest).toBe(links.length - pairs.length);
  for (const [i, pair] of pairs.entries()) {
    for (const [shown, full] of [[pair[1], links[i]!.from_label], [pair[2], links[i]!.to_label]]) {
      if (shown !== full) {
        expect(shown.endsWith('…')).toBe(true);
        expect(full.startsWith(shown.slice(0, -1))).toBe(true);
      }
    }
  }
}
it.each([12, 100])('R10 science: five-link Run shortening accounts for all five and marks every shortened label; repeat=%s', async repeat => {
  const g = graph(5, repeat);
  const r = await runP0Graph(g, 'Compare the options.');
  const w = r.enrichment.inference_warnings.find((w: R) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH');
  expect(w.links).toHaveLength(5);
  const links = w.links.map((l: R) => ({ ...l, from_label: g.nodes.find((n: R) => n.id === l.from).label,
    to_label: g.nodes.find((n: R) => n.id === l.to).label }));
  expect(`This comparison turns on the ${linkList(links)}, whose strengths nobody has set yet. Set them to see how much they matter.`.length).toBeGreaterThan(400);
  expect(w.message.length).toBeLessThanOrEqual(400);
  // Every candidate in the shortening sequence retains the original total.
  for (const count of [3, 2, 1]) accounting(linkList(links, count), links);
  accounting(w.message, links);
  accounting(legacyLinkSentence(links), links);
  if (repeat === 100) expect(w.message).toContain('…');
});
it('R10 science: P5 asks about just the first nearest-goal link; its reason lists the other two', () => {
  const g = graph(3);
  Object.assign(g.nodes[0], { goal_threshold: 0.8, goal_threshold_raw: 100, goal_threshold_unit: 'GBP/month',
    goal_comparator: '>=', goal_threshold_frame: 'level', observed_state: { baseline: 10, unit: 'GBP/month' } });
  const v = targetTestabilityOf(g);
  expect(v.kind).toBe('not_testable');
  if (v.kind !== 'not_testable') throw new Error('P5 should fail');
  const p5 = v.failures.find(f => f.precondition === 'P5')!;
  expect(p5.links).toEqual([{ from: 'x2', to: 'g' }, { from: 'x1', to: 'x2' }, { from: 'x0', to: 'x1' }]);
  expect(p5.link).toEqual(p5.links![0]);
  const said = notTargetTestableSentence(g, v)!;
  const [reason, question] = said.split(' Roughly ');
  expect(reason).toContain('from Capacity 2 to Revenue, from Capacity 1 to Capacity 2 and from Capacity 0 to Capacity 1');
  expect(question).toBe('how much Revenue in GBP/month does a change in Capacity 2 bring?');
  expect(said.match(/how much/g)).toHaveLength(1);
  expect(question).not.toMatch(/Capacity [01]/);
});
it('R10 quoted withholds: single, three-link and more-than-three Run warnings retain complete lists', async () => {
  const rows = [];
  for (const count of [1, 3, 5]) {
    const r = await runP0Graph(graph(count), 'Compare the options.');
    const w = r.enrichment.inference_warnings.find((w: R) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH');
    expect(w.links).toHaveLength(count);
    expect(r.leading_option_id).toBeNull();
    rows.push({ count, sentence: w.message, links: w.links });
  }
});
it('R10 verbatim summaries from stored d1/d2/d3, without changing their graphs', async () => {
  const brief = readFileSync(new URL('../../../admission/__tests__/fixtures/mc-p0/BRIEF.txt', import.meta.url), 'utf8');
  const rows = [];
  for (const draw of [1, 2, 3]) {
    const g = JSON.parse(readFileSync(new URL(`../../../admission/__tests__/fixtures/mc-p0/draw${draw}.json`, import.meta.url), 'utf8'));
    const r = await runP0Graph(g, brief);
    rows.push({ draw, summary: r.summary, leading_option_id: r.leading_option_id });
  }
});
