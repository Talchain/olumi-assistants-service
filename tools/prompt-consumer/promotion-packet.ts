/** Repeatable offline CC handoff. This module performs no promotion or rollback. */
import assert from 'node:assert/strict';
import { PromptDefinitionSchema, type ModelConfig } from '../../src/prompts/schema.js';
import { sha256, type ContractStatus } from './contract.js';
import {
  configurationHash, configurationIssues, evidenceHash,
  isServingEvidenceReport, isVerifiedEvaluationReceipt,
  type ReadOnlyGetCapture, type ServingConfiguration, type ServingEvidenceReport,
  type VerifiedEvaluationReceipt,
} from './serving-evidence.js';

export interface RollbackEvidence {
  readonly configuration: ServingConfiguration;
  readonly environment: 'staging' | 'production';
  readonly codeRef: string;
  readonly observedAt: string;
  /** Both environments are preserved. PMS pin is not inferred provider binding. */
  readonly pmsSelection: {
    readonly activeVersion: number;
    readonly stagingVersion: number | null;
    readonly modelConfig: NonNullable<ModelConfig> | null;
  };
  /** Original incumbent PMS bytes, not a hand-written pointer to a version. */
  readonly originalPms: ReadOnlyGetCapture;
}
export interface PromotionEvidenceInput {
  readonly mode: 'observed' | 'simulation';
  readonly incumbent: ServingConfiguration;
  readonly candidate: ServingConfiguration;
  /** Explicit actual resolution for code-before-PMS, not inferred model routing. */
  readonly codeOnly?: ServingConfiguration;
  readonly evaluations: {
    readonly structural?: VerifiedEvaluationReceipt;
    readonly comparison?: VerifiedEvaluationReceipt;
    readonly codeOnly?: VerifiedEvaluationReceipt;
  };
  readonly rollback?: RollbackEvidence;
  readonly cacheTransitions?: {
    readonly candidate?: ServingEvidenceReport;
    readonly rollback?: ServingEvidenceReport;
  };
}
interface Check { readonly status: ContractStatus; readonly issues: readonly string[] }
const combine = (checks: readonly Check[]): ContractStatus => checks.some(c => c.status === 'FAIL') ? 'FAIL' : checks.some(c => c.status === 'UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
const checked = (run: () => void): Check => {
  try { run(); return { status: 'PASS', issues: [] }; }
  catch (error) { return { status: 'FAIL', issues: [error instanceof Error ? error.message : String(error)] }; }
};
const unknown = (issue: string): Check => ({ status: 'UNVERIFIED', issues: [issue] });

function evaluateReceipt(receipt: VerifiedEvaluationReceipt | undefined, kind: VerifiedEvaluationReceipt['kind'], configurations: readonly ServingConfiguration[], mode: PromotionEvidenceInput['mode']): Check {
  if (!receipt) return unknown(`${kind} evidence absent`);
  const binding = checked(() => {
    assert(isVerifiedEvaluationReceipt(receipt), 'PASS annotation is not executable verifier evidence; replay original facts');
    assert.equal(receipt.kind, kind, 'wrong evidence kind');
    assert.deepEqual([...receipt.configurationHashes].sort(), configurations.map(configurationHash).sort(), 'evaluation identity mismatch');
    if (mode === 'observed') assert.notEqual(receipt.scope, 'simulation', 'simulation cannot certify actual evaluation');
  });
  if (binding.status === 'FAIL') return binding;
  return { status: combine([{ status: receipt.verdict.status, issues: [] }, { status: receipt.verdict.fidelityStatus, issues: [] }]), issues: receipt.verdict.issues };
}
function cacheCheck(report: ServingEvidenceReport | undefined, configuration: ServingConfiguration, mode: PromotionEvidenceInput['mode']): Check {
  if (!report) return unknown('post-action read-only cache-window observations absent; no action implied');
  const binding = checked(() => {
    assert(isServingEvidenceReport(report), 'cache result was not computed from original GET captures');
    const observed = report.configuration;
    if (configuration.prompt.version === 'unpromoted-candidate') {
      assert.equal(typeof observed.prompt.version, 'number', 'served PMS candidate version remains unresolved');
      // CC/PMS assigns the numeric version. Evidence must bind the observed
      // assignment to the exact candidate bytes and every other component.
      assert.equal(report.configurationSha256, configurationHash({ ...configuration, prompt: { ...configuration.prompt, version: observed.prompt.version } }), 'observed version does not carry exact candidate configuration');
    } else assert.equal(report.configurationSha256, configurationHash(configuration), 'cache observations target wrong configuration');
    assert.equal(report.mode, mode, 'simulated and actual cache observations cannot be interchanged');
  });
  if (binding.status === 'FAIL') return binding;
  const checks = [report.cacheWindow, report.levels.configured, report.levels.selected, report.levels.selectedModel, report.levels.loaded, report.levels.deployed];
  // Administrative cache reads do not show what any individual user received.
  // Keep full response/composition gaps visible, even when sampled selection settles.
  checks.push(report.actualResponse, report.actualResponseSelection, report.fleet);
  // Missing provider evidence is outside the cache check; a supplied, known
  // contradiction is not. Never hide a failed actual request behind GET success.
  if (report.levels.providerBound.status === 'FAIL') checks.push(report.levels.providerBound);
  if (report.levels.observed.status === 'FAIL') checks.push(report.levels.observed);
  return { status: combine(checks), issues: checks.flatMap(c => c.issues) };
}
function rollbackCheck(input: PromotionEvidenceInput): Check {
  if (!input.rollback) return unknown('exact rollback configuration and original PMS snapshot absent');
  return checked(() => {
    const pointer = input.rollback!;
    assert.deepEqual(configurationIssues(pointer.configuration), [], 'rollback configuration incomplete');
    assert.equal(configurationHash(pointer.configuration), configurationHash(input.incumbent), 'rollback does not restore exact incumbent');
    assert.equal(pointer.codeRef, input.incumbent.sourceHead, 'rollback code ref is not exact incumbent head');
    assert(Number.isFinite(Date.parse(pointer.observedAt)), 'rollback observation time absent');
    const capture = pointer.originalPms;
    assert.equal(capture.method, 'GET', 'rollback pointer must come from read-only incumbent capture');
    assert.equal(new URL(capture.url).pathname, `/admin/prompts/${input.incumbent.prompt.id}`, 'rollback PMS endpoint mismatch');
    assert.equal(capture.httpStatus, 200, 'rollback PMS capture failed');
    assert.equal(sha256(capture.body), capture.bodySha256, 'rollback raw snapshot hash mismatch');
    const snapshot = PromptDefinitionSchema.pick({ id: true, taskId: true, activeVersion: true, stagingVersion: true, versions: true, modelConfig: true }).parse(JSON.parse(capture.body));
    assert.equal(snapshot.id, input.incumbent.prompt.id, 'rollback prompt id mismatch');
    assert.equal(snapshot.taskId, input.incumbent.task, 'rollback task mismatch');
    assert.deepEqual(pointer.pmsSelection, { activeVersion: snapshot.activeVersion, stagingVersion: snapshot.stagingVersion ?? null, modelConfig: snapshot.modelConfig ?? null }, 'rollback full environment/model selection pointer mismatch');
    const selected = pointer.environment === 'staging' ? snapshot.stagingVersion ?? snapshot.activeVersion : snapshot.activeVersion;
    assert.equal(selected, input.incumbent.prompt.version, 'rollback snapshot did not select incumbent version');
    const versions = snapshot.versions.filter(v => v.version === selected);
    assert.equal(versions.length, 1, 'rollback version absent or duplicated');
    assert.equal(sha256(versions[0]!.content), input.incumbent.prompt.sha256, 'rollback prompt bytes mismatch');
  });
}

export function buildPromotionEvidencePacket(input: PromotionEvidenceInput) {
  const identity = checked(() => {
    assert.deepEqual(configurationIssues(input.incumbent), [], 'incumbent identity incomplete');
    assert.deepEqual(configurationIssues(input.candidate), [], 'candidate identity incomplete');
    assert.equal(typeof input.incumbent.prompt.version, 'number', 'incumbent PMS version must be observed, not an unpromoted candidate');
    assert.equal(input.incumbent.task, input.candidate.task, 'candidate changed target task');
    assert.notEqual(configurationHash(input.incumbent), configurationHash(input.candidate), 'candidate and incumbent are identical');
  });
  const changedRuntime = input.incumbent.sourceHead !== input.candidate.sourceHead
    || input.incumbent.instructionSha256 !== input.candidate.instructionSha256
    || evidenceHash([input.incumbent.schema, input.incumbent.parser, input.incumbent.projector, input.incumbent.consumer]) !== evidenceHash([input.candidate.schema, input.candidate.parser, input.candidate.projector, input.candidate.consumer]);
  const changedPmsSelection = evidenceHash(input.incumbent.prompt) !== evidenceHash(input.candidate.prompt)
    || evidenceHash(input.incumbent.model) !== evidenceHash(input.candidate.model);
  const codeOnlyRequired = changedRuntime && changedPmsSelection;
  let codeOnlyIdentity: Check = { status: 'PASS', issues: [] };
  if (input.codeOnly) codeOnlyIdentity = checked(() => {
    assert.deepEqual(configurationIssues(input.codeOnly!), [], 'code-only identity incomplete');
    assert.equal(input.codeOnly!.task, input.incumbent.task, 'code-only task mismatch');
    assert.deepEqual(input.codeOnly!.prompt, input.incumbent.prompt, 'code-only must retain incumbent PMS identity');
    assert.equal(input.codeOnly!.sourceHead, input.candidate.sourceHead, 'code-only must bind candidate code');
    assert.equal(input.codeOnly!.instructionSha256, input.candidate.instructionSha256, 'code-only appended instruction mismatch');
    for (const role of ['schema', 'parser', 'projector', 'consumer'] as const) assert.deepEqual(input.codeOnly![role], input.candidate[role], `code-only ${role} mismatch`);
  });
  else if (codeOnlyRequired) codeOnlyIdentity = unknown('reachable code-only configuration unresolved; candidate evidence cannot cover it');
  const structural = evaluateReceipt(input.evaluations.structural, 'structural', [input.candidate], input.mode);
  const comparison = evaluateReceipt(input.evaluations.comparison, 'reasoning', [input.incumbent, input.candidate], input.mode);
  const codeOnly = input.codeOnly ? evaluateReceipt(input.evaluations.codeOnly, 'reasoning', [input.codeOnly], input.mode)
    : codeOnlyRequired ? unknown('reachable code-only controlled semantic evidence absent') : { status: 'PASS' as const, issues: [] };
  const rollback = rollbackCheck(input);
  const candidateCache = cacheCheck(input.cacheTransitions?.candidate, input.candidate, input.mode);
  const rollbackCache = cacheCheck(input.cacheTransitions?.rollback, input.incumbent, input.mode);
  const preActionEvidenceStatus = combine([identity, structural, comparison, codeOnlyIdentity, codeOnly, rollback]);
  const status = combine([{ status: preActionEvidenceStatus, issues: [] }, candidateCache, rollbackCache]);
  return {
    format: 'olumi.prompt-consumer.promotion-evidence.v1' as const,
    mode: input.mode, inputSha256: evidenceHash(input), status, preActionEvidenceStatus,
    configurations: { incumbent: input.incumbent, candidate: input.candidate, codeOnly: input.codeOnly ?? null },
    configurationHashes: { incumbent: configurationHash(input.incumbent), candidate: configurationHash(input.candidate), codeOnly: input.codeOnly ? configurationHash(input.codeOnly) : null },
    checks: { identity, structural, comparison, codeOnlyIdentity, codeOnly, rollback, candidateCache, rollbackCache },
    evidence: {
      structural: input.evaluations.structural ?? null, comparison: input.evaluations.comparison ?? null, codeOnly: input.evaluations.codeOnly ?? null,
      candidateCache: input.cacheTransitions?.candidate ?? null, rollbackCache: input.cacheTransitions?.rollback ?? null,
      rollback: input.rollback ?? null,
    },
    codeOnlyRequired,
    operations: { owner: 'CC' as const, promotionPerformed: false as const, rollbackPerformed: false as const,
      procedure: 'Existing approved PMS/deploy procedures only; this packet has no client or admission hook. Preserve original environment-specific PMS/model selection and exact code head; after each CC-authorised action collect successful GET snapshots plus request-correlated individual responses spanning verified effective cache expiry on each observed instance. Missing response/provider/composition telemetry remains UNVERIFIED.' },
    deployedSemanticStatus: 'UNVERIFIED' as const,
    deploymentPermission: 'NOT_GRANTED' as const,
    limitation: input.mode === 'simulation'
      ? 'Synthetic timeline rehearsal only. PASS proves packet refusal/identity mechanics, never a real promotion, rollback, model evaluation, deployment or user journey.'
      : 'Evidence packet for independent review, not a release decision. Selected/loaded cache identity cannot prove full provider bytes, semantic quality, fleet convergence or a deployed user journey.',
  };
}
