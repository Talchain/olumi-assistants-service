/**
 * PLoT validate-patch canonical field definitions.
 *
 * Source of truth: plot-lite-service/src/routes/v1/validate-patch.ts (lines 48–60)
 * Last synced: 2026-03-26
 *
 * These constants mirror the field allow-lists that PLoT's validate-patch endpoint
 * uses to reject non-canonical fields. Any field NOT in these sets will trigger
 * INVALID_PATCH_FIELD (422) when sent via a patch operation.
 *
 * Structured for future extraction into @talchain/schemas.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * FIELD CONTRACT TRACE TABLES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ── Node fields ──────────────────────────────────────────────────────────────
 *
 * | Field               | PLoT canonical | PLoT normaliser | Prompt teaches | Notes                                       |
 * |---------------------|:--------------:|:---------------:|:--------------:|---------------------------------------------|
 * | id                  | ✓              | ✓               | ✓              |                                             |
 * | kind                | ✓              | ✓               | ✓              |                                             |
 * | label               | ✓              | ✓               | ✓              |                                             |
 * | body                | ✓              | maps desc→body  | ✗              | Prompt doesn't use body; description mapped |
 * | type                | ✓              | synonym→kind    | ✗              | React Flow convention                       |
 * | categories          | ✓              | →category       | ✗              | Legacy plural form                          |
 * | category            | ✓              | ✓               | ✓              | controllable/observable/external on factors  |
 * | observed_state      | ✓              | built from data | ✗              | Normaliser builds from data.value etc.       |
 * | state_space         | ✓              | ✓               | ✗              |                                             |
 * | goal_threshold      | ✓              | ✓               | ✓              | Goal nodes only                             |
 * | goal_threshold_raw  | ✓              | ✓               | ✓              | Goal nodes only                             |
 * | goal_threshold_unit | ✓              | ✓               | ✓              | Goal nodes only                             |
 * | goal_threshold_cap  | ✓              | ✓               | ✓              | Goal nodes only                             |
 * | prior               | ✓              | ✓               | ✓              | External factors only                       |
 * | data                | ✗ REJECTED     | flattened       | ✓ (both)       | M2: draft OK (normaliser), edit REJECTED    |
 * | description         | ✗ REJECTED     | maps→body       | ✗              |                                             |
 *
 * ── Edge fields ──────────────────────────────────────────────────────────────
 *
 * | Field              | PLoT canonical | PLoT normaliser | Prompt teaches | Notes                                       |
 * |--------------------|:--------------:|:---------------:|:--------------:|---------------------------------------------|
 * | from               | ✓              | source→from     | ✓              |                                             |
 * | to                 | ✓              | target→to       | ✓              |                                             |
 * | strength           | ✓ (nested)     | re-nests flat   | ✓ (nested)     | Must be { mean, std }                       |
 * | exists_probability | ✓              | belief→ep       | ✓              |                                             |
 * | effect_direction   | ✓              | direction→ed    | ✓              |                                             |
 * | label              | ✓              | ✓               | ✗              |                                             |
 * | edge_type          | ✓              | ✓               | ✓ (draft)      |                                             |
 * | strength_mean      | ✗ REJECTED     | re-nested       | ✗              | M1: CEE normaliseEdgeValue PRODUCES this    |
 * | strength_std       | ✗ REJECTED     | re-nested       | ✗              | M1: CEE normaliseEdgeValue PRODUCES this    |
 * | belief_exists      | ✗ REJECTED     | →exists_prob    | ✗              | Sanitised by CEE                            |
 * | belief             | ✗ REJECTED     | →exists_prob    | ✗              | Sanitised by CEE                            |
 * | confidence         | ✗ REJECTED     | n/a             | ✗              | Sanitised by CEE                            |
 * | weight             | ✗ REJECTED     | →strength.mean  | ✗              |                                             |
 * | source             | ✗ REJECTED     | →from           | ✗              | React Flow convention                       |
 * | target             | ✗ REJECTED     | →to             | ✗              | React Flow convention                       |
 *
 * ── Path format ──────────────────────────────────────────────────────────────
 *
 * | Syntax                              | Prompt teaches | CEE normalises to       | PLoT expects |
 * |-------------------------------------|:--------------:|:-----------------------:|:------------:|
 * | /nodes/<id>                         | ✓              | path: id                | bare id      |
 * | /edges/<from>-><to>                 | ✓              | path: from::to → from->to | from->to   |
 * | /edges/<from>-><to>/strength.mean   | ✓              | { "strength.mean": val }| ✗ M3        |
 * | /nodes/<id>/data/interventions/<f>  | ✓              | value not nested        | ✗ M4        |
 *
 * ── Critical mismatches (M1–M5) ──────────────────────────────────────────────
 *
 * M1 [P0 BUG] normaliseEdgeValue() at edit-graph.ts:2289 flattens canonical
 *    strength: { mean, std } → non-canonical strength_mean, strength_std.
 *    Root cause of every edit_graph edge rejection via PLoT validate-patch.
 *    FIX: remove flattening or add re-nesting before mapOpsForPlot.
 *
 * M2 Prompt teaches data wrapper (options, factors). Not in CANONICAL_NODE_FIELDS.
 *    draft_graph OK (normaliser flattens). edit_graph → REJECTED.
 *
 * M3 Field-level update paths produce non-canonical keys after scalar wrapping.
 *    e.g. /edges/.../strength.mean → { "strength.mean": -0.6 } → REJECTED.
 *
 * M4 Intervention path value keys (value, raw_value, unit, cap) not canonical.
 *
 * M5 [CONFIRMED BROKEN] Intervention writes to node.data.interventions do NOT
 *    reach PLoT analysis. filterOptionNodes() at run.ts:2404 strips all option
 *    nodes before ISL. Interventions only reach ISL from the separate options[]
 *    request parameter, never from node fields.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// Canonical field sets (mirror PLoT validate-patch.ts lines 53–60)
// ---------------------------------------------------------------------------

/**
 * Canonical node fields accepted by PLoT validate-patch.
 * Any field NOT in this set triggers INVALID_PATCH_FIELD (422).
 */
