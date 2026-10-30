/**
 * ⭐ PRIVATE SOURCE EVIDENCE, SLICE F1 — authorised PDF/text/image → ONE native Responses read → a read-only evidence
 * candidate bound to the source version it read (Cloud-3 F1; design and reader from AI Experience's handoff,
 * programme-docs `openai/ai-experience/2026-09-26/native-evidence/evidence-adapter.mjs`, `read_sources` branch — the
 * public branch already lives in `public-research.ts`, whose bounded-request and fail-closed reading this follows).
 *
 * ⛔ THE HOST OWNS AUTHORISATION. A task names sources by Olumi source id only. Every provider file id comes from the
 * request-bound host's `resolveSources`, never from the client or the model, and a task carrying anything else is
 * refused whole. A resolver's record is PROJECTED, never copied: a signed URL, storage path or extracted text on it
 * goes nowhere.
 *
 * ⛔ A CITATION IDENTIFIES A SOURCE; IT DOES NOT PROVE THE SENTENCE. A native `file_citation` is kept only when it binds
 * to a file this read selected, and is shown under Olumi's authorised name, not the provider's filename. Its `index`
 * is NOT a page (openai 6.7 `FileCitation.index`: "The index of the file in the list of files"), so no page, line,
 * quote or region is ever derived from it. Without a native citation the candidate is `source_only`: a success.
 *
 * ⛔ CURRENTNESS BEFORE CONTENTS. Every read of a saved response, first display or reload, re-checks scope, scenario,
 * source access, source version and provider file BEFORE any content is read. A changed or revoked source suppresses
 * the old contents. A moved graph revision does not: the source still says what it said, so the finding stays
 * inspectable and only its linkage to the model is marked `needs_refresh`.
 *
 * ⛔ READ-ONLY. No callable tools, no web search, `store: false`, no retry, no fallback, no second call. The candidate
 * carries no truth, causal or strength status and `canonical_write: false`; changing the model stays with the existing
 * proposal/approval path.
 *
 * Pure: no network, no store and no prompt text of its own — the host supplies the governed prompt and config,
 * dispatches the one request and persists the result. These are INTERNAL shapes for the Runtime to bind later, not a
 * public Olumi schema.
 */
import { createHash } from 'node:crypto';

import type { ResponseInputFile, ResponseInputImage, ResponseInputText } from 'openai/resources/responses/responses.js';

import type { PromptSnapshot } from './request-assembly.js';

export const PRIVATE_EVIDENCE_MODULE_VERSION = 'f1.0';
export const PRIVATE_EVIDENCE_MAX_SOURCES = 4;
/** The handoff's conservative combined ceiling across all selected sources — a product bound, not the provider's. */
export const PRIVATE_EVIDENCE_MAX_COMBINED_BYTES = 50_000_000;
export const PRIVATE_EVIDENCE_QUESTION_MAX_CHARS = 12_000;

export type SupportedMimeType =
  | 'application/pdf'
  | 'text/plain'
  | 'text/markdown'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

/** How each supported type reaches the model: documents as `input_file`, images as `input_image`. */
const CARRIER: Readonly<Record<SupportedMimeType, 'input_file' | 'input_image'>> = {
  'application/pdf': 'input_file',
  'text/plain': 'input_file',
  'text/markdown': 'input_file',
  'image/png': 'input_image',
  'image/jpeg': 'input_image',
  'image/webp': 'input_image',
};
/** A PDF reaches the model as its text AND its page images, so it needs vision as much as an image does. */
const NEEDS_VISION: ReadonlySet<string> = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

/** What the model or client may ask for: a question about Olumi source ids. Nothing else is accepted. */
export interface ReadSourcesTask {
  readonly kind: 'read_sources';
  readonly question: string;
  readonly source_ids: readonly string[];
}

/** One source as the request-bound host resolved it. The host alone decides it is accessible and ready. */
export interface AuthorisedSource {
  readonly source_id: string;
  readonly source_version: string;
  readonly provider_file_id: string;
  readonly display_name: string;
  readonly mime_type: SupportedMimeType;
  readonly bytes: number;
  readonly status: 'ready';
}

