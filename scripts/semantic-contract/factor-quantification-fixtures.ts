/**
 * Deterministic producer -> canonical GraphV3 -> JSON reload fixtures for Science.
 * This does not call an LLM, PLoT, ISL, a deployed service or a persistence store.
 *
 *   node --import tsx scripts/semantic-contract/factor-quantification-fixtures.ts --write
 *   node --import tsx scripts/semantic-contract/factor-quantification-fixtures.ts --check
 *
 * The single authored existing-resilience case is deliberately preserved input,
 * not a fallback producer. Supplied ignorance remains a separate user assumption.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { selectFactorQuantity } from '@talchain/schemas';
import { GraphV3, type GraphV3T, type NodeV3T } from '../../src/schemas/cee-v3.js';
import { adoptFactorEstimates, markUnresolved, type BasisReference } from '../../src/cee/factor-quantification/adopt.js';
import { parseFactorEstimates } from '../../src/cee/factor-quantification/estimate-response.js';
import { comparisonFactorRequirements, selectQuantificationGaps } from '../../src/cee/factor-quantification/select.js';
import type { FactorEstimate } from '../../src/cee/factor-quantification/types.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = resolve(projectRoot, 'scripts/semantic-contract/factor-quantification-fixtures.json');
const target = 'fac_availability';
const goal = 'goal_service';
const SCHEMA_BINDING = {
  package: '@talchain/schemas',
  version: '0.53.0',
  source_commit: '51dca7aa03efaef9160c8a9f806b804b7f8a68fd',
  vendor_tarball: 'vendor/talchain-schemas-0.53.0.tgz',
  vendor_sha256: 'a532fb3ce386be8610bb56d4e4efee77fe39f75da7269a774c1d97009997eea1',
  installed_factor_quantification_sha256: '87cdaa580509438496382f22d361ce5e24ef676b2a630956c4738383867c6b43',
  installed_graph_sha256: 'a2e94b646f85111b74b5ab4b038f05b2099665ecf3efec05f6879b44cdf68319',
} as const;
const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const graphHash = (graph: GraphV3T): string => sha256(JSON.stringify(graph));
const nodeAt = (graph: GraphV3T): NodeV3T => graph.nodes.find(node => node.id === target)!;
const pointSelection = (source: string | null): ReturnType<typeof selectFactorQuantity> => ({ kind: 'point', carrier: 'observed_state', protected: true, source });

function baseGraph(quantity: Partial<NodeV3T> = {}): GraphV3T {
  const edge = (from: string, to: string): GraphV3T['edges'][number] => ({
    from, to, strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
    provenance: { source: 'cee_hypothesis', reasoning: 'Fixed authored surrounding model for this contract control; not measured evidence.' },
  });
  return GraphV3.parse({
    nodes: [
      { id: goal, kind: 'goal', label: 'Dependable service' },
      { id: 'opt_a', kind: 'option', label: 'Lower additional staffing', interventions: { fac_staffing: 0.2 } },
      { id: 'opt_b', kind: 'option', label: 'Higher additional staffing', interventions: { fac_staffing: 0.8 } },
      { id: 'fac_staffing', kind: 'factor', label: 'Additional staffing share', category: 'controllable', observed_state: { value: 0.1, source: 'user_override', declared_scale: 'unit_interval' } },
      { id: target, kind: 'factor', label: 'Available share of scheduled staff', category: 'external', ...quantity },
    ],
    edges: [edge('opt_a', 'fac_staffing'), edge('opt_b', 'fac_staffing'), edge('fac_staffing', goal), edge(target, goal)],
  });
}
const optionsFor = (graph: GraphV3T) => graph.nodes.filter(node => node.kind === 'option')
  .map(node => ({ id: node.id, label: node.label, interventions: node.interventions ?? {} }));
const knownPercentUnknown: Partial<NodeV3T> = {
  prior: { prior_is_unquantified: true, source: 'cee_repair', unit: '%', cap: 100, declared_scale: 'unit_interval' },
};
const ref = (id: string, text: string, kind: BasisReference['kind'] = 'brief_context'): BasisReference => ({ id, text, factor_ids: [target], kind });

interface FixtureSpec {
  id: string;
  note: string;
  input: GraphV3T;
  operation: 'adoptFactorEstimates' | 'markUnresolved' | 'preserve_existing_input';
  estimates: FactorEstimate[];
  basis: BasisReference[];
  expectedSelection: ReturnType<typeof selectFactorQuantity>;
  verify(node: NodeV3T): void;
}

function numericFree(node: NodeV3T): void {
  assert.equal(node.observed_state, undefined);
  for (const field of ['value', 'std', 'range_min', 'range_max', 'distribution']) {
    assert.equal(Object.hasOwn(node.prior ?? {}, field), false, `Unknown must not claim ${field}`);
  }
}

function specs(): FixtureSpec[] {
  const point: FactorEstimate = {
    factor_id: target, estimate_type: 'estimated', value: 0.75, std: 0.05,
    reasoning: '15 available staff divided by 20 scheduled staff gives 0.75. The supplied attendance context states daily available-share standard deviation 0.05 on the same unit-interval scale. This derived quantity remains an Olumi estimate from supplied context.',
    basis: ['attendance_counts', 'attendance_variation'],
  };
  const range: FactorEstimate = {
    factor_id: target, estimate_type: 'estimated', distribution: 'uniform', range_min: 0.65, range_max: 0.85,
    reasoning: 'This authored control explicitly assigns equal density to available shares from 0.65 to 0.85. These are uniform support bounds, not a confidence interval; the uniform shape comes from the supplied model assumption, not absence of information.',
    basis: ['controlled_uniform_rule'],
  };
  const refusal: FactorEstimate = {
    factor_id: target, estimate_type: 'unknown',
    reasoning: 'The scale is defined, but no attendance observations or defensible uncertainty model are supplied. A percentage domain does not justify a central value, standard deviation or uniform range.',
    basis: ['no_attendance_data'],
  };
  const userOverride = (value: number): FixtureSpec => ({
    id: `accepted_user_override_${value === 0.12 ? '012' : '024'}_old_unflagged_prior`,
    note: 'Exact accepted user_override point wins selection over a genuinely source-absent old unflagged prior. The old prior is preserved without attribution, deletion or fallback classification.',
    input: baseGraph({ observed_state: { value, source: 'user_override', raw_value: value * 100, unit: '%', cap: 100, declared_scale: 'unit_interval' }, prior: { distribution: 'uniform', range_min: 0, range_max: 0.132 } }),
    operation: 'preserve_existing_input', estimates: [], basis: [], expectedSelection: pointSelection('user_override'),
    verify(node) {
      assert.equal(node.observed_state?.value, value);
      assert.equal(Object.hasOwn(node.observed_state ?? {}, 'value_tier'), false);
      assert.equal(Object.hasOwn(node.prior ?? {}, 'source'), false);
      assert.equal(Object.hasOwn(node.prior ?? {}, 'prior_is_unquantified'), false);
      assert.equal(Object.hasOwn(node.prior ?? {}, 'value_tier'), false);
      assert.deepEqual(node.prior, { distribution: 'uniform', range_min: 0, range_max: 0.132 });
    },
  });
  return [
    {
      id: 'reasoned_point_known_percent_scale', note: 'A controlled structured estimator output is parsed and adopted. Value/std stay normalized; cap100, percent unit, unit_interval and derived raw75 survive reload.',
      input: baseGraph(knownPercentUnknown), operation: 'adoptFactorEstimates', estimates: [point],
      basis: [ref('attendance_counts', '15 of 20 scheduled staff are available today.'), ref('attendance_variation', 'The attendance context states a daily available-share standard deviation of 0.05.')],
      expectedSelection: pointSelection('cee_inference'),
      verify(node) { assert.deepEqual(node.observed_state, { value: 0.75, std: 0.05, source: 'cee_inference', unit: '%', cap: 100, declared_scale: 'unit_interval', raw_value: 75, extractionType: 'inferred', reasoning: { rationale: point.reasoning, context_basis: point.basis } }); assert.equal(node.prior, undefined); },
    },
    {
      id: 'reasoned_uniform_known_percent_scale', note: 'Uniform shape is positively justified by an authored model assumption. No midpoint or new point value is manufactured.',
      input: baseGraph(knownPercentUnknown), operation: 'adoptFactorEstimates', estimates: [range],
      basis: [ref('controlled_uniform_rule', 'For this authored control, tomorrow\'s available share is uniformly distributed between 0.65 and 0.85.', 'model_context')],
      expectedSelection: { kind: 'distribution', carrier: 'prior', protected: true, source: 'cee_inference' },
      verify(node) { assert.deepEqual(node.prior, { distribution: 'uniform', range_min: 0.65, range_max: 0.85, unit: '%', cap: 100, declared_scale: 'unit_interval', source: 'cee_inference', reasoning: { rationale: range.reasoning, context_basis: range.basis } }); assert.equal(node.observed_state, undefined); },
    },
    {
      id: 'model_unknown_preserves_declared_scale', note: 'A parsed model refusal carries model reasoning and known scale metadata, with no numeric quantity or distribution claim.',
      input: baseGraph(knownPercentUnknown), operation: 'adoptFactorEstimates', estimates: [refusal],
      basis: [ref('no_attendance_data', 'No attendance observations or uncertainty model have been supplied.')],
      expectedSelection: { kind: 'unknown', carrier: 'prior', protected: false, source: 'cee_inference' },
      verify(node) { numericFree(node); assert.deepEqual(node.prior, { prior_is_unquantified: true, unit: '%', cap: 100, declared_scale: 'unit_interval', source: 'cee_inference', reasoning: { rationale: refusal.reasoning, context_basis: refusal.basis } }); },
    },
    {
      id: 'operational_unknown_without_model_reasoning', note: 'markUnresolved writes a previously absent quantity as unknown. No model output or model-authored refusal is claimed.',
      input: baseGraph(), operation: 'markUnresolved', estimates: [], basis: [],
      expectedSelection: { kind: 'unknown', carrier: 'prior', protected: false, source: 'cee_repair' },
      verify(node) { numericFree(node); assert.deepEqual(node.prior, { prior_is_unquantified: true, source: 'cee_repair' }); },
    },
    {
      id: 'authored_existing_resilience_uniform', note: 'The sole explicitly authored existing system-resilience input. It is preserved for downstream discrimination; neither adoption nor markUnresolved generated this fallback.',
      input: baseGraph({ prior: { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true, value_tier: 'fallback_default', source: 'cee_repair' } }),
      operation: 'preserve_existing_input', estimates: [], basis: [],
      expectedSelection: { kind: 'fallback', carrier: 'prior', protected: false, source: 'cee_repair' },
      verify(node) { assert.deepEqual(node.prior, { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true, value_tier: 'fallback_default', source: 'cee_repair' }); assert.equal(node.observed_state, undefined); },
    },
    {
      id: 'supplied_ignorance_user_assumption', note: 'A user-supplied ignorance distribution remains user_assumption and protected. The shared selector labels its flagged numeric support fallback, without attributing it to CEE or converting it to a model estimate.',
      input: baseGraph({ prior: { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true, source: 'user_assumption' } }),
      operation: 'preserve_existing_input', estimates: [], basis: [],
      expectedSelection: { kind: 'fallback', carrier: 'prior', protected: true, source: 'user_assumption' },
      verify(node) { assert.deepEqual(node.prior, { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true, source: 'user_assumption' }); assert.equal(Object.hasOwn(node.prior ?? {}, 'value_tier'), false); },
    },
    {
      id: 'legacy_unattributed_point', note: 'An existing point with absent source is protected and remains unattributed. It is not relabelled user input, evidence, AI inference or fallback.',
      input: baseGraph({ observed_state: { value: 0.37 } }), operation: 'preserve_existing_input', estimates: [], basis: [],
      expectedSelection: pointSelection(null),
      verify(node) { assert.deepEqual(node.observed_state, { value: 0.37 }); assert.equal(Object.hasOwn(node.observed_state ?? {}, 'source'), false); },
    },
    userOverride(0.12), userOverride(0.24),
  ];
}

async function verifyBinding(): Promise<void> {
  const installedDist = dirname(fileURLToPath(import.meta.resolve('@talchain/schemas')));
  const pkg = JSON.parse(await readFile(resolve(installedDist, '../package.json'), 'utf8')) as { name: string; version: string };
  assert.equal(pkg.name, SCHEMA_BINDING.package);
  assert.equal(pkg.version, SCHEMA_BINDING.version);
  assert.equal(sha256(await readFile(resolve(projectRoot, SCHEMA_BINDING.vendor_tarball))), SCHEMA_BINDING.vendor_sha256, 'Wrong vendored schema bytes');
  assert.equal(sha256(await readFile(resolve(installedDist, 'factor-quantification.js'))), SCHEMA_BINDING.installed_factor_quantification_sha256, 'Wrong executing selector bytes');
  assert.equal(sha256(await readFile(resolve(installedDist, 'graph.js'))), SCHEMA_BINDING.installed_graph_sha256, 'Wrong executing shared graph bytes');
}

export async function buildFactorQuantificationFixtures() {
  await verifyBinding();
  const sourceFiles = [
    'src/cee/factor-quantification/adopt.ts', 'src/cee/factor-quantification/select.ts',
    'src/cee/factor-quantification/estimate-response.ts', 'src/schemas/cee-v3.ts',
    'scripts/semantic-contract/factor-quantification-fixtures.ts',
  ];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, sha256(await readFile(resolve(projectRoot, path)))])));
  const fixtures = specs().map(spec => {
    const initial = GraphV3.parse(JSON.parse(JSON.stringify(spec.input)));
    const requirements = comparisonFactorRequirements(initial, optionsFor(initial), goal);
    const selection = selectQuantificationGaps(initial, requirements);
    const parsed = parseFactorEstimates({ estimates: spec.estimates }, selection.gaps.map(gap => gap.factor_id));
    assert.equal(parsed.ok, true, `${spec.id}: structured output must parse`);
    if (!parsed.ok) throw new Error(parsed.error);
    const adoption = adoptFactorEstimates(initial, selection.gaps, parsed.estimates, spec.basis);
    assert.deepEqual(adoption.rejected, [], `${spec.id}: unexpected rejected result`);
    const resolved = new Set([...adoption.estimated, ...adoption.unknown]);
    const canonical = spec.operation === 'preserve_existing_input' ? adoption.graph
      : markUnresolved(adoption.graph, selection.eligible, resolved, initial);
    if (spec.operation === 'preserve_existing_input') assert.deepEqual(canonical, initial);
    const canonicalBytes = JSON.stringify(canonical);
    const readback = GraphV3.parse(JSON.parse(canonicalBytes));
    assert.deepEqual(readback, canonical, `${spec.id}: JSON reload changed canonical graph`);
    const node = nodeAt(readback);
    spec.verify(node);
    const selected = selectFactorQuantity(node);
    assert.deepEqual(selected, spec.expectedSelection, `${spec.id}: selector disagreement`);
    assert.deepEqual(readback.nodes.filter(n => n.id !== target), initial.nodes.filter(n => n.id !== target), `${spec.id}: unrelated nodes changed`);
    assert.deepEqual(readback.edges, initial.edges, `${spec.id}: graph structure changed`);
    return {
      id: spec.id, note: spec.note, target_factor_id: target,
      producer_input: { graph: initial, structured_estimates: spec.estimates, basis: spec.basis },
      executed: {
        operation: spec.operation, schema_parser: 'parseFactorEstimates', adopter: 'adoptFactorEstimates',
        unresolved_writer_called: spec.operation !== 'preserve_existing_input',
        model_called: false, graph_redrawn: false,
      },
      canonical_write: { graph_sha256: graphHash(canonical), estimated_ids: adoption.estimated, model_unknown_ids: adoption.unknown, rejected: adoption.rejected },
      json_reload: { parser: 'GraphV3', graph_sha256: graphHash(readback), unchanged: true },
      science_input: { graph: readback, options: optionsFor(readback), target_node: goal },
      selected,
      reasoning_attribution: {
        selected_carrier: selected.carrier, selected_source: selected.source,
        observed_state_source: node.observed_state?.source ?? null,
        prior_source: node.prior?.source ?? null,
        observed_state_reasoning: node.observed_state?.reasoning ?? null,
        prior_reasoning: node.prior?.reasoning ?? null,
        model_reasoning_is_evidence: false,
      },
      checks: { canonical_reload_unchanged: true, expected_quantity_selection: true, supplied_and_unrelated_values_unchanged: true },
    };
  });
  assert.equal(fixtures.length, 9);
  return {
    fixture_format: 'factor_quantification_canonical_science_inputs_v1',
    scope: {
      evidence: 'executed_deterministic_producer_canonical_json_reload',
      inputs: 'authored_contract_controls_not_captured_live_model_output',
      consumer_format: 'CEE_GraphV3_with_canonical_options_and_target_not_a_PLoT_or_ISL_projection',
      model_calls: 0, science_calls: 0, persistence: 'in_memory_JSON_round_trip_not_a_service_or_database',
      fallback_production: 'none_existing_system_resilience_authored_only_in_named_control',
    },
    schema_binding: SCHEMA_BINDING,
    producer_source_sha256: sourceHashes,
    fixtures,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { write: { type: 'boolean' }, check: { type: 'boolean' } }, strict: true, allowPositionals: false });
  if (Boolean(values.write) === Boolean(values.check)) throw new Error('Choose exactly one of --write or --check.');
  const output = `${JSON.stringify(await buildFactorQuantificationFixtures(), null, 2)}\n`;
  if (values.write) await writeFile(fixturePath, output, 'utf8');
  else assert.equal(await readFile(fixturePath, 'utf8'), output, 'Fixture bytes are stale; inspect producer changes and regenerate with --write.');
  // Exercise the durable file a Science consumer receives, not only the
  // producer's pre-write object. This is fixture storage, never service storage.
  const stored = JSON.parse(await readFile(fixturePath, 'utf8')) as Awaited<ReturnType<typeof buildFactorQuantificationFixtures>>;
  for (const fixture of stored.fixtures) {
    const reloaded = GraphV3.parse(fixture.science_input.graph);
    assert.equal(graphHash(reloaded), fixture.canonical_write.graph_sha256, `${fixture.id}: stored graph changed`);
    assert.deepEqual(selectFactorQuantity(nodeAt(reloaded)), fixture.selected, `${fixture.id}: stored selector result changed`);
  }
  console.log(`${values.write ? 'Wrote' : 'Verified'} 9 deterministic canonical Science-contract fixtures. No model or Science call performed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
