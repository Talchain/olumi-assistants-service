/** Banked activation-combination coverage, not promotion permission or semantic certification. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDraftRecordsSchema } from '../../src/cee/draft/records/grammar.js';
import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
import { DraftRecordSetWire, projectDraftRecords } from '../../src/cee/draft/records/seam.js';
import { LLMDraftResponse } from '../../src/adapters/llm/shared-schemas.js';
import { sha256, assertExactCaseIds } from './contract.js';

const ROOT = resolve(import.meta.dirname, '../..');
export const ACTIVATION_HASHES = Object.freeze({
  archive: '1b9114c4081dbf9f954e9c86b274c02bc31f863b15d146ffa9b71a995b78f638',
  archiveContent: '319779b05ad779c4369203e6445ccb0246955a57bec57b2da1cf97c70b9e1a2a',
  supplement: 'a85b96b75de5bd37f5f2c66ca685062867c38fa7df8e5e035acb7bc88e7b4a4f',
  oldPrompt: '152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f',
  candidate: '9feaff0ba020adcca99ffc22ffbb99e298f41dec9fc26e64e2c84bf5178a1717',
  oldInstruction: '3a1226696828692f6538a2de8bc8e156c5a9ce69575748c23094444642e81ce1',
  newInstruction: '51d260e6bc07b8d80ea170533e2ec2f565ed8ee83fbe63be1aed351ac35770fa',
  destroyed: 'dd1b3b78f323617859642b5109f8b4296231387273704bbaf540659f15be01a4',
  grammar: 'e6c508e0285a95c6d5dd84bfacc91921871d9c3bb7b7d3e55f8514ba6d8010a7',
  corpus: '8cef39510f038d3806c1dae7ccd867b49deefb299236767c0a7588d72991fcce',
});
const MODEL = 'claude-sonnet-4-6';
type Arm = 'incumbent' | 'code-only' | 'candidate' | 'destroyed';
type Direction = 'diagnostic' | 'decision';
interface Scores {
  id: string; arm: Arm; direction: Direction; repetition: number; providerCalls: number;
  providerModels: string[]; rawOptionCount: number; projectedOptionCount: number; consumedOptionCount: number;
}
interface Capture {
  kind: string; request: Record<string, unknown>;
  response: { model: string; content: Array<{ type: string; text?: string }> };
}
interface ObservedCase {
  id?: string; scores?: Scores; summary?: Scores; brief: string; raw: unknown;
  consumed: { graph: unknown }; captures: Capture[];
}
interface EvidenceBlock {
  identity: { sourceHead: string; grammarSha256: string; modelResolution: { task: string; resolved_model: string } };
  cases: ObservedCase[];
}
export interface ActivationEvidence {
  archive: EvidenceBlock;
  codeOnly: EvidenceBlock | null;
  /** Deliberately not used to establish participation or behaviour. */
  annotations?: Record<string, unknown>;
}
const object = (value: unknown): Record<string, unknown> => {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected object');
  return value as Record<string, unknown>;
};
const hash = (value: unknown) => sha256(JSON.stringify(value));

// Decoder for the existing lossless archive format; no provider/evaluation work.
function unpack(value: unknown, strings: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map(v => unpack(v, strings));
  if (value === null || typeof value !== 'object') return value;
  const entry = object(value);
  if ('$evidenceJson' in entry) return JSON.parse(String(unpack(entry.$evidenceJson, strings)));
  if ('$evidenceText' in entry) {
    const key = String(entry.$evidenceText), text = strings[key];
    assert.equal(typeof text, 'string');
    assert.equal(sha256(String(text)), key, 'archive text identity');
    return text;
  }
  return Object.fromEntries(Object.entries(entry).map(([key, v]) => [key, unpack(v, strings)]));
}

/** Full archive digests are checked before callers can inspect/mutate decoded observations. */
export function loadActivationEvidence(root = ROOT): ActivationEvidence {
  const archiveBytes = readFileSync(resolve(root, 'evidence/prompt-consumer/8eb8e19-behaviour.json'), 'utf8');
  const supplementBytes = readFileSync(resolve(root, 'evidence/prompt-consumer/9878b1f-code-only.json'), 'utf8');
  assert.equal(sha256(archiveBytes), ACTIVATION_HASHES.archive, 'banked archive changed');
  assert.equal(sha256(supplementBytes), ACTIVATION_HASHES.supplement, 'banked supplement changed');
  const envelope = object(JSON.parse(archiveBytes));
  assert.equal(envelope.format, 'olumi.draft-contract-evidence.v1');
  const archive = unpack(envelope.content, object(envelope.strings));
  assert.equal(hash(archive), ACTIVATION_HASHES.archiveContent, 'decoded archive changed');
  const supplement = JSON.parse(supplementBytes) as EvidenceBlock & { format: string };
  assert.equal(supplement.format, 'olumi.draft-code-only-supplement.v1');
  return { archive: archive as EvidenceBlock, codeOnly: supplement };
}