export const CANONICAL_NODE_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'kind',
  'label',
  'body',
  'type',
  'categories',
  'category',
  'observed_state',
  'state_space',
  'goal_threshold',
  'goal_threshold_raw',
  'goal_threshold_unit',
  'goal_threshold_cap',
  'prior',
] as const);

/**
 * Canonical edge fields accepted by PLoT validate-patch.
 * `strength` must be a nested object `{ mean: number, std: number }`.
 * Flat `strength_mean` / `strength_std` are NOT canonical.
 */
export const CANONICAL_EDGE_FIELDS: ReadonlySet<string> = new Set([
  'from',
  'to',
  'strength',
  'exists_probability',
  'effect_direction',
  'label',
  'edge_type',
] as const);

/**
 * Valid node kinds accepted by PLoT validate-patch.
 * Includes 'option' (UI-layer, filtered before analysis by /v2/run).
 */
export const VALID_NODE_KINDS: ReadonlySet<string> = new Set([
  'goal',
  'factor',
  'outcome',
  'decision',
  'risk',
  'action',
  'option',
] as const);

// ---------------------------------------------------------------------------
// Forbidden fields (known non-canonical with rejection reasons)
// ---------------------------------------------------------------------------

export interface ForbiddenFieldEntry {
  /** Whether this field appears on nodes or edges */
  entity: 'node' | 'edge';
  /** Why PLoT rejects it and what to use instead */
  reason: string;
}

/**
 * Known non-canonical fields with rejection reasons.
 * Used by negative fixture tests and for handover documentation.
 */
