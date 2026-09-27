import {
  ARTEFACT_SCHEMA_VERSION, ArtefactInputError, assessBindingCurrentness, binding, canonicalJson, contentHash, dependency,
  fail, keys, list, own, record, str, unique,
  type ArtefactBinding, type BindingCurrentness, type SourceState, type SourceStatus,
} from './common.js';

/** A typed F2c boundary. This version does not assert that DSK-P-003 is currently ratified. */
export const DISCONFIRMATION_CONTRACT_VERSION = 'disconfirmation_boundary/1';
const DISCONFIRMATION_PROTOCOL_ID = 'DSK-P-003';

export type DisconfirmationLifecycle =
  | 'not_started' | 'in_progress' | 'declined' | 'completed' | 'completion_unverified';

export interface DisconfirmationInput {
  readonly target_id: string;
  /** These are generated candidates, never observations or proof of protocol completion. */
  readonly counter_hypotheses: readonly string[];
  readonly questions: readonly string[];
  readonly investigations: readonly string[];
  readonly unknowns: readonly string[];
}

export interface DisconfirmationEvidenceRef {
  readonly evidence_id: string;
  readonly source_id: string;
  readonly source_version: string;
}

export interface DisconfirmationHost {
  readonly scenario_id: string;
  readonly graph_revision: string;
  readonly target: {
    readonly id: string;
    readonly kind: 'claim' | 'assumption' | 'causal_belief';
    readonly text: string;
    readonly fingerprint: string;
    readonly state: 'current' | 'stale' | 'missing';
    readonly material: boolean;
  };
  /** This is supplied by the science owner through the host. Bundle presence alone is insufficient. */
  readonly protocol: {
    readonly protocol_id: typeof DISCONFIRMATION_PROTOCOL_ID;
    readonly protocol_version: string | null;
    readonly record_hash: string | null;
    readonly authority_status: 'verified_current' | 'unverified' | 'retired' | 'superseded';
    readonly science_ratification_ref: string | null;
    /** Exact governed completion rule identities, if any. DSK-P-003 v1.0.0 supplies none. */
    readonly completion_rules: readonly {
      readonly id: string;
      readonly version: string;
      readonly authority_ref: string;
    }[];
  };
  readonly invocation: {
    readonly state: 'requested' | 'declined' | 'absent';
    readonly request_ref: string | null;
  };
  /** The host owns this verdict, including prerequisite and contraindication interpretation. */
  readonly applicability: {
    readonly verdict: 'applicable' | 'not_applicable' | 'unknown';
    readonly reasons: readonly string[];
    readonly prerequisites: readonly string[];
    readonly contraindications: readonly string[];
  };
  readonly existing_evidence: readonly DisconfirmationEvidenceRef[];
  readonly challenging_evidence: readonly DisconfirmationEvidenceRef[];
  readonly source_statuses: readonly SourceStatus[];
  /** Host attestations for completion evidence, separate from generated exercise material. */
  readonly completion_evidence_bindings: readonly {
    readonly evidence_id: string;
    readonly attestation_ref: string;
  }[];
  /** Expected-output prose is never a machine completion rule. */
  readonly completion: {
    readonly verdict: 'complete' | 'unverified';
    readonly protocol_id: typeof DISCONFIRMATION_PROTOCOL_ID;
    readonly protocol_version: string | null;
    readonly protocol_record_hash: string | null;
    readonly target_fingerprint: string | null;
    readonly rule_id: string | null;
    readonly rule_version: string | null;
    readonly rule_authority_ref: string | null;
    readonly evidence_refs: readonly string[];
  } | null;
}

export interface DisconfirmationArtefact {
  readonly kind: 'disconfirmation';
  readonly schema_version: typeof ARTEFACT_SCHEMA_VERSION;
  readonly contract_version: typeof DISCONFIRMATION_CONTRACT_VERSION;
  /** Null is allowed only in a blocked/not-started record. */
  readonly protocol_version: string | null;
  readonly canonical_input_hash: string;
  readonly binding: ArtefactBinding;
  readonly canonical_inputs: { readonly input: DisconfirmationInput; readonly host: DisconfirmationHost };
  readonly lifecycle: DisconfirmationLifecycle;
  readonly blockers: readonly string[];
  readonly target: DisconfirmationHost['target'];
  readonly applicability: DisconfirmationHost['applicability'];
  readonly existing_evidence: readonly DisconfirmationEvidenceRef[];
  readonly challenging_evidence: readonly DisconfirmationEvidenceRef[];
  readonly generated: {
    readonly counter_hypotheses: readonly string[];
    readonly questions: readonly string[];
    readonly investigations: readonly string[];
    readonly unknowns: readonly string[];
  };
}

function hexHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail('invalid_content_hash');
  return value;
}

function nullableString(value: unknown, max: number): string | null {
  return value === null ? null : str(value, max);
}

function nullableHash(value: unknown): string | null {
  return value === null ? null : hexHash(value);
}

function strings(value: unknown, max: number): string[] {
  const result = list(value).map((item) => str(item, max));
  unique(result, 'duplicate_text');
  return result;
}

function parseEvidenceRefs(value: unknown): DisconfirmationEvidenceRef[] {
  const refs = list(value).map((raw) => {
    const r = record(raw);
    keys(r, ['evidence_id', 'source_id', 'source_version']);
    return {
      evidence_id: str(own(r, 'evidence_id'), 160), source_id: str(own(r, 'source_id'), 200),
      source_version: str(own(r, 'source_version'), 200),
    };
  });
  unique(refs.map((ref) => ref.evidence_id), 'duplicate_evidence');
  return refs;
}

function parseInput(raw: unknown): DisconfirmationInput {
  const r = record(raw);
  keys(r, ['target_id', 'counter_hypotheses', 'questions', 'investigations', 'unknowns']);
  return {
    target_id: str(own(r, 'target_id'), 160),
    counter_hypotheses: strings(own(r, 'counter_hypotheses'), 600),
    questions: strings(own(r, 'questions'), 600),
    investigations: strings(own(r, 'investigations'), 600),
    unknowns: strings(own(r, 'unknowns'), 600),
  };
}