/** The authenticated scope, scenario and graph revision of the current request. */
export interface EvidenceBinding {
  readonly scope_id: string;
  readonly scenario_id: string;
  readonly graph_revision: string;
}

/** Ports only. Their storage and authentication are the host's and are not implemented here. */
export interface PrivateEvidenceHost {
  currentBinding(): Promise<EvidenceBinding>;
  resolveSources(sourceIds: readonly string[]): Promise<readonly AuthorisedSource[]>;
  assertModelCapability(model: string, capabilities: readonly string[], reasoningEffort?: string): Promise<boolean>;
}

/** Server-owned: the exact model and budget, and the governed prompt (`promptSnapshotFrom`). No default is chosen here. */
export interface PrivateEvidenceConfig {
  readonly model: string;
  readonly max_output_tokens: number;
  readonly reasoning_effort?: string;
  readonly prompt: PromptSnapshot;
}

/** A selected source as the plan recorded it at read time. */
export interface BoundSource {
  readonly source_id: string;
  readonly source_version: string;
  readonly provider_file_id: string;
  readonly display_name: string;
  readonly mime_type: SupportedMimeType;
  readonly bytes: number;
}

type SourceInput = ResponseInputFile | ResponseInputImage;

/** The ONE Responses request. Its keys are the whole capability surface: there is no tool, include or store key. */
export interface PrivateEvidenceRequestBody {
  readonly model: string;
  readonly instructions: string;
  readonly input: readonly [{ readonly role: 'user'; readonly content: readonly [ResponseInputText, ...SourceInput[]] }];
  readonly max_output_tokens: number;
  readonly store: false;
  readonly reasoning?: { readonly effort: string };
}

export interface PromptIdentity {
  readonly id: string;
  readonly version: number;
  readonly sha256: string;
}

/** Server-internal and frozen; never accepted from client JSON. The host dispatches `body` and persists the rest. */
export interface PrivateEvidencePlan {
  readonly module_version: string;
  readonly kind: 'read_sources';
  readonly body: PrivateEvidenceRequestBody;
  readonly request_json: string;
  readonly request_sha256: string;
  readonly prompt_identity: PromptIdentity;
  readonly model: string;
  readonly binding: EvidenceBinding;
  readonly sources: readonly BoundSource[];
  readonly required_capabilities: readonly string[];
  readonly execution_policy: {
    readonly provider_requests: 1;
    readonly automatic_retries: 0;
    readonly fallback_providers: 0;
    readonly callable_tools: 0;
  };
}

export type PrivateEvidenceErrorCode =
  | 'invalid_task_shape'
  | 'question_invalid'
  | 'source_selection_invalid'
  | 'invalid_config'
  | 'prompt_identity_invalid'
  | 'host_authority_missing'
  | 'binding_unavailable'
  | 'source_access_unavailable'
  | 'source_substituted'
  | 'ambiguous_source'
  | 'source_not_ready'
  | 'source_type_unsupported'
  | 'source_size_invalid'
  | 'combined_source_size_exceeded'
  | 'model_capability_unverified';

export class PrivateEvidenceError extends Error {
  readonly code: PrivateEvidenceErrorCode;
  constructor(code: PrivateEvidenceErrorCode) {
    super(code);
    this.name = 'PrivateEvidenceError';
    this.code = code;
  }
}

/** The current source and version, and nothing more. The provider file id stays internal to the plan. */
export interface SourceIdentity {
  readonly source_id: string;
  readonly source_version: string;
  readonly display_name: string;
  readonly mime_type: SupportedMimeType;
}

/** One provider text part, verbatim. Parts are never concatenated, so native annotations still address their own part. */
export interface AnswerPart {
  readonly part_id: string;
  readonly text: string;
}

