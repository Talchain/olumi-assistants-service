/** CCUX handoff: real CEE edit -> applied graph -> pinned UI display.
 * UI_REPO=/absolute/pinned/ui NODE_ENV=test node_modules/.bin/tsx scripts/semantic-contract/stated-percent-ui-loss.ts
 * Every arm must pass. Known display losses remain RED with exit status 1.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
const { GraphV3 } = await import('../../src/schemas/cee-v3.js');
const { createSetFactorValueHandler } = await import('../../src/orchestrator-v5/tools/handlers/set-factor-value.js');
const { buildHandlerInvocation } = await import('../../src/orchestrator-v5/tools/handlers/d1-shared/__tests__/fixtures.js');
const { assertStatedPercentUi, STATED_PERCENT_UI_HEAD } = await import('./stated-percent-ui.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const targetId = '3737a162';
const inputs = [0, 0.5, 1, 12, 12.5, 110];
const sourceFiles = ['set-factor-value.ts', 'd1-shared/normalise-factor-value.ts'];
const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file,
  createHash('sha256').update(readFileSync(join(root, 'src/orchestrator-v5/tools/handlers', file))).digest('hex'),
]));
const results: Array<Record<string, unknown>> = [];
for (const raw of inputs) {
  let stage = 'handler';
  let canonical: unknown;
  try {
    const graph = GraphV3.parse({ nodes: [
      { id: 'g-retention', kind: 'goal', label: 'Retain customers' },
      { id: targetId, kind: 'factor', label: 'Monthly churn' },
    ], edges: [{ from: targetId, to: 'g-retention', strength: { mean: -0.3, std: 0.01 },
      exists_probability: 1, effect_direction: 'negative' }] });
    assert.equal(graph.nodes.find((node) => node.id === targetId)?.observed_state, undefined);
    assert.equal(graph.nodes.filter((node) => node.kind === 'option').length, 0);
    const outcome = await createSetFactorValueHandler()(buildHandlerInvocation({
      graph, message: `Set Monthly churn to ${raw}%`,
      proposal: { handler_id: 'set_factor_value',
        entity: { id: targetId, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
        parameters: [{ name: 'value', value: { value: raw, unit: '%' }, operator: 'set', source: 'user_explicit' }],
        cited_context_fields: [] },
    }));
    assert(outcome.mutated_graph, 'The actual handler must apply the edit');
    const applied = GraphV3.parse(outcome.mutated_graph);
    canonical = applied.nodes.find((node) => node.id === targetId);
    stage = 'ui_consumption';
    const witness = await assertStatedPercentUi(applied, targetId, {
      value: raw / 100, raw_value: raw, unit: '%', source: 'user_override',
      scale_frame: 100, display_value: `${raw}%`,
    });
    results.push({ raw_percent: raw, status: 'PASS', display: witness.display_text, canonical });
  } catch (error) {
    const failure = error as Error & { actual?: unknown; expected?: unknown };
    results.push({ raw_percent: raw, status: 'FAIL', stage, message: failure.message,
      actual: failure.actual, expected: failure.expected, canonical });
  }
}
assert.equal(results.length, 6, 'All six display arms must be collected');
assert.deepEqual(results.map((result) => result.raw_percent), inputs, 'No arm may be skipped');
const failed = results.filter((result) => result.status === 'FAIL').length;
console.log(JSON.stringify({
  cee_head: git('rev-parse', 'HEAD'), cee_source_worktree: git('status', '--porcelain', '--', 'src'),
  cee_source_sha256: sourceHashes, ui_head: STATED_PERCENT_UI_HEAD,
  evidence: 'real local CEE handler and full applied-graph receipt into pinned UI adapters; not mounted',
  collected: results.length, passed: results.length - failed, failed, results,
}, null, 2));
process.exitCode = failed === 0 ? 0 : 1;
