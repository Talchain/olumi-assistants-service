import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { __test_only } from '../../src/adapters/llm/anthropic.js';
import { loadActivationEvidence } from './activation.js';
import { sha256, assertExactCaseIds } from './contract.js';
import { buildContractManifest } from './manifest.js';
import { digest, type DraftConfiguration } from './fidelity.js';
import { localDraftSemanticImplementations } from './semantic.js';
import { compareContractSourceClosures, loadQualityPair, readContractSourceClosure, replayDraftQualityFacts, type DraftExperimentCase, type DraftExperimentIdentity, type DraftQualityAuthority } from './quality-report.js';
import type { ReadOnlyGetCapture, ServingObservation } from './serving-evidence.js';

const names = ['original-body-replay', 'serialized-pass-ignored', 'exact-collection', 'cross-case-refusal', 'wrong-prompt-model', 'semantic-destruction', 'unrelated-object', 'source-oracles', 'runtime-drift', 'composition-required', 'whole-source-closure', 'wrong-health-source', 'capture-recorder-authority', 'secondary-model-identity'] as const;
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds(names, collected));
const test = (name: typeof names[number], run: () => void) => it(name, () => { collected.push(name); run(); });
const root = resolve(import.meta.dirname, '../..');
const source = (path: string, exportName: string) => ({ path, exportName, sha256: sha256(readFileSync(resolve(root, path), 'utf8')) });
type Facts = Parameters<typeof replayDraftQualityFacts>[0];
let original: Facts;
const copy = (): Facts => ({ ...original, ...structuredClone({ identity: original.identity, cases: original.cases, snapshot: original.snapshot }) });
const get = (path: string, value: unknown): ReadOnlyGetCapture => {
  const body = JSON.stringify(value);
  return { method: 'GET', url: `https://offline-control.invalid${path}`, httpStatus: 200, body, bodySha256: sha256(body) };
};

