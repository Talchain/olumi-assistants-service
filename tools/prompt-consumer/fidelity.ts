/** Draft SDK-bound fidelity. A text-only admin result is never a serving replica. */
import assert from 'node:assert/strict';
import { Ajv } from 'ajv';
import { sha256, type ContractStatus } from './contract.js';

export const digest = (value: unknown) => sha256(JSON.stringify(value) ?? 'undefined');
export interface SourceIdentity { path: string; exportName: string; sha256: string }
export interface DraftConfiguration {
  task: 'draft_graph'; sourceHead: string; sourceDirty: boolean;
  prompt: { id: string; version: number | string; content: string; sha256: string };
  model: { id: string; provider: string; resolutionSource: string };
  instruction: { content: string; sha256: string };
  grammar: { schema: object; sha256: string };
  parser: SourceIdentity; projector: SourceIdentity; consumer: SourceIdentity;
}
export interface DraftCapture {
  sourceHead: string; brief: string;
  scope: 'local-production-adapter' | 'admin-text-only' | 'synthetic-control';
  transport: 'real-provider' | 'replay';
  request: { model?: string; system?: unknown; output_config?: unknown; thinking?: unknown; [key: string]: unknown };
  response?: { model?: string; stop_reason?: string; content?: Array<{ type: string; text?: string }> };
  consumedGraph?: unknown;
}
export interface DraftImplementations {
  parserIdentity: SourceIdentity; projectorIdentity: SourceIdentity; consumerIdentity: SourceIdentity;
  /** Rebuilt using the target adapter's real prompt builder, not read from a capture. */
  expectedMessages?: unknown; expectedBriefSha256?: string;
  parse: (raw: unknown, brief: string) => { ok: boolean; projection?: { graph: unknown } };
  consume: (graph: unknown) => unknown;
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const issued = new WeakSet<object>();

/** Execute the real imported functions, not a status supplied by a capture file.
 * This is initial records projection plus final graph-schema acceptance. It is
 * not a replay of canonical commit, parseAndValidate deadline retries or UI. */
export function assessDraftFidelity(expected: DraftConfiguration, capture: DraftCapture, implementation: DraftImplementations) {
  const issues: string[] = [], structuralIssues: string[] = [];
  const check = (condition: unknown, message: string) => { if (!condition) issues.push(message); };
  check(/^[a-f0-9]{40}$/.test(expected.sourceHead) && capture.sourceHead === expected.sourceHead, 'source head differs from the intended runtime');
  check(!expected.sourceDirty, 'runtime source is dirty');
  check(expected.prompt.sha256 === sha256(expected.prompt.content), 'expected prompt bytes/hash disagree');
  check(expected.instruction.sha256 === sha256(expected.instruction.content), 'expected instruction bytes/hash disagree');
  check(expected.grammar.sha256 === digest(expected.grammar.schema), 'expected grammar bytes/hash disagree');
  check(digest(implementation.parserIdentity) === digest(expected.parser), 'wrong parser implementation identity');
  check(digest(implementation.projectorIdentity) === digest(expected.projector), 'wrong projector implementation identity');
  check(digest(implementation.consumerIdentity) === digest(expected.consumer), 'wrong consumer implementation identity');
  const blocks = Array.isArray(capture.request.system) ? capture.request.system.map(b => object(b).text) : [];
  const grammar = object(object(capture.request.output_config).format).schema;
  const composition = { systemBlocks: blocks.length, promptHashes: blocks.map(b => typeof b === 'string' ? sha256(b) : null),
    grammarSha256: grammar ? digest(grammar) : null, thinking: capture.request.thinking ?? null };
  const local = capture.scope !== 'admin-text-only';
  const userCompositionAvailable = implementation.expectedMessages !== undefined && implementation.expectedBriefSha256 !== undefined;
  if (local) {
    check(blocks.length === 2 && blocks[0] === expected.prompt.content && blocks[1] === expected.instruction.content, 'intended prompt and appended instruction did not reach provider');
    check(grammar !== undefined && digest(grammar) === expected.grammar.sha256, 'attached grammar differs or is absent; prompt-only mode needs separate measured authority');
    check(capture.request.thinking !== undefined, 'thinking posture was omitted, not measured');
    if (userCompositionAvailable) {
      check(implementation.expectedBriefSha256 === sha256(capture.brief), 'captured brief differs from the real prompt-builder input');
      check(digest(capture.request.messages) === digest(implementation.expectedMessages), 'intended brief/user composition did not reach provider');
    }
  }
  check(expected.model.provider === 'anthropic', 'this adapter probe does not cover the intended provider');
  check(capture.request.model === expected.model.id, 'wrong request model');
  if (capture.response) check(capture.response.model === expected.model.id, 'wrong or missing provider-returned model');
  const responseText = capture.response?.content?.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
  let raw: unknown, projectedGraph: unknown, consumedGraph: unknown;
  let parserCalls = 0, consumerCalls = 0;
  if (responseText !== undefined) {
    try {
      raw = JSON.parse(responseText);
      const validate = new Ajv().compile(expected.grammar.schema);
      if (!validate(raw)) structuralIssues.push(`actual records grammar rejected emitted JSON: ${JSON.stringify(validate.errors)}`);
      parserCalls++;
      const parsed = implementation.parse(raw, capture.brief);
      if (!parsed.ok || !parsed.projection) structuralIssues.push('actual parser/projector rejected emitted records');
      else {
        projectedGraph = parsed.projection.graph;
        consumerCalls++;
        implementation.consume(projectedGraph);
      }
      if (capture.consumedGraph !== undefined) {
        consumerCalls++;
        consumedGraph = implementation.consume(capture.consumedGraph);
      }
    } catch (error) { structuralIssues.push(error instanceof Error ? error.message : String(error)); }
  }
  const structuralStatus: ContractStatus = structuralIssues.length ? 'FAIL' : raw === undefined || consumedGraph === undefined ? 'UNVERIFIED' : 'PASS';
  const unavailable = !Object.keys(capture.request).length || expected.model.provider !== 'anthropic';
  const status: ContractStatus = unavailable ? 'UNVERIFIED' : issues.length ? 'FAIL' : !local || !userCompositionAvailable || !capture.response || capture.consumedGraph === undefined ? 'UNVERIFIED' : 'PASS';
  const report = Object.freeze({ status, structuralStatus, issues: Object.freeze(issues), structuralIssues: Object.freeze(structuralIssues),
    sourceHead: capture.sourceHead, task: expected.task, configurationSha256: digest(expected), composition,
    briefSha256: sha256(capture.brief), requestSha256: digest(capture.request),
    rawSha256: raw === undefined ? null : digest(raw), consumedSha256: capture.consumedGraph === undefined ? null : digest(capture.consumedGraph),
    projectedSha256: projectedGraph === undefined ? null : digest(projectedGraph),
    participation: { userComposition: userCompositionAvailable ? 'reconstructed' : 'UNVERIFIED', parser: { ...implementation.parserIdentity, calls: parserCalls }, projector: implementation.projectorIdentity, consumer: { ...implementation.consumerIdentity, calls: consumerCalls } },
    scope: capture.scope, transport: capture.transport,
    providerBound: status === 'PASS' && capture.transport === 'real-provider',
    deployedFidelity: 'UNVERIFIED' as const,
    limitation: 'Local adapter composition and initial parser/projector plus final graph-schema acceptance. Runtime flags/deadlines/upstream parse retries and deployed provider calls are not established. Admin text-only and replay captures never certify deployed behaviour.',
  });
  issued.add(report);
  return report;
}
export type DraftFidelityReport = ReturnType<typeof assessDraftFidelity>;
export function assertIssuedDraftFidelity(value: unknown): asserts value is DraftFidelityReport {
  assert(value !== null && typeof value === 'object' && issued.has(value), 'fidelity must be computed from the captured request and actual parser/consumer');
}

/** Same brief/model/settings/consumer are mandatory within an A/B pair.
 * Candidate prompt bytes are deliberately allowed to differ. */
export function compareDraftConfigurations(incumbent: DraftConfiguration, candidate: DraftConfiguration, a: DraftCapture, b: DraftCapture) {
  const issues: string[] = [];
  const normalized = (c: DraftConfiguration) => ({ ...c, prompt: null });
  if (digest(normalized(incumbent)) !== digest(normalized(candidate))) issues.push('A/B changed model, grammar, instruction or consumer as well as prompt');
  if (a.brief !== b.brief) issues.push('A/B briefs differ');
  const settings = (r: DraftCapture['request']) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'system' && k !== 'messages'));
  if (digest(settings(a.request)) !== digest(settings(b.request))) issues.push('A/B request settings differ');
  if (digest(a.request.messages) !== digest(b.request.messages)) issues.push('A/B assembled user messages differ');
  return { status: issues.length ? 'FAIL' as const : 'PASS' as const, issues };
}
