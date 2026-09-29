/**
 * Bias Mitigation Patches Tests
 *
 * Tests for the bias mitigation patch generation system.
 * Target: 15+ tests covering all bias types and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { buildBiasMitigationPatches } from '../../src/cee/bias/mitigation-patches.js';
import type { GraphV1 } from '../../src/contracts/plot/engine.js';

// ============================================================================
// Mock Data Factories
// ============================================================================

function createMockGraph(overrides?: Partial<{ nodes: any[]; edges: any[] }>): GraphV1 {
  return {
    nodes: [
      { id: 'decision_1', kind: 'decision', label: 'Main Decision' },
      { id: 'option_1', kind: 'option', label: 'Option A' },
      { id: 'evidence_1', kind: 'evidence', label: 'Market Data' },
    ],
    edges: [
      { source: 'decision_1', target: 'option_1' },
    ],
    ...overrides,
  } as unknown as GraphV1;
}

function createBiasFinding(code: string, id?: string): any {
  return {
    id: id || `finding_${code.toLowerCase()}`,
    code,
    severity: 'medium',
    targets: { node_ids: ['decision_1'] },
    description: `Detected ${code}`,
  };
}

// ============================================================================
// buildBiasMitigationPatches Tests
// ============================================================================

describe('buildBiasMitigationPatches', () => {
  describe('Basic functionality', () => {
    it('returns empty array for empty findings', () => {
      const graph = createMockGraph();
      const patches = buildBiasMitigationPatches(graph, []);
      expect(patches).toHaveLength(0);
    });

    it('returns empty array for null graph', () => {
      const patches = buildBiasMitigationPatches(null as any, []);
      expect(patches).toHaveLength(0);
    });

    it('returns empty array for graph without nodes', () => {
      const graph = createMockGraph({ nodes: undefined as any });
      const patches = buildBiasMitigationPatches(graph, []);
      expect(patches).toHaveLength(0);
    });

    it('generates max one patch per bias code', () => {
      const graph = createMockGraph({ nodes: [{ id: 'opt', kind: 'option' }] });
      const findings = [
        createBiasFinding('SELECTION_LOW_OPTION_COUNT', 'finding_1'),
        createBiasFinding('SELECTION_LOW_OPTION_COUNT', 'finding_2'),
      ];
      const patches = buildBiasMitigationPatches(graph, findings);
      expect(patches).toHaveLength(1);
    });

    it('handles unknown bias codes gracefully', () => {
      const graph = createMockGraph();
      const findings = [createBiasFinding('UNKNOWN_BIAS_CODE')];
      const patches = buildBiasMitigationPatches(graph, findings);
      expect(patches).toHaveLength(0);
    });
  });

  describe('SELECTION_LOW_OPTION_COUNT', () => {
    it('generates option node patch', () => {
      const graph = createMockGraph({ nodes: [{ id: 'opt', kind: 'option' }] });
      const findings = [createBiasFinding('SELECTION_LOW_OPTION_COUNT')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches).toHaveLength(1);
      expect(patches[0].bias_code).toBe('SELECTION_LOW_OPTION_COUNT');
      expect(patches[0].patch?.adds?.nodes).toHaveLength(1);
      expect(patches[0].patch?.adds?.nodes?.[0].kind).toBe('option');
    });

    it('generates unique node ID', () => {
      const graph = createMockGraph({
        nodes: [
          { id: 'cee_bias_mitigation_option_1', kind: 'option' },
        ],
      });
      const findings = [createBiasFinding('SELECTION_LOW_OPTION_COUNT')];
      const patches = buildBiasMitigationPatches(graph, findings);

      const newNodeId = patches[0].patch?.adds?.nodes?.[0].id;
      expect(newNodeId).toBe('cee_bias_mitigation_option_2');
    });

    it('includes bias_id from finding', () => {
      const graph = createMockGraph({ nodes: [] });
      const findings = [createBiasFinding('SELECTION_LOW_OPTION_COUNT', 'my_finding_id')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches[0].bias_id).toBe('my_finding_id');
    });

    it('includes description', () => {
      const graph = createMockGraph({ nodes: [] });
      const findings = [createBiasFinding('SELECTION_LOW_OPTION_COUNT')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches[0].description).toContain('additional option');
    });
  });

  describe('MEASUREMENT_MISSING_RISKS_OR_OUTCOMES', () => {
    it('generates risk node when no risks exist', () => {
      const graph = createMockGraph({
        nodes: [
          { id: 'decision', kind: 'decision' },
          { id: 'outcome', kind: 'outcome' },
        ],
      });
      const findings = [createBiasFinding('MEASUREMENT_MISSING_RISKS_OR_OUTCOMES')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches).toHaveLength(1);
      expect(patches[0].patch?.adds?.nodes?.some((n: any) => n.kind === 'risk')).toBe(true);
    });

    it('generates outcome node when no outcomes exist', () => {
      const graph = createMockGraph({
        nodes: [
          { id: 'decision', kind: 'decision' },
          { id: 'risk', kind: 'risk' },
        ],
      });
      const findings = [createBiasFinding('MEASUREMENT_MISSING_RISKS_OR_OUTCOMES')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches).toHaveLength(1);
      expect(patches[0].patch?.adds?.nodes?.some((n: any) => n.kind === 'outcome')).toBe(true);
    });

    it('generates both risk and outcome nodes when both missing', () => {
      const graph = createMockGraph({
        nodes: [{ id: 'decision', kind: 'decision' }],
      });
      const findings = [createBiasFinding('MEASUREMENT_MISSING_RISKS_OR_OUTCOMES')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches).toHaveLength(1);
      expect(patches[0].patch?.adds?.nodes).toHaveLength(2);
    });

    it('generates no patch when both risks and outcomes exist', () => {
      const graph = createMockGraph({
        nodes: [
          { id: 'decision', kind: 'decision' },
          { id: 'risk', kind: 'risk' },
          { id: 'outcome', kind: 'outcome' },
        ],
      });
      const findings = [createBiasFinding('MEASUREMENT_MISSING_RISKS_OR_OUTCOMES')];
      const patches = buildBiasMitigationPatches(graph, findings);

      // Should emit finding but patch has no new nodes to add
      expect(patches).toHaveLength(0);
    });
  });

  describe('OPTIMISATION_PRICING_NO_RISKS', () => {
    it('generates risk node when no risks exist', () => {
      const graph = createMockGraph({
        nodes: [
          { id: 'pricing', kind: 'option', label: 'Pricing Strategy' },
        ],
      });
      const findings = [createBiasFinding('OPTIMISATION_PRICING_NO_RISKS')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches).toHaveLength(1);
      expect(patches[0].patch?.adds?.nodes?.[0].kind).toBe('risk');
    });

    it('includes pricing-specific description', () => {
      const graph = createMockGraph({
        nodes: [{ id: 'pricing', kind: 'option' }],
      });
      const findings = [createBiasFinding('OPTIMISATION_PRICING_NO_RISKS')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches[0].description).toContain('pricing');
      expect(patches[0].description).toContain('downside');
    });
  });

  describe('FRAMING_SINGLE_GOAL_NO_RISKS', () => {
    it('generates risk node when no risks exist', () => {
      const graph = createMockGraph({
        nodes: [
          { id: 'goal', kind: 'criterion', label: 'Single Goal' },
        ],
      });
      const findings = [createBiasFinding('FRAMING_SINGLE_GOAL_NO_RISKS')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches).toHaveLength(1);
      expect(patches[0].patch?.adds?.nodes?.[0].kind).toBe('risk');
    });

    it('includes framing-specific description', () => {
      const graph = createMockGraph({
        nodes: [{ id: 'goal', kind: 'criterion' }],
      });
      const findings = [createBiasFinding('FRAMING_SINGLE_GOAL_NO_RISKS')];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches[0].description).toContain('gain');
      expect(patches[0].description).toContain('loss');
    });
  });

  describe('Patch characteristics', () => {
    it('never mutates existing nodes (only adds)', () => {
      const graph = createMockGraph();
      const findings = [
        createBiasFinding('SELECTION_LOW_OPTION_COUNT'),
        createBiasFinding('MEASUREMENT_MISSING_RISKS_OR_OUTCOMES'),
      ];
      const patches = buildBiasMitigationPatches(graph, findings);

      for (const patch of patches) {
        // Should only have 'adds', not 'updates' or 'removes'
        expect(patch.patch?.adds).toBeDefined();
        expect(patch.patch?.updates).toBeUndefined();
        expect(patch.patch?.removes).toBeUndefined();
      }
    });

    it('generates deterministic patches for same input', () => {
      const graph = createMockGraph({ nodes: [] });
      const findings = [createBiasFinding('SELECTION_LOW_OPTION_COUNT')];

      const patches1 = buildBiasMitigationPatches(graph, findings);
      const patches2 = buildBiasMitigationPatches(graph, findings);

      expect(patches1).toEqual(patches2);
    });

    it('processes multiple different bias codes', () => {
      const graph = createMockGraph({ nodes: [] });
      const findings = [
        createBiasFinding('SELECTION_LOW_OPTION_COUNT'),
        createBiasFinding('MEASUREMENT_MISSING_RISKS_OR_OUTCOMES'),
      ];
      const patches = buildBiasMitigationPatches(graph, findings);

      expect(patches.length).toBeGreaterThanOrEqual(2);
      expect(patches.map((p) => p.bias_code)).toContain('SELECTION_LOW_OPTION_COUNT');
      expect(patches.map((p) => p.bias_code)).toContain('MEASUREMENT_MISSING_RISKS_OR_OUTCOMES');
    });
  });
});
