/**
 * Authoritative model-version comparison.
 *
 * Inputs are stored server-side GraphV3 snapshots. The client supplies only
 * opaque model_versions ids. This module never calls an LLM and never treats
 * analysis-run comparison (`ContentSafeRunDelta` / the wire `run_delta`) or
 * `what_changed` as a model-history diff.
 */

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { computeAnalysisAffectingHashRecord } from '../context/graph-identity.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import {
  MODEL_VERSION_DIFF_CATEGORIES,
  type ModelVersionDiffCategories,
  type ModelVersionDiffCategory,
  type ModelVersionDiffChangeKind,
  type ModelVersionDiffCoverage,
  type ModelVersionDiffEntityKind,
  type ModelVersionDiffItem,
  type ModelVersionRecord,
  type VersionComparison,
  type VersionDiffSummary,
} from './types.js';

/** Exact, reviewed limitation ledger. Tests pin additions and removals. */
export const KNOWN_UNDETECTABLE_MODEL_VERSION_CHANGES = Object.freeze([
  'conversation_or_discussion_not_committed_to_the_shared_graph',
  'private_contributions_not_revealed_into_the_shared_graph',
  'scenario_brief_text_outside_the_graph_version_snapshot',
] as const);

const MAX_DISPLAY_CHARS = 240;

const WHY: Readonly<Record<ModelVersionDiffCategory, string>> = {
  structure: 'Changes what the shared reasoning model contains.',
  relationships: 'Changes how elements of the reasoning model are connected.',
  values_uncertainty: 'Changes a value, assumption range, or uncertainty used by the model.',
  evidence_provenance: 'Changes the evidence or provenance supporting the shared reasoning.',
  goals_constraints_options: 'Changes the goals, constraints, or alternatives being considered.',
  assumptions_claims: 'Changes an expressed assumption, claim, label, or rationale.',
  presentation: 'Changes presentation only; it does not by itself change analysis freshness.',
  other_model_fields: 'The stored model changed in a field not yet given a product interpretation.',
};

export class ModelVersionDiffInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelVersionDiffInputError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function serialise(value: unknown): string {
  const encoded = stableStringify(value);
  return typeof encoded === 'string' ? encoded : 'undefined';
}

function display(value: unknown): string | null {
  if (value === undefined) return null;
  const encoded = serialise(value);
  return encoded.length <= MAX_DISPLAY_CHARS
    ? encoded
    : `${encoded.slice(0, MAX_DISPLAY_CHARS - 1)}…`;
}

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function emptyCategories(): Record<ModelVersionDiffCategory, ModelVersionDiffItem[]> {
  return {
    structure: [],
    relationships: [],
    values_uncertainty: [],
    evidence_provenance: [],
    goals_constraints_options: [],
    assumptions_claims: [],
    presentation: [],
    other_model_fields: [],
  };
}

interface ValidatedGraph {
  readonly raw: Record<string, unknown>;
  readonly nodes: Map<string, Record<string, unknown>>;
  readonly edges: Map<string, Record<string, unknown>>;
}

function stableEdgeIdentity(
  edge: Record<string, unknown>,
  side: 'from' | 'to',
  index: number,
): string {
  const from = edge.from;
  const to = edge.to;
  if (typeof from !== 'string' || from.length === 0 || typeof to !== 'string' || to.length === 0) {
    throw new ModelVersionDiffInputError(
      `${side} version has an edge without valid from/to at index ${index}`,
    );
  }

  const id = edge.id;
  if (typeof id === 'string' && id.length > 0) return id;

  // GraphV3 permits parallel connectors. A producer-supplied id is the
  // preferred authority; for older id-less rows, a connector type can still
  // distinguish two otherwise-equal endpoint pairs. Two id-less connectors
  // with the same endpoints and type remain ambiguous and fail closed below.
  const edgeType = edge.edge_type;
  return typeof edgeType === 'string' && edgeType.length > 0
    ? `${from}→${to}#${edgeType}`
    : `${from}→${to}`;
}

