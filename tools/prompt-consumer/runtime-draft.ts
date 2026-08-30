/** Reuses #1228's non-serving adapter/SDK seam against an explicit immutable checkout. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './contract.js';
import { assessDraftFidelity, digest, type DraftConfiguration, type DraftCapture, type DraftImplementations } from './fidelity.js';
import type { DraftSemanticImplementations } from './semantic.js';

export async function loadDraftRuntime(runtimeRoot: string, expectedHead: string) {
  const root = resolve(runtimeRoot);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  assert(/^[a-f0-9]{40}$/.test(expectedHead), 'full target source head required');
  assert.equal(git('rev-parse', 'HEAD'), expectedHead, 'target checkout is not the requested source');
  assert.equal(git('status', '--porcelain'), '', 'target runtime must be pristine, not a dirty assurance checkout');
  const imported = (p: string) => import(pathToFileURL(resolve(root, p)).href);
  const source = (path: string, exportName: string) => ({ path, exportName, sha256: sha256(readFileSync(resolve(root, path), 'utf8')) });
  const [adapter, instruction, grammar, seam, graphSchema, router] = await Promise.all([
    imported('src/adapters/llm/anthropic.ts'), imported('src/cee/draft/records/instruction.ts'),
    imported('src/cee/draft/records/grammar.ts'), imported('src/cee/draft/records/seam.ts'),
    imported('src/adapters/llm/shared-schemas.ts'), imported('src/adapters/llm/router.ts'),
  ]);
  const runtimeRequire = createRequire(resolve(root, 'package.json'));
  // The serving package is ESM. createRequire(...).resolve(subpath) chooses
  // the SDK's REQUIRE condition and yields a distinct CJS Messages class that
  // never intercepts the adapter's ESM instance. Explicit exported .mjs paths
  // retain target-root resolution without silently changing module conditions.
  assert.equal(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).type, 'module', 'only an ESM serving package is verified by this capture');
  const sdkPath = runtimeRequire.resolve('@anthropic-ai/sdk/resources/messages.mjs');
  const sdkEntryPath = runtimeRequire.resolve('@anthropic-ai/sdk/index.mjs');
  const [{ Messages }, { default: Anthropic }] = await Promise.all([
    import(pathToFileURL(sdkPath).href), import(pathToFileURL(sdkEntryPath).href),
  ]);
  const assertSdkBinding = (interceptor: typeof Messages) => {
    assert.equal(interceptor, Anthropic.Messages, 'SDK interceptor does not match the target ESM client');
    const probeClient = new Anthropic({ apiKey: 'binding-preflight-no-provider-call' });
    assert(probeClient.messages instanceof interceptor, 'target SDK messages instance is not intercepted');
  };
  assertSdkBinding(Messages);
  const implementations: DraftImplementations = {
    parserIdentity: source('src/cee/draft/records/seam.ts', 'projectDraftRecords'),
    projectorIdentity: source('src/cee/draft/records/projector.ts', 'projectRecordsToGraph'),
    consumerIdentity: source('src/adapters/llm/shared-schemas.ts', 'LLMDraftResponse.parse'),
    parse: seam.projectDraftRecords,
    consume: (graph: unknown) => graphSchema.LLMDraftResponse.parse(graph),
  };
  const schema = grammar.buildDraftRecordsSchema();
  const semanticImplementations: DraftSemanticImplementations = {
    buildGrammar: grammar.buildDraftRecordsSchema, parseRecords: seam.DraftRecordSetWire.parse.bind(seam.DraftRecordSetWire),
    projectRecords: seam.projectDraftRecords, parseGraph: graphSchema.LLMDraftResponse.parse.bind(graphSchema.LLMDraftResponse),
    sourceHashes: { schema: source('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema').sha256,
      parser: implementations.parserIdentity.sha256, projector: implementations.projectorIdentity.sha256, consumer: implementations.consumerIdentity.sha256 },
  };
  return { root, head: expectedHead, adapter, router, Messages, sdkPath, sdkEntryPath, assertSdkBinding, implementations,
    semanticImplementations,
    expectedMessages: async (configuration: DraftConfiguration, brief: string) => {
      const prompt = await adapter.__test_only.buildDraftPrompt({ brief, docs: [], seed: 1, model: configuration.model.id }, {
        preloadedSystemPrompt: configuration.prompt.content,
      });
      return [{ role: 'user', content: prompt.userContent }];
    },
    instruction: { content: instruction.DRAFT_RECORDS_INSTRUCTION as string, sha256: sha256(instruction.DRAFT_RECORDS_INSTRUCTION) },
    grammar: { schema: schema as object, sha256: digest(schema) },
    components: [source('src/adapters/llm/anthropic.ts', 'draftGraphWithAnthropic'), source('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'),
      implementations.parserIdentity, source('src/cee/draft/records/projector.ts', 'projectRecordsToGraph'), implementations.consumerIdentity],
    assertUnchanged: () => {
      assert.equal(git('rev-parse', 'HEAD'), expectedHead);
      assert.equal(git('status', '--porcelain'), '', 'runtime changed during evaluation');
    },
  };
}
export type DraftRuntime = Awaited<ReturnType<typeof loadDraftRuntime>>;
export function draftConfiguration(runtime: DraftRuntime, prompt: DraftConfiguration['prompt'], model: string): DraftConfiguration {
  const resolution = runtime.router.getAdapterWithResolution('draft_graph', model, 'store_model_config').resolution;
  assert.equal(resolution.resolved_model, model, 'runtime model resolver did not select the requested PMS model');
  assert.equal(resolution.provider, 'anthropic', 'this non-serving capture supports Anthropic draft only; other provider is UNVERIFIED');
  return { task: 'draft_graph', sourceHead: runtime.head, sourceDirty: false, prompt,
    model: { id: resolution.resolved_model, provider: resolution.provider, resolutionSource: resolution.resolution_source },
    instruction: runtime.instruction, grammar: runtime.grammar, parser: runtime.implementations.parserIdentity,
    projector: runtime.implementations.projectorIdentity, consumer: runtime.implementations.consumerIdentity };
}

/** Process-global SDK interception: call serially, never alongside another capture. */
let captureActive = false;
export async function captureDraft(runtime: DraftRuntime, configuration: DraftConfiguration, brief: string, options: { timeoutMs?: number; replayResponses?: unknown[] } = {}) {
  assert(!captureActive, 'serial capture required');
  runtime.assertUnchanged();
  runtime.assertSdkBinding(runtime.Messages);
  const expectedMessages = await runtime.expectedMessages(configuration, brief);
  // Another caller may have crossed the async composition boundary above.
  assert(!captureActive, 'serial capture required');
  captureActive = true;
  const transport = options.replayResponses ? 'replay' : 'real-provider';
  const captures: Array<{ kind: 'draft' | 'completion'; request: DraftCapture['request']; response?: DraftCapture['response'] }> = [];
  const prototype = runtime.Messages.prototype;
  const originalStream = prototype.stream, originalCreate = prototype.create;
  const replay = options.replayResponses?.slice();
  const nextReplay = () => { assert(replay?.length, 'replay response collection exhausted'); return replay.shift() as NonNullable<DraftCapture['response']>; };
  prototype.stream = function (body: DraftCapture['request'], ...rest: unknown[]) {
    const entry = { kind: 'draft' as const, request: structuredClone(body), response: undefined as DraftCapture['response'] };
    captures.push(entry);
    if (replay) {
      const response = nextReplay(); entry.response = response;
      return { async *[Symbol.asyncIterator]() { for (const c of response.content ?? []) if (c.type === 'text') yield { type: 'content_block_delta', delta: { type: 'text_delta', text: c.text } }; },
        finalMessage: async () => response, abort() {} };
    }
    const stream = originalStream.call(this, body, ...rest);
    const finalMessage = stream.finalMessage.bind(stream);
    stream.finalMessage = async () => { const response = await finalMessage(); entry.response = structuredClone(response); return response; };
    return stream;
  };
  prototype.create = function (body: DraftCapture['request'], ...rest: unknown[]) {
    if (body.stream) return originalCreate.call(this, body, ...rest);
    const entry = { kind: 'completion' as const, request: structuredClone(body), response: undefined as DraftCapture['response'] };
    captures.push(entry);
    if (replay) { entry.response = nextReplay(); return Promise.resolve(entry.response); }
    const result = originalCreate.call(this, body, ...rest);
    void result.then((response: DraftCapture['response']) => { entry.response = structuredClone(response); }, () => {});
    return result;
  };
  let consumed: { graph: unknown } | undefined, error: string | undefined;
  try {
    consumed = await runtime.adapter.draftGraphWithAnthropic({ brief, docs: [], model: configuration.model.id, seed: 1 }, {
      timeoutMs: options.timeoutMs ?? 120_000,
      preloadedSystemPrompt: { operation: 'draft_graph', content: configuration.prompt.content, meta: {
        taskId: 'draft_graph', source: 'store', promptId: configuration.prompt.id,
        version: typeof configuration.prompt.version === 'number' ? configuration.prompt.version : undefined,
        prompt_version: String(configuration.prompt.version), prompt_hash: configuration.prompt.sha256.slice(0, 16),
        modelConfig: { staging: configuration.model.id },
      } },
    });
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  finally { prototype.stream = originalStream; prototype.create = originalCreate; captureActive = false; }
  runtime.assertUnchanged();
  const primary = captures.filter(c => c.kind === 'draft').at(-1);
  const capture: DraftCapture = { sourceHead: runtime.head, brief, scope: 'local-production-adapter', transport,
    request: primary?.request ?? {}, response: primary?.response, consumedGraph: consumed?.graph };
  const fidelity = assessDraftFidelity(configuration, capture, { ...runtime.implementations, expectedMessages, expectedBriefSha256: sha256(brief) });
  return { capture, captures, consumed, error, fidelity,
    runnerScope: 'Local production adapter with preloaded explicit prompt, empty docs and declared timeout. Not upstream parse-stage/deployed/native fidelity.',
    declaredSettings: { timeoutMs: options.timeoutMs ?? 120_000, seed: 1, docs: [],
      environment: Object.fromEntries(['CEE_ANTHROPIC_STRUCTURED_OUTPUTS', 'CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED', 'CEE_DRAFT_TEMPERATURE'].map(k => [k, process.env[k] ?? null])) },
  };
}