export const FORBIDDEN_FIELDS: Readonly<Record<string, ForbiddenFieldEntry>> = {
  // Node fields
  data: {
    entity: 'node',
    reason:
      'Not in PLoT CANONICAL_NODE_FIELDS. Flattened by /v2/run normaliser ' +
      'but REJECTED by validate-patch. Use observed_state for factor values, ' +
      'prior for externals. Option interventions belong in the separate options[] array.',
  },
  description: {
    entity: 'node',
    reason:
      'Not in PLoT CANONICAL_NODE_FIELDS. PLoT normaliser maps description→body ' +
      'but validate-patch rejects it. Use "body" instead.',
  },

  // Edge fields
  strength_mean: {
    entity: 'edge',
    reason:
      'Not canonical. Use nested strength: { mean, std }. ' +
      'M1 BUG: CEE normaliseEdgeValue() actively produces this non-canonical format.',
  },
  strength_std: {
    entity: 'edge',
    reason:
      'Not canonical. Use nested strength: { mean, std }. ' +
      'M1 BUG: CEE normaliseEdgeValue() actively produces this non-canonical format.',
  },
  belief_exists: {
    entity: 'edge',
    reason: 'Legacy field. Use exists_probability. Sanitised by CEE sanitiseOperations().',
  },
  belief: {
    entity: 'edge',
    reason: 'Legacy field. Use exists_probability. Sanitised by CEE sanitiseOperations().',
  },
  confidence: {
    entity: 'edge',
    reason: 'Legacy field with no canonical replacement on edges. Sanitised by CEE.',
  },
  weight: {
    entity: 'edge',
    reason: 'Not canonical. Use strength: { mean, std }.',
  },
  source: {
    entity: 'edge',
    reason: 'React Flow convention. Use "from".',
  },
  target: {
    entity: 'edge',
    reason: 'React Flow convention. Use "to".',
  },
} as const;

// ---------------------------------------------------------------------------
// Pipeline context (determines which fields are acceptable)
// ---------------------------------------------------------------------------

/**
 * Pipeline context determines which validation rules apply:
 * - edit_graph: operations go to PLoT validate-patch (strict canonical check)
 * - draft_graph: full graph goes to PLoT /v2/run normaliser (flattens data wrapper)
 */
export type PipelineContext = 'edit_graph' | 'draft_graph';

/**
 * Fields that are acceptable in draft_graph context because PLoT's graph
 * normaliser handles them, but REJECTED by validate-patch in edit_graph context.
 */
export const DRAFT_GRAPH_TOLERATED_NODE_FIELDS: ReadonlySet<string> = new Set([
  'data',
] as const);

// ---------------------------------------------------------------------------
// Validation helpers (reusable by test files)
// ---------------------------------------------------------------------------

export interface FieldViolation {
  /** Index of the JSON example in the prompt (0-based) */
  exampleIndex: number;
  /** Surrounding text context from the prompt */
  context: string;
  /** The non-canonical field name */
  field: string;
  /** Whether the violation is on a node or edge */
  entity: 'node' | 'edge' | 'path';
  /** Human-readable reason for the rejection */
  reason: string;
  /** Which pipeline this violation applies to */
  pipelineContext: PipelineContext | 'both';
}

/**
 * Check if an object looks like a node shape (has id and kind).
 */
export function isNodeShape(obj: Record<string, unknown>): boolean {
  return typeof obj.id === 'string' && (typeof obj.kind === 'string' || typeof obj.type === 'string');
}

/**
 * Check if an object looks like an edge shape (has from+to or source+target).
 */
export function isEdgeShape(obj: Record<string, unknown>): boolean {
  return (typeof obj.from === 'string' && typeof obj.to === 'string') ||
    (typeof obj.source === 'string' && typeof obj.target === 'string');
}

/**
 * Check if an object looks like a patch operation (has op and path).
 */
export function isPatchOperation(obj: Record<string, unknown>): boolean {
  return typeof obj.op === 'string' && typeof obj.path === 'string';
}

/**
 * Validate top-level fields of a node value against CANONICAL_NODE_FIELDS.
 */
