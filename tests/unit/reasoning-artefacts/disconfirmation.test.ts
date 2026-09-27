import { describe, expect, it } from 'vitest';

import { canonicalJson, contentHash } from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/common.js';
import { assessReasoningArtefactCurrentness, createReasoningArtefact, serializeReasoningArtefact,
  validateReasoningArtefact } from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/index.js';
import {
  assessDisconfirmationCurrentness, createDisconfirmation, presentDisconfirmation, validateDisconfirmation,
} from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/disconfirmation.js';

const targetHash = 'a'.repeat(64);
const recordHash = 'b'.repeat(64);

function fixture() {
  const input = {
    target_id: 'assumption-1',
    counter_hypotheses: ['The runner-up could perform better under lower adoption.'],
    questions: ['What observation would change our view?'],
    investigations: ['Check recent adoption data.'],
    unknowns: ['The adoption response is not measured.'],
  };
  const host = {
    scenario_id: 'scenario-1', graph_revision: 'graph-1',
    target: { id: 'assumption-1', kind: 'assumption', text: 'Adoption remains high', fingerprint: targetHash,
      state: 'current', material: true },
    protocol: { protocol_id: 'DSK-P-003', protocol_version: '1.0.0' as string | null,
      record_hash: recordHash as string | null, authority_status: 'unverified',
      science_ratification_ref: null as string | null,
      completion_rules: [] as { id: string; version: string; authority_ref: string }[] },
    invocation: { state: 'requested', request_ref: 'explicit-request-1' as string | null },
    applicability: { verdict: 'applicable', reasons: ['Synthetic host verdict for contract test'],
      prerequisites: ['Host says prerequisites met'], contraindications: [] as string[] },
    existing_evidence: [] as { evidence_id: string; source_id: string; source_version: string }[],
    challenging_evidence: [] as { evidence_id: string; source_id: string; source_version: string }[],
    generated_content_binding: null as null | { content_hash: string;
      source_refs: { source_id: string; source_version: string }[];
      source_independent: boolean; authority_ref: string },
    source_statuses: [] as { source_id: string; source_version: string | null; state: string }[],
    completion_evidence_bindings: [] as { evidence_id: string; attestation_ref: string }[],
    completion: null as null | {
      verdict: string; protocol_id: string; protocol_version: string | null;
      protocol_record_hash: string | null;
      target_fingerprint: string | null; rule_id: string | null; rule_version: string | null;
      rule_authority_ref: string | null; evidence_refs: string[];
    },
  };
  return { input, host };
}

function syntheticVerifiedFixture() {
  const { input, host } = fixture();
  // A synthetic host fixture exercises the contract, not current science-owner ratification.
  host.protocol.authority_status = 'verified_current';
  host.protocol.science_ratification_ref = 'synthetic-science-review-1';
  host.generated_content_binding = {
    content_hash: contentHash({ counter_hypotheses: input.counter_hypotheses, questions: input.questions,
      investigations: input.investigations, unknowns: input.unknowns }),
    source_refs: [], source_independent: true, authority_ref: 'synthetic-source-independent-attestation',
  };
  return { input, host };
}

