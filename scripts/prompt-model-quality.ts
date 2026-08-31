/** Existing Prompt/Consumer system operator: GET snapshots, banked analysis, or explicit provider experiment. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, assertExactCaseIds } from '../tools/prompt-consumer/contract.js';
import { readServingObservation } from '../tools/prompt-consumer/live-observation.js';
import { loadDraftRuntime, draftConfiguration, captureDraft } from '../tools/prompt-consumer/runtime-draft.js';
import { buildBankedDraftSemanticReport, loadDraftSemanticPairs, oracleForDraftSemanticObservation, evaluateDraftSemanticCase, type DraftSemanticObservation, type DraftSemanticOracle } from '../tools/prompt-consumer/semantic.js';
import { compareDraftConfigurations } from '../tools/prompt-consumer/fidelity.js';
import type { ServingObservation } from '../tools/prompt-consumer/serving-evidence.js';
import { buildDraftQualityReport, buildResponseIdentityPacket } from '../tools/prompt-consumer/quality-report.js';

process.env.LOG_LEVEL = 'fatal';
const arg = (key: string) => { const n = process.argv.indexOf(key); return n < 0 ? undefined : process.argv[n + 1]; };
const out = arg('--out');
assert(out && out.startsWith('/'), 'new absolute --out path required');
assert(!existsSync(out), 'refusing to overwrite evidence');
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
if (process.argv.includes('--responses')) {
  const inputPath = arg('--input');
  assert(inputPath, '--responses requires --input with original captured response bodies');
  // Offline only. Raw HTTP captures are decoded again; serialized PASS fields,
  // administrative snapshots and caller-authored verifier callbacks are unused.
  const report = buildResponseIdentityPacket(JSON.parse(readFileSync(inputPath, 'utf8')));
  save(out, report);
  process.stdout.write(JSON.stringify({ output: out, status: report.status,
    modelCalls: 0, deploymentPermission: report.deploymentPermission }) + '\n');
  process.exitCode = report.status === 'FAIL' ? 1 : report.status === 'UNVERIFIED' ? 2 : 0;
} else if (process.argv.includes('--observe')) {
  const task = arg('--task') ?? 'draft_graph';
  const result = await readServingObservation({ baseUrl: arg('--base-url') ?? 'https://cee-staging.onrender.com', promptId: `${task}_default`,
    environment: 'staging', adminKey: process.env.ADMIN_API_KEY ?? '' });
  save(out, result);
  process.stdout.write(JSON.stringify({ observedAt: result.observedAt, output: out, methods: ['GET'], providerCall: false }) + '\n');
} else if (process.argv.includes('--banked')) {
  const report = buildBankedDraftSemanticReport(); save(out, report);
  process.stdout.write(JSON.stringify({ output: out, status: report.status, behavioralStatus: report.behavioralStatus, modelCalls: 0 }) + '\n');
  process.exitCode = report.status === 'FAIL' ? 1 : 2;
} else if (process.argv.includes('--packet')) {
  const experimentDir = arg('--experiment'), runtimeRoot = arg('--runtime-root'), expectedHead = arg('--runtime-head'), snapshotPath = arg('--snapshot');
  assert(experimentDir && runtimeRoot && expectedHead && snapshotPath, 'packet requires experiment, runtime-root/head and original snapshot');
  const report = await buildDraftQualityReport({ experimentDir, runtimeRoot, expectedHead, snapshotPath, pairId: arg('--pair') ?? 'logistics-disagreement' });
  save(out, report);
  process.stdout.write(JSON.stringify({ output: out, status: report.status, preActionEvidenceStatus: report.promotion.preActionEvidenceStatus, modelCalls: 0, promotionPermission: report.promotionPermission }) + '\n');
  process.exitCode = report.status === 'FAIL' ? 1 : report.status === 'UNVERIFIED' ? 2 : 0;
} else if (process.argv.includes('--evaluate')) {
  // Live model requests are an explicit operator choice, never a default test.
  assert(process.argv.includes('--live-provider'), '--evaluate requires explicit --live-provider; use --banked for zero-call replay');
  assert(process.env.ANTHROPIC_API_KEY, 'provider key required, never persisted');
  const runtimeRoot = arg('--runtime-root'), runtimeHead = arg('--runtime-head'), snapshotPath = arg('--snapshot'), candidatePath = arg('--candidate');
  assert(runtimeRoot && runtimeHead && snapshotPath && candidatePath, 'runtime-root/head, fresh snapshot and candidate paths required');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as ServingObservation;
  assert(snapshot.environment === 'staging' && snapshot.stored?.httpStatus === 200 && snapshot.loaded?.httpStatus === 200 && snapshot.routing?.httpStatus === 200 && snapshot.health?.httpStatus === 200, 'complete successful read-only snapshot required');
  for (const item of [snapshot.stored, snapshot.loaded, snapshot.routing, snapshot.health]) assert.equal(sha256(item.body), item.bodySha256, 'snapshot body identity');
  assert(Date.now() - Date.parse(snapshot.observedAt) < 30 * 60_000, 'snapshot is stale; observe again');
  assert(Date.parse(snapshot.observedAt) <= Date.now(), 'snapshot cannot be from the future');
  const stored = JSON.parse(snapshot.stored.body), verified = JSON.parse(snapshot.loaded.body), health = JSON.parse(snapshot.health.body);
  assert(runtimeHead.startsWith(health.build), 'target source is not the observed deployed build');
  const version = stored.stagingVersion ?? stored.activeVersion;
  const selected = stored.versions.filter((v: { version: number }) => v.version === version);
  assert.equal(selected.length, 1); assert.equal(stored.taskId, 'draft_graph');
  const incumbentText = selected[0].content as string;
  const loaded = verified.prompts.filter((p: { prompt_id: string }) => p.prompt_id === stored.id);
  assert.equal(loaded.length, 1); assert.equal(loaded[0].store_version, version);
  assert.equal(loaded[0].content_hash, sha256(incumbentText).slice(0, loaded[0].content_hash.length));
  const model = stored.modelConfig?.staging;
  assert(typeof model === 'string' && model, 'PMS model selection missing; do not substitute a default');
  const runtime = await loadDraftRuntime(runtimeRoot, runtimeHead);
  const incumbent = draftConfiguration(runtime, { id: stored.id, version, content: incumbentText, sha256: sha256(incumbentText) }, model);
  const candidateText = readFileSync(candidatePath, 'utf8');
  const candidate = draftConfiguration(runtime, { id: stored.id, version: 'unpromoted-candidate', content: candidateText, sha256: sha256(candidateText) }, model);
  const corpusPath = arg('--corpus');
  const corpus: Array<{ id: string; diagnostic: string; decision: string; diagnosticOracle?: DraftSemanticOracle; decisionOracle?: DraftSemanticOracle }> = corpusPath
    ? JSON.parse(readFileSync(corpusPath, 'utf8')).pairs : [...loadDraftSemanticPairs()];
  const pairId = arg('--pair') ?? 'logistics-disagreement';
  const pairs = corpus.filter(p => p.id === pairId);
  assert.equal(pairs.length, 1, 'select one named independent pair; no accidental full battery');
  mkdirSync(out);
  const assuranceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const assuranceDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  assert(!assuranceDirty, 'commit the assurance runner before recording exact-head provider evidence');
  const identity = { format: 'olumi.prompt-model-experiment.v1', at: new Date().toISOString(), assuranceHead, assuranceDirty,
    snapshotSha256: sha256(readFileSync(snapshotPath, 'utf8')),
    incumbent, candidate, runtimeComponents: runtime.components, sdkPath: runtime.sdkPath,
    corpusSha256: sha256(JSON.stringify(corpus)),
    taskScope: 'local production adapter under recorded settings; upstream pipeline/deployed fidelity UNVERIFIED', promoted: false };
  save(resolve(out, 'identity.json'), identity);
  const cases = [], comparisons = [];
  for (const pair of pairs) for (const direction of ['diagnostic', 'decision'] as const) {
    const twin = [];
    for (const arm of ['incumbent', 'candidate'] as const) {
      const configuration = arm === 'incumbent' ? incumbent : candidate;
      const result = await captureDraft(runtime, configuration, pair[direction]);
      const primaryText = result.capture.response?.content?.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
      let raw: unknown; try { raw = JSON.parse(primaryText ?? ''); } catch { raw = null; }
      const observation: DraftSemanticObservation = { id: `${pair.id}-${direction}-1-${arm}`, pairId: pair.id, arm, direction, repetition: 1,
        brief: pair[direction], raw, consumedGraph: result.capture.consumedGraph ?? null, primaryResponseText: primaryText, evidenceKind: 'provider-capture' };
      // Source-correct semantic implementation is attached by the runtime loader.
      // If unavailable, no fallback to assurance-branch code may certify the run.
      const semantic = evaluateDraftSemanticCase({ observation, oracle: (direction === 'diagnostic' ? pair.diagnosticOracle : pair.decisionOracle) ?? oracleForDraftSemanticObservation(observation), implementations: runtime.semanticImplementations,
        fidelity: { status: result.fidelity.status, rawSha256: result.fidelity.rawSha256 ?? '', consumedSha256: result.fidelity.consumedSha256 ?? '', briefSha256: result.fidelity.briefSha256,
          componentSourceHashes: runtime.semanticImplementations.sourceHashes,
          scope: result.runnerScope } });
      const full = { identity, configuration, ...result, observation, semantic };
      save(resolve(out, `${observation.id}.json`), full); cases.push(full); twin.push(full);
      process.stdout.write(JSON.stringify({ id: observation.id, fidelity: result.fidelity.status, structural: result.fidelity.structuralStatus, semantic: semantic.semanticStatus, behavioral: semantic.behavioralStatus, error: result.error }) + '\n');
    }
    comparisons.push(compareDraftConfigurations(incumbent, candidate, twin[0]!.capture, twin[1]!.capture));
  }
  assertExactCaseIds(pairs.flatMap(p => ['diagnostic', 'decision'].flatMap(d => ['incumbent', 'candidate'].map(a => `${p.id}-${d}-1-${a}`))), cases.map(c => c.observation.id));
  const summary = { identity, comparisons, cases: cases.map(c => ({ id: c.observation.id, fidelity: c.fidelity, semantic: c.semantic })), promotionPermission: 'NOT_GRANTED' };
  save(resolve(out, 'summary.json'), summary);
  process.exitCode = cases.some(c => c.fidelity.status === 'FAIL' || c.fidelity.structuralStatus === 'FAIL' || c.semantic.semanticStatus === 'FAIL') ? 1 : 2;
} else throw new Error('Choose --responses --input, --observe, --banked, --packet, or --evaluate --live-provider. No promotion command exists.');
