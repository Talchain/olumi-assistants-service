/**
 * ⭐ S12 SHORTCUT (Paul 09:15Z 15 Oct: "switch off the host layer… keep only engine numbers, the one numeric egress check, the safe
 * write and authorshipOf"). The 19 host withhold stages in run-analysis no longer delete what the engine returned; each reason
 * travels as a `HOST_CAVEAT` disclosure the AI words. The licence's own guards stay: no chance the engine was not asked for.
 * Served graphs through the REAL handler (loader → gates → PLoT stub answering every option → stages → licence):
 *   · capacity 880b35b4 r2 (14 Oct): "at least 100 tickets per week", sent and verified → the chance is SHOWN (it was hidden by
 *     GOAL_FIGURES_TARGET_NOT_TESTABLE), provisional, with the stage's reason as a caveat;
 *   · hiring r4 turn 09: a change over three months the engine did not score → still no chance (the licence's own guard);
 *   · marketing run-08: the same-cohort law's inputs are missing → still no chance; its limit reasons travel as caveats.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler, HOST_CAVEAT_CODE, setHostLicenceStages } from '../run-analysis.js';
import minimalFixture from '../../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

vi.mock('../../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_c: unknown, _b: unknown, _o: unknown, call: unknown, build: (d: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
const SID = 'e7f95dc6-0000-4000-8000-000000005c10';
const graphIn = (f: string): Rec => { const d = JSON.parse(readFileSync(f, 'utf8')); return d.graph ?? d.body?.graph ?? d; };
const CAPACITY = (): Rec => graphIn('src/orchestrator-v5/agent-lane/__tests__/fixtures/capacity-880b35b4-r2-served-read-20261014.json');
const HIRING = (): Rec => graphIn('src/orchestrator-v5/statement-door/__tests__/fixtures/hiring-negative-r4-turn09.json');
const MARKETING = (): Rec => graphIn('tests/fixtures/marketing-withheld-once/run-08.json');

/** The real Run; PLoT answers each option with `p(i)` as its probability of meeting the goal. */
async function run(stored: Rec, p: (i: number) => number | undefined = (i) => 0.3 + 0.1 * i): Promise<Rec> {
  const plotRun = vi.fn(async (payload: Rec) => ({ ...structuredClone(minimalFixture), inference_warnings: [],
    results: payload.options.map((o: Rec) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: 1 / payload.options.length })),
    option_comparison: payload.options.map((o: Rec, i: number) => ({ option_id: o.id ?? o.option_id, option_label: o.label,
      win_probability: 1 / payload.options.length, ...(p(i) !== undefined ? { probability_of_goal: p(i) } : {}),
      outcome: { p10: 0, p50: 1 + i, p90: 3, mean: 1 + i, std: 1, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })) }));
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as never,
    scenarioReader: () => loadScenarioSnapshotForRunAnalysis(SID, 'req-load', { readMostRecentPendingActions: async () => [],
      loadGraphAndBriefText: async () => ({ graph: structuredClone(stored), briefText: null }), loadGraph: async () => structuredClone(stored) } as never) });
  const out = await handler({ payload: { kind: 'message', scenario_id: SID, turn_id: 't' }, requestId: 'r', signal: new AbortController().signal,
    context: {}, orientationText: '' } as never) as Rec;
  expect(plotRun).toHaveBeenCalledTimes(1);
  return out;
}
/** Every record in the handler's output carrying `key` (the licence and the warnings ride inside the Run's result). */
function recordsWith(x: unknown, key: string, acc: Rec[] = []): Rec[] {
  if (Array.isArray(x)) x.forEach((v) => recordsWith(v, key, acc));
  else if (x !== null && typeof x === 'object') { if (key in (x as Rec)) acc.push(x as Rec); Object.values(x as Rec).forEach((v) => recordsWith(v, key, acc)); }
  return acc;
}
const licence = (out: Rec): Rec | undefined => recordsWith(out, 'pct_by_option').find((r) => r.code === 'GOAL_CHANCE_LICENSED');
const caveats = (out: Rec): Rec[] => recordsWith(out, 'caveat_code').filter((r) => r.code === HOST_CAVEAT_CODE);

afterEach(() => setHostLicenceStages(false));

describe('S12: the engine\'s chance is shown unless the engine was not asked; host stage reasons become caveats', () => {
  it('⭐ RED→GREEN capacity 880: "at least 100 tickets per week" — the engine\'s 30% and 40% are shown, provisional, with the stage\'s reason as a caveat', async () => {
    setHostLicenceStages(true);
    expect(Object.keys(licence(await run(CAPACITY()))?.pct_by_option ?? {}), 'stages on: hidden').toEqual([]);
    setHostLicenceStages(false);
    const out = await run(CAPACITY());
    expect(licence(out)).toMatchObject({ pct_by_option: { keep_current_staffing: 30, add_one_specialist: 40 }, provisional: true,
      target: { comparator: 'at_least', value: 100, unit: 'tickets per week' } });
    const said = caveats(out);
    expect(said.map((c) => c.caveat_code)).toContain('GOAL_FIGURES_TARGET_NOT_TESTABLE');
    for (const c of said) {
      expect(c.severity).toBe('info');
      expect(Object.keys(c).some((k) => /withheld/.test(k)), JSON.stringify(c)).toBe(false);
      expect(c.message).toBeUndefined();
    }
  });

  it('CONTRAST hiring r4: a change over three months the engine did not score → still no chance shown; the reasons travel as caveats', async () => {
    const out = await run(HIRING());
    expect(Object.keys(licence(out)?.pct_by_option ?? {})).toEqual([]);
    expect(caveats(out).length).toBeGreaterThan(0);
  });

  it('CONTRAST marketing run-08: the same-cohort law\'s inputs are missing → still no chance; the limit reasons travel as caveats', async () => {
    const out = await run(MARKETING());
    expect(Object.keys(licence(out)?.pct_by_option ?? {})).toEqual([]);
    expect(caveats(out).map((c) => c.caveat_code)).toContain('GOAL_FIGURES_RETAINED_LIMIT_UNRESOLVED');
  });

  it('EGRESS kept: an option with no probability of meeting the goal (a win share only) or an impossible one shows no chance', async () => {
    const out = await run(CAPACITY(), (i) => (i === 0 ? undefined : 1.4));
    expect(Object.keys(licence(out)?.pct_by_option ?? {})).toEqual([]);
  });
});