function validateGraph(graph: unknown, side: 'from' | 'to'): ValidatedGraph {
  const raw = asRecord(graph);
  if (raw === null || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new ModelVersionDiffInputError(`${side} version is not a GraphV3 object`);
  }

  const nodes = new Map<string, Record<string, unknown>>();
  for (const [index, candidate] of raw.nodes.entries()) {
    const node = asRecord(candidate);
    const id = node?.id;
    if (node === null || typeof id !== 'string' || id.length === 0) {
      throw new ModelVersionDiffInputError(`${side} version has a node without a stable id at index ${index}`);
    }
    if (nodes.has(id)) throw new ModelVersionDiffInputError(`${side} version has duplicate node id ${id}`);
    nodes.set(id, node);
  }

  const edges = new Map<string, Record<string, unknown>>();
  for (const [index, candidate] of raw.edges.entries()) {
    const edge = asRecord(candidate);
    if (edge === null) {
      throw new ModelVersionDiffInputError(`${side} version has a malformed edge at index ${index}`);
    }
    const key = stableEdgeIdentity(edge, side, index);
    if (edges.has(key)) throw new ModelVersionDiffInputError(`${side} version has duplicate edge identity ${key}`);
    const from = edge.from as string;
    const to = edge.to as string;
    if (!nodes.has(from) || !nodes.has(to)) {
      throw new ModelVersionDiffInputError(
        `${side} version edge ${key} references a missing node`,
      );
    }
    edges.set(key, edge);
  }

  for (const key of ['options', 'goal_constraints'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      throw new ModelVersionDiffInputError(`${side} version field ${key} is not an array`);
    }
  }

  return { raw, nodes, edges };
}

function identityEnvelopesMatch(a: ModelVersionRecord, b: ModelVersionRecord): boolean {
  return (
    a.identity_projection_version === b.identity_projection_version &&
    a.identity_normaliser_version === b.identity_normaliser_version &&
    a.graph_schema_version === b.graph_schema_version &&
    a.hash_algorithm === b.hash_algorithm
  );
}

function classify(path: string, entityKind: ModelVersionDiffEntityKind): ModelVersionDiffCategory {
  const lower = path.toLowerCase();
  if (
    /\/(position|positionabsolute|width|height|selected|dragging|style|classname|zindex|measured|layout)(\/|$)/.test(lower) ||
    /^\/(viewport|layout|selection|selected_elements)(\/|$)/.test(lower)
  ) return 'presentation';
  if (/^\/(options|goal_node_id|goal_constraints)(\/|$)/.test(lower) || entityKind === 'option' || entityKind === 'constraint') {
    return 'goals_constraints_options';
  }
  if (/\/(evidence|provenance|source|source_quote|citation|origin|elicited_from|extractiontype)(\/|$)/.test(lower)) {
    return 'evidence_provenance';
  }
  if (/\/(observed_state|strength|exists_probability|uncertainty|prior|distribution|interventions|confidence|std|range)(\/|$)/.test(lower)) {
    return 'values_uncertainty';
  }
  if (/\/(assumption|assumptions|causal_claim|causal_claims|claim|claims|rationale|validation|description|body|label)(\/|$)/.test(lower)) {
    return 'assumptions_claims';
  }
  if (entityKind === 'edge') return 'relationships';
  if (/\/(kind|from|to)(\/|$)/.test(lower)) return 'structure';
  return 'other_model_fields';
}

function fieldName(path: string): string {
  const last = path.split('/').filter(Boolean).at(-1) ?? 'model';
  return last.replaceAll('~1', '/').replaceAll('~0', '~').replaceAll('_', ' ');
}

function summaryFor(
  changeKind: ModelVersionDiffChangeKind,
  path: string,
  entityKind: ModelVersionDiffEntityKind,
  label: string | null,
): string {
  const subject = label ?? (entityKind === 'model' ? 'the model' : `this ${entityKind}`);
  if (changeKind === 'added') return `Added ${subject}`;
  if (changeKind === 'removed') return `Removed ${subject}`;
  return `Changed ${fieldName(path)} for ${subject}`;
}

interface DiffAccumulator {
  readonly categories: Record<ModelVersionDiffCategory, ModelVersionDiffItem[]>;
  readonly uninterpretedPaths: Set<string>;
}

function emitChange(
  accumulator: DiffAccumulator,
  args: {
    readonly path: string;
    readonly changeKind: ModelVersionDiffChangeKind;
    readonly entityKind: ModelVersionDiffEntityKind;
    readonly entityId: string | null;
    readonly label: string | null;
    readonly before: unknown;
    readonly after: unknown;
    readonly forcedCategory?: ModelVersionDiffCategory;
  },
): void {
  const category = args.forcedCategory ?? classify(args.path, args.entityKind);
  if (category === 'other_model_fields') accumulator.uninterpretedPaths.add(args.path);
  accumulator.categories[category].push({
    path: args.path,
    change_kind: args.changeKind,
    entity_kind: args.entityKind,
    entity_id: args.entityId,
    label: args.label,
    before_display: display(args.before),
    after_display: display(args.after),
    summary: summaryFor(args.changeKind, args.path, args.entityKind, args.label),
    why_it_matters: WHY[category],
  });
}

interface EntityContext {
  readonly kind: ModelVersionDiffEntityKind;
  readonly id: string | null;
  readonly label: string | null;
}