export function validateNodeFields(
  obj: Record<string, unknown>,
  exampleIndex: number,
  context: string,
  pipeline: PipelineContext,
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  for (const key of Object.keys(obj)) {
    if (CANONICAL_NODE_FIELDS.has(key)) continue;
    // In draft_graph context, tolerated fields are not violations
    if (pipeline === 'draft_graph' && DRAFT_GRAPH_TOLERATED_NODE_FIELDS.has(key)) continue;
    const forbidden = FORBIDDEN_FIELDS[key];
    violations.push({
      exampleIndex,
      context,
      field: key,
      entity: 'node',
      reason: forbidden?.reason ?? `"${key}" is not in PLoT CANONICAL_NODE_FIELDS`,
      pipelineContext: DRAFT_GRAPH_TOLERATED_NODE_FIELDS.has(key) ? 'edit_graph' : 'both',
    });
  }
  return violations;
}

/**
 * Validate top-level fields of an edge value against CANONICAL_EDGE_FIELDS.
 * Also validates that strength (when present) is a nested { mean, std } object.
 */
export function validateEdgeFields(
  obj: Record<string, unknown>,
  exampleIndex: number,
  context: string,
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  for (const key of Object.keys(obj)) {
    if (CANONICAL_EDGE_FIELDS.has(key)) continue;
    const forbidden = FORBIDDEN_FIELDS[key];
    violations.push({
      exampleIndex,
      context,
      field: key,
      entity: 'edge',
      reason: forbidden?.reason ?? `"${key}" is not in PLoT CANONICAL_EDGE_FIELDS`,
      pipelineContext: 'both',
    });
  }
  // Enforce strength shape: must be { mean: number, std: number } when present
  violations.push(...validateEdgeStrengthShape(obj, exampleIndex, context));
  return violations;
}

/**
 * Validate that `strength` (when present on an edge) is a nested object with
 * `mean` and `std` number fields. PLoT validate-patch accepts `strength` as a
 * canonical field but requires the nested `{ mean, std }` shape. A bare number
 * or missing sub-fields would fail normalisation.
 */
export function validateEdgeStrengthShape(
  obj: Record<string, unknown>,
  exampleIndex: number,
  context: string,
): FieldViolation[] {
  if (!('strength' in obj)) return [];
  const s = obj.strength;
  if (s === undefined || s === null) return [];

  const violations: FieldViolation[] = [];

  if (typeof s !== 'object' || Array.isArray(s)) {
    violations.push({
      exampleIndex,
      context,
      field: 'strength',
      entity: 'edge',
      reason: `strength must be { mean: number, std: number }, got ${typeof s}`,
      pipelineContext: 'both',
    });
    return violations;
  }

  const sObj = s as Record<string, unknown>;
  if (typeof sObj.mean !== 'number') {
    violations.push({
      exampleIndex,
      context,
      field: 'strength.mean',
      entity: 'edge',
      reason: `strength.mean must be a number, got ${sObj.mean === undefined ? 'missing' : typeof sObj.mean}`,
      pipelineContext: 'both',
    });
  }
  if (typeof sObj.std !== 'number') {
    violations.push({
      exampleIndex,
      context,
      field: 'strength.std',
      entity: 'edge',
      reason: `strength.std must be a number, got ${sObj.std === undefined ? 'missing' : typeof sObj.std}`,
      pipelineContext: 'both',
    });
  }
  return violations;
}

/**
 * Validate edge path format uses -> separator (not ::).
 */
export function validateEdgePath(
  path: string,
  exampleIndex: number,
  context: string,
): FieldViolation[] {
  if (path.includes('::')) {
    return [{
      exampleIndex,
      context,
      field: '::',
      entity: 'path',
      reason: 'Edge path must use "->" separator, not "::". PLoT validate-patch splits on "->".',
      pipelineContext: 'both',
    }];
  }
  return [];
}