function parseHost(raw: unknown): DisconfirmationHost {
  const r = record(raw);
  keys(r, ['scenario_id', 'graph_revision', 'target', 'protocol', 'invocation', 'applicability',
    'existing_evidence', 'challenging_evidence', 'source_statuses', 'completion_evidence_bindings', 'completion']);

  const targetRaw = record(own(r, 'target'));
  keys(targetRaw, ['id', 'kind', 'text', 'fingerprint', 'state', 'material']);
  const targetKind = own(targetRaw, 'kind');
  if (targetKind !== 'claim' && targetKind !== 'assumption' && targetKind !== 'causal_belief') fail('invalid_target_kind');
  const targetState = own(targetRaw, 'state');
  if (targetState !== 'current' && targetState !== 'stale' && targetState !== 'missing') fail('invalid_target_state');
  const material = own(targetRaw, 'material');
  if (typeof material !== 'boolean') fail('invalid_materiality');
  const target: DisconfirmationHost['target'] = {
    id: str(own(targetRaw, 'id'), 160), kind: targetKind, text: str(own(targetRaw, 'text'), 600),
    fingerprint: hexHash(own(targetRaw, 'fingerprint')), state: targetState, material,
  };

  const protocolRaw = record(own(r, 'protocol'));
  keys(protocolRaw, ['protocol_id', 'protocol_version', 'record_hash', 'authority_status',
    'science_ratification_ref', 'completion_rules']);
  if (own(protocolRaw, 'protocol_id') !== DISCONFIRMATION_PROTOCOL_ID) fail('wrong_disconfirmation_protocol');
  const authority_status = own(protocolRaw, 'authority_status');
  if (authority_status !== 'verified_current' && authority_status !== 'unverified'
    && authority_status !== 'retired' && authority_status !== 'superseded') fail('invalid_protocol_authority');
  const completion_rules = list(own(protocolRaw, 'completion_rules')).map((rawRule) => {
    const rule = record(rawRule);
    keys(rule, ['id', 'version', 'authority_ref']);
    return {
      id: str(own(rule, 'id'), 160), version: str(own(rule, 'version'), 80),
      authority_ref: str(own(rule, 'authority_ref'), 400),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  unique(completion_rules.map((rule) => rule.id), 'duplicate_completion_rule');
  const protocol: DisconfirmationHost['protocol'] = {
    protocol_id: DISCONFIRMATION_PROTOCOL_ID,
    protocol_version: nullableString(own(protocolRaw, 'protocol_version'), 80),
    record_hash: nullableHash(own(protocolRaw, 'record_hash')),
    authority_status, science_ratification_ref: nullableString(own(protocolRaw, 'science_ratification_ref'), 400),
    completion_rules,
  };

  const invocationRaw = record(own(r, 'invocation'));
  keys(invocationRaw, ['state', 'request_ref']);
  const invocationState = own(invocationRaw, 'state');
  if (invocationState !== 'requested' && invocationState !== 'declined' && invocationState !== 'absent') {
    fail('invalid_invocation_state');
  }
  const invocation: DisconfirmationHost['invocation'] = {
    state: invocationState, request_ref: nullableString(own(invocationRaw, 'request_ref'), 240),
  };

  const applicabilityRaw = record(own(r, 'applicability'));
  keys(applicabilityRaw, ['verdict', 'reasons', 'prerequisites', 'contraindications']);
  const verdict = own(applicabilityRaw, 'verdict');
  if (verdict !== 'applicable' && verdict !== 'not_applicable' && verdict !== 'unknown') {
    fail('invalid_applicability');
  }
  const applicability: DisconfirmationHost['applicability'] = {
    verdict, reasons: strings(own(applicabilityRaw, 'reasons'), 600),
    prerequisites: strings(own(applicabilityRaw, 'prerequisites'), 600),
    contraindications: strings(own(applicabilityRaw, 'contraindications'), 600),
  };

  const existing_evidence = parseEvidenceRefs(own(r, 'existing_evidence'));
  const challenging_evidence = parseEvidenceRefs(own(r, 'challenging_evidence'));
  unique([...existing_evidence, ...challenging_evidence].map((ref) => ref.evidence_id), 'duplicate_evidence');
  const boundEvidence = [...existing_evidence, ...challenging_evidence];
  const sourceVersions = new Map<string, string>();
  for (const ref of boundEvidence) {
    const priorVersion = sourceVersions.get(ref.source_id);
    if (priorVersion !== undefined && priorVersion !== ref.source_version) fail('conflicting_source_versions');
    sourceVersions.set(ref.source_id, ref.source_version);
  }
  const source_statuses = list(own(r, 'source_statuses')).map((rawStatus) => {
    const s = record(rawStatus);
    keys(s, ['source_id', 'source_version', 'state']);
    const state = own(s, 'state') as SourceState;
    if (state !== 'current' && state !== 'changed' && state !== 'revoked' && state !== 'unavailable') {
      fail('invalid_source_state');
    }
    const source_version = nullableString(own(s, 'source_version'), 200);
    if (state === 'current' && source_version === null) fail('current_source_without_version');
    return { source_id: str(own(s, 'source_id'), 200), source_version, state };
  }).filter((status) => sourceVersions.has(status.source_id))
    .sort((a, b) => a.source_id.localeCompare(b.source_id));
  unique(source_statuses.map((s) => s.source_id), 'duplicate_source_status');

  const completion_evidence_bindings = list(own(r, 'completion_evidence_bindings')).map((rawBinding) => {
    const evidenceBinding = record(rawBinding);
    keys(evidenceBinding, ['evidence_id', 'attestation_ref']);
    return {
      evidence_id: str(own(evidenceBinding, 'evidence_id'), 160),
      attestation_ref: str(own(evidenceBinding, 'attestation_ref'), 400),
    };
  }).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  unique(completion_evidence_bindings.map((item) => item.evidence_id), 'duplicate_completion_evidence');

  const completionRaw = own(r, 'completion');
  let completion: DisconfirmationHost['completion'] = null;
  if (completionRaw !== null) {
    const c = record(completionRaw);
    keys(c, ['verdict', 'protocol_id', 'protocol_version', 'protocol_record_hash',
      'target_fingerprint', 'rule_id', 'rule_version',
      'rule_authority_ref', 'evidence_refs']);
    const completionVerdict = own(c, 'verdict');
    if (completionVerdict !== 'complete' && completionVerdict !== 'unverified') fail('invalid_completion_verdict');
    if (own(c, 'protocol_id') !== DISCONFIRMATION_PROTOCOL_ID) fail('wrong_completion_protocol');
    completion = {
      verdict: completionVerdict, protocol_id: DISCONFIRMATION_PROTOCOL_ID,
      protocol_version: nullableString(own(c, 'protocol_version'), 80),
      protocol_record_hash: nullableHash(own(c, 'protocol_record_hash')),
      target_fingerprint: nullableHash(own(c, 'target_fingerprint')),
      rule_id: nullableString(own(c, 'rule_id'), 160),
      rule_version: nullableString(own(c, 'rule_version'), 80),
      rule_authority_ref: nullableString(own(c, 'rule_authority_ref'), 400),
      evidence_refs: strings(own(c, 'evidence_refs'), 200),
    };
  }
  return {
    scenario_id: str(own(r, 'scenario_id'), 160), graph_revision: str(own(r, 'graph_revision'), 160),
    target, protocol, invocation, applicability, existing_evidence, challenging_evidence,
    source_statuses,
    completion_evidence_bindings: completion === null ? [] : completion_evidence_bindings
      .filter((item) => completion.evidence_refs.includes(item.evidence_id)),
    completion,
  };
}

function startBlockers(input: DisconfirmationInput, host: DisconfirmationHost): string[] {
  const blockers: string[] = [];
  const protocol = host.protocol;
  if (protocol.authority_status !== 'verified_current') blockers.push(`protocol_${protocol.authority_status}`);
  if (protocol.protocol_version === null) blockers.push('protocol_version_missing');
  if (protocol.record_hash === null) blockers.push('protocol_record_hash_missing');
  if (protocol.science_ratification_ref === null) blockers.push('protocol_ratification_missing');
  if (input.target_id !== host.target.id) blockers.push('target_identity_mismatch');
  if (host.target.state !== 'current') blockers.push('target_not_current');
  if (!host.target.material) blockers.push('target_not_material');
  if (host.invocation.state === 'absent' || host.invocation.request_ref === null) blockers.push('explicit_invocation_missing');
  if (host.applicability.verdict !== 'applicable') blockers.push(`applicability_${host.applicability.verdict}`);
  for (const ref of [...host.existing_evidence, ...host.challenging_evidence]) {
    const source = host.source_statuses.find((s) => s.source_id === ref.source_id);
    if (source?.state !== 'current' || source.source_version !== ref.source_version) {
      blockers.push(`source_not_current:${ref.source_id}`);
    }
  }
  return [...new Set(blockers)];
}

function verifiedCompletion(host: DisconfirmationHost): boolean {
  const completion = host.completion;
  return completion !== null && completion.verdict === 'complete'
    && completion.protocol_version !== null && completion.protocol_version === host.protocol.protocol_version
    && completion.protocol_record_hash !== null && completion.protocol_record_hash === host.protocol.record_hash
    && completion.target_fingerprint !== null && completion.target_fingerprint === host.target.fingerprint
    && completion.rule_id !== null && completion.rule_version !== null
    && completion.rule_authority_ref !== null
    && host.protocol.completion_rules.some((rule) => rule.id === completion.rule_id
      && rule.version === completion.rule_version && rule.authority_ref === completion.rule_authority_ref)
    && completion.evidence_refs.length > 0
    && completion.evidence_refs.every((ref) => host.completion_evidence_bindings
      .some((attested) => attested.evidence_id === ref));
}

/** Pure contract computation. All permissions, science verdicts and observed evidence arrive through the host. */
export function createDisconfirmation(rawInput: unknown, rawHost: unknown): DisconfirmationArtefact {
  const parsedInput = parseInput(rawInput);
  const host = parseHost(rawHost);
  const blockers = startBlockers(parsedInput, host);
  const declined = host.invocation.state === 'declined';
  // A blocked or declined request never publishes generated exercise material as a performed protocol.
  const active = blockers.length === 0 && !declined;
  const protocolBound = host.protocol.authority_status === 'verified_current'
    && host.protocol.protocol_version !== null && host.protocol.record_hash !== null
    && host.protocol.science_ratification_ref !== null;
  const input: DisconfirmationInput = active ? parsedInput : {
    target_id: parsedInput.target_id, counter_hypotheses: [], questions: [], investigations: [], unknowns: [],
  };
  const lifecycle: DisconfirmationLifecycle = blockers.length > 0 ? 'not_started' : declined ? 'declined'
    : host.completion === null ? 'in_progress'
      : verifiedCompletion(host) ? 'completed' : 'completion_unverified';
  const finalBlockers = lifecycle === 'completion_unverified' ? [...blockers, 'completion_rule_unverified'] : blockers;
  const boundEvidence = [...host.existing_evidence, ...host.challenging_evidence];
  const dependencies = [
    dependency('claim', host.target.id, host.target),
    dependency('protocol', host.protocol.protocol_id, host.protocol),
    dependency('protocol', `${host.protocol.protocol_id}:applicability`, host.applicability),
    dependency('protocol', `${host.protocol.protocol_id}:invocation`, host.invocation),
    dependency('protocol', `${host.protocol.protocol_id}:completion`, host.completion),
    dependency('protocol', `${host.protocol.protocol_id}:completion_evidence`, host.completion_evidence_bindings),
    dependency('claim', `${host.target.id}:evidence`, { existing: host.existing_evidence, challenging: host.challenging_evidence }),
    ...boundEvidence.map((ref) => dependency('source', JSON.stringify([ref.source_id, ref.evidence_id]), {
      source_ref: ref, status: host.source_statuses.find((s) => s.source_id === ref.source_id) ?? null,
    })),
  ];
  const bound = binding(host.scenario_id, host.graph_revision, dependencies);
  const { graph_revision: _historicalRevision, ...consumedHost } = host;
  const canonical_input_hash = contentHash({
    schema_version: ARTEFACT_SCHEMA_VERSION, contract_version: DISCONFIRMATION_CONTRACT_VERSION,
    input, host: consumedHost,
  });
  return {
    kind: 'disconfirmation', schema_version: ARTEFACT_SCHEMA_VERSION,
    contract_version: DISCONFIRMATION_CONTRACT_VERSION,
    protocol_version: protocolBound ? host.protocol.protocol_version : null,
    canonical_input_hash, binding: bound, canonical_inputs: { input, host }, lifecycle,
    blockers: finalBlockers, target: host.target, applicability: host.applicability,
    existing_evidence: active ? host.existing_evidence : [],
    challenging_evidence: active ? host.challenging_evidence : [],
    generated: {
      counter_hypotheses: input.counter_hypotheses, questions: input.questions,
      investigations: input.investigations, unknowns: input.unknowns,
    },
  };
}

/** Recompute all derived fields; a persisted lifecycle or completion claim cannot be edited into validity. */
export function validateDisconfirmation(raw: unknown): DisconfirmationArtefact {
  const value = record(raw);
  keys(value, ['kind', 'schema_version', 'contract_version', 'protocol_version', 'canonical_input_hash',
    'binding', 'canonical_inputs', 'lifecycle', 'blockers', 'target', 'applicability',
    'existing_evidence', 'challenging_evidence', 'generated']);
  if (own(value, 'kind') !== 'disconfirmation') fail('wrong_artefact_kind');
  const snapshot = record(own(value, 'canonical_inputs'));
  keys(snapshot, ['input', 'host']);
  const recreated = createDisconfirmation(own(snapshot, 'input'), own(snapshot, 'host'));
  if (canonicalJson(value) !== canonicalJson(recreated)) fail('artefact_revalidation_failed');
  return recreated;
}

export function assessDisconfirmationCurrentness(
  saved: unknown, currentInput: unknown, currentHost: unknown,
): BindingCurrentness {
  const historical = validateDisconfirmation(saved);
  try {
    const current = createDisconfirmation(currentInput, currentHost);
    return assessBindingCurrentness(historical.binding, current.binding);
  } catch (error) {
    if (error instanceof ArtefactInputError) return { state: 'invalid', changed_dependencies: [] };
    throw error;
  }
}
