/**
 * V5 — `edit-graph-fact-builder` (DL-7 PR B).
 *
 * Projects an `EditGraphResult` (CEE V4 dispatch output) into the
 * canonical `EditGraphHandlerFact` (`@talchain/schemas` 0.12.0). This
 * is the single emit site for the new fact type — called from
 * `edit-graph-dispatch.ts` after `handleEditGraph` returns
 * successfully.
 *
 * Contract boundary (matches the DL-7 design + War Room decisions):
 *
 * 1. **Emission gates.** Returns `null` (no fact emitted) for:
 *    - rejected edits;
 *    - `appliedGraph === null`;
 *    - `operations` empty or absent (no-op / zero-ops);
 *    - `appliedChanges` absent;
 *    - `appliedChanges.summary` empty after trim.
 *
 * 2. **Display-safety at emission.** Even though `appliedChanges` is
 *    already produced by display-safe label resolution upstream, this
 *    builder treats it as untrusted at the fact boundary:
 *    - `safe_summary` is run through `sanitiseUserFacingText` (entity-
 *      ID scrub), then the Phase 2A jargon-guard, then truncated to
 *      80 chars. If sanitisation strips it to empty or jargon is
 *      detected, the fallback `"Proposed graph edit."` is used.
 *    - `affected_entities[].label` falls back to a generic display-
 *      safe value (`'the relevant <kind>'`) if the source label is
 *      empty or trims to empty.
 *    - `affected_entities` is capped at 8.
 *
 * 3. **`impact` derivation.** Per War Room rule:
 *    - if `operation_meta` is present, take the highest of the
 *      explicit per-op impacts;
 *    - if `operation_meta` is missing AND any operation is
 *      structural (add/remove node, add/remove/update edge,
 *      non-label-only update_node), default to `'moderate'`;
 *    - otherwise default to `'low'`.
 *
 * 4. **Cross-field invariants enforced at construction:**
 *    - `status === 'applied'` ⇒ `noop === false` and
 *      `operations_count >= 1`;
 *    - never returns a fact with the `status='applied'` /
 *      `operations_count=0` shape that the schema permits but the
 *      War Room forbids.
 *
 * 5. **Schema validation at the boundary.** The constructed fact is
 *    `safeParse`d against `EditGraphHandlerFactSchema` before return;
 *    a parse failure throws (loud) so emitter bugs surface in tests
 *    rather than at commit time.
 *
 * Stop condition: this file MUST NOT import from `build-turn-context`,
 * `context-pack-assembler`, `recent-changes`, `session/store`, or any
 * V5-owned ContextPack surface.
 */

import { createHash } from 'node:crypto';

import {
  EditGraphHandlerFactSchema,
  type EditGraphHandlerFact,
} from '@talchain/schemas/orchestrator';

import type { EditGraphResult } from '../../orchestrator/tools/edit-graph.js';
import type {
  AppliedChanges,
  AppliedChangeItem,
  PatchOperation,
} from '../../orchestrator/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import {
  sanitiseUserFacingText,
  isSlugShapedEntityId,
} from '../../orchestrator/shared/output-safety.js';
import { ENTITY_ID_LEAK_RE } from '../../orchestrator/shared/entity-id-pattern.js';

// ----------------------------------------------------------------------------
// Public constants — mirrored by the test file's expectations
// ----------------------------------------------------------------------------

/**
 * Cap for `safe_summary`. Matches the schema's `.max(80)` and the CEE
 * `RECENT_CHANGES_SUMMARY_MAX_CHARS` so the state-query guard can quote
 * the summary verbatim without further truncation.
 */
export const SAFE_SUMMARY_MAX_CHARS = 80;

/**
 * Cap for `affected_entities`. Matches the schema's `.max(8)`. Larger
 * edits collapse to the first 8 entries; the `operations_count` field
 * preserves the true count.
 */
export const AFFECTED_ENTITIES_MAX = 8;

/**
 * Safe fallback summary when `safe_summary` cannot be derived (empty
 * after sanitisation, or rejected by the jargon guard). Matches the
 * Phase 2A bare-array safe coaching default so the CEE response surface
 * stays consistent.
 */
