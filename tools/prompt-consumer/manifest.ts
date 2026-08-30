/** Read-only, bounded registry. Nothing here is imported by production execution. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUNTIME_AI_TASK_AUTHORITY } from '../../src/config/model-routing.js';
import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
import { buildDraftRecordsSchema } from '../../src/cee/draft/records/grammar.js';
import { buildRecordsCompletionSchema } from '../../src/cee/draft/records/completion.js';
import { sha256, type ContractStatus, type SemanticProbeResult } from './contract.js';
import { runDraftContractProbes, runDraftMutationFamilies } from './draft.js';
import { runRecoveryProbes, runRecoveryMutations, recoveryExamples } from './recovery.js';
import { runValidationProbe, runValidationMutations } from './validation.js';

export const root = resolve(import.meta.dirname, '../..');
export const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
export interface PromptObservation {
  id: string; version: number; content: string; sha256: string;
  configuredModel: string | null; loadedAt: string | null;
  /** /verify returns a short digest; the full hash is computed from selected bytes. */
  verifiedLoadedHash: string;
}
export interface RuntimeObservation {
  observedAt: string; deployedHead: string; healthBuild: string;
  prompts: { draft_graph: PromptObservation; validate_graph: PromptObservation };
}
const source = (path: string, exportName: string) => ({ path, exportName, fileSha256: sha256(read(path)) });
const combine = (states: readonly ContractStatus[]): ContractStatus => states.includes('FAIL') ? 'FAIL' : states.includes('UNVERIFIED') ? 'UNVERIFIED' : 'PASS';

/** Semantic review annotations are bound to exact complete inputs, not word matches.
 * Unknown bytes require review; adding "uncertainty" to teapot prose cannot pass. */
export function draftObligations(promptHash: string, instructionHash: string) {
  const incumbent = sha256(read('src/cee/draft/records/__tests__/fixtures/served-draft-graph-v195.txt'));
  const candidate = sha256(read('Prompts/candidates/draft_graph_records.txt'));
  const oldInstruction = sha256(read('src/cee/draft/records/__tests__/fixtures/records-instruction-v10.txt').trimEnd());
  const currentInstruction = sha256(DRAFT_RECORDS_INSTRUCTION);
  // Full hashes below pin the *review*, not whatever bytes happen to be in files.
  const reviewed = {
    incumbent: '152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f',
    candidate: '9feaff0ba020adcca99ffc22ffbb99e298f41dec9fc26e64e2c84bf5178a1717',
    oldInstruction: '3a1226696828692f6538a2de8bc8e156c5a9ce69575748c23094444642e81ce1',
    currentInstruction: '51d260e6bc07b8d80ea170533e2ec2f565ed8ee83fbe63be1aed351ac35770fa',
  };
  const knownPrompt = (promptHash === incumbent && incumbent === reviewed.incumbent) || (promptHash === candidate && candidate === reviewed.candidate);
  const old = instructionHash === oldInstruction && oldInstruction === reviewed.oldInstruction;
  const current = instructionHash === currentInstruction && currentInstruction === reviewed.currentInstruction;
  if (!knownPrompt || (!old && !current)) return { status: 'UNVERIFIED' as const, reason: 'Full prompt/instruction pair has no semantic review binding', requests: [] as string[] };
  return {
    status: 'PASS' as const, reason: 'Exact inputs reviewed in #1228; this binds obligations, not model behaviour',
    requests: ['stated-quantity-with-source', 'inferred-scalar', 'option-effect', 'causal-links', ...(old ? ['prior-confidence'] : [])],
    hypothesisRetention: 'UNVERIFIED: no typed attributed-hypothesis consumer',
  };
}

function promptIdentity(p?: PromptObservation) {
  if (!p) return { status: 'UNVERIFIED' as const, reason: 'No current PMS/runtime observation' };
  assert.equal(sha256(p.content), p.sha256, 'selected prompt bytes do not match full digest');
  assert.equal(p.verifiedLoadedHash, p.sha256.slice(0, p.verifiedLoadedHash.length), 'loaded runtime digest differs from selected bytes');
  assert(p.verifiedLoadedHash.length >= 16 && p.loadedAt, 'runtime did not verify loaded prompt');
  return { status: 'PASS' as const, id: p.id, version: p.version, sha256: p.sha256, loadedAt: p.loadedAt, verifiedLoadedHash: p.verifiedLoadedHash, evidence: 'selected PMS bytes + runtime loaded digest; not provider-bound' };
}
function compact(result: SemanticProbeResult) {
  return { id: result.id, status: result.status, issues: result.issues, identity: result.participation.identity,
    participation: result.participation.components.map(c => ({ role: c.role, ...source(c.source.path, c.source.exportName), calls: c.calls })) };
}

