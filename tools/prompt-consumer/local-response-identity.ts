/** Fixed, network-free per-response verifier. Historical raw capture is not a
 * deployed receipt; reconstructed initial projection is not the final adapter. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, type ContractStatus } from './contract.js';
import { assessDraftFidelity, digest, type DraftCapture, type DraftConfiguration } from './fidelity.js';
import { loadDraftRuntime } from './runtime-draft.js';
import { loadQualityPair, verifyCaptureRecorder, type DraftExperimentCase } from './quality-report.js';
import { evaluateDraftSemanticCase, oracleForDraftSemanticObservation } from './semantic.js';

const ROOT = resolve(import.meta.dirname, '../..');
export const LOCAL_RESPONSE_ARCHIVE = {
  path: 'evidence/prompt-consumer/lane-d-20260831/provider-and-serving.tar.gz',
  sha256: '843b9dd5adf5a38fe87484f406eba591fdc3c1f42f1b3bd79636c0f552c54bd9',
  sourceHead: '3a79b4057b238a5a80d773310f8da076d2922f0a',
} as const;
const combine = (values: ContractStatus[]): ContractStatus => values.includes('FAIL') ? 'FAIL' : values.includes('UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
const scope = 'initial-records-projection-replay' as const;
type Call = { kind: string; request: DraftCapture['request']; response?: DraftCapture['response'] };

/** Only committed, hash-pinned original request/response bytes may establish
 * historical provider origin. Experiment PASS fields and supplied oracles are ignored. */
export function loadFrozenLocalResponseCase(id: string): DraftExperimentCase {
  assert(/^(logistics-disagreement|logistics-disagreement-reworded-v1)-(diagnostic|decision)-1-(incumbent|candidate)$/.test(id), 'Unknown frozen response case');
  const archive = resolve(ROOT, LOCAL_RESPONSE_ARCHIVE.path);
  assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), LOCAL_RESPONSE_ARCHIVE.sha256, 'Immutable provider archive hash differs');
  const directory = id.includes('reworded-v1') ? 'provider-reworded' : 'provider-original';
  return JSON.parse(execFileSync('tar', ['-xOzf', archive, `${directory}/${id}.json`], { encoding: 'utf8', maxBuffer: 8_000_000 })) as DraftExperimentCase;
}

export interface LocalResponseIdentityInput {
  configuration: DraftConfiguration;
  /** consumedGraph must be the immediate records projection, NOT an adapter's
   * post-completion result. It is independently recomputed and compared. */
  capture: DraftCapture;
  calls: readonly Call[];
  runtimeRoot: string;
  archivedCaseId?: string;
  expectedProviderMessageId?: string;
  annotations?: Readonly<Record<string, unknown>>;
}

/** Loads the real target implementation itself. There is intentionally no
 * caller-defined verification/parser callback or accepted serialized receipt. */
