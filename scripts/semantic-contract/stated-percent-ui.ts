/**
 * The current UI's real node adapters and display/review consumers, executed
 * against CEE's full applied-graph receipt. This is local adapter evidence,
 * not a mounted browser or database witness. UI_REPO must name an unchanged
 * checkout of the exact revision below; there is no historical default.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { GraphV3 } from '../../src/schemas/cee-v3.js';
import { buildAppliedGraphWireField } from '../../src/orchestrator-v5/compose/applied-graph-emit.js';

export const STATED_PERCENT_UI_HEAD = 'e8f86b1a02bb9b68bd80f2fdbc813558eee17bfe';
type JsonObject = Record<string, unknown>;
type CanvasNode = JsonObject & { data: JsonObject };
interface UiAdapters {
  mapDraftNodeToCanvas(node: JsonObject): CanvasNode;
  overlayNode(existing: CanvasNode, node: JsonObject): CanvasNode;
  factorDisplayText(data: JsonObject): string | null;
  resolveReviewSource(node: CanvasNode): string | null;
  isReviewedByUser(node: CanvasNode): boolean;
}
export interface StatedPercentUiExpected {
  value: number;
  raw_value: number;
  unit: string;
  source: string;
  scale_frame: number;
  display_value?: string;
}

const uiFiles = [
  'src/canvas/utils/applyDraftResult.ts',
  'src/canvas/utils/mergeAppliedGraph.ts',
  'src/canvas/domain/edgeValueProvenance.ts',
  'src/canvas/components/pre-analysis/utils/isReviewedByUser.ts',
  'src/utils/formatFactorDisplayValue.ts',
  'src/canvas/utils/labelUtils.ts',
  'src/utils/formatPercent.ts',
  'src/utils/unitClassifier.ts',
  'src/utils/interventionValue.ts',
];
let adaptersPromise: Promise<UiAdapters> | undefined;

async function loadUiAdapters(): Promise<UiAdapters> {
  assert(process.env.UI_REPO, 'UI_REPO must point to the pinned UI checkout');
  const uiRepo = resolve(process.env.UI_REPO);
  const git = (...args: string[]) => execFileSync('git', ['-C', uiRepo, ...args], {
    encoding: 'utf8',
  }).trim();
  assert.equal(git('rev-parse', 'HEAD'), STATED_PERCENT_UI_HEAD, 'UI source head drift');
  assert.equal(git('status', '--porcelain', '--', 'src'), '', 'UI source is dirty');

  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild') as typeof import('esbuild');
  const allowed = new Set(uiFiles.map((file) => resolve(uiRepo, file)));
  const result = await build({
    stdin: {
      contents: [
        "export { mapDraftNodeToCanvas } from './src/canvas/utils/applyDraftResult.ts';",
        "export { overlayNode } from './src/canvas/utils/mergeAppliedGraph.ts';",
        "export { factorDisplayText } from './src/utils/formatFactorDisplayValue.ts';",
        "export { resolveReviewSource, isReviewedByUser } from './src/canvas/components/pre-analysis/utils/isReviewedByUser.ts';",
      ].join('\n'),
      resolveDir: uiRepo,
    },
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [{
      name: 'bounded-production-ui-adapters',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const candidate = args.path.startsWith('@/')
            ? resolve(uiRepo, 'src', args.path.slice(2))
            : args.path.startsWith('.') ? resolve(args.resolveDir, args.path) : args.path;
          for (const path of [candidate, `${candidate}.ts`]) {
            if (allowed.has(path)) return { path };
          }
          // Tree-shake browser/store imports unused by these pure exports.
          // No semantic function is replaced; a newly required dependency
          // survives bundling and the runtime loader below fails closed.
          return { path: args.path, external: true, sideEffects: false };
        });
      },
    }],
  });
  const bundledFiles = Object.keys(result.metafile!.inputs).map((file) => resolve(file));
  for (const file of uiFiles.slice(0, 2)) {
    assert(bundledFiles.includes(resolve(uiRepo, file)), `Actual UI adapter was not collected: ${file}`);
  }
  const module = { exports: {} };
  runInNewContext(result.outputFiles![0].text, {
    module,
    exports: module.exports,
    require: (name: string) => {
      assert.equal(name, 'zod', `Unexpected runtime UI dependency: ${name}`);
      return require(name);
    },
  });
  return module.exports as UiAdapters;
}

function asObject(value: unknown): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as JsonObject;
}

export async function assertStatedPercentUi(
  graph: unknown,
  targetId: string,
  expected: StatedPercentUiExpected,
) {
  const adapters = await (adaptersPromise ??= loadUiAdapters());
  // The routed D1 executor emits this exact helper after successful commit;
  // useConversation reconciles its full nodes, not graph_patch.after alone.
  const receipt = buildAppliedGraphWireField(GraphV3.parse(graph));
  const targets = receipt.nodes.filter((node) => asObject(node).id === targetId);
  assert.equal(targets.length, 1, 'UI receipt must bind exactly one canonical ID');
  const wireNode = asObject(targets[0]);
  const before: CanvasNode = {
    id: targetId, type: 'factor', position: { x: 17, y: 23 },
    data: { label: 'Previous display label', observedState: { value: 0.99, source: 'cee_inference' } },
  };
  const edited = adapters.overlayNode(before, wireNode);
  // The same mapper feeds full server hydration. JSON removes transient
  // references so the restored node cannot accidentally share edited state.
  const restored = adapters.mapDraftNodeToCanvas(JSON.parse(JSON.stringify(wireNode)) as JsonObject);
  const displayText = expected.display_value ?? `${expected.raw_value}%`;
  for (const [phase, node] of [['applied receipt', edited], ['restore', restored]] as const) {
    const observed = asObject(node.data.observedState);
    assert.equal(node.id, targetId, `${phase}: canonical ID`);
    for (const key of ['value', 'raw_value', 'unit', 'source'] as const) {
      assert.equal(observed[key], expected[key], `${phase}: ${key}`);
    }
    assert.equal(node.data.scale_frame, expected.scale_frame, `${phase}: scale_frame`);
    assert.equal(node.data.display_value, displayText, `${phase}: producer display`);
    assert.equal(adapters.factorDisplayText(node.data), displayText, `${phase}: actual UI display`);
    assert.equal(adapters.resolveReviewSource(node), expected.source, `${phase}: actual UI source reader`);
    assert.equal(adapters.isReviewedByUser(node), expected.source === 'user_override', `${phase}: user review state`);
  }
  assert.deepEqual(edited.position, before.position, 'Node adaptation must retain local layout');
  return {
    ui_head: STATED_PERCENT_UI_HEAD,
    node: JSON.parse(JSON.stringify({ id: restored.id, ...restored.data })) as JsonObject,
    display_text: adapters.factorDisplayText(restored.data),
    review_source: adapters.resolveReviewSource(restored),
    evidence: 'local production node adapters and display consumers; not mounted',
  };
}
