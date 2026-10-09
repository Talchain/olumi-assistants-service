/** All assertions read decoded sentBody, including every continuation request.
 * Uses the storage/graph-read doubles listed in provider-harness.ts; no projection doubles.
 * Server-composed coaching blocks are outside this provider-input contract.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { array, object, expected, findState, keysDeep, meaning, seedOf, valueAt,
  type Turn, type Variant, type Witness } from './provider-harness.js';

const states = (w: Witness) => w.calls.map(c => findState(c.payloads));
const material = (w: Witness) => w.calls.flatMap(c => c.payloads);
const fixtureGoal = object(seedOf('run2').snapshot.graph.nodes.find(n => n.id === expected.goal_id));
const fixtureOptions = seedOf('run2').snapshot.graph.nodes.filter(n => n.kind === 'option');
const horizon = object(array(seedOf('run2').snapshot.analysis_result.enrichment.inference_warnings)
  .find(w => object(w).code === 'GOAL_HORIZON_NOT_TESTED')).message;
const addedRiskLine = "Leaves out Olumi's added risks; may be too high";

export function installRound2Rows(turn: Turn, run: (v: Variant) => Promise<Witness>): void {
  describe(`${turn}: Round 2 claim classes and MEANING`, () => {
    let unavailable: Witness;
    beforeAll(async () => {
      // CEE admits this combination: plot-client.ts:80–103,:891–960 passes raw fields;
      // run-analysis.ts:1944 shadow-validates without enforcement, :3067 persists them.
      // PLoT's emitter is not in this tree; current run2 has [] with unavailable.
      // Ingest admission alone does not show the current producer creates this state.
      // Setup and both controls are outside it.fails so an unrelated throw cannot pass it.
      unavailable = await run('flip-unavailable');
      for (const state of states(unavailable)) {
        expect(object(object(state.analysis).tipping_point)).toMatchObject({
          status: 'found', factor_id: 'monthly_pro_churn', current_value: 3, threshold: 4.2,
        });
      }
      const noPair = await run('flip-no-pair');
      expect(valueAt(material(noPair), 'tipping_point').filter(p => object(p).status === 'found')).toEqual([]);
      expect(valueAt(material(noPair), 'threshold_display')).toEqual([]);
      for (const state of states(await run('current'))) {
        expect(object(object(state.analysis).tipping_point)).toMatchObject({
          status: 'found', factor_id: 'monthly_pro_churn', current_value: 3, threshold: 4.2,
        });
      }
    }, 60_000);
    it.fails('GAP(defence-in-depth, adversarial state): R2 C1 flip requires an available status AND a real pair (two directions)', () => {
      expect(valueAt(material(unavailable), 'tipping_point').filter(p => object(p).status === 'found')).toEqual([]);
      expect(valueAt(material(unavailable), 'threshold_display')).toEqual([]);
    });
    it('R2 C2 per-option chance uses only its licensed figure (two directions)', async () => {
      for (const state of states(await run('withheld'))) {
        const analysis = object(state.analysis);
        expect(object(analysis.goal_chance_display)).not.toHaveProperty(expected.option_id);
        expect(array(analysis.saved_run_options).map(object).find(o => o.option_id === expected.option_id))
          .not.toHaveProperty('probability_of_goal');
      }
      for (const state of states(await run('run2'))) {
        const analysis = object(state.analysis);
        expect(object(analysis.goal_chance_licence).goal_node_id).toBe(expected.goal_id);
        expect(object(analysis.goal_chance_display)[expected.option_id]).toBe(expected.chance_display);
      }
    }, 60_000);
    it('R2 C3 horizon wording requires its verdict (two directions)', async () => {
      const negative = await run('horizon-absent');
      expect(valueAt(material(negative), 'goal_horizon_line')).toEqual([]);
      expect(JSON.stringify(material(negative))).not.toContain(horizon);
      for (const state of states(await run('run2'))) {
        expect(object(state.analysis).goal_horizon_line).toBe(horizon);
      }
    }, 60_000);
    it('R2 C4 added-risk caveat: carrier census beside shown/withheld chance', async () => {
      // Positive chance exists, but this marker is composed for the screen, not sent as a provider fact.
      // This witnesses the limitation; it is NOT a positive control for the caveat claim class.
      const positive = await run('run2'), negative = await run('withheld');
      expect(object(object(positive.state.analysis).goal_chance_display)[expected.option_id]).toBe(expected.chance_display);
      expect(object(object(negative.state.analysis).goal_chance_display)).not.toHaveProperty(expected.option_id);
      for (const w of [positive, negative]) expect(JSON.stringify(material(w))).not.toContain(addedRiskLine);
    }, 60_000);
    it('R2 C5 leader licence and raw leader-prose carrier census (positive prose NOT COVERED)', async () => {
      const negative = await run('leader-withheld');
      for (const state of states(negative)) {
        const analysis = object(state.analysis);
        expect(object(analysis.claim_permissions).leader_may_be_named).toBe(false);
      }
      for (const state of states(await run('run2'))) {
        const analysis = object(state.analysis);
        expect(object(analysis.claim_permissions).leader_may_be_named).toBe(true);
      }
      // The typed aggregate robustness STATE is not decision_brief robustness PROSE.
      // Raw producer leader prose/win shares never reach this door, even when licensed.
      // Positive permission is evidenced; positive prose is NOT COVERED (no carrier).
      for (const w of [negative, await run('run2')]) {
        const keys = keysDeep(material(w));
        for (const key of ['headline', 'headline_banded', 'analysis_summary', 'win_probability']) expect(keys).not.toContain(key);
      }
    }, 60_000);
    it('R2 C6 main driver uses goal_chance_driver_display, never raw driver fields (two directions)', async () => {
      const negative = await run('unlicensed-driver');
      expect(JSON.stringify(material(negative))).not.toContain(expected.driver_sentence);
      for (const w of [negative, await run('run2')]) {
        for (const key of ['dominant_factor', 'driver_by_option']) expect(keysDeep(material(w))).not.toContain(key);
      }
      for (const state of states(await run('run2'))) {
        expect(object(object(state.analysis).goal_chance_driver_display)[expected.option_id]).toBe(expected.driver_sentence);
      }
    }, 60_000);
    it('MEANING goal label + target + comparator and every option id + label match run2', async () => {
      for (const state of states(await run('meaning'))) {
        const goal = object(state.goal);
        expect(goal.id).toBe(fixtureGoal.id);
        expect(goal.label).toBe(fixtureGoal.label);
        expect(object(goal.target)).toMatchObject({ value: fixtureGoal.goal_threshold_raw,
          unit: fixtureGoal.goal_threshold_unit, comparator: fixtureGoal.goal_direction });
        for (const option of fixtureOptions) {
          const matches = array(state.entities).map(object).filter(e => e.id === option.id);
          expect(matches).toHaveLength(1);
          expect(matches[0]?.label).toBe(option.label);
        }
      }
    }, 60_000);
    it('MEANING selected Run state matches complete_current at the exact fixture reference', async () => {
      for (const state of states(await run('meaning'))) {
        const analysis = object(state.analysis);
        expect(analysis.selected_run_reference).toBe(seedOf('run2').captured_run_reference);
        expect(object(analysis.run_state).kind).toBe('complete_current');
      }
    }, 60_000);
    it('MEANING retained open question/offer and qualitative disagreement match exact fixture values', async () => {
      for (const state of states(await run('meaning'))) {
        const pending = array(state.awaiting_your_approval).map(object).filter(p => p.proposal_id === meaning.question_id);
        expect(pending).toHaveLength(1);
        expect(pending[0]?.public_label).toBe(meaning.question);
        const reasoning = array(state.entities).map(object).filter(e => e.id === meaning.reasoning_id);
        expect(reasoning).toHaveLength(1);
        expect(reasoning[0]?.full_label).toBe(meaning.reasoning);
      }
    }, 60_000);
  });
}
