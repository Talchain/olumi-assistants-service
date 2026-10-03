import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(here, '../../..');
export const manifest = JSON.parse(readFileSync(resolve(here, 'cases.json'), 'utf8'));

/** Fixture admission only: this never selects a product method or computes a crossing. */
export function loadCase(id, root = repositoryRoot) {
  const spec = manifest.cases.find((c) => c.id === id);
  assert.ok(spec, `unknown case: ${id}`);
  const bytes = readFileSync(resolve(root, spec.source));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), spec.source_sha256, 'source fixture drift');
  const source = JSON.parse(bytes);
  const enrichment = source.enrichment ?? source.analysis_result?.enrichment;
  assert.ok(Array.isArray(enrichment?.flip_thresholds), 'source has no recorded flip rows');
  const matching = enrichment.flip_thresholds.filter((r) => r.factor_id === spec.factor_id);
  assert.equal(matching.length, 1, 'factor identity must be unique');
  const row = matching[0];
  assert.equal(row.current_value, spec.current_value);
  if (spec.kind === 'positive') {
    assert.equal(row.flip_reason, 'found');
    assert.equal(row.value_scale, 'display');
    assert.equal(row.flip_value, spec.threshold);
    assert.equal(row.unit, 'GBP/month');
    const node = source.graph.nodes.find((n) => n.id === spec.factor_id);
    assert.equal(node.observed_state.raw_value, spec.current_value);
    // This is a controllable setting. Do not rewrite it as missing evidence or VOI.
    assert.ok(source.graph.nodes.some((n) => n.kind === 'option' && spec.factor_id in (n.interventions ?? {})),
      'served positive must remain the original price lever');
  } else {
    assert.ok(enrichment.flip_thresholds.every((r) => r.flip_reason === 'structurally_invariant' && r.flip_value === null));
    assert.ok(enrichment.factor_evppi.length > 0);
    assert.ok(enrichment.factor_evppi.every((r) => r.status === 'below_resolution' && r.evppi === 0));
  }
  return { spec, source, enrichment, row };
}

const body = (step) => step.response;
const read = (step) => {
  assert.equal(step.status, 200, `${step.stage}: non-success response`);
  assert.ok(body(step)?.graph && body(step)?.current_read, `${step.stage}: canonical graph read missing`);
  return body(step);
};
const factor = (wire, id) => {
  const nodes = wire.graph.nodes.filter((n) => n.id === id);
  assert.equal(nodes.length, 1, 'canonical factor ID missing or duplicated');
  return nodes[0].observed_state;
};
const chipId = (request) => request?.chip?.id;
const offered = (wire, id) => wire?.suggested_actions?.some((c) => c.id === id) === true;

function pointerValue(object, pointer) {
  assert.match(pointer, /^\/(?:[^/]+\/)*(?:node_id|factor_id|target_id|node_ids\/0)$/, 'target pointer must address an ID field');
  return pointer.slice(1).split('/').reduce((v, key) => v?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], object);
}

function sameRun(a, b) {
  assert.equal(a.current_read.run_state.kind, 'complete_current');
  assert.equal(b.current_read.run_state.kind, 'complete_current');
  assert.ok(a.current_read.run_state.computed_at, 'selected Run timestamp missing');
  assert.equal(b.current_read.run_state.computed_at, a.current_read.run_state.computed_at, 'reload selected a different Run');
  assert.ok(a.current_read.computed_against_hash, 'selected Run analysis hash missing');
  assert.equal(a.current_read.computed_against_hash, a.current_read.current_analysis_hash, 'rerun is stale');
  assert.equal(b.current_read.computed_against_hash, a.current_read.computed_against_hash);
  assert.equal(b.current_read.current_analysis_hash, a.current_read.current_analysis_hash);
  assert.ok(a.analysis_result, 'selected result missing');
  assert.ok(a.current_read.result, 'current selected result missing');
  assert.deepEqual(a.current_read.result, a.analysis_result, 'public result differs from selected current result');
  assert.deepEqual(b.current_read.result, a.current_read.result, 'reload changed the current selected result');
  assert.deepEqual(b.analysis_result, a.analysis_result, 'reload changed the selected result');
}

/**
 * Checks a redacted R3 wire recording. Recorder metadata is evidence attribution,
 * not authentication or a new canonical state. R3 still judges prose and UX.
 */
