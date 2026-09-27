import {
  ARTEFACT_SCHEMA_VERSION, binding, canonicalJson, contentHash, dependency, fail, keys, list, own,
  parseImplication, provenance, record, str, unique,
  type ArtefactBinding, type ModelLinkage, type ProposedImplication, type Provenance,
  type SourceState, type SourceStatus,
} from './common.js';

/** Internal F2b structure. Source access, entailment and model identity remain host decisions. */
export const EVIDENCE_MAP_VERSION = 'evidence_assumption_map/1';

export interface SourceRef {
  readonly source_id: string;
  readonly source_version: string;
}

export type ClaimStatus = 'fact' | 'assumption' | 'hypothesis' | 'unknown';
export type EvidenceRelationshipKind = 'supports' | 'challenges' | 'mixed' | 'unclear';

export interface Claim {
  readonly kind: 'claim';
  readonly id: string;
  readonly text: string;
  readonly epistemic_status: ClaimStatus;
  readonly provenance: Provenance;
  readonly source_refs: readonly SourceRef[];
  readonly linked_element_ids: readonly string[];
}

export interface EvidenceItem {
  readonly kind: 'evidence_item';
  readonly id: string;
  readonly text: string;
  readonly provenance: 'source_evidence';
  readonly source_ref: SourceRef;
  readonly linked_element_ids: readonly string[];
}

export type EvidenceMapItem = Claim | EvidenceItem;

export interface EvidenceRelationship {
  readonly claim_id: string;
  readonly evidence_item_id: string;
  readonly relationship: EvidenceRelationshipKind;
}

export interface ClaimContradiction {
  readonly left_claim_id: string;
  readonly right_claim_id: string;
}

export interface EvidenceMapInput {
  readonly items: readonly EvidenceMapItem[];
  readonly relationships: readonly EvidenceRelationship[];
  readonly contradictions: readonly ClaimContradiction[];
  readonly proposed_implications: readonly ProposedImplication[];
}

/** A request-bound host projects these verdicts from its existing owners. No source or fact authority is minted here. */
export interface EvidenceMapHost {
  readonly scenario_id: string;
  readonly graph_revision: string;
  readonly source_statuses: readonly SourceStatus[];
  /** Host-attested content dependencies. Input source refs alone cannot prove safe separation. */
  readonly item_source_bindings: readonly {
    readonly item_id: string;
    /** SHA-256 of the authoritative item's canonical content, excluding model links. */
    readonly item_content_hash: string;
    readonly source_refs: readonly SourceRef[];
  }[];
  /** The implication payload remains non-executable; source/content authority is separate and host owned. */
  readonly implication_source_bindings: readonly {
    readonly implication_index: number;
    readonly implication_content_hash: string;
    readonly source_refs: readonly SourceRef[];
  }[];
  /** Relevance is a host verdict about this item's relation to its linked elements. */
  readonly item_model_bindings: readonly {
    readonly item_id: string;
    readonly item_content_hash: string;
    readonly linked_element_ids: readonly string[];
    readonly linkage: ModelLinkage;
  }[];
  readonly model_elements: readonly {
    readonly element_id: string;
    readonly fingerprint: string;
    readonly linkage: 'current' | 'stale';
  }[];
  readonly fact_verdicts: readonly {
    readonly claim_id: string;
    readonly claim_content_hash: string;
    readonly supported: boolean;
    readonly basis_ref: string | null;
  }[];
}

/** Saved internally. Consumers must use presentEvidenceAssumptionMap with a fresh host snapshot. */
export interface EvidenceAssumptionMapArtefact {
  readonly kind: 'evidence_assumption_map';
  readonly schema_version: typeof ARTEFACT_SCHEMA_VERSION;
  readonly calculation_version: typeof EVIDENCE_MAP_VERSION;
  readonly canonical_input_hash: string;
  readonly binding: ArtefactBinding;
  readonly canonical_inputs: { readonly input: EvidenceMapInput; readonly host: EvidenceMapHost };
}

