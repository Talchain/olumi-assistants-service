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
import { goalChanceScreenLinesForAgent, withScreenLinesOwed, type GoalChanceScreenLine } from '../goal-chance-screen-lines.js';
import { withoutDriverAbsenceClaimsAtEgress } from '../goal-chance-driver-egress.js';
import { RANGE_OPENING } from '../goal-chance-withheld.js';

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
const T1B_LEAD = 'For reaching at least £126,000 monthly recurring revenue, on current information:';

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
        low: 0, high: 1, low_pct: 0, high_pct: 100, low_rounding: 'whole', high_rounding: 'whole',
        from: 'team_share', to: 'launch_share', among: 'all' } },
    }] };
    const lines = goalChanceScreenLinesForAgent(result, graph, true);
    expect(lines).toHaveLength(1);
    expect(whole(lines[0]!)).toBe(`‘Carry on as now’: between less than 1% and more than 99% chance of launching by 7 April 2027, in this model, from the slow end of your ${quantity === 'months_to_finish' ? '6–10 months' : '10–16% of launch per month'} to the fast end.`);
    expect(lines[0]!.depends).toBe('');
    expect(whole(lines[0]!)).not.toMatch(/affects|assumed|best|leader/);
  });
  it('served ranges (b4-1, b4-2, b3-2 readback): every line equals the line the UI drew', () => {
    expect(linesOf(B4_RUN1).map(whole)).toEqual(screenFor('unseen-b4-1'));
    expect(linesOf(B4_RUN2).map(whole)).toEqual(screenFor('unseen-b4-2'));
    expect(goalChanceScreenLinesForAgent(B3_READ.analysis_result, B3_READ.graph, true).map(whole)).toEqual(screenFor('unseen-b3-2'));
    expect(screenFor('unseen-b4-1')).toHaveLength(2);
  });

  it('served points (B5 T1b on 3fce64f, prod cut-6 T1b): every line equals the line the UI drew, in licence order', () => {
    expect(linesOf(B5_T1B).map(whole)).toEqual(screenFor('t1b-b5-1'));
    expect(screenFor('t1b-b5-1')).toHaveLength(3);
    expect(PROD_SCREEN.startsWith(linesOf(PROD).map(whole).join(' '))).toBe(true);
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
    expect(linesOf(body)[0]!.depends).toBe('It depends most on whether ‘Fourth shop operating status’ affects ‘Fourth shop monthly profit contribution’ at all, which Olumi assumed.');
  });
});