function diffValue(
  accumulator: DiffAccumulator,
  before: unknown,
  after: unknown,
  path: string,
  entity: EntityContext,
): void {
  if (serialise(before) === serialise(after)) return;
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);
  if (beforeRecord !== null && afterRecord !== null) {
    const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort();
    for (const key of keys) {
      diffValue(accumulator, beforeRecord[key], afterRecord[key], `${path}/${pointerSegment(key)}`, entity);
    }
    return;
  }
  const changeKind: ModelVersionDiffChangeKind =
    before === undefined ? 'added' : after === undefined ? 'removed' : 'changed';
  emitChange(accumulator, {
    path,
    changeKind,
    entityKind: entity.kind,
    entityId: entity.id,
    label: entity.label,
    before,
    after,
  });
}

function labelOf(record: Record<string, unknown> | undefined): string | null {
  return typeof record?.label === 'string' && record.label.length > 0 ? record.label : null;
}

function diffEntityMap(
  accumulator: DiffAccumulator,
  before: Map<string, Record<string, unknown>>,
  after: Map<string, Record<string, unknown>>,
  entityKind: 'node' | 'edge',
): void {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const key of keys) {
    const prior = before.get(key);
    const next = after.get(key);
    const path = `/${entityKind === 'node' ? 'nodes' : 'edges'}/${pointerSegment(key)}`;
    const label = labelOf(next) ?? labelOf(prior) ?? (entityKind === 'edge' ? key : null);
    if (prior === undefined || next === undefined) {
      emitChange(accumulator, {
        path,
        changeKind: prior === undefined ? 'added' : 'removed',
        entityKind,
        entityId: key,
        label,
        before: prior,
        after: next,
        forcedCategory: 'structure',
      });
      continue;
    }
    diffValue(accumulator, prior, next, path, { kind: entityKind, id: key, label });
  }
}

function collectionKey(
  value: unknown,
  side: string,
  name: 'options' | 'goal_constraints',
  index: number,
): string {
  const record = asRecord(value);
  if (record === null) {
    throw new ModelVersionDiffInputError(
      `${side} version has a malformed ${name} item at index ${index}`,
    );
  }
  const identityFields = name === 'goal_constraints'
    ? (['constraint_id'] as const)
    : (['id', 'option_id'] as const);
  for (const field of identityFields) {
    const candidate = record?.[field];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  throw new ModelVersionDiffInputError(
    `${side} version has a ${name} item without a stable identity at index ${index}`,
  );
}

function collectionMap(
  values: unknown[],
  side: string,
  name: 'options' | 'goal_constraints',
): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [index, value] of values.entries()) {
    const key = collectionKey(value, side, name, index);
    if (map.has(key)) throw new ModelVersionDiffInputError(`${side} version has duplicate ${name} identity ${key}`);
    map.set(key, value);
  }
  return map;
}

function diffCollection(
  accumulator: DiffAccumulator,
  beforeValues: unknown[],
  afterValues: unknown[],
  root: 'options' | 'goal_constraints',
  entityKind: 'option' | 'constraint',
): void {
  const before = collectionMap(beforeValues, 'from', root);
  const after = collectionMap(afterValues, 'to', root);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const key of keys) {
    const prior = before.get(key);
    const next = after.get(key);
    const path = `/${root}/${pointerSegment(key)}`;
    const label = labelOf(asRecord(next) ?? undefined) ?? labelOf(asRecord(prior) ?? undefined);
    if (prior === undefined || next === undefined) {
      emitChange(accumulator, {
        path,
        changeKind: prior === undefined ? 'added' : 'removed',
        entityKind,
        entityId: key,
        label,
        before: prior,
        after: next,
        forcedCategory: 'goals_constraints_options',
      });
    } else {
      diffValue(accumulator, prior, next, path, { kind: entityKind, id: key, label });
    }
  }
}

function sortCategories(categories: Record<ModelVersionDiffCategory, ModelVersionDiffItem[]>): void {
  for (const category of MODEL_VERSION_DIFF_CATEGORIES) {
    categories[category].sort((a, b) => {
      const ak = JSON.stringify([a.path, a.change_kind, a.entity_kind, a.entity_id]);
      const bk = JSON.stringify([b.path, b.change_kind, b.entity_kind, b.entity_id]);
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });
  }
}