export interface EvidenceMapPresentation {
  readonly kind: 'evidence_assumption_map';
  readonly state: 'current_subject' | 'invalid_subject';
  readonly source_states: readonly { readonly source_id: string; readonly bound_version: string; readonly state: SourceState }[];
  readonly items: readonly (EvidenceMapItem & { readonly model_linkage: ModelLinkage })[];
  readonly withheld_item_ids: readonly string[];
  readonly withheld_items: readonly { readonly id: string; readonly source_states: readonly {
    readonly source_id: string; readonly state: SourceState;
  }[]; readonly model_linkage: ModelLinkage }[];
  readonly relationships: readonly EvidenceRelationship[];
  readonly contradictions: readonly ClaimContradiction[];
  readonly proposed_implications: readonly ProposedImplication[];
  readonly withheld_implication_indexes: readonly number[];
}

function parseSourceRef(raw: unknown): SourceRef {
  const s = record(raw);
  keys(s, ['source_id', 'source_version']);
  return { source_id: str(own(s, 'source_id'), 200), source_version: str(own(s, 'source_version'), 200) };
}

const sourceRefKey = (ref: SourceRef): string => JSON.stringify([ref.source_id, ref.source_version]);
const sortedRefs = (refs: readonly SourceRef[]): SourceRef[] => [...refs].sort((a, b) =>
  a.source_id.localeCompare(b.source_id) || a.source_version.localeCompare(b.source_version));

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail('invalid_content_hash');
  return value;
}

/** A host must compute this from its authoritative item, not echo a caller's submitted value. */
function itemContentHash(item: EvidenceMapItem): string {
  return item.kind === 'claim'
    ? contentHash({ kind: item.kind, id: item.id, text: item.text, epistemic_status: item.epistemic_status,
      provenance: item.provenance, source_refs: item.source_refs })
    : contentHash({ kind: item.kind, id: item.id, text: item.text, provenance: item.provenance,
      source_ref: item.source_ref });
}

function parseLinks(raw: unknown): readonly string[] {
  const linked_element_ids = list(raw).map((id) => str(id, 160));
  unique(linked_element_ids, 'duplicate_model_link');
  return [...linked_element_ids].sort();
}

function parseItem(raw: unknown): EvidenceMapItem {
  const r = record(raw);
  const kind = own(r, 'kind');
  if (kind === 'claim') {
    keys(r, ['kind', 'id', 'text', 'epistemic_status', 'provenance', 'source_refs', 'linked_element_ids']);
    const epistemic_status = own(r, 'epistemic_status');
    if (epistemic_status !== 'fact' && epistemic_status !== 'assumption'
      && epistemic_status !== 'hypothesis' && epistemic_status !== 'unknown') fail('invalid_claim_status');
    const source_refs = sortedRefs(list(own(r, 'source_refs')).map(parseSourceRef));
    unique(source_refs.map((s) => s.source_id), 'duplicate_claim_source');
    const source = provenance(own(r, 'provenance'));
    if (source === 'source_evidence' && source_refs.length === 0) fail('sourced_claim_without_source');
    if (epistemic_status === 'fact' && source === 'olumi_hypothesis') fail('hypothesis_as_fact');
    return {
      kind, id: str(own(r, 'id'), 120), text: str(own(r, 'text'), 600), epistemic_status,
      provenance: source, source_refs, linked_element_ids: parseLinks(own(r, 'linked_element_ids')),
    };
  }
  if (kind === 'evidence_item') {
    keys(r, ['kind', 'id', 'text', 'provenance', 'source_ref', 'linked_element_ids']);
    if (own(r, 'provenance') !== 'source_evidence') fail('invalid_evidence_origin');
    return {
      kind, id: str(own(r, 'id'), 120), text: str(own(r, 'text'), 600), provenance: 'source_evidence',
      source_ref: parseSourceRef(own(r, 'source_ref')),
      linked_element_ids: parseLinks(own(r, 'linked_element_ids')),
    };
  }
  return fail('invalid_item_kind');
}

