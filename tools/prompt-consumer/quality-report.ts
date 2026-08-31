/** Read-only replay of Lane D's original experiment facts. No serialized PASS is trusted. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertExactCaseIds, sha256, type ContractStatus } from './contract.js';
import { buildContractManifest, draftObligations } from './manifest.js';
import { assessDraftFidelity, compareDraftConfigurations, digest, type DraftCapture, type DraftConfiguration, type DraftImplementations } from './fidelity.js';
import { draftConfiguration, loadDraftRuntime } from './runtime-draft.js';
import { evaluateDraftSemanticCase, loadDraftSemanticPairs, oracleForDraftSemanticObservation, type DraftSemanticImplementations, type DraftSemanticObservation, type DraftSemanticOracle } from './semantic.js';
import { configurationHash, evidenceHash, evaluateServingEvidence, verifyEvaluationEvidence, type ServingConfiguration, type ServingObservation, type VerifiedEvaluationReceipt } from './serving-evidence.js';
import { buildPromotionEvidencePacket } from './promotion-packet.js';
import { evaluateResponseIdentity, type ResponseCapture } from './response-identity.js';
import { evaluateResponseFleet, type ResponseFleetInput } from './response-fleet.js';

const ROOT = resolve(import.meta.dirname, '../..');
const combine = (values: readonly ContractStatus[]): ContractStatus => values.includes('FAIL') ? 'FAIL' : !values.length || values.includes('UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');
const object = (value: unknown): Record<string, unknown> => {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'REFUSE: expected original evidence object');
  return value as Record<string, unknown>;
};
interface Source { path: string; exportName: string; sha256: string }
export interface DraftExperimentIdentity {
  format: string; snapshotSha256: string; corpusSha256: string;
  incumbent: DraftConfiguration; candidate: DraftConfiguration; runtimeComponents: Source[];
  promoted: boolean; assuranceHead?: string; assuranceDirty?: boolean;
  [key: string]: unknown;
}
export interface DraftExperimentCase {
  identity: DraftExperimentIdentity; configuration: DraftConfiguration; capture: DraftCapture;
  captures: Array<{ kind: string; request: unknown; response?: unknown }>;
  observation: DraftSemanticObservation; consumed?: { graph: unknown };
  [key: string]: unknown;
}
export interface DraftQualityAuthority {
  sourceHead: string;
  configurations: { incumbent: DraftConfiguration; candidate: DraftConfiguration };
  components: Source[];
  implementations: DraftImplementations;
  semanticImplementations: DraftSemanticImplementations;
  expectedMessagesByCaseId: Readonly<Record<string, unknown>>;
  declaredEnvironment: Readonly<Record<string, string | null>>;
  contractSourceAgreement: ContractSourceAgreement;
}
export interface ContractSourceClosure {
  readonly srcTree: string | null;
  readonly vendorTree: string | null;
  readonly packageSha256: string | null;
  readonly lockSha256: string | null;
  readonly sourceDirty: boolean | null;
  readonly issues: readonly string[];
}
export interface ContractSourceAgreement {
  readonly status: ContractStatus;
  readonly strategy: 'whole-src-tree-and-dependency-pins';
  readonly assurance: ContractSourceClosure;
  readonly target: ContractSourceClosure;
  readonly issues: readonly string[];
}

/** Conservative closure: participation receipts do not enumerate transitive
 * imports. No historical static probe becomes target proof unless ALL src and
 * package/lock/vendor authority is identical and clean in both checkouts.
 */
