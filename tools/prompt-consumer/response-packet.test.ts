import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
import { buildDraftRecordsSchema } from '../../src/cee/draft/records/grammar.js';
import { assertExactCaseIds, sha256 } from './contract.js';
import { buildResponseIdentityPacket, type ResponseIdentityPacketInput } from './quality-report.js';

const root = resolve(import.meta.dirname, '../..');
const names = ['empty-is-unknown', 'serialized-pass-ignored', 'corrupt-body-refused', 'wrong-format-refused', 'operator-offline-refusal'] as const;
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds(names, collected));
const test = (name: typeof names[number], run: () => void, timeout?: number) => it(name, () => { collected.push(name); run(); }, timeout);
const source = (path: string, exportName: string) => ({ path, exportName, fileSha256: sha256(readFileSync(resolve(root, path), 'utf8')) });
const reference: ResponseIdentityPacketInput = {
  format: 'olumi.prompt-response-observations.v1', mode: 'simulation', captures: [], settling: null,
  configuration: {
    task: 'draft_graph', sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    prompt: { id: 'draft_graph_default', version: 195, sha256: sha256(readFileSync(resolve(root, 'src/cee/draft/records/__tests__/fixtures/served-draft-graph-v195.txt'), 'utf8')) },
    instructionSha256: sha256(DRAFT_RECORDS_INSTRUCTION), model: { provider: 'anthropic', id: 'claude-sonnet-4-6' },
    schema: { ...source('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'), artifactSha256: sha256(JSON.stringify(buildDraftRecordsSchema())) },
    parser: source('src/cee/draft/records/seam.ts', 'projectDraftRecords'),
    projector: source('src/cee/draft/records/projector.ts', 'projectRecordsToGraph'),
    consumer: source('src/adapters/llm/shared-schemas.ts', 'LLMDraftResponse.parse'),
  },
};

describe('existing quality operator re-derives response evidence', () => {
  test('empty-is-unknown', () => {
    const packet = buildResponseIdentityPacket(reference);
    expect(packet.status).toBe('UNVERIFIED');
    expect(packet.fleet.universalStatus).toBe('UNVERIFIED');
    expect(packet.fleet.deployedProviderStatus).toBe('UNVERIFIED');
    expect(packet.semanticStatus).toBe('UNVERIFIED');
    expect(packet.deploymentPermission).toBe('NOT_GRANTED');
    expect(packet.operations).toEqual({ networkRequests: 0, providerCalls: 0, promotionPerformed: false, rollbackPerformed: false });
    expect(packet.decoderSources.map(entry => entry.path)).toContain('src/utils/response-hash.ts');
  });
  test('serialized-pass-ignored', () => {
    const raw = { ...reference, status: 'PASS', fleet: { status: 'PASS', universalStatus: 'PASS' }, object: 'a teapot' };
    expect(buildResponseIdentityPacket(raw)).toEqual(buildResponseIdentityPacket(reference));
    expect(buildResponseIdentityPacket({ ...raw, object: 'a bicycle' })).toEqual(buildResponseIdentityPacket(reference));
  });
  test('corrupt-body-refused', () => {
    const capture = { observedAt: '2026-08-31T13:00:00Z', url: 'https://offline.invalid/assist/v1/draft-graph',
      httpStatus: 200, requestId: 'one-response', body: '{"trace":{}}', bodySha256: sha256('different body') };
    const bad = buildResponseIdentityPacket({ ...reference, captures: [capture] });
    expect(bad.status).toBe('FAIL');
    const unverified = buildResponseIdentityPacket({ ...reference, captures: [{ ...capture, bodySha256: sha256(capture.body) }] });
    expect(unverified.status).toBe('UNVERIFIED');
    expect(unverified.responses[0]!.levels.providerBound.status).toBe('UNVERIFIED');
  });
  test('wrong-format-refused', () => {
    expect(() => buildResponseIdentityPacket({ ...reference, format: 'serialized-pass-report' as never })).toThrow('unsupported response-evidence format');
    expect(() => buildResponseIdentityPacket({ ...reference, mode: 'deployed' as never })).toThrow('mode is required');
    expect(() => buildResponseIdentityPacket({ ...reference, captures: undefined as never })).toThrow('original response captures required');
  });
  test('operator-offline-refusal', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'response-operator-'));
    const input = resolve(directory, 'input.json'), output = resolve(directory, 'output.json');
    writeFileSync(input, JSON.stringify(reference), { flag: 'wx' });
    const require = createRequire(import.meta.url);
    const script = `
      import net from 'node:net';
      net.Socket.prototype.connect = function () { throw new Error('OPERATOR_NETWORK_FORBIDDEN'); };
      globalThis.fetch = async () => { throw new Error('OPERATOR_NETWORK_FORBIDDEN'); };
      await import(process.argv[1]);
    `;
    const run = () => spawnSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href,
      '--input-type=module', '-e', script, pathToFileURL(resolve(root, 'scripts/prompt-model-quality.ts')).href,
      '--responses', '--input', input, '--out', output], {
      cwd: root, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, LOG_LEVEL: 'fatal', ADMIN_API_KEY: '', ANTHROPIC_API_KEY: '' },
    });
    try {
      const first = run();
      expect(first.error).toBeUndefined();
      expect(first.status).toBe(2);
      expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({ status: 'UNVERIFIED', deploymentPermission: 'NOT_GRANTED' });
      const retry = run();
      expect(retry.status).not.toBe(0);
      expect(retry.stderr).toContain('refusing to overwrite evidence');
      expect(retry.stderr).not.toContain('OPERATOR_NETWORK_FORBIDDEN');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 40_000);
});