function parseInput(raw: unknown): EvidenceMapInput {
  const r = record(raw);
  keys(r, ['items', 'relationships', 'contradictions', 'proposed_implications']);
  const items = list(own(r, 'items')).map(parseItem);
  if (items.length === 0) fail('missing_items');
  unique(items.map((item) => item.id), 'duplicate_item');
  const claims = new Set(items.filter((item): item is Claim => item.kind === 'claim').map((item) => item.id));
  const evidence = new Set(items.filter((item): item is EvidenceItem => item.kind === 'evidence_item').map((item) => item.id));
  const relationships = list(own(r, 'relationships')).map((rawRelationship) => {
    const x = record(rawRelationship);
    keys(x, ['claim_id', 'evidence_item_id', 'relationship']);
    const claim_id = str(own(x, 'claim_id'), 120);
    const evidence_item_id = str(own(x, 'evidence_item_id'), 120);
    if (!claims.has(claim_id) || !evidence.has(evidence_item_id)) fail('unknown_relationship_identity');
    const relationship = own(x, 'relationship') as EvidenceRelationshipKind;
    if (relationship !== 'supports' && relationship !== 'challenges'
      && relationship !== 'mixed' && relationship !== 'unclear') fail('invalid_evidence_relationship');
    return { claim_id, evidence_item_id, relationship };
  });
  unique(relationships.map((x) => JSON.stringify([x.claim_id, x.evidence_item_id])), 'duplicate_relationship');
  const contradictions = list(own(r, 'contradictions')).map((rawContradiction) => {
    const x = record(rawContradiction);
    keys(x, ['left_claim_id', 'right_claim_id']);
    const left_claim_id = str(own(x, 'left_claim_id'), 120);
    const right_claim_id = str(own(x, 'right_claim_id'), 120);
    if (left_claim_id === right_claim_id || !claims.has(left_claim_id) || !claims.has(right_claim_id)) {
      fail('invalid_contradiction_identity');
    }
    return { left_claim_id, right_claim_id };
  });
  unique(contradictions.map((x) => JSON.stringify([x.left_claim_id, x.right_claim_id].sort())),
    'duplicate_contradiction');
  const proposed_implications = list(own(r, 'proposed_implications')).map(parseImplication);
  return { items, relationships, contradictions, proposed_implications };
}