export function readContractSourceClosure(checkout: string): ContractSourceClosure {
  const issues: string[] = [];
  const git = (...args: string[]): string | null => {
    try { return execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { issues.push(`Cannot establish ${args.join(' ')}`); return null; }
  };
  const fileHash = (path: string): string | null => {
    try { return sha256(readFileSync(resolve(checkout, path), 'utf8')); }
    catch { issues.push(`Cannot establish ${path}`); return null; }
  };
  const srcTree = git('rev-parse', 'HEAD:src'), vendorTree = git('rev-parse', 'HEAD:vendor');
  const dirty = git('status', '--porcelain', '--untracked-files=all', '--', 'src', 'package.json', 'pnpm-lock.yaml', 'vendor');
  return { srcTree, vendorTree, packageSha256: fileHash('package.json'), lockSha256: fileHash('pnpm-lock.yaml'), sourceDirty: dirty === null ? null : dirty.length > 0, issues };
}
export function compareContractSourceClosures(assurance: ContractSourceClosure, target: ContractSourceClosure): ContractSourceAgreement {
  const issues = [...assurance.issues.map(issue => `assurance: ${issue}`), ...target.issues.map(issue => `target: ${issue}`)];
  for (const [name, closure] of [['assurance', assurance], ['target', target]] as const) {
    if (closure.sourceDirty !== false) issues.push(`${name}: src/package/lock/vendor working files are dirty or unavailable`);
    if (!/^[a-f0-9]{40}$/.test(closure.srcTree ?? '') || !/^[a-f0-9]{40}$/.test(closure.vendorTree ?? '')) issues.push(`${name}: full src/vendor Git trees unavailable`);
    if (!/^[a-f0-9]{64}$/.test(closure.packageSha256 ?? '') || !/^[a-f0-9]{64}$/.test(closure.lockSha256 ?? '')) issues.push(`${name}: dependency pins unavailable`);
  }
  for (const key of ['srcTree', 'vendorTree', 'packageSha256', 'lockSha256'] as const) if (assurance[key] !== target[key]) issues.push(`Target ${key} differs from historical static-probe authority`);
  return { status: issues.length ? 'UNVERIFIED' : 'PASS', strategy: 'whole-src-tree-and-dependency-pins', assurance, target, issues };
}

/** A declared clean recorder head is necessary but not sufficient: resolve its
 * actual recorder/verifier bytes and compare them to the executing replay code.
 * Unknown historical recorder code must not acquire provider-bound PASS.
 */
export function verifyCaptureRecorder(identity: Pick<DraftExperimentIdentity, 'assuranceHead' | 'assuranceDirty'>, assuranceRoot = ROOT) {
  const issues: string[] = [];
  const sources: Array<{ path: string; recordedSha256: string | null; replaySha256: string | null }> = [];
  const knownDirty = identity.assuranceDirty === true;
  if (knownDirty) issues.push('Captured recorder was dirty; an exact implementation was not recorded.');
  if (!/^[a-f0-9]{40}$/.test(identity.assuranceHead ?? '') || identity.assuranceDirty !== false) issues.push('Exact clean capture-runner identity is unavailable.');
  if (!issues.length) for (const path of ['tools/prompt-consumer/runtime-draft.ts', 'tools/prompt-consumer/fidelity.ts']) {
    let recordedSha256: string | null = null, replaySha256: string | null = null;
    try {
      recordedSha256 = sha256(execFileSync('git', ['show', `${identity.assuranceHead}:${path}`], { cwd: assuranceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      replaySha256 = sha256(readFileSync(resolve(assuranceRoot, path), 'utf8'));
      if (recordedSha256 !== replaySha256) issues.push(`Capture recorder differs from executing replay: ${path}`);
    } catch { issues.push(`Capture recorder source unavailable: ${path}`); }
    sources.push({ path, recordedSha256, replaySha256 });
  }
  return { assuranceHead: identity.assuranceHead ?? null, assuranceDirty: identity.assuranceDirty ?? null,
    status: knownDirty ? 'FAIL' as const : issues.length ? 'UNVERIFIED' as const : 'PASS' as const, sources, issues };
}
interface Pair {
  id: string; diagnostic: string; decision: string;
  diagnosticOracle?: DraftSemanticOracle; decisionOracle?: DraftSemanticOracle;
}

/** Only versioned source oracles are accepted; experiment-provided oracles are ignored. */
export function loadQualityPair(pairId: string): { pair: Pair; corpusSha256: string; sourceSha256: string } {
  const originals = loadDraftSemanticPairs();
  const original = originals.find(pair => pair.id === pairId);
  if (original) return { pair: original, corpusSha256: digest(originals), sourceSha256: sha256(read('src/cee/draft/records/__tests__/fixtures/draft-intent-pairs.json')) };
  const bytes = read('tools/prompt-consumer/fixtures/logistics-reworded-v1.json');
  assert.equal(sha256(bytes), '71b79715092a1f538c519a8ffb56883b6dad2f920945c316ca03a04d5eb87478', 'REFUSE: independent reworded oracle bytes changed');
  const corpus = JSON.parse(bytes) as { pairs: Pair[] };
  const pairs = corpus.pairs.filter(pair => pair.id === pairId);
  assert.equal(pairs.length, 1, 'REFUSE: unknown semantic pair');
  for (const direction of ['diagnostic', 'decision'] as const) {
    const oracle = direction === 'diagnostic' ? pairs[0]!.diagnosticOracle : pairs[0]!.decisionOracle;
    assert(oracle && oracle.briefSha256 === sha256(pairs[0]![direction]) && oracle.direction === direction && oracle.pairId === pairId, 'REFUSE: source oracle/brief mismatch');
  }
  return { pair: pairs[0]!, corpusSha256: digest(corpus.pairs), sourceSha256: sha256(bytes) };
}

function snapshotSelection(snapshot: ServingObservation) {
  assert(snapshot.stored && snapshot.loaded && snapshot.routing && snapshot.health, 'REFUSE: complete PMS/load/router/health snapshot required');
  for (const capture of [snapshot.stored, snapshot.loaded, snapshot.routing, snapshot.health]) {
    assert.equal(capture.method, 'GET', 'REFUSE: only original read-only observations accepted');
    assert.equal(capture.httpStatus, 200, 'REFUSE: unsuccessful serving observation');
    assert.equal(sha256(capture.body), capture.bodySha256, 'REFUSE: snapshot body hash mismatch');
  }
  const stored = object(JSON.parse(snapshot.stored.body));
  const selectedVersion = snapshot.environment === 'staging' ? stored.stagingVersion ?? stored.activeVersion : stored.activeVersion;
  const versions = (stored.versions as Array<{ version: number; content: string }>).filter(version => version.version === selectedVersion);
  assert.equal(versions.length, 1, 'REFUSE: PMS selection absent or ambiguous');
  assert.equal(stored.taskId, 'draft_graph', 'REFUSE: wrong selected task');
  const modelConfig = stored.modelConfig as { staging?: string; production?: string } | null | undefined;
  const selectedModel = modelConfig?.[snapshot.environment];
  assert(typeof selectedModel === 'string' && selectedModel, 'REFUSE: PMS-selected model unavailable');
  return { stored, version: versions[0]!.version, content: versions[0]!.content, selectedModel, modelConfig: modelConfig ?? null };
}

function servingConfiguration(config: DraftConfiguration, components: readonly Source[]): ServingConfiguration {
  const schema = components.find(source => source.path === 'src/cee/draft/records/grammar.ts');
  assert(schema, 'REFUSE: target schema source not identified');
  assert(typeof config.prompt.version === 'number' || config.prompt.version === 'unpromoted-candidate', 'REFUSE: invalid candidate version label');
  const source = (entry: Source) => ({ path: entry.path, exportName: entry.exportName, fileSha256: entry.sha256 });
  return { task: config.task, sourceHead: config.sourceHead, prompt: { id: config.prompt.id, version: config.prompt.version, sha256: config.prompt.sha256 },
    instructionSha256: config.instruction.sha256, model: { id: config.model.id, provider: config.model.provider },
    schema: { ...source(schema), artifactSha256: config.grammar.sha256 }, parser: source(config.parser), projector: source(config.projector), consumer: source(config.consumer) };
}

/** Pure orchestration around actual imported implementations. The caller supplies
 * independently loaded runtime authority; supplied serialized report fields are unused.
 */
export function replayDraftQualityFacts(input: {
  identity: DraftExperimentIdentity; cases: readonly DraftExperimentCase[];
  snapshot: ServingObservation; snapshotSha256: string; pairId: string;
  runtimeAuthority: DraftQualityAuthority;
  foundation?: ReturnType<typeof buildContractManifest>;
}) {
  const { identity, runtimeAuthority: runtime, snapshot } = input;
  const captureRunner = verifyCaptureRecorder(identity);
  const authored = loadQualityPair(input.pairId), pair = authored.pair;
  assert.equal(identity.format, 'olumi.prompt-model-experiment.v1', 'REFUSE: unknown experiment format');
  assert.equal(identity.promoted, false, 'REFUSE: this lane does not perform promotion');
  assert.equal(identity.snapshotSha256, input.snapshotSha256, 'REFUSE: experiment belongs to another PMS snapshot');
  assert.equal(identity.corpusSha256, authored.corpusSha256, 'REFUSE: experiment did not use the source-authored corpus');
  assert.deepEqual(identity.runtimeComponents, runtime.components, 'REFUSE: captured and replayed runtime sources differ');
  assert.deepEqual(identity.incumbent, runtime.configurations.incumbent, 'REFUSE: incumbent differs from independently derived runtime authority');
  assert.deepEqual(identity.candidate, runtime.configurations.candidate, 'REFUSE: candidate differs from independently derived runtime authority');
  const selected = snapshotSelection(snapshot);
  const incumbent = runtime.configurations.incumbent, candidate = runtime.configurations.candidate;
  assert.equal(incumbent.sourceHead, runtime.sourceHead, 'REFUSE: wrong target head');
  assert.equal(candidate.sourceHead, runtime.sourceHead, 'REFUSE: candidate targets another runtime');
  assert.deepEqual(incumbent.prompt, { id: selected.stored.id, version: selected.version, content: selected.content, sha256: sha256(selected.content) }, 'REFUSE: incumbent is not selected full PMS bytes');
  assert.equal(incumbent.model.id, selected.selectedModel, 'REFUSE: incumbent model is not PMS selection');
  assert.equal(candidate.model.id, selected.selectedModel, 'REFUSE: candidate model changed outside the controlled prompt comparison');
  const configs = { incumbent: servingConfiguration(incumbent, runtime.components), candidate: servingConfiguration(candidate, runtime.components) };
  const expected = (['diagnostic', 'decision'] as const).flatMap(direction => (['incumbent', 'candidate'] as const).map(arm => `${pair.id}-${direction}-1-${arm}`));
  assertExactCaseIds(expected, input.cases.map(item => item.observation.id));
  const foundation = input.foundation ?? buildContractManifest();
  const replayCase = (item: DraftExperimentCase) => {
    const reference = item.observation;
    assert.equal(reference.pairId, pair.id, 'REFUSE: cross-pair evidence');
    assert(['diagnostic', 'decision'].includes(reference.direction) && ['incumbent', 'candidate'].includes(reference.arm), 'REFUSE: unknown direction/arm');
    assert.equal(reference.repetition, 1, 'REFUSE: unexpected repetition');
    assert.equal(reference.id, `${pair.id}-${reference.direction}-1-${reference.arm}`, 'REFUSE: case identity mismatch');
    assert.equal(reference.brief, pair[reference.direction], 'REFUSE: changed or cross-case brief');
    assert.equal(item.capture.brief, reference.brief, 'REFUSE: provider capture belongs to another brief');
    assert.deepEqual(item.identity, identity, 'REFUSE: per-case experiment identity differs');
    const config = reference.arm === 'incumbent' ? incumbent : candidate;
    assert.deepEqual(item.configuration, config, 'REFUSE: case configuration differs from intended arm');
    const callModels = item.captures.map((entry, index) => {
      assert(entry.kind === 'draft' || entry.kind === 'completion', 'REFUSE: unknown provider capture kind');
      const requestModel = object(entry.request).model, responseModel = entry.response === undefined ? undefined : object(entry.response).model;
      const wrong = (requestModel !== undefined && requestModel !== config.model.id) || (responseModel !== undefined && responseModel !== config.model.id);
      return { index, kind: entry.kind, requestModel: requestModel ?? null, responseModel: responseModel ?? null,
        status: wrong ? 'FAIL' as const : requestModel === undefined || responseModel === undefined ? 'UNVERIFIED' as const : 'PASS' as const };
    });
    const allCallModelStatus = combine(callModels.map(call => call.status));
    const callModelIssues = callModels.filter(call => call.status !== 'PASS').map(call => `Provider ${call.kind} call ${call.index}: ${call.status} model identity`);
    const primary = item.captures.filter(entry => entry.kind === 'draft').at(-1);
    assert(primary, 'REFUSE: original primary provider request absent');
    assert.deepEqual(primary.request, item.capture.request, 'REFUSE: provider request differs from original capture');
    assert.deepEqual(primary.response, item.capture.response, 'REFUSE: provider response differs from original capture');
    assert.deepEqual(item.consumed?.graph, item.capture.consumedGraph, 'REFUSE: consumed output differs from original adapter result');
    const messages = item.capture.request.messages;
    assert(Array.isArray(messages) && messages.some(message => {
      const content = object(message).content;
      return typeof content === 'string' ? content.includes(reference.brief) : Array.isArray(content) && content.some(block => typeof object(block).text === 'string' && String(object(block).text).includes(reference.brief));
    }), 'REFUSE: intended brief did not participate in provider messages');
    const primaryResponseText = item.capture.response?.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
    let raw: unknown; try { raw = JSON.parse(primaryResponseText ?? ''); } catch { raw = null; }
    assert.deepEqual(reference.raw, raw, 'REFUSE: observation is not the emitted provider records');
    assert.deepEqual(reference.consumedGraph, item.capture.consumedGraph ?? null, 'REFUSE: semantic observation is not the consumed output');
    const observation: DraftSemanticObservation = { ...reference, raw, consumedGraph: item.capture.consumedGraph ?? null, primaryResponseText,
      evidenceKind: item.capture.transport === 'real-provider' ? 'provider-capture' : 'synthetic-mutation' };
    const actualEnvironment = object(object(item.declaredSettings).environment);
    assert.deepEqual(actualEnvironment, runtime.declaredEnvironment, 'REFUSE: declared runtime flags differ from the independent replay environment');
    const measured = assessDraftFidelity(config, item.capture, { ...runtime.implementations,
      expectedMessages: runtime.expectedMessagesByCaseId[reference.id], expectedBriefSha256: sha256(reference.brief) });
    const fidelity = { ...measured, compositionStatus: measured.status, recorderStatus: captureRunner.status,
      status: combine([measured.status, captureRunner.status, allCallModelStatus]), providerBound: measured.providerBound && captureRunner.status === 'PASS' && allCallModelStatus === 'PASS',
      issues: [...measured.issues, ...captureRunner.issues, ...callModelIssues],
      compositionScope: 'Primary request only. Secondary/retry/completion prompt, grammar and response-to-consumer composition are not certified.',
      callModelIdentity: { status: allCallModelStatus, calls: callModels },
      secondaryComposition: { status: 'UNVERIFIED' as const, capturedCalls: item.captures.filter(entry => entry.kind !== 'draft').length } };
    const oracle = (reference.direction === 'diagnostic' ? pair.diagnosticOracle : pair.decisionOracle) ?? oracleForDraftSemanticObservation(observation);
    const semantic = evaluateDraftSemanticCase({ observation, oracle, implementations: runtime.semanticImplementations,
      fidelity: { status: fidelity.status, rawSha256: fidelity.rawSha256 ?? '', consumedSha256: fidelity.consumedSha256 ?? '', briefSha256: fidelity.briefSha256,
        componentSourceHashes: runtime.semanticImplementations.sourceHashes, scope: fidelity.scope } });
    return { id: reference.id, arm: reference.arm as 'incumbent' | 'candidate', direction: reference.direction, fidelity, semantic,
      captureSha256: digest(item.capture), oracleSha256: semantic.hashes.oracleSha256 };
  };
  const cases = input.cases.map(replayCase);
  const comparisons = (['diagnostic', 'decision'] as const).map(direction => {
    const a = input.cases.find(item => item.observation.direction === direction && item.observation.arm === 'incumbent')!;
    const b = input.cases.find(item => item.observation.direction === direction && item.observation.arm === 'candidate')!;
    return { direction, ...compareDraftConfigurations(incumbent, candidate, a.capture, b.capture) };
  });
  const obligation = { incumbent: draftObligations(incumbent.prompt.sha256, incumbent.instruction.sha256), candidate: draftObligations(candidate.prompt.sha256, candidate.instruction.sha256) };
  const source = { path: 'tools/prompt-consumer/quality-report.ts', exportName: 'replayDraftQualityFacts', fileSha256: sha256(read('tools/prompt-consumer/quality-report.ts')) };
  const receipt = (kind: VerifiedEvaluationReceipt['kind'], arms: readonly ('incumbent' | 'candidate')[], property: 'structural' | 'reasoning' | 'provider') => {
    const facts = input.cases.filter(item => arms.includes(item.observation.arm as 'incumbent' | 'candidate'));
    return verifyEvaluationEvidence({ kind, scope: facts.every(item => item.capture.transport === 'real-provider') ? 'local-provider' : 'offline-replay',
      configurations: arms.map(arm => configs[arm]), evidence: facts, evidenceSha256: evidenceHash(facts), verifier: { ...source, run: originals => {
        const recomputed = originals.map(replayCase);
        const actualHashes = [...new Set(recomputed.flatMap(item => item.fidelity.compositionStatus === 'PASS' ? [configurationHash(configs[item.arm])] : []))];
        const fidelityStatus = combine(recomputed.map(item => item.fidelity.status));
        let status: ContractStatus;
        if (property === 'structural') {
          const sourceAgreement = runtime.contractSourceAgreement.status;
          const targetProbeStatus = sourceAgreement === 'PASS' ? foundation.routes.find(route => route.task === 'draft_graph')!.deterministicStatus as ContractStatus : 'UNVERIFIED';
          status = combine([...recomputed.map(item => item.fidelity.structuralStatus), ...arms.map(arm => obligation[arm].status), sourceAgreement, targetProbeStatus]);
        } else if (property === 'reasoning') status = combine([...recomputed.map(item => item.semantic.behavioralStatus), ...comparisons.map(comparison => comparison.status)]);
        else status = fidelityStatus;
        return { status, fidelityStatus, observedConfigurationHashes: actualHashes, issues: [...recomputed.flatMap(item => [...item.fidelity.issues, ...item.fidelity.structuralIssues]),
          ...(property === 'structural' && runtime.contractSourceAgreement.status !== 'PASS' ? ['Foundation contract probes do not execute target source; actual-output grammar acceptance is not prompt/consumer compatibility.'] : []),
          ...(property === 'reasoning' ? recomputed.flatMap(item => item.semantic.assertionResults.filter(result => result.status !== 'PASS').map(result => `${item.id}: ${result.id}: ${result.status}`)) : [])] };
      } } });
  };
  const provider = receipt('provider-fidelity', ['incumbent'], 'provider');
  const structural = receipt('structural', ['candidate'], 'structural');
  const comparison = receipt('reasoning', ['incumbent', 'candidate'], 'reasoning');
  const serving = evaluateServingEvidence({ configuration: configs.incumbent, mode: 'observed', observations: [snapshot], cacheWindow: null,
    ...(provider.scope === 'local-provider' ? { providerEvidence: provider } : {}) });
  const promotion = buildPromotionEvidencePacket({ mode: 'observed', incumbent: configs.incumbent, candidate: configs.candidate,
    evaluations: { structural, comparison }, rollback: { configuration: configs.incumbent, environment: snapshot.environment, codeRef: incumbent.sourceHead,
      observedAt: snapshot.observedAt, originalPms: snapshot.stored!, pmsSelection: { activeVersion: selected.stored.activeVersion as number,
        stagingVersion: (selected.stored.stagingVersion as number | undefined) ?? null, modelConfig: selected.modelConfig } } });
  const knownServingIdentityFailures = Object.entries(serving.levels).filter(([, level]) => level.status === 'FAIL').map(([level, result]) => ({ level, issues: result.issues }));
  return { format: 'olumi.prompt-model-quality-report.v1' as const, collectionStatus: 'PASS' as const, expectedCaseIds: expected,
    status: combine([promotion.preActionEvidenceStatus, captureRunner.status, serving.levels.selected.status, serving.levels.loaded.status, serving.levels.deployed.status, ...knownServingIdentityFailures.map(() => 'FAIL' as const)]),
    captureRunner, replayRunner: { assuranceHead: foundation.sourceHead, assuranceDirty: foundation.sourceDirty },
    knownServingIdentityFailures,
    evidenceSha256: evidenceHash({ identity, cases: input.cases, snapshot }), sourceOracle: { pairId: pair.id, sourceSha256: authored.sourceSha256, corpusSha256: authored.corpusSha256 },
    authoritativeManifest: { foundation: { scope: 'assurance-branch historical probes, not target-runtime proof', ...foundation },
      targetRuntime: { sourceHead: runtime.sourceHead, components: runtime.components, contractSourceAgreement: runtime.contractSourceAgreement, configurations: configs,
        configured: runtime.configurations, pmsSelected: { promptId: incumbent.prompt.id, version: selected.version, fullHash: sha256(selected.content), model: selected.selectedModel },
        serving, localProvider: cases.map(item => ({ id: item.id, requestSha256: item.fidelity.requestSha256, status: item.fidelity.status, providerBound: item.fidelity.providerBound,
          compositionScope: item.fidelity.compositionScope, callModelIdentity: item.fidelity.callModelIdentity, secondaryComposition: item.fidelity.secondaryComposition })),
        deployedProvider: 'UNVERIFIED', deployedSemantics: 'UNVERIFIED' } },
    cases, comparisons, obligations: obligation, receipts: { provider, structural, comparison }, promotion,
    limits: ['Exactly one source-authored diagnostic/action pair and two prompt arms; not open-ended reasoning quality.', 'Original captures replayed without model calls; serialized PASS/oracle fields ignored.', 'No PMS promotion, rollback, cache expiry or deployed provider call is performed or inferred.'],
    promotionPermission: 'NOT_GRANTED' as const };
}

export async function buildDraftQualityReport(input: { experimentDir: string; runtimeRoot: string; expectedHead: string; pairId: string; snapshotPath: string }) {
  const identity = JSON.parse(readFileSync(resolve(input.experimentDir, 'identity.json'), 'utf8')) as DraftExperimentIdentity;
  const expected = (['diagnostic', 'decision'] as const).flatMap(direction => (['incumbent', 'candidate'] as const).map(arm => `${input.pairId}-${direction}-1-${arm}.json`));
  const jsonFiles = readdirSync(input.experimentDir).filter(path => path.endsWith('.json'));
  assertExactCaseIds(['identity.json', ...expected, ...(jsonFiles.includes('summary.json') ? ['summary.json'] : [])], jsonFiles);
  const cases = expected.map(path => JSON.parse(readFileSync(resolve(input.experimentDir, path), 'utf8')) as DraftExperimentCase);
  const snapshotBytes = readFileSync(input.snapshotPath, 'utf8'), snapshot = JSON.parse(snapshotBytes) as ServingObservation;
  const selected = snapshotSelection(snapshot);
  const runtime = await loadDraftRuntime(input.runtimeRoot, input.expectedHead);
  const configurations = { incumbent: draftConfiguration(runtime, identity.incumbent.prompt, selected.selectedModel), candidate: draftConfiguration(runtime, identity.candidate.prompt, selected.selectedModel) };
  const expectedMessagesByCaseId: Record<string, unknown> = {};
  for (const item of cases) {
    const config = item.observation.arm === 'incumbent' ? configurations.incumbent : configurations.candidate;
    expectedMessagesByCaseId[item.observation.id] = await runtime.expectedMessages(config, item.capture.brief);
  }
  const declaredEnvironment = Object.fromEntries(['CEE_ANTHROPIC_STRUCTURED_OUTPUTS', 'CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED', 'CEE_DRAFT_TEMPERATURE'].map(key => [key, process.env[key] ?? null]));
  const foundation = buildContractManifest();
  const contractSourceAgreement = compareContractSourceClosures(readContractSourceClosure(ROOT), readContractSourceClosure(runtime.root));
  const report = replayDraftQualityFacts({ identity, cases, snapshot, snapshotSha256: sha256(snapshotBytes), pairId: input.pairId, foundation,
    runtimeAuthority: { sourceHead: runtime.head, configurations, components: runtime.components, implementations: runtime.implementations, semanticImplementations: runtime.semanticImplementations, contractSourceAgreement, expectedMessagesByCaseId, declaredEnvironment } });
  runtime.assertUnchanged();
  return report;
}

export interface ResponseIdentityPacketInput {
  format: 'olumi.prompt-response-observations.v1';
  mode: 'observed' | 'simulation';
  configuration: ServingConfiguration;
  captures: readonly ResponseCapture[];
  settling: ResponseFleetInput['settling'];
  expectedInstanceIds?: readonly string[];
}

/** Fixed, offline decoder. Never accepts serialized reports or a PASS callback.
 * Capture hashes establish artifact integrity, not transport authenticity. The
 * expected configuration is a comparison reference, never a missing-field fill.
 */
export function buildResponseIdentityPacket(input: ResponseIdentityPacketInput) {
  assert.equal(input.format, 'olumi.prompt-response-observations.v1', 'REFUSE: unsupported response-evidence format');
  assert(input.mode === 'observed' || input.mode === 'simulation', 'REFUSE: response evidence mode is required');
  assert(Array.isArray(input.captures), 'REFUSE: original response captures required');
  const responses = input.captures.map(capture => evaluateResponseIdentity({ configuration: input.configuration, capture, mode: input.mode }));
  const fleet = evaluateResponseFleet({ configuration: input.configuration, mode: input.mode, responses,
    settling: input.settling ?? null, expectedInstanceIds: input.expectedInstanceIds });
  return {
    format: 'olumi.prompt-response-identity.v1' as const,
    mode: input.mode, status: fleet.status, configuration: input.configuration,
    configurationSha256: configurationHash(input.configuration),
    // Only actual inputs contribute. Decorative stored verdicts do not alter
    // either the evidence identity or its re-derived meaning.
    evidenceSha256: evidenceHash({ mode: input.mode, configuration: input.configuration,
      captures: input.captures, settling: input.settling ?? null, expectedInstanceIds: input.expectedInstanceIds ?? [] }),
    decoderSources: ['tools/prompt-consumer/response-identity.ts', 'tools/prompt-consumer/response-fleet.ts',
      'src/utils/response-hash.ts'].map(path => ({ path, sha256: sha256(read(path)) })),
    responses, fleet,
    transportProvenance: 'Operator-supplied captures; body digests detect corruption, not forged origin or omitted traffic.',
    semanticStatus: 'UNVERIFIED' as const,
    deploymentPermission: 'NOT_GRANTED' as const,
    operations: { networkRequests: 0, providerCalls: 0, promotionPerformed: false, rollbackPerformed: false },
    limitations: [
      'Known response identity contradictions fail. Missing fields remain UNVERIFIED, even with complete administrative snapshots.',
      'Local/frozen provider evidence is separate from an actually observed deployed response.',
      'Selection consistency covers observed instances only; no fleet inventory or universal serving claim is inferred.',
      'Provider-returned composition and consumer invocation need serving-path telemetry not emitted by the inspected V5 runtime.',
    ],
  };
}
