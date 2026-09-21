/**
 * Prompt contract test suite.
 *
 * Validates that every JSON example embedded in edit_graph and draft_graph
 * prompts uses only fields that PLoT's validate-patch endpoint will accept.
 *
 * NOTE: This test validates the fallback prompt files (edit-graph-v6.ts,
 * defaults-v187.ts), not prompt-store-loaded content. If the active staging
 * prompts differ from these files, the test may not cover what's live.
 * TODO: Add store-loaded prompt testing when prompt store is accessible in
 * test context.
 *
 * Two validation layers:
 * 1. Prompt-level: JSON examples as written → PLoT canonical fields
 * 2. CEE-transform-level: simulate normaliseEdgeValue → validate output
 */

import { describe, it, expect } from 'vitest';
import { EDIT_GRAPH_PROMPT_V6 } from '../../src/prompts/edit-graph-v6.js';
import { DRAFT_GRAPH_PROMPT_V187 } from '../../src/prompts/defaults-v187.js';
import { extractPromptExamples } from './extract-prompt-examples.js';
import type { ExtractedExample } from './extract-prompt-examples.js';
import {
  CANONICAL_NODE_FIELDS,
  VALID_NODE_KINDS,
  collectViolations,
  validateNodeFields,
  validateEdgeFields,
  validateEdgePath,
  isNodeShape,
  isEdgeShape,
  isPatchOperation,
  type FieldViolation,
} from './canonical-fields.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find all node shapes in an extracted example (handles full graphs, arrays, nested ops).
 */
function findNodes(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json)) return json.flatMap(findNodes);
  const obj = json as Record<string, unknown>;
  const nodes: Record<string, unknown>[] = [];
  if (Array.isArray(obj.nodes)) nodes.push(...(obj.nodes as Record<string, unknown>[]).filter(isNodeShape));
  if (isPatchOperation(obj) && obj.op === 'add_node' && obj.value && typeof obj.value === 'object') {
    nodes.push(obj.value as Record<string, unknown>);
  }
  if (Array.isArray(obj.operations)) {
    for (const op of obj.operations as Record<string, unknown>[]) {
      if (op?.op === 'add_node' && op.value && typeof op.value === 'object') {
        nodes.push(op.value as Record<string, unknown>);
      }
    }
  }
  if (isNodeShape(obj) && !obj.operations && !obj.nodes) nodes.push(obj);
  return nodes;
}

/**
 * Find all edge shapes in an extracted example.
 */
function findEdges(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json)) return json.flatMap(findEdges);
  const obj = json as Record<string, unknown>;
  const edges: Record<string, unknown>[] = [];
  if (Array.isArray(obj.edges)) edges.push(...(obj.edges as Record<string, unknown>[]).filter(isEdgeShape));
  if (isPatchOperation(obj) && obj.op === 'add_edge' && obj.value && typeof obj.value === 'object') {
    edges.push(obj.value as Record<string, unknown>);
  }
  if (Array.isArray(obj.operations)) {
    for (const op of obj.operations as Record<string, unknown>[]) {
      if (op?.op === 'add_edge' && op.value && typeof op.value === 'object') {
        edges.push(op.value as Record<string, unknown>);
      }
    }
  }
  // old_value on remove_edge also contains edge shapes
  if (Array.isArray(obj.operations)) {
    for (const op of obj.operations as Record<string, unknown>[]) {
      if (op?.op === 'remove_edge' && op.old_value && typeof op.old_value === 'object') {
        edges.push(op.old_value as Record<string, unknown>);
      }
    }
  }
  if (isEdgeShape(obj) && !obj.operations && !obj.nodes) edges.push(obj);
  return edges;
}

/**
 * Find all edge paths in patch operations.
 */