function observe(item: ObservedCase, arm: Arm, fullRequest: boolean) {
  const score = item.scores ?? item.summary;
  assert(score, 'case scores absent');
  assert.equal(score.arm, arm, 'case arm identity');
  assert.equal(item.captures.length, score.providerCalls, 'provider-call collection');
  assert.equal(item.captures.filter(c => c.kind === 'draft').length, 1, 'primary draft capture count');
  const primary = item.captures.find(c => c.kind === 'draft');
  assert(primary, 'primary draft provider request absent');
  const request = primary.request;
  const model = fullRequest ? request.model : object(request.parameters).model;
  assert.equal(model, MODEL, 'primary request model');
  assert.equal(primary.response.model, MODEL, 'primary response model');
  assert.equal(score.providerModels[0], MODEL, 'recorded provider model');
  const blocks = request.system as Array<Record<string, unknown>>;
  assert(Array.isArray(blocks), 'primary system blocks absent');
  const blockHashes = blocks.map(b => fullRequest ? sha256(String(b.text)) : b.sha256);
  const expectedBlocks = arm === 'destroyed' ? [ACTIVATION_HASHES.destroyed] : [
    arm === 'candidate' ? ACTIVATION_HASHES.candidate : ACTIVATION_HASHES.oldPrompt,
    arm === 'incumbent' ? ACTIVATION_HASHES.oldInstruction : ACTIVATION_HASHES.newInstruction,
  ];
  assert.deepEqual(blockHashes, expectedBlocks, 'primary prompt/instruction combination');
  const grammarHash = fullRequest ? hash(object(object(request.output_config).format).schema) : request.grammarSha256;
  assert.equal(grammarHash, ACTIVATION_HASHES.grammar, 'primary grammar identity');
  const emittedText = primary.response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  assert.deepEqual(JSON.parse(emittedText), item.raw, 'emitted records must be the captured primary response');
  const records = DraftRecordSetWire.parse(item.raw);
  const emitted = records.stated_items.filter(r => r.kind === 'option').length + records.claims.filter(r => r.claim_kind === 'option_refinement').length;
  const seam = projectDraftRecords(item.raw, item.brief);
  assert(seam.ok, 'actual records parser rejected captured emission');
  const projected = seam.projection.graph.nodes.filter(n => n.kind === 'option').length;
  const consumed = LLMDraftResponse.parse(item.consumed.graph).nodes.filter(n => n.kind === 'option').length;
  assert.deepEqual([emitted, projected, consumed], [score.rawOptionCount, score.projectedOptionCount, score.consumedOptionCount], 'emitted/projected/consumed counts disagree');
  return { id: score.id, direction: score.direction, emitted, projected, consumed,
    primaryRequest: { model, promptSha256: blockHashes[0], instructionSha256: blockHashes[1] ?? null,
      grammarSha256: grammarHash, requestSha256: fullRequest ? hash(request) : request.sha256,
      evidence: fullRequest ? 'full captured request' : 'immutable archived request/field hashes' } };
}

