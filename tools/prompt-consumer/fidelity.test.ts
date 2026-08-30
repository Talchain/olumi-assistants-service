import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadActivationEvidence } from './activation.js';
import { sha256, assertExactCaseIds } from './contract.js';
import { assessDraftFidelity, assertIssuedDraftFidelity, compareDraftConfigurations, digest, type DraftCapture, type DraftConfiguration } from './fidelity.js';
import { buildDraftRecordsSchema } from '../../src/cee/draft/records/grammar.js';
import { projectDraftRecords } from '../../src/cee/draft/records/seam.js';
import { LLMDraftResponse } from '../../src/adapters/llm/shared-schemas.js';
import { __test_only } from '../../src/adapters/llm/anthropic.js';
import type { DraftImplementations } from './fidelity.js';

const names = ['banked counterpart', 'wrong prompt bound not incidental', 'wrong model in both directions', 'illegal enum versus unrelated object', 'wrong parser or consumer', 'admin and missing captures', 'unrelated prompt wording', 'A/B settings isolation', 'required label loss', 'unissued receipt', 'brief and user composition binding'] as const;
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds(names, collected));
const test = (name: typeof names[number], run: () => void) => it(name, () => { collected.push(name); run(); });
const root = resolve(import.meta.dirname, '../..');
const source = (path: string, exportName: string) => ({ path, exportName, sha256: sha256(readFileSync(resolve(root, path), 'utf8')) });
const implementation: DraftImplementations = {
  parserIdentity: source('src/cee/draft/records/seam.ts', 'projectDraftRecords'),
  projectorIdentity: source('src/cee/draft/records/projector.ts', 'projectRecordsToGraph'),
  consumerIdentity: source('src/adapters/llm/shared-schemas.ts', 'LLMDraftResponse.parse'),
  parse: projectDraftRecords, consume: (graph: unknown) => LLMDraftResponse.parse(graph),
};
beforeAll(async () => {
  const bank = setup();
  const prompt = await __test_only.buildDraftPrompt({ brief: bank.capture.brief, docs: [], model: bank.configuration.model.id, seed: 1 }, { preloadedSystemPrompt: bank.configuration.prompt.content });
  implementation.expectedMessages = [{ role: 'user', content: prompt.userContent }];
  implementation.expectedBriefSha256 = sha256(bank.capture.brief);
});
function setup() {
  const bank = loadActivationEvidence().codeOnly!;
  const item = bank.cases.find(c => c.summary?.direction === 'decision')!;
  const primary = item.captures.find(c => c.kind === 'draft')!;
  const request = structuredClone(primary.request) as DraftCapture['request'];
  const blocks = request.system as Array<{ text: string }>;
  const schema = buildDraftRecordsSchema();
  const configuration: DraftConfiguration = { task: 'draft_graph', sourceHead: bank.identity.sourceHead, sourceDirty: false,
    prompt: { id: 'draft_graph_default', version: 195, content: blocks[0]!.text, sha256: sha256(blocks[0]!.text) },
    model: { id: primary.response.model, provider: 'anthropic', resolutionSource: 'store_model_config' },
    instruction: { content: blocks[1]!.text, sha256: sha256(blocks[1]!.text) },
    grammar: { schema, sha256: digest(schema) }, parser: implementation.parserIdentity, projector: implementation.projectorIdentity, consumer: implementation.consumerIdentity };
  const capture: DraftCapture = { sourceHead: configuration.sourceHead, brief: item.brief, scope: 'synthetic-control', transport: 'replay',
    request, response: structuredClone(primary.response), consumedGraph: structuredClone(item.consumed.graph) };
  return { configuration, capture, run: () => assessDraftFidelity(configuration, capture, implementation) };
}
describe('actual draft fidelity, not a live certification', () => {
  test('banked counterpart', () => {
    const r = setup().run();
    expect(r.status).toBe('PASS'); expect(r.structuralStatus).toBe('PASS');
    expect(r.providerBound).toBe(false); expect(r.deployedFidelity).toBe('UNVERIFIED');
    expect(r.participation.parser.calls).toBe(1); expect(r.participation.consumer.calls).toBe(2);
  });
  test('wrong prompt bound not incidental', () => {
    const c = setup(); (c.capture.request.system as Array<{ text: string }>)[0]!.text = 'Teapot label uncertainty option';
    expect(c.run().status).toBe('FAIL');
    const unrelated = setup(); unrelated.capture.request.metadata = { unrelated: 'teapot label uncertainty option' };
    expect(unrelated.run().status).toBe('PASS');
  });
  test('wrong model in both directions', () => {
    const a = setup(); a.capture.request.model = 'claude-sonnet-5'; expect(a.run().status).toBe('FAIL');
    const b = setup(); b.capture.response!.model = 'claude-sonnet-5'; expect(b.run().status).toBe('FAIL');
    expect(setup().run().status).toBe('PASS');
  });
  test('illegal enum versus unrelated object', () => {
    const c = setup(); const raw = JSON.parse(c.capture.response!.content![0]!.text!);
    raw.stated_items[0].kind = 'claim'; c.capture.response!.content![0]!.text = JSON.stringify(raw);
    expect(c.run().structuralStatus).toBe('FAIL');
    const unrelated = setup(); (unrelated.capture as DraftCapture & { unrelated?: string }).unrelated = 'claim';
    expect(unrelated.run().structuralStatus).toBe('PASS');
  });
  test('wrong parser or consumer', () => {
    const c = setup();
    expect(assessDraftFidelity(c.configuration, c.capture, { ...implementation, parserIdentity: { ...implementation.parserIdentity, sha256: '0'.repeat(64) } }).status).toBe('FAIL');
    expect(assessDraftFidelity(c.configuration, c.capture, { ...implementation, consumerIdentity: { ...implementation.consumerIdentity, exportName: 'graph_nodes_edges' } }).status).toBe('FAIL');
  });
  test('admin and missing captures', () => {
    const c = setup(); c.capture.scope = 'admin-text-only'; c.capture.request.system = [{ text: c.configuration.prompt.content }]; delete c.capture.request.output_config;
    expect(c.run().status).toBe('UNVERIFIED'); expect(c.run().composition.grammarSha256).toBeNull();
    const absent = setup(); absent.capture.request = {}; delete absent.capture.response; delete absent.capture.consumedGraph;
    expect(absent.run().status).toBe('UNVERIFIED');
  });
  test('unrelated prompt wording', () => {
    const c = setup(); c.configuration.prompt.content += '\nThe examples concern a different stationery brand.';
    c.configuration.prompt.sha256 = sha256(c.configuration.prompt.content);
    (c.capture.request.system as Array<{ text: string }>)[0]!.text = c.configuration.prompt.content;
    const r = c.run(); expect(r.structuralStatus).toBe('PASS'); expect(r.status).toBe('PASS');
    // This is carriage under controlled bytes, not proof this prose induces good model output.
    expect(r.providerBound).toBe(false);
  });
  test('A/B settings isolation', () => {
    const a = setup(), b = setup(); b.configuration.prompt.content += '\nUnrelated wording.'; b.configuration.prompt.sha256 = sha256(b.configuration.prompt.content);
    expect(compareDraftConfigurations(a.configuration, b.configuration, a.capture, b.capture).status).toBe('PASS');
    b.capture.request.max_tokens = 1;
    expect(compareDraftConfigurations(a.configuration, b.configuration, a.capture, b.capture).status).toBe('FAIL');
  });
  test('required label loss', () => {
    const c = setup(); const raw = JSON.parse(c.capture.response!.content![0]!.text!); delete raw.claims[0].label;
    c.capture.response!.content![0]!.text = JSON.stringify(raw);
    expect(c.run().structuralStatus).toBe('FAIL'); expect(setup().run().structuralStatus).toBe('PASS');
  });
  test('unissued receipt', () => {
    expect(() => assertIssuedDraftFidelity({ status: 'PASS' })).toThrow();
    expect(() => assertIssuedDraftFidelity(setup().run())).not.toThrow();
  });
  test('brief and user composition binding', () => {
    const c = setup(); c.capture.request.messages = [{ role: 'user', content: 'Unrelated teapot question.' }];
    expect(c.run().status).toBe('FAIL');
    const brief = setup(); brief.capture.brief = 'A different strategic situation.';
    expect(brief.run().status).toBe('FAIL');
    const incidental = setup(); incidental.capture.request.metadata = { teapot: 'unrelated' };
    expect(incidental.run().status).toBe('PASS');
    expect(assessDraftFidelity(incidental.configuration, incidental.capture, { ...implementation, expectedMessages: undefined }).status).toBe('UNVERIFIED');
  });
});