export function buildContractManifest(runtime?: RuntimeObservation) {
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceDirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
  let deployedInstructionHash: string | null = null;
  let deployedSourceAgreement: ContractStatus = 'UNVERIFIED';
  const comparedDraftSources = ['src/cee/draft/records/grammar.ts', 'src/cee/draft/records/seam.ts', 'src/cee/draft/records/projector.ts', 'src/cee/transforms/schema-v3.ts'];
  if (runtime) {
    assert(/^[a-f0-9]{40}$/.test(runtime.deployedHead), 'full deployed source head required');
    assert(runtime.deployedHead.startsWith(runtime.healthBuild), 'source head does not match health build');
    // Do not evaluate arbitrary historical source. Known instruction export has a pinned fixture.
    const oldSource = execFileSync('git', ['show', `${runtime.deployedHead}:src/cee/draft/records/instruction.ts`], { cwd: root, encoding: 'utf8' });
    const fixtureSource = execFileSync('git', ['show', '7aa2aa57b8ccb330bab173294ce6ac60a8a82528:src/cee/draft/records/instruction.ts'], { cwd: root, encoding: 'utf8' });
    if (oldSource === read('src/cee/draft/records/instruction.ts')) deployedInstructionHash = sha256(DRAFT_RECORDS_INSTRUCTION);
    else if (oldSource === fixtureSource) deployedInstructionHash = sha256(read('src/cee/draft/records/__tests__/fixtures/records-instruction-v10.txt').trimEnd());
    deployedSourceAgreement = comparedDraftSources.every(p => execFileSync('git', ['show', `${runtime.deployedHead}:${p}`], { cwd: root, encoding: 'utf8' }) === read(p)) ? 'PASS' : 'UNVERIFIED';
  }
  const draft = runDraftContractProbes();
  const obligations = draftObligations(runtime?.prompts.draft_graph.sha256 ?? '', deployedInstructionHash ?? '');
  const requiredDraft = draft.filter(p => p.id !== 'draft.requested-confidence' || obligations.requests.includes('prior-confidence'));
  const recovery = runRecoveryProbes();
  const validation = runValidationProbe();
  const mutations = [...runDraftMutationFamilies(), runRecoveryMutations(), runValidationMutations()];
  const draftPrompt = promptIdentity(runtime?.prompts.draft_graph);
  const validationPrompt = promptIdentity(runtime?.prompts.validate_graph);
  const routes = [
    {
      route: 'draft.primary-and-structural-completion', task: 'draft_graph', authority: RUNTIME_AI_TASK_AUTHORITY.draft_graph,
      prompt: draftPrompt,
      model: { configuredPms: runtime?.prompts.draft_graph.configuredModel ?? null, actualBound: null, status: 'UNVERIFIED', reason: 'PMS pin is not proof of a deployed provider call; #1228 banks local-provider observations separately' },
      instructions: { local: source('src/cee/draft/records/instruction.ts', 'DRAFT_RECORDS_INSTRUCTION'), localExportSha256: sha256(DRAFT_RECORDS_INSTRUCTION), deployedExportSha256: deployedInstructionHash },
      grammar: { ...source('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'), sha256: sha256(JSON.stringify(buildDraftRecordsSchema())), modes: ['attached JSON schema', 'embedded schema when structured output degrades'] },
      completion: { ...source('src/cee/draft/records/completion.ts', 'buildRecordsCompletionSchema / mergeCompletionClaims'), grammarSha256: sha256(JSON.stringify(buildRecordsCompletionSchema())), requests: ['structural claims only'], not: ['factor estimation', 'new stated facts'], assemblyEvidence: 'src/adapters/llm/__tests__/draft-prompt-consumer-assembly.test.ts' },
      obligations, deployedSourceComparison: { status: deployedSourceAgreement, paths: comparedDraftSources, limitation: 'Only these immediate source files; not full deployment/route equivalence' },
      representations: { expressible: ['scalar', 'sets_to', 'basis', 'source_quote', 'unit', 'omitted scalar'], unsupported: ['factor confidence/range', 'typed rationale/refusal', 'attributed hypotheses'], consumable: 'See per-representation probes; representability is not preservation' },
      probes: requiredDraft.map(compact), conditionalCapabilityQueries: draft.filter(p => !requiredDraft.includes(p)).map(compact),
      deterministicStatus: combine(requiredDraft.map(p => p.status)),
      status: combine([...requiredDraft.map(p => p.status), obligations.status, 'UNVERIFIED']),
    },
    {
      route: 'readiness.ask-to-bind', task: 'orchestrator', authority: RUNTIME_AI_TASK_AUTHORITY.orchestrator,
      prompt: { kind: 'deterministic product question', ...source('src/orchestrator-v5/coaching/readiness-recovery.ts', 'projectReadinessRecovery'), pms: 'not involved in this fast path' },
      model: { applicable: false, reason: 'No LLM call in this question/binder seam' },
      representations: { requested: ['human percentage with 0% and 100% anchors'], acceptedExamples: recoveryExamples(), expressible: ['absolute numeric/percentage effect', 'distinct no-change reading'], consumable: ['canonical option/factor numeric edit operation'], excluded: ['advertising internal 0–1 representation', 'no-change write primitive', 'pending-answer or referent routing', 'persistence/apply'] },
      cases: recovery.map((r, i) => ({ example: [...recoveryExamples().map(e => e.example), 'no change'][i], ...compact(r) })),
      deterministicStatus: combine(recovery.map(r => r.status)),
      status: 'UNVERIFIED' as ContractStatus,
      limitation: 'Canonical advertised examples bind and write correctly; arbitrary ask prose semantics and deployed/pending routing are not certified',
    },
    {
      route: 'draft.edge-validation-pass2', task: 'validate_graph', authority: RUNTIME_AI_TASK_AUTHORITY.validate_graph,
      prompt: validationPrompt,
      model: { configuredPms: runtime?.prompts.validate_graph.configuredModel ?? null, checkedIn: RUNTIME_AI_TASK_AUTHORITY.validate_graph.checkedInModel, actualBound: null, status: 'UNVERIFIED' },
      grammar: { attachedSchema: null, mode: 'json_object', authority: source('src/cee/validation-pipeline/validate-graph.ts', 'callValidateGraph') },
      representations: { requested: ['edge mean/std', 'existence probability', 'reasoning', 'basis'], expressible: ['JSON object parsed as Pass2Response'], consumable: ['std changes confidence-band contestation', 'reasoning/basis carried in comparison metadata'] },
      obligations: { status: validationPrompt.status === 'PASS' && runtime?.prompts.validate_graph.sha256 === '45073b566184e4e8a6ce5047378e1d1e51c4e68294f8dd524e26c1219b51f066' ? 'PASS' : 'UNVERIFIED', reason: 'Exact v4 review binding; unknown bytes require semantic review, not a keyword scan' },
      probes: [compact(validation)], deterministicStatus: validation.status,
      providerAssemblyEvidence: 'tools/prompt-consumer/validation-assembly.test.ts (local SDK-bound request, not real/deployed provider)',
      status: combine([validation.status, 'UNVERIFIED']),
    },
  ];
  return {
    format: 'olumi.prompt-consumer.v1', generatedAt: new Date().toISOString(), sourceHead, sourceDirty,
    runtime: runtime ? { observedAt: runtime.observedAt, deployedHead: runtime.deployedHead, healthBuild: runtime.healthBuild } : null,
    status: combine([...routes.map(r => r.status), ...mutations.map(m => m.status)]),
    liveClosure: 'UNVERIFIED: local executable probes do not certify deployed behaviour or provider binding',
    routes, mutations: mutations.map(m => ({ id: m.id, status: m.status, issues: m.issues, cases: m.cases.map(c => ({ id: c.id, kind: c.kind, status: c.result.status })) })),
    factorQuantification: { status: 'UNVERIFIED', registered: false, interface: 'FactorQuantificationRegistration<SharedQuantityContract>', requires: ['actual runtime task', 'exact head', 'schema/parser/consumer exports', 'shared quantity definition import', 'fixtures'], owner: 'Factor Quantification' },
    promotionEvidence: { status: 'UNVERIFIED', integrated: false, reason: 'No production dependency or admission hook. Require independent bound evidence before integrating with existing PMS promotion.' },
  };
}
