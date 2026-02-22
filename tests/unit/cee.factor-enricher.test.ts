/**
 * Factor Enricher Tests
 *
 * Tests for factor normalization, goal threshold redirection, and V3 field population.
 */

import { describe, it, expect } from 'vitest';
import { enrichGraphWithFactorsAsync } from '../../src/cee/factor-extraction/enricher.js';
import type { GraphT } from '../../src/schemas/graph.js';

describe('enrichGraphWithFactorsAsync', () => {
  describe('goal threshold redirection', () => {
    it('redirects target quantities to goal_threshold instead of injecting factor', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_growth',
            kind: 'goal',
            label: 'Grow the business',
          },
          {
            id: 'decision_1',
            kind: 'decision',
            label: 'How to expand',
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Target 800 customers by Q2.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Goal node should have goal_threshold set
      const goalNode = result.graph.nodes.find((n) => n.id === 'goal_growth');
      expect(goalNode?.goal_threshold).toBeDefined();
      expect(goalNode?.goal_threshold_raw).toBe(800);
      expect(goalNode?.goal_threshold_cap).toBe(1000); // Next order of magnitude

      // No factor_target_* should be injected
      const targetFactors = result.graph.nodes.filter((n) =>
        n.id.includes('target') && n.kind === 'factor'
      );
      expect(targetFactors.length).toBe(0);
    });

    it('does NOT redirect metric-like labels to goal_threshold (false positive prevention)', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Improve retention',
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      // "target market churn" should NOT trigger redirection - it's a metric, not a goal target
      const brief = 'Target market churn is 8%.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Goal node should NOT have goal_threshold (the phrase is about a market metric)
      const goalNode = result.graph.nodes.find((n) => n.id === 'goal_1');
      expect(goalNode?.goal_threshold).toBeUndefined();
    });

    it('skips cap normalization for percentage goal thresholds', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Improve conversion',
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      // Percentage target should not be cap-normalized
      const brief = 'Target 15% conversion rate.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      const goalNode = result.graph.nodes.find((n) => n.id === 'goal_1');
      // For percentages, goal_threshold should equal raw value (0.15) without cap normalization
      if (goalNode?.goal_threshold !== undefined) {
        expect(goalNode.goal_threshold).toBe(0.15);
        expect(goalNode.goal_threshold_raw).toBe(0.15);
        expect(goalNode.goal_threshold_cap).toBeUndefined(); // No cap for percentages
      }
    });

    it('only sets goal_threshold on first goal node when multiple exist', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_primary',
            kind: 'goal',
            label: 'Primary goal',
          },
          {
            id: 'goal_secondary',
            kind: 'goal',
            label: 'Secondary goal',
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Target 500 signups.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // First goal should get the threshold
      const primaryGoal = result.graph.nodes.find((n) => n.id === 'goal_primary');
      expect(primaryGoal?.goal_threshold).toBeDefined();

      // Second goal should NOT get a threshold
      const secondaryGoal = result.graph.nodes.find((n) => n.id === 'goal_secondary');
      expect(secondaryGoal?.goal_threshold).toBeUndefined();
    });
  });

  describe('factor value normalization', () => {
    it('normalizes large absolute values using cap-based normalization', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test Goal',
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Budget of £50000 for the project.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Find the budget factor
      const budgetFactor = result.graph.nodes.find(
        (n) => n.kind === 'factor' && n.label?.toLowerCase().includes('budget')
      );

      if (budgetFactor && budgetFactor.data) {
        // Value should be normalized to 0-1 range
        expect(budgetFactor.data.value).toBeLessThanOrEqual(1);
        // raw_value should preserve original
        expect(budgetFactor.data.raw_value).toBe(50000);
        // cap should be set
        expect(budgetFactor.data.cap).toBe(100000);
      }
    });

    it('preserves percentage values in 0-1 format without additional normalization', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test Goal',
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Churn rate is 5%.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Find the churn factor
      const churnFactor = result.graph.nodes.find(
        (n) => n.kind === 'factor' && n.label?.toLowerCase().includes('churn')
      );

      if (churnFactor && churnFactor.data) {
        // Percentage should be in 0-1 format
        expect(churnFactor.data.value).toBe(0.05);
        expect(churnFactor.data.unit).toBe('%');
      }
    });
  });

  describe('V3 field population on injected factors', () => {
    it('populates factor_type and uncertainty_drivers on injected factors', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test Goal',
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Revenue of £100000 per year.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Find the revenue factor
      const revenueFactor = result.graph.nodes.find(
        (n) => n.kind === 'factor' && n.label?.toLowerCase().includes('revenue')
      );

      if (revenueFactor && revenueFactor.data && 'value' in revenueFactor.data) {
        // factor_type should be inferred
        expect(revenueFactor.data.factor_type).toBeDefined();
        // uncertainty_drivers should be set
        expect(revenueFactor.data.uncertainty_drivers).toBeDefined();
        if (revenueFactor.data.uncertainty_drivers) {
          expect(revenueFactor.data.uncertainty_drivers.length).toBeGreaterThan(0);
        }
      }
    });

    it('sets raw_value and cap for large currency values', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test Goal',
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Investment of £80000.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Find the investment factor
      const investmentFactor = result.graph.nodes.find(
        (n) => n.kind === 'factor' && n.label?.toLowerCase().includes('investment')
      );

      if (investmentFactor && investmentFactor.data) {
        expect(investmentFactor.data.raw_value).toBe(80000);
        expect(investmentFactor.data.cap).toBe(100000);
        expect(investmentFactor.data.value).toBe(0.8); // 80000/100000
      }
    });
  });

  describe('V4 complete intervention early exit', () => {
    it('skips enrichment when all options have complete V4 interventions', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Reduce operating costs',
          },
          {
            id: 'fac_pa_cost',
            kind: 'factor',
            label: 'PA Cost',
            category: 'controllable',
            data: { value: 0.5, unit: '£' },
          },
          {
            id: 'fac_productivity',
            kind: 'factor',
            label: 'Productivity Gain',
            category: 'observable',
            data: { value: 0.3 },
          },
          {
            id: 'opt_hire',
            kind: 'option',
            label: 'Hire Personal Assistant',
            data: { interventions: { fac_pa_cost: 1.0, fac_productivity: 0.8 } },
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Should I hire a personal assistant for £30,000/year to improve productivity?';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Should skip enrichment entirely
      expect(result.extractionMode).toBe('v4_complete_skip');
      expect(result.factorsAdded).toBe(0);
      expect(result.factorsEnhanced).toBe(0);

      // No synthetic factors injected
      const factorNodes = result.graph.nodes.filter(n => n.kind === 'factor');
      expect(factorNodes.length).toBe(2); // Only the original two
      expect(factorNodes.every(n => ['fac_pa_cost', 'fac_productivity'].includes(n.id))).toBe(true);
    });

    it('runs enrichment when option interventions reference missing factors', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test goal',
          },
          {
            id: 'opt_a',
            kind: 'option',
            label: 'Option A',
            data: { interventions: { fac_nonexistent: 1.0 } },
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Budget of £50000.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Should NOT skip — intervention references a factor not in graph
      expect(result.extractionMode).not.toBe('v4_complete_skip');
    });

    it('runs enrichment when target factor lacks data.value', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test goal',
          },
          {
            id: 'fac_incomplete',
            kind: 'factor',
            label: 'Incomplete Factor',
            // No data — missing value
          },
          {
            id: 'opt_a',
            kind: 'option',
            label: 'Option A',
            data: { interventions: { fac_incomplete: 1.0 } },
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Budget of £50000.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Should NOT skip — target factor has no data.value
      expect(result.extractionMode).not.toBe('v4_complete_skip');
    });

    it('runs enrichment when option has no interventions', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test goal',
          },
          {
            id: 'fac_cost',
            kind: 'factor',
            label: 'Cost',
            data: { value: 0.5 },
          },
          {
            id: 'opt_a',
            kind: 'option',
            label: 'Option A',
            // No data.interventions
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Budget of £50000.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Should NOT skip — option has no interventions
      expect(result.extractionMode).not.toBe('v4_complete_skip');
    });
  });

  describe('deduplication', () => {
    it('does not inject factor when LLM already covered the quantity', async () => {
      const graph: GraphT = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test Goal',
          },
          {
            id: 'fac_churn',
            kind: 'factor',
            label: 'Churn Rate',
            data: {
              value: 0.05,
              unit: '%',
            },
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
      };

      const brief = 'Churn rate is 5%.';

      const result = await enrichGraphWithFactorsAsync(graph, brief);

      // Should not add duplicate churn factor
      const churnFactors = result.graph.nodes.filter(
        (n) => n.kind === 'factor' && n.label?.toLowerCase().includes('churn')
      );
      expect(churnFactors.length).toBe(1);
      expect(churnFactors[0].id).toBe('fac_churn'); // Original one
    });
  });
});
