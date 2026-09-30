/** Pure consumer of the existing register, graph-read and versions responses. No authority is minted here. */
import { isDeepStrictEqual } from 'node:util';
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const graphHash = value => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const withheld = reason => ({ accepted: false, proposals: [], withheld_reason: reason });
const IDENTITY_FIELDS = ['kind', 'value', 'algorithm', 'projection_version', 'graph_schema_version', 'normaliser_version'];

function identity(value) {
  return object(value) && value.kind === 'graph_identity_hash' && value.algorithm === 'sha256' &&
    sha256(value.value) && IDENTITY_FIELDS.slice(3).every(key => typeof value[key] === 'string' && value[key]);
}

function versionReceipt(value) {
  return object(value) && typeof value.version_id === 'string' && !!value.version_id &&
    Number.isInteger(value.version_number) && value.version_number > 0 &&
    typeof value.mutation_id === 'string' && !!value.mutation_id &&
    typeof value.creation_kind === 'string' && !!value.creation_kind &&
    (value.graph_identity_hash === undefined || sha256(value.graph_identity_hash)) &&
    (value.analysis_affecting_hash === undefined || sha256(value.analysis_affecting_hash)) &&
    (value.source_turn_id === undefined || (typeof value.source_turn_id === 'string' && !!value.source_turn_id)) &&
    // The live registration carries hashes; a recovered construction carries its source turn.
    (value.graph_identity_hash !== undefined || value.source_turn_id !== undefined);
}

function receiptsAgree(a, b) {
  return ['version_id', 'version_number', 'mutation_id', 'creation_kind',
    'graph_identity_hash', 'analysis_affecting_hash', 'source_turn_id']
    .every(key => a[key] === undefined || b[key] === undefined || a[key] === b[key]);
}

/** Check MG's readback against the two canonical route payloads it carries. */
function hostState(host, scenarioId, requireConstructionCurrent = false) {
  if (host.scenario_id !== scenarioId) return { reason: 'scenario_mismatch' };
  if (host.version_binding !== 'bound') return { reason: 'earlier_model' };
  if (host.signed_in !== true || host.http?.graph !== 200 || host.http?.versions !== 200 ||
      !object(host.raw?.graph_read) || !object(host.raw?.versions)) {
    return { reason: 'canonical_readback_unavailable' };
  }
  const readback = host.raw.graph_read, versions = host.raw.versions;
  if (readback.scenario_id !== scenarioId || versions.scenario_id !== scenarioId) {
    return { reason: 'scenario_mismatch' };
  }
  if (!isDeepStrictEqual(host.graph, readback.graph) || host.brief_text !== readback.brief_text ||
      !isDeepStrictEqual(host.graph_identity_hash, readback.graph_identity_hash) ||
      host.graph_hash !== readback.graph_hash) return { reason: 'earlier_model' };
  const row = Array.isArray(versions.versions)
    ? versions.versions.find(item => item?.version_id === versions.current_version_id) : undefined;
  const summary = host.model_version, construction = host.construction;
  const constructed = Array.isArray(versions.versions)
    ? versions.versions.find(item => item?.version_id === construction?.version_id) : undefined;
  if (!object(row) || !object(summary) || !object(construction) ||
      !object(constructed) || constructed.scenario_id !== scenarioId ||
      !sha256(constructed.full_hash) || !sha256(constructed.analysis_affecting_hash) ||
      typeof construction.source_turn_id !== 'string' || !construction.source_turn_id ||
      summary.version_id !== row.version_id || summary.sequence !== row.sequence ||
      summary.full_hash !== row.full_hash || summary.analysis_affecting_hash !== row.analysis_affecting_hash ||
      !isDeepStrictEqual(summary.creation, row.creation) ||
      construction.sequence !== constructed.sequence ||
      construction.source_turn_id !== constructed.creation?.source_turn_id ||
      construction.is_current !== (constructed.version_id === row.version_id)) {
    return { reason: 'model_version_mismatch' };
  }
  if (requireConstructionCurrent && construction.is_current !== true) return { reason: 'earlier_model' };
  // Project the existing row into the M1 receipt shape used by this guard; no version or identity is created.
  const model_version = {
    version_id: row.version_id, version_number: row.sequence,
    mutation_id: row.creation?.mutation_id, creation_kind: row.creation?.kind,
    graph_identity_hash: row.full_hash, analysis_affecting_hash: row.analysis_affecting_hash,
    source_turn_id: row.creation?.source_turn_id,
  };
  return { readback, versions, model_version };
}