function detailedDiff(from: ValidatedGraph, to: ValidatedGraph): {
  readonly categories: ModelVersionDiffCategories;
  readonly coverage: ModelVersionDiffCoverage;
} {
  const categories = emptyCategories();
  const accumulator: DiffAccumulator = { categories, uninterpretedPaths: new Set() };
  diffEntityMap(accumulator, from.nodes, to.nodes, 'node');
  diffEntityMap(accumulator, from.edges, to.edges, 'edge');
  diffCollection(accumulator, Array.isArray(from.raw.options) ? from.raw.options : [], Array.isArray(to.raw.options) ? to.raw.options : [], 'options', 'option');
  diffCollection(accumulator, Array.isArray(from.raw.goal_constraints) ? from.raw.goal_constraints : [], Array.isArray(to.raw.goal_constraints) ? to.raw.goal_constraints : [], 'goal_constraints', 'constraint');

  const excluded = new Set(['nodes', 'edges', 'options', 'goal_constraints']);
  const rootKeys = [...new Set([...Object.keys(from.raw), ...Object.keys(to.raw)])]
    .filter((key) => !excluded.has(key))
    .sort();
  for (const key of rootKeys) {
    diffValue(accumulator, from.raw[key], to.raw[key], `/${pointerSegment(key)}`, {
      kind: 'model',
      id: null,
      label: null,
    });
  }

  sortCategories(categories);
  return {
    categories,
    coverage: {
      known_undetectable: [...KNOWN_UNDETECTABLE_MODEL_VERSION_CHANGES],
      known_uninterpreted_paths: [...accumulator.uninterpretedPaths].sort(),
    },
  };
}

function emptyDetailedDiff(): {
  readonly categories: ModelVersionDiffCategories;
  readonly coverage: ModelVersionDiffCoverage;
} {
  return {
    categories: emptyCategories(),
    coverage: {
      known_undetectable: [...KNOWN_UNDETECTABLE_MODEL_VERSION_CHANGES],
      known_uninterpreted_paths: [],
    },
  };
}

function legacyArrayField(graph: unknown, key: 'nodes' | 'edges'): readonly unknown[] {
  const record = asRecord(graph);
  return Array.isArray(record?.[key]) ? record[key] : [];
}

function legacyKey(value: unknown, kind: 'node' | 'edge'): string {
  const record = asRecord(value);
  if (kind === 'node') return typeof record?.id === 'string' ? `id:${record.id}` : `raw:${serialise(value)}`;
  if (typeof record?.id === 'string') return `id:${record.id}`;
  return typeof record?.from === 'string' && typeof record?.to === 'string'
    ? `ft:${record.from}→${record.to}`
    : `raw:${serialise(value)}`;
}

function legacyCounts(before: readonly unknown[], after: readonly unknown[], kind: 'node' | 'edge') {
  const prior = new Map(before.map((entry) => [legacyKey(entry, kind), serialise(entry)]));
  const next = new Map(after.map((entry) => [legacyKey(entry, kind), serialise(entry)]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [key, value] of next) {
    const old = prior.get(key);
    if (old === undefined) added += 1;
    else if (old !== value) changed += 1;
  }
  for (const key of prior.keys()) if (!next.has(key)) removed += 1;
  return { added, removed, changed };
}

/** Compatibility count summary retained for internal callers and telemetry. */
export function summariseGraphDiff(before: unknown, after: unknown): VersionDiffSummary {
  const nodes = legacyCounts(legacyArrayField(before, 'nodes'), legacyArrayField(after, 'nodes'), 'node');
  const edges = legacyCounts(legacyArrayField(before, 'edges'), legacyArrayField(after, 'edges'), 'edge');
  return {
    nodes_added: nodes.added,
    nodes_removed: nodes.removed,
    nodes_changed: nodes.changed,
    edges_added: edges.added,
    edges_removed: edges.removed,
    edges_changed: edges.changed,
  };
}

/** Compare two persisted versions in the direction `from` to `to`. */
export function compareVersionRecords(from: ModelVersionRecord, to: ModelVersionRecord): VersionComparison {
  const fromGraph = validateGraph(from.graph, 'from');
  const toGraph = validateGraph(to.graph, 'to');
  if (from.graph_identity_hash === to.graph_identity_hash && identityEnvelopesMatch(from, to)) {
    return {
      relation: 'identical',
      short_circuit: true,
      from_version_id: from.id,
      to_version_id: to.id,
      from_full_hash: from.graph_identity_hash,
      to_full_hash: to.graph_identity_hash,
      analysis_equivalent: true,
      ...emptyDetailedDiff(),
    };
  }

  const fromAnalysis = computeAnalysisAffectingHashRecord(from.graph as GraphStateIngress);
  const toAnalysis = computeAnalysisAffectingHashRecord(to.graph as GraphStateIngress);
  const analysisEquivalent =
    fromAnalysis === null && toAnalysis === null
      ? true
      : fromAnalysis !== null && toAnalysis !== null && fromAnalysis.value === toAnalysis.value;

  return {
    relation: 'different',
    short_circuit: false,
    from_version_id: from.id,
    to_version_id: to.id,
    from_full_hash: from.graph_identity_hash,
    to_full_hash: to.graph_identity_hash,
    analysis_equivalent: analysisEquivalent,
    ...detailedDiff(fromGraph, toGraph),
    diff: summariseGraphDiff(from.graph, to.graph),
  };
}
