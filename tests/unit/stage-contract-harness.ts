/**
 * Shared contract test harness for unified-pipeline stage contracts.
 *
 * Provides reusable assertion helpers for field preservation testing.
 * Each stage test file builds its own fixture and runs the stage;
 * this harness provides the assertion logic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldScope {
  readonly topLevel: readonly string[];
  readonly node: readonly string[];
  readonly edge: readonly string[];
  readonly option: readonly string[];
  readonly nodeData: readonly string[];
}

export interface StageContract {
  readonly name: string;
  readonly allowedDrops: FieldScope;
  readonly allowedModifications: FieldScope;
  readonly preservationGuarantees: FieldScope;
  readonly allowedRemovals: { readonly nodes: boolean; readonly edges: boolean };
  readonly allowedDataClear?: { readonly externalFactors: boolean };
}

export interface ContractViolation {
  type: "unexpected_drop" | "unexpected_modification" | "guarantee_violated" | "canary_lost";
  path: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Sentinel assertion (reusable across tests)
// ---------------------------------------------------------------------------

/**
 * Assert a sentinel field survived at a given path.
 * Throws with descriptive message on drop or modification.
 */
export function assertSentinel(
  actual: unknown,
  expected: unknown,
  path: string,
): void {
  if (actual === undefined) {
    throw new Error(
      `UNEXPECTED DROP at ${path}: field was present in input but missing in output`,
    );
  }
  if (actual !== expected) {
    throw new Error(
      `UNEXPECTED MODIFICATION at ${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Node/edge lookup helpers
// ---------------------------------------------------------------------------

function findNode(nodes: any[], id: string, label?: string): any | undefined {
  return nodes.find((n: any) => n.id === id)
    ?? nodes.find((n: any) => n.label === label);
}

function findEdge(edges: any[], id: string, from: string, to: string): any | undefined {
  return edges.find((e: any) => e.id === id)
    ?? edges.find((e: any) => e.from === from && e.to === to);
}

// ---------------------------------------------------------------------------
// Preservation guarantee assertions
// ---------------------------------------------------------------------------

/**
 * Assert that all fields listed in `preservationGuarantees` are present
 * and unchanged between baseline and output.
 */
export function assertPreservationGuarantees(
  contract: StageContract,
  baseline: any,
  output: any,
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  // Top-level fields
  for (const field of contract.preservationGuarantees.topLevel) {
    if (baseline[field] === undefined) continue; // field not in baseline
    if (output[field] === undefined) {
      violations.push({
        type: "guarantee_violated",
        path: `graph.${field}`,
        detail: `Preservation guarantee violated: ${field} was dropped`,
      });
    } else if (output[field] !== baseline[field]) {
      violations.push({
        type: "guarantee_violated",
        path: `graph.${field}`,
        detail: `Preservation guarantee violated: ${field} changed from ${JSON.stringify(baseline[field])} to ${JSON.stringify(output[field])}`,
      });
    }
  }

  // Node-level fields
  const baselineNodes = baseline.nodes ?? [];
  const outputNodes = output.nodes ?? [];
  for (const bNode of baselineNodes) {
    const oNode = findNode(outputNodes, bNode.id, bNode.label);
    if (!oNode) continue; // node removed — not a guarantee violation (handled by allowedRemovals)

    for (const field of contract.preservationGuarantees.node) {
      if (bNode[field] === undefined) continue;
      if (oNode[field] === undefined) {
        violations.push({
          type: "guarantee_violated",
          path: `nodes[${bNode.id}].${field}`,
          detail: `Preservation guarantee violated: ${field} was dropped`,
        });
      } else if (oNode[field] !== bNode[field]) {
        violations.push({
          type: "guarantee_violated",
          path: `nodes[${bNode.id}].${field}`,
          detail: `Preservation guarantee violated: ${field} changed from ${JSON.stringify(bNode[field])} to ${JSON.stringify(oNode[field])}`,
        });
      }
    }
  }

  // Edge-level fields
  const baselineEdges = baseline.edges ?? [];
  const outputEdges = output.edges ?? [];
  for (const bEdge of baselineEdges) {
    const oEdge = findEdge(outputEdges, bEdge.id, bEdge.from, bEdge.to);
    if (!oEdge) continue; // edge removed — handled by allowedRemovals

    for (const field of contract.preservationGuarantees.edge) {
      if (bEdge[field] === undefined) continue;
      if (oEdge[field] === undefined) {
        violations.push({
          type: "guarantee_violated",
          path: `edges[${bEdge.id}].${field}`,
          detail: `Preservation guarantee violated: ${field} was dropped`,
        });
      } else if (oEdge[field] !== bEdge[field]) {
        violations.push({
          type: "guarantee_violated",
          path: `edges[${bEdge.id}].${field}`,
          detail: `Preservation guarantee violated: ${field} changed from ${JSON.stringify(bEdge[field])} to ${JSON.stringify(oEdge[field])}`,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Full contract compliance check
// ---------------------------------------------------------------------------

/**
 * Validate full contract compliance between baseline and output graph.
 *
 * Checks:
 * 1. All canary (_sentinel_*) fields survive at all depths
 * 2. Any removed field is declared in allowedDrops
 * 3. Any changed field is declared in allowedModifications
 * 4. preservationGuarantees fields are present and unchanged
 *
 * Returns all violations found. Call `expect(violations).toEqual([])` in test.
 */
export function validateContractCompliance(
  contract: StageContract,
  baseline: any,
  output: any,
  opts?: {
    /** Node IDs where data was cleared entirely (allowedDataClear) — skip per-field data checks */
    skipDataForNodeIds?: string[];
  },
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const skipDataIds = new Set(opts?.skipDataForNodeIds ?? []);

  // --- Top-level fields ---
  for (const key of Object.keys(baseline)) {
    if (key === "nodes" || key === "edges" || key === "meta") continue;
    if (output[key] === undefined) {
      if (contract.allowedDrops.topLevel.includes(key)) continue;
      if (key.startsWith("_sentinel_")) {
        violations.push({ type: "canary_lost", path: `graph.${key}`, detail: `Canary field dropped` });
      } else {
        violations.push({ type: "unexpected_drop", path: `graph.${key}`, detail: `Undeclared field drop` });
      }
    } else if (output[key] !== baseline[key] && typeof baseline[key] !== "object") {
      if (contract.allowedModifications.topLevel.includes(key)) continue;
      if (key.startsWith("_sentinel_")) {
        violations.push({ type: "canary_lost", path: `graph.${key}`, detail: `Canary field modified` });
      } else {
        violations.push({
          type: "unexpected_modification",
          path: `graph.${key}`,
          detail: `Undeclared field modification: ${JSON.stringify(baseline[key])} → ${JSON.stringify(output[key])}`,
        });
      }
    }
  }

  // --- Node-level fields ---
  const baselineNodes = baseline.nodes ?? [];
  const outputNodes = output.nodes ?? [];
  for (const bNode of baselineNodes) {
    const oNode = findNode(outputNodes, bNode.id, bNode.label);
    if (!oNode) {
      if (!contract.allowedRemovals.nodes) {
        violations.push({ type: "unexpected_drop", path: `nodes[${bNode.id}]`, detail: `Node removed but allowedRemovals.nodes=false` });
      }
      continue;
    }

    // Check node-level fields (excluding 'data')
    for (const key of Object.keys(bNode)) {
      if (key === "data") continue;
      if (oNode[key] === undefined) {
        if (contract.allowedDrops.node.includes(key)) continue;
        if (key.startsWith("_sentinel_")) {
          violations.push({ type: "canary_lost", path: `nodes[${bNode.id}].${key}`, detail: `Canary field dropped` });
        } else {
          violations.push({ type: "unexpected_drop", path: `nodes[${bNode.id}].${key}`, detail: `Undeclared field drop` });
        }
      } else if (oNode[key] !== bNode[key] && typeof bNode[key] !== "object") {
        if (contract.allowedModifications.node.includes(key)) continue;
        if (key.startsWith("_sentinel_")) {
          violations.push({ type: "canary_lost", path: `nodes[${bNode.id}].${key}`, detail: `Canary field modified` });
        } else {
          violations.push({
            type: "unexpected_modification",
            path: `nodes[${bNode.id}].${key}`,
            detail: `Undeclared modification: ${JSON.stringify(bNode[key])} → ${JSON.stringify(oNode[key])}`,
          });
        }
      }
    }

    // Check node.data fields (skip if data was cleared per allowedDataClear)
    if (bNode.data && !skipDataIds.has(bNode.id)) {
      if (!oNode.data) {
        violations.push({ type: "unexpected_drop", path: `nodes[${bNode.id}].data`, detail: `Entire data object dropped` });
      } else {
        for (const key of Object.keys(bNode.data)) {
          if (oNode.data[key] === undefined) {
            if (contract.allowedDrops.nodeData.includes(key)) continue;
            if (key.startsWith("_sentinel_")) {
              violations.push({ type: "canary_lost", path: `nodes[${bNode.id}].data.${key}`, detail: `Canary field dropped` });
            } else {
              violations.push({ type: "unexpected_drop", path: `nodes[${bNode.id}].data.${key}`, detail: `Undeclared field drop` });
            }
          } else if (oNode.data[key] !== bNode.data[key] && typeof bNode.data[key] !== "object") {
            if (contract.allowedModifications.nodeData.includes(key)) continue;
            if (key.startsWith("_sentinel_")) {
              violations.push({ type: "canary_lost", path: `nodes[${bNode.id}].data.${key}`, detail: `Canary field modified` });
            } else {
              violations.push({
                type: "unexpected_modification",
                path: `nodes[${bNode.id}].data.${key}`,
                detail: `Undeclared modification: ${JSON.stringify(bNode.data[key])} → ${JSON.stringify(oNode.data[key])}`,
              });
            }
          }
        }
      }
    }
  }

  // --- Edge-level fields ---
  const baselineEdges = baseline.edges ?? [];
  const outputEdges = output.edges ?? [];
  for (const bEdge of baselineEdges) {
    const oEdge = findEdge(outputEdges, bEdge.id, bEdge.from, bEdge.to);
    if (!oEdge) {
      if (!contract.allowedRemovals.edges) {
        violations.push({ type: "unexpected_drop", path: `edges[${bEdge.id}]`, detail: `Edge removed but allowedRemovals.edges=false` });
      }
      continue;
    }

    for (const key of Object.keys(bEdge)) {
      if (key === "provenance" && typeof bEdge[key] === "object") continue; // nested object checked separately
      if (oEdge[key] === undefined) {
        if (contract.allowedDrops.edge.includes(key)) continue;
        if (key.startsWith("_sentinel_")) {
          violations.push({ type: "canary_lost", path: `edges[${bEdge.id}].${key}`, detail: `Canary field dropped` });
        } else {
          violations.push({ type: "unexpected_drop", path: `edges[${bEdge.id}].${key}`, detail: `Undeclared field drop` });
        }
      } else if (oEdge[key] !== bEdge[key] && typeof bEdge[key] !== "object") {
        if (contract.allowedModifications.edge.includes(key)) continue;
        if (key.startsWith("_sentinel_")) {
          violations.push({ type: "canary_lost", path: `edges[${bEdge.id}].${key}`, detail: `Canary field modified` });
        } else {
          violations.push({
            type: "unexpected_modification",
            path: `edges[${bEdge.id}].${key}`,
            detail: `Undeclared modification: ${JSON.stringify(bEdge[key])} → ${JSON.stringify(oEdge[key])}`,
          });
        }
      }
    }

    // Nested provenance sentinels
    if (bEdge.provenance && oEdge.provenance) {
      for (const key of Object.keys(bEdge.provenance)) {
        if (key.startsWith("_sentinel_") && oEdge.provenance[key] !== bEdge.provenance[key]) {
          violations.push({
            type: "canary_lost",
            path: `edges[${bEdge.id}].provenance.${key}`,
            detail: oEdge.provenance[key] === undefined ? `Canary field dropped` : `Canary field modified`,
          });
        }
      }
    }
  }

  // --- Preservation guarantees ---
  violations.push(...assertPreservationGuarantees(contract, baseline, output));

  return violations;
}