function current(binding, readback, versions) {
  if (!object(readback) || readback.schema !== 'scenario_graph.v1' ||
      !object(versions) || versions.schema !== 'model_versions_list.v2') return 'canonical_readback_unavailable';
  if (readback.scenario_id !== binding.scenario_id || versions.scenario_id !== binding.scenario_id) return 'scenario_mismatch';
  if (readback.graph_present !== true || !object(readback.graph) ||
      !Array.isArray(readback.graph.nodes) || readback.graph.nodes.length === 0 ||
      !Array.isArray(readback.graph.edges) || typeof readback.brief_text !== 'string' || !readback.brief_text.trim() ||
      !identity(readback.graph_identity_hash) || !graphHash(readback.graph_hash)) return 'canonical_readback_unavailable';
  if (!IDENTITY_FIELDS.every(key => readback.graph_identity_hash[key] === binding.graph_identity_hash[key]) ||
      readback.graph_hash !== binding.graph_hash || readback.brief_text !== binding.brief) return 'earlier_model';
  if (versions.current_version_id !== binding.model_version.version_id || !Array.isArray(versions.versions)) return 'earlier_model';
  const version = versions.versions.find(item => item?.version_id === binding.model_version.version_id);
  if (!object(version) || version.scenario_id !== binding.scenario_id ||
      version.sequence !== binding.model_version.version_number ||
      !sha256(version.full_hash) || !sha256(version.analysis_affecting_hash) ||
      version.full_hash !== binding.graph_identity_hash.value ||
      (binding.model_version.graph_identity_hash !== undefined &&
        version.full_hash !== binding.model_version.graph_identity_hash) ||
      (binding.model_version.analysis_affecting_hash !== undefined &&
        version.analysis_affecting_hash !== binding.model_version.analysis_affecting_hash) ||
      !object(version.creation) || version.creation.kind !== binding.model_version.creation_kind ||
      version.creation.mutation_id !== binding.model_version.mutation_id ||
      typeof version.creation.source_turn_id !== 'string' || !version.creation.source_turn_id ||
      (binding.model_version.source_turn_id !== undefined &&
        version.creation.source_turn_id !== binding.model_version.source_turn_id)) return 'model_version_mismatch';
  return null;
}