beforeAll(async () => {
  // Original emitted/consumed provider bodies, but requests below are replay
  // controls. This is never advertised as another real provider experiment.
  const bank = loadActivationEvidence().codeOnly!;
  const impl = localDraftSemanticImplementations();
  const components = [source('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'), source('src/cee/draft/records/seam.ts', 'projectDraftRecords'),
    source('src/cee/draft/records/projector.ts', 'projectRecordsToGraph'), source('src/adapters/llm/shared-schemas.ts', 'LLMDraftResponse.parse')];
  const blocks = bank.cases[0]!.captures.find(c => c.kind === 'draft')!.request.system as Array<{ text: string }>;
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const incumbent: DraftConfiguration = { task: 'draft_graph', sourceHead: head, sourceDirty: false,
    prompt: { id: 'draft_graph_default', version: 195, content: blocks[0]!.text, sha256: sha256(blocks[0]!.text) },
    model: { id: 'claude-sonnet-4-6', provider: 'anthropic', resolutionSource: 'store_model_config' },
    instruction: { content: blocks[1]!.text, sha256: sha256(blocks[1]!.text) }, grammar: { schema: impl.buildGrammar(), sha256: digest(impl.buildGrammar()) },
    parser: components[1]!, projector: components[2]!, consumer: components[3]! };
  const text = readFileSync(resolve(root, 'Prompts/candidates/draft_graph_records.txt'), 'utf8');
  const candidate: DraftConfiguration = { ...incumbent, prompt: { ...incumbent.prompt, version: 'unpromoted-candidate', content: text, sha256: sha256(text) } };
  const snapshot: ServingObservation = { environment: 'staging', observedAt: '2026-08-31T09:00:00Z', instanceId: null,
    stored: get('/admin/prompts/draft_graph_default', { id: 'draft_graph_default', taskId: 'draft_graph', activeVersion: 195, stagingVersion: 195,
      modelConfig: { staging: incumbent.model.id }, versions: [{ version: 195, content: incumbent.prompt.content, createdAt: '2026-08-30T10:00:00Z', createdBy: 'offline-control' }] }),
    loaded: get('/admin/prompts/verify', { prompts: [{ prompt_id: 'draft_graph_default', source: 'store', store_version: 195, content_hash: incumbent.prompt.sha256.slice(0, 16),
      content_length: incumbent.prompt.content.length, first_100_chars: incumbent.prompt.content.slice(0, 100), last_100_chars: incumbent.prompt.content.slice(-100), loaded_at: '2026-08-31T09:00:00Z' }] }),
    routing: get('/admin/models/routing', { tasks: [{ task: 'draft_graph', model: 'claude-sonnet-5', provider: 'anthropic', source: 'env_override' }] }),
    health: get('/healthz', { build: head.slice(0, 8) }) };
  const snapshotSha256 = digest(snapshot), pairId = 'logistics-disagreement';
  const identity: DraftExperimentIdentity = { format: 'olumi.prompt-model-experiment.v1', snapshotSha256, corpusSha256: loadQualityPair(pairId).corpusSha256,
    incumbent, candidate, runtimeComponents: components, promoted: false, assuranceHead: head, assuranceDirty: false };
  const cases: DraftExperimentCase[] = [], expectedMessagesByCaseId: Record<string, unknown> = {};
  const declaredEnvironment = Object.fromEntries(['CEE_ANTHROPIC_STRUCTURED_OUTPUTS', 'CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED', 'CEE_DRAFT_TEMPERATURE'].map(key => [key, process.env[key] ?? null]));
  for (const direction of ['diagnostic', 'decision'] as const) for (const arm of ['incumbent', 'candidate'] as const) {
    const item = bank.cases.find(c => c.summary!.direction === direction)!, primary = item.captures.find(c => c.kind === 'draft')!;
    const config = arm === 'incumbent' ? incumbent : candidate;
    const request = structuredClone(primary.request);
    (request.system as Array<{ text: string }>)[0]!.text = config.prompt.content;
    const id = `${pairId}-${direction}-1-${arm}`;
    const prompt = await __test_only.buildDraftPrompt({ brief: item.brief, docs: [], model: config.model.id, seed: 1 }, { preloadedSystemPrompt: config.prompt.content });
    expectedMessagesByCaseId[id] = [{ role: 'user', content: prompt.userContent }];
    request.messages = expectedMessagesByCaseId[id];
    const response = structuredClone(primary.response), graph = structuredClone(item.consumed.graph);
    const capture = { sourceHead: head, brief: item.brief, scope: 'synthetic-control' as const, transport: 'replay' as const, request, response, consumedGraph: graph };
    cases.push({ identity, configuration: config, capture, captures: [{ kind: 'draft', request, response }], consumed: { graph }, declaredSettings: { environment: declaredEnvironment },
      observation: { id, pairId, arm, direction, repetition: 1, brief: item.brief, raw: structuredClone(item.raw), consumedGraph: graph,
        primaryResponseText: response.content.filter(c => c.type === 'text').map(c => c.text).join(''), evidenceKind: 'synthetic-mutation' } });
  }
  const runtimeAuthority: DraftQualityAuthority = { sourceHead: head, configurations: { incumbent, candidate }, components, semanticImplementations: impl,
    implementations: { parserIdentity: components[1]!, projectorIdentity: components[2]!, consumerIdentity: components[3]!, parse: impl.projectRecords, consume: graph => impl.parseGraph(graph) },
    contractSourceAgreement: compareContractSourceClosures(readContractSourceClosure(root), { ...readContractSourceClosure(root), srcTree: 'f'.repeat(40) }), expectedMessagesByCaseId, declaredEnvironment };
  original = { identity, cases, snapshot, snapshotSha256, pairId, runtimeAuthority, foundation: buildContractManifest() };
});

