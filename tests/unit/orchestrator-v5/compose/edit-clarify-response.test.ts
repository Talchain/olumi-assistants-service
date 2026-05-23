import { describe, it, expect } from 'vitest';
import {
  composeEditClarifyResponse,
  type EditClarifyComposerNode,
} from '../../../../src/orchestrator-v5/compose/edit-clarify-response.js';
import { findForbiddenPhraseHit } from '../../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';

const FACTOR_NODES: readonly EditClarifyComposerNode[] = Object.freeze([
  { id: 'f_hiring', kind: 'factor', label: 'Hiring Cost' },
  { id: 'f_revenue', kind: 'factor', label: 'Revenue' },
  { id: 'f_churn', kind: 'factor', label: 'Customer Churn' },
  { id: 'f_extra', kind: 'factor', label: 'Marketing Spend' },
]);

const OPTION_NODES: readonly EditClarifyComposerNode[] = Object.freeze([
  { id: 'opt_a', kind: 'option', label: 'Option A — Hire now' },
  { id: 'opt_b', kind: 'option', label: 'Option B — Wait' },
]);

const MIXED_NODES: readonly EditClarifyComposerNode[] = Object.freeze([
  ...FACTOR_NODES.slice(0, 2),
  ...OPTION_NODES,
]);

describe('composeEditClarifyResponse', () => {
  describe('assistant_text contract', () => {
    it('includes the deterministic lead conveying no model change yet', () => {
      const r = composeEditClarifyResponse({
        reason: 'chip_simplify',
        stage: 'analyse',
        nodes: FACTOR_NODES,
      });
      expect(r.assistant_text).toContain('The model is unchanged so far.');
    });

    it('omits the freshness sentence by default', () => {
      const r = composeEditClarifyResponse({
        reason: 'chip_simplify',
        stage: 'analyse',
        nodes: FACTOR_NODES,
      });
      expect(r.assistant_text).not.toContain('still current');
    });

    it('appends the last-analysis freshness sentence when priorAnalysisIsFresh is true', () => {
      const r = composeEditClarifyResponse({
        reason: 'chip_simplify',
        stage: 'analyse',
        nodes: FACTOR_NODES,
        priorAnalysisIsFresh: true,
      });
      expect(r.assistant_text).toContain('Your last analysis is still current.');
    });

    it('omits the freshness sentence when priorAnalysisIsFresh is false / undefined', () => {
      const a = composeEditClarifyResponse({
        reason: 'chip_simplify',
        stage: 'analyse',
        nodes: FACTOR_NODES,
        priorAnalysisIsFresh: false,
      });
      const b = composeEditClarifyResponse({
        reason: 'chip_simplify',
        stage: 'analyse',
        nodes: FACTOR_NODES,
      });
      expect(a.assistant_text).not.toContain('still current');
      expect(b.assistant_text).not.toContain('still current');
    });

    it('asks the user for a specific anchor in the closing sentence', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: FACTOR_NODES,
      });
      expect(r.assistant_text).toMatch(/specific.*(factor|edge|option|value)/i);
    });

    it('contains no forbidden user-facing phrases (egress guard parity)', () => {
      // The V5 egress forbidden-phrase guard
      // (`forbidden-user-facing-phrases.ts`) backstops the wire and
      // would REWRITE my carefully-composed clarification to the
      // neutral fallback if it hit a denial / "previous analysis" /
      // "no change was made" pattern. This test pins the composer
      // output against that guard so we catch any future copy drift
      // BEFORE it ships and produces a silent UX regression.
      const cases = [
        composeEditClarifyResponse({ reason: 'chip_simplify', stage: 'analyse', nodes: FACTOR_NODES }),
        composeEditClarifyResponse({ reason: 'chip_simplify', stage: 'analyse', nodes: FACTOR_NODES, priorAnalysisIsFresh: true }),
        composeEditClarifyResponse({ reason: 'vague_edit', stage: 'frame', nodes: null }),
      ];
      for (const r of cases) {
        expect(findForbiddenPhraseHit(r.assistant_text)).toBeNull();
      }
    });
  });

  describe('chip selection', () => {
    it('emits up to 3 factor chips from the graph', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: FACTOR_NODES,
      });
      expect(r.suggested_actions).toHaveLength(3);
      const labels = r.suggested_actions.map((c) => c.label);
      expect(labels).toEqual([
        'Change Hiring Cost',
        'Change Revenue',
        'Change Customer Churn',
      ]);
    });

    it('fills with option chips when fewer than 3 factors exist', () => {
      const r = composeEditClarifyResponse({
        reason: 'chip_simplify',
        stage: 'analyse',
        nodes: MIXED_NODES,
      });
      const labels = r.suggested_actions.map((c) => c.label);
      expect(labels).toEqual([
        'Change Hiring Cost',
        'Change Revenue',
        'Change Option A — Hire now',
      ]);
    });

    it('appends cancel chip when there are fewer than 3 label chips', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: [FACTOR_NODES[0]],
      });
      const labels = r.suggested_actions.map((c) => c.label);
      expect(labels).toEqual(['Change Hiring Cost', 'Cancel — keep model unchanged']);
    });

    it('emits cancel-only chip when no factors or options are present', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: [],
      });
      expect(r.suggested_actions).toHaveLength(1);
      expect(r.suggested_actions[0]?.label).toBe('Cancel — keep model unchanged');
    });

    it('emits cancel-only chip when nodes is null/undefined', () => {
      const a = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: null,
      });
      const b = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: undefined,
      });
      expect(a.suggested_actions).toHaveLength(1);
      expect(b.suggested_actions).toHaveLength(1);
    });

    it('chip IDs are stable and prefixed', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: [FACTOR_NODES[0]],
      });
      expect(r.suggested_actions[0]?.id).toBe('edit_clarify_f_hiring');
      expect(r.suggested_actions[1]?.id).toBe('edit_clarify_cancel');
    });

    it('chips carry no action_type (text-prompt chips for safe re-routing)', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: FACTOR_NODES,
      });
      for (const chip of r.suggested_actions) {
        expect(chip.action_type).toBeUndefined();
      }
    });

    it('skips empty / whitespace-only / short labels', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: [
          { id: 'n1', kind: 'factor', label: '' },
          { id: 'n2', kind: 'factor', label: '  ' },
          { id: 'n3', kind: 'factor', label: 'X' }, // shorter than 3 chars
          { id: 'n4', kind: 'factor', label: 'Pricing' },
        ],
      });
      expect(r.suggested_actions).toHaveLength(2);
      expect(r.suggested_actions[0]?.label).toBe('Change Pricing');
      expect(r.suggested_actions[1]?.label).toBe('Cancel — keep model unchanged');
    });

    it('dedupes by label (case-insensitive)', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: [
          { id: 'n1', kind: 'factor', label: 'Revenue' },
          { id: 'n2', kind: 'factor', label: 'revenue' },
        ],
      });
      const labels = r.suggested_actions.map((c) => c.label);
      expect(labels.filter((l) => l.toLowerCase() === 'change revenue')).toHaveLength(1);
    });
  });

  describe('wire shape', () => {
    it('returns response_version: 2 and turn-class-equivalent direct_answer shape', () => {
      const r = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: FACTOR_NODES,
      });
      expect(r.response_version).toBe(2);
      expect(r.blocks).toEqual([]);
      expect(r.insights).toEqual([]);
      expect(r.stage_indicator).toBe('analyse');
    });
  });
});
