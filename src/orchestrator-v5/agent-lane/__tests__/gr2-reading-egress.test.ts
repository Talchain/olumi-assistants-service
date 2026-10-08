import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed, type GoalChanceScreenLine } from '../goal-chance-screen-lines.js';
import { goalChanceDriverDisplayForAgent, goalChanceDriversForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { SPREAD_NOTE_WITHOUT_DOWNSIDE } from '../../goal-target/goal-chance-licence.js';
import { readingChanceSentence, type ReadingLabel } from '../../goal-target/goal-reading-label.js';

type Rec = Record<string, unknown>;
const GRAPH = JSON.parse(readFileSync(new URL('./fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8')) as Rec;
const OPTION = 'raise_pro_price_to_59';
const NAME = 'Raise Pro price to £59';
const LABEL: ReadingLabel = { v: 1, source: 'olumi_reading', goal: { id: 'mrr', label: 'MRR' },
  factors: [{ id: 'pro_plan_price', label: 'Pro plan price' }, { id: 'pro_paying_subscribers', label: 'Pro paying subscribers' }],
  addends: [{ id: 'mrr_lost_to_price_driven_churn', label: 'MRR lost to price-driven churn', sign: 'less', sized: false }] };
const EXACT = "‘Raise Pro price to £59’: about 62% chance of meeting your goal, in this model, if ‘MRR’ = ‘Pro plan price’ × ‘Pro paying subscribers’, less ‘MRR lost to price-driven churn’ (Olumi's reading; that loss has no figure yet, so Olumi's stand-in for it is used).";

function result(driver?: Rec, labelled = true): Rec {
  return { inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Licensed.',
    form: 'each', option_ids: [OPTION], pct_by_option: { [OPTION]: 62 },
    ...(labelled ? { reading_licence: 'olumi_reading', reading_label: LABEL,
      reading_sentence_by_option: { [OPTION]: readingChanceSentence(NAME, 'about 62%', LABEL) } } : {}),
    ...(driver === undefined ? {} : { driver_by_option: { [OPTION]: driver } }),
  }] };
}
const lines = (): GoalChanceScreenLine[] => goalChanceScreenLinesForAgent(result(), GRAPH, true);

function barePointRow(api: typeof withScreenLinesOwed = withScreenLinesOwed): void {
  const before = `The current churn assumption is 3%. ‘${NAME}’: about 62% chance of meeting your goal, in this model. Confirm the reading?`;
  const out = api(before, lines());
  expect(lines()[0]?.chance).toBe(EXACT);
  expect(out.text).toBe(`The current churn assumption is 3%. ${EXACT} Confirm the reading?`);
  expect(out.added).toBe(1);
}

describe('GR2 labelled reading: final narrative figures retain their reading', () => {
  it('a bare per-option point is replaced in place by the exact recorded sentence; other prose stays', () => barePointRow());
  it.each([
    `**${NAME}**: about 62%.`,
    `For ‘${NAME}’, there is about 62% chance of meeting your goal.`,
    `‘${NAME}’: about 70% chance of meeting your goal, in this model.`,
  ])('a named bare chance cannot survive beside its labelled line: %s', bare => {
    expect(withScreenLinesOwed(bare, lines()).text).toBe(EXACT);
  });
  it('a bare range gets the same recorded reading, with no second sentence template', () => {
    const figure = 'between about 20% and 62%';
    const canonical = readingChanceSentence(NAME, figure, LABEL);
    const l = { ...lines()[0]!, figure, chance: canonical };
    const out = withScreenLinesOwed(`‘${NAME}’: ${figure} chance of meeting your goal, in this model.`, [l]);
    expect(out.text).toBe(canonical);
  });
  it('when the canonical reading is already present, another bare sentence is removed', () => {
    const out = withScreenLinesOwed(`${EXACT}\n\n‘${NAME}’: about 62%.\nKeep the loss-size question.`, lines());
    expect(out.text).toBe(`${EXACT}\n\n\nKeep the loss-size question.`);
    expect(out.added).toBe(0);
  });
  it('other options and model percentages are not classified as this licensed chance', () => {
    const prose = `Keep £49: about 41% chance of meeting your goal. For ‘${NAME}’, the price increases by about 20%.`;
    expect(withScreenLinesOwed(prose, lines()).text).toBe(`${prose}\n\n${EXACT}`);
  });
  it('an option-prefixed numeric price change is preserved as nonchance prose', () => {
    const prose = `‘${NAME}’: about 20% increase in price.`;
    expect(withScreenLinesOwed(prose, lines()).text).toBe(`${prose}\n\n${EXACT}`);
  });
  it('a confirmed plain point retains the existing accepted wording', () => {
    const plainLines = goalChanceScreenLinesForAgent(result(undefined, false), GRAPH, true);
    const bare = `‘${NAME}’: about 62%.`;
    expect(withScreenLinesOwed(bare, plainLines)).toEqual({ text: bare, added: 0 });
  });
  it('existing canonical spread and shortfall units stay byte-for-byte intact', () => {
    const shortfall = `In its worst 1 in 20 runs of this model, ‘${NAME}’ falls short of your target by £2,000 or more.`;
    const chance = `${EXACT} ${SPREAD_NOTE_WITHOUT_DOWNSIDE} ${shortfall}`;
    const l = { ...lines()[0]!, chance, spread_note: SPREAD_NOTE_WITHOUT_DOWNSIDE, shortfall_note: shortfall };
    const prose = `Keep the loss-size question.\n\n${chance}\nOther evidence is unchanged.`;
    expect(withScreenLinesOwed(prose, [l])).toEqual({ text: prose, added: 0 });
  });
  it('a bare point immediately beside its protected notes gains the reading exactly once', () => {
    const shortfall = `In its worst 1 in 20 runs of this model, ‘${NAME}’ falls short of your target by £2,000 or more.`;
    const chance = `${EXACT} ${SPREAD_NOTE_WITHOUT_DOWNSIDE} ${shortfall}`;
    const l = { ...lines()[0]!, chance, spread_note: SPREAD_NOTE_WITHOUT_DOWNSIDE, shortfall_note: shortfall };
    const bare = `‘${NAME}’: about 62% chance of meeting your goal, in this model.`;
    expect(withScreenLinesOwed(`${bare} ${SPREAD_NOTE_WITHOUT_DOWNSIDE} ${shortfall}`, [l]).text).toBe(chance);
  });
});