/** A native file citation bound back to an authorised selected source. It says where content came from, not that it is true. */
export interface SourceCitation extends SourceIdentity {
  readonly part_id: string;
  readonly type: 'file_citation';
  /** The provider's annotation, verbatim, for persistence. Its `index` and `filename` are not a page or Olumi's name. */
  readonly native_annotation: Readonly<Record<string, unknown>>;
}

/**
 * What the provider established about where an answer came from. NEITHER value is a location inside a source: no page,
 * line, quote or region is claimed, because no native field here establishes one.
 * - `source_only`: attributed to the selected source(s) as a whole — the honest default, and a success.
 * - `native_file_citation`: the provider's own citations tie answer parts to particular selected sources.
 */
export type LocatorQuality = 'source_only' | 'native_file_citation';

/** Whether the finding still speaks to the model as it is now. `needs_refresh` never means the source is wrong. */
export type ModelLinkage = 'current' | 'needs_refresh';

export interface EvidenceProvenance {
  readonly module_version: string;
  readonly request_sha256: string;
  readonly prompt_identity: PromptIdentity;
  readonly model: string;
  readonly provider_response_id: string | null;
  /** Token counts only; any non-numeric field is dropped. */
  readonly usage: Readonly<Record<string, number | Readonly<Record<string, number>>>> | null;
}

export interface EvidenceCandidate {
  readonly status: 'evidence_candidate';
  readonly canonical_write: false;
  readonly answer_parts: readonly AnswerPart[];
  readonly citations: readonly SourceCitation[];
  readonly sources: readonly SourceIdentity[];
  readonly locator_quality: LocatorQuality;
  readonly model_linkage: ModelLinkage;
  /** The binding the source was read against. */
  readonly read_against: EvidenceBinding;
  readonly current_graph_revision: string;
  readonly provenance: EvidenceProvenance;
}

/** Contents suppressed because the source, its access or the subject is no longer what was read. */
export type SuppressedStatus = 'access_changed' | 'access_unverified' | 'source_changed';

/** Nothing usable came back. `provider_refusal` is the provider declining; it is not "the source says nothing". */
export type ResponseFailureStatus =
  | 'response_not_complete'
  | 'response_unreadable'
  | 'provider_refusal'
  | 'unexpected_output_or_tool'
  | 'citation_outside_source_scope'
  | 'citation_type_not_supported'
  | 'citation_unreadable'
  | 'empty_answer';

export interface EvidenceWithheld {
  readonly status: SuppressedStatus | ResponseFailureStatus;
  readonly canonical_write: false;
  readonly answer_parts: readonly [];
  readonly citations: readonly [];
  readonly sources: readonly [];
  /** For `source_changed`: which selected sources moved, so the user can read the current version. Otherwise empty. */
  readonly changed_source_ids: readonly string[];
  readonly provenance: EvidenceProvenance;
}

export type PrivateEvidenceResult = EvidenceCandidate | EvidenceWithheld;

const record = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
const text = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function fail(code: PrivateEvidenceErrorCode): never {
  throw new PrivateEvidenceError(code);
}

/** Exactly these own keys, the required ones present: an extra key is refused, never ignored. */
function hasOnlyKeys(x: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  return Object.keys(x).every((k) => allowed.includes(k)) && required.every((k) => Object.hasOwn(x, k));
}

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

function readBinding(b: unknown): EvidenceBinding | null {
  const r = record(b);
  if (r === null || !text(r.scope_id) || !text(r.scenario_id) || !text(r.graph_revision)) return null;
  return { scope_id: r.scope_id, scenario_id: r.scenario_id, graph_revision: r.graph_revision };
}

type SourceCheck =
  | { readonly ok: true; readonly sources: readonly BoundSource[] }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'unreadable' | 'substituted' | 'ambiguous' | 'not_ready' | 'unsupported' | 'size_invalid' | 'too_large';
    };

/**
 * The resolver's answer for exactly the requested ids: each once, ready, supported, sized — or a reason it is not.
 * Returned in the user's selected order, never the resolver's.
 */