function parseHost(raw: unknown): EvidenceMapHost {
  const r = record(raw);
  keys(r, ['scenario_id', 'graph_revision', 'source_statuses', 'item_source_bindings',
    'implication_source_bindings', 'item_model_bindings', 'model_elements', 'fact_verdicts']);
  const source_statuses = list(own(r, 'source_statuses')).map((rawStatus) => {
    const s = record(rawStatus);
    keys(s, ['source_id', 'source_version', 'state']);
    const state = own(s, 'state') as SourceState;
    if (state !== 'current' && state !== 'changed' && state !== 'revoked' && state !== 'unavailable') {
      fail('invalid_source_state');
    }
    const version = own(s, 'source_version');
    const source_version = version === null ? null : str(version, 200);
    if (state === 'current' && source_version === null) fail('current_source_without_version');
    return { source_id: str(own(s, 'source_id'), 200), source_version, state };
  });
  unique(source_statuses.map((s) => s.source_id), 'duplicate_source_status');
  const item_source_bindings = list(own(r, 'item_source_bindings')).map((rawBinding) => {
    const b = record(rawBinding);
    keys(b, ['item_id', 'item_content_hash', 'source_refs']);
    const source_refs = sortedRefs(list(own(b, 'source_refs')).map(parseSourceRef));
    unique(source_refs.map((ref) => ref.source_id), 'duplicate_item_source');
    return { item_id: str(own(b, 'item_id'), 120), item_content_hash: sha256(own(b, 'item_content_hash')),
      source_refs };
  });
  unique(item_source_bindings.map((b) => b.item_id), 'duplicate_item_source_binding');
  const implication_source_bindings = list(own(r, 'implication_source_bindings')).map((rawBinding) => {
    const b = record(rawBinding);
    keys(b, ['implication_index', 'implication_content_hash', 'source_refs']);
    const index = own(b, 'implication_index');
    if (!Number.isSafeInteger(index) || (index as number) < 0) fail('invalid_implication_index');
    const source_refs = sortedRefs(list(own(b, 'source_refs')).map(parseSourceRef));
    unique(source_refs.map((ref) => ref.source_id), 'duplicate_implication_source');
    return { implication_index: index as number,
      implication_content_hash: sha256(own(b, 'implication_content_hash')), source_refs };
  });
  unique(implication_source_bindings.map((b) => String(b.implication_index)), 'duplicate_implication_binding');
  const item_model_bindings = list(own(r, 'item_model_bindings')).map((rawBinding) => {
    const b = record(rawBinding);
    keys(b, ['item_id', 'item_content_hash', 'linked_element_ids', 'linkage']);
    const linkage = own(b, 'linkage') as ModelLinkage;
    if (linkage !== 'current' && linkage !== 'stale' && linkage !== 'not_applicable') {
      fail('invalid_model_linkage');
    }
    return { item_id: str(own(b, 'item_id'), 120), item_content_hash: sha256(own(b, 'item_content_hash')),
      linked_element_ids: parseLinks(own(b, 'linked_element_ids')), linkage };
  });
  unique(item_model_bindings.map((b) => b.item_id), 'duplicate_item_model_binding');
  const model_elements = list(own(r, 'model_elements')).map((rawElement) => {
    const m = record(rawElement);
    keys(m, ['element_id', 'fingerprint', 'linkage']);
    const linkage = own(m, 'linkage') as 'current' | 'stale';
    if (linkage !== 'current' && linkage !== 'stale') fail('invalid_model_linkage');
    return { element_id: str(own(m, 'element_id'), 160), fingerprint: str(own(m, 'fingerprint'), 200), linkage };
  });
  unique(model_elements.map((m) => m.element_id), 'duplicate_model_element');
  const fact_verdicts = list(own(r, 'fact_verdicts')).map((rawVerdict) => {
    const v = record(rawVerdict);
    keys(v, ['claim_id', 'claim_content_hash', 'supported', 'basis_ref']);
    const supported = own(v, 'supported');
    if (typeof supported !== 'boolean') fail('invalid_fact_verdict');
    const rawBasis = own(v, 'basis_ref');
    const basis_ref = rawBasis === null ? null : str(rawBasis, 240);
    if ((supported && basis_ref === null) || (!supported && basis_ref !== null)) fail('invalid_fact_basis');
    return { claim_id: str(own(v, 'claim_id'), 120), claim_content_hash: sha256(own(v, 'claim_content_hash')),
      supported, basis_ref };
  });
  unique(fact_verdicts.map((v) => v.claim_id), 'duplicate_fact_verdict');
  return {
    scenario_id: str(own(r, 'scenario_id'), 160), graph_revision: str(own(r, 'graph_revision'), 160),
    source_statuses: [...source_statuses].sort((a, b) => a.source_id.localeCompare(b.source_id)),
    item_source_bindings: [...item_source_bindings].sort((a, b) => a.item_id.localeCompare(b.item_id)),
    implication_source_bindings: [...implication_source_bindings]
      .sort((a, b) => a.implication_index - b.implication_index),
    item_model_bindings: [...item_model_bindings].sort((a, b) => a.item_id.localeCompare(b.item_id)),
    model_elements: [...model_elements].sort((a, b) => a.element_id.localeCompare(b.element_id)),
    fact_verdicts: [...fact_verdicts].sort((a, b) => a.claim_id.localeCompare(b.claim_id)),
  };
}

function refsOf(
  itemBindings: EvidenceMapHost['item_source_bindings'],
  implicationBindings: EvidenceMapHost['implication_source_bindings'],
): SourceRef[] {
  const refs = [...itemBindings.flatMap((item) => item.source_refs),
    ...implicationBindings.flatMap((implication) => implication.source_refs)];
  const versions = new Map<string, string>();
  for (const ref of refs) {
    const previous = versions.get(ref.source_id);
    if (previous !== undefined && previous !== ref.source_version) fail('conflicting_source_versions');
    versions.set(ref.source_id, ref.source_version);
  }
  return [...versions].sort(([a], [b]) => a.localeCompare(b))
    .map(([source_id, source_version]) => ({ source_id, source_version }));
}

