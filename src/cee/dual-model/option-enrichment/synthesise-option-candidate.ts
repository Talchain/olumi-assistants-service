/**
 * Executable-option candidate synthesis (quarantined scaffold — not imported
 * by any live path).
 *
 * WHAT THIS IS: the deterministic, value-provenance-preserving half of
 * "executable option enrichment" — turning a D1-deferred added_option
 * artifact plus a CALLER-SUPPLIED intervention value mapping into a
 * candidate option node + OptionV3 entry, validated against the CURRENT
 * contract (src/schemas/cee-v3.ts, imported — never re-created).
 *
 * WHAT THIS IS NOT: a merge path. The current seam BLOCKS injecting the
 * candidate by design — G12(i) optionSurfaceUnchanged byte-freezes the
 * option surface, D1 defers every added_option, and edge_endpoint_restricted
 * closes option endpoints. __tests__/frozen-seam-readiness-proof.test.ts
 * PROVES those guards reject this module's output today; relaxing them is a
 * seam-change decision for Paul (Docs/v6/handoff-option-surface-seam.md).
 *
 * VALUE PROVENANCE RULE (D1's core, preserved): this module NEVER invents
 * intervention values. An empty mapping yields validation.ok === false with
 * issue 'no_intervention_values_supplied' — there is no default, no
 * inference, no fallback. Values arrive from user/operator input only, and
 * are stamped source: 'user_specified'.
 */
import {
  NodeV3,
  OptionV3,
  type GraphV3T,
  type NodeV3T,
  type OptionV3T,
  type InterventionV3T,
} from '../../../schemas/cee-v3.js';

/** Caller-supplied intervention values per factor id. Never invented here. */
export interface ValueMapping {
  readonly [factorId: string]: {
    /** Normalised numeric value (0–1 model scale) — PLoT-compatible. */
    readonly value: number;
    /** Original value before encoding, when the operator supplied one. */
    readonly raw_value?: number | string | boolean;
    readonly unit?: string;
  };
}

export interface OptionCandidateValidation {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export interface OptionCandidate {
  /** Option-kind NodeV3 with the intervention bundle on the node (canvas shape). */
  readonly node: NodeV3T;
  /** OptionV3 entry for the response-level options[] surface. */
  readonly option: OptionV3T;
  readonly validation: OptionCandidateValidation;
}

/** Defer-artifact shape this module consumes (structural subset of DeferArtifact). */
export interface DeferredOptionLike {
  readonly type: string;
  readonly question: string;
}

const DEFER_QUESTION_SHAPE = /^Consider an additional option: "(.+)"$/;

/** Extracts the option label from the merge's defer-question wrapper. */
export function extractDeferredOptionLabel(question: string): string {
  const match = DEFER_QUESTION_SHAPE.exec(question.trim());
  return (match ? match[1] : question).trim();
}

const ID_MAX_SLUG_CHARS = 40;

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, ID_MAX_SLUG_CHARS)
    .replace(/_+$/g, '');
  return slug.length > 0 ? slug : 'unlabelled';
}

function collisionFreeId(base: string, graph: GraphV3T): string {
  const taken = new Set(graph.nodes.map((n) => n.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Builds a validated executable-option candidate from a deferred artifact and
 * caller-supplied values. Pure and deterministic: same inputs → deep-equal
 * outputs; the graph is read-only (used for id-collision + target checks).
 */
export function synthesiseOptionCandidate(
  deferred: DeferredOptionLike,
  mapping: ValueMapping,
  graph: GraphV3T,
): OptionCandidate {
  const issues: string[] = [];
  if (deferred.type !== 'added_option') {
    issues.push(`artifact type "${deferred.type}" is not added_option`);
  }

  const label = extractDeferredOptionLabel(deferred.question);
  if (label.length === 0) issues.push('deferred artifact has no usable label');

  const id = collisionFreeId(`opt_${slugify(label)}`, graph);

  const factorIds = Object.keys(mapping);
  if (factorIds.length === 0) issues.push('no_intervention_values_supplied');

  const nodeKinds = new Map(graph.nodes.map((n) => [n.id, n.kind as string]));
  for (const factorId of factorIds) {
    const kind = nodeKinds.get(factorId);
    if (kind === undefined) issues.push(`intervention target "${factorId}" not in graph`);
    else if (kind !== 'factor') issues.push(`intervention target "${factorId}" is a ${kind}, not a factor`);
    const entry = mapping[factorId];
    if (!Number.isFinite(entry.value)) issues.push(`intervention value for "${factorId}" is not finite`);
  }

  // Node-level bundle: bare numerics, the canvas-display shape option nodes
  // carry in the persisted graph (canonical values live on the OptionV3).
  const nodeInterventions: Record<string, number> = {};
  const optionInterventions: Record<string, InterventionV3T> = {};
  for (const factorId of factorIds) {
    const entry = mapping[factorId];
    nodeInterventions[factorId] = entry.value;
    optionInterventions[factorId] = {
      value: entry.value,
      source: 'user_specified',
      target_match: { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
      ...(entry.unit !== undefined && { unit: entry.unit }),
      ...(entry.raw_value !== undefined && { raw_value: entry.raw_value }),
    };
  }

  const node = {
    id,
    kind: 'option',
    label,
    interventions: nodeInterventions,
  } as NodeV3T;

  const option = {
    id,
    label,
    status: 'ready',
    interventions: optionInterventions,
    provenance: { source: 'user_specified' },
  } as OptionV3T;

  const nodeParse = NodeV3.safeParse(node);
  if (!nodeParse.success) {
    issues.push(`candidate node fails NodeV3: ${nodeParse.error.issues[0]?.message}`);
  }
  const optionParse = OptionV3.safeParse(option);
  if (!optionParse.success) {
    issues.push(`candidate option fails OptionV3: ${optionParse.error.issues[0]?.message}`);
  }

  return { node, option, validation: { ok: issues.length === 0, issues } };
}