function checkResolved(requested: readonly string[], resolved: unknown): SourceCheck {
  if (!Array.isArray(resolved)) return { ok: false, reason: 'unreadable' };
  const byId = new Map<string, BoundSource>();
  const files = new Set<string>();
  for (const row of resolved) {
    const s = record(row);
    if (s === null || !text(s.source_id) || !text(s.source_version) || !text(s.provider_file_id) || !text(s.display_name)) {
      return { ok: false, reason: 'unreadable' };
    }
    if (!requested.includes(s.source_id)) return { ok: false, reason: 'substituted' };
    if (byId.has(s.source_id) || files.has(s.provider_file_id)) return { ok: false, reason: 'ambiguous' };
    if (s.status !== 'ready') return { ok: false, reason: 'not_ready' };
    if (typeof s.mime_type !== 'string' || !Object.hasOwn(CARRIER, s.mime_type)) return { ok: false, reason: 'unsupported' };
    if (!Number.isSafeInteger(s.bytes) || (s.bytes as number) < 1) return { ok: false, reason: 'size_invalid' };
    files.add(s.provider_file_id);
    byId.set(s.source_id, {
      source_id: s.source_id,
      source_version: s.source_version,
      provider_file_id: s.provider_file_id,
      display_name: s.display_name,
      mime_type: s.mime_type as SupportedMimeType,
      bytes: s.bytes as number,
    });
  }
  if (byId.size !== requested.length) return { ok: false, reason: 'missing' };
  const sources = requested.map((id) => byId.get(id)!);
  if (sources.reduce((n, s) => n + s.bytes, 0) > PRIVATE_EVIDENCE_MAX_COMBINED_BYTES) return { ok: false, reason: 'too_large' };
  return { ok: true, sources };
}

const PREPARE_CODE: Readonly<Record<Exclude<SourceCheck, { ok: true }>['reason'], PrivateEvidenceErrorCode>> = {
  missing: 'source_access_unavailable',
  unreadable: 'source_access_unavailable',
  substituted: 'source_substituted',
  ambiguous: 'ambiguous_source',
  not_ready: 'source_not_ready',
  unsupported: 'source_type_unsupported',
  size_invalid: 'source_size_invalid',
  too_large: 'combined_source_size_exceeded',
};

function sourceInput(s: BoundSource): SourceInput {
  return CARRIER[s.mime_type] === 'input_image'
    ? { type: 'input_image', file_id: s.provider_file_id, detail: 'high' }
    : { type: 'input_file', file_id: s.provider_file_id };
}

/**
 * Prepare ONE bounded native read (the handoff's `prepareEvidenceRequest`, `read_sources` branch). It executes nothing:
 * the host's existing dispatcher sends `body`, owns budget and cancellation, and never retries or falls back on its own.
 * Throws `PrivateEvidenceError` — no request exists — unless every selected source resolves, now, for this request.
 */
