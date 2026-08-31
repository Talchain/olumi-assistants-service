import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertExactCaseIds } from './contract.js';
import { LOCAL_RESPONSE_ARCHIVE, loadFrozenLocalResponseCase, type evaluateLocalResponseIdentity } from './local-response-identity.js';
import { loadQualityPair } from './quality-report.js';
import { withReplayWorktree } from './replay-worktree.js';

type Report = Awaited<ReturnType<typeof evaluateLocalResponseIdentity>>;
const names = ['original response and actual consumer', 'same-brief semantic degradation', 'diagnostic and action counterparts', 'wrong prompt model and provider',
  'cross-response consumer substitution', 'missing origin and telemetry', 'incomplete contribution trace', 'unrelated annotation'] as const;
const collected: string[] = [];
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
let setupComplete = false;
let reports: Record<string, Report>, networkAttempts: number, networkGuardExercised: boolean;
beforeEach(() => expect.hasAssertions());

beforeAll(() => {
  // Exact archived runtime, not a hand-written parser or an assurance-head
  // replacement. Derive recorder authority from the immutable capture itself.
  const recorderHead = loadFrozenLocalResponseCase('logistics-disagreement-decision-1-incumbent').identity.assuranceHead;
  const script = `
    import net from 'node:net';
    let networkAttempts = 0;
    const connect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function () { networkAttempts++; throw new Error('NETWORK_FORBIDDEN'); };
    let networkGuardExercised = false;
    const probe = new net.Socket();
    try { probe.connect({ host: '127.0.0.1', port: 1 }); }
    catch (error) { networkGuardExercised = error.message === 'NETWORK_FORBIDDEN'; }
    finally { probe.destroy(); networkAttempts = 0; }
    delete process.env.CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED;
    delete process.env.CEE_DRAFT_TEMPERATURE;
    try {
      const [runtimeRoot, verifierUrl, runtimeUrl] = process.argv.slice(1);
      const { loadFrozenLocalResponseCase, evaluateLocalResponseIdentity, LOCAL_RESPONSE_ARCHIVE } = await import(verifierUrl);
      const { loadDraftRuntime } = await import(runtimeUrl);
      const runtime = await loadDraftRuntime(runtimeRoot, LOCAL_RESPONSE_ARCHIVE.sourceHead);
      const make = id => {
        const item = loadFrozenLocalResponseCase(id);
        const raw = JSON.parse(item.capture.response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
        const projection = runtime.implementations.parse(raw, item.capture.brief);
        if (!projection.ok) throw new Error('Actual archived records did not project');
        // Explicitly reconstruct the INITIAL consumer. The immutable final
        // adapter graph remains available in the bank, not re-labelled as this.
        item.capture.consumedGraph = runtime.implementations.consume(projection.projection.graph);
        return { runtimeRoot, configuration: item.configuration, capture: item.capture, calls: item.captures, archivedCaseId: id };
      };
      const original = make('logistics-disagreement-decision-1-incumbent');
      const run = input => evaluateLocalResponseIdentity(input);
      const reports = { original: await run(original) };
      reports.wordingIncumbent = await run(make('logistics-disagreement-reworded-v1-decision-1-incumbent'));
      reports.wordingCandidate = await run(make('logistics-disagreement-reworded-v1-decision-1-candidate'));
      reports.diagnostic = await run(make('logistics-disagreement-reworded-v1-diagnostic-1-incumbent'));
      const wrongPrompt = structuredClone(original);
      wrongPrompt.capture.request.system[0].text = 'Unrelated telescope prose';
      wrongPrompt.calls[0].request = structuredClone(wrongPrompt.capture.request);
      reports.wrongPrompt = await run(wrongPrompt);
      const wrongModel = structuredClone(original);
      wrongModel.capture.request.model = 'claude-sonnet-5';
      wrongModel.calls[0].request = structuredClone(wrongModel.capture.request);
      reports.wrongModel = await run(wrongModel);
      const wrongProvider = structuredClone(original); wrongProvider.configuration.model.provider = 'openai';
      reports.wrongProvider = await run(wrongProvider);
      const wrongGraph = structuredClone(original);
      wrongGraph.capture.consumedGraph = make('logistics-disagreement-reworded-v1-diagnostic-1-incumbent').capture.consumedGraph;
      reports.wrongGraph = await run(wrongGraph);
      const noOrigin = structuredClone(original); delete noOrigin.archivedCaseId;
      reports.noOrigin = await run(noOrigin);
      const noGraph = structuredClone(original); delete noGraph.capture.consumedGraph;
      reports.noGraph = await run(noGraph);
      const noModel = structuredClone(original); delete noModel.capture.response.model; delete noModel.calls[0].response.model;
      reports.noModel = await run(noModel);
      const noResponse = structuredClone(original); delete noResponse.capture.response;
      reports.noResponse = await run(noResponse);
      reports.noCalls = await run({ ...original, calls: [] });
      const multi = make('logistics-disagreement-diagnostic-1-incumbent');
      reports.multi = await run(multi);
      const secondaryWrong = structuredClone(multi); secondaryWrong.calls[1].response.model = 'claude-sonnet-5';
      reports.secondaryWrong = await run(secondaryWrong);
      const truncated = structuredClone(multi); truncated.calls = truncated.calls.slice(0, 1);
      reports.truncated = await run(truncated);
      reports.annotation = await run({ ...original, annotations: { unrelated: 'The porcelain teapot is now a brass telescope' } });
      console.log('LOCAL_RESPONSE_REPORT=' + JSON.stringify({ reports, networkAttempts, networkGuardExercised }));
    } finally { net.Socket.prototype.connect = connect; }
  `;
  const output = withReplayWorktree(root, LOCAL_RESPONSE_ARCHIVE.sourceHead, [recorderHead], runtimeRoot => execFileSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, '--input-type=module', '-e', script,
    runtimeRoot, pathToFileURL(resolve(root, 'tools/prompt-consumer/local-response-identity.ts')).href,
    pathToFileURL(resolve(root, 'tools/prompt-consumer/runtime-draft.ts')).href], {
    cwd: root, encoding: 'utf8', timeout: 50_000, maxBuffer: 8_000_000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', LOG_LEVEL: 'fatal', ANTHROPIC_API_KEY: 'no-provider-call', CEE_ANTHROPIC_STRUCTURED_OUTPUTS: 'true' },
  }));
  const line = output.split('\n').find(value => value.startsWith('LOCAL_RESPONSE_REPORT='));
  if (!line) throw new Error('Native ESM replay did not issue its report');
  ({ reports, networkAttempts, networkGuardExercised } = JSON.parse(line.slice('LOCAL_RESPONSE_REPORT='.length)));
  setupComplete = true;
}, 60_000);