/**
 * Simulate CEE normalisePath (edit-graph.ts:2002).
 * Converts prompt-format paths to CEE pipeline format + extracted field.
 *
 * - /nodes/<id>          → { path: id }
 * - /nodes/<id>/<field>  → { path: id, field: field }
 * - /edges/<from>-><to>  → { path: from::to }
 * - /edges/<from>-><to>/<field> → { path: from::to, field: field }
 * - Already-normalised   → { path: as-is }
 */
export function simulateNormalisePath(path: string): { path: string; field?: string } {
  if (!path.startsWith('/')) return { path };

  const edgeMatch = path.match(/^\/edges\/([^/]+)->([^/]+)(?:\/(.+))?$/);
  if (edgeMatch) {
    return {
      path: `${edgeMatch[1]}::${edgeMatch[2]}`,
      field: edgeMatch[3],
    };
  }

  const nodeMatch = path.match(/^\/nodes\/([^/]+)(?:\/(.+))?$/);
  if (nodeMatch) {
    return {
      path: nodeMatch[1],
      field: nodeMatch[2],
    };
  }

  return { path };
}

/**
 * Simulate CEE normaliseOperation scalar wrapping (edit-graph.ts:2167-2173).
 * When a field-level update op has a scalar value, CEE wraps it as { [field]: value }.
 * This produces keys like "strength.mean" or "data/interventions/fac_x" which are
 * not in PLoT CANONICAL_*_FIELDS.
 */
export function simulateScalarWrapping(
  field: string | undefined,
  opType: string,
  value: unknown,
): unknown {
  if (!field) return value;
  if (opType !== 'update_node' && opType !== 'update_edge') return value;
  // Only wrap scalars (non-objects or null)
  if (value !== undefined && (typeof value !== 'object' || value === null)) {
    return { [field]: value };
  }
  return value;
}

/**
 * Validate update_node/update_edge operations after simulating CEE's
 * normalisePath + scalar wrapping. Catches M3 (strength.mean key) and
 * M4 (intervention path keys).
 */
export function validateUpdateOpAfterNormalisation(
  op: Record<string, unknown>,
  exampleIndex: number,
  context: string,
  pipeline: PipelineContext,
): FieldViolation[] {
  const opType = op.op as string;
  if (opType !== 'update_node' && opType !== 'update_edge') return [];

  const rawPath = op.path as string;
  const rawValue = op.value;
  if (rawValue === undefined) return [];

  const { path: _normPath, field } = simulateNormalisePath(rawPath);
  if (!field) return []; // No sub-field extraction, standard validation handles it

  const violations: FieldViolation[] = [];

  // Simulate scalar wrapping
  const wrappedValue = simulateScalarWrapping(field, opType, rawValue);

  // Validate the wrapped value against canonical fields
  if (wrappedValue && typeof wrappedValue === 'object' && !Array.isArray(wrappedValue)) {
    const wrapped = wrappedValue as Record<string, unknown>;
    if (opType === 'update_node') {
      violations.push(...validateNodeFields(wrapped, exampleIndex, context, pipeline));
    } else {
      violations.push(...validateEdgeFields(wrapped, exampleIndex, context));
    }
  }

  // Also flag the field path itself if it contains non-canonical segments
  if (field.includes('/')) {
    violations.push({
      exampleIndex,
      context,
      field,
      entity: opType === 'update_node' ? 'node' : 'edge',
      reason:
        `Nested field path "${field}" extracted from "${rawPath}". ` +
        `After normalisePath, this becomes a top-level key in the value object ` +
        `sent to PLoT, which is not in CANONICAL_${opType === 'update_node' ? 'NODE' : 'EDGE'}_FIELDS.`,
      pipelineContext: 'both',
    });
  }

  return violations;
}

/**
 * Simulate CEE normaliseEdgeValue transform and check for non-canonical output.
 * This detects M1: strength: { mean, std } → strength_mean, strength_std.
 */
