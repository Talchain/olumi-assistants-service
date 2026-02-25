/**
 * PatchOperation Structural Validation
 *
 * Zod discriminated union schema + referential integrity checks for PatchOperation[].
 * CEE-side structural gatekeeper. Validates syntax and referential integrity only.
 * Does NOT perform semantic validation — that is PLoT's responsibility.
 *
 * Location note: This schema should eventually move to a shared @olumi/schemas
 * package so PLoT's /v1/validate-patch ingress can import the same schema.
 */

import { z } from "zod";

// ============================================================================
// Valid operation types (must match PatchOperation.op in types.ts)
// ============================================================================

const PatchOp = z.enum([
  'add_node',
  'remove_node',
  'update_node',
  'add_edge',
  'remove_edge',
  'update_edge',
]);

// ============================================================================
// Value schemas — permissive for LLM output. PLoT enforces full semantics.
// ============================================================================

/**
 * Node value for add_node — requires id, kind, label at minimum.
 * .passthrough() allows additional fields (data, category, etc.)
 */
const AddNodeValue = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
}).passthrough();

/**
 * Edge value for add_edge — requires full canonical edge payload.
 * All four strength/probability/direction fields are required because the
 * LLM prompt explicitly asks for them and PLoT expects canonical format.
 * .passthrough() allows additional fields (provenance, origin, etc.)
 */
const AddEdgeValue = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  strength_mean: z.number(),
  strength_std: z.number(),
  exists_probability: z.number().min(0).max(1),
  effect_direction: z.enum(["positive", "negative"]),
}).passthrough();

/** Partial node update value — at least one field required */
const UpdateNodeValue = z.record(z.string(), z.unknown()).refine(
  (v) => Object.keys(v).length > 0,
  { message: "update_node value must have at least one field" },
);

/** Partial edge update value — at least one field required */
const UpdateEdgeValue = z.record(z.string(), z.unknown()).refine(
  (v) => Object.keys(v).length > 0,
  { message: "update_edge value must have at least one field" },
);

// ============================================================================
// Discriminated Union Schema
// ============================================================================

const AddNodeOp = z.object({
  op: z.literal('add_node'),
  path: z.string().min(1),
  value: AddNodeValue,
  old_value: z.unknown().optional(),
});

const RemoveNodeOp = z.object({
  op: z.literal('remove_node'),
  path: z.string().min(1),
  value: z.unknown().optional(),
  old_value: z.unknown().optional(),
});

const UpdateNodeOp = z.object({
  op: z.literal('update_node'),
  path: z.string().min(1),
  value: UpdateNodeValue,
  old_value: z.unknown().optional(),
});

const AddEdgeOp = z.object({
  op: z.literal('add_edge'),
  path: z.string().min(1),
  value: AddEdgeValue,
  old_value: z.unknown().optional(),
});

const RemoveEdgeOp = z.object({
  op: z.literal('remove_edge'),
  path: z.string().min(1),
  value: z.unknown().optional(),
  old_value: z.unknown().optional(),
});

const UpdateEdgeOp = z.object({
  op: z.literal('update_edge'),
  path: z.string().min(1),
  value: UpdateEdgeValue,
  old_value: z.unknown().optional(),
});

/**
 * Validated PatchOperation schema — discriminated union by `op` field.
 */
export const PatchOperationSchema = z.discriminatedUnion('op', [
  AddNodeOp,
  RemoveNodeOp,
  UpdateNodeOp,
  AddEdgeOp,
  RemoveEdgeOp,
  UpdateEdgeOp,
]);

export type ValidatedPatchOperation = z.infer<typeof PatchOperationSchema>;

/**
 * Schema for a full array of PatchOperations.
 */
export const PatchOperationsArraySchema = z.array(PatchOperationSchema).min(1, "At least one operation required");

// ============================================================================
// Referential Integrity
// ============================================================================

export interface ReferentialIntegrityError {
  index: number;
  op: string;
  path: string;
  message: string;
}

/**
 * Check referential integrity of validated operations against the input graph.
 *
 * Checks:
 * - update_node / remove_node: path (node ID) must exist in graph
 * - update_edge / remove_edge: from::to or edge ID must exist in graph
 * - add_node: node ID must NOT already exist
 * - add_edge: from and to node IDs must exist (or be added in same batch)
 */