describe('F2c disconfirmation boundary', () => {
  it('does not start from the currently unratified DSK record or expose generated exercise content', () => {
    const { input, host } = fixture();
    const artefact = createDisconfirmation(input, host);
    expect(artefact.lifecycle).toBe('not_started');
    expect(artefact.blockers).toEqual(expect.arrayContaining([
      'protocol_unverified', 'protocol_ratification_missing',
    ]));
    expect(artefact.protocol_version).toBeNull();
    expect(artefact.canonical_inputs.host.protocol.protocol_version).toBe('1.0.0');
    expect(artefact.generated).toEqual({ counter_hypotheses: [], questions: [], investigations: [], unknowns: [] });
    expect(artefact.canonical_inputs.input.counter_hypotheses).toEqual([]);
  });

  it('blocks a missing protocol version, record hash, ratification, retirement or supersession', () => {
    for (const authority_status of ['unverified', 'retired', 'superseded']) {
      const { input, host } = fixture();
      host.protocol.authority_status = authority_status;
      const result = createDisconfirmation(input, host);
      expect(result.lifecycle).toBe('not_started');
      expect(result.blockers).toContain(`protocol_${authority_status}`);
    }
    const { input, host } = syntheticVerifiedFixture();
    host.protocol.protocol_version = null;
    host.protocol.record_hash = null;
    host.protocol.science_ratification_ref = null;
    const result = createDisconfirmation(input, host);
    expect(result.lifecycle).toBe('not_started');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'protocol_version_missing', 'protocol_record_hash_missing', 'protocol_ratification_missing',
    ]));
  });

  it('never derives applicability from high-looking numbers in the target prose', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.target.text = 'Winning option appears to have 99% win probability';
    host.applicability.verdict = 'unknown';
    host.applicability.reasons = ['The science owner withheld an applicability verdict'];
    const result = createDisconfirmation(input, host);
    expect(result.lifecycle).toBe('not_started');
    expect(result.blockers).toContain('applicability_unknown');
    expect(result.generated.questions).toEqual([]);
  });

  it('blocks non-applicability and a missing explicit invocation', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.applicability.verdict = 'not_applicable';
    host.invocation.state = 'absent';
    host.invocation.request_ref = null;
    const result = createDisconfirmation(input, host);
    expect(result.lifecycle).toBe('not_started');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'applicability_not_applicable', 'explicit_invocation_missing',
    ]));
  });

  it('honours a host-recorded decline without presenting generated material or completion', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.invocation.state = 'declined';
    const result = createDisconfirmation(input, host);
    expect(result.lifecycle).toBe('declined');
    expect(result.generated.counter_hypotheses).toEqual([]);
    expect(result.existing_evidence).toEqual([]);
  });

  it('keeps observed and challenging host evidence separate from generated hypotheses', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.existing_evidence.push({ evidence_id: 'evidence-support', source_id: 'source-1', source_version: 'v1' });
    host.challenging_evidence.push({ evidence_id: 'evidence-challenge', source_id: 'source-2', source_version: 'v3' });
    host.source_statuses.push(
      { source_id: 'source-1', source_version: 'v1', state: 'current' },
      { source_id: 'source-2', source_version: 'v3', state: 'current' },
    );
    const result = createDisconfirmation(input, host);
    expect(result.lifecycle).toBe('in_progress');
    expect(result.existing_evidence.map((ref) => ref.evidence_id)).toEqual(['evidence-support']);
    expect(result.challenging_evidence.map((ref) => ref.evidence_id)).toEqual(['evidence-challenge']);
    expect(result.generated.counter_hypotheses).toEqual(input.counter_hypotheses);
    expect(result.existing_evidence.some((ref) => ref.evidence_id === input.counter_hypotheses[0])).toBe(false);
  });

  it('does not treat expected outputs or an unsupported completion claim as a completion rule', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.completion = { verdict: 'complete', protocol_id: 'DSK-P-003', protocol_version: '1.0.0',
      protocol_record_hash: recordHash,
      target_fingerprint: targetHash, rule_id: null, rule_version: null,
      rule_authority_ref: null, evidence_refs: ['generated-answer'] };
    const result = createDisconfirmation(input, host);
    expect(result.lifecycle).toBe('completion_unverified');
    expect(result.blockers).toContain('completion_rule_unverified');
    expect(() => createDisconfirmation(input, {
      ...host, completion: { ...host.completion, expected_outputs: ['answered questions'] },
    })).toThrow('unexpected_field');
  });

  it('accepts completion only with a synthetic host rule and bound evidence', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.protocol.completion_rules.push({ id: 'synthetic-rule', version: 'v1',
      authority_ref: 'synthetic-science-rule-review' });
    host.completion = { verdict: 'complete', protocol_id: 'DSK-P-003', protocol_version: '1.0.0',
      protocol_record_hash: recordHash,
      target_fingerprint: targetHash, rule_id: 'synthetic-rule', rule_version: 'v1',
      rule_authority_ref: 'synthetic-science-rule-review', evidence_refs: ['user-answer-1'] };
    expect(createDisconfirmation(input, host).lifecycle).toBe('completion_unverified');
    host.completion_evidence_bindings.push({ evidence_id: 'user-answer-1',
      attestation_ref: 'synthetic-host-evidence-attestation' });
    const completed = createDisconfirmation(input, host);
    expect(completed.lifecycle).toBe('completed');
    host.completion_evidence_bindings = [];
    expect(createDisconfirmation(input, host).lifecycle).toBe('completion_unverified');
    expect(assessDisconfirmationCurrentness(completed, input, host).state).toBe('stale');
    host.completion_evidence_bindings.push({ evidence_id: 'user-answer-1',
      attestation_ref: 'synthetic-host-evidence-attestation' });
    host.completion.rule_version = 'ungoverned-v2';
    expect(createDisconfirmation(input, host).lifecycle).toBe('completion_unverified');
    host.completion.rule_version = 'v1';
    host.completion.rule_authority_ref = 'ungoverned-review';
    expect(createDisconfirmation(input, host).lifecycle).toBe('completion_unverified');
    host.completion.rule_authority_ref = 'synthetic-science-rule-review';
    host.completion.evidence_refs = ['generated-answer'];
    expect(createDisconfirmation(input, host).lifecycle).toBe('completion_unverified');
    host.completion.evidence_refs = ['user-answer-1'];
    host.completion.protocol_version = 'different';
    expect(createDisconfirmation(input, host).lifecycle).toBe('completion_unverified');
    host.completion.protocol_version = '1.0.0';
    host.completion.protocol_record_hash = 'c'.repeat(64);
    expect(createDisconfirmation(input, host).lifecycle).toBe('completion_unverified');
    host.completion.protocol_record_hash = recordHash;
    host.protocol.completion_rules = [];
    expect(createDisconfirmation(input, host).lifecycle).toBe('completion_unverified');
  });

  it('blocks a stale or substituted target and a changed evidence source', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.target.state = 'stale';
    host.target.id = 'different-assumption';
    host.existing_evidence.push({ evidence_id: 'evidence-1', source_id: 'source-1', source_version: 'v1' });
    host.source_statuses.push({ source_id: 'source-1', source_version: 'v2', state: 'changed' });
    const result = createDisconfirmation(input, host);
    expect(result.lifecycle).toBe('not_started');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'target_identity_mismatch', 'target_not_current', 'source_not_current:source-1',
    ]));
    expect(result.existing_evidence).toEqual([]);
  });

  it('rejects attempted authority, evidence or write payloads in caller input', () => {
    const { input, host } = syntheticVerifiedFixture();
    for (const extra of [
      { applicability: 'applicable' }, { completion: 'complete' }, { protocol_version: '1.0.0' },
      { evidence: ['I observed this'] }, { operations: [{ type: 'patch' }] }, { canonical_patch: {} },
    ]) {
      expect(() => createDisconfirmation({ ...input, ...extra }, host)).toThrow('unexpected_field');
    }
    expect(() => createDisconfirmation(input, { ...host, write_model: () => undefined })).toThrow('unexpected_field');
  });

  it('hashes consumed identities but treats an unrelated graph revision as historical provenance', () => {
    const { input, host } = syntheticVerifiedFixture();
    const originalInput = structuredClone(input);
    const originalHost = structuredClone(host);
    const saved = createDisconfirmation(input, host);
    const repeated = createDisconfirmation(structuredClone(input), structuredClone(host));
    expect(repeated.canonical_input_hash).toBe(saved.canonical_input_hash);
    host.graph_revision = 'unrelated-graph-2';
    const unrelated = createDisconfirmation(input, host);
    expect(unrelated.canonical_input_hash).toBe(saved.canonical_input_hash);
    expect(assessDisconfirmationCurrentness(saved, input, host).state).toBe('current');
    host.target.fingerprint = 'c'.repeat(64);
    expect(assessDisconfirmationCurrentness(saved, input, host).changed_dependencies).toContain('claim:assumption-1');
    expect(input).toEqual(originalInput);
    expect({ ...host, graph_revision: originalHost.graph_revision, target: originalHost.target }).toEqual(originalHost);
  });

  it('ignores unreferenced source statuses in content identity and rejects conflicting source versions', () => {
    const { input, host } = syntheticVerifiedFixture();
    const first = createDisconfirmation(input, host);
    host.source_statuses.push({ source_id: 'unrelated-source', source_version: 'v1', state: 'current' });
    const second = createDisconfirmation(input, host);
    expect(second.canonical_input_hash).toBe(first.canonical_input_hash);
    expect(second.canonical_inputs.host.source_statuses).toEqual([]);
    host.existing_evidence.push({ evidence_id: 'evidence:1', source_id: 'source:1', source_version: 'v1' });
    host.challenging_evidence.push({ evidence_id: '1:evidence:1', source_id: 'source', source_version: 'v1' });
    host.source_statuses.push(
      { source_id: 'source:1', source_version: 'v1', state: 'current' },
      { source_id: 'source', source_version: 'v1', state: 'current' },
    );
    const withDistinctTupleDependencies = createDisconfirmation(input, host);
    expect(new Set(withDistinctTupleDependencies.binding.dependencies.filter((d) => d.kind === 'source')
      .map((d) => d.id)).size).toBe(2);
    host.source_statuses.reverse();
    expect(createDisconfirmation(input, host).canonical_input_hash).toBe(withDistinctTupleDependencies.canonical_input_hash);
    host.protocol.completion_rules.push(
      { id: 'rule-b', version: 'v1', authority_ref: 'host-rule-b' },
      { id: 'rule-a', version: 'v1', authority_ref: 'host-rule-a' },
    );
    const withRules = createDisconfirmation(input, host);
    host.protocol.completion_rules.reverse();
    expect(createDisconfirmation(input, host).canonical_input_hash).toBe(withRules.canonical_input_hash);
    host.completion_evidence_bindings.push({ evidence_id: 'unrelated-answer', attestation_ref: 'host-attestation' });
    expect(createDisconfirmation(input, host).canonical_input_hash).toBe(withRules.canonical_input_hash);
    host.challenging_evidence.push({ evidence_id: 'evidence-3', source_id: 'source:1', source_version: 'v2' });
    expect(() => createDisconfirmation(input, host)).toThrow('conflicting_source_versions');
  });

  it('revalidates a serialised artefact and rejects a forged lifecycle or write field', () => {
    const { input, host } = fixture();
    const created = createDisconfirmation(input, host);
    const reloaded = validateDisconfirmation(JSON.parse(canonicalJson(created)) as unknown);
    expect(reloaded).toEqual(created);
    const forged = JSON.parse(canonicalJson(created)) as Record<string, unknown>;
    forged.lifecycle = 'completed';
    expect(() => validateDisconfirmation(forged)).toThrow('artefact_revalidation_failed');
    const patched = { ...created, operations: [{ type: 'set_field' }] };
    expect(() => validateDisconfirmation(patched)).toThrow('unexpected_field');
  });

  it('round-trips through the shared explicit invocation and persistence boundary', () => {
    const { input, host } = fixture();
    const created = createReasoningArtefact('disconfirmation', input, host);
    const saved = serializeReasoningArtefact(created);
    expect(validateReasoningArtefact(JSON.parse(saved) as unknown)).toEqual(created);
    host.graph_revision = 'unrelated-edit';
    expect(assessReasoningArtefactCurrentness(created, input, host).state).toBe('current');
    host.target.text = 'Revised assumption';
    expect(assessReasoningArtefactCurrentness(created, input, host).state).toBe('stale');
    expect(assessDisconfirmationCurrentness(created, input, { ...host, protocol: {
      ...host.protocol, protocol_version: undefined,
    } }).state).toBe('invalid');
  });

  it('presents a reloaded artefact only while its source is current, then withholds all display content', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.existing_evidence.push({ evidence_id: 'private-evidence-1', source_id: 'private-source', source_version: 'v1' });
    host.source_statuses.push({ source_id: 'private-source', source_version: 'v1', state: 'current' });
    const saved = JSON.parse(canonicalJson(createDisconfirmation(input, host))) as unknown;
    const current = presentDisconfirmation(saved, host);
    expect(current.state).toBe('current');
    if (current.state !== 'current') throw new Error('expected current projection');
    expect(current.display.generated.counter_hypotheses).toEqual(input.counter_hypotheses);
    expect(current.display.existing_evidence[0]?.evidence_id).toBe('private-evidence-1');
    expect(Object.hasOwn(current, 'canonical_inputs')).toBe(false);

    for (const state of ['changed', 'revoked', 'unavailable']) {
      const fresh = structuredClone(host);
      fresh.source_statuses[0]!.state = state;
      fresh.source_statuses[0]!.source_version = state === 'changed' ? 'v2' : null;
      const projection = presentDisconfirmation(saved, fresh);
      expect(projection.state).toBe('stale');
      expect(projection.display).toBeNull();
      expect(JSON.stringify(projection)).not.toContain(input.counter_hypotheses[0]);
      expect(JSON.stringify(projection)).not.toContain('private-evidence-1');
      expect(JSON.stringify(projection)).not.toContain(host.target.text);
      // Revalidation preserves historical bytes for internal audit without licensing their display.
      expect(validateDisconfirmation(saved).generated.counter_hypotheses).toEqual(input.counter_hypotheses);
    }
  });

  it('withholds a reloaded artefact when saved and fresh source states are both revoked', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.existing_evidence.push({ evidence_id: 'private-evidence-1', source_id: 'private-source', source_version: 'v1' });
    host.source_statuses.push({ source_id: 'private-source', source_version: null, state: 'revoked' });
    const saved = JSON.parse(canonicalJson(createDisconfirmation(input, host))) as unknown;
    expect(validateDisconfirmation(saved).lifecycle).toBe('not_started');
    const projection = presentDisconfirmation(saved, host);
    expect(projection).toEqual({
      kind: 'disconfirmation', state: 'stale', changed_dependencies: ['source'], display: null,
    });
    expect(JSON.stringify(projection)).not.toContain('private-source');
    expect(JSON.stringify(projection)).not.toContain('private-evidence-1');
  });

  it('requires exact host-attested lineage for generated text even without observed evidence refs', () => {
    const { input, host } = syntheticVerifiedFixture();
    expect(host.existing_evidence).toEqual([]);
    expect(host.challenging_evidence).toEqual([]);
    host.generated_content_binding = null;
    expect(() => createDisconfirmation(input, host)).toThrow('generated_lineage_required');
    const independent = syntheticVerifiedFixture();
    independent.host.generated_content_binding!.content_hash = 'c'.repeat(64);
    expect(() => createDisconfirmation(independent.input, independent.host)).toThrow('generated_lineage_mismatch');
    independent.host.generated_content_binding!.content_hash = contentHash({
      counter_hypotheses: independent.input.counter_hypotheses, questions: independent.input.questions,
      investigations: independent.input.investigations, unknowns: independent.input.unknowns,
    });
    independent.host.generated_content_binding!.source_independent = false;
    expect(() => createDisconfirmation(independent.input, independent.host)).toThrow('generated_lineage_ambiguous');
  });

  it('withholds source-conditioned generated text after revocation without an evidence reference', () => {
    const { input, host } = syntheticVerifiedFixture();
    host.generated_content_binding!.source_independent = false;
    host.generated_content_binding!.source_refs = [{ source_id: 'private-source', source_version: 'v1' }];
    host.source_statuses.push({ source_id: 'private-source', source_version: 'v1', state: 'current' });
    expect(host.existing_evidence).toEqual([]);
    expect(host.challenging_evidence).toEqual([]);
    const saved = JSON.parse(canonicalJson(createDisconfirmation(input, host))) as unknown;
    expect(presentDisconfirmation(saved, host).state).toBe('current');

    const revoked = structuredClone(host);
    revoked.source_statuses[0]!.state = 'revoked';
    revoked.source_statuses[0]!.source_version = null;
    const directCurrentness = assessDisconfirmationCurrentness(saved, input, revoked);
    expect(directCurrentness.state).toBe('stale');
    expect(directCurrentness.changed_dependencies.some((item) => item.startsWith('source:'))).toBe(true);
    expect(assessReasoningArtefactCurrentness(saved, input, revoked).state).toBe('stale');
    const revokedProjection = presentDisconfirmation(saved, revoked);
    expect(revokedProjection).toEqual({
      kind: 'disconfirmation', state: 'stale', changed_dependencies: ['source'], display: null,
    });
    expect(JSON.stringify(revokedProjection)).not.toContain(input.counter_hypotheses[0]);
    expect(JSON.stringify(revokedProjection)).not.toContain('private-source');

    const versionChanged = structuredClone(host);
    versionChanged.source_statuses[0]!.source_version = 'v2';
    expect(presentDisconfirmation(saved, versionChanged).display).toBeNull();
    const withdrawn = structuredClone(host);
    withdrawn.generated_content_binding = null;
    expect(presentDisconfirmation(saved, withdrawn)).toEqual({
      kind: 'disconfirmation', state: 'invalid', changed_dependencies: [], display: null,
    });
  });

  it('withholds current-use content for target, protocol or scenario drift while allowing unrelated edits', () => {
    const { input, host } = syntheticVerifiedFixture();
    const saved = JSON.parse(canonicalJson(createDisconfirmation(input, host))) as unknown;
    const unrelated = structuredClone(host);
    unrelated.graph_revision = 'unrelated-graph-edit';
    expect(presentDisconfirmation(saved, unrelated).state).toBe('current');

    const targetChanged = structuredClone(host);
    targetChanged.target.fingerprint = 'c'.repeat(64);
    const targetProjection = presentDisconfirmation(saved, targetChanged);
    expect(targetProjection.state).toBe('stale');
    expect(targetProjection.display).toBeNull();
    expect(targetProjection.changed_dependencies).toContain('claim');

    const retired = structuredClone(host);
    retired.protocol.authority_status = 'retired';
    const protocolProjection = presentDisconfirmation(saved, retired);
    expect(protocolProjection.state).toBe('stale');
    expect(protocolProjection.display).toBeNull();
    expect(protocolProjection.changed_dependencies).toContain('protocol');

    const foreign = structuredClone(host);
    foreign.scenario_id = 'different-scenario';
    expect(presentDisconfirmation(saved, foreign)).toEqual({
      kind: 'disconfirmation', state: 'invalid', changed_dependencies: [], display: null,
    });
    expect(presentDisconfirmation(saved, { ...host, protocol: { ...host.protocol, protocol_version: undefined } }))
      .toEqual({ kind: 'disconfirmation', state: 'invalid', changed_dependencies: [], display: null });
  });
});
