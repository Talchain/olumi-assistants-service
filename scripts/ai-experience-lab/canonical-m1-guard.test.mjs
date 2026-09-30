import { test } from 'vitest';
import assert from 'node:assert/strict';
import { bindCanonicalM1, settleCanonicalM2 } from './canonical-m1-guard.mjs';

const scenario_id = '11111111-1111-4111-8111-111111111111';
const version_id = '22222222-2222-4222-8222-222222222222';
const mutation_id = '33333333-3333-4333-8333-333333333333';
const full = 'a'.repeat(64), analysis = 'b'.repeat(64), cas = 'c'.repeat(16);
const identity = { kind: 'graph_identity_hash', value: full, algorithm: 'sha256',
  projection_version: 'identity.v1', graph_schema_version: 'graph_v3', normaliser_version: '1' };
const fixture = () => ({
  session_id: 'lab-session-1', scenario_id,
  registration: { schema: 'scenario_graph_registration.v1', registered: true, scenario_id,
    graph_identity_hash: structuredClone(identity), graph_hash: cas,
    model_version: { version_id, version_number: 1, mutation_id, creation_kind: 'initial',
      graph_identity_hash: full, analysis_affecting_hash: analysis } },
  readback: { schema: 'scenario_graph.v1', scenario_id, graph_present: true,
    graph: { nodes: [{ id: 'goal', kind: 'goal' }], edges: [] }, brief_text: 'A fresh user brief',
    graph_identity_hash: structuredClone(identity), graph_hash: cas },
  versions: { schema: 'model_versions_list.v2', scenario_id, current_version_id: version_id,
    versions: [{ version_id, scenario_id, sequence: 1, full_hash: full, analysis_affecting_hash: analysis,
      creation: { kind: 'initial', mutation_id, source_turn_id: 'registration-turn' } }] },
});
const m2Receipt = binding => ({ session_id: binding.session_id, scenario_id,
  graph_identity_hash: binding.graph_identity_hash.value, graph_hash: binding.graph_hash,
  model_version_id: binding.model_version.version_id, input_hash: 'd'.repeat(64),
  request_input: { brief: { text: binding.brief }, admitted_m1: { scenario_id,
    graph_revision: binding.model_version.version_id,
    graph_hash: binding.graph_identity_hash.value, model: structuredClone(binding.graph) } },
  raw_response: { id: 'provider-receipt' } });
const hostReadback = input => {
  const row = input.versions.versions[0];
  return { schema: 'm1_host_readback.v1', scenario_id, signed_in: true,
    http: { graph: 200, versions: 200 },
    graph: structuredClone(input.readback.graph), brief_text: input.readback.brief_text,
    graph_identity_hash: structuredClone(input.readback.graph_identity_hash), graph_hash: input.readback.graph_hash,
    version_binding: 'bound',
    model_version: { version_id: row.version_id, sequence: row.sequence, full_hash: row.full_hash,
      analysis_affecting_hash: row.analysis_affecting_hash, creation: structuredClone(row.creation) },
    construction: { source_turn_id: row.creation.source_turn_id, version_id: row.version_id,
      sequence: row.sequence, is_current: true },
    raw: { graph_read: structuredClone(input.readback), versions: structuredClone(input.versions) } };
};

test('binds an owned scenario read and exact current version to a distinct Lab session', () => {
  const input = fixture();
  const bound = bindCanonicalM1(input);
  assert.equal(bound.accepted, true);
  assert.equal(bound.binding.session_id, input.session_id);
  assert.equal(bound.binding.scenario_id, scenario_id);
  assert.equal(bound.binding.graph_identity_hash.value, full);
  assert.equal(bound.binding.model_version.version_id, version_id);
  const raw = m2Receipt(bound.binding);
  const settled = settleCanonicalM2({ binding: bound.binding, readback: input.readback,
    versions: input.versions, m2: { accepted: true, proposals: [{ candidate: 'Check churn' }], receipt: raw } });
  assert.equal(settled.accepted, true);
  assert.equal(settled.proposals.length, 1);
  assert.equal(settled.receipt, raw);
});

