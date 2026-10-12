/**
 * U2-1 × S2l at the cell. U2-1 says a withheld cell's `why` on the reply's face. Beside a range, the target record's
 * unscoped `message` ("can't yet test them against your target") is false of the Run (Science 393023; the Agent's
 * reader already drops it). It reached the face through the cell on the served Wave B9 unseen b9-1 Run: carry-on
 * withheld, three ranges shown. So the cell says the target record's scoped `say`, or failing that the option's own
 * licensed line, named. The reason stays in `reasons` as data.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectCanonicalAnalysisCells } from '../canonical-analysis-view.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/waveB9-unseen1-df15c8c-readback-pre-challenge.json', import.meta.url), 'utf8')) as { j: Json }).j;
const UNSCOPED = /can.{1,8}t yet test them against your target/u;
const OWN_LINE = '‘Carry on as now’: Olumi can’t yet say its chance of meeting your goal, in this model.';
const target = (r: Json): Json => r.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
const carryOn = (edit: (r: Json) => void = () => {}): Json => {
  const r = structuredClone(READ.analysis_result) as Json;
  edit(r);
  return projectCanonicalAnalysisCells(r as never, READ.graph).find((c) => c.option_id === 'carry_on_as_now')!.cell as Json;
};

describe('IDENTITY: the served b9-1 Run', () => {
  it('three options ranged, carry-on withheld by the target record alone, whose say is empty and message unscoped', () => {
    const cells = projectCanonicalAnalysisCells(READ.analysis_result, READ.graph);
    expect(cells.map((c) => [c.option_id, c.cell.kind])).toEqual([
      ['launch_loyalty_app', 'range'], ['open_clifton_shop', 'range'], ['sell_beans_wholesale', 'range'], ['carry_on_as_now', 'withheld']]);
    expect([target(READ.analysis_result).say, target(READ.analysis_result).option_ids]).toEqual(['', ['carry_on_as_now']]);
    expect(target(READ.analysis_result).message).toMatch(UNSCOPED);
  });
});

describe('beside a range, the cell never says the unscoped words', () => {
  it('b9-1: the why is carry-on\'s own licensed line, named; the reason stays as data', () => {
    const cell = carryOn();
    expect(cell.why).toBe(OWN_LINE);
    expect(cell.reasons).toEqual([{ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', message: target(READ.analysis_result).message }]);
  });
  it('a scoped say (design: the producer\'s scoped words) speaks in place of the message', () => {
    const say = 'Carry on as now has no sized path to your target yet.';
    expect(carryOn((r) => { target(r).say = say; }).why).toBe(`Not shown. ${say}`);
  });
  it('the Codex twin: a placeholder record scoped to carry-on speaks instead (the target record no longer hides it)', () => {
    const words = 'This comparison turns on the link from ‘Clifton shop opening’ to ‘Clifton monthly operating profit’, whose strength nobody has set yet.';
    const cell = carryOn((r) => { r.enrichment.inference_warnings.push({ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', severity: 'warning',
      option_ids: ['carry_on_as_now'], node_ids: ['monthly_profit'], withheld_claims: ['goal_probability'], message: words }); });
    expect(cell.why).toBe(`Not shown. ${words}`);
  });
});

describe('CONTROL: with no range shown the message is true, and the cell says it as before', () => {
  it('the range record removed (no option ranged): the why is the producer\'s message, exactly', () => {
    const cell = carryOn((r) => { r.enrichment.inference_warnings = r.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE'); });
    expect(cell.why).toBe(target(READ.analysis_result).message);
  });
});