/** Call with the host's fresh read and versions result after M1 construction, before M2. */
export function bindCanonicalM1({ session_id, scenario_id, registration, construction, model_version, readback, versions,
  require_construction_current = false }) {
  if (typeof session_id !== 'string' || !session_id || typeof scenario_id !== 'string' || !scenario_id) {
    return withheld('session_or_scenario_unavailable');
  }
  if (readback?.schema === 'm1_host_readback.v1') {
    const host = hostState(readback, scenario_id, require_construction_current);
    if (host.reason) return withheld(host.reason);
    return bindCanonicalM1({ session_id, scenario_id, registration, construction,
      model_version: model_version ?? host.model_version, readback: host.readback, versions: host.versions });
  }
  if (construction !== undefined && (!object(construction) || construction.ok !== true ||
      (construction.scenario_id !== undefined && construction.scenario_id !== scenario_id))) {
    return withheld('construction_unverified');
  }
  const constructedVersion = construction?.model_version;
  if (construction !== undefined && !versionReceipt(constructedVersion)) return withheld('model_version_unverified');
  if (constructedVersion !== undefined && model_version !== undefined &&
      (!versionReceipt(model_version) || !receiptsAgree(constructedVersion, model_version))) {
    return withheld('model_version_mismatch');
  }
  const toolReceipt = constructedVersion ?? model_version;
  if (toolReceipt !== undefined && !versionReceipt(toolReceipt)) return withheld('model_version_unverified');

  const hasRegistration = registration !== undefined && registration !== null;
  if (!hasRegistration && toolReceipt === undefined) return withheld('registration_unverified');
  if (hasRegistration && (!object(registration) || registration.schema !== 'scenario_graph_registration.v1' ||
      registration.registered !== true || registration.scenario_id !== scenario_id)) return withheld('registration_unverified');
  const receipt = hasRegistration ? registration.model_version : toolReceipt;
  if (!versionReceipt(receipt)) return withheld('model_version_unverified');
  if (receipt.scenario_id !== undefined && receipt.scenario_id !== scenario_id) return withheld('scenario_mismatch');
  if (hasRegistration && (!identity(registration.graph_identity_hash) || !graphHash(registration.graph_hash) ||
      receipt.graph_identity_hash !== registration.graph_identity_hash.value ||
      !sha256(receipt.analysis_affecting_hash))) return withheld('model_version_unverified');
  if (hasRegistration && toolReceipt !== undefined && !receiptsAgree(receipt, toolReceipt)) {
    return withheld('model_version_mismatch');
  }
  const binding = {
    session_id, scenario_id,
    graph_identity_hash: hasRegistration ? registration.graph_identity_hash : readback?.graph_identity_hash,
    graph_hash: hasRegistration ? registration.graph_hash : readback?.graph_hash,
    model_version: receipt, brief: readback?.brief_text,
  };
  const reason = current(binding, readback, versions);
  if (reason !== null) return withheld(reason);
  if (hasRegistration && toolReceipt !== undefined &&
      current({ ...binding, model_version: toolReceipt }, readback, versions) !== null) {
    return withheld('model_version_mismatch');
  }
  return { accepted: true, binding: { ...binding, graph: readback.graph } };
}

/** Call with another fresh graph read AND versions read after M2; raw receipt survives a refusal. */
export function settleCanonicalM2({ binding, readback, versions, m2 }) {
  if (!object(binding) || !object(binding.model_version) || !identity(binding.graph_identity_hash)) {
    return withheld('canonical_binding_unavailable');
  }
  const receipt = object(m2) ? m2.receipt : undefined;
  if (readback?.schema === 'm1_host_readback.v1') {
    const host = hostState(readback, binding.scenario_id);
    if (host.reason) return { ...withheld(host.reason === 'canonical_readback_unavailable' ? host.reason : 'earlier_model'), receipt };
    readback = host.readback;
    versions = host.versions;
  }
  const reason = current(binding, readback, versions);
  if (reason !== null) return { ...withheld(reason === 'canonical_readback_unavailable' ? reason : 'earlier_model'), receipt };
  if (!object(m2) || m2.accepted !== true || !Array.isArray(m2.proposals)) {
    return { ...withheld('m2_unverified'), receipt };
  }
  const admitted = receipt?.request_input?.admitted_m1;
  if (!object(receipt) || receipt.session_id !== binding.session_id || receipt.scenario_id !== binding.scenario_id ||
      receipt.graph_identity_hash !== binding.graph_identity_hash.value || receipt.graph_hash !== binding.graph_hash ||
      receipt.model_version_id !== binding.model_version.version_id || !sha256(receipt.input_hash) ||
      !object(admitted) || admitted.scenario_id !== binding.scenario_id ||
      admitted.graph_revision !== binding.model_version.version_id ||
      admitted.graph_hash !== binding.graph_identity_hash.value ||
      !isDeepStrictEqual(admitted.model, binding.graph) || receipt.request_input?.brief?.text !== binding.brief) {
    return { ...withheld('m2_binding_mismatch'), receipt };
  }
  return { accepted: true, proposals: m2.proposals, withheld_reason: null, receipt };
}