test('binds the existing M1 tool receipt when the register response is not exposed', () => {
  const first = fixture();
  first.construction = { ok: true, model_version: structuredClone(first.registration.model_version) };
  delete first.registration;
  const bound = bindCanonicalM1(first);
  assert.equal(bound.accepted, true);
  assert.deepEqual(bound.binding.graph_identity_hash, first.readback.graph_identity_hash);
  assert.equal(bound.binding.graph_hash, first.readback.graph_hash);
  assert.equal(bound.binding.model_version.version_id, first.versions.current_version_id);

  const recovered = fixture();
  recovered.construction = { ok: true, mutated: false, replayed: true, model_version: {
    version_id, version_number: 1, mutation_id, creation_kind: 'initial', source_turn_id: 'registration-turn',
  } };
  delete recovered.registration;
  assert.equal(bindCanonicalM1(recovered).accepted, true);

  const direct = fixture();
  direct.model_version = recovered.construction.model_version;
  delete direct.registration;
  assert.equal(bindCanonicalM1(direct).accepted, true);
});

test('fresh M1 binding requires its construction version to be the current canonical graph', () => {
  const input = fixture();
  const host = hostReadback(input);
  const bound = bindCanonicalM1({ session_id: input.session_id, scenario_id, readback: host,
    require_construction_current: true });
  assert.equal(bound.accepted, true);
  assert.equal(bound.binding.model_version.version_id, version_id);
  assert.equal(bound.binding.model_version.source_turn_id, 'registration-turn');
  const raw = m2Receipt(bound.binding);
  const settled = settleCanonicalM2({ binding: bound.binding, readback: host,
    m2: { accepted: true, proposals: [{ candidate: 'Check churn' }], receipt: raw } });
  assert.equal(settled.accepted, true);
  assert.equal(settled.receipt, raw);

  const changed = structuredClone(host); changed.construction.is_current = false;
  const stale = settleCanonicalM2({ binding: bound.binding, readback: changed,
    m2: { accepted: true, proposals: [{ candidate: 'Earlier idea' }], receipt: raw } });
  assert.equal(stale.withheld_reason, 'earlier_model');
  assert.deepEqual(stale.proposals, []);
  assert.equal(stale.receipt, raw);
});

test('an approved edit stales old M2 while a new binding can widen the edited current version', () => {
  const input = fixture();
  const original = hostReadback(input);
  const first = bindCanonicalM1({ session_id: input.session_id, scenario_id, readback: original,
    require_construction_current: true });
  assert.equal(first.accepted, true);
  const oldReceipt = m2Receipt(first.binding);

  const edited = structuredClone(original);
  const editedId = '44444444-4444-4444-8444-444444444444';
  const editedFull = 'e'.repeat(64), editedAnalysis = 'f'.repeat(64), editedCas = '1'.repeat(16);
  const editedGraph = { nodes: [{ id: 'goal', kind: 'goal', label: 'Revised goal' }], edges: [] };
  const newRow = { version_id: editedId, scenario_id, sequence: 2,
    full_hash: editedFull, analysis_affecting_hash: editedAnalysis,
    creation: { kind: 'committed_mutation', mutation_id: 'mutation-after-approval', source_turn_id: 'approved-edit-turn' } };
  edited.raw.versions.versions.unshift(newRow);
  edited.raw.versions.current_version_id = editedId;
  edited.model_version = { version_id: editedId, sequence: 2, full_hash: editedFull,
    analysis_affecting_hash: editedAnalysis, creation: structuredClone(newRow.creation) };
  edited.construction.is_current = false;
  edited.version_binding = 'bound';
  edited.graph = structuredClone(editedGraph);
  edited.raw.graph_read.graph = structuredClone(editedGraph);
  edited.graph_identity_hash.value = editedFull;
  edited.raw.graph_read.graph_identity_hash.value = editedFull;
  edited.graph_hash = editedCas;
  edited.raw.graph_read.graph_hash = editedCas;

  const old = settleCanonicalM2({ binding: first.binding, readback: edited,
    m2: { accepted: true, proposals: [{ candidate: 'Old idea' }], receipt: oldReceipt } });
  assert.equal(old.withheld_reason, 'earlier_model');
  assert.deepEqual(old.proposals, []);
  assert.equal(old.receipt, oldReceipt);
  assert.equal(bindCanonicalM1({ session_id: input.session_id, scenario_id, readback: edited,
    require_construction_current: true }).withheld_reason, 'earlier_model');

  const second = bindCanonicalM1({ session_id: input.session_id, scenario_id, readback: edited });
  assert.equal(second.accepted, true);
  assert.equal(second.binding.model_version.version_id, editedId);
  const newReceipt = m2Receipt(second.binding);
  const current = settleCanonicalM2({ binding: second.binding, readback: edited,
    m2: { accepted: true, proposals: [{ candidate: 'New idea' }], receipt: newReceipt } });
  assert.equal(current.accepted, true);
  assert.deepEqual(current.proposals, [{ candidate: 'New idea' }]);
});

