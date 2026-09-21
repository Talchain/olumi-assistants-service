/**
 * Unit tests for the label-value-divergence detector — the deterministic
 * cross-check that a label-only edit whose text carries a CHANGED quantitative
 * value has NOT silently diverged from the node's modelled value.
 *
 * See the P0 critique in
 * `tests/unit/orchestrator/tools/edit-graph-label-value-divergence.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  detectLabelValueDivergences,
  buildLabelValueDivergenceNote,
  buildLabelValueDivergenceActions,
  buildLabelValueDivergenceDescription,
} from '../label-value-divergence.js';
import type { PatchOperation, GraphV3T } from '../../orchestrator/types.js';

function optionGraph(label: string): GraphV3T {
  return {
    nodes: [
      { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, unit: 'GBP', cap: 100 } },
      {
        id: 'opt_raise',
        kind: 'option',
        label,
        interventions: {
          fac_price: {
            value: 0.49,
            raw_value: 49,
            source: 'user_specified',
            target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' },
          },
        },
      },
    ],
    edges: [],
    options: [],
    goal_node_id: null,
  } as unknown as GraphV3T;
}

const renameOp = (newLabel: string, oldLabel?: string): PatchOperation => ({
  op: 'update_node',
  path: 'opt_raise',
  value: { label: newLabel },
  ...(oldLabel !== undefined ? { old_value: { label: oldLabel } } : {}),
});

describe('detectLabelValueDivergences — positive', () => {
  it('flags a label-only rename that changes an embedded number on an option with a modelled value', () => {
    const pre = optionGraph('Raise price to $49');
    const post = optionGraph('Raise price to $39');
    const divs = detectLabelValueDivergences([renameOp('Raise price to $39', 'Raise price to $49')], pre, post);
    expect(divs).toHaveLength(1);
    expect(divs[0].path).toBe('opt_raise');
    expect(divs[0].isOption).toBe(true);
    expect(divs[0].oldValueToken).toBe('$49');
    expect(divs[0].newValueToken).toBe('$39');
  });

  it('resolves the old label from the pre-edit graph when old_value is absent', () => {
    const pre = optionGraph('Raise price to $49');
    const post = optionGraph('Raise price to $39');
    const divs = detectLabelValueDivergences([renameOp('Raise price to $39')], pre, post);
    expect(divs).toHaveLength(1);
    expect(divs[0].oldValueToken).toBe('$49');
  });

  it('detects a change even when a stable ordinal number is also present in the label', () => {
    const pre = optionGraph('Option 2: raise to $49');
    const post = optionGraph('Option 2: raise to $39');
    const divs = detectLabelValueDivergences(
      [renameOp('Option 2: raise to $39', 'Option 2: raise to $49')],
      pre,
      post,
    );
    expect(divs).toHaveLength(1);
    expect(divs[0].oldValueToken).toBe('$49');
    expect(divs[0].newValueToken).toBe('$39');
  });

  it('detects a factor label rename that changes a modelled quantity', () => {
    const pre = {
      nodes: [{ id: 'fac_budget', kind: 'factor', label: 'Budget: £500k', observed_state: { value: 0.5, cap: 1000 } }],
      edges: [], options: [], goal_node_id: null,
    } as unknown as GraphV3T;
    const post = {
      nodes: [{ id: 'fac_budget', kind: 'factor', label: 'Budget: £600k', observed_state: { value: 0.5, cap: 1000 } }],
      edges: [], options: [], goal_node_id: null,
    } as unknown as GraphV3T;
    const op: PatchOperation = { op: 'update_node', path: 'fac_budget', value: { label: 'Budget: £600k' }, old_value: { label: 'Budget: £500k' } };
    const divs = detectLabelValueDivergences([op], pre, post);
    expect(divs).toHaveLength(1);
    expect(divs[0].isOption).toBe(false);
  });
});

describe('detectLabelValueDivergences — negative controls', () => {
  it('a pure rename with NO number is not a divergence', () => {
    const pre = optionGraph('Raise price to $49');
    const post = optionGraph('The aggressive raise');
    expect(detectLabelValueDivergences([renameOp('The aggressive raise', 'Raise price to $49')], pre, post)).toHaveLength(0);
  });

  it('an unchanged number (annotation added) is not a divergence', () => {
    const pre = optionGraph('Raise price to $49');
    const post = optionGraph('Raise price to $49 (recommended)');
    expect(detectLabelValueDivergences([renameOp('Raise price to $49 (recommended)', 'Raise price to $49')], pre, post)).toHaveLength(0);
  });

  it('a formatting-only change ($49 -> 49) is not a divergence', () => {
    const pre = optionGraph('Raise price to $49');
    const post = optionGraph('Raise price to 49');
    expect(detectLabelValueDivergences([renameOp('Raise price to 49', 'Raise price to $49')], pre, post)).toHaveLength(0);
  });

  it('an op that ALSO changes the modelled value is not a divergence', () => {
    const pre = optionGraph('Raise price to $49');
    const post = optionGraph('Raise price to $39');
    const op: PatchOperation = {
      op: 'update_node',
      path: 'opt_raise',
      value: { label: 'Raise price to $39', interventions: { fac_price: { value: 0.39 } } },
      old_value: { label: 'Raise price to $49' },
    };
    expect(detectLabelValueDivergences([op], pre, post)).toHaveLength(0);
  });

  it('a sibling op that changes the same node value suppresses the label divergence', () => {
    const pre = optionGraph('Raise price to $49');
    const post = optionGraph('Raise price to $39');
    const ops: PatchOperation[] = [
      { op: 'update_node', path: 'opt_raise', value: { interventions: { fac_price: { value: 0.39 } } } },
      renameOp('Raise price to $39', 'Raise price to $49'),
    ];
    expect(detectLabelValueDivergences(ops, pre, post)).toHaveLength(0);
  });

  it('a node with no modelled value is not a divergence (numbers are just a name)', () => {
    const pre = {
      nodes: [{ id: 'fac_phase', kind: 'factor', label: 'Phase 3' }],
      edges: [], options: [], goal_node_id: null,
    } as unknown as GraphV3T;
    const post = {
      nodes: [{ id: 'fac_phase', kind: 'factor', label: 'Phase 4' }],
      edges: [], options: [], goal_node_id: null,
    } as unknown as GraphV3T;
    const op: PatchOperation = { op: 'update_node', path: 'fac_phase', value: { label: 'Phase 4' }, old_value: { label: 'Phase 3' } };
    expect(detectLabelValueDivergences([op], pre, post)).toHaveLength(0);
  });

  it('non-update_node ops are ignored', () => {
    const pre = optionGraph('Raise price to $49');
    const op: PatchOperation = { op: 'add_node', path: 'opt_new', value: { label: '$39 option', kind: 'option' } };
    expect(detectLabelValueDivergences([op], pre, pre)).toHaveLength(0);
  });
});

describe('buildLabelValueDivergenceNote / Actions / Description', () => {
  const pre = optionGraph('Raise price to $49');
  const post = optionGraph('Raise price to $39');
  const divs = detectLabelValueDivergences([renameOp('Raise price to $39', 'Raise price to $49')], pre, post);

  it('note names both numbers and states the modelled value is unchanged', () => {
    const note = buildLabelValueDivergenceNote(divs)!;
    expect(note).toBeTruthy();
    expect(note).toContain('$39');
    expect(note).toContain('$49');
    expect(note.toLowerCase()).toMatch(/unchanged|display text only/);
  });

  it('note is null when there are no divergences', () => {
    expect(buildLabelValueDivergenceNote([])).toBeNull();
  });

  it('actions offer a configure-option chip for option divergences', () => {
    const actions = buildLabelValueDivergenceActions(divs);
    expect(actions.length).toBe(1);
    expect(actions[0].prompt.toLowerCase()).toContain('help me configure');
  });

  it('description discloses the divergence rather than reading as a rename success', () => {
    const desc = buildLabelValueDivergenceDescription(divs[0]);
    expect(desc.toLowerCase()).toMatch(/display text only|modelled value/);
    expect(desc).not.toMatch(/^Renamed "/);
  });
});

describe('factor divergence — note / action / description branches', () => {
  const preF = {
    nodes: [{ id: 'fac_budget', kind: 'factor', label: 'Budget: £500k', observed_state: { value: 0.5, cap: 1000 } }],
    edges: [], options: [], goal_node_id: null,
  } as unknown as GraphV3T;
  const postF = {
    nodes: [{ id: 'fac_budget', kind: 'factor', label: 'Budget: £600k', observed_state: { value: 0.5, cap: 1000 } }],
    edges: [], options: [], goal_node_id: null,
  } as unknown as GraphV3T;
  const op: PatchOperation = { op: 'update_node', path: 'fac_budget', value: { label: 'Budget: £600k' }, old_value: { label: 'Budget: £500k' } };
  const divs = detectLabelValueDivergences([op], preF, postF);

  it('note refers to the factor and names both quantities', () => {
    const note = buildLabelValueDivergenceNote(divs)!;
    expect(note.toLowerCase()).toContain('factor');
    expect(note).toContain('£500k');
    expect(note).toContain('£600k');
  });

  it('action for a factor is a value-set prompt, not a configure chip', () => {
    const actions = buildLabelValueDivergenceActions(divs);
    expect(actions).toHaveLength(1);
    expect(actions[0].prompt.toLowerCase()).not.toContain('help me configure');
    expect(actions[0].prompt).toContain('£600k');
  });

  it('description names the factor kind', () => {
    expect(buildLabelValueDivergenceDescription(divs[0]).toLowerCase()).toContain('factor');
  });
});

describe('detectLabelValueDivergences — defensive inputs', () => {
  it('returns [] for a non-array operations input', () => {
    expect(detectLabelValueDivergences(null, optionGraph('X'), optionGraph('X'))).toHaveLength(0);
    expect(detectLabelValueDivergences(undefined as unknown, optionGraph('X'), optionGraph('X'))).toHaveLength(0);
  });

  it('ignores a malformed op entry', () => {
    expect(detectLabelValueDivergences([null, 'nope', 42], optionGraph('X'), optionGraph('X'))).toHaveLength(0);
  });

  it('does not throw when the graph is missing the node', () => {
    const pre = { nodes: [], edges: [], options: [], goal_node_id: null } as unknown as GraphV3T;
    expect(detectLabelValueDivergences([renameOp('Raise price to $39', 'Raise price to $49')], pre, pre)).toHaveLength(0);
  });
});