function consumedHost(input: EvidenceMapInput, host: EvidenceMapHost): EvidenceMapHost {
  const itemIds = new Set(input.items.map((item) => item.id));
  const item_source_bindings = host.item_source_bindings.filter((item) => itemIds.has(item.item_id));
  if (item_source_bindings.length !== input.items.length) fail('missing_item_source_binding');
  const item_model_bindings = host.item_model_bindings.filter((item) => itemIds.has(item.item_id));
  if (item_model_bindings.length !== input.items.length) fail('missing_item_model_binding');
  const byItem = new Map(item_source_bindings.map((item) => [item.item_id, item]));
  const byModelItem = new Map(item_model_bindings.map((item) => [item.item_id, item]));
  const evidenceById = new Map(input.items.filter((item): item is EvidenceItem => item.kind === 'evidence_item')
    .map((item) => [item.id, item]));
  for (const item of input.items) {
    const itemHash = itemContentHash(item);
    const sourceBinding = byItem.get(item.id);
    if (sourceBinding?.item_content_hash !== itemHash) fail('item_content_mismatch');
    const modelBinding = byModelItem.get(item.id);
    if (modelBinding?.item_content_hash !== itemHash
      || canonicalJson(modelBinding.linked_element_ids) !== canonicalJson(item.linked_element_ids)
      || (item.linked_element_ids.length === 0) !== (modelBinding.linkage === 'not_applicable')) {
      fail('item_model_binding_mismatch');
    }
    const declared = item.kind === 'evidence_item' ? [item.source_ref] : item.source_refs;
    const related = item.kind === 'claim' ? input.relationships.filter((r) => r.claim_id === item.id)
      .map((r) => evidenceById.get(r.evidence_item_id)!.source_ref) : [];
    const witnessed = new Set(sourceBinding.source_refs.map(sourceRefKey));
    if (![...declared, ...related].every((ref) => witnessed.has(sourceRefKey(ref)))) {
      fail('incomplete_item_source_binding');
    }
  }
  const implication_source_bindings = host.implication_source_bindings
    .filter((witness) => witness.implication_index < input.proposed_implications.length);
  if (implication_source_bindings.length !== input.proposed_implications.length) {
    fail('missing_implication_binding');
  }
  for (const [index, implication] of input.proposed_implications.entries()) {
    if (implication_source_bindings[index]?.implication_index !== index
      || implication_source_bindings[index]?.implication_content_hash !== contentHash(implication)) {
      fail('implication_content_mismatch');
    }
  }
  const sources = new Set(refsOf(item_source_bindings, implication_source_bindings).map((ref) => ref.source_id));
  const links = new Set([
    ...input.items.flatMap((item) => item.linked_element_ids),
    ...input.proposed_implications.flatMap((implication) => implication.linked_element_ids),
  ]);
  const facts = new Set(input.items.filter((item): item is Claim => item.kind === 'claim' && item.epistemic_status === 'fact')
    .map((item) => item.id));
  const model_elements = host.model_elements.filter((element) => links.has(element.element_id));
  if (model_elements.length !== links.size) fail('unknown_model_link');
  const fact_verdicts = host.fact_verdicts.filter((verdict) => facts.has(verdict.claim_id));
  if (fact_verdicts.length !== facts.size || fact_verdicts.some((verdict) => !verdict.supported)) {
    fail('unsupported_fact');
  }
  const claims = new Map(input.items.filter((item): item is Claim => item.kind === 'claim').map((item) => [item.id, item]));
  if (fact_verdicts.some((verdict) => verdict.claim_content_hash !== itemContentHash(claims.get(verdict.claim_id)!))) {
    fail('fact_content_mismatch');
  }
  return {
    scenario_id: host.scenario_id, graph_revision: host.graph_revision,
    source_statuses: host.source_statuses.filter((status) => sources.has(status.source_id)),
    item_source_bindings, implication_source_bindings, item_model_bindings, model_elements, fact_verdicts,
  };
}

export function createEvidenceAssumptionMap(rawInput: unknown, rawHost: unknown): EvidenceAssumptionMapArtefact {
  const input = parseInput(rawInput);
  const host = consumedHost(input, parseHost(rawHost));
  const sourceRefs = refsOf(host.item_source_bindings, host.implication_source_bindings);
  const sourceStatus = new Map(host.source_statuses.map((status) => [status.source_id, status]));
  const dependencies = [
    dependency('map_structure', 'evidence_assumption_map', {
      relationships: input.relationships, contradictions: input.contradictions,
      proposed_implications: input.proposed_implications,
      item_source_bindings: host.item_source_bindings,
      implication_source_bindings: host.implication_source_bindings,
      item_model_bindings: host.item_model_bindings,
    }),
    ...input.items.map((item) => dependency('claim', item.id, item)),
    ...sourceRefs.map((ref) => dependency('source', ref.source_id, {
      bound_version: ref.source_version, current_status: sourceStatus.get(ref.source_id) ?? null,
    })),
    ...host.model_elements.map((element) => dependency('model_element', element.element_id, element)),
    ...host.fact_verdicts.map((verdict) => dependency('fact_verdict', verdict.claim_id, verdict)),
  ];
  const canonical_inputs = { input, host };
  const { graph_revision: _historicalRevision, ...consumed } = host;
  return {
    kind: 'evidence_assumption_map', schema_version: ARTEFACT_SCHEMA_VERSION,
    calculation_version: EVIDENCE_MAP_VERSION,
    canonical_input_hash: contentHash({ input, host: consumed }),
    binding: binding(host.scenario_id, host.graph_revision, dependencies), canonical_inputs,
  };
}