test('MG host summaries cannot override the canonical route payloads', () => {
  const input = fixture();
  const host = hostReadback(input);
  const bind = h => bindCanonicalM1({ session_id: input.session_id, scenario_id, readback: h });
  const unbound = structuredClone(host); unbound.version_binding = 'mismatch';
  assert.equal(bind(unbound).withheld_reason, 'earlier_model');
  const differentSource = structuredClone(host); differentSource.construction.source_turn_id = 'foreign-turn';
  assert.equal(bind(differentSource).withheld_reason, 'model_version_mismatch');
  const differentRow = structuredClone(host); differentRow.model_version.analysis_affecting_hash = 'e'.repeat(64);
  assert.equal(bind(differentRow).withheld_reason, 'model_version_mismatch');
  const differentGraph = structuredClone(host); differentGraph.graph_identity_hash.value = 'e'.repeat(64);
  assert.equal(bind(differentGraph).withheld_reason, 'earlier_model');
  const movedPointer = structuredClone(host); movedPointer.raw.versions.current_version_id = 'other-version';
  assert.equal(bind(movedPointer).withheld_reason, 'model_version_mismatch');
  const wrongScenario = structuredClone(host); wrongScenario.raw.graph_read.scenario_id = 'other-scenario';
  assert.equal(bind(wrongScenario).withheld_reason, 'scenario_mismatch');
});

test('tool receipt fails closed on a missing or different canonical version', () => {
  const input = fixture();
  input.construction = { ok: true, model_version: structuredClone(input.registration.model_version) };
  delete input.registration;
  const wrongFullHash = structuredClone(input); wrongFullHash.versions.versions[0].full_hash = 'e'.repeat(64);
  assert.equal(bindCanonicalM1(wrongFullHash).withheld_reason, 'model_version_mismatch');
  const wrongAnalysisHash = structuredClone(input); wrongAnalysisHash.versions.versions[0].analysis_affecting_hash = 'e'.repeat(64);
  assert.equal(bindCanonicalM1(wrongAnalysisHash).withheld_reason, 'model_version_mismatch');
  const wrongPointer = structuredClone(input); wrongPointer.versions.current_version_id = 'other-version';
  assert.equal(bindCanonicalM1(wrongPointer).withheld_reason, 'earlier_model');
  const missingVersion = structuredClone(input); missingVersion.versions.versions = [];
  assert.equal(bindCanonicalM1(missingVersion).withheld_reason, 'model_version_mismatch');
  const wrongScenario = structuredClone(input); wrongScenario.versions.scenario_id = 'other-scenario';
  assert.equal(bindCanonicalM1(wrongScenario).withheld_reason, 'scenario_mismatch');
  const refused = structuredClone(input); refused.construction.ok = false;
  assert.equal(bindCanonicalM1(refused).withheld_reason, 'construction_unverified');
  const noReceipt = structuredClone(input); delete noReceipt.construction.model_version;
  assert.equal(bindCanonicalM1(noReceipt).withheld_reason, 'model_version_unverified');
  const wrongReceiptScenario = structuredClone(input); wrongReceiptScenario.construction.model_version.scenario_id = 'other-scenario';
  assert.equal(bindCanonicalM1(wrongReceiptScenario).withheld_reason, 'scenario_mismatch');
});