/** Coverage may PASS; semantic quality, attribution and activation never receive a PASS here. */
export function buildActivationCoverageReport(evidence: ActivationEvidence = loadActivationEvidence()) {
  const issues: string[] = [];
  const observed: Array<ReturnType<typeof observe> & { arm: Arm }> = [];
  const check = (run: () => void) => { try { run(); } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); } };
  const corpus = JSON.parse(readFileSync(resolve(ROOT, 'src/cee/draft/records/__tests__/fixtures/draft-intent-pairs.json'), 'utf8')) as Array<{ id: string; diagnostic: string; decision: string }>;
  check(() => {
    assert.equal(hash(corpus), ACTIVATION_HASHES.corpus, 'frozen independent corpus');
    assert.equal(hash(buildDraftRecordsSchema()), ACTIVATION_HASHES.grammar, 'current grammar differs from measured grammar');
    assert.equal(sha256(DRAFT_RECORDS_INSTRUCTION), ACTIVATION_HASHES.newInstruction, 'current instruction differs from measured instruction');
    assert.equal(sha256(readFileSync(resolve(ROOT, 'Prompts/candidates/draft_graph_records.txt'), 'utf8')), ACTIVATION_HASHES.candidate, 'current candidate differs from measured candidate');
  });
  for (const [block, fullRequest, expectedHead] of [
    [evidence.archive, false, '8eb8e1912a99a6e361df8c398bb9148faa862750'],
    [evidence.codeOnly, true, '9878b1f66ce59e23300de6f6645c6984773374ab'],
  ] as const) {
    if (!block) { issues.push('missing code-only activation coverage'); continue; }
    check(() => {
      assert.equal(block.identity.sourceHead, expectedHead, 'captured source head');
      assert.equal(block.identity.modelResolution.task, 'draft_graph', 'captured task identity');
      assert.equal(block.identity.modelResolution.resolved_model, MODEL, 'captured model identity');
      assert.equal(block.identity.grammarSha256, ACTIVATION_HASHES.grammar, 'captured grammar identity');
      const expected = (fullRequest ? corpus.slice(0, 1) : corpus).flatMap(pair => (['diagnostic', 'decision'] as const).flatMap(direction =>
        (fullRequest ? [1] : [1, 2, 3]).flatMap(repetition => (fullRequest ? ['code-only'] : ['incumbent', 'candidate', 'destroyed']).map(arm => `${pair.id}-${direction}-${repetition}-${arm}`))));
      assertExactCaseIds(expected, block.cases.map(c => (c.scores ?? c.summary)!.id));
    });
    for (const item of block.cases) check(() => {
      const score = item.scores ?? item.summary;
      assert(score, 'case identity absent');
      const pair = corpus.find(p => `${p.id}-${score.direction}-${score.repetition}-${score.arm}` === score.id);
      assert(pair, 'case is not in the frozen independent corpus');
      assert.equal(item.brief, pair[score.direction], 'case brief identity');
      observed.push({ ...observe(item, score.arm, fullRequest), arm: score.arm });
    });
  }
  const combination = (arm: Arm, combinationId: string) => {
    const cases = observed.filter(c => c.arm === arm);
    const diagnostics = cases.filter(c => c.direction === 'diagnostic');
    const decisions = cases.filter(c => c.direction === 'decision');
    return { combination: combinationId, cases: cases.length,
      diagnostic: { cases: diagnostics.length, emittedOptions: diagnostics.map(c => c.emitted), consumedOptions: diagnostics.map(c => c.consumed),
        nonCollapse: diagnostics.some(c => c.emitted > 0 || c.consumed > 0) ? 'FAIL' : 'UNVERIFIED: zero options alone is not preserved meaning' },
      decision: { cases: decisions.length, emittedOptions: decisions.map(c => c.emitted), consumedOptions: decisions.map(c => c.consumed),
        semanticCarriage: 'UNVERIFIED: option counts do not prove legitimate alternatives survived' },
      checkedPrimaryRequests: cases.length,
      // Shared component bindings were checked on EACH captured request above.
      // Individual request bodies/digests remain in the immutable bank, not copied here.
      primaryBindings: cases[0] ? {
        model: cases[0].primaryRequest.model, promptSha256: cases[0].primaryRequest.promptSha256,
        instructionSha256: cases[0].primaryRequest.instructionSha256, grammarSha256: cases[0].primaryRequest.grammarSha256,
        evidence: cases[0].primaryRequest.evidence,
      } : null,
      hypothesisPreservation: 'UNVERIFIED: no typed attributed carrier; omission or relabelling cannot pass',
      semanticVerdict: 'UNVERIFIED' as const };
  };
  return { coverageStatus: issues.length ? 'FAIL' as const : 'PASS' as const, issues,
    evidence: { archiveSha256: ACTIVATION_HASHES.archive, supplementSha256: ACTIVATION_HASHES.supplement,
      archiveHead: evidence.archive.identity.sourceHead, codeOnlyHead: evidence.codeOnly?.identity.sourceHead ?? null },
    combinations: [combination('incumbent', 'old-pms-old-instruction'), combination('code-only', 'old-pms-new-instruction'), combination('candidate', 'candidate-new-instruction')],
    destroyedControl: combination('destroyed', 'destroyed-prompt-without-records-instruction'),
    activationPermission: 'NOT_GRANTED' as const,
    limitation: 'Local real-provider captures and captured consumer counts, not deployment or independent semantic review. Old instructions were replayed at the provider boundary against the same consumer, not an old deployment. The 54-case archive retains request/field hashes, not full request bodies; only the two-case code-only supplement retains full requests. Initial projection is replayed; completion/repair is not rerun.' };
}