export async function evaluateLocalResponseIdentity(input: LocalResponseIdentityInput) {
  const { configuration, capture, calls } = input;
  const issues: string[] = [];
  const identityContradictions: string[] = [];
  let originStatus: ContractStatus = 'UNVERIFIED', identityStatus: ContractStatus = 'UNVERIFIED';
  let structuralStatus: ContractStatus = 'UNVERIFIED', lineageStatus: ContractStatus = 'UNVERIFIED';
  let raw: unknown, immediateGraph: unknown;
  let fidelity: ReturnType<typeof assessDraftFidelity> | undefined;
  let semantic: ReturnType<typeof evaluateDraftSemanticCase> | undefined;
  let frozen: DraftExperimentCase | undefined;
  let recorder: ReturnType<typeof verifyCaptureRecorder> | undefined;
  const messageId = (capture.response as { id?: string } | undefined)?.id ?? null;
  let contributionStatus: ContractStatus = calls.length === 1 && calls[0]?.kind === 'draft' && calls[0].response ? 'PASS' : 'UNVERIFIED';
  const mismatch = (condition: boolean, issue: string) => { if (condition) { issues.push(issue); identityContradictions.push(issue); } };
  mismatch(configuration.model.provider !== 'anthropic', 'Wrong provider: the only witnessed adapter in this capture is Anthropic');
  mismatch(input.expectedProviderMessageId !== undefined && messageId !== input.expectedProviderMessageId, 'Provider message belongs to another response');
  for (const [index, call] of calls.entries()) {
    mismatch(call.request.model !== undefined && call.request.model !== configuration.model.id, `Call ${index} request model differs`);
    mismatch(call.response?.model !== undefined && call.response.model !== configuration.model.id, `Call ${index} response model differs`);
    if (!call.request.model || !call.response?.model) contributionStatus = 'UNVERIFIED';
  }
  const matching = calls.filter(call => call.kind === 'draft' && digest(call.request) === digest(capture.request) && digest(call.response) === digest(capture.response));
  const primaryIdentityPresent = Boolean(capture.request.model && capture.response?.model);
  mismatch(primaryIdentityPresent && calls.length > 0 && matching.length !== 1, 'Primary request/response is absent, substituted or ambiguous in the call trace');
  if (contributionStatus === 'UNVERIFIED') issues.push('Complete retry/completion contribution lineage is not established');
  if (input.archivedCaseId) {
    try {
      frozen = loadFrozenLocalResponseCase(input.archivedCaseId);
      recorder = verifyCaptureRecorder(frozen.identity);
      const same = digest(configuration) === digest(frozen.configuration)
        && capture.sourceHead === frozen.capture.sourceHead && capture.brief === frozen.capture.brief
        && digest(capture.request) === digest(frozen.capture.request) && digest(capture.response) === digest(frozen.capture.response)
        && digest(calls) === digest(frozen.captures);
      const available = capture.response?.model && capture.request.model && calls.length && calls.every(call => call.request.model && call.response?.model);
      originStatus = !available ? 'UNVERIFIED' : same ? recorder.status : 'FAIL';
      if (!same) issues.push(available ? 'Supplied response identity does not match the immutable provider case' : 'Original request/response/call evidence is missing');
      issues.push(...recorder.issues);
    } catch (error) { issues.push(`Historical origin unavailable: ${String(error)}`); }
  } else issues.push('No verified immutable capture origin; transport flags cannot establish a provider call');
  try {
    const runtime = await loadDraftRuntime(input.runtimeRoot, configuration.sourceHead);
    const expectedMessages = await runtime.expectedMessages(configuration, capture.brief);
    fidelity = assessDraftFidelity(configuration, capture, { ...runtime.implementations, expectedMessages, expectedBriefSha256: sha256(capture.brief) });
    // Absence is not a contradicted identity. Keep genuine contradictions RED
    // while refusing to certify captures with missing model telemetry.
    const missingModel = !capture.request.model || !capture.response?.model;
    const contradictions = fidelity.issues.filter(issue => !(!capture.request.model && issue === 'wrong request model')
      && !(!capture.response?.model && issue === 'wrong or missing provider-returned model'));
    const compositionStatus = missingModel && contradictions.length === 0 ? 'UNVERIFIED' : fidelity.status;
    identityStatus = combine([identityContradictions.length ? 'FAIL' : 'PASS', compositionStatus, originStatus]);
    structuralStatus = fidelity.structuralStatus;
    issues.push(...fidelity.issues, ...fidelity.structuralIssues);
    const text = capture.response?.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
    if (text !== undefined) {
      raw = JSON.parse(text);
      const parsed = runtime.implementations.parse(raw, capture.brief);
      if (!parsed.ok || !parsed.projection) lineageStatus = 'FAIL';
      else {
        immediateGraph = runtime.implementations.consume(parsed.projection.graph);
        if (capture.consumedGraph !== undefined) {
          // Compare unstripped graph bytes too: schema stripping must not hide a
          // supplied field that another downstream consumer could interpret.
          const supplied = runtime.implementations.consume(capture.consumedGraph);
          lineageStatus = digest(supplied) === digest(immediateGraph) && digest(capture.consumedGraph) === digest(immediateGraph) ? 'PASS' : 'FAIL';
          if (lineageStatus === 'FAIL') issues.push('Consumed graph is not this response\'s actual initial projection');
        }
      }
      if (frozen && capture.consumedGraph !== undefined) {
        const original = frozen.observation;
        const authored = loadQualityPair(original.pairId).pair;
        const observation = { ...original, brief: capture.brief, raw, consumedGraph: capture.consumedGraph, primaryResponseText: text,
          evidenceKind: originStatus === 'PASS' ? 'banked-provider' as const : 'synthetic-mutation' as const };
        const oracle = (original.direction === 'diagnostic' ? authored.diagnosticOracle : authored.decisionOracle) ?? oracleForDraftSemanticObservation(observation);
        semantic = evaluateDraftSemanticCase({ observation, oracle, implementations: runtime.semanticImplementations,
          fidelity: { status: combine([identityStatus, lineageStatus, contributionStatus]), rawSha256: digest(raw), consumedSha256: digest(capture.consumedGraph),
            briefSha256: sha256(capture.brief), componentSourceHashes: runtime.semanticImplementations.sourceHashes, scope } });
      }
    }
    runtime.assertUnchanged();
  } catch (error) {
    if (identityStatus !== 'FAIL') identityStatus = 'UNVERIFIED';
    issues.push(`Exact runtime replay unavailable or rejected: ${String(error)}`);
  }
  identityStatus = combine([identityStatus, originStatus, identityContradictions.length ? 'FAIL' : 'PASS']);
  const status = combine([identityStatus, structuralStatus, lineageStatus, contributionStatus]);
  return {
    status, identityStatus, structuralStatus, lineageStatus, contributionStatus,
    semanticStatus: semantic?.semanticStatus ?? 'UNVERIFIED', semantic,
    rung: originStatus === 'PASS' ? 'historical-local-provider' as const : 'offline-replay' as const,
    origin: { status: originStatus, archive: input.archivedCaseId ? LOCAL_RESPONSE_ARCHIVE : null, caseId: input.archivedCaseId ?? null, recorder },
    expectedIdentity: { task: configuration.task, sourceHead: configuration.sourceHead,
      prompt: { id: configuration.prompt.id, version: configuration.prompt.version, sha256: configuration.prompt.sha256 },
      model: configuration.model, instructionSha256: configuration.instruction.sha256, grammarSha256: configuration.grammar.sha256,
      parser: configuration.parser, projector: configuration.projector, consumer: configuration.consumer },
    scope, messageId, requestCorrelation: 'UNVERIFIED' as const, deployedIdentity: 'UNVERIFIED' as const, finalAdapterLineage: 'UNVERIFIED' as const,
    hashes: { brief: sha256(capture.brief), request: digest(capture.request), response: capture.response ? digest(capture.response) : null,
      raw: raw === undefined ? null : digest(raw), immediateConsumer: immediateGraph === undefined ? null : digest(immediateGraph),
      suppliedConsumer: capture.consumedGraph === undefined ? null : digest(capture.consumedGraph) },
    participation: fidelity?.participation, issues,
    limitation: 'Original provider request/response origin plus exact-source initial projection replay only. No observed final adapter, HTTP request correlation, instance, canonical commit or deployed response identity. Multiple calls are never a complete contribution witness here.',
  };
}
