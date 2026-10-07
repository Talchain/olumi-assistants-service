/**
 * S2l (Science 393023; DL 7 Oct "after #2665, rows first"): the Agent is never handed the producer's UNSCOPED "can't yet
 * test them against your target" beside a Run whose screen tests the target as a RANGE.
 *
 * SERVED Wave B9 unseen b9-1 Challenge (guest, staging, CEE df15c8c1 + UI 19e4dd53;
 * `waveB9-unseen1-df15c8c-challenge-turn001.json`, verbatim). The screen showed three range lines ("between about L% and
 * H% chance of meeting your goal"), and the Challenge said: "Without sized profit effects, the model cannot test your
 * £24,000 target." The Run's `GOAL_FIGURES_TARGET_NOT_TESTABLE` was already scoped to `carry_on_as_now`, the one option
 * with no range (`scopeTargetNotTestableWithRanges`), but it kept the producer's message, which speaks of "your options" and
 * names a RANGED option's links. Twins written by the author are labelled.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysisResultForAgent } from '../decision-sensitivity.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';

type Json = Record<string, any>;
const TURN = JSON.parse(readFileSync(new URL('./fixtures/waveB9-unseen1-df15c8c-challenge-turn001.json', import.meta.url), 'utf8')) as Json;
const block = (): Json => structuredClone(TURN.blocks.find((b: Json) => b?.type === 'analysis_result')) as Json;
const UNSCOPED = /can.t yet test them against your target/i;
const agentView = (b: Json): Json => analysisResultForAgent(b, TURN.draft_graph, true) as Json;
/** Author twin (Codex r1 P0): the target record with no scoped `say`, beside a placeholder withhold, the range kept. */
const PLACEHOLDER = { code: 'GOAL_FIGURES_PLACEHOLDER_PATH', severity: 'warning', option_ids: ['open_clifton_shop'], node_ids: ['monthly_profit'],
  withheld_claims: ['goal_probability'], message: 'This comparison turns on the link from ‘Clifton shop opening’ to ‘Clifton monthly operating profit’, whose strength nobody has set yet.' };
const sayless = (b: Json): Json => {
  b.enrichment.inference_warnings = [...(b.enrichment.inference_warnings as Json[]).map((w) => {
    if (w.code !== 'GOAL_FIGURES_TARGET_NOT_TESTABLE') return w;
    const { say: _say, ...rest } = w;
    return rest;
  }), PLACEHOLDER];
  return b;
};
const notTestableIn = (view: Json): Json | undefined =>
  (view.enrichment?.inference_warnings as Json[] | undefined)?.find((w) => w?.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');

describe('S2l: beside a range, the Agent is not told the target cannot be tested', () => {
  it('PRECONDITION (served): one block carries the range record AND the not-testable record with the unscoped words', () => {
    const ws = block().enrichment.inference_warnings as Json[];
    expect(ws.find((w) => w.code === 'GOAL_CHANCE_RANGE')?.option_ids).toEqual(['launch_loyalty_app', 'open_clifton_shop', 'sell_beans_wholesale']);
    const t = ws.find((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    expect(t?.option_ids).toEqual(['carry_on_as_now']);
    expect(t?.message).toMatch(UNSCOPED);
    expect(TURN.assistant_text).toContain('Without sized profit effects, the model cannot test your £24,000 target.');
  });

  it('RED at base: the Agent\'s view has no unscoped sentence; the scoped fact (which option, what is withheld) stays', () => {
    const view = agentView(block());
    expect(JSON.stringify(view)).not.toMatch(UNSCOPED);
    const t = notTestableIn(view);
    expect(t).toMatchObject({ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', option_ids: ['carry_on_as_now'], withheld_claims: ['goal_probability', 'joint_probability', 'outcome', 'downside'] });
    expect(t).not.toHaveProperty('message');
  });

  it('CONTROL (author twin): with no range record on the Run, the producer\'s message is true and stays verbatim', () => {
    const b = block();
    const original = (b.enrichment.inference_warnings as Json[]).find((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE')!.message;
    b.enrichment.inference_warnings = (b.enrichment.inference_warnings as Json[]).filter((w) => w.code !== 'GOAL_CHANCE_RANGE');
    expect(notTestableIn(agentView(b))?.message).toBe(original);
  });

  it('the other warnings are untouched (same codes, same order, minus the range record the Agent never reads raw)', () => {
    const before = (block().enrichment.inference_warnings as Json[]).map((w) => w.code).filter((c) => c !== 'GOAL_CHANCE_RANGE');
    expect((agentView(block()).enrichment.inference_warnings as Json[]).map((w) => w.code)).toEqual(before);
  });

  it.each([
    ['an empty range record (no options, no ranges)', (r: Json) => { r.option_ids = []; r.range_by_option = {}; }],
    ['a range whose option has no valid figures', (r: Json) => { for (const v of Object.values(r.range_by_option as Json)) (v as Json).low_pct = 'x'; }],
  ])('Codex r1 P1 (author twin): %s shows no range, so the producer\'s message is true and stays verbatim', (_name, spoil) => {
    const b = block();
    const ws = b.enrichment.inference_warnings as Json[];
    const original = ws.find((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE')!.message;
    spoil(ws.find((w) => w.code === 'GOAL_CHANCE_RANGE')!);
    expect(notTestableIn(agentView(b))?.message).toBe(original);
  });

  it('Codex r1 P0 (author twin): with no scoped say beside a placeholder withhold, the withheld reader never falls back to the unscoped words', () => {
    const got = goalChanceWithheldForAgent(sayless(block()), TURN.draft_graph);
    expect(got?.withheld).toBe(true);
    expect(got?.say).toMatch(/^This run shows some options’ chances only as a range\./u);
    expect(got?.say).not.toMatch(UNSCOPED);
    expect(got?.say).toContain('whose strength nobody has set yet');
  });

  it('CONTROL for the P0 row: the same block with no range record says the producer\'s target words (true there)', () => {
    const b = sayless(block());
    b.enrichment.inference_warnings = (b.enrichment.inference_warnings as Json[]).filter((w) => w.code !== 'GOAL_CHANCE_RANGE');
    expect(goalChanceWithheldForAgent(b, TURN.draft_graph)?.say).toMatch(UNSCOPED);
  });
});
