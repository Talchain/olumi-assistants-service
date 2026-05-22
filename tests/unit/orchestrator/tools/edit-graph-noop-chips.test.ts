import { describe, it, expect } from 'vitest';
import {
  buildNoOpRecoveryChips,
  type NoOpChipNode,
} from '../../../../src/orchestrator/tools/edit-graph-noop-chips.js';
import type { ReferentialIntegrityError } from '../../../../src/orchestrator/patch-validation.js';

const NODES: readonly NoOpChipNode[] = Object.freeze([
  { id: 'n_hiring', kind: 'factor', label: 'Hiring Cost' },
  { id: 'n_revenue', kind: 'factor', label: 'Revenue' },
  { id: 'n_pricing', kind: 'factor', label: 'Pricing' },
  { id: 'n_market', kind: 'factor', label: 'Market Dynamics' },
]);

describe('buildNoOpRecoveryChips', () => {
  describe('emits chips when validator referential errors anchor to graph nodes', () => {
    it('returns chips for each matching node ID', () => {
      const errors: ReferentialIntegrityError[] = [
        { index: 0, op: 'update_node', path: 'n_hiring', message: 'Node "n_hiring" issue' },
        { index: 1, op: 'update_node', path: 'n_revenue', message: 'Node "n_revenue" issue' },
      ];
      const chips = buildNoOpRecoveryChips({ referentialErrors: errors, nodes: NODES });
      expect(chips).toHaveLength(2);
      expect(chips[0]?.label).toBe('Change Hiring Cost');
      expect(chips[0]?.role).toBe('facilitator');
      expect(chips[0]?.prompt).toContain('Hiring Cost');
      expect(chips[1]?.label).toBe('Change Revenue');
    });

    it('respects maxChips and defaults to 3', () => {
      const errors: ReferentialIntegrityError[] = NODES.map((n, i) => ({
        index: i,
        op: 'update_node',
        path: n.id,
        message: '',
      }));
      const chips = buildNoOpRecoveryChips({ referentialErrors: errors, nodes: NODES });
      expect(chips).toHaveLength(3);
    });

    it('dedupes when the same node_id appears in multiple errors', () => {
      const errors: ReferentialIntegrityError[] = [
        { index: 0, op: 'update_node', path: 'n_hiring', message: '' },
        { index: 1, op: 'update_node', path: 'n_hiring', message: '' },
        { index: 2, op: 'update_node', path: 'n_revenue', message: '' },
      ];
      const chips = buildNoOpRecoveryChips({ referentialErrors: errors, nodes: NODES });
      expect(chips).toHaveLength(2);
      expect(chips[0]?.label).toBe('Change Hiring Cost');
      expect(chips[1]?.label).toBe('Change Revenue');
    });
  });

  describe('emits zero chips when no safe anchor is available', () => {
    it('returns [] when referentialErrors is undefined (e.g. PLoT-only failure)', () => {
      const chips = buildNoOpRecoveryChips({ nodes: NODES });
      expect(chips).toEqual([]);
    });

    it('returns [] when referentialErrors is empty', () => {
      const chips = buildNoOpRecoveryChips({ referentialErrors: [], nodes: NODES });
      expect(chips).toEqual([]);
    });

    it('returns [] when no error path matches a graph node ID', () => {
      const errors: ReferentialIntegrityError[] = [
        { index: 0, op: 'update_node', path: 'unknown_node', message: '' },
      ];
      const chips = buildNoOpRecoveryChips({ referentialErrors: errors, nodes: NODES });
      expect(chips).toEqual([]);
    });

    it('returns [] when the graph is empty', () => {
      const errors: ReferentialIntegrityError[] = [
        { index: 0, op: 'update_node', path: 'n_hiring', message: '' },
      ];
      const chips = buildNoOpRecoveryChips({ referentialErrors: errors, nodes: [] });
      expect(chips).toEqual([]);
    });

    it('returns [] when all node labels are shorter than 3 chars (defensive)', () => {
      const errors: ReferentialIntegrityError[] = [
        { index: 0, op: 'update_node', path: 'short', message: '' },
      ];
      const chips = buildNoOpRecoveryChips({
        referentialErrors: errors,
        nodes: [{ id: 'short', kind: 'factor', label: 'X' }],
      });
      expect(chips).toEqual([]);
    });
  });

  describe('does not invent generic / hallucinated chips', () => {
    it('does NOT emit a "retry" or "try simpler" chip on PLoT-only failures', () => {
      // The previous PLoT failure mode had a free-text reason but no
      // anchor. The helper MUST emit zero chips here — the legacy
      // V4 "Simplify the change" chip is precisely what the
      // edit-lifecycle investigation traced as the closed loop.
      const chips = buildNoOpRecoveryChips({ nodes: NODES });
      expect(chips).toEqual([]);
    });

    it('skips edge-shaped paths (e.g. "from::to") that do not match a node ID', () => {
      const errors: ReferentialIntegrityError[] = [
        { index: 0, op: 'update_edge', path: 'n_hiring::n_revenue', message: '' },
      ];
      const chips = buildNoOpRecoveryChips({ referentialErrors: errors, nodes: NODES });
      expect(chips).toEqual([]);
    });
  });

  describe('chip shape contract', () => {
    it('every chip is a V4 SuggestedAction with facilitator role and a non-empty prompt', () => {
      const errors: ReferentialIntegrityError[] = [
        { index: 0, op: 'update_node', path: 'n_hiring', message: '' },
      ];
      const chips = buildNoOpRecoveryChips({ referentialErrors: errors, nodes: NODES });
      for (const chip of chips) {
        expect(chip.role).toBe('facilitator');
        expect(chip.label.length).toBeGreaterThan(0);
        expect(chip.prompt.length).toBeGreaterThan(0);
        // No new action_type on this branch — PR1 scope.
        expect(chip.action_type).toBeUndefined();
      }
    });
  });
});
