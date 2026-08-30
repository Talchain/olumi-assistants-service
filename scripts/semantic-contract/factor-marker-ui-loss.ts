/**
 * Reproduce factor-marker deletion loss through real production adapters.
 *
 * UI_REPO=/absolute/pinned/ui NODE_ENV=test node_modules/.bin/tsx \
 *   scripts/semantic-contract/factor-marker-ui-loss.ts
 *
 * Required meaning: a model-created ignorance prior superseded by an accepted
 * user point stays absent after the full receipt, UI overlay and autosave
 * readback. A genuine supplied prior must remain unchanged. Contradictions
 * exit 1; an expected defect is never converted into a green test.
 *
 * Evidence: local handler/receipt/UI/autosave adapters, not a mounted browser,
 * database commit, release clearance or rendered EstimateMarker witness.
 * CCUX handoff: src/canvas/utils/mergeAppliedGraph.ts overlayNode retains
 * existing node.data keys absent from the receipt; projectAutosaveData in
 * src/canvas/store/autosaveProjection.ts persists those nodes unchanged.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { GraphV3 } from '../../src/schemas/cee-v3.js';
import { createSetFactorValueHandler } from '../../src/orchestrator-v5/tools/handlers/set-factor-value.js';
import { buildHandlerInvocation } from '../../src/orchestrator-v5/tools/handlers/d1-shared/__tests__/fixtures.js';
import { buildAppliedGraphWireField } from '../../src/orchestrator-v5/compose/applied-graph-emit.js';

type JsonObject = Record<string, unknown>;
type CanvasNode = JsonObject & { data: JsonObject };
const UI_HEAD = 'e8f86b1a02bb9b68bd80f2fdbc813558eee17bfe';
const TARGET = 'marker-factor';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8',
}).trim();
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const sourceHash = (repo: string, file: string) => hash(readFileSync(join(repo, file)));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function object(value: unknown): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as JsonObject;
}

assert(process.env.UI_REPO, 'UI_REPO must name the exact unchanged UI checkout');
const uiRepo = resolve(process.env.UI_REPO);
assert.equal(git(uiRepo, 'rev-parse', 'HEAD'), UI_HEAD, 'UI source head drift');
assert.equal(git(uiRepo, 'status', '--porcelain', '--', 'src'), '', 'UI source is dirty');
const uiFiles = [
  'src/canvas/utils/applyDraftResult.ts',
  'src/canvas/utils/mergeAppliedGraph.ts',
  'src/canvas/domain/edgeValueProvenance.ts',
  'src/canvas/store/autosaveProjection.ts',
];
const allowed = new Set(uiFiles.map((file) => resolve(uiRepo, file)));
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild') as typeof import('esbuild');
const bundle = await build({
  stdin: {
    contents: [
      "export { mapDraftNodeToCanvas } from './src/canvas/utils/applyDraftResult.ts';",
      "export { overlayNode } from './src/canvas/utils/mergeAppliedGraph.ts';",
      "export { projectAutosaveData } from './src/canvas/store/autosaveProjection.ts';",
    ].join('\n'),
    resolveDir: uiRepo,
  },
  bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'bounded-real-ui-adapters',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        const candidate = args.path.startsWith('.') ? resolve(args.resolveDir, args.path) : args.path;
        for (const path of [candidate, `${candidate}.ts`]) {
          if (allowed.has(path)) return { path };
        }
        // These exports do not use the browser/store modules. Tree-shake
        // their imports, never replace a semantic adapter. A newly needed
        // runtime dependency fails closed in the loader below.
        return { path: args.path, external: true, sideEffects: false };
      });
    },
  }],
});
const collected = Object.keys(bundle.metafile!.inputs).map((file) => resolve(file));
for (const file of uiFiles) assert(collected.includes(resolve(uiRepo, file)), `Adapter not collected: ${file}`);
const module = { exports: {} };
runInNewContext(bundle.outputFiles![0].text, {
  module, exports: module.exports,
  require: (name: string) => {
    assert.equal(name, 'zod', `Unexpected runtime UI dependency: ${name}`);
    return require(name);
  },
});
const ui = module.exports as {
  mapDraftNodeToCanvas(node: JsonObject): CanvasNode;
  overlayNode(existing: CanvasNode, node: JsonObject): CanvasNode;
  projectAutosaveData(source: JsonObject, timestamp: number): { nodes: CanvasNode[] };
};

// Bind the installed shared helper to the exact vendored package, including
// while FQ supplies a reviewed replacement pack. Never trust the version alone.
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const schemaDependency = manifest.dependencies['@talchain/schemas'];
assert(schemaDependency.startsWith('file:'), 'Expected an explicit vendored schema package');
const schemaPack = resolve(root, schemaDependency.slice('file:'.length));
const packedHelper = execFileSync('tar', ['-xOf', schemaPack, 'package/dist/factor-quantification.js']);
const installedHelper = readFileSync(join(dirname(fileURLToPath(import.meta.resolve('@talchain/schemas'))), 'factor-quantification.js'));
assert.equal(hash(installedHelper), hash(packedHelper), 'Installed cleanup helper differs from vendored package');

const reasoning = { rationale: 'Old model estimate; now superseded.', context_basis: ['fixture_context'] };
const genuinePrior = {
  distribution: 'uniform', range_min: 0.1, range_max: 0.4, source: 'brief_extraction',
  reasoning: { rationale: 'Preserved prior explanation.', context_basis: ['fixture_prior_record'] },
};
const cases = [
  {
    name: 'superseded-model-ignorance-prior',
    prior: { distribution: 'uniform', range_min: 0, range_max: 1, source: 'cee_inference', prior_is_unquantified: true },
    priorMustSurvive: false,
  },
  { name: 'genuine-supplied-prior-control', prior: genuinePrior, priorMustSurvive: true },
] as const;
assert.equal(cases.length, 2, 'Exact behavioral case collection');
const results: JsonObject[] = [];
const handler = createSetFactorValueHandler();
for (const testCase of cases) {
  const original = GraphV3.parse({
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Retain customers' },
      {
        id: TARGET, kind: 'factor', label: 'Monthly churn', scale_frame: 100,
        observed_state: {
          value: 0.5, raw_value: 50, unit: '%', source: 'cee_inference',
          value_tier: 'fallback_default', reasoning, extractionType: 'inferred',
        },
        prior: testCase.prior,
      },
    ],
    edges: [{ from: TARGET, to: 'goal', strength: { mean: -0.3, std: 0.01 }, exists_probability: 1, effect_direction: 'negative' }],
  });
  const originalSnapshot = clone(original);
  const result = await handler(buildHandlerInvocation({
    graph: original,
    message: 'Set monthly churn to 0 percent.',
    proposal: {
      handler_id: 'set_factor_value',
      entity: { id: TARGET, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [{ name: 'value', value: { value: 0, unit: '%' }, source: 'user_explicit' }],
      cited_context_fields: [],
    },
  }));
  assert.deepEqual(original, originalSnapshot, 'Accepted handler must not mutate input');
  assert(result.mutated_graph, 'Actual accepted handler did not emit its graph');
  const canonical = GraphV3.parse(clone(result.mutated_graph));
  const receipt = buildAppliedGraphWireField(canonical);
  const wireMatches = receipt.nodes.filter((node) => object(node).id === TARGET);
  assert.equal(wireMatches.length, 1, 'Exactly one canonical target reaches the full receipt');
  const canonicalNode = object(wireMatches[0]);
  const before = ui.mapDraftNodeToCanvas(object(original.nodes.find((node) => node.id === TARGET)));
  const canvas = ui.overlayNode(before, canonicalNode);
  const saved = ui.projectAutosaveData({
    nodes: [canvas], edges: [], scenarioId: 'fixture-marker-cleanup', ceeAnalysisReady: undefined,
    selectedGoalNode: undefined, analysis: null, goalConstraints: null,
  }, 0);
  const restored = clone(saved).nodes[0];
  const failures: JsonObject[] = [];
  const check = (claim: string, assertion: () => void) => {
    try { assertion(); } catch (error) {
      const failure = error as Error & { actual?: unknown; expected?: unknown };
      failures.push({ claim, message: failure.message, actual: failure.actual, expected: failure.expected });
    }
  };
  for (const [phase, data, observedKey] of [
    ['canonical receipt', canonicalNode, 'observed_state'],
    ['canvas overlay', canvas.data, 'observedState'],
    ['autosave JSON readback', restored.data, 'observedState'],
  ] as const) {
    const observed = object(data[observedKey]);
    check(`${phase}: finite user zero`, () => assert(Number.isFinite(observed.value) && observed.value === 0));
    check(`${phase}: source`, () => assert.equal(observed.source, 'user_override'));
    check(`${phase}: raw value and unit`, () => assert.deepEqual([observed.raw_value, observed.unit], [0, '%']));
    check(`${phase}: cleared reasoning`, () => assert.equal(Object.hasOwn(observed, 'reasoning'), false));
    check(`${phase}: cleared value tier`, () => assert.equal(Object.hasOwn(observed, 'value_tier'), false));
    check(`${phase}: prior conservation`, () => {
      if (testCase.priorMustSurvive) assert.deepEqual(clone(data.prior), genuinePrior);
      else assert.equal(Object.hasOwn(data, 'prior'), false, 'Superseded model prior must stay absent');
    });
  }
  results.push({
    case: testCase.name, result: failures.length ? 'FAIL' : 'PASS', failures,
    prior_present: {
      canonical: Object.hasOwn(canonicalNode, 'prior'),
      canvas: Object.hasOwn(canvas.data, 'prior'),
      restored: Object.hasOwn(restored.data, 'prior'),
    },
    restored_observed_state: restored.data.observedState,
    canonical_receipt_node: canonicalNode,
    canvas_overlay_node: canvas,
    autosave_readback_node: restored,
  });
}
assert.equal(results.length, cases.length, 'Every collected case must execute');
const failed = results.filter((result) => result.result === 'FAIL').length;
console.log(JSON.stringify({
  evidence_rung: 'LOCAL_PRODUCTION_ADAPTERS; not mounted or database-witnessed',
  identity: {
    cee_head: git(root, 'rev-parse', 'HEAD'),
    cee_dirty_source: git(root, 'status', '--porcelain', '--', 'src'),
    handler_sha256: sourceHash(root, 'src/orchestrator-v5/tools/handlers/set-factor-value.ts'),
    receipt_sha256: sourceHash(root, 'src/orchestrator-v5/compose/applied-graph-emit.ts'),
    fixture_sha256: sourceHash(root, 'scripts/semantic-contract/factor-marker-ui-loss.ts'),
    schema_pack_sha256: hash(readFileSync(schemaPack)),
    schema_helper_sha256: hash(installedHelper),
    ui_head: UI_HEAD,
    ui_sources_sha256: Object.fromEntries(uiFiles.map((file) => [file, sourceHash(uiRepo, file)])),
  },
  collected: cases.length, executed: results.length, passed: results.length - failed, failed, results,
}, null, 2));
if (failed > 0) process.exitCode = 1;