describe('S4c: owed only when the reply does not give that option’s figure', () => {
  it('RED at base: the served b4-1 narration gets both range lines right after the range opening', () => {
    const out = withScreenLinesOwed(B4_RUN1.assistant_text, linesOf(B4_RUN1));
    expect(out.added).toBe(4);
    expect(out.text).toBe(B4_RUN1.assistant_text.replace(RANGE_OPENING, `${RANGE_OPENING} ${screenFor('unseen-b4-1').join(' ')}`));
  });

  it('RED at base: the served b4-2 narration says the chance right after "That share is not its chance …"', () => {
    const out = withScreenLinesOwed(B4_RUN2.assistant_text, linesOf(B4_RUN2));
    expect(out.added).toBe(4);
    for (const line of screenFor('unseen-b4-2')) expect(out.text).toContain(line);
    expect(out.text.indexOf('That share is not its chance')).toBeLessThan(out.text.indexOf('between about 9% and 58%'));
  });

  it('RED at base: the served B5 T1b narration gets its three lines under its own empty lead-in, before the deadline line', () => {
    expect(B5_T1B.assistant_text).toContain(`${T1B_LEAD}\n\nThis model doesn't yet say whether any option gets there within 9 months.`);
    const out = withScreenLinesOwed(B5_T1B.assistant_text, linesOf(B5_T1B));
    expect(out.added).toBe(5);
    expect(out.text).toBe(B5_T1B.assistant_text.replace(`${T1B_LEAD}\n\n`, `${T1B_LEAD}\n\n${screenFor('t1b-b5-1').join(' ')}\n\n`));
  });

  it('the served prod cut-6 T1b reply already gives every figure in its own words: unchanged', () => {
    expect(withScreenLinesOwed(PROD.assistant_text, linesOf(PROD))).toEqual({ text: PROD.assistant_text, added: 0 });
  });

  it('a reply that already says the lines (restyled quotes and bold) is unchanged', () => {
    const said = `${B4_RUN1.assistant_text}\n\n${screenFor('unseen-b4-1').join(' ').replace(/‘/g, '**“').replace(/’:/g, '”**:')}`;
    expect(withScreenLinesOwed(said, linesOf(B4_RUN1))).toEqual({ text: said, added: 0 });
  });

  it('a reply that names the option with its figure in other words is unchanged (author)', () => {
    const [first] = linesOf(B5_T1B);
    const text = `Raise prices 10%: about 47%, on current information.`;
    expect(first!.label).toBe('Raise prices 10%');
    expect(withScreenLinesOwed(text, [first!])).toEqual({ text, added: 0 });
  });

  it('a reply that says only the "depends most on" sentence: the figure is added and the driver MOVES after it, never twice', () => {
    const [first] = linesOf(B4_RUN1);
    const text = `Figures are provisional. ${first!.depends}`;
    expect(withScreenLinesOwed(text, [first!])).toEqual({ text: `Figures are provisional.\n\n${first!.chance} ${first!.depends}`, added: 1 });
  });

  it('a driver sentence the reply restyled (not word for word) stays where it is and is not added again', () => {
    const [first] = linesOf(B5_T1B);
    const restyled = first!.depends.replace(/‘/g, '“').replace(/’/g, '”');
    const text = `Figures are provisional. ${restyled}`;
    expect(withScreenLinesOwed(text, [first!])).toEqual({ text: `${text}\n\n${first!.chance}`, added: 1 });
  });

  it.each([
    // a lead-in followed by a list is not an empty lead-in
    ['Two things to check about reaching the goal:\n\n- the churn figure\n- the price rise', 'appends'],
    // a lead-in whose next paragraph already names an option is not empty
    ['On current information:\n\nRaise prices 10% looks fragile.', 'appends'],
    // a colon line about something else
    ['Next steps:\n\nSize the price link.', 'appends'],
  ])('lead-in twins (author): %s → %s', (text) => {
    const lines = linesOf(B5_T1B);
    // naming an option without its figure does not give the figure: every line is owed, as a closing paragraph
    expect(withScreenLinesOwed(text, lines).text).toBe(`${text}\n\n${screenFor('t1b-b5-1').join(' ')}`);
  });

  it('with no range opening and no empty lead-in, the lines close the reply as their own paragraph', () => {
    expect(withScreenLinesOwed('The analysis ran.', linesOf(B4_RUN2)).text).toBe(`The analysis ran.\n\n${screenFor('unseen-b4-2').join(' ')}`);
  });

  it('no lines → the reply unchanged', () => {
    const text = B4_RUN1.assistant_text as string;
    expect(withScreenLinesOwed(text, []).text).toBe(text);
  });

  it('the S2/S2f egress keeps every added sentence (its classes never fire on a chance line)', () => {
    for (const body of [B4_RUN1, B5_T1B]) {
      const added: Json = { ...body, assistant_text: withScreenLinesOwed(body.assistant_text, linesOf(body)).text };
      const out = withoutDriverAbsenceClaimsAtEgress(added, { analysisResult: blockOf(added), graph: added.draft_graph, requestId: 'r', exitPath: 'agent_lane_v1_final', turnId: 't' }) as Json;
      for (const l of linesOf(body)) expect(out.assistant_text).toContain(whole(l));
    }
  });
});