/** Strict revalidation of the internal saved envelope; it does not make contents safe to present. */
export function validateEvidenceAssumptionMap(raw: unknown): EvidenceAssumptionMapArtefact {
  const r = record(raw);
  keys(r, ['kind', 'schema_version', 'calculation_version', 'canonical_input_hash', 'binding', 'canonical_inputs']);
  if (own(r, 'kind') !== 'evidence_assumption_map') fail('invalid_artefact_kind');
  const snapshot = record(own(r, 'canonical_inputs'));
  keys(snapshot, ['input', 'host']);
  const recreated = createEvidenceAssumptionMap(own(snapshot, 'input'), own(snapshot, 'host'));
  if (canonicalJson(r) !== canonicalJson(recreated)) fail('artefact_revalidation_failed');
  return recreated;
}

function effectiveSourceState(ref: SourceRef, current: ReadonlyMap<string, SourceStatus>): SourceState {
  const status = current.get(ref.source_id);
  if (status === undefined) return 'unavailable';
  if (status.state !== 'current') return status.state;
  return status.source_version === ref.source_version ? 'current' : 'changed';
}

/** Current-use projection: validate historical bytes first, then check fresh host status before returning any text. */
export function presentEvidenceAssumptionMap(raw: unknown, rawCurrentHost: unknown): EvidenceMapPresentation {
  const saved = validateEvidenceAssumptionMap(raw);
  const current = parseHost(rawCurrentHost);
  if (current.scenario_id !== saved.binding.scenario_id) {
    return { kind: 'evidence_assumption_map', state: 'invalid_subject', source_states: [], items: [],
      withheld_item_ids: [], withheld_items: [], relationships: [], contradictions: [], proposed_implications: [],
      withheld_implication_indexes: [] };
  }
  const { input, host: historical } = saved.canonical_inputs;
  const sources = refsOf(historical.item_source_bindings, historical.implication_source_bindings);
  const currentSources = new Map(current.source_statuses.map((status) => [status.source_id, status]));
  const source_states = sources.map((ref) => ({ source_id: ref.source_id, bound_version: ref.source_version,
    state: effectiveSourceState(ref, currentSources) }));
  const sourceStates = new Map(source_states.map((status) => [status.source_id, status.state]));
  const historicalItemSources = new Map(historical.item_source_bindings.map((item) => [item.item_id, item]));
  const currentItemSources = new Map(current.item_source_bindings.map((item) => [item.item_id, item]));
  const historicalItemModels = new Map(historical.item_model_bindings.map((item) => [item.item_id, item]));
  const currentItemModels = new Map(current.item_model_bindings.map((item) => [item.item_id, item]));
  const historicalModel = new Map(historical.model_elements.map((element) => [element.element_id, element]));
  const currentModel = new Map(current.model_elements.map((element) => [element.element_id, element]));
  const historicalFacts = new Map(historical.fact_verdicts.map((verdict) => [verdict.claim_id, verdict]));
  const currentFacts = new Map(current.fact_verdicts.map((verdict) => [verdict.claim_id, verdict]));
  const withheld_item_ids: string[] = [];
  const withheld_items: EvidenceMapPresentation['withheld_items'][number][] = [];
  const items: (EvidenceMapItem & { model_linkage: ModelLinkage })[] = [];
  for (const item of input.items) {
    const historicalWitness = historicalItemSources.get(item.id);
    const refs = historicalWitness?.source_refs ?? [];
    const currentWitness = currentItemSources.get(item.id);
    const separationCurrent = currentWitness !== undefined
      && currentWitness.item_content_hash === historicalWitness?.item_content_hash
      && canonicalJson(currentWitness.source_refs) === canonicalJson(refs);
    const relatedContentCurrent = item.kind !== 'claim' || input.relationships
      .filter((r) => r.claim_id === item.id).every((relationship) => {
        const oldEvidence = historicalItemSources.get(relationship.evidence_item_id);
        const nowEvidence = currentItemSources.get(relationship.evidence_item_id);
        return oldEvidence !== undefined && nowEvidence !== undefined
          && nowEvidence.item_content_hash === oldEvidence.item_content_hash
          && canonicalJson(nowEvidence.source_refs) === canonicalJson(oldEvidence.source_refs);
      });
    const sourceCurrent = separationCurrent && refs.every((ref) => sourceStates.get(ref.source_id) === 'current');
    const oldFact = item.kind === 'claim' && item.epistemic_status === 'fact' ? historicalFacts.get(item.id) : undefined;
    const nowFact = item.kind === 'claim' && item.epistemic_status === 'fact' ? currentFacts.get(item.id) : undefined;
    const factCurrent = oldFact === undefined || (nowFact?.supported === true && nowFact.basis_ref === oldFact.basis_ref
      && nowFact.claim_content_hash === oldFact.claim_content_hash);
    const oldItemModel = historicalItemModels.get(item.id);
    const nowItemModel = currentItemModels.get(item.id);
    const itemRelevanceCurrent = oldItemModel !== undefined && nowItemModel !== undefined
      && oldItemModel.item_content_hash === nowItemModel.item_content_hash
      && canonicalJson(oldItemModel.linked_element_ids) === canonicalJson(nowItemModel.linked_element_ids);
    const model_linkage: ModelLinkage = item.linked_element_ids.length === 0 ? 'not_applicable'
      : itemRelevanceCurrent && oldItemModel.linkage === 'current' && nowItemModel.linkage === 'current'
        && item.linked_element_ids.every((id) => {
        const before = historicalModel.get(id);
        const now = currentModel.get(id);
        return before?.linkage === 'current' && now !== undefined && now.linkage === 'current'
          && now.fingerprint === before.fingerprint;
      }) ? 'current' : 'stale';
    if (!sourceCurrent || !relatedContentCurrent || !factCurrent) {
      withheld_item_ids.push(item.id);
      withheld_items.push({ id: item.id, model_linkage,
        source_states: refs.map((ref) => ({ source_id: ref.source_id,
          state: sourceStates.get(ref.source_id) ?? 'unavailable' })) });
      continue;
    }
    items.push({ ...item, model_linkage });
  }
  const visible = new Set(items.map((item) => item.id));
  const modelLinksCurrent = (ids: readonly string[]): boolean => ids.every((id) => {
    const before = historicalModel.get(id);
    const now = currentModel.get(id);
    return before?.linkage === 'current' && now !== undefined && now.linkage === 'current'
      && now.fingerprint === before.fingerprint;
  });
  const currentImplications = new Map(current.implication_source_bindings
    .map((witness) => [witness.implication_index, witness]));
  const proposed_implications: ProposedImplication[] = [];
  const withheld_implication_indexes: number[] = [];
  for (const [index, implication] of input.proposed_implications.entries()) {
    const previous = historical.implication_source_bindings[index];
    const now = currentImplications.get(index);
    const witnessCurrent = previous !== undefined && now !== undefined
      && now.implication_content_hash === previous.implication_content_hash
      && canonicalJson(now.source_refs) === canonicalJson(previous.source_refs);
    const sourcesCurrent = previous?.source_refs.every((ref) => sourceStates.get(ref.source_id) === 'current') ?? false;
    if (withheld_item_ids.length === 0 && witnessCurrent && sourcesCurrent
      && modelLinksCurrent(implication.linked_element_ids)) proposed_implications.push(implication);
    else withheld_implication_indexes.push(index);
  }
  return {
    kind: 'evidence_assumption_map', state: 'current_subject', source_states, items, withheld_item_ids, withheld_items,
    relationships: input.relationships.filter((r) => visible.has(r.claim_id) && visible.has(r.evidence_item_id)),
    contradictions: input.contradictions.filter((c) => visible.has(c.left_claim_id) && visible.has(c.right_claim_id)),
    proposed_implications, withheld_implication_indexes,
  };
}