function findEdgePaths(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json)) return json.flatMap(findEdgePaths);
  const obj = json as Record<string, unknown>;
  const paths: string[] = [];
  if (Array.isArray(obj.operations)) {
    for (const op of obj.operations as Record<string, unknown>[]) {
      if (op && typeof op.path === 'string') {
        const opType = op.op as string;
        if (['add_edge', 'remove_edge', 'update_edge'].includes(opType)) {
          paths.push(op.path as string);
        }
      }
    }
  }
  if (isPatchOperation(obj) && typeof obj.path === 'string') {
    const opType = obj.op as string;
    if (['add_edge', 'remove_edge', 'update_edge'].includes(opType)) {
      paths.push(obj.path as string);
    }
  }
  return paths;
}

// ═══════════════════════════════════════════════════════════════════════════════
// edit_graph v6
// ═══════════════════════════════════════════════════════════════════════════════

describe('Prompt contract: edit_graph v6', () => {
  const examples = extractPromptExamples(EDIT_GRAPH_PROMPT_V6);

  it('extracts at least 6 JSON examples (6 numbered examples in prompt)', () => {
    expect(examples.length).toBeGreaterThanOrEqual(6);
  });

  // ---------- Prompt-level validation ----------

  describe('prompt-level: add_node values use only canonical node fields', () => {
    it('all add_node values in prompt examples use only canonical fields', () => {
      // Collect all add_node values with their source example for clear reporting
      const nodesWithSource: Array<{ node: Record<string, unknown>; ex: ExtractedExample }> = [];
      for (const ex of examples) {
        if (!ex.json || typeof ex.json !== 'object') continue;
        const obj = ex.json as Record<string, unknown>;
        if (!Array.isArray(obj.operations)) continue;
        for (const op of obj.operations as Record<string, unknown>[]) {
          if (op?.op === 'add_node' && op.value && typeof op.value === 'object') {
            nodesWithSource.push({ node: op.value as Record<string, unknown>, ex });
          }
        }
      }
      expect(nodesWithSource.length).toBeGreaterThan(0);

      for (const { node, ex } of nodesWithSource) {
        const violations = validateNodeFields(
          node,
          ex.exampleIndex,
          `add_node "${node.id}" | ${ex.context.slice(-40)}`,
          'edit_graph',
        );
        expect(
          violations,
          `add_node "${node.id}" in example ${ex.exampleIndex} has non-canonical fields: ` +
          `${violations.map(v => v.field).join(', ')}`,
        ).toHaveLength(0);
      }
    });
  });

  describe('prompt-level: add_edge values use only canonical edge fields', () => {
    it('all edge values in prompt examples use canonical fields', () => {
      const allEdges = examples.flatMap(ex => findEdges(ex.json));
      expect(allEdges.length).toBeGreaterThan(0);

      for (const edge of allEdges) {
        const violations = validateEdgeFields(edge, 0, 'edit_graph edge');
        // Prompt teaches canonical format: from, to, strength: {mean,std}, exists_probability, effect_direction
        expect(violations).toHaveLength(0);
      }
    });
  });

  describe('prompt-level: edge paths use -> separator', () => {
    it('no edge path uses :: separator', () => {
      const paths = examples.flatMap(ex => findEdgePaths(ex.json));
      expect(paths.length).toBeGreaterThan(0);

      for (const path of paths) {
        // Extract the edge key (strip /edges/ prefix and /field suffix)
        const match = path.match(/\/edges\/([^/]+)/);
        const edgeKey = match ? match[1] : path;
        const violations = validateEdgePath(edgeKey, 0, 'edit_graph path');
        expect(violations).toHaveLength(0);
      }
    });
  });

  describe('prompt-level: option node template teaches non-canonical data wrapper', () => {
    it('option template in <node_shapes> has data: { interventions: {} } — non-canonical', () => {
      // The prompt's <node_shapes> section teaches:
      // Option: { id: "opt_<slug>", kind: "option", label: "...", data: { interventions: {} } }
      // data is NOT in CANONICAL_NODE_FIELDS
      const optionTemplate = { id: 'opt_test', kind: 'option', label: 'Test', data: { interventions: {} } };
      const violations = validateNodeFields(optionTemplate, 0, '<node_shapes> option template', 'edit_graph');
      expect(violations.map(v => v.field)).toContain('data');
    });
  });

  describe('prompt-level: factor data templates teach non-canonical data wrapper', () => {
    it('controllable factor template has data: {...} — non-canonical for edit_graph', () => {
      const factorTemplate = {
        id: 'fac_test', kind: 'factor', label: 'Test', category: 'controllable',
        data: { value: 0.6, raw_value: 180000, unit: '£', cap: 300000, extractionType: 'explicit', factor_type: 'cost' },
      };
      const violations = validateNodeFields(factorTemplate, 0, '<node_shapes> factor template', 'edit_graph');
      expect(violations.map(v => v.field)).toContain('data');
    });
  });

  describe('prompt-level: Example 2 intervention update value', () => {
    it('intervention value object has non-canonical fields as node update', () => {
      // Example 2 teaches: update_node with
      //   path: /nodes/opt_raise_price/data/interventions/fac_marketing_spend
      //   value: { value: 0.25, raw_value: 25000, unit: "£", cap: 100000 }
      // After normalisePath, this becomes a node update where PLoT sees
      // the value object directly — these fields are NOT canonical node fields
      const interventionValue = { value: 0.25, raw_value: 25000, unit: '£', cap: 100000 };
      const violations = validateNodeFields(interventionValue, 0, 'Example 2 intervention', 'edit_graph');
      expect(violations.length).toBe(4);
      const fields = violations.map(v => v.field);
      expect(fields).toContain('value');
      expect(fields).toContain('raw_value');
      expect(fields).toContain('unit');
      expect(fields).toContain('cap');
    });
  });

  // ---------- CEE-transform-level validation (M1 FIXED) ----------

  describe('CEE-transform-level: M1 fix — canonical edges pass through unchanged', () => {
    it('all prompt example edges with nested strength pass canonical validation', () => {
      // After M1 fix: normaliseEdgeValue was removed, so canonical edges
      // from the prompt are no longer flattened into non-canonical format.
      const edgesWithSource: Array<{ edge: Record<string, unknown>; ex: ExtractedExample }> = [];
      for (const ex of examples) {
        const edges = findEdges(ex.json);
        for (const edge of edges) {
          if (edge.strength && typeof edge.strength === 'object') {
            edgesWithSource.push({ edge, ex });
          }
        }
      }
      expect(edgesWithSource.length).toBeGreaterThan(0);

      for (const { edge, ex } of edgesWithSource) {
        // Canonical edges should pass validation WITHOUT any transform
        const violations = validateEdgeFields(
          edge,
          ex.exampleIndex,
          `M1 fix: canonical passthrough | ${ex.context.slice(-40)}`,
        );
        expect(
          violations.length,
          `Unexpected violation(s) for canonical edge ${edge.from}->${edge.to} ` +
          `in example ${ex.exampleIndex}: ${violations.map(v => v.field).join(', ')}`,
        ).toBe(0);
      }
    });
  });

  // ---------- Full collectViolations scan (hard-fail) ----------

  /**
   * Known violations snapshot for edit_graph v6.
   * Each entry: "entity:field:exampleIndex" — uniquely identifies a known gap.
   * When a prompt is fixed, REMOVE the entry. When a new violation appears, the
   * test fails until the violation is either fixed or explicitly acknowledged here.
   */
  const EDIT_GRAPH_KNOWN_VIOLATIONS = new Set([
    // M3: Example 1 (index 0) — /edges/.../strength.mean with scalar → { "strength.mean": val }
    'edge:strength.mean:0',
    // M4: Example 2 (index 1) intervention value keys are not canonical node fields
    'node:value:1',
    'node:raw_value:1',
    'node:unit:1',
    'node:cap:1',
    // M3/M4: Example 2 (index 1) — nested field path after normalisePath
    'node:data/interventions/fac_marketing_spend:1',
  ]);

  describe('full scan: all examples against edit_graph context', () => {
    it('hard-fails on any NEW violation not in the known-violations snapshot', () => {
      const allViolations: FieldViolation[] = [];
      for (const ex of examples) {
        allViolations.push(...collectViolations(ex.json, ex.exampleIndex, ex.context, 'edit_graph'));
      }

      const violationKeys = allViolations.map(v => `${v.entity}:${v.field}:${v.exampleIndex}`);
      const newViolations = allViolations.filter(
        (v, i) => !EDIT_GRAPH_KNOWN_VIOLATIONS.has(violationKeys[i]),
      );

      if (newViolations.length > 0) {
        const details = newViolations.map(v =>
          `  [${v.entity}] "${v.field}" in example ${v.exampleIndex} ` +
          `(context: "${v.context.slice(-40)}"): ${v.reason}`,
        ).join('\n');
        expect.fail(
          `${newViolations.length} NEW contract violation(s) in edit_graph v6 ` +
          `(not in known-violations snapshot):\n${details}\n\n` +
          `Fix the prompt or add to EDIT_GRAPH_KNOWN_VIOLATIONS if intentional.`,
        );
      }
    });

    it('detects when a known violation is fixed (update snapshot)', () => {
      const allViolations: FieldViolation[] = [];
      for (const ex of examples) {
        allViolations.push(...collectViolations(ex.json, ex.exampleIndex, ex.context, 'edit_graph'));
      }

      const currentKeys = new Set(allViolations.map(v => `${v.entity}:${v.field}:${v.exampleIndex}`));
      const staleEntries = [...EDIT_GRAPH_KNOWN_VIOLATIONS].filter(k => !currentKeys.has(k));
      if (staleEntries.length > 0) {
        expect.fail(
          `${staleEntries.length} known violation(s) no longer appear — ` +
          `remove from EDIT_GRAPH_KNOWN_VIOLATIONS:\n  ${staleEntries.join('\n  ')}`,
        );
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// draft_graph v187
// ═══════════════════════════════════════════════════════════════════════════════

describe('Prompt contract: draft_graph v187', () => {
  const examples = extractPromptExamples(DRAFT_GRAPH_PROMPT_V187);

  it('extracts at least one annotated example with nodes and edges', () => {
    const graphExamples = examples.filter(ex => {
      const json = ex.json as Record<string, unknown>;
      return Array.isArray(json.nodes) && Array.isArray(json.edges);
    });
    expect(graphExamples.length).toBeGreaterThanOrEqual(1);
  });

  // ---------- Edge validation ----------

  describe('edge shapes are fully canonical', () => {
    it('all edges use canonical fields (from, to, strength, exists_probability, effect_direction, edge_type)', () => {
      const allEdges = examples.flatMap(ex => findEdges(ex.json));
      expect(allEdges.length).toBeGreaterThan(0);

      for (const edge of allEdges) {
        const violations = validateEdgeFields(edge, 0, 'draft_graph edge');
        expect(violations).toHaveLength(0);
      }
    });

    it('all edges use nested strength: { mean, std } (not flat)', () => {
      const allEdges = examples.flatMap(ex => findEdges(ex.json));
      for (const edge of allEdges) {
        if (edge.strength !== undefined) {
          expect(typeof edge.strength).toBe('object');
          const s = edge.strength as Record<string, unknown>;
          expect(s).toHaveProperty('mean');
          expect(s).toHaveProperty('std');
        }
      }
    });
  });

  // ---------- Node validation (draft_graph context) ----------

  describe('node shapes acceptable in draft_graph context (data wrapper tolerated)', () => {
    it('all node fields are either canonical or data-wrapped (normaliser handles)', () => {
      const allViolations: FieldViolation[] = [];
      for (const ex of examples) {
        allViolations.push(...collectViolations(ex.json, ex.exampleIndex, ex.context, 'draft_graph'));
      }
      // In draft_graph context, data wrapper is tolerated
      const realViolations = allViolations.filter(v => v.field !== 'data');
      expect(realViolations).toHaveLength(0);
    });
  });

  describe('node kinds are valid', () => {
    it('all nodes use valid PLoT node kinds', () => {
      const allNodes = examples.flatMap(ex => findNodes(ex.json));
      for (const node of allNodes) {
        if (typeof node.kind === 'string') {
          expect(
            VALID_NODE_KINDS.has(node.kind),
            `Node "${node.id}" has invalid kind "${node.kind}"`,
          ).toBe(true);
        }
      }
    });
  });

  // ---------- category field validation ----------

  describe('category field is canonical and correctly used', () => {
    it('category is in CANONICAL_NODE_FIELDS', () => {
      expect(CANONICAL_NODE_FIELDS.has('category')).toBe(true);
    });

    it('factor nodes use valid category values', () => {
      const allNodes = examples.flatMap(ex => findNodes(ex.json));
      const factors = allNodes.filter(n => n.kind === 'factor');
      expect(factors.length).toBeGreaterThan(0);

      const validCategories = new Set(['controllable', 'observable', 'external']);
      for (const factor of factors) {
        if (factor.category) {
          expect(
            validCategories.has(factor.category as string),
            `Factor "${factor.id}" has invalid category "${factor.category}"`,
          ).toBe(true);
        }
      }
    });

    it('non-factor nodes do not have category', () => {
      const allNodes = examples.flatMap(ex => findNodes(ex.json));
      const nonFactors = allNodes.filter(n => n.kind !== 'factor');
      for (const node of nonFactors) {
        expect(
          node.category,
          `Non-factor node "${node.id}" (kind: ${node.kind}) should not have category`,
        ).toBeUndefined();
      }
    });
  });

  // ---------- Option intervention values ----------

  describe('option intervention values are numeric scalars', () => {
    it('all intervention values in option nodes are numbers (not objects)', () => {
      const allNodes = examples.flatMap(ex => findNodes(ex.json));
      const options = allNodes.filter(n => n.kind === 'option');
      expect(options.length).toBeGreaterThan(0);

      for (const opt of options) {
        const data = opt.data as Record<string, unknown> | undefined;
        if (data?.interventions && typeof data.interventions === 'object') {
          const interventions = data.interventions as Record<string, unknown>;
          for (const [factorId, value] of Object.entries(interventions)) {
            expect(
              typeof value,
              `Option "${opt.id}" intervention for "${factorId}" should be a number, got ${typeof value}`,
            ).toBe('number');
          }
        }
      }
    });
  });

  // ---------- Goal threshold fields ----------

  describe('goal node threshold fields are canonical', () => {
    it('goal nodes use canonical threshold fields', () => {
      const allNodes = examples.flatMap(ex => findNodes(ex.json));
      const goals = allNodes.filter(n => n.kind === 'goal');
      expect(goals.length).toBeGreaterThan(0);

      for (const goal of goals) {
        const violations = validateNodeFields(goal, 0, 'draft_graph goal', 'draft_graph');
        expect(violations).toHaveLength(0);
      }
    });
  });

  // ---------- Cross-pipeline validation ----------

  describe('cross-pipeline: draft_graph node shapes would fail in edit_graph context', () => {
    it('data wrapper on nodes is rejected by validate-patch (documents M2)', () => {
      const allViolations: FieldViolation[] = [];
      for (const ex of examples) {
        allViolations.push(...collectViolations(ex.json, ex.exampleIndex, ex.context, 'edit_graph'));
      }
      const dataViolations = allViolations.filter(v => v.field === 'data');
      // Option nodes + controllable/observable factors all have data wrapper
      expect(dataViolations.length).toBeGreaterThan(0);
    });
  });

  // ---------- CEE-transform-level: M1 FIXED for draft_graph too ----------

  describe('CEE-transform-level: M1 fix — draft_graph edges pass canonical validation', () => {
    it('all draft_graph edges with nested strength pass validation without flattening', () => {
      const edgesWithSource: Array<{ edge: Record<string, unknown>; ex: ExtractedExample }> = [];
      for (const ex of examples) {
        const edges = findEdges(ex.json);
        for (const edge of edges) {
          if (edge.strength && typeof edge.strength === 'object') {
            edgesWithSource.push({ edge, ex });
          }
        }
      }
      expect(edgesWithSource.length).toBeGreaterThan(0);

      for (const { edge, ex } of edgesWithSource) {
        // After M1 fix: canonical edges pass validation without any transform
        const violations = validateEdgeFields(
          edge,
          ex.exampleIndex,
          `M1 fix: draft_graph canonical passthrough | ${ex.context.slice(-40)}`,
        );
        expect(
          violations.length,
          `Unexpected violation(s) for canonical edge ${edge.from}->${edge.to} ` +
          `in example ${ex.exampleIndex}: ${violations.map(v => v.field).join(', ')}`,
        ).toBe(0);
      }
    });
  });

  // ---------- Full scan (hard-fail) ----------

  /**
   * Known violations snapshot for draft_graph v187 in draft_graph context.
   * draft_graph context tolerates `data` wrapper, so only non-data violations appear.
   * Update this set when the prompt changes.
   */
  const DRAFT_GRAPH_KNOWN_VIOLATIONS = new Set<string>([
    // Currently no known violations in draft_graph context
    // (data wrapper is tolerated by PLoT normaliser)
  ]);

  describe('full scan: all examples against draft_graph context', () => {
    it('hard-fails on any NEW violation not in the known-violations snapshot', () => {
      const allViolations: FieldViolation[] = [];
      for (const ex of examples) {
        allViolations.push(...collectViolations(ex.json, ex.exampleIndex, ex.context, 'draft_graph'));
      }

      const violationKeys = allViolations.map(v => `${v.entity}:${v.field}:${v.exampleIndex}`);
      const newViolations = allViolations.filter(
        (v, i) => !DRAFT_GRAPH_KNOWN_VIOLATIONS.has(violationKeys[i]),
      );

      if (newViolations.length > 0) {
        const details = newViolations.map(v =>
          `  [${v.entity}] "${v.field}" in example ${v.exampleIndex} ` +
          `(context: "${v.context.slice(-40)}"): ${v.reason}`,
        ).join('\n');
        expect.fail(
          `${newViolations.length} NEW contract violation(s) in draft_graph v187 ` +
          `(not in known-violations snapshot):\n${details}\n\n` +
          `Fix the prompt or add to DRAFT_GRAPH_KNOWN_VIOLATIONS if intentional.`,
        );
      }
    });

    it('detects when a known violation is fixed (update snapshot)', () => {
      const allViolations: FieldViolation[] = [];
      for (const ex of examples) {
        allViolations.push(...collectViolations(ex.json, ex.exampleIndex, ex.context, 'draft_graph'));
      }

      const currentKeys = new Set(allViolations.map(v => `${v.entity}:${v.field}:${v.exampleIndex}`));
      const staleEntries = [...DRAFT_GRAPH_KNOWN_VIOLATIONS].filter(k => !currentKeys.has(k));
      if (staleEntries.length > 0) {
        expect.fail(
          `${staleEntries.length} known violation(s) no longer appear — ` +
          `remove from DRAFT_GRAPH_KNOWN_VIOLATIONS:\n  ${staleEntries.join('\n  ')}`,
        );
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// M5 confirmation: intervention authority
// ═══════════════════════════════════════════════════════════════════════════════

describe('M5 [CONFIRMED]: Intervention writes via node.data.interventions are dead code', () => {
  it('documents that PLoT reads interventions from options[] not node fields', () => {
    // This test documents the confirmed finding, not a code assertion.
    // PLoT's /v2/run pipeline:
    // 1. filterOptionNodes() strips all option nodes (kind='option', 'decision')
    // 2. Only the separate options[] request parameter provides interventions to ISL
    // 3. node.data.interventions is silently discarded
    //
    // Source: plot-lite-service/src/normalisation/option-filter.ts (filterOptionNodes)
    //         plot-lite-service/src/routes/v2/run.ts line 2404
    //         plot-lite-service/src/integrations/isl/translator-v3.ts (toISLRobustnessRequest)
    //
    // IMPACT: edit_graph prompt Example 2 teaches writing to
    //   /nodes/opt_raise_price/data/interventions/fac_marketing_spend
    // This write modifies the graph node but the intervention value
    // NEVER reaches PLoT's analysis pipeline.
    //
    // RECOMMENDATION: edit_graph intervention updates must also update
    // the separate options[] array, or the intervention editing flow
    // is fundamentally broken.
    expect(true).toBe(true); // Documentation test — finding confirmed via code audit
  });
});