describe('quality packet replay refuses false certification', () => {
  test('original-body-replay', () => {
    const report = replayDraftQualityFacts(copy());
    expect(report.collectionStatus).toBe('PASS'); expect(report.cases).toHaveLength(4);
    expect(report.cases.every(c => c.fidelity.participation.parser.calls === 1 && c.fidelity.participation.consumer.calls === 2)).toBe(true);
    expect(report.cases.every(c => c.semantic.behavioralStatus === 'UNVERIFIED')).toBe(true);
    expect(report.promotion.checks.candidateCache.status).toBe('UNVERIFIED');
    expect(report.promotion.checks.rollbackCache.status).toBe('UNVERIFIED');
    expect(report.promotion.operations.promotionPerformed).toBe(false);
    expect(report.authoritativeManifest.targetRuntime.serving.configuredModels[0]).toMatchObject({ pmsModel: 'claude-sonnet-4-6', routerModel: 'claude-sonnet-5' });
    expect(report.authoritativeManifest.targetRuntime.deployedProvider).toBe('UNVERIFIED');
    expect(report.captureRunner).toMatchObject({ assuranceHead: original.identity.assuranceHead, assuranceDirty: false, status: 'PASS' });
    expect(report.captureRunner.sources).toHaveLength(2);
    expect(report.replayRunner.assuranceHead).toBe(original.foundation!.sourceHead);
  });
  test('serialized-pass-ignored', () => {
    const input = copy();
    for (const item of input.cases) { item.fidelity = { status: 'PASS' }; item.semantic = { status: 'PASS' }; item.oracle = { alwaysPass: true }; }
    const report = replayDraftQualityFacts(input);
    expect(report.cases[0]!.semantic.semanticStatus).toBe('FAIL');
    expect(report.cases[0]!.semantic.assertionResults.some(a => a.id === 'diagnostic.non-collapse' && a.status === 'FAIL')).toBe(true);
  });
  test('exact-collection', () => {
    const input = copy();
    expect(() => replayDraftQualityFacts({ ...input, cases: input.cases.slice(1) })).toThrow(/collected/);
    expect(() => replayDraftQualityFacts({ ...input, cases: [...input.cases, input.cases[0]!] })).toThrow(/collected/);
  });
  test('cross-case-refusal', () => {
    const input = copy(); input.cases[0]!.capture.brief = input.cases[2]!.capture.brief;
    expect(() => replayDraftQualityFacts(input)).toThrow(/another brief/);
  });
  test('wrong-prompt-model', () => {
    const input = copy(); input.cases[0]!.capture.request.model = 'claude-sonnet-5';
    const report = replayDraftQualityFacts(input);
    expect(report.cases[0]!.fidelity.status).toBe('FAIL');
    expect(report.receipts.provider.verdict.status).toBe('FAIL');
    const wrong = copy(); (wrong.cases[1]!.capture.request.system as Array<{ text: string }>)[0]!.text = 'Teapot uncertainty';
    expect(replayDraftQualityFacts(wrong).cases[1]!.fidelity.status).toBe('FAIL');
  });
  test('semantic-destruction', () => {
    const input = copy(), item = input.cases[3]!;
    const raw = structuredClone(item.observation.raw) as { stated_items: Array<{ source_quote: string }> };
    raw.stated_items[1]!.source_quote = 'cut missed delivery windows';
    item.capture.response!.content![0]!.text = JSON.stringify(raw);
    item.observation = { ...item.observation, raw };
    const report = replayDraftQualityFacts(input), result = report.cases[3]!;
    expect(result.fidelity.structuralStatus).toBe('PASS');
    expect(result.semantic.assertionResults.find(a => a.id === 'action.authored-1')!.status).toBe('FAIL');
    expect(result.semantic.assertionResults.find(a => a.id === 'action.authored-2')!.status).toBe('PASS');
  });
  test('unrelated-object', () => {
    const input = copy(), item = input.cases[3]!;
    const graph = item.capture.consumedGraph as { nodes: Array<{ kind: string; label: string }> };
    graph.nodes.find(n => n.kind === 'risk')!.label = 'The porcelain teapot is a brass telescope';
    const result = replayDraftQualityFacts(input).cases[3]!;
    expect(result.fidelity.structuralStatus).toBe('PASS');
    expect(result.semantic.assertionResults.filter(a => a.id.startsWith('action.')).every(a => a.status === 'PASS')).toBe(true);
  });
  test('source-oracles', () => {
    const pair = loadQualityPair('logistics-disagreement-reworded-v1');
    expect(pair.pair.diagnosticOracle!.briefSha256).toBe(sha256(pair.pair.diagnostic));
    expect(pair.pair.decisionOracle!.actions).toHaveLength(2);
    expect(() => loadQualityPair('teapot-confidence')).toThrow(/unknown semantic pair/);
  });
  test('runtime-drift', () => {
    const input = copy();
    const report = replayDraftQualityFacts(input);
    expect(report.receipts.structural.verdict.status).toBe('UNVERIFIED');
    expect(report.receipts.structural.verdict.issues.join(' ')).toContain('do not execute target source');
    const components = structuredClone(input.runtimeAuthority.components); components[2]!.sha256 = 'f'.repeat(64);
    expect(() => replayDraftQualityFacts({ ...input, runtimeAuthority: { ...input.runtimeAuthority, components } })).toThrow(/runtime sources differ/);
  });
  test('composition-required', () => {
    const input = copy();
    const report = replayDraftQualityFacts({ ...input, runtimeAuthority: { ...input.runtimeAuthority, expectedMessagesByCaseId: {} } });
    expect(report.cases.every(c => c.fidelity.status === 'UNVERIFIED')).toBe(true);
    const changed = copy(); changed.cases[0]!.declaredSettings = { environment: { unexpected: 'flag' } };
    expect(() => replayDraftQualityFacts(changed)).toThrow(/runtime flags/);
  });
  test('whole-source-closure', () => {
    const actual = readContractSourceClosure(root);
    expect(actual.sourceDirty).toBe(false);
    expect(compareContractSourceClosures(actual, actual).status).toBe('PASS');
    // A projector-only commit changes the src tree while every previously
    // enumerated entrypoint may remain identical. It cannot pass this closure.
    const projectorChanged = { ...actual, srcTree: 'f'.repeat(40) };
    expect(compareContractSourceClosures(actual, projectorChanged).status).toBe('UNVERIFIED');
    for (const key of ['packageSha256', 'lockSha256', 'vendorTree'] as const) {
      expect(compareContractSourceClosures(actual, { ...actual, [key]: 'e'.repeat(key === 'vendorTree' ? 40 : 64) }).status).toBe('UNVERIFIED');
    }
    expect(compareContractSourceClosures(actual, { ...actual, sourceDirty: true }).status).toBe('UNVERIFIED');
    expect(compareContractSourceClosures(actual, { ...actual, sourceDirty: null }).status).toBe('UNVERIFIED');
    expect(compareContractSourceClosures(actual, { ...actual, notes: 'A telescope replaced an unrelated teapot' } as typeof actual).status).toBe('PASS');
  });
  test('wrong-health-source', () => {
    const input = copy();
    input.snapshot = { ...input.snapshot, health: get('/healthz', { build: 'f'.repeat(8) }) };
    input.snapshotSha256 = digest(input.snapshot);
    input.identity.snapshotSha256 = input.snapshotSha256;
    const report = replayDraftQualityFacts(input);
    expect(report.authoritativeManifest.targetRuntime.serving.levels.selected.status).toBe('PASS');
    expect(report.authoritativeManifest.targetRuntime.serving.levels.loaded.status).toBe('PASS');
    expect(report.authoritativeManifest.targetRuntime.serving.levels.deployed.status).toBe('FAIL');
    expect(report.status).toBe('FAIL');
    expect(report.knownServingIdentityFailures.map(failure => failure.level)).toContain('deployed');
    const unrelated = copy();
    unrelated.snapshot = { ...unrelated.snapshot, health: get('/healthz', { build: unrelated.runtimeAuthority.sourceHead.slice(0, 8), note: 'A telescope replaced an unrelated teapot' }) };
    unrelated.snapshotSha256 = digest(unrelated.snapshot);
    unrelated.identity.snapshotSha256 = unrelated.snapshotSha256;
    const control = replayDraftQualityFacts(unrelated);
    expect(control.authoritativeManifest.targetRuntime.serving.levels.deployed.status).toBe('PASS');
    expect(control.knownServingIdentityFailures).toEqual([]);
    expect(control.status).toBe('UNVERIFIED');
  });
  test('capture-recorder-authority', () => {
    const missing = copy(); delete missing.identity.assuranceHead; delete missing.identity.assuranceDirty;
    const unknown = replayDraftQualityFacts(missing);
    expect(unknown.captureRunner.status).toBe('UNVERIFIED');
    expect(unknown.receipts.provider.verdict.status).toBe('UNVERIFIED');
    expect(unknown.cases.every(item => item.fidelity.compositionStatus === 'PASS' && item.fidelity.status === 'UNVERIFIED' && !item.fidelity.providerBound)).toBe(true);
    const bad = copy(); bad.identity.assuranceHead = 'not-an-exact-head'; bad.identity.assuranceDirty = true;
    const dirty = replayDraftQualityFacts(bad);
    expect(dirty.captureRunner.status).toBe('FAIL');
    expect(dirty.receipts.provider.verdict.status).toBe('FAIL');
    expect(dirty.cases.every(item => !item.fidelity.providerBound)).toBe(true);
    const unresolved = copy(); unresolved.identity.assuranceHead = '0'.repeat(40);
    expect(replayDraftQualityFacts(unresolved).receipts.provider.verdict.status).toBe('UNVERIFIED');
    const unrelated = copy(); unrelated.identity.unrelatedObject = 'A telescope replaced a teapot';
    const control = replayDraftQualityFacts(unrelated);
    expect(control.captureRunner.status).toBe('PASS');
    expect(control.receipts.provider.verdict.status).toBe('PASS');
    expect(control.receipts.provider.scope).toBe('offline-replay');
  });
  test('secondary-model-identity', () => {
    const completion = loadActivationEvidence().codeOnly!.cases[0]!.captures.find(capture => capture.kind === 'completion')!;
    const input = copy(); input.cases[0]!.captures.push(structuredClone(completion));
    const good = replayDraftQualityFacts(input);
    expect(good.cases[0]!.fidelity.status).toBe('PASS');
    expect(good.cases[0]!.fidelity.callModelIdentity).toMatchObject({ status: 'PASS', calls: [{ kind: 'draft' }, { kind: 'completion' }] });
    expect(good.cases[0]!.fidelity.secondaryComposition).toEqual({ status: 'UNVERIFIED', capturedCalls: 1 });
    expect(good.cases[0]!.fidelity.compositionScope).toContain('Primary request only');
    const bad = input.cases[0]!.captures[1]!;
    (bad.request as Record<string, unknown>).model = 'claude-sonnet-5';
    const wrongRequest = replayDraftQualityFacts(input);
    expect(wrongRequest.cases[0]!.fidelity.status).toBe('FAIL');
    expect(wrongRequest.receipts.provider.verdict.status).toBe('FAIL');
    (bad.request as Record<string, unknown>).model = 'claude-sonnet-4-6';
    (bad.response as Record<string, unknown>).model = 'claude-sonnet-5';
    expect(replayDraftQualityFacts(input).receipts.provider.verdict.status).toBe('FAIL');
    (bad.response as Record<string, unknown>).model = 'claude-sonnet-4-6';
    (bad.request as Record<string, unknown>).metadata = { unrelated: 'A telescope replaced a teapot' };
    const control = replayDraftQualityFacts(input);
    expect(control.receipts.provider.verdict.status).toBe('PASS');
    expect(control.cases[0]!.fidelity.secondaryComposition.status).toBe('UNVERIFIED');
  });
});
