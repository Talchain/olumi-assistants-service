/**
 * S4c: the screen's range line is said by Olumi when the reply does not say it.
 *
 * Bound to the SERVED screen: `waveB-screen-range-lines-20261007.json` holds the range lines the UI drew on Wave B3/B4
 * (staging, guest; each with its capture file), and the turns are the served B4 Run narrations (keys untouched), whose
 * chat said "This run shows some options’ chances only as a range." with no figure. Rows written by the author are
 * labelled as such.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceRangeLinesForAgent, withRangeLinesOwed, type GoalChanceRangeLine } from '../goal-chance-range-lines.js';
import { withoutDriverAbsenceClaimsAtEgress } from '../goal-chance-driver-egress.js';
import { RANGE_OPENING } from '../goal-chance-withheld.js';

type Json = Record<string, any>;
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SCREEN = JSON.parse(fixture('waveB-screen-range-lines-20261007.json')) as { line: string; source: string }[];
const B4_RUN1 = JSON.parse(fixture('waveB4-unseen1-01a2b27-run1-turn003.json')) as Json;
const B4_RUN2 = JSON.parse(fixture('waveB4-unseen2-01a2b27-run1-turn003.json')) as Json;
const B3_READ = (JSON.parse(fixture('waveB3-unseen2-7addf05-readback-run1.json')) as { j: Json }).j;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const blockOf = (body: Json): Json => body.blocks.find((b: Json) => b.type === 'analysis_result');
const linesOf = (body: Json, current = true): GoalChanceRangeLine[] => goalChanceRangeLinesForAgent(blockOf(body), body.draft_graph, current);
const screenFor = (capture: string): string[] => SCREEN.filter((s) => s.source.includes(`/${capture}/`)).map((s) => s.line);
const whole = (l: GoalChanceRangeLine): string => `${l.range} ${l.depends}`;
const withoutRange = (body: Json): Json => {
  const out = clone(body);
  blockOf(out).enrichment.inference_warnings = blockOf(out).enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE');
  return out;
};

describe('S4c: the lines are the SCREEN’s, word for word, in its order', () => {
  it('served b4-1, b4-2 and the b3-2 readback: every line equals the line the UI drew', () => {
    expect(linesOf(B4_RUN1).map(whole)).toEqual(screenFor('unseen-b4-1'));
    expect(linesOf(B4_RUN2).map(whole)).toEqual(screenFor('unseen-b4-2'));
    expect(goalChanceRangeLinesForAgent(B3_READ.analysis_result, B3_READ.graph, true).map(whole)).toEqual(screenFor('unseen-b3-2'));
    expect(screenFor('unseen-b4-1')).toHaveLength(2);
  });

  it('record order, never an order by size (author: the record\'s option order reversed)', () => {
    const body = clone(B4_RUN1);
    const rec = blockOf(body).enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_RANGE');
    rec.option_ids = [...rec.option_ids].reverse();
    expect(linesOf(body).map((l) => l.option_id)).toEqual([...linesOf(B4_RUN1).map((l) => l.option_id)].reverse());
  });

  it('nothing when the Run is not current, or carries no range record', () => {
    expect(linesOf(B4_RUN1, false)).toEqual([]);
    expect(linesOf(withoutRange(B4_RUN1))).toEqual([]);
  });

  it('an option the graph cannot name has no line (never an id)', () => {
    const body = clone(B4_RUN1);
    const first = linesOf(B4_RUN1)[0]!.option_id;
    body.draft_graph.nodes = body.draft_graph.nodes.map((n: Json) => (n.id === first ? { ...n, label: '' } : n));
    expect(linesOf(body).map((l) => l.option_id)).toEqual(linesOf(B4_RUN1).slice(1).map((l) => l.option_id));
  });

  it('a link Olumi assumed exists says so (author: the record\'s kind set to link_existence)', () => {
    const body = clone(B4_RUN1);
    const rec = blockOf(body).enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_RANGE');
    const first = rec.option_ids[0];
    rec.range_by_option[first].kind = 'link_existence';
    expect(linesOf(body)[0]!.depends).toBe('It depends most on whether ‘Fourth shop operating status’ affects ‘Fourth shop monthly profit contribution’ at all, which Olumi assumed.');
  });
});

describe('S4c: owed only when the reply does not say it', () => {
  it('RED at base: the served b4-1 narration gets both lines right after the range opening', () => {
    const lines = linesOf(B4_RUN1);
    const out = withRangeLinesOwed(B4_RUN1.assistant_text, lines);
    expect(out.added).toBe(4);
    expect(out.text).toBe(B4_RUN1.assistant_text.replace(RANGE_OPENING, `${RANGE_OPENING} ${screenFor('unseen-b4-1').join(' ')}`));
  });

  it('RED at base: the served b4-2 narration says the chance right after "That share is not its chance …"', () => {
    const out = withRangeLinesOwed(B4_RUN2.assistant_text, linesOf(B4_RUN2));
    expect(out.added).toBe(4);
    for (const line of screenFor('unseen-b4-2')) expect(out.text).toContain(line);
    expect(out.text.indexOf('That share is not its chance')).toBeLessThan(out.text.indexOf('between about 9% and 58%'));
  });

  it('a reply that already says the lines (restyled quotes and bold) is unchanged', () => {
    const said = `${B4_RUN1.assistant_text}\n\n${screenFor('unseen-b4-1').join(' ').replace(/‘/g, '**“').replace(/’:/g, '”**:')}`;
    expect(withRangeLinesOwed(said, linesOf(B4_RUN1))).toEqual({ text: said, added: 0 });
  });

  it('a reply that says only the "depends most on" sentence gets only the figure', () => {
    const [first] = linesOf(B4_RUN1);
    const text = `Figures are provisional. ${first!.depends}`;
    const out = withRangeLinesOwed(text, [first!]);
    expect(out).toEqual({ text: `${text}\n\n${first!.range}`, added: 1 });
  });

  it('with no range opening in the reply, the lines close it as their own paragraph', () => {
    const lines = linesOf(B4_RUN2);
    expect(withRangeLinesOwed('The analysis ran.', lines).text).toBe(`The analysis ran.\n\n${screenFor('unseen-b4-2').join(' ')}`);
  });

  it('no lines → the reply unchanged, by reference', () => {
    const text = B4_RUN1.assistant_text as string;
    expect(withRangeLinesOwed(text, []).text).toBe(text);
  });

  it('the S2/S2f egress keeps every added sentence (its classes never fire on a range line)', () => {
    const added: Json = { ...B4_RUN1, assistant_text: withRangeLinesOwed(B4_RUN1.assistant_text, linesOf(B4_RUN1)).text };
    const out = withoutDriverAbsenceClaimsAtEgress(added, { analysisResult: blockOf(added), graph: added.draft_graph, requestId: 'r', exitPath: 'agent_lane_v1_final', turnId: 't' }) as Json;
    for (const line of screenFor('unseen-b4-1')) expect(out.assistant_text).toContain(line);
  });
});