test('recovered M1 receipt must agree with the current row and any other supplied receipt', () => {
  const input = fixture();
  input.construction = { ok: true, model_version: {
    version_id, version_number: 1, mutation_id, creation_kind: 'initial', source_turn_id: 'registration-turn',
  } };
  delete input.registration;
  const wrongTurn = structuredClone(input); wrongTurn.construction.model_version.source_turn_id = 'another-turn';
  assert.equal(bindCanonicalM1(wrongTurn).withheld_reason, 'model_version_mismatch');
  const wrongMutation = structuredClone(input); wrongMutation.construction.model_version.mutation_id = 'other-mutation';
  assert.equal(bindCanonicalM1(wrongMutation).withheld_reason, 'model_version_mismatch');
  const wrongNumber = structuredClone(input); wrongNumber.construction.model_version.version_number = 2;
  assert.equal(bindCanonicalM1(wrongNumber).withheld_reason, 'model_version_mismatch');
  const noAuthority = structuredClone(input); delete noAuthority.construction.model_version.source_turn_id;
  assert.equal(bindCanonicalM1(noAuthority).withheld_reason, 'model_version_unverified');
  const conflicting = structuredClone(input); conflicting.model_version = { ...conflicting.construction.model_version, version_id: 'other-version' };
  assert.equal(bindCanonicalM1(conflicting).withheld_reason, 'model_version_mismatch');
  const matching = structuredClone(input); matching.model_version = structuredClone(matching.construction.model_version);
  assert.equal(bindCanonicalM1(matching).accepted, true);
});

test('withholds missing registration/version and cross-scenario or mismatched readback', () => {
  const missing = fixture(); delete missing.registration.model_version;
  assert.equal(bindCanonicalM1(missing).withheld_reason, 'model_version_unverified');
  const cross = fixture(); cross.readback.scenario_id = 'other-scenario';
  assert.equal(bindCanonicalM1(cross).withheld_reason, 'scenario_mismatch');
  const identityDrift = fixture(); identityDrift.readback.graph_identity_hash.value = 'd'.repeat(64);
  assert.equal(bindCanonicalM1(identityDrift).withheld_reason, 'earlier_model');
  const wrongHead = fixture(); wrongHead.versions.current_version_id = 'other-version';
  assert.equal(bindCanonicalM1(wrongHead).withheld_reason, 'earlier_model');
  const wrongVersionHash = fixture(); wrongVersionHash.versions.versions[0].analysis_affecting_hash = 'd'.repeat(64);
  assert.equal(bindCanonicalM1(wrongVersionHash).withheld_reason, 'model_version_mismatch');
});

test('a fresh post-M2 read withholds earlier-model cards and preserves the raw receipt', () => {
  const input = fixture();
  const { binding } = bindCanonicalM1(input);
  const receipt = m2Receipt(binding);
  const m2 = { accepted: true, proposals: [{ candidate: 'Earlier idea' }], receipt };
  const edited = structuredClone(input.readback); edited.graph_hash = 'd'.repeat(16);
  const stale = settleCanonicalM2({ binding, readback: edited, versions: input.versions, m2 });
  assert.deepEqual(stale.proposals, []);
  assert.equal(stale.withheld_reason, 'earlier_model');
  assert.equal(stale.receipt, receipt);
  const moved = structuredClone(input.versions); moved.current_version_id = 'other-version';
  assert.equal(settleCanonicalM2({ binding, readback: input.readback, versions: moved, m2 }).withheld_reason, 'earlier_model');
  const noRead = settleCanonicalM2({ binding, readback: null, versions: input.versions, m2 });
  assert.equal(noRead.withheld_reason, 'canonical_readback_unavailable');
  assert.deepEqual(noRead.proposals, []);
});

test('M2 must itself carry the same canonical graph and version in its raw receipt', () => {
  const input = fixture();
  const { binding } = bindCanonicalM1(input);
  const receipt = m2Receipt(binding); receipt.request_input.admitted_m1.graph_hash = 'e'.repeat(64);
  const result = settleCanonicalM2({ binding, readback: input.readback, versions: input.versions,
    m2: { accepted: true, proposals: [{ candidate: 'Unbound idea' }], receipt } });
  assert.equal(result.withheld_reason, 'm2_binding_mismatch');
  assert.deepEqual(result.proposals, []);
  assert.equal(result.receipt, receipt);
});