export function simulateNormaliseEdgeValue(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj.strength && typeof obj.strength === 'object') {
    const s = obj.strength as Record<string, unknown>;
    const { strength: _strength, ...rest } = obj;
    return {
      ...rest,
      ...(s.mean !== undefined && { strength_mean: s.mean }),
      ...(s.std !== undefined && { strength_std: s.std }),
    };
  }
  return obj;
}

/**
 * Recursively walk a JSON value and collect field violations.
 * Handles: full graphs (nodes+edges), patch operations, standalone nodes/edges.
 */
export function collectViolations(
  json: unknown,
  exampleIndex: number,
  context: string,
  pipeline: PipelineContext,
): FieldViolation[] {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json)) {
    return json.flatMap(item => collectViolations(item, exampleIndex, context, pipeline));
  }

  const obj = json as Record<string, unknown>;
  const violations: FieldViolation[] = [];

  // Full graph with nodes[] and edges[]
  if (Array.isArray(obj.nodes) && Array.isArray(obj.edges)) {
    for (const node of obj.nodes as unknown[]) {
      if (node && typeof node === 'object') {
        violations.push(...collectViolations(node, exampleIndex, context, pipeline));
      }
    }
    for (const edge of obj.edges as unknown[]) {
      if (edge && typeof edge === 'object') {
        violations.push(...collectViolations(edge, exampleIndex, context, pipeline));
      }
    }
    return violations;
  }

  // Patch operation with operations[]
  if (Array.isArray(obj.operations)) {
    for (const op of obj.operations as unknown[]) {
      if (op && typeof op === 'object') {
        const opObj = op as Record<string, unknown>;
        if (isPatchOperation(opObj)) {
          violations.push(...validatePatchOperation(opObj, exampleIndex, context, pipeline));
        }
      }
    }
    return violations;
  }

  // Standalone patch operation
  if (isPatchOperation(obj)) {
    return validatePatchOperation(obj, exampleIndex, context, pipeline);
  }

  // Standalone node
  if (isNodeShape(obj)) {
    return validateNodeFields(obj, exampleIndex, context, pipeline);
  }

  // Standalone edge
  if (isEdgeShape(obj)) {
    return validateEdgeFields(obj, exampleIndex, context);
  }

  return violations;
}

/**
 * Validate a single patch operation.
 *
 * For add_node/add_edge: validates value fields against canonical sets.
 * For update_node/update_edge: also simulates normalisePath + scalar wrapping
 * to catch M3 (dotted keys) and M4 (nested path keys).
 */
function validatePatchOperation(
  op: Record<string, unknown>,
  exampleIndex: number,
  context: string,
  pipeline: PipelineContext,
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  const opType = op.op as string;
  const path = op.path as string;
  const value = op.value as Record<string, unknown> | undefined;

  // Check edge path format
  if (['add_edge', 'remove_edge', 'update_edge'].includes(opType)) {
    const edgePath = path.startsWith('/edges/') ? path.slice(7).split('/')[0] : path;
    violations.push(...validateEdgePath(edgePath, exampleIndex, context));
  }

  // For update ops: simulate normalisePath + scalar wrapping and validate
  // the RESULTING value (what PLoT actually receives after CEE transforms)
  if (opType === 'update_node' || opType === 'update_edge') {
    violations.push(...validateUpdateOpAfterNormalisation(op, exampleIndex, context, pipeline));
  }

  if (!value || typeof value !== 'object') return violations;

  // Direct value validation (for add ops and update ops with object values)
  switch (opType) {
    case 'add_node':
      violations.push(...validateNodeFields(value, exampleIndex, context, pipeline));
      break;
    case 'add_edge':
      violations.push(...validateEdgeFields(value, exampleIndex, context));
      break;
    case 'update_node':
      violations.push(...validateNodeFields(value, exampleIndex, context, pipeline));
      break;
    case 'update_edge':
      violations.push(...validateEdgeFields(value, exampleIndex, context));
      break;
  }

  return violations;
}