export function checkReferentialIntegrity(
  operations: ValidatedPatchOperation[],
  graph: { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> },
): ReferentialIntegrityError[] {
  const errors: ReferentialIntegrityError[] = [];

  // Build sets of existing IDs
  const existingNodeIds = new Set(graph.nodes.map(n => n.id));
  const existingEdgeKeys = new Set(graph.edges.map(e => `${e.from}::${e.to}`));

  // Track nodes/edges being added in this batch (for cross-references)
  const addedNodeIds = new Set<string>();
  const removedNodeIds = new Set<string>();

  // First pass: collect adds and removes
  for (const op of operations) {
    if (op.op === 'add_node' && op.value && typeof op.value === 'object' && 'id' in op.value) {
      addedNodeIds.add((op.value as { id: string }).id);
    }
    if (op.op === 'remove_node') {
      removedNodeIds.add(op.path);
    }
  }

  // Second pass: validate each operation
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    switch (op.op) {
      case 'add_node': {
        const nodeId = (op.value as { id: string }).id;
        if (existingNodeIds.has(nodeId)) {
          errors.push({
            index: i,
            op: op.op,
            path: op.path,
            message: `Node "${nodeId}" already exists in the graph`,
          });
        }
        break;
      }

      case 'remove_node': {
        if (!existingNodeIds.has(op.path)) {
          errors.push({
            index: i,
            op: op.op,
            path: op.path,
            message: `Node "${op.path}" does not exist in the graph`,
          });
        }
        break;
      }

      case 'update_node': {
        if (!existingNodeIds.has(op.path) && !addedNodeIds.has(op.path)) {
          errors.push({
            index: i,
            op: op.op,
            path: op.path,
            message: `Node "${op.path}" does not exist in the graph`,
          });
        }
        break;
      }

      case 'add_edge': {
        const edge = op.value as { from: string; to: string };
        const fromExists = existingNodeIds.has(edge.from) || addedNodeIds.has(edge.from);
        const toExists = existingNodeIds.has(edge.to) || addedNodeIds.has(edge.to);

        if (!fromExists) {
          errors.push({
            index: i,
            op: op.op,
            path: op.path,
            message: `Edge source node "${edge.from}" does not exist`,
          });
        }
        if (!toExists) {
          errors.push({
            index: i,
            op: op.op,
            path: op.path,
            message: `Edge target node "${edge.to}" does not exist`,
          });
        }

        // Check if from or to is being removed in same batch
        if (removedNodeIds.has(edge.from)) {
          errors.push({
            index: i,
            op: op.op,
            path: op.path,
            message: `Edge source node "${edge.from}" is being removed in the same batch`,
          });
        }
        if (removedNodeIds.has(edge.to)) {
          errors.push({
            index: i,
            op: op.op,
            path: op.path,
            message: `Edge target node "${edge.to}" is being removed in the same batch`,
          });
        }
        break;
      }

      case 'remove_edge': {
        // Path may be "from::to" or an edge ID
        const isFromTo = op.path.includes('::');
        if (isFromTo) {
          if (!existingEdgeKeys.has(op.path)) {
            errors.push({
              index: i,
              op: op.op,
              path: op.path,
              message: `Edge "${op.path}" does not exist in the graph`,
            });
          }
        }
        // If it's not from::to format, we can't validate without edge IDs — let PLoT handle
        break;
      }

      case 'update_edge': {
        const isFromTo = op.path.includes('::');
        if (isFromTo && !existingEdgeKeys.has(op.path)) {
          errors.push({
            index: i,
            op: op.op,
            path: op.path,
            message: `Edge "${op.path}" does not exist in the graph`,
          });
        }
        break;
      }
    }
  }

  return errors;
}

// ============================================================================
// Convenience: validate + referential integrity in one call
// ============================================================================

export interface PatchValidationResult {
  valid: boolean;
  operations: ValidatedPatchOperation[];
  zodErrors?: z.ZodError;
  referentialErrors?: ReferentialIntegrityError[];
}

/**
 * Validate PatchOperation[] from raw parsed JSON.
 *
 * 1. Zod schema validation (discriminated union)
 * 2. Referential integrity against input graph
 *
 * Returns { valid: true, operations } on success, or { valid: false, ...errors } on failure.
 */
export function validatePatchOperations(
  rawOps: unknown[],
  graph: { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> },
): PatchValidationResult {
  // Step 1: Zod validation
  const zodResult = PatchOperationsArraySchema.safeParse(rawOps);
  if (!zodResult.success) {
    return {
      valid: false,
      operations: [],
      zodErrors: zodResult.error,
    };
  }

  const operations = zodResult.data;

  // Step 2: Referential integrity
  const refErrors = checkReferentialIntegrity(operations, graph);
  if (refErrors.length > 0) {
    return {
      valid: false,
      operations,
      referentialErrors: refErrors,
    };
  }

  return { valid: true, operations };
}

/**
 * Format validation errors into a string for the repair prompt.
 */
export function formatPatchValidationErrors(result: PatchValidationResult): string {
  const lines: string[] = [];

  if (result.zodErrors) {
    for (const issue of result.zodErrors.issues) {
      lines.push(`Schema: ${issue.path.join('.')} — ${issue.message}`);
    }
  }

  if (result.referentialErrors) {
    for (const err of result.referentialErrors) {
      lines.push(`Integrity: op[${err.index}] ${err.op} at "${err.path}" — ${err.message}`);
    }
  }

  return lines.join('\n');
}
