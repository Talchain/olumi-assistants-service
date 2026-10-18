/**
 * S4c: the screen's chance lines (ranges; points on the `each` licence) are said by Olumi when the reply does not give them.
 *
 * Bound to the SERVED screen: `waveB-screen-chance-lines-20261007.json` holds the chance lines the UI drew on Wave B3/B4/B5
 * (staging, guest; each with its capture file), and `prod-cut6-smoke-cdcd44c3-screen-chance-lines.txt` is the prod cut-6
 * T1b screen. The turns are served Run narrations, keys untouched:
 * - B4 unseen ×2: "only as a range", no figure;
 * - B5 T1b on 3fce64f: "…on current information:" with nothing under it, because the leader gate deleted 3 lines.
 * Rows written by the author are labelled as such.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceScreenLinesForAgent, checkScreenLineClaims, type GoalChanceScreenLine } from '../goal-chance-screen-lines.js';

type Json = Record<string, any>;
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SCREEN = JSON.parse(fixture('waveB-screen-chance-lines-20261007.json')) as { line: string; source: string }[];
const PROD_SCREEN = fixture('prod-cut6-smoke-cdcd44c3-screen-chance-lines.txt');
const B4_RUN1 = JSON.parse(fixture('waveB4-unseen1-01a2b27-run1-turn003.json')) as Json;
const B4_RUN2 = JSON.parse(fixture('waveB4-unseen2-01a2b27-run1-turn003.json')) as Json;
const B5_T1B = JSON.parse(fixture('waveB5-t1b-3fce64f-run1-turn003.json')) as Json;
const PROD = JSON.parse(fixture('prod-cut6-smoke-cdcd44c3-turn003.json')) as Json;
const B3_READ = (JSON.parse(fixture('waveB3-unseen2-7addf05-readback-run1.json')) as { j: Json }).j;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const blockOf = (body: Json): Json => body.blocks.find((b: Json) => b.type === 'analysis_result');
const linesOf = (body: Json, current = true): GoalChanceScreenLine[] => goalChanceScreenLinesForAgent(blockOf(body), body.draft_graph, current);
const screenFor = (capture: string): string[] => SCREEN.filter((s) => s.source.includes(`/${capture}/`)).map((s) => s.line);
const whole = (l: GoalChanceScreenLine): string => [l.chance, l.depends].filter((s) => s !== '').join(' ');
const warning = (body: Json, code: string): Json => blockOf(body).enrichment.inference_warnings.find((w: Json) => w.code === code);
const withoutRange = (body: Json): Json => {
  const out = clone(body);
  blockOf(out).enrichment.inference_warnings = blockOf(out).enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE');
  return out;
};
// AIE 3694547a + 60cf911e: these legacy captures retain the original independently rounded
// pair and RC4 source counts; the approved words describe two groups without inventing a tested target.
const CONDITIONAL_SCREEN: Record<string, string[]> = {
  'unseen-b4-1': [
    "‘Fourth Shop in Clifton’: the model’s two groups for how strongly ‘Fourth shop operating status’ affects ‘Fourth shop monthly profit contribution’ give about 4% and 55%, under the recorded assumptions. These are conditional model results, not one overall chance or an uncertainty interval. Using Olumi's estimates for 6 starting values and 6 relationships (see Check estimates). This link is not sized in the model yet.",
    "‘Wholesale to Offices’: the model’s two groups for how strongly ‘Wholesale sales effort’ affects ‘Wholesale incremental monthly gross profit’ give less than 1% and 5%, under the recorded assumptions. These are conditional model results, not one overall chance or an uncertainty interval. Using Olumi's estimates for 6 starting values and 6 relationships (see Check estimates). This link is not sized in the model yet.",
  ],
  'unseen-b4-2': [
    "‘Fourth Shop in Clifton’: the model’s two groups for how strongly ‘Fourth shop active’ affects ‘Fourth-shop operating profit’ give about 9% and 58%, under the recorded assumptions. These are conditional model results, not one overall chance or an uncertainty interval. Using Olumi's estimates for 6 starting values and 10 relationships (see Check estimates). This link is not sized in the model yet.",
    "‘Wholesale to Offices’: the model’s two groups for how strongly ‘Wholesale sales active’ affects ‘Wholesale gross profit’ give about 1% and 37%, under the recorded assumptions. These are conditional model results, not one overall chance or an uncertainty interval. Using Olumi's estimates for 6 starting values and 10 relationships (see Check estimates). This link is not sized in the model yet.",
  ],
  'unseen-b3-2': [
    "‘Fourth shop in Clifton’: the model’s two groups for how strongly ‘Fourth shop operating’ affects ‘Fourth-shop monthly operating profit’ give about 5% and 50%, under the recorded assumptions. These are conditional model results, not one overall chance or an uncertainty interval. Using Olumi's estimates for 6 starting values, 2 option settings and 5 relationships (see Check estimates). This link is not sized in the model yet.",
  ],
};
// …and, once the screen carries Olumi's count, RC4's existing rule applies to the range as to a point: narration never
// supplies k, so the served B4-1 narrator's own count sentence ("16 underlying values …") is taken out (narratorCountGuard).
const B4_1_NARRATOR_COUNT = 'The analysis ran, but it cannot put an option forward: profit-generating links remain unsized, and 16 underlying values are Olumi’s assumptions, not yours.\n\n';

describe('S4c: the lines are the SCREEN’s, word for word, in its order', () => {
  it.each(['months_to_finish', 'share_per_month'])('P1-c: stated_time %s describes slow to fast without causal doubt', quantity => {
    const graph = { nodes: [
      { id: 'status_quo', kind: 'option', label: 'Carry on as now' },
      { id: 'team_share', label: 'Team launch share', observed_state: { stated_time: {
        quantity, low: quantity === 'months_to_finish' ? 6 : 10,
        high: quantity === 'months_to_finish' ? 10 : 16, unit: quantity === 'months_to_finish' ? 'months' : '% of launch per month',
      } } },
      { id: 'launch_share', label: 'Launch share' },
    ] };
    const result = { inference_warnings: [{ code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Stated time.',
      option_ids: ['status_quo'], target: { comparator: 'at_least', value: 100, unit: '% of launch', by_date: '2027-04-07' },
      range_by_option: { status_quo: { kind: 'stated_time', basis: 'stated_time', quantity,
        stated_estimate: { low: quantity === 'months_to_finish' ? 6 : 10, high: quantity === 'months_to_finish' ? 10 : 16,
          unit: quantity === 'months_to_finish' ? 'months' : '% of launch per month' },
        low: 0, high: 1, low_pct: 0, high_pct: 100, low_rounding: 'whole', high_rounding: 'whole',
        from: 'team_share', to: 'launch_share', among: 'all' } },
    }] };
    const lines = goalChanceScreenLinesForAgent(result, graph, true);
    expect(lines).toHaveLength(1);
    // DL #2762 r3 (lens 1 P2s): the ruled "launching by", and a stated time read at its two ends ("if it takes …").
    expect(whole(lines[0]!)).toBe(quantity === 'months_to_finish'
      ? '‘Carry on as now’: less than 1% chance of launching by 7 April 2027 if it takes 10 months, and more than 99% if it takes 6 months, in this model.'
      : '‘Carry on as now’: between less than 1% and more than 99% chance of launching by 7 April 2027, in this model, from the slow end of your 10–16% of launch per month to the fast end.');
    expect(lines[0]!.depends).toBe('');
    expect(whole(lines[0]!)).not.toMatch(/affects|assumed|best|leader/);
  });
  it('legacy served pairs (b4-1, b4-2, b3-2 readback): exact conditional words preserve every rounded figure and source count', () => {
    expect(linesOf(B4_RUN1).map(whole)).toEqual(CONDITIONAL_SCREEN['unseen-b4-1']);
    expect(linesOf(B4_RUN2).map(whole)).toEqual(CONDITIONAL_SCREEN['unseen-b4-2']);
    expect(goalChanceScreenLinesForAgent(B3_READ.analysis_result, B3_READ.graph, true).map(whole)).toEqual(CONDITIONAL_SCREEN['unseen-b3-2']);
    expect(screenFor('unseen-b4-1')).toHaveLength(2);
    for (const [capture, lines] of [
      ['unseen-b4-1', linesOf(B4_RUN1)], ['unseen-b4-2', linesOf(B4_RUN2)],
      ['unseen-b3-2', goalChanceScreenLinesForAgent(B3_READ.analysis_result, B3_READ.graph, true)],
    ] as const) {
      expect(lines.map(row => row.figure)).toEqual(screenFor(capture).map(row => row.match(/between .*?% and .*?%/u)?.[0]));
      expect(lines.every(row => !row.chance.includes('for ‘') && !row.chance.includes('chance of meeting your goal'))).toBe(true);
    }
  });

  it('served points: B5 and prod cut-6 stay byte-identical; RC4 excludes the validated arithmetic definition', () => {
    expect(linesOf(B5_T1B).map(whole)).toEqual(screenFor('t1b-b5-1'));
    expect(screenFor('t1b-b5-1')).toHaveLength(3);
    const prod = linesOf(PROD);
    expect(PROD_SCREEN.startsWith(prod.map(whole).join(' '))).toBe(true);
    for (const line of prod) {
      // Science §(f), r6: validatedDefinition is arithmetic, not an estimated link size.
      expect(line.olumi_estimate_link_count).toBeUndefined();
      expect(line.chance).not.toContain('using Olumi');
    }
    expect(linesOf(PROD)).toHaveLength(3);
  });

  it('record order, never an order by size (author: the range record\'s option order reversed)', () => {
    const body = clone(B4_RUN1);
    const rec = warning(body, 'GOAL_CHANCE_RANGE');
    rec.option_ids = [...rec.option_ids].reverse();
    expect(linesOf(body).map((l) => l.option_id)).toEqual([...linesOf(B4_RUN1).map((l) => l.option_id)].reverse());
  });

  it('points only on the `each` licence (author: the served T1b licence set to `similar`)', () => {
    const body = clone(B5_T1B);
    const rec = warning(body, 'GOAL_CHANCE_LICENSED');
    rec.form = 'similar';
    rec.similar_option_ids = [...rec.option_ids];
    expect(linesOf(body)).toEqual([]);
  });

  it('nothing when the Run is not current, or carries no range record and no point licence', () => {
    expect(linesOf(B4_RUN1, false)).toEqual([]);
    expect(linesOf(B5_T1B, false)).toEqual([]);
    expect(linesOf(withoutRange(B4_RUN1))).toEqual([]);
  });

  it('an option the graph cannot name has no line (never an id)', () => {
    const body = clone(B4_RUN1);
    const first = linesOf(B4_RUN1)[0]!.option_id;
    body.draft_graph.nodes = body.draft_graph.nodes.map((n: Json) => (n.id === first ? { ...n, label: '' } : n));
    expect(linesOf(body).map((l) => l.option_id)).toEqual(linesOf(B4_RUN1).slice(1).map((l) => l.option_id));
  });

  it('a link Olumi assumed exists says so (author: the range record\'s kind set to link_existence)', () => {
    const body = clone(B4_RUN1);
    const rec = warning(body, 'GOAL_CHANCE_RANGE');
    rec.range_by_option[rec.option_ids[0]].kind = 'link_existence';
    expect(linesOf(body)[0]!.chance).toBe('‘Fourth Shop in Clifton’: the model’s two groups for whether ‘Fourth shop operating status’ affects ‘Fourth shop monthly profit contribution’ give about 4% and 55%, under the recorded assumptions. These are conditional model results, not one overall chance or an uncertainty interval. Using Olumi\'s estimates for 6 starting values and 6 relationships (see Check estimates).');
    expect(linesOf(body)[0]!.depends).toBe('This relationship is an Olumi assumption.');
  });
});

describe('the retained count check adds no host finding or coaching move', () => {
  it('scrubs the captured fabricated narrator count without appending a chance or another question', () => {
    expect(B4_RUN1.assistant_text.startsWith(B4_1_NARRATOR_COUNT)).toBe(true);
    const out = checkScreenLineClaims(B4_RUN1.assistant_text, linesOf(B4_RUN1), [], undefined, { values: 6, links: 6 });
    expect(out).toBe(B4_RUN1.assistant_text.replace(B4_1_NARRATOR_COUNT, ''));
  });

  it('a missing chance, static note or driver stays on its supplied card rather than being manufactured in the reply', () => {
    const lines = linesOf(B4_RUN2);
    expect(lines.length).toBeGreaterThan(0);
    expect(checkScreenLineClaims('The analysis ran.', lines))
      .toBe('The analysis ran.');
  });

  it('retains a supplied driver in place and leaves ordinary conversation alone', () => {
    const [line] = linesOf(B4_RUN1);
    expect(line!.depends).not.toBe('');
    const text = `Figures are provisional. ${line!.depends}`;
    expect(checkScreenLineClaims(text, [line!])).toBe(text);
    expect(checkScreenLineClaims('Which assumption matters?', [])).toBe('Which assumption matters?');
  });
});