export const SAFE_SUMMARY_FALLBACK = 'Proposed graph edit.';

/**
 * Phase 2A jargon-guard list. If `safe_summary` (post-sanitisation,
 * lower-cased) contains any of these substrings, fall back to the safe
 * default. Mirrors the assertions in
 * `tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts`
 * (test A6).
 */
const JARGON_TOKENS: readonly string[] = [
  'legacy',
  'repair',
  'normalise',
  'normalize',
  'envelope',
  'wrapped',
  'gpt-',
  'claude',
];

/**
 * Post-substitution raw-id-shape gate (DL-7 PR B P1 hardening).
 *
 * `sanitiseUserFacingText` performs ID→label substitution by looking
 * up labels in the post-edit graph. Two ways an entity-ID-shaped
 * token can survive that pass:
 *
 *   1. The graph node's `label` field is itself raw-id-shaped — e.g.
 *      a node `{ id: 'fac_price', label: 'fac_other' }` (a future
 *      caller bypassing label-resolution upstream, or a legacy graph
 *      whose labels were never set). `resolveLabel` returns the
 *      label verbatim, so the substituted text contains a raw-id
 *      shape.
 *   2. The match was rejected by the slug-shape gate (English
 *      compound) at sanitisation time, but the surrounding context
 *      changed during sanitisation in a way that makes the residue
 *      now look like a confirmed ID.
 *
 * This walker re-scans the post-sanitisation text for `ENTITY_ID_LEAK_RE`
 * matches and confirms each via `isSlugShapedEntityId` (graph-free, same
 * rule the sanitiser uses). Any confirmed match → unsafe → caller falls
 * back. Defence-in-depth: even if `sanitiseUserFacingText` misses, the
 * fact never carries a raw-id-shaped string at the schema boundary.
 */
