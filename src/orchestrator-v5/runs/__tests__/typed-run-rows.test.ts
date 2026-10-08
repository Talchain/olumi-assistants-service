import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toTypedRunRows } from '../typed-run-rows.js';

type Json = Record<string, any>;
const captured = (path: string): Json => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).j;
const succeeded = captured('../../agent-lane/__tests__/fixtures/cut9-prod-p1-2-7e3f8fb-readback-run1.json');
const secondSucceeded = captured('../../agent-lane/__tests__/fixtures/waveB5-t1b-3fce64f-readback-run1.json');
const withheld = captured('../../agent-lane/method-turn/__tests__/fixtures/w9b/C.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * Real served captures supply every result, option, licence, run ID and timestamp.
 * Readback deliberately omits the persisted input_snapshot. This explicit TEST
 * upgrade supplies a schema-valid sentinel snapshot, not reconstructed historical
 * inputs. The unchanged missing-snapshot case below must quarantine. No capture
 * containing both a full RunAnalysisHandlerFact and its snapshot exists in-tree.
 */
function factFromRead(read: Json, includeTestSnapshot = true): Json {
  const result = read.analysis_result;
  return {
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: read.scenario_id,
      leading_option_id: result.leading_option_id,
      summary: result.summary,
      ...(result.win_probabilities === undefined ? {} : { win_probabilities: clone(result.win_probabilities) }),
      enrichment: clone(result.enrichment),
      computed_at: read.analysis_state.run_state.computed_at,
      graph_hash_at_run: result.computed_against_hash,
      run_id: read.run_recording?.run_id ?? read.current_read.run_id,
      ...(includeTestSnapshot ? { input_snapshot: {
        snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: null,
        options: result.enrichment.option_comparison.map((row: Json) => ({ option_id: row.option_id, settings: [] })),
        options_not_sent: [], factors: [], constraints: [], links: [],
      } } : {}),
    },
  };
}

function mapFact(fact: Json) {
  return toTypedRunRows(fact, { scenarioId: fact.result.scenario_id });
}

describe('toTypedRunRows — one frozen Run, independently quarantined', () => {
  it('maps every captured succeeded option and binds the exact recorded input digest', () => {
    const fact = factFromRead(succeeded);
    const before = clone(fact);
    const mapped = mapFact(fact);
    expect(mapped).toHaveProperty('ok');
    if (!('ok' in mapped)) throw new Error(mapped.quarantine);
    expect(mapped.ok).toMatchObject({
      run_id: fact.result.run_id,
      canonical_request_hash: fact.result.input_snapshot.sent_digest,
      status: 'succeeded', computed_at: fact.result.computed_at,
      graph_identity_hash: null,
      input_snapshot: fact.result.input_snapshot,
    });
    expect(mapped.ok.options).toHaveLength(fact.result.enrichment.option_comparison.length);
    for (const recorded of fact.result.enrichment.option_comparison) {
      const row = mapped.ok.options.find(option => option.option_id === recorded.option_id);
      expect(row).toMatchObject({
        option_id: recorded.option_id,
        chance: recorded.probability_of_goal,
        low: recorded.probability_of_goal_precision.interval_lower,
        high: recorded.probability_of_goal_precision.interval_upper,
        licence_status: 'permitted_with_caveat', withheld_reason: null,
      });
    }
    // A near-tie leader withhold in this capture does not withhold option chances.
    expect(succeeded.analysis_state.leader_claim.permitted).toBe(false);
    expect(mapped.ok.options.every(option => option.chance !== null)).toBe(true);
    expect(mapped.ok.options[0]!.driver).toEqual(
      fact.result.enrichment.inference_warnings.find((warning: Json) => warning.code === 'GOAL_CHANCE_LICENSED')
        .driver_by_option[mapped.ok.options[0]!.option_id],
    );
    expect(fact).toEqual(before);
  });

  it('keeps captured withheld options as rows with NULL chance and the recorded reason', () => {
    const fact = factFromRead(withheld);
    const mapped = mapFact(fact);
    expect(mapped).toHaveProperty('ok');
    if (!('ok' in mapped)) throw new Error(mapped.quarantine);
    expect(mapped.ok.options).toHaveLength(3);
    const option = mapped.ok.options.find(row => row.option_id === 'raise_prices_10')!;
    expect(option).toMatchObject({
      chance: null, low: null, high: null, driver: null,
      licence_status: 'withheld', withheld_reason: 'GOAL_FIGURES_PLACEHOLDER_PATH',
    });
  });

  it.each([
    ['missing run_id', (fact: Json) => { delete fact.result.run_id; }, /run_id/],
    ['non-numeric chance', (fact: Json) => { fact.result.enrichment.option_comparison[0].probability_of_goal = '0.5'; }, /chance|probability_of_goal/],
    ['chance above one', (fact: Json) => { fact.result.enrichment.option_comparison[0].probability_of_goal = 1.1; }, /chance|probability_of_goal/],
    ['invalid precision', (fact: Json) => { fact.result.enrichment.option_comparison[0].probability_of_goal_precision.interval_lower = 2; }, /precision|interval/],
  ] as const)('quarantines %s without throwing', (_name, corrupt, reason) => {
    const fact = factFromRead(succeeded);
    corrupt(fact);
    expect(() => mapFact(fact)).not.toThrow();
    const mapped = mapFact(fact);
    expect(mapped).toHaveProperty('quarantine');
    expect(mapped).not.toHaveProperty('ok');
    if ('quarantine' in mapped) expect(mapped.quarantine).toMatch(reason);
  });

  it('quarantines missing captured inputs instead of recreating them from readback', () => {
    const mapped = mapFact(factFromRead(succeeded, false));
    expect(mapped).toHaveProperty('quarantine');
    if ('quarantine' in mapped) expect(mapped.quarantine).toMatch(/input_snapshot/);
  });

  it('one bad fact among N preserves every other mapped fact', () => {
    const first = factFromRead(succeeded);
    const bad = factFromRead(succeeded);
    delete bad.result.run_id;
    const last = factFromRead(secondSucceeded);
    const mapped = [first, bad, last].map(mapFact);
    expect(mapped.filter(result => 'quarantine' in result)).toHaveLength(1);
    expect(mapped.flatMap(result => 'ok' in result ? [result.ok.run_id] : [])).toEqual([
      first.result.run_id, last.result.run_id,
    ]);
  });

  it('rejects a scenario context mismatch instead of misbinding a valid Run', () => {
    const mapped = toTypedRunRows(factFromRead(succeeded), { scenarioId: withheld.scenario_id });
    expect(mapped).toHaveProperty('quarantine');
    if ('quarantine' in mapped) expect(mapped.quarantine).toMatch(/scenario/);
  });

  it('uses only an explicitly attested graph identity, never the analysis-affecting currentness hash', () => {
    const fact = factFromRead(succeeded);
    const identity = succeeded.graph_identity_hash.value;
    const mapped = toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, graphIdentityHash: identity });
    expect(mapped).toHaveProperty('ok');
    if ('ok' in mapped) {
      expect(mapped.ok.graph_identity_hash).toBe(identity);
      expect(mapped.ok.graph_identity_hash).not.toBe(fact.result.graph_hash_at_run);
    }
  });
});
