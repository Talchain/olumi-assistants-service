/**
 * Rebuild the Starter-point control with only the pinned detached staging code.
 * Run from /private/tmp/b2zs-staging-69ff with `node --import tsx <this file>`.
 * The witness inputs and output live beside this script; no branch code imports.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Rec = Record<string, any>;
const STAGING_HEAD = '69ff73cf180efb4099c10446197661a33f9777da';
const STAGING_ROOT = realpathSync('/private/tmp/b2zs-staging-69ff');
const FIXTURE_ROOT = new URL('./', import.meta.url);
const GOAL = 'monthly_recurring_revenue';
const KEEP = 'keep_current_pricing';
const STARTER = 'launch_starter_tier';
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const git = (...args: string[]): string => execFileSync('git', ['-C', STAGING_ROOT, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const trackedChanges = (): string => git('status', '--porcelain', '--untracked-files=no');

assert.equal(realpathSync(process.cwd()), STAGING_ROOT, 'Run the generator from the detached staging worktree.');
assert.equal(git('rev-parse', 'HEAD'), STAGING_HEAD, 'The code source must be the pinned staging SHA.');
assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'The staging worktree must remain detached.');
assert.equal(trackedChanges(), '', 'The staging code must have no tracked changes.');

const codePaths = [
  'src/orchestrator-v5/goal-target/goal-chance-licence.ts',
  'src/orchestrator-v5/goal-target/goal-chance-range-agent.ts',
  'src/orchestrator-v5/agent-lane/goal-chance-screen-lines.ts',
  'src/orchestrator-v5/compose/goal-probability-transport.ts',
  'src/routes/canonical-analysis-view.ts',
];
const codeHashes = Object.fromEntries(codePaths.map(relative => {
  const actual = readFileSync(join(STAGING_ROOT, relative));
  const committed = execFileSync('git', ['-C', STAGING_ROOT, 'show', `${STAGING_HEAD}:${relative}`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(hash(actual), hash(committed), `${relative} must be staging's committed bytes.`);
  return [relative, hash(actual)];
}));
const [licenceModule, factsModule, screenModule, transportModule, canonicalModule] = await Promise.all(
  codePaths.map(relative => import(pathToFileURL(join(STAGING_ROOT, relative)).href)),
);
const { goalChanceLicenceOf, withGoalChanceLicence } = licenceModule;
const { goalChanceFactsForAgent } = factsModule;
const { goalChanceScreenLinesForAgent } = screenModule;
const { projectGoalProbabilitiesForTransport } = transportModule;
const { projectCanonicalAnalysisView } = canonicalModule;

const witnessBytes = (name: string): Buffer => readFileSync(new URL(name, FIXTURE_ROOT));
const RUN: Rec = JSON.parse(witnessBytes('run.json').toString('utf8'));
const WIRE: Rec = JSON.parse(witnessBytes('read-graph-1791489457020.json').toString('utf8'));
const READ = WIRE.j;
const sourceBlock = RUN.blocks.find((block: Rec) => block.type === 'analysis_result');
assert.ok(sourceBlock, 'The stored Run must contain its analysis_result.');
assert.equal(hash(witnessBytes('run.json')), 'efc9c5380431027aec9d7d902bc91d1a496af2c74258b8846d9ac4339ed2e2e5');
assert.equal(hash(witnessBytes('read-graph-1791489457020.json')),
  'b2a372adca05d3eb0baa91c9eb6b76a7cfa04cd7ce42328d8de8e80bfb5c47e4');

// The same producerEnvelope(true) reconstruction as b2-zero-spread.test.ts.
const envelope = structuredClone(sourceBlock.enrichment);
envelope.option_comparison.find((row: Rec) => row.option_id === KEEP).probability_of_goal = 0;
envelope.option_comparison.find((row: Rec) => row.option_id === STARTER).probability_of_goal = 0.97;
const graph = READ.graph;
const licence = goalChanceLicenceOf(envelope, graph, GOAL);
const enrichment = withGoalChanceLicence(envelope, graph, GOAL);
const publicEnrichment = projectGoalProbabilitiesForTransport(enrichment, RUN.goal_certainty);
assert.notEqual(publicEnrichment, undefined, 'The stored B2 Run must produce enrichment.');
const currentResult = { ...sourceBlock, enrichment: publicEnrichment };
const runFact = { fact_type: 'run_analysis', result: {
  scenario_id: READ.scenario_id, run_id: READ.current_read.run_id,
  graph_hash_at_run: READ.current_read.computed_against_hash,
  computed_at: READ.current_read.run_state.computed_at,
  goal_certainty: RUN.goal_certainty, summary: currentResult.summary, enrichment,
} };
const canonicalView = projectCanonicalAnalysisView({ revision: 2, graph, runFact,
  derivation: { freshness: 'fresh', reason: 'graph_hash_match' },
  analysisState: READ.analysis_state, analysisReady: READ.current_read.analysis_ready,
  currentResult });
const fixture = {
  source_head: STAGING_HEAD,
  fixture_derivation: 'Stored public Run + read graph; restore Keep p=0 from lane witness (public transport stripped it), add Starter p=0.97 as control; retain every stored warning.',
  licence, enrichment, public_enrichment: publicEnrichment, canonical_view: canonicalView,
  agent_facts: goalChanceFactsForAgent(currentResult, graph, true),
  screen_lines: goalChanceScreenLinesForAgent(currentResult, graph, true),
};
assert.equal(trackedChanges(), '', 'Generation must leave staging code unchanged.');
const destination = new URL('starter-point-staging.json', FIXTURE_ROOT);
writeFileSync(destination, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(JSON.stringify({
  source_head: STAGING_HEAD,
  code_root: STAGING_ROOT,
  execution_cwd: realpathSync(process.cwd()),
  detached: true,
  tracked_changes_before: '', tracked_changes_after: trackedChanges(),
  code_imports: codePaths.map(relative => join(STAGING_ROOT, relative)),
  code_sha256: codeHashes,
  witness_sha256: {
    'run.json': hash(witnessBytes('run.json')),
    'read-graph-1791489457020.json': hash(witnessBytes('read-graph-1791489457020.json')),
  },
  generator: fileURLToPath(import.meta.url),
  generator_sha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  output: fileURLToPath(destination),
  output_sha256: hash(readFileSync(destination)),
  option_cells: canonicalView.options.map((row: Rec) => ({ option_id: row.option_id, cell: row.cell })),
}));