export async function preparePrivateEvidenceRequest(
  task: ReadSourcesTask,
  config: PrivateEvidenceConfig,
  host: PrivateEvidenceHost,
): Promise<PrivateEvidencePlan> {
  const t = record(task);
  if (t === null || t.kind !== 'read_sources' || !hasOnlyKeys(t, ['kind', 'question', 'source_ids'], ['kind', 'question', 'source_ids'])) {
    fail('invalid_task_shape');
  }
  if (!text(t.question) || t.question.length > PRIVATE_EVIDENCE_QUESTION_MAX_CHARS) fail('question_invalid');
  const ids = t.source_ids;
  if (
    !Array.isArray(ids) || ids.length < 1 || ids.length > PRIVATE_EVIDENCE_MAX_SOURCES
    || !ids.every(text) || new Set(ids).size !== ids.length
  ) {
    fail('source_selection_invalid');
  }
  const question = t.question;
  const sourceIds = [...(ids as string[])];

  const c = record(config);
  if (c === null || !hasOnlyKeys(c, ['model', 'max_output_tokens', 'reasoning_effort', 'prompt'], ['model', 'max_output_tokens', 'prompt'])) {
    fail('invalid_config');
  }
  if (!text(c.model) || !Number.isSafeInteger(c.max_output_tokens) || (c.max_output_tokens as number) < 1) fail('invalid_config');
  if (Object.hasOwn(c, 'reasoning_effort') && !text(c.reasoning_effort)) fail('invalid_config');
  const model = c.model;
  const maxOutputTokens = c.max_output_tokens as number;
  const effort = Object.hasOwn(c, 'reasoning_effort') ? (c.reasoning_effort as string) : undefined;
  // Only a governed, versioned snapshot: fallback text with no version cannot enable a new capability.
  const p = record(c.prompt);
  if (p === null || !text(p.id) || !text(p.text) || !Number.isSafeInteger(p.version) || (p.version as number) < 1 || p.governed !== true) {
    fail('prompt_identity_invalid');
  }
  const prompt = { id: p.id, version: p.version as number, text: p.text };

  const h = record(host);
  if (h === null || typeof h.currentBinding !== 'function' || typeof h.resolveSources !== 'function' || typeof h.assertModelCapability !== 'function') {
    fail('host_authority_missing');
  }

  let binding: EvidenceBinding | null;
  try {
    binding = readBinding(await host.currentBinding());
  } catch {
    binding = null;
  }
  if (binding === null) fail('binding_unavailable');

  let resolved: unknown;
  try {
    resolved = await host.resolveSources([...sourceIds]);
  } catch {
    fail('source_access_unavailable');
  }
  const check = checkResolved(sourceIds, resolved);
  if (!check.ok) fail(PREPARE_CODE[check.reason]);
  const sources = check.sources;

  const required = ['file_inputs', ...(sources.some((s) => NEEDS_VISION.has(s.mime_type)) ? ['vision'] : [])];
  let capable: unknown;
  try {
    capable = await host.assertModelCapability(model, [...required], effort);
  } catch {
    capable = false;
  }
  if (capable !== true) fail('model_capability_unverified');

  // ⛔ THE WHOLE CAPABILITY SURFACE: the question and the authorised files. No `tools`, `tool_choice` or `include`, so
  // nothing a document says ("call a write tool", "search the web") has anything to call.
  const body: PrivateEvidenceRequestBody = {
    model,
    instructions: prompt.text,
    input: [{ role: 'user', content: [{ type: 'input_text', text: question }, ...sources.map(sourceInput)] }],
    max_output_tokens: maxOutputTokens,
    store: false,
    ...(effort === undefined ? {} : { reasoning: { effort } }),
  };
  const request_json = JSON.stringify(body);
  return deepFreeze({
    module_version: PRIVATE_EVIDENCE_MODULE_VERSION,
    kind: 'read_sources',
    body,
    request_json,
    request_sha256: sha256(request_json),
    prompt_identity: { id: prompt.id, version: prompt.version, sha256: sha256(prompt.text) },
    model,
    binding,
    sources,
    required_capabilities: required,
    execution_policy: { provider_requests: 1, automatic_retries: 0, fallback_providers: 0, callable_tools: 0 },
  });
}

/** The provider file ids a serialised request actually sent, in order; `null` when it is not one of these requests. */
function sentFileIds(requestJson: string): string[] | null {
  try {
    const input = record(JSON.parse(requestJson))?.input;
    const parts = Array.isArray(input) && input.length === 1 ? record(input[0])?.content : undefined;
    if (!Array.isArray(parts) || record(parts[0])?.type !== 'input_text') return null;
    const ids = parts.slice(1).map((x) => record(x)?.file_id);
    return ids.every(text) ? (ids as string[]) : null;
  } catch {
    return null;
  }
}

/** A plan still describes one read: it hashes to its own request, and the files it records are the files that request sent. */
function planIsCoherent(plan: unknown): plan is PrivateEvidencePlan {
  const p = record(plan);
  if (p === null || p.kind !== 'read_sources' || readBinding(p.binding) === null || typeof p.request_json !== 'string') return false;
  if (p.request_sha256 !== sha256(p.request_json) || !Array.isArray(p.sources)) return false;
  const sent = sentFileIds(p.request_json);
  return (
    sent !== null && sent.length >= 1 && sent.length === p.sources.length
    && p.sources.every((s, i) => text(record(s)?.source_id) && text(record(s)?.source_version) && record(s)?.provider_file_id === sent[i])
  );
}

