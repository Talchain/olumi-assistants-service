/**
 * S2i (DL GO, 7 Oct): no absence status is handed to the Agent beside a screen that shows a driver, a range or robustness.
 *
 * Bound to SERVED Runs, keys untouched: Waves B1–B7 and W3 (14 Runs, staging, guest) and cut 9 PRODUCTION (2 Runs, guest).
 * Before S2i the projection handed every one of them `decision_sensitivity: not_measured | none_measurable` and
 * `tipping_point: not_evaluated`, and each wave served a new wording of "nothing established which assumption matters
 * most / sensitivity was not measured" beside a screen that names one. Derivatives written by the author are labelled.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysisResultForAgent, decisionSensitivityOf, tippingPointOf } from '../decision-sensitivity.js';
import { goalChanceDriverAvailabilityForAgent } from '../../goal-target/goal-chance-licence.js';
import { robustnessComputed } from '../goal-chance-driver-egress.js';
import { savedRunContextFacts } from '../saved-run-context-facts.js';

type Json = Record<string, any>;
const fixture = (name: string): Json => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Json;
const blockOf = (body: Json): Json => body.blocks.find((b: Json) => b?.type === 'analysis_result');
const clone = <T>(v: T): T => structuredClone(v);
const project = (block: Json, graph?: unknown, current = true, screenGraph?: unknown): Json =>
  analysisResultForAgent(block, graph, current, screenGraph) as Json;
// Author's derivatives.
const noRobustness = (block: Json): Json => { const b = clone(block); delete b.enrichment.robustness; delete b.robustness; return b; };
const noRange = (block: Json): Json => {
  const b = clone(block);
  b.enrichment.inference_warnings = b.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE');
  return b;
};
const licence = (b: Json): Json => b.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
const absenceHanded = (out: Json): boolean => 'decision_sensitivity' in out || out.tipping_point?.status === 'not_evaluated';

// What the screen showed on each served Run (driver / range / robustness), read from the same facts the UI draws.
const SERVED: readonly (readonly [string, 'driver' | 'range', boolean])[] = [
  ['waveB-unseen1-b568cc9-run1-turn003.json', 'range', false],
  ['waveB2-unseen2-044faef-run1-turn003.json', 'range', true],
  ['waveB3-t1b-7addf05-run1-turn003.json', 'driver', true],
  ['waveB4-unseen1-01a2b27-run1-turn003.json', 'range', false],
  ['waveB4-unseen2-01a2b27-run1-turn003.json', 'range', true],
  ['waveB5-t1b-3fce64f-run1-turn003.json', 'driver', true],
  ['waveB5-unseen2-5a260e3-challenge-turn001.json', 'range', false],
  ['waveB6-unseen2-4ce3583-challenge-turn001.json', 'range', true],
  ['waveB6-unseen2-4ce3583-explain-turn003.json', 'range', true],
  ['waveB7-unseen1-7e3f8fb-challenge-turn001.json', 'range', false],
  ['waveB7-unseen2-7e3f8fb-explain-turn003.json', 'range', true],
  ['waveB7-t1b-7e3f8fb-explain-turn003.json', 'driver', true],
  ['served-w3-f440be4a-t1b-7ab6c1af.json', 'driver', true],
  // Cut 9 PRODUCTION (7 Oct, CEE 7e3f8fb live): the Challenge that said "…does not establish a single most consequential change".
  ['cut9-prod-p1-1-7e3f8fb-challenge-turn004.json', 'driver', true],
];

describe('S2i: served Runs whose screen shows a driver or a range hand the Agent no absence status', () => {
  it.each(SERVED)('RED at base: %s (%s; robustness %s)', (name, shows, robust) => {
    const body = fixture(name);
    const block = blockOf(body);
    const before = JSON.stringify(block);
    // PRECONDITION: the producers still say absence, so base handed it.
    expect(decisionSensitivityOf(block.enrichment).status).toMatch(/^(not_measured|none_measurable)$/u);
    expect(tippingPointOf(block.enrichment, undefined)).toEqual({ status: 'not_evaluated' });
    expect(robustnessComputed(block)).toBe(robust);
    const out = project(block, body.draft_graph);
    expect(Object.keys(out[shows === 'driver' ? 'goal_chance_driver_display' : 'goal_chance_range_display']).length).toBeGreaterThan(0);
    expect(out).not.toHaveProperty('decision_sensitivity');
    expect(out).not.toHaveProperty('tipping_point');
    expect(out.enrichment).not.toHaveProperty('factor_evppi');
    // Not gated: driver availability is scoped to the options with a point chance (unchanged from the producer).
    const availability = goalChanceDriverAvailabilityForAgent(block);
    if (availability !== undefined) expect(out.goal_chance_driver_availability.status).toBe('available');
    expect(JSON.stringify(block)).toBe(before);
  });

  it('served g1b d4 re-run: robustness alone (no driver, no range) is enough', () => {
    const body = fixture('served-g1b-d4-rerun-5f8f24ce.json');
    const block = blockOf(body);
    expect(robustnessComputed(block)).toBe(true);
    const out = project(block, body.draft_graph);
    expect(out).not.toHaveProperty('goal_chance_driver_display');
    expect(out).not.toHaveProperty('goal_chance_range_display');
    expect(absenceHanded(out)).toBe(false);
    // CONTROL (author: its robustness check removed): the screen shows nothing, so both statuses are handed.
    expect(project(noRobustness(block), body.draft_graph)).toMatchObject({ decision_sensitivity: { status: 'not_measured' }, tipping_point: { status: 'not_evaluated' } });
  });
});

describe('S2i: the Run behind the cut 9 PRODUCTION Explain ("Which assumption matters most to the comparison has not been measured.")', () => {
  it('RED at base: its readback, as the Explain caller projects it (screen labels only), hands no absence status', () => {
    const read = fixture('cut9-prod-p1-2-7e3f8fb-readback-run1.json').j as Json;
    expect(read.analysis_state.run_state.kind).toBe('complete_current');
    expect(decisionSensitivityOf(read.analysis_result.enrichment).status).toMatch(/^(not_measured|none_measurable)$/u);
    expect(tippingPointOf(read.analysis_result.enrichment, undefined)).toEqual({ status: 'not_evaluated' });
    expect(absenceHanded(project(read.analysis_result, undefined, true, read.graph))).toBe(false);
    expect(absenceHanded(project(read.analysis_result, read.graph))).toBe(false);
  });
});

describe('S2i: each limb alone, with a control the screen shows nothing on', () => {
  it('range alone (served B4 unseen 1, no robustness) → gated; CONTROL its range record removed → handed', () => {
    const body = fixture('waveB4-unseen1-01a2b27-run1-turn003.json');
    expect(robustnessComputed(blockOf(body))).toBe(false);
    expect(absenceHanded(project(blockOf(body), body.draft_graph))).toBe(false);
    const control = project(noRange(blockOf(body)), body.draft_graph);
    expect(control).not.toHaveProperty('goal_chance_range_display');
    expect(control).toMatchObject({ decision_sensitivity: { status: 'not_measured' }, tipping_point: { status: 'not_evaluated' } });
  });

  it('driver alone (served B5 T1b, author: robustness removed) → gated with the graph; with no labels the driver is not shown → handed', () => {
    const body = fixture('waveB5-t1b-3fce64f-run1-turn003.json');
    const block = noRobustness(blockOf(body));
    expect(absenceHanded(project(block, body.draft_graph))).toBe(false);
    const unlabelled = project(block);
    expect(unlabelled).not.toHaveProperty('goal_chance_driver_display');
    expect(unlabelled).toMatchObject({ decision_sensitivity: { status: 'not_measured' }, tipping_point: { status: 'not_evaluated' } });
  });

  it('a Run that is no longer current shows no chance line: only robustness can gate it', () => {
    const body = fixture('waveB4-unseen1-01a2b27-run1-turn003.json');
    expect(project(blockOf(body), body.draft_graph, false)).toMatchObject({ decision_sensitivity: { status: 'not_measured' } });
  });

  it('a MEASURED sensitivity is still handed beside a driver (author: W3 T1b, its EVPPI row resolved)', () => {
    const body = fixture('served-w3-f440be4a-t1b-7ab6c1af.json');
    const block = clone(blockOf(body));
    block.enrichment.factor_evppi[0] = { ...block.enrichment.factor_evppi[0], status: 'resolved', evppi: 0.04 };
    const out = project(block, body.draft_graph);
    expect(out.decision_sensitivity).toMatchObject({ status: 'measured', most_sensitive: { factor_id: 'customers_lost_from_price_rise' } });
    expect(Array.isArray(out.enrichment.factor_evppi)).toBe(true);
  });

  it('a tipping-point FINDING is still handed beside a driver (author: W3 T1b with the served b5-per-limit flip row)', () => {
    const body = fixture('served-w3-f440be4a-t1b-7ab6c1af.json');
    const perLimit = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json', import.meta.url), 'utf8')) as Json;
    const block = clone(blockOf(body));
    block.enrichment.flip_thresholds = perLimit.enrichment.flip_thresholds;
    const finding = tippingPointOf(block.enrichment, undefined);
    expect(finding.status).not.toBe('not_evaluated');
    expect(project(block, body.draft_graph).tipping_point).toEqual(finding);
  });
});

describe('S2i: callers that pass no graph (Explain, saved-run facts) gate on the screen’s labels', () => {
  const read = fixture('waveB5-t1b-3fce64f-readback-run1.json').j as Json;
  // Author: robustness removed, so only the driver (which needs the labels) can gate.
  const result = noRobustness(read.analysis_result);

  it('screenGraph gates the driver limb; without it the statuses are handed', () => {
    expect(absenceHanded(project(result, undefined, true, read.graph))).toBe(false);
    expect(project(result)).toMatchObject({ decision_sensitivity: { status: 'not_measured' }, tipping_point: { status: 'not_evaluated' } });
  });

  it('screenGraph decides the gate only: it never adds a fact the caller did not get before', () => {
    const withScreen = project(result, undefined, true, read.graph);
    const without = project(result);
    const { decision_sensitivity: _d, tipping_point: _t, ...rest } = without;
    expect(Object.keys(withScreen).sort()).toEqual(Object.keys(rest).sort());
    expect(withScreen).not.toHaveProperty('goal_chance_driver_display');
  });

  it('saved-run facts (Explain and canonical state): the served readback hands no not_evaluated tipping point', () => {
    expect(read.analysis_state.run_state.kind).toBe('complete_current');
    const facts = (r: Json, raw?: unknown): Json => savedRunContextFacts('s2i', {
      graph_hash: read.graph_hash, analysis_state: read.analysis_state, analysis_result: r, ...(raw !== undefined ? { raw } : {}),
    }, { leader_may_be_named: false });
    expect(facts(read.analysis_result, read.graph).selected_run_reference).toBeDefined();
    expect(facts(read.analysis_result, read.graph)).not.toHaveProperty('tipping_point');
    expect(facts(result, read.graph)).not.toHaveProperty('tipping_point');
    // CONTROL: no robustness and no labels → the screen shows nothing this projection can see → handed as before.
    expect(facts(result).tipping_point).toEqual({ status: 'not_evaluated' });
  });
});

describe('S2i: the author-twin for the licence the driver comes from', () => {
  it('W3 T1b with no licensed driver for any option and no robustness: nothing shown → handed (author)', () => {
    const body = fixture('served-w3-f440be4a-t1b-7ab6c1af.json');
    const block = noRobustness(blockOf(body));
    delete licence(block).driver_by_option;
    licence(block).no_driver_by_option = Object.fromEntries(licence(block).option_ids.map((id: string) => [id, 'none']));
    const out = project(block, body.draft_graph);
    expect(out).not.toHaveProperty('goal_chance_driver_display');
    expect(out.decision_sensitivity).toEqual({ status: 'none_measurable' });
  });
});