export function replay(caseInput, capture) {
  const { spec, row } = caseInput;
  assert.equal(capture.case_id, spec.id);
  assert.ok(['captured-wire', 'instrument-selftest'].includes(capture.evidence_kind));
  assert.ok(capture.scenario_id, 'scenario identity missing');
  for (const name of ['ui', 'cee', 'plot', 'isl']) {
    assert.match(capture.configuration?.builds?.[name] ?? '', /^[a-f0-9]{40}$/, `${name} immutable build missing`);
  }
  for (const name of ['model', 'effort', 'prompt_hash', 'schema_version']) {
    assert.ok(typeof capture.configuration?.[name] === 'string' && capture.configuration[name].length > 0, `${name} missing`);
  }
  assert.ok(capture.configuration.flags && typeof capture.configuration.flags === 'object', 'flag configuration missing');
  const order = spec.kind === 'positive'
    ? ['before_read', 'explain', 'refine', 'before_approval_read', 'approve', 'stale_read', 'rerun', 'after_run_read', 'cold_read']
    : ['before_read', 'explain', 'cold_read'];
  assert.deepEqual(capture.steps.map((s) => s.stage), order, 'missing, duplicate or out-of-order stage');
  for (const step of capture.steps) {
    assert.equal(step.scenario_id, capture.scenario_id, 'cross-scenario capture');
    assert.equal(step.status, 200, `${step.stage}: non-success response`);
  }
  const stages = Object.fromEntries(capture.steps.map((s) => [s.stage, s]));
  const before = read(stages.before_read);
  sameRun(before, before);
  assert.equal(factor(before, spec.factor_id).raw_value, row.current_value);
  const recordedScience = before.current_read.result.enrichment;
  assert.ok(Array.isArray(recordedScience?.flip_thresholds), 'current selected Run has no recorded science');
  const matching = recordedScience.flip_thresholds.filter((r) => r.factor_id === spec.factor_id);
  assert.equal(matching.length, 1, 'current selected Run factor science is not unique');
  for (const field of ['current_value', 'flip_value', 'flip_reason', 'unit']) {
    assert.equal(matching[0][field], row[field], `current selected Run differs from source ${field}`);
  }
  const text = body(stages.explain)?.assistant_text;
  assert.ok(typeof text === 'string' && text.trim().length > 0, 'explanation missing');
  assert.notEqual(body(stages.explain)?._agent?.mutated, true, 'explanation silently changed the model');

  if (spec.kind === 'no_signal') {
    assert.ok(recordedScience.flip_thresholds.every((r) => r.flip_reason === 'structurally_invariant' && r.flip_value === null));
    assert.ok(recordedScience.factor_evppi?.length > 0);
    assert.ok(recordedScience.factor_evppi.every((r) => r.status === 'below_resolution' && r.evppi === 0));
    assert.ok(!/55[.,]76|most worth resolving|highest value of information|nothing (?:could|can) change|will never change/i.test(text),
      'no-signal explanation invents a crossing, VOI priority or universal no-change claim');
    // The recorder lists ONLY science-backed value offers, not ordinary discussion controls.
    // IDs must be taken from the actual wire; R3 owns the semantic categorisation.
    assert.deepEqual(stages.explain.science_value_offer_ids, [], 'no-signal offers a measured value action');
    const cold = read(stages.cold_read);
    assert.deepEqual(cold.graph, before.graph, 'no-signal case changed the model');
    sameRun(before, cold);
  } else {
    assert.equal(factor(before, spec.factor_id).raw_value, row.current_value);
    assert.ok(text.includes(row.factor_label), 'explanation names a different factor');
    assert.ok(/(?:^|[^\d])55\.76(?!\d)/.test(text), 'exact served threshold missing or rounded');
    assert.ok(/GBP\s*(?:\/\s*|per\s+)month|£[^\n]*\/month/i.test(text), 'display unit missing');
    assert.ok(/model|comparison|could/i.test(text), 'model-relative qualification missing');
    assert.ok(!/most worth investigating|highest value of information|missing evidence/i.test(text), 'price lever misrepresented as VOI');
    const refine = stages.refine;
    assert.equal(pointerValue(refine.request, refine.target_pointer), spec.factor_id, 'action selected the wrong factor');
    assert.deepEqual(read(stages.before_approval_read).graph, before.graph, 'refinement wrote before approval');
    const approval = chipId(stages.approve.request);
    assert.match(approval ?? '', /^agent-approve-proposal:(?:prop_[a-f0-9]{6,64}|gmh_[a-f0-9]{12})$/, 'explicit bound approval missing');
    assert.ok(offered(body(refine), approval), 'approval was never offered by the preceding proposal');
    const stale = read(stages.stale_read);
    const edited = factor(stale, spec.factor_id);
    assert.equal(edited.raw_value, spec.threshold, 'approved figure did not land');
    assert.equal(edited.unit, row.unit, 'approved unit changed');
    assert.ok(/^user_/.test(edited.source ?? ''), 'user approval provenance missing');
    assert.notEqual(stale.graph_hash, before.graph_hash, 'canonical revision did not move');
    assert.equal(stale.current_read.run_state.kind, 'complete_stale', 'old Run not marked stale');
    assert.equal(stale.current_read.result, null, 'stale read promotes an old result as current');
    assert.equal(stages.rerun.request?.chip?.action_type, 'run_analysis', 'explicit rerun action missing');
    assert.ok(offered(body(stages.approve), chipId(stages.rerun.request)), 'rerun did not use the offered control');
    const after = read(stages.after_run_read);
    assert.notEqual(after.current_read.run_state.computed_at, before.current_read.run_state.computed_at, 'old Run reused as rerun');
    assert.equal(factor(after, spec.factor_id).raw_value, spec.threshold);
    assert.deepEqual(after.graph.nodes, stale.graph.nodes, 'rerun changed the approved model values, units or provenance');
    const cold = read(stages.cold_read);
    assert.deepEqual(cold.graph, after.graph, 'cold reload lost the approved model');
    sameRun(after, cold);
  }
  return { case_id: spec.id, state: 'PASS', evidence_kind: capture.evidence_kind,
    rung: capture.evidence_kind === 'captured-wire' ? 'WIRE-REPLAY-CHECKED' : 'INSTRUMENT-SELFTEST',
    stages: order, remaining: ['R3 semantic and browser acceptance; this checker does not prove a browser interaction'] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, captureFile] = process.argv.slice(2);
  try {
    const input = loadCase(id);
    if (!captureFile) {
      console.log(JSON.stringify({ case_id: id, state: 'READY', evidence_kind: 'source-fixture',
        factor_id: input.row.factor_id, current_value: input.row.current_value,
        threshold: input.spec.threshold, integration_dependency: 'R3 captured SCI-HERO action/rerun/reload chain' }, null, 2));
    } else {
      const capture = JSON.parse(readFileSync(captureFile, 'utf8'));
      assert.equal(capture.evidence_kind, 'captured-wire', 'synthetic recordings cannot be submitted as wire evidence');
      console.log(JSON.stringify(replay(input, capture), null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ state: 'FAIL', error: error.message }));
    process.exitCode = 1;
  }
}