afterAll(() => {
  // A failed beforeAll already fails the suite: do not replace its first error
  // with uncollected-case/absent-worktree noise. Successful replay stays strict.
  if (setupComplete) assertExactCaseIds(names, collected);
});
const test = (name: typeof names[number], run: () => void) => it(name, () => { collected.push(name); run(); });
describe('fixed historical response identity and actual consumer replay', () => {
  test(names[0], () => {
    expect(reports.original).toMatchObject({ status: 'PASS', identityStatus: 'PASS', structuralStatus: 'PASS', lineageStatus: 'PASS',
      rung: 'historical-local-provider', scope: 'initial-records-projection-replay', requestCorrelation: 'UNVERIFIED', deployedIdentity: 'UNVERIFIED', finalAdapterLineage: 'UNVERIFIED' });
    expect(reports.original!.origin.recorder?.status).toBe('PASS');
    expect(reports.original!.hashes.immediateConsumer).toBe(reports.original!.hashes.suppliedConsumer);
    expect(reports.original!.participation?.parser.calls).toBe(1);
    expect(reports.original!.participation?.consumer.calls).toBe(2);
    expect(networkGuardExercised).toBe(true);
    expect(networkAttempts).toBe(0);
  });
  test(names[1], () => {
    expect(reports.wordingIncumbent!.structuralStatus).toBe('PASS');
    expect(reports.wordingCandidate!.structuralStatus).toBe('PASS');
    expect(reports.wordingIncumbent!.hashes.brief).toBe(reports.wordingCandidate!.hashes.brief);
    for (const key of ['sourceHead', 'model', 'grammarSha256', 'parser', 'projector', 'consumer'] as const) {
      expect(reports.wordingIncumbent!.expectedIdentity[key]).toEqual(reports.wordingCandidate!.expectedIdentity[key]);
    }
    expect(reports.wordingIncumbent!.semanticStatus).toBe('PASS');
    expect(reports.wordingCandidate!.semanticStatus).toBe('FAIL');
    expect(reports.wordingCandidate!.semantic?.assertionResults.some(result => result.id === 'measurement.no-invented-baseline' && result.status === 'FAIL')).toBe(true);
    const expectedActions = loadQualityPair('logistics-disagreement-reworded-v1').pair.decisionOracle!.actions!.map(action => `action.${action.id}`);
    expect(expectedActions).toHaveLength(2);
    const actionResults = reports.wordingCandidate!.semantic!.assertionResults.filter(result => result.id.startsWith('action.'));
    expect(actionResults.map(result => result.id)).toEqual(expectedActions);
    expect(actionResults.every(result => result.status === 'PASS')).toBe(true);
  });
  test(names[2], () => {
    expect(reports.diagnostic!.identityStatus).toBe('PASS');
    expect(reports.diagnostic!.structuralStatus).toBe('PASS');
    expect(reports.diagnostic!.semanticStatus).toBe('FAIL');
    expect(reports.diagnostic!.semantic?.assertionResults.find(result => result.id === 'diagnostic.non-collapse')?.status).toBe('FAIL');
    expect(reports.original!.semanticStatus).toBe('PASS');
  });
  test(names[3], () => {
    for (const id of ['wrongPrompt', 'wrongModel', 'wrongProvider']) expect(reports[id]!.status).toBe('FAIL');
    expect(reports.wrongPrompt!.issues.join(' ')).toContain('did not reach provider');
    expect(reports.wrongProvider!.issues.join(' ')).toContain('Wrong provider');
  });
  test(names[4], () => {
    expect(reports.wrongGraph!.structuralStatus).toBe('PASS');
    expect(reports.wrongGraph!.lineageStatus).toBe('FAIL');
    expect(reports.wrongGraph!.status).toBe('FAIL');
    expect(reports.wrongGraph!.hashes.immediateConsumer).not.toBe(reports.wrongGraph!.hashes.suppliedConsumer);
  });
  test(names[5], () => {
    expect(reports.noOrigin).toMatchObject({ status: 'UNVERIFIED', rung: 'offline-replay', identityStatus: 'UNVERIFIED', lineageStatus: 'PASS' });
    expect(reports.noGraph).toMatchObject({ status: 'UNVERIFIED', lineageStatus: 'UNVERIFIED' });
    expect(reports.noModel).toMatchObject({ status: 'UNVERIFIED', identityStatus: 'UNVERIFIED' });
    expect(reports.noResponse).toMatchObject({ status: 'UNVERIFIED', identityStatus: 'UNVERIFIED' });
    expect(reports.noCalls).toMatchObject({ status: 'UNVERIFIED', identityStatus: 'UNVERIFIED' });
  });
  test(names[6], () => {
    expect(reports.multi).toMatchObject({ status: 'UNVERIFIED', contributionStatus: 'UNVERIFIED', lineageStatus: 'PASS' });
    expect(reports.secondaryWrong!.status).toBe('FAIL');
    expect(reports.truncated!.origin.status).toBe('FAIL');
    expect(reports.truncated!.status).toBe('FAIL');
  });
  test(names[7], () => {
    expect(reports.annotation!.status).toBe('PASS');
    expect(reports.annotation!.semanticStatus).toBe('PASS');
    expect(reports.annotation!.hashes).toEqual(reports.original!.hashes);
  });
});
