/** W3 Round 2: exact served T1b wire, 6 Oct 19:20Z, CEE 7ab6c1af, scenario f440be4a.
 * Fixture is byte-for-byte turn-003-run-1791314451857.json. Controls are explicit derivatives, not served witnesses.
 * Offline contract tests only: no provider, no new Run and no claim of journey acceptance.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysisResultForAgent } from '../decision-sensitivity.js';
import { goalChanceDisplayForAgent, goalChanceDriverAvailabilityForAgent } from '../../goal-target/goal-chance-licence.js';
import { savedRunContextFacts } from '../saved-run-context-facts.js';
import { modelFacingToolResult } from '../licensed-run-view.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { GOAL_CHANCE_RANKING_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION } from '../../../routes/agent-v1-turn.js';
import { GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../goal-chance-withheld.js';

type Json = Record<string, any>;
const WIRE = JSON.parse(readFileSync(new URL('./fixtures/served-w3-f440be4a-t1b-7ab6c1af.json', import.meta.url), 'utf8')) as Json;
const SID = 'f440be4a-7fd6-4454-bff6-67247b819782';
const RAISE = 'raise_prices_by_10';
const STARTER = 'launch_starter_tier';
const KEEP = 'keep_pricing_as_it_is';
const BLOCK = WIRE.blocks.find((b: Json) => b.type === 'analysis_result') as Json;
const copy = (): Json => structuredClone(BLOCK);
const licence = (b: Json): Json => b.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED') as Json;
const project = (b = copy()): Json => analysisResultForAgent(b) as Json;
const DISPLAY = { [RAISE]: 'about 46%', [STARTER]: 'about 52%', [KEEP]: 'less than 1%' };
const AVAILABILITY = {
  scope: 'per_option_goal_chance', source: 'GOAL_CHANCE_LICENSED', status: 'available', options: [
    { option_id: RAISE, status: 'available' }, { option_id: STARTER, status: 'available' },
    { option_id: KEEP, status: 'none_licensed', reason: 'none' },
  ],
};
const read = (b = copy(), kind = 'complete_current'): Json => ({
  graph: WIRE.draft_graph, graph_hash: WIRE.graph_hash, analysis_result: b,
  analysis_state: { ...WIRE.analysis_state, run_state: { ...WIRE.analysis_state.run_state, kind } },
  analysis_admission: WIRE.analysis_ready.analysis_admission,
  analysis_goal_certainty: WIRE.goal_certainty?.options,
});
async function canonical(r: Json): Promise<Json> {
  const dispatch: InternalDispatch = async (path) => path.endsWith('/graph') ? { status: 200, json: r } : { status: 500, json: {} };
  return createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({ scenario_id: SID, authenticated_user_id: null, request_id: 'w3-round2' }) as Promise<Json>;
}
const selected = (b = copy(), kind = 'complete_current'): Json => {
  const r = read(b, kind);
  return savedRunContextFacts(SID, { graph_hash: r.graph_hash, analysis_state: r.analysis_state, analysis_result: b }, { leader_may_be_named: false });
};

// These oracles also reject independent, narrowly targeted mutants without executing an LLM.
const screenChanceMatches = (out: Json): boolean => JSON.stringify(out.goal_chance_display) === JSON.stringify(DISPLAY);
const scopesReconciled = (out: Json): boolean => out.decision_sensitivity?.status === 'none_measurable'
  && JSON.stringify(out.goal_chance_driver_availability) === JSON.stringify(AVAILABILITY);

describe('W3 witnessed wire contradictions are reconciled by separate typed authorities', () => {
  it('fixture control: the same Run carries the two contradictions and the exact authority fields', () => {
    expect(WIRE.assistant_text).toContain('Keep pricing as it is reaches it in 0% of model runs');
    expect(WIRE.assistant_text).toContain('No most-sensitive assumption was measurable.');
    expect(WIRE.analysis_state.leader_claim).toMatchObject({ permitted: false, separation: 'near_tie' });
    expect(BLOCK.enrichment.option_comparison.map((o: Json) => o.probability_of_goal)).toEqual([0.4643, 0.5192, 0]);
    expect(licence(BLOCK).pct_by_option).toEqual({ [RAISE]: 46, [STARTER]: 52, [KEEP]: 0 });
    expect(licence(BLOCK).driver_by_option[RAISE]).toMatchObject({ kind: 'link_strength', authored_by: 'user', strength: 'weaker' });
    expect(BLOCK.enrichment.factor_evppi).toEqual([expect.objectContaining({ status: 'below_resolution', factor_id: 'customers_lost_from_price_rise' })]);
  });

  it('RED at base: whole-step zero is the screen’s less-than wording, with 46/52 preserved in producer order', () => {
    const before = JSON.stringify(BLOCK);
    const out = project(BLOCK);
    expect(out.goal_chance_display).toEqual(DISPLAY);
    expect(screenChanceMatches(out)).toBe(true);
    expect(Object.keys(out.goal_chance_display)).toEqual([RAISE, STARTER, KEEP]);
    expect(out.enrichment.option_comparison.map((r: Json) => r.probability_of_goal)).toEqual([0.4643, 0.5192, 0]);
    expect(JSON.stringify(BLOCK)).toBe(before);
  });

  it('RED at base: below-resolution EVPPI cannot erase the two licensed per-option goal-chance drivers', () => {
    const out = project();
    expect(out.decision_sensitivity).toEqual({ status: 'none_measurable' });
    expect(out.goal_chance_driver_availability).toEqual(AVAILABILITY);
    expect(scopesReconciled(out)).toBe(true);
    expect(JSON.stringify(out.goal_chance_driver_availability)).not.toMatch(/quantity_id|authored_by|most_sensitive|price_increase_from_current/);
    expect(licence(out)).not.toHaveProperty('driver_by_option');
    expect(licence(out)).not.toHaveProperty('no_driver_by_option');
    expect(out.enrichment.option_comparison.some((r: Json) => 'probability_of_goal_drivers' in r)).toBe(false);
  });

  it('both warning carriers keep the standing removal of raw driver claims', () => {
    const b = copy();
    // Kept-Run carrier control: move, do not duplicate the single licence.
    b.inference_warnings = [licence(b)];
    b.enrichment.inference_warnings = b.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_LICENSED');
    const out = project(b);
    expect(out.goal_chance_display).toEqual(DISPLAY);
    expect(out.goal_chance_driver_availability).toEqual(AVAILABILITY);
    expect(out.inference_warnings[0]).not.toHaveProperty('driver_by_option');
    expect(out.inference_warnings[0]).not.toHaveProperty('no_driver_by_option');
  });

  it('RED at base: facts survive the actual withheld Run model filter and selected current Explain context', async () => {
    const out = modelFacingToolResult('run_analysis', { result: project(), claim_permissions: { leader_may_be_named: false } }) as Json;
    expect(out.result.goal_chance_display).toEqual(DISPLAY);
    expect(out.result.goal_chance_driver_availability).toEqual(AVAILABILITY);
    expect(out.result.leading_option_id).toBeNull();
    expect(selected().goal_chance_driver_availability).toEqual(AVAILABILITY);
    const state = await canonical(read());
    expect(state.analysis.goal_chance_driver_availability).toEqual(AVAILABILITY);
    // C1 (Science 393023, PR-S2) supersedes W3's leader guard on a LICENSED Run: a withheld leader keeps each licensed
    // chance and its display licence, as the screen shows them. An exact 0 still travels only through goal_certainty.
    const chances = Object.fromEntries(state.analysis.saved_run_options
      .filter((o: Json) => 'probability_of_goal' in o).map((o: Json) => [o.option_id, o.probability_of_goal]));
    expect(chances).toEqual({ [RAISE]: 0.4643, [STARTER]: 0.5192 });
    expect(state.analysis.goal_chance_display).toEqual(DISPLAY);
    expect(state.analysis.goal_chance_licence).toEqual(out.result.goal_chance_licence);
  });

  it('permitted saved-context control: the same selected licence supplies display text beside its admitted facts', async () => {
    const r = read();
    r.analysis_state.leader_claim = { permitted: true };
    r.analysis_admission = { ...r.analysis_admission, permitted_analysis_mode: 'comparative_leader' };
    const state = await canonical(r);
    expect(state.analysis.goal_chance_display).toEqual(DISPLAY);
    expect(state.analysis.saved_run_options.find((o: Json) => o.option_id === KEEP)).not.toHaveProperty('probability_of_goal');
  });
});

describe('W3 controls: no scope promotion, no withheld/stale fact revival', () => {
  it('no licensed driver for any option + below-resolution EVPPI: absence is limited to goal-driver licensing', () => {
    const b = copy();
    delete licence(b).driver_by_option;
    licence(b).no_driver_by_option = { [RAISE]: 'below_resolution', [STARTER]: 'none', [KEEP]: 'none' };
    const out = project(b);
    expect(out.decision_sensitivity).toEqual({ status: 'none_measurable' });
    expect(out.goal_chance_driver_availability).toMatchObject({ status: 'none_licensed', scope: 'per_option_goal_chance' });
    expect(out.goal_chance_driver_availability.options[0]).toEqual({ option_id: RAISE, status: 'none_licensed', reason: 'below_resolution' });
  });

  it('no EVPPI: goal drivers stay available; the comparison was not measured', () => {
    const b = copy();
    delete b.enrichment.factor_evppi;
    expect(project(b).decision_sensitivity).toEqual({ status: 'not_measured' });
    expect(project(b).goal_chance_driver_availability).toEqual(AVAILABILITY);
  });

  it('neither goal-driver claims nor EVPPI: missing is not a measured absence', () => {
    const b = copy();
    delete b.enrichment.factor_evppi;
    delete licence(b).driver_by_option;
    delete licence(b).no_driver_by_option;
    expect(project(b).decision_sensitivity).toEqual({ status: 'not_measured' });
    expect(project(b).goal_chance_driver_availability.status).toBe('not_recorded');
  });

  it('measured EVPPI + goal drivers: only EVPPI selects the decision-sensitive factor', () => {
    const b = copy();
    b.enrichment.factor_evppi[0] = { ...b.enrichment.factor_evppi[0], status: 'resolved', evppi: 0.04 };
    expect(project(b).decision_sensitivity).toMatchObject({ status: 'measured', most_sensitive: { factor_id: 'customers_lost_from_price_rise' } });
    expect(project(b).goal_chance_driver_availability).toEqual(AVAILABILITY);
  });

  it('no licence or duplicate/malformed licence: no display or availability invented from raw companion rows', () => {
    const absent = copy();
    absent.enrichment.inference_warnings = absent.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_LICENSED');
    const duplicate = copy(); duplicate.inference_warnings = [licence(duplicate)];
    const malformed = copy(); licence(malformed).leader_option_id = RAISE;
    for (const b of [absent, duplicate, malformed]) {
      expect(goalChanceDisplayForAgent(b)).toBeUndefined();
      expect(goalChanceDriverAvailabilityForAgent(b)).toBeUndefined();
      expect(project(b)).not.toHaveProperty('goal_chance_driver_availability');
    }
  });

  it('conflicting/malformed driver claims: unknown, never available or absent', () => {
    const b = copy();
    licence(b).no_driver_by_option[RAISE] = 'none';
    licence(b).driver_by_option[STARTER].strength = 'invalid';
    const out = project(b).goal_chance_driver_availability;
    expect(out.status).toBe('not_recorded');
    expect(out.options.slice(0, 2).map((o: Json) => o.status)).toEqual(['not_recorded', 'not_recorded']);
  });

  it('an option withheld for its own path has no display or availability claim even if stale licence fields remain', () => {
    const b = copy(); licence(b).withheld_option_ids = [RAISE];
    expect(goalChanceDisplayForAgent(b)).not.toHaveProperty(RAISE);
    expect(goalChanceDriverAvailabilityForAgent(b)?.options.map((o) => o.option_id)).toEqual([STARTER, KEEP]);
  });

  it('run-wide goal figures withheld: no display/driver projection revives them', () => {
    const b = copy();
    b.enrichment.inference_warnings.push({ code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, message: 'Not shown.', node_ids: ['monthly_recurring_revenue'] });
    expect(project(b)).not.toHaveProperty('goal_chance_display');
    expect(project(b)).not.toHaveProperty('goal_chance_driver_availability');
    expect(project(b).enrichment.option_comparison.some((o: Json) => 'probability_of_goal' in o)).toBe(false);
  });

  it('stale canonical and Explain context cannot borrow either new fact', async () => {
    expect(selected(copy(), 'complete_stale')).toEqual({});
    const state = await canonical(read(copy(), 'complete_stale'));
    expect(state.analysis).not.toHaveProperty('goal_chance_display');
    expect(state.analysis).not.toHaveProperty('goal_chance_driver_availability');
  });

  it('display controls: whole upper edge, nearest-five interior, withheld and invalid percentages', () => {
    const b = copy();
    licence(b).pct_by_option = { [RAISE]: 100, [STARTER]: 45, [KEEP]: NaN };
    licence(b).display_rounding_by_option[STARTER] = 'nearest_5';
    expect(goalChanceDisplayForAgent(b)).toEqual({ [RAISE]: 'more than 99%', [STARTER]: 'about 45%' });
  });
});

describe('W3 instruction and discriminating mutants', () => {
  it('RED at base: headline uses licensed chance display, and both measurement scopes are explicit', () => {
    expect(HOST_TOOL_CONTRACT).toContain('the per-option headline is its chance of meeting the goal, in this model, on current information');
    expect(HOST_TOOL_CONTRACT).toContain('quote an allowed chance using goal_chance_display for that option exactly');
    expect(HOST_TOOL_CONTRACT).toContain('never express the chance as a percentage of model runs');
    expect(HOST_TOOL_CONTRACT).not.toContain('reaches the target in about N% of model runs');
    expect(HOST_TOOL_CONTRACT).toContain('decision_sensitivity is EVPPI-only sensitivity of the option comparison');
    expect(HOST_TOOL_CONTRACT).toContain('Never translate either EVPPI status into no measurable assumption or no measurable goal-chance driver');
    expect(HOST_TOOL_CONTRACT).toContain('This availability grants no permission to name or rank a driver or an option');
  });

  it('no-contest and certainty controls stay pinned', () => {
    expect(HOST_TOOL_CONTRACT).toContain('Never call an option the winner, the best option or the recommended one.');
    expect(HOST_TOOL_CONTRACT).toContain('is ahead, or wins in any share of runs');
    expect(HOST_TOOL_CONTRACT).toContain('earned: false permits its exact say sentence, never an inferred 0 or 1');
    expect(MODEL_RELATIVE_NAMING_INSTRUCTION).toContain('Never write recommend or recommendation in any form, not even to deny it.');
    expect(GOAL_CHANCE_RANKING_INSTRUCTION).toContain('never rank, order or single');
  });

  it('mutant: restore numeric-zero narration while preserving the two interior displays', () => {
    const out = project();
    const mutant = { ...out, goal_chance_display: { ...out.goal_chance_display, [KEEP]: '0% of model runs' } };
    expect(screenChanceMatches(out)).toBe(true);
    expect(screenChanceMatches(mutant)).toBe(false);
  });

  it('mutant: strip reconciliation while preserving EVPPI-only decision sensitivity and all chance displays', () => {
    const out = project();
    const { goal_chance_driver_availability: _removed, ...mutant } = out;
    expect(scopesReconciled(out)).toBe(true);
    expect(scopesReconciled(mutant)).toBe(false);
    expect(screenChanceMatches(mutant)).toBe(true);
  });
});