function containsConfirmedRawIdShape(text: string): boolean {
  if (!text || text.length === 0) return false;
  const re = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
  for (const m of text.matchAll(re)) {
    if (isSlugShapedEntityId(m[0])) return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// Inputs + result shape
// ----------------------------------------------------------------------------

export interface BuildEditGraphHandlerFactInput {
  /** The `EditGraphResult` returned by `handleEditGraph`. */
  readonly editResult: EditGraphResult;
  /**
   * Pre-edit graph state, used to compute `graph_hash_before` and to
   * resolve any labels that may not be present in the post-edit graph
   * (e.g. for `remove_node` operations).
   */
  readonly preEditGraph: GraphV3T | null;
  /**
   * Whether the dispatch turn has a prior successful `run_analysis`
   * fact in scope. Threaded through to `appliedChanges.rerun_recommended`
   * upstream; pass-through here.
   */
  readonly hasExistingAnalysis: boolean;
}

// ----------------------------------------------------------------------------
// Public builder
// ----------------------------------------------------------------------------

export function buildEditGraphHandlerFact(
  input: BuildEditGraphHandlerFactInput,
): EditGraphHandlerFact | null {
  const { editResult, preEditGraph } = input;

  // ── Emission gates ──────────────────────────────────────────────────
  if (editResult.wasRejected) return null;
  if (!editResult.appliedGraph) return null;
  if (!editResult.operations || editResult.operations.length === 0) return null;
  if (!editResult.appliedChanges) return null;
  if (!editResult.appliedChanges.summary || editResult.appliedChanges.summary.trim() === '') {
    return null;
  }

  const operations = editResult.operations;
  const appliedChanges = editResult.appliedChanges;
  const appliedGraph = editResult.appliedGraph;

  // ── Field derivation ────────────────────────────────────────────────
  const edit_kind = deriveEditKind(operations, appliedGraph);
  const operations_count = operations.length;
  const affected_entities = projectAffectedEntities(
    appliedChanges.changes,
    operations,
    appliedGraph,
    preEditGraph,
  );
  const graph_hash_before = preEditGraph ? hashGraph(preEditGraph) : null;
  const graph_hash_after = appliedGraph ? hashGraph(appliedGraph) : null;
  const safe_summary = deriveSafeSummary(appliedChanges.summary, appliedGraph);
  const impact = deriveImpact(operations, editResult.operation_meta);
  const rerun_recommended = appliedChanges.rerun_recommended === true;

  // ── Cross-field invariant enforcement ──────────────────────────────
  // status='applied' implies operations_count >= 1 and noop=false.
  // Both are guaranteed here by the emission gates (operations is
  // non-empty and we don't construct noop=true facts), so this is a
  // sanity assertion rather than a runtime branch.
  const status: 'applied' = 'applied';
  const noop = false;

  // ── Construct + validate ───────────────────────────────────────────
  const fact: EditGraphHandlerFact = {
    fact_type: 'edit_graph',
    fact_version: 1,
    noop,
    result: {
      edit_kind,
      status,
      operations_count,
      affected_entities,
      graph_hash_before,
      graph_hash_after,
      safe_summary,
      impact,
      rerun_recommended,
    },
  };

  const parsed = EditGraphHandlerFactSchema.safeParse(fact);
  if (!parsed.success) {
    // Loud failure — emitter bugs should surface in tests, never at
    // commit. Production paths can catch this and decide whether to
    // proceed without a receipt fact (preserving the Phase 2A
    // `handler_facts: []` baseline).
    throw new Error(
      `EditGraphHandlerFact failed schema validation: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/**
 * Derive `edit_kind` from the operation set and the post-edit graph.
 *
 * - `'structural'` if any op adds or removes a node/edge.
 * - `'option_configuration'` if at least one operation targets an
 *   option node (kind === 'option' in the graph).
 * - `'parameter_update'` otherwise (label/value updates on
 *   non-option nodes, or update_edge changing strength etc.).
 */
function deriveEditKind(
  operations: readonly PatchOperation[],
  graph: GraphV3T,
): 'parameter_update' | 'option_configuration' | 'structural' {
  for (const op of operations) {
    if (op.op === 'add_node' || op.op === 'remove_node') return 'structural';
    if (op.op === 'add_edge' || op.op === 'remove_edge') return 'structural';
  }
  // No structural ops. Check whether any op targets an option node.
  for (const op of operations) {
    if (op.op === 'update_node') {
      const node = findNodeById(graph, op.path);
      if (node?.kind === 'option') return 'option_configuration';
    }
  }
  return 'parameter_update';
}

/**
 * Project `appliedChanges.changes` into the schema's
 * `affected_entities` array. Each entry's `kind` is derived from the
 * post-edit graph (or pre-edit graph for removed nodes); `label` is the
 * already-resolved display-safe label from `appliedChanges`, with a
 * generic fallback when missing or empty.
 *
 * Capped at AFFECTED_ENTITIES_MAX entries. Larger edit sets are
 * truncated; the `operations_count` field preserves the true count.
 */
function projectAffectedEntities(
  changes: readonly AppliedChangeItem[],
  operations: readonly PatchOperation[],
  postGraph: GraphV3T,
  preGraph: GraphV3T | null,
): EditGraphHandlerFact['result']['affected_entities'] {
  const out: EditGraphHandlerFact['result']['affected_entities'] = [];
  const limit = Math.min(changes.length, AFFECTED_ENTITIES_MAX);
  for (let i = 0; i < limit; i++) {
    const change = changes[i];
    const op = operations[i];
    const kind = deriveEntityKind(change, op, postGraph, preGraph);
    const label = sanitiseAffectedEntityLabel(change.label, kind, postGraph);
    out.push({ kind, label });
  }
  return out;
}

/**
 * Sanitise an `affected_entities[].label` at the fact emission boundary.
 *
 * Treats the upstream `change.label` as untrusted display text — even
 * though `buildAppliedChanges` upstream calls `resolveElementLabel`, a
 * change with a missing entry, a future caller bypassing
 * `resolveElementLabel`, or a node whose label itself contains an
 * entity-id pattern (`fac_delivery_cost` accidentally used as a label)
 * would all surface raw IDs through to the fact. Defence in depth.
 *
 * Steps (parallel to `deriveSafeSummary` for `safe_summary`):
 *  1. Trim whitespace; if empty, fall back to `'the relevant <kind>'`.
 *  2. Run `sanitiseUserFacingText` against the post-edit graph
 *     (entity-ID scrub).
 *  3. If the sanitiser stripped to empty or the result contains a
 *     forbidden Phase 2A jargon token, fall back to
 *     `'the relevant <kind>'`.
 *  4. Otherwise return the sanitised label as-is. No `.max()` cap —
 *     the schema is permissive on length and no existing label-length
 *     convention exists in the schemas package.
 */
function sanitiseAffectedEntityLabel(
  rawLabel: string | undefined,
  kind: EditGraphHandlerFact['result']['affected_entities'][number]['kind'],
  postGraph: GraphV3T,
): string {
  const fallback = `the relevant ${kind}`;
  const trimmed = (rawLabel ?? '').trim();
  if (trimmed.length === 0) return fallback;

  const sanitised = sanitiseUserFacingText(trimmed, postGraph);
  const text = sanitised.text;
  if (!text || text.trim().length === 0) return fallback;

  const lower = text.toLowerCase();
  for (const token of JARGON_TOKENS) {
    if (lower.includes(token)) return fallback;
  }
  // Final defence: if the post-substitution string still contains a
  // confirmed raw-id shape (e.g. graph label was itself raw-id-shaped),
  // fall back rather than leak the ID through to the fact.
  if (containsConfirmedRawIdShape(text)) return fallback;
  return text;
}

/**
 * Derive the `kind` for a single affected entity.
 *
 * - Path containing `::` → edge mutation, `kind = 'edge'`.
 * - Otherwise look up the node by path (id) in the post-edit graph;
 *   for `remove_node` ops fall back to the pre-edit graph.
 * - Default to `'factor'` if the lookup fails (defensive — a
 *   resolvable edit should always have a graph entry).
 */
function deriveEntityKind(
  change: AppliedChangeItem,
  op: PatchOperation | undefined,
  postGraph: GraphV3T,
  preGraph: GraphV3T | null,
): EditGraphHandlerFact['result']['affected_entities'][number]['kind'] {
  const path = change.element_ref;
  if (path.includes('::')) return 'edge';

  // Look up node in post-edit graph first.
  const post = findNodeById(postGraph, path);
  if (post?.kind) return normaliseKind(post.kind);

  // Fall back to pre-edit graph (covers remove_node).
  if (preGraph) {
    const pre = findNodeById(preGraph, path);
    if (pre?.kind) return normaliseKind(pre.kind);
  }

  // Defensive default — should not be reached for a resolvable edit.
  return 'factor';
}

function findNodeById(graph: GraphV3T, id: string): { kind?: string; label?: string } | null {
  const nodes = (graph.nodes ?? []) as Array<{ id: string; kind?: string; label?: string }>;
  return nodes.find((n) => n.id === id) ?? null;
}

const VALID_KINDS = new Set([
  'goal',
  'factor',
  'outcome',
  'risk',
  'action',
  'decision',
  'option',
  'constraint',
]);

function normaliseKind(
  kind: string,
): EditGraphHandlerFact['result']['affected_entities'][number]['kind'] {
  if (VALID_KINDS.has(kind)) {
    return kind as EditGraphHandlerFact['result']['affected_entities'][number]['kind'];
  }
  return 'factor';
}

/**
 * Derive `safe_summary` from `appliedChanges.summary` per the contract:
 *
 * 1. Run `sanitiseUserFacingText` over the input (entity-ID scrub
 *    against the post-edit graph).
 * 2. Apply the Phase 2A jargon-guard — if any forbidden token is
 *    present after sanitisation, fall back to `SAFE_SUMMARY_FALLBACK`.
 * 3. If empty after trim, fall back.
 * 4. Truncate to `SAFE_SUMMARY_MAX_CHARS` with an ellipsis suffix when
 *    the source exceeded the cap.
 */
function deriveSafeSummary(rawSummary: string, postGraph: GraphV3T): string {
  if (!rawSummary || rawSummary.trim().length === 0) return SAFE_SUMMARY_FALLBACK;

  const sanitised = sanitiseUserFacingText(rawSummary, postGraph);
  let s = sanitised.text;
  if (!s || s.trim().length === 0) return SAFE_SUMMARY_FALLBACK;

  const lower = s.toLowerCase();
  for (const token of JARGON_TOKENS) {
    if (lower.includes(token)) return SAFE_SUMMARY_FALLBACK;
  }

  // Final defence: if the post-substitution summary still contains a
  // confirmed raw-id shape (e.g. graph label was itself raw-id-shaped),
  // fall back rather than leak the ID through to the fact.
  if (containsConfirmedRawIdShape(s)) return SAFE_SUMMARY_FALLBACK;

  if (s.length > SAFE_SUMMARY_MAX_CHARS) {
    // Truncate to (cap - 1) chars and append the single-char ellipsis,
    // matching the CEE `RECENT_CHANGES_SUMMARY_MAX_CHARS` truncation
    // pattern in `recent-changes.ts:cap()`.
    s = s.slice(0, SAFE_SUMMARY_MAX_CHARS - 1) + '…';
  }
  return s;
}

/**
 * Aggregate `impact` for the fact per the War Room rule.
 */
function deriveImpact(
  operations: readonly PatchOperation[],
  operationMeta: readonly { impact: 'low' | 'moderate' | 'high'; rationale: string }[] | undefined,
): 'low' | 'moderate' | 'high' {
  if (operationMeta && operationMeta.length > 0) {
    let best: 'low' | 'moderate' | 'high' = 'low';
    for (const m of operationMeta) {
      if (m.impact === 'high') return 'high';
      if (m.impact === 'moderate' && best === 'low') best = 'moderate';
    }
    return best;
  }

  // No explicit per-op meta. Apply the structural fallback.
  for (const op of operations) {
    if (isStructural(op)) return 'moderate';
  }
  return 'low';
}

function isStructural(op: PatchOperation): boolean {
  if (op.op === 'add_node' || op.op === 'remove_node') return true;
  if (op.op === 'add_edge' || op.op === 'remove_edge' || op.op === 'update_edge') return true;
  if (op.op === 'update_node') {
    const v = op.value as Record<string, unknown> | undefined;
    if (!v) return false;
    const keys = Object.keys(v);
    // Label-only renames are NOT structural.
    if (keys.length === 1 && keys[0] === 'label') return false;
    return true;
  }
  return false;
}

/**
 * Compute the same 16-char SHA-256 hash that
 * `edit-graph.ts:computeGraphHash` uses for `applied_graph_hash`.
 * Replicated here to keep this module dependency-light (the original
 * is a non-exported V4 helper and re-importing it would cross more
 * module boundaries than necessary). The hash format is stable; both
 * sites produce the same value for the same input.
 */
function hashGraph(graph: unknown): string {
  return createHash('sha256').update(JSON.stringify(graph)).digest('hex').substring(0, 16);
}

// ----------------------------------------------------------------------------
// Generic fallback path — DL-7 PR B war-room correction
// ----------------------------------------------------------------------------

/**
 * Predicate: should this dispatch produce SOME edit_graph fact (rich
 * or generic), independent of whether `appliedChanges` is rich enough
 * to drive the rich builder?
 *
 * Aligned with the user's explicit emission rules:
 *  - rejected, no-op, zero-operation, and forbidden-topology /
 *    clarification outcomes never produce a fact;
 *  - everything else (a successful applied mutation with at least one
 *    operation and a post-edit graph) does.
 *
 * The rich builder's additional emission gate
 * (`appliedChanges` present with non-empty summary) is a richness
 * test, not an emission gate — when those richer fields are missing
 * we fall back to the generic builder rather than skipping the fact.
 */
export function isSuccessfulAppliedMutation(
  editResult: BuildEditGraphHandlerFactInput['editResult'],
): boolean {
  if (editResult.wasRejected) return false;
  if (!editResult.appliedGraph) return false;
  if (!editResult.operations || editResult.operations.length === 0) return false;
  return true;
}

/**
 * Generic-fallback safe summary text. Matches the user's spec:
 *
 *   "safe_summary: \"Updated the decision model.\""
 *
 * Distinct from `SAFE_SUMMARY_FALLBACK` (which the rich builder uses
 * when its OWN sanitisation strips the upstream summary or rejects it
 * as jargon — `"Proposed graph edit."`). The generic fallback's
 * different wording reflects a different semantic: rich builder
 * couldn't be used, so we emit a confidence-appropriate generic
 * summary that doesn't pretend to know what the user-facing change
 * was.
 */
export const GENERIC_SAFE_SUMMARY = 'Updated the decision model.';

/**
 * Build a minimal-but-valid `EditGraphHandlerFact` when the rich
 * builder cannot — either because it threw, or because
 * `appliedChanges` was absent or empty.
 *
 * Per the war-room correction: a successful applied mutation MUST
 * produce a fact. The generic fallback's role is to satisfy that
 * invariant while degrading gracefully when richer detail is
 * unavailable.
 *
 * The fallback NEVER throws on schema-validation failure — if
 * something deep is wrong (e.g. `operations` is not an array — which
 * shouldn't be possible after the gates), it returns `null` and the
 * dispatcher falls back to the Phase 2A `handler_facts: []` baseline.
 * The intent is that this builder is the most-defensive layer
 * possible.
 *
 * Field derivation:
 *  - `safe_summary`: `GENERIC_SAFE_SUMMARY` (no scrubbing needed —
 *    no user-supplied text in this fact).
 *  - `affected_entities`: `[]` (no rich data to project).
 *  - `status`: `'applied'`.
 *  - `noop`: `false`.
 *  - `operations_count`: `operations.length`.
 *  - `impact`: same `deriveImpact` logic as the rich builder
 *    (highest of operation_meta, or `'moderate'` for structural-
 *    without-meta, or `'low'`).
 *  - `rerun_recommended`: prefer `appliedChanges.rerun_recommended`
 *    if available; otherwise fall back to
 *    `hasExistingAnalysis && hasSubstantiveOp` (mirrors the
 *    `buildAppliedChanges` logic in `edit-graph.ts:1233`).
 *  - `graph_hash_before` / `_after`: computed from `preEditGraph` /
 *    `appliedGraph` where available; `null` otherwise.
 */
export function buildGenericEditGraphHandlerFact(
  input: BuildEditGraphHandlerFactInput,
): EditGraphHandlerFact | null {
  const { editResult, preEditGraph, hasExistingAnalysis } = input;

  // Same legitimate-no-fact gates as the rich builder.
  if (!isSuccessfulAppliedMutation(editResult)) return null;

  const operations = editResult.operations!;
  const appliedGraph = editResult.appliedGraph!;

  const edit_kind = deriveEditKind(operations, appliedGraph);
  const impact = deriveImpact(operations, editResult.operation_meta);
  const hasSubstantiveOp = operations.some(isStructural);
  const rerun_recommended =
    editResult.appliedChanges?.rerun_recommended ?? (hasExistingAnalysis && hasSubstantiveOp);

  const fact: EditGraphHandlerFact = {
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind,
      status: 'applied',
      operations_count: operations.length,
      affected_entities: [],
      graph_hash_before: preEditGraph ? hashGraph(preEditGraph) : null,
      graph_hash_after: hashGraph(appliedGraph),
      safe_summary: GENERIC_SAFE_SUMMARY,
      impact,
      rerun_recommended,
    },
  };

  const parsed = EditGraphHandlerFactSchema.safeParse(fact);
  if (!parsed.success) {
    // Deepest fallback: log nothing (caller logs the parent throw)
    // and return null. Dispatcher commits with handler_facts: [].
    // This branch should be unreachable in practice — every field
    // above is constructed from known-valid values.
    return null;
  }
  return parsed.data;
}