function usageOf(u: unknown): EvidenceProvenance['usage'] {
  const r = record(u);
  if (r === null) return null;
  const out: Record<string, number | Record<string, number>> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    const inner = record(v);
    if (inner !== null) {
      const nums = Object.entries(inner).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]));
      if (nums.length > 0) out[k] = Object.fromEntries(nums);
    }
  }
  return out;
}

const identity = (s: BoundSource): SourceIdentity => ({
  source_id: s.source_id,
  source_version: s.source_version,
  display_name: s.display_name,
  mime_type: s.mime_type,
});

type OutputRead =
  | { readonly status: ResponseFailureStatus }
  | { readonly parts: readonly AnswerPart[]; readonly citations: readonly SourceCitation[] };

/** The text parts and native citations of a completed response's output, or why it is not a readable private read. */
function readOutput(output: readonly unknown[], bound: ReadonlyMap<string, BoundSource>): OutputRead {
  const parts: AnswerPart[] = [];
  const citations: SourceCitation[] = [];
  for (const [outputIndex, item] of output.entries()) {
    const it = record(item);
    if (it === null) return { status: 'response_unreadable' };
    // A reasoning summary is the model's, not the source's: never shown as evidence.
    if (it.type === 'reasoning') continue;
    // ⛔ The request offered no tool, so any call or tool output — a write, a search, an MCP call — is not the read asked for.
    if (it.type !== 'message') return { status: 'unexpected_output_or_tool' };
    if (it.role !== 'assistant' || !Array.isArray(it.content)) return { status: 'response_unreadable' };
    if (it.status !== 'completed') return { status: 'response_not_complete' };
    for (const [contentIndex, c] of it.content.entries()) {
      const part = record(c);
      if (part?.type === 'refusal') return { status: 'provider_refusal' };
      if (part?.type !== 'output_text' || typeof part.text !== 'string') return { status: 'response_unreadable' };
      if (part.annotations !== undefined && !Array.isArray(part.annotations)) return { status: 'citation_unreadable' };
      const part_id = `${outputIndex}:${contentIndex}`;
      for (const a of (part.annotations as unknown[] | undefined) ?? []) {
        const ann = record(a);
        if (ann === null) return { status: 'citation_unreadable' };
        // No search ran, so a URL can never be one of the selected private sources.
        if (ann.type === 'url_citation') return { status: 'citation_outside_source_scope' };
        if (ann.type !== 'file_citation') return { status: 'citation_type_not_supported' };
        if (typeof ann.file_id !== 'string') return { status: 'citation_unreadable' };
        if (ann.index !== undefined && !(Number.isSafeInteger(ann.index) && (ann.index as number) >= 0)) return { status: 'citation_unreadable' };
        const source = bound.get(ann.file_id);
        if (source === undefined) return { status: 'citation_outside_source_scope' };
        citations.push({ part_id, type: 'file_citation', ...identity(source), native_annotation: structuredClone(ann) });
      }
      parts.push({ part_id, text: part.text });
    }
  }
  if (!parts.some((x) => x.text.trim() !== '')) return { status: 'empty_answer' };
  return { parts, citations };
}

/**
 * Read a provider response into a read-only evidence candidate (the handoff's `completeEvidenceRequest`, `read_sources`
 * branch). Run it on first display AND on every reload of a saved response: it re-checks the subject and every source
 * first, and exposes nothing from the response unless they still match what was read. It never dispatches anything —
 * a tool call in the response is a failure, not an instruction.
 */
