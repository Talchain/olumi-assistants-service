import { afterAll, describe, expect, it } from 'vitest';
import { ACTIVATION_HASHES, buildActivationCoverageReport, loadActivationEvidence } from './activation.js';

const collected: string[] = [];
afterAll(() => expect(collected.sort()).toEqual(['bound-combinations', 'metadata-control', 'missing-hybrid', 'model-break', 'prompt-break', 'schema-break', 'silent-consumer-loss']));

describe('banked reachable activation combinations', () => {
  it('binds all four combinations without certifying their semantic quality or activation', () => {
    collected.push('bound-combinations');
    const report = buildActivationCoverageReport();
    expect(report.issues).toEqual([]);
    expect(report.coverageStatus).toBe('PASS');
    expect(report.combinations.map(c => [c.combination, c.cases])).toEqual([
      ['old-pms-old-instruction', 18], ['old-pms-new-instruction', 2], ['candidate-new-instruction', 18],
    ]);
    expect(report.combinations[0]!.diagnostic.nonCollapse).toBe('FAIL');
    const hybrid = report.combinations[1]!;
    expect(hybrid.diagnostic).toMatchObject({ cases: 1, emittedOptions: [2], consumedOptions: [2], nonCollapse: 'FAIL' });
    expect(hybrid.decision).toMatchObject({ cases: 1, emittedOptions: [3], consumedOptions: [3] });
    expect(hybrid.checkedPrimaryRequests).toBe(2);
    expect(hybrid.primaryBindings).toMatchObject({ promptSha256: ACTIVATION_HASHES.oldPrompt, instructionSha256: ACTIVATION_HASHES.newInstruction });
    const candidate = report.combinations[2]!;
    expect(candidate.diagnostic.consumedOptions).toEqual(Array(9).fill(0));
    expect(candidate.diagnostic.nonCollapse).toMatch(/^UNVERIFIED/);
    expect(candidate.semanticVerdict).toBe('UNVERIFIED');
    expect(candidate.hypothesisPreservation).toMatch(/^UNVERIFIED/);
    expect(report.destroyedControl.cases).toBe(18);
    expect(report.destroyedControl.checkedPrimaryRequests).toBe(18);
    expect(report.destroyedControl.primaryBindings).toMatchObject({ promptSha256: ACTIVATION_HASHES.destroyed, instructionSha256: null });
    expect(report.destroyedControl.semanticVerdict).toBe('UNVERIFIED');
    expect(report.activationPermission).toBe('NOT_GRANTED');
  });

  it('RED: a missing code-only supplement cannot be hidden by the complete 54-case corpus', () => {
    collected.push('missing-hybrid');
    const evidence = loadActivationEvidence();
    evidence.codeOnly = null;
    const report = buildActivationCoverageReport(evidence);
    expect(report.coverageStatus).toBe('FAIL');
    expect(report.issues).toContain('missing code-only activation coverage');
  });

  it.each(['prompt', 'model', 'schema'] as const)('RED: changing the actual primary request %s breaks participation', (kind) => {
    collected.push(`${kind}-break`);
    const evidence = loadActivationEvidence();
    const request = evidence.codeOnly!.cases[0]!.captures.find(c => c.kind === 'draft')!.request;
    if (kind === 'prompt') (request.system as Array<{ text: string }>)[0]!.text = 'A ceramic teapot with the incidental word uncertainty.';
    if (kind === 'model') request.model = 'claude-sonnet-5';
    if (kind === 'schema') request.output_config = { format: { type: 'json_schema', schema: { type: 'object' } } };
    const report = buildActivationCoverageReport(evidence);
    expect(report.coverageStatus).toBe('FAIL');
    expect(report.issues.join('\n')).toContain(kind === 'prompt' ? 'prompt/instruction combination' : `primary ${kind === 'schema' ? 'grammar identity' : 'request model'}`);
  });

  it('RED: consumed options silently removed cannot retain the captured count claim', () => {
    collected.push('silent-consumer-loss');
    const evidence = loadActivationEvidence();
    const graph = evidence.codeOnly!.cases[1]!.consumed.graph as { nodes: Array<{ kind: string }> };
    graph.nodes = graph.nodes.filter(n => n.kind !== 'option');
    const report = buildActivationCoverageReport(evidence);
    expect(report.coverageStatus).toBe('FAIL');
    expect(report.issues.join('\n')).toContain('emitted/projected/consumed counts disagree');
  });

  it('GREEN: unrelated annotation changes do not alter participation or erase diagnostic failures', () => {
    collected.push('metadata-control');
    const evidence = loadActivationEvidence();
    evidence.annotations = { notebookObject: 'a porcelain teapot', prose: 'incidental uncertainty vocabulary' };
    expect(buildActivationCoverageReport(evidence)).toEqual(buildActivationCoverageReport());
  });
});
