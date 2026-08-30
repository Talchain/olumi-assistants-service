/**
 * Bounded executable semantic fixture: stated percent -> edit -> persisted
 * JSON -> actual CEE analysis projection -> PLoT adapters -> ISL consumer.
 *
 * Run: UI_REPO=/absolute/pinned/ui NODE_ENV=test node_modules/.bin/tsx scripts/semantic-contract/stated-percent.ts
 *   --plot-dir /absolute/pinned/plot --isl-dir /absolute/pinned/isl
 *   --python /absolute/python-with-isl-dependencies
 *
 * Uses an in-memory SessionStore seam and an observed PLoT transport boundary;
 * it does not contact staging, fabricate an analysis response or prove a DB /
 * browser journey. External source and schema identities are checked before use.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { GraphV3T } from '../../src/schemas/cee-v3.js';
import type { ProposalAction } from '../../src/orchestrator-v5/routing/types.js';
import type { PLoTClient } from '../../src/orchestrator/plot-client.js';
import type { SessionStore } from '../../src/orchestrator-v5/session/store.js';

type JsonObject = Record<string, unknown>;
const TARGET = '3737a162';
const TWIN = 'churn-cohort-b';
const SCENARIO = 'f0e2b899-0fc9-4f1f-836a-672d23eda014';
const PLOT_HEAD = '75e7f9747977a28214533ce4af0efdb9ca28b155';
const ISL_HEAD = '28fe0c950f6ca5737f4555c863353d37b734dddf';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
function option(name: string): string {
  const index = args.indexOf(name);
  assert(index >= 0 && args[index + 1], `Required argument missing: ${name}`);
  return resolve(args[index + 1]);
}
const plotDir = option('--plot-dir');
const islDir = option('--isl-dir');
const python = option('--python');
const git = (dir: string, ...arguments_: string[]) =>
  execFileSync('git', ['-C', dir, ...arguments_], { encoding: 'utf8' }).trim();
const ceeHead = git(root, 'rev-parse', 'HEAD');
const watchedFiles = [
  'src/orchestrator-v5/context/cqe/rules.ts',
  'src/orchestrator-v5/tools/handlers/d1-shared/normalise-factor-value.ts',
  'src/orchestrator-v5/tools/handlers/set-factor-value.ts',
];
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceHashes = Object.fromEntries(watchedFiles.map((file) => [file, hash(join(root, file))]));
assert.equal(git(plotDir, 'rev-parse', 'HEAD'), PLOT_HEAD, 'PLoT source head drift');
assert.equal(git(islDir, 'rev-parse', 'HEAD'), ISL_HEAD, 'ISL source head drift');
assert.equal(git(plotDir, 'status', '--porcelain', '--', 'src'), '', 'PLoT source is dirty');
assert.equal(git(islDir, 'status', '--porcelain', '--', 'src'), '', 'ISL source is dirty');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
const { GraphV3 } = await import('../../src/schemas/cee-v3.js');
const { runExtraction } = await import('../../src/orchestrator-v5/context/cqe/extract-quantities.js');
const { mapCqeQuantityToProposalValue, deriveOperator } = await import('../../src/orchestrator-v5/routing/deterministic-value-update.js');
const { createSetFactorValueHandler } = await import('../../src/orchestrator-v5/tools/handlers/set-factor-value.js');
const { createRunAnalysisHandler } = await import('../../src/orchestrator-v5/tools/handlers/run-analysis.js');
const { projectGraphForPersistence } = await import('../../src/orchestrator-v5/persisted-graph-projection.js');
const { loadScenarioSnapshotForRunAnalysis } = await import('../../src/orchestrator-v5/build-turn-context.js');
const { _validateRunPayload } = await import('../../src/orchestrator/plot-client.js');
const { synthesiseDisplayValue } = await import('../../src/cee/factor-extraction/display-value.js');
const { buildHandlerInvocation } = await import('../../src/orchestrator-v5/tools/handlers/d1-shared/__tests__/fixtures.js');
const { assertStatedPercentUi, STATED_PERCENT_UI_HEAD } = await import('./stated-percent-ui.js');

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function object(value: unknown): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as JsonObject;
}
function node(graph: unknown, id = TARGET): JsonObject {
  const nodes = object(graph).nodes;
  assert(Array.isArray(nodes));
  const found = nodes.filter((candidate) => object(candidate).id === id);
  assert.equal(found.length, 1, `exactly one canonical node ${id}`);
  return object(found[0]);
}
function initialGraph(): GraphV3T & JsonObject {
  // Churn's empty baseline and original id are recovered from the banked
  // f0e2b899 run. The small surrounding graph is authored; no live-run claim.
  return {
    goal_node_id: 'g-retention',
    nodes: [
      { id: 'd-support', kind: 'decision', label: 'How should support improve?' },
      { id: 'g-retention', kind: 'goal', label: 'Retain customers' },
      { id: TARGET, kind: 'factor', label: 'Monthly churn rate', factor_type: 'probability',
        category: 'observable', provenance: 'ai_inferred', source_quote: 'somewhere between 8 and 15 percent',
        prior: { distribution: 'uniform', range_min: 0, range_max: 0.132 } },
      { id: TWIN, kind: 'factor', label: 'Monthly churn rate', category: 'observable', observed_state:
        { value: 0.07, raw_value: 7, unit: '%', source: 'brief_extraction' } },
      { id: 'f-support', kind: 'factor', label: 'Support coverage', observed_state:
        { value: 0.4, raw_value: 40, unit: '%', cap: 100, source: 'brief_extraction' } },
      { id: 'o-a', kind: 'option', label: 'Existing support', interventions:
        { 'f-support': { value: 0.4, source: 'user_specified' } } },
      { id: 'o-b', kind: 'option', label: 'Extended support', interventions:
        { 'f-support': { value: 0.6, source: 'user_specified' } } },
    ],
    edges: [TARGET, TWIN, 'f-support'].map((id) => ({
      from: id, to: 'g-retention', strength: { mean: id === 'f-support' ? 0.5 : -0.3, std: 0.01 },
      exists_probability: 1, effect_direction: id === 'f-support' ? 'positive' : 'negative',
    } as GraphV3T['edges'][number])).concat(['o-a', 'o-b'].flatMap((id) => [
      { from: 'd-support', to: id, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: id, to: 'f-support', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    ] as GraphV3T['edges'])),
  };
}

async function edit(message: string, graph = initialGraph()) {
  const extraction = runExtraction(message);
  assert.equal(extraction.summary.degraded, false, `healthy CQE: ${JSON.stringify(extraction.summary)}`);
  assert.equal(extraction.summary.timeout, false, 'CQE budget must not degrade the fixture');
  const quantities = extraction.results;
  assert.equal(quantities.length, 1, `one CQE extraction for ${message}; ${JSON.stringify(extraction.summary)}`);
  const quantity = quantities[0];
  const mapped = mapCqeQuantityToProposalValue(quantity);
  const proposal: ProposalAction = {
    handler_id: 'set_factor_value',
    entity: { id: TARGET, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'value', value: mapped.unit === undefined ? mapped.value : mapped,
      operator: deriveOperator(message, quantity), source: 'user_explicit' }],
    cited_context_fields: [],
  };
  const beforeTwin = clone(node(graph, TWIN));
  const outcome = await createSetFactorValueHandler()(buildHandlerInvocation({
    graph, proposal, message, scenarioId: SCENARIO,
  }));
  assert(outcome.mutated_graph, 'actual handler must return its graph');
  assert.deepEqual(node(outcome.mutated_graph, TWIN), beforeTwin, 'same-label sibling unchanged');
  const persisted = projectGraphForPersistence(outcome.mutated_graph);
  const serialized = JSON.stringify(persisted);
  const restored = JSON.parse(serialized) as GraphV3T & JsonObject;
  assert.deepEqual(restored, persisted, 'JSON persistence representation reload');
  assert(GraphV3.safeParse(restored).success, 'restored graph validates');
  assert.deepEqual(projectGraphForPersistence(restored), restored, 'restore projection idempotent');
  return { quantity, mapped, outcome, persisted, restored };
}

async function plotPayload(restored: GraphV3T & JsonObject): Promise<JsonObject> {
  let captured: JsonObject | undefined;
  let readCount = 0;
  const store = {
    loadGraphAndBriefText: async (id: string) => {
      assert.equal(id, SCENARIO);
      readCount++;
      return { graph: clone(restored), briefText: null };
    },
  } as unknown as SessionStore;
  const client: PLoTClient = {
    run: async (payload) => {
      _validateRunPayload(payload);
      captured = clone(payload);
      // The observer stops at transport. Never return a fabricated result.
      throw new Error('SEMANTIC_FIXTURE_CAPTURED_TRANSPORT');
    },
    validatePatch: async () => { throw new Error('unexpected validatePatch'); },
  };
  try {
    await createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'semantic-fixture', store),
    })(buildHandlerInvocation({
      graph: restored, scenarioId: SCENARIO, stage: 'analyse', message: 'Run analysis',
      proposal: { handler_id: 'run_analysis', entity: { id: 'g-retention', kind: 'goal',
        resolution_status: 'resolved', resolution_method: 'id_match' }, parameters: [], cited_context_fields: [] },
    }));
  } catch (error) {
    if (!captured) throw error;
  }
  assert.equal(readCount, 1, 'actual snapshot loader read persisted graph');
  assert(captured, 'CEE must reach its PLoT transport');
  return captured;
}

const scratch = mkdtempSync(join(tmpdir(), 'stated-percent-adapters-'));
const consumingWitnesses: JsonObject[] = [];
try {
  // Bundle the real pinned PLoT modules. Resolve its declared schema tarball,
  // not CEE's different schema pin; only build output goes into scratch.
  const pkg = JSON.parse(readFileSync(join(plotDir, 'package.json'), 'utf8'));
  const schemasPin = pkg.dependencies['@talchain/schemas'] as string;
  assert(schemasPin.startsWith('file:'), 'fixture expects explicit vendored PLoT schema');
  const tarball = resolve(plotDir, schemasPin.slice(5));
  const expectedHash = readFileSync(`${tarball}.sha256`, 'utf8').trim().split(/\s+/)[0];
  assert.equal(createHash('sha256').update(readFileSync(tarball)).digest('hex'), expectedHash);
  const schemaRoot = join(scratch, 'schemas');
  mkdirSync(schemaRoot);
  execFileSync('tar', ['-xzf', tarball, '-C', schemaRoot]);
  const require = createRequire(import.meta.url);
  const tsxRequire = createRequire(require.resolve('tsx/package.json'));
  const { build } = tsxRequire('esbuild') as { build: (options: JsonObject) => Promise<unknown> };
  const bundled = join(scratch, 'plot-adapters.mjs');
  await build({
    stdin: { contents: `export { normaliseGraph } from ${JSON.stringify(join(plotDir, 'src/normalisation/graph-normaliser.ts'))};
      export { filterForISL } from ${JSON.stringify(join(plotDir, 'src/normalisation/option-filter.ts'))};
      export { needsNormalisation, normaliseOptionsForISL } from ${JSON.stringify(join(plotDir, 'src/lib/intervention-normaliser.ts'))};
      export { toISLRobustnessRequest } from ${JSON.stringify(join(plotDir, 'src/integrations/isl/translator-v3.ts'))};`,
      resolveDir: root, sourcefile: 'pinned-plot-adapters.ts', loader: 'ts' },
    outfile: bundled, bundle: true, format: 'esm', platform: 'node',
    nodePaths: [join(root, 'node_modules')],
    alias: { '@talchain/schemas': join(schemaRoot, 'package/dist/index.js') },
  });
  const adapters = await import(pathToFileURL(bundled).href);

  function assertMeaning(graph: unknown, expectedValue = 0.12, expectedRaw = 12) {
    const target = node(graph);
    const observed = object(target.observed_state);
    assert.equal(observed.value, expectedValue, 'target analysis value');
    assert.equal(observed.raw_value, expectedRaw, 'target raw quantity');
    assert.equal(observed.unit, '%', 'target unit');
    assert.equal(observed.source, 'user_override', 'target epistemic source');
    assert.equal(observed.cap, undefined, 'percentage denominator must not invent a cap');
  }
  async function consume(restored: GraphV3T & JsonObject, raw = 12, completeAnalysis = false) {
    const expectedValue = raw / 100;
    assertMeaning(restored, expectedValue, raw);
    const payload = await plotPayload(restored);
    assertMeaning(payload.graph, expectedValue, raw);
    const normalized = adapters.normaliseGraph(payload.graph);
    assertMeaning(normalized.graph, expectedValue, raw);
    const causal = adapters.filterForISL(normalized.graph);
    // This adapter fixture isolates baseline semantics. The options have
    // already been projected by the real CEE handler; PLoT's translator expects
    // its documented numeric wrapper. No target intervention is introduced.
    const options = (payload.options as JsonObject[]).map((candidate) => ({
      id: candidate.id ?? candidate.option_id, label: candidate.label,
      interventions: Object.fromEntries(Object.entries(object(candidate.interventions))
        .map(([id, value]) => [id, { value }])),
    }));
    const scienceOptions = adapters.needsNormalisation(options)
      ? adapters.normaliseOptionsForISL(options, causal.nodes, payload.goal_node_id).options
      : options;
    const request = adapters.toISLRobustnessRequest(causal, scienceOptions,
      payload.goal_node_id, 'semantic-fixture', 4096, undefined, undefined, 41);
    assertMeaning(request.graph, expectedValue, raw);
    const result = spawnSync(python, [join(root, 'scripts/semantic-contract/stated-percent-isl.py'), islDir], {
      input: JSON.stringify({ request, target_id: TARGET, complete_analysis: completeAnalysis }), encoding: 'utf8', timeout: 60000,
    });
    assert.equal(result.status, 0, `ISL consumer failed: ${result.stderr || result.error}`);
    const science = JSON.parse(result.stdout) as JsonObject;
    assertMeaning({ nodes: [{ id: TARGET, observed_state: science.observed_state }] }, expectedValue, raw);
    assert.equal(science.central_value, expectedValue, 'ISL central value is exact user meaning');
    assert.equal(science.sample_count, 4096);
    assert(Math.abs(Number(science.sample_mean) - expectedValue) < 0.003, 'actual ISL samples centre on stated value');
    assert.equal(synthesiseDisplayValue(object(node(restored).observed_state)), `${raw}%`);
    assert.equal(node(restored).display_value, `${raw}%`);
    const ui = await assertStatedPercentUi(restored, TARGET, {
      value: expectedValue, raw_value: raw, unit: '%', source: 'user_override',
      scale_frame: 100, display_value: `${raw}%`,
    });
    consumingWitnesses.push({
      id: TARGET, raw_value: raw, value: expectedValue, unit: '%', source: 'user_override',
      scale_frame: node(restored).scale_frame, display_value: node(restored).display_value,
      stages: {
        persisted: node(restored).observed_state,
        cee_plot_boundary: node(payload.graph).observed_state,
        plot_normalized: node(normalized.graph).observed_state,
        isl_wire: node(request.graph).observed_state,
        isl_validated: science.observed_state,
      },
      central_value: science.central_value, sample_mean: science.sample_mean,
      sample_count: science.sample_count,
      ui_consumer: ui,
      ...(completeAnalysis ? { analysis_response: science.analysis_response } : {}),
    });
    return science;
  }

  const cases: Array<{ name: string; run: () => Promise<void> }> = [];
  for (const spelling of ['12%', '12 percent', '12 per cent']) {
    cases.push({ name: `positive ${spelling}`, run: async () => {
      const result = await edit(`Set the monthly churn rate to ${spelling}.`);
      assert.equal(result.quantity.unit, 'percentage');
      assert.equal(result.mapped.value, 12);
      assertMeaning(result.persisted);
      assert.equal(node(result.restored).provenance, 'user_set');
      assert(!Object.hasOwn(object(node(result.restored).observed_state), 'declared_scale'));
      await consume(result.restored);
    } });
  }
  cases.push({ name: 'unrelated mutant and renamed target stay GREEN', run: async () => {
    const graph = initialGraph();
    node(graph).label = 'Customer attrition';
    node(graph, TWIN).label = 'Monthly churn rate — unrelated cohort';
    const result = await edit('Set the selected factor to 12%.', graph);
    await consume(result.restored);
  } });
  for (const field of ['value', 'unit', 'source']) {
    cases.push({ name: `semantic-loss ${field} is RED`, run: async () => {
      const result = await edit('Set the monthly churn rate to 12%.');
      assertMeaning(result.restored); // A broken positive must not masquerade as a biting mutant.
      const changed = clone(result.restored);
      const observed = object(node(changed).observed_state);
      if (field === 'value') observed.value = 12;
      if (field === 'unit') delete observed.unit;
      if (field === 'source') observed.source = 'cee_hypothesis';
      assert.notDeepEqual(changed, result.restored, 'semantic mutant was actually applied');
      const signature = { value: /target analysis value/, unit: /target unit/, source: /target epistemic source/ };
      await assert.rejects(() => consume(changed), signature[field as keyof typeof signature]);
    } });
  }
  cases.push({ name: 'percentage points retain additive meaning', run: async () => {
    const graph = initialGraph();
    node(graph).observed_state = { value: 0.04, raw_value: 4, unit: '%', cap: 100 };
    const result = await edit('Increase the monthly churn rate by 2 percentage points.', graph);
    assert.equal(result.quantity.unit, 'percentage_points');
    assert.equal(deriveOperator('Increase the monthly churn rate by 2 percentage points.', result.quantity), 'increase');
    assert.equal(object(node(result.restored).observed_state).value, 0.06);
    assert.equal(object(node(result.restored).observed_state).raw_value, 6);
  } });
  cases.push({ name: 'existing raw percent remains refused without mutation', run: async () => {
    const graph = initialGraph();
    node(graph).observed_state = { value: 12, raw_value: 12, unit: '%' };
    const before = clone(graph);
    await assert.rejects(() => edit('Set the selected factor to 12%.', graph),
      (error: unknown) => object(error).cause_kind === 'parameter_invalid_at_execute');
    assert.deepEqual(graph, before);
  } });
  cases.push({ name: 'existing target intervention refuses new frame without mutation', run: async () => {
    const graph = initialGraph();
    object(node(graph, 'o-a').interventions)[TARGET] = { value: 12, source: 'user_specified' };
    const before = clone(graph);
    await assert.rejects(() => edit('Set the selected factor to 12%.', graph),
      (error: unknown) => object(error).cause_kind === 'parameter_invalid_at_execute');
    assert.deepEqual(graph, before);
  } });
  cases.push({ name: 'zero then twelve percent changes actual ISL outcomes after reload', run: async () => {
    const zero = await edit('Set the monthly churn rate to 0%.');
    assert.equal(node(zero.restored).scale_frame, 100);
    const before = await consume(zero.restored, 0, true);
    const twelve = await edit('Set the monthly churn rate to 12%.', zero.restored);
    assert.equal(node(twelve.restored).scale_frame, 100);
    const after = await consume(twelve.restored, 12, true);
    const rowsBefore = object(before.analysis_response).results;
    const rowsAfter = object(after.analysis_response).results;
    assert.equal(object(object(before.analysis_response).metadata).seed_used, 41);
    assert.equal(object(object(after.analysis_response).metadata).seed_used, 41);
    assert.equal(object(object(before.analysis_response).metadata).n_samples_used, 4096);
    assert.equal(object(object(after.analysis_response).metadata).n_samples_used, 4096);
    assert(Array.isArray(rowsBefore) && Array.isArray(rowsAfter), 'actual analyzer result rows');
    assert.equal(rowsBefore.length, 2);
    assert.equal(rowsAfter.length, 2);
    for (const row of rowsBefore) {
      const a = object(row);
      const b = rowsAfter.find((candidate) => object(candidate).option_id === a.option_id);
      assert(b, 'option identity survives both analyses');
      assert(Number(object(a.outcome_distribution).mean) > Number(object(object(b).outcome_distribution).mean),
        'higher churn must lower the same option outcome under the same seed');
    }
  } });
  cases.push({ name: 'twelve then twenty-four percent overrides the retained old prior', run: async () => {
    const twelve = await edit('Set the monthly churn rate to 12%.');
    const oldPrior = clone(node(twelve.restored).prior);
    await consume(twelve.restored, 12);
    const twentyFour = await edit('Set the monthly churn rate to 24%.', twelve.restored);
    assert.deepEqual(node(twentyFour.restored).prior, oldPrior, 'fixture retains the prior competing with the edit');
    assert.equal(node(twentyFour.restored).scale_frame, 100);
    const science = await consume(twentyFour.restored, 24);
    assert.equal(science.central_source, 'observed_state', 'stated value outranks retained prior');
    assert.equal(object(science.parameter_uncertainty).distribution, 'normal');
  } });
  for (const [message, raw, unit] of [
    ['Set the selected factor to 12.', 12, undefined],
    ['Set the selected factor to £75000.', 75000, '£'],
  ] as const) {
    cases.push({ name: `opposite control ${message}`, run: async () => {
      const result = await edit(message);
      const observed = object(node(result.restored).observed_state);
      assert.equal(observed.value, raw);
      assert.equal(observed.raw_value, raw);
      assert.equal(observed.unit, unit);
      assert(!Object.hasOwn(observed, 'cap'));
      assert(!Object.hasOwn(observed, 'declared_scale'));
    } });
  }
  assert.equal(cases.length, 14, 'all named cases collected');
  const results: Array<{ name: string; status: string; error?: string }> = [];
  for (const test of cases) {
    try { await test.run(); results.push({ name: test.name, status: 'PASS' }); }
    catch (error) { results.push({ name: test.name, status: 'FAIL', error: `${String(error)} ${JSON.stringify(error)}` }); }
  }
  assert.equal(results.length, 14, 'all named cases executed');
  assert.equal(git(root, 'rev-parse', 'HEAD'), ceeHead, 'CEE head moved during fixture');
  assert.deepEqual(Object.fromEntries(watchedFiles.map((file) => [file, hash(join(root, file))])),
    sourceHashes, 'CEE production source changed during fixture');
  const report = {
    evidence_rung: 'TESTED — local real-adapter composition; not deployed or DB/browser witnessed',
    heads: { cee: ceeHead, plot: PLOT_HEAD, isl: ISL_HEAD, ui: STATED_PERCENT_UI_HEAD },
    cee_source_sha256: sourceHashes,
    cee_worktree_changes: git(root, 'status', '--porcelain'),
    plot_schema_pin: schemasPin, plot_schema_sha256: expectedHash,
    collected: cases.length, passed: results.filter((test) => test.status === 'PASS').length, results,
    discriminating_controls: results.filter((test) => /mutant|semantic-loss/.test(test.name))
      .map((test) => ({ name: test.name, fixture: test.status,
        mutant_outcome: test.status === 'PASS' ? (test.name.startsWith('semantic-loss') ? 'RED' : 'GREEN') : 'UNPROVEN' })),
    consuming_witnesses: consumingWitnesses,
    limitations: ['in-memory store using production projection and reader', 'transport observed before network',
      'real ISL validation, central-value resolver, sampler and analysis; no deployed HTTP',
      'current UI full-graph receipt, node adapters, display and source readers; no mounted browser'],
  };
  const outputIndex = args.indexOf('--output');
  if (outputIndex >= 0) writeFileSync(resolve(args[outputIndex + 1]), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed === report.collected ? 0 : 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