export async function completePrivateEvidenceRequest(
  plan: PrivateEvidencePlan,
  response: unknown,
  host: Pick<PrivateEvidenceHost, 'currentBinding' | 'resolveSources'>,
): Promise<PrivateEvidenceResult> {
  const r = record(response);
  const provenance: EvidenceProvenance = {
    module_version: PRIVATE_EVIDENCE_MODULE_VERSION,
    request_sha256: String(record(plan)?.request_sha256 ?? ''),
    prompt_identity: plan?.prompt_identity,
    model: plan?.model,
    provider_response_id: typeof r?.id === 'string' ? r.id : null,
    usage: usageOf(r?.usage),
  };
  const withheld = (status: EvidenceWithheld['status'], changed: readonly string[] = []): EvidenceWithheld =>
    deepFreeze({ status, canonical_write: false, answer_parts: [], citations: [], sources: [], changed_source_ids: [...changed], provenance: structuredClone(provenance) });

  if (!planIsCoherent(plan)) return withheld('access_unverified');

  // 1. The subject, from the authenticated request NOW. Another scope or scenario is a different subject.
  let current: EvidenceBinding | null;
  try {
    current = readBinding(await host.currentBinding());
  } catch {
    current = null;
  }
  if (current === null) return withheld('access_unverified');
  if (current.scope_id !== plan.binding.scope_id || current.scenario_id !== plan.binding.scenario_id) return withheld('access_changed');

  // 2. Every selected source, NOW: still accessible, same version, same provider file.
  const ids = plan.sources.map((s) => s.source_id);
  let resolved: unknown;
  try {
    resolved = await host.resolveSources([...ids]);
  } catch {
    return withheld('access_unverified');
  }
  const check = checkResolved(ids, resolved);
  if (!check.ok) return withheld(check.reason === 'missing' ? 'access_changed' : 'access_unverified');
  const changed = check.sources
    .filter((s, i) => {
      const read = plan.sources[i]!;
      if (s.source_version !== read.source_version) return true;
      return s.provider_file_id !== read.provider_file_id || s.mime_type !== read.mime_type || s.bytes !== read.bytes;
    })
    .map((s) => s.source_id);
  if (changed.length > 0) return withheld('source_changed', changed);

  // 3. Only now is the response read. File ids here equal the plan's; names are the host's current authorised ones.
  if (r === null || r.status !== 'completed' || r.error != null || r.incomplete_details != null) return withheld('response_not_complete');
  if (!Array.isArray(r.output)) return withheld('response_unreadable');
  let read: OutputRead;
  try {
    read = readOutput(r.output, new Map(check.sources.map((s) => [s.provider_file_id, s])));
  } catch {
    return withheld('response_unreadable');
  }
  if ('status' in read) return withheld(read.status);

  return deepFreeze({
    status: 'evidence_candidate',
    canonical_write: false,
    answer_parts: read.parts,
    citations: read.citations,
    sources: check.sources.map(identity),
    locator_quality: read.citations.length > 0 ? 'native_file_citation' : 'source_only',
    model_linkage: current.graph_revision === plan.binding.graph_revision ? 'current' : 'needs_refresh',
    read_against: { ...plan.binding },
    current_graph_revision: current.graph_revision,
    provenance,
  });
}

/**
 * The only view of a result meant for normal telemetry: statuses, counts and request identity. Never answer text, a
 * source's name or a native annotation — a filename can be as private as the document.
 */
export function privateEvidenceTelemetry(result: PrivateEvidenceResult): {
  readonly status: PrivateEvidenceResult['status'];
  readonly source_count: number;
  readonly answer_part_count: number;
  readonly citation_count: number;
  readonly locator_quality: LocatorQuality | null;
  readonly model_linkage: ModelLinkage | null;
  readonly request_sha256: string;
  readonly provider_response_id: string | null;
} {
  const ok = result.status === 'evidence_candidate';
  return {
    status: result.status,
    source_count: result.sources.length,
    answer_part_count: result.answer_parts.length,
    citation_count: result.citations.length,
    locator_quality: ok ? result.locator_quality : null,
    model_linkage: ok ? result.model_linkage : null,
    request_sha256: result.provenance.request_sha256,
    provider_response_id: result.provenance.provider_response_id,
  };
}
