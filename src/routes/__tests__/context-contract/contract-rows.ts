import { describe, it, expect } from 'vitest';
import { capture, expected, findState, object, array, keysDeep, valueAt, type Turn, type Variant, type Witness, type Obj } from './provider-harness.js';

const rawKeys = ['analysis_result', 'enrichment', 'pct_by_option', 'driver_by_option', 'flip_thresholds', 'warnings', 'inference_warnings'];
const rowById = (rows: unknown, id: string): Obj | undefined => array(rows).map(object).find(r => r.option_id === id);
const analysisOf = (w: Witness): Obj => object(w.state.analysis);
const factsOf = (w: Witness): Obj => 'result' in w.state ? object(w.state.result) : analysisOf(w);
const licenceOf = (w: Witness): Obj => object(factsOf(w).goal_chance_licence);
const optionsOf = (w: Witness): unknown => 'result' in w.state
  ? object(object(w.state.result).enrichment).option_comparison : analysisOf(w).saved_run_options;
const payloads = (w: Witness): unknown[] => w.calls.flatMap(c => c.payloads);

export function installContract(turn: Turn): void {
  const memo = new Map<Variant, Promise<Witness>>();
  const run = (v: Variant): Promise<Witness> => {
    let p = memo.get(v);
    if (!p) { p = capture(turn, v); memo.set(v, p); }
    return p;
  };
  describe(`${turn}: exact serialized provider contract`, () => {
    for (const name of ['run1', 'run2'] as const) {
      it(`R1 ${name}: selected Run reference, hash and goal exactly match`, async () => {
        const captured = await run(name);
        for (const call of captured.calls) {
        const w = { ...captured, state: findState(call.payloads), calls: [call] }, f = factsOf(w);
        expect(f.selected_run_reference ?? w.state.selected_run_reference).toBe(w.seed.captured_run_reference);
        const references = valueAt(call.payloads, 'selected_run_reference');
        expect(references.length).toBeGreaterThan(0);
        expect(references).toEqual(references.map(() => w.seed.captured_run_reference));
        if ('result' in w.state) expect(object(w.state.result).computed_against_hash).toBe(w.seed.revision);
        else expect(w.state.graph_revision).toBe(w.seed.revision);
        if ('result' in w.state) {
          // run1 has no goal-chance licence; its selected goal binding is a separate GAP below.
          if (name === 'run2') expect(licenceOf(w).goal_node_id).toBe(expected.goal_id);
        } else expect(object(w.state.goal).id).toBe(expected.goal_id);
        }
      }, 60000);
      it.fails(`GAP: R1 ${name} execution Run id carried as selected identity`, async () => {
        const w = await run(name);
        // Exact selected fixture execution ID. A delta/prior/history id cannot satisfy it.
        expect(factsOf(w).selected_run_id).toBe(w.seed.captured_execution_run_id);
      }, 60000);
      it.fails(`GAP: R1 ${name} numeric scenario revision carried with selected Run`, async () => {
        const w = await run(name);
        expect(w.state.scenario_revision).toBe(expected.synthetic_scenario_revision);
        expect(factsOf(w).selected_run_revision).toBe(expected.synthetic_run_revision);
      }, 60000);
    }
    if (turn === 'Run-explanation') it.fails('GAP: R1 run1 selected goal identity absent without a chance licence', async () => {
      const w = await run('run1');
      expect(factsOf(w).goal_id).toBe(expected.goal_id);
    }, 60000);

    const withheldRow = it;
    withheldRow(`${turn === 'Run-explanation' ? 'GAP: ' : ''}R2 withheld option has no chance, percent or driver in provider facts`, async () => {
      const w = await run('withheld'), f = factsOf(w);
      expect(array(optionsOf(w)).map(object).filter(r => r.option_id === expected.option_id)).toHaveLength(1);
      expect(rowById(optionsOf(w), expected.option_id), 'bound option survives by its exact id').toBeDefined();
      expect(rowById(optionsOf(w), expected.option_id)).not.toHaveProperty('probability_of_goal');
      expect(object(f.goal_chance_display)).not.toHaveProperty(expected.option_id);
      expect(object(f.goal_chance_driver_display)).not.toHaveProperty(expected.option_id);
      // Look through every decoded provider carrier, not just the friendly display object.
      for (const map of valueAt(payloads(w), 'pct_by_option')) expect(object(map)).not.toHaveProperty(expected.option_id);
    }, 60000);
    it('R2 licensed contrast contains the exact selected option chance and driver', async () => {
      const captured = await run('run2');
      for (const call of captured.calls) {
      const w = { ...captured, state: findState(call.payloads), calls: [call] }, f = factsOf(w);
      expect(licenceOf(w).goal_node_id).toBe(expected.goal_id);
      expect(array(optionsOf(w)).map(object).filter(r => r.option_id === expected.option_id)).toHaveLength(1);
      expect(rowById(optionsOf(w), expected.option_id)?.probability_of_goal).toBe(expected.probability);
      expect(object(f.goal_chance_display)[expected.option_id]).toBe(expected.chance_display);
      expect(object(f.goal_chance_driver_display)[expected.option_id]).toBe(expected.driver_sentence);
      }
    }, 60000);
    it('R2 unlicensed raw resolved driver has no licensed driver sentence', async () => {
      const w = await run('unlicensed-driver');
      expect(object(factsOf(w).goal_chance_driver_display)).not.toHaveProperty(expected.option_id);
      expect(valueAt(payloads(w), 'goal_chance_driver_display').map(v => object(v)[expected.option_id])).not.toContain(expected.driver_sentence);
    }, 60000);
    const rawRow = it;
    rawRow(`${turn === 'Run-explanation' ? 'GAP: ' : ''}R3 raw analysis and enrichment maps absent from decoded provider body`, async () => {
      const w = await run('raw-probe');
      const keys = keysDeep([...payloads(w), ...w.calls.map(c => c.body)]);
      for (const key of rawKeys) expect(keys, key).not.toContain(key);
      expect(valueAt(payloads(w), 'type')).not.toContain('analysis_result');
      expect(JSON.stringify(payloads(w))).not.toContain('CONTRACT_RAW_');
    }, 60000);
    it('R3 STALE older Run chance, driver and tipping claims absent', async () => {
      const w = await run('stale');
      if (turn === 'Run-explanation') {
        // An obsolete Explain id is terminal: no provider body exists. This is explicitly a
        // no-provider witness, not an empty body substituted for a missing capture.
        expect(w.calls).toHaveLength(0);
        expect(object(w.response.narration).status).toBe('stale');
        return;
      }
      expect(w.state.graph_revision).toBe(w.seed.snapshot.graph_hash);
      expect(object(analysisOf(w).run_state).kind ?? analysisOf(w).earlier_analysis).toBe('complete_stale');
      const f = factsOf(w);
      expect(rowById(optionsOf(w), expected.option_id)).toBeUndefined();
      expect(object(f.goal_chance_display)).not.toHaveProperty(expected.option_id);
      expect(object(f.goal_chance_driver_display)).not.toHaveProperty(expected.option_id);
      expect(f.tipping_point).toBeUndefined();
      expect(valueAt(payloads(w), 'probability_of_goal')).toEqual([]);
      expect(valueAt(payloads(w), 'goal_chance_driver_display')).toEqual([]);
      expect(valueAt(payloads(w), 'tipping_point')).toEqual([]);
    }, 60000);
    it('R3 current-revision contrast contains exact chance, driver and tipping finding', async () => {
      const captured = await run('current');
      for (const call of captured.calls) {
      const w = { ...captured, state: findState(call.payloads), calls: [call] }, f = factsOf(w);
      expect(object(f.goal_chance_display)[expected.option_id]).toBe(expected.chance_display);
      expect(object(f.goal_chance_driver_display)[expected.option_id]).toBe(expected.driver_sentence);
      expect(object(f.tipping_point)).toMatchObject({ status: 'found', factor_id: 'monthly_pro_churn', current_value: 3, threshold: 4.2 });
      expect(f.tipping_point_run_key ?? w.state.tipping_point_run_key).toBe(w.seed.captured_run_reference);
      }
    }, 60000);
  });
}