describe('GR2 labelled reading: subordinate driver chances fail closed', () => {
  const factor: Rec = { quantity_id: 'pro_paying_subscribers', kind: 'factor_value', authored_by: 'olumi',
    factor_id: 'pro_paying_subscribers', side: 'low', cut_value: 200, pct_if_side: 30 };
  const existence: Rec = { quantity_id: 'pro_plan_price->mrr', kind: 'link_existence', authored_by: 'olumi',
    from: 'pro_plan_price', to: 'mrr', side: 'absent', pct_if_side: 30 };
  it.each([factor, existence])('does not say another bare % chance for a labelled reading (%s)', driver => {
    expect(goalChanceDriversForAgent(result(driver), GRAPH)).toHaveLength(1);
    expect(goalChanceDriverDisplayForAgent(result(driver), GRAPH)).toEqual({});
    expect(goalChanceScreenLinesForAgent(result(driver), GRAPH, true)[0]?.depends).toBe('');
  });
  it.each([factor, existence])('a confirmed plain point keeps the existing driver chance (%s)', driver => {
    expect(goalChanceDriverDisplayForAgent(result(driver, false), GRAPH)[OPTION]).toContain('about 30%');
  });
  it('the qualitative strength driver and its existing ask remain available', () => {
    const driver = { quantity_id: 'pro_plan_price->mrr', kind: 'link_strength', authored_by: 'olumi',
      from: 'pro_plan_price', to: 'mrr', side: 'low', strength: 'weaker' };
    expect(goalChanceDriverDisplayForAgent(result(driver), GRAPH)[OPTION]).toBe(
      'It rests most on Olumi’s own estimate of how strongly ‘Pro plan price’ affects ‘MRR’: if that effect is weaker than Olumi assumed, the chance falls. Is that estimate right?');
  });
});

type Api = { withScreenLinesOwed: typeof withScreenLinesOwed; goalChanceDriverDisplayForAgent: typeof goalChanceDriverDisplayForAgent };
type Mutation = 'bare_cleanup_removed' | 'driver_percentage_restored';
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve('tsx'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
};
async function compiled(mutation: Mutation): Promise<Api> {
  const sourceDir = dirname(fileURLToPath(new URL('../goal-chance-screen-lines.ts', import.meta.url)));
  const built = await esbuild.build({
    stdin: { contents: 'export { withScreenLinesOwed } from "./goal-chance-screen-lines.ts"; export { goalChanceDriverDisplayForAgent } from "../goal-target/goal-chance-range-agent.ts";',
      resolveDir: sourceDir, loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent',
    plugins: [{ name: 'in-memory-gr2-egress-mutant', setup(build: {
      onLoad(filter: { filter: RegExp }, load: (args: { path: string }) => { contents: string; loader: 'ts' }): void;
    }) {
      build.onLoad({ filter: /goal-chance-(?:screen-lines|range-agent)\.ts$/ }, args => {
        let contents = readFileSync(args.path, 'utf8');
        const anchor = mutation === 'bare_cleanup_removed' ? 'const cleaned = withReadingChances(text, lines);'
          : "if (labelledReading && d.kind !== 'link_strength') continue;";
        const target = mutation === 'bare_cleanup_removed' ? 'goal-chance-screen-lines.ts' : 'goal-chance-range-agent.ts';
        if (args.path.endsWith(target)) {
          expect(contents.split(anchor)).toHaveLength(2);
          contents = contents.replace(anchor, mutation === 'bare_cleanup_removed' ? 'const cleaned = { text, added: 0 };' : '');
        }
        return { contents, loader: 'ts' };
      });
    } }],
  });
  const module = { exports: {} as Api };
  new Function('require', 'module', 'exports', built.outputFiles[0]!.text)(require, module, module.exports);
  return module.exports;
}

describe('GR2 labelled reading egress mutants: real production source in memory', () => {
  it('bare cleanup removed → canonical final narrative row RED', async () => {
    const mutant = await compiled('bare_cleanup_removed');
    barePointRow();
    expect(() => barePointRow(mutant.withScreenLinesOwed)).toThrow();
    console.info('[MUTANT RED] bare reading cleanup removed');
  });
  it('subordinate percentage restored → labelled driver display row RED', async () => {
    const driver = { quantity_id: 'pro_paying_subscribers', kind: 'factor_value', authored_by: 'olumi',
      factor_id: 'pro_paying_subscribers', side: 'low', cut_value: 200, pct_if_side: 30 };
    expect(goalChanceDriverDisplayForAgent(result(driver), GRAPH)).toEqual({});
    const mutant = await compiled('driver_percentage_restored');
    expect(() => expect(mutant.goalChanceDriverDisplayForAgent(result(driver), GRAPH)).toEqual({})).toThrow();
    console.info('[MUTANT RED] subordinate bare driver percentage restored');
  });
});
