import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildContractManifest, draftObligations, read } from './manifest.js';
import { sha256, assertExactCaseIds } from './contract.js';
import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds(['registry', 'mutations', 'obligations', 'identity'], collected));
describe('bounded route manifest is not a release certificate', () => {
  it('uses executable runtime authority and exposes real unresolved consumer losses', () => {
    collected.push('registry');
    const m = buildContractManifest();
    expect(m.routes.map(r => r.task)).toEqual(['draft_graph', 'orchestrator', 'validate_graph']);
    expect(m.status).toBe('FAIL');
    expect(m.routes[0]!.status).toBe('FAIL');
    expect(m.routes[1]!.deterministicStatus).toBe('PASS');
    expect(m.routes[2]!.deterministicStatus).toBe('PASS');
    expect(m.routes[1]!.status).toBe('UNVERIFIED');
    expect(m.routes[2]!.status).toBe('UNVERIFIED');
    expect(m.factorQuantification.registered).toBe(false);
    expect(m.promotionEvidence.integrated).toBe(false);
  });
  it('collects every semantic-breaking and unrelated family; expected red is not gate green', () => {
    collected.push('mutations');
    const m = buildContractManifest();
    expect(m.mutations.map(f => f.id)).toEqual(['draft.stated-percent', 'draft.inferred-scalar', 'draft.option-effect', 'draft.cited-option-effect', 'draft.absent-scalar', 'ask-to-binder', 'edge-uncertainty']);
    for (const f of m.mutations) expect(f.status, JSON.stringify(f)).toBe('PASS');
    expect(m.status).toBe('FAIL');
  });
  it('binds reviewed obligations to exact assembled inputs, never incidental vocabulary', () => {
    collected.push('obligations');
    const old = sha256(read('src/cee/draft/records/__tests__/fixtures/records-instruction-v10.txt').trimEnd());
    const served = sha256(read('Prompts/canonical/draft_graph.txt'));
    const candidate = sha256(read('Prompts/candidates/draft_graph_records.txt'));
    expect(draftObligations(served, old).requests).toContain('prior-confidence');
    expect(draftObligations(candidate, sha256(DRAFT_RECORDS_INSTRUCTION)).requests).not.toContain('prior-confidence');
    expect(draftObligations(sha256('Teapot uncertainty scalar options'), old).status).toBe('UNVERIFIED');
    expect(draftObligations(served, sha256('Some other instruction')).status).toBe('UNVERIFIED');
  });
  it('never turns configured source or a handwritten fixture into live/provider proof', () => {
    collected.push('identity');
    const m = buildContractManifest();
    expect(m.sourceHead).toMatch(/^[a-f0-9]{40}$/);
    expect(m.runtime).toBeNull();
    expect(m.liveClosure).toMatch(/^UNVERIFIED/);
    expect(m.routes[0]!.prompt).toMatchObject({ status: 'UNVERIFIED' });
  });
});
