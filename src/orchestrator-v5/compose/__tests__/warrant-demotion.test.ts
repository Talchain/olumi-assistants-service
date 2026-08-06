/**
 * ⭐ WARRANT DEMOTION — the params ROUND-TRIP and the INV-2 disclosure rule.
 *
 * The demotion converts a `ProposalAction` (parameters ARRAY) into a
 * `ProposedChange` (params RECORD) that the propose-confirm channel persists,
 * and the resume path converts that record BACK into an array via
 * `buildApplyProposedChangeProposal`.
 *
 * ⚠ WHY THIS FILE EXISTS: the rebuild is NOT a naive per-key map. For
 * `set_factor_value` it produces at most ONE `value` parameter and folds
 * `unit` / `cap` / `operator` into it as siblings. A wrong inverse would not
 * fail loudly — it would emit a chip that, when clicked, applied a DIFFERENT
 * change from the one the user was shown. Nothing else in the system would
 * notice.
 *
 * The round-trip is asserted against the REAL production rebuild
 * (`buildApplyProposedChangeProposal`, the function the resumer actually
 * calls), never against a copy of its logic — so the two cannot fork.
 */
import { describe, it, expect } from 'vitest';

import {
  buildWarrantDemotion,
  proposalParamsToRecord,
  findSurvivingConstraint,
} from '../warrant-demotion.js';
import { buildApplyProposedChangeProposal } from '../../routing/proposed-change-synthesis.js';
import type { ProposalAction } from '../../routing/types.js';
import type { PendingAction } from '../../session/pending-action.js';

function addConstraintAction(): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: {
      id: 'f-churn',
      kind: 'node',
      label: 'Customer Churn Rate',
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: [
      { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
      { name: 'value', value: 3, source: 'user_explicit' },
      { name: 'unit', value: '%', source: 'user_explicit' },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

function setFactorValueAction(): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-churn',
      kind: 'node',
      label: 'Customer Churn Rate',
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: [
      {
        name: 'value',
        value: { value: 2, unit: '%', cap: 100 },
        source: 'user_explicit',
        operator: 'set',
      },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

function adjustEdgeStrengthAction(): ProposalAction {
  return {
    handler_id: 'adjust_edge_strength',
    entity: {
      id: 'f-churn->g-mrr',
      kind: 'edge',
      label: 'Churn to MRR',
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: [
      { name: 'strength', value: -0.4, source: 'user_explicit' },
      { name: 'std', value: 0.1, source: 'user_explicit' },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

/** Wrap a demoted proposal's params in the pending the resumer would read. */
function pendingFor(handlerId: string, params: Readonly<Record<string, unknown>>, targetId: string): PendingAction {
  return {
    id: 'pa-1',
    scenario_id: 's-1',
    chip_id: 'prop_aaaaaaaaaaaa',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: 'prop_aaaaaaaaaaaa',
      inline_patch: { handler_id: handlerId, params, target_entity_ids: [targetId] },
      public_label: 'Add this limit',
      public_message: 'Add that limit to my model.',
    },
    preconditions: { graph_hash: 'h' },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-07T11:00:00.000Z',
  } as unknown as PendingAction;
}

describe('ROUND-TRIP — a demoted proposal, once confirmed, applies the SAME change it described', () => {
  it.each([
    ['add_constraint', addConstraintAction],
    ['set_factor_value', setFactorValueAction],
    ['adjust_edge_strength', adjustEdgeStrengthAction],
  ])('%s: parameters survive demote → persist → resume unchanged', (_name, build) => {
    const original = build();
    const demotion = buildWarrantDemotion(original, []);
    expect(demotion.ok).toBe(true);
    if (!demotion.ok) return;

    const rebuilt = buildApplyProposedChangeProposal(
      pendingFor(original.handler_id, demotion.proposal.params, original.entity.id),
      { id: original.entity.id, kind: 'node', label: original.entity.label ?? null },
    );

    expect(rebuilt.handler_id).toBe(original.handler_id);
    // Order-insensitive: the rebuild maps record keys, whose order is not
    // meaningful. Compare as name→parameter maps.
    const asMap = (params: ProposalAction['parameters']) =>
      Object.fromEntries(
        params.map((p) => [
          p.name,
          {
            value: p.value,
            ...(p.operator !== undefined ? { operator: p.operator } : {}),
            ...(p.unit !== undefined ? { unit: p.unit } : {}),
          },
        ]),
      );
    expect(asMap(rebuilt.parameters)).toEqual(asMap(original.parameters));
  });

  it('DISCRIMINATING CONTROL — a naive per-key flatten of set_factor_value does NOT round-trip, which is why the inverse is handler-aware', () => {
    // Proves the round-trip above is testing something. A flatten that split
    // `unit`/`cap` out of the structured value would produce three parameters
    // where the validator and handler expect one.
    const original = setFactorValueAction();
    const naive: Record<string, unknown> = {};
    for (const p of original.parameters) naive[p.name] = p.value;
    // The naive record loses `operator` entirely — it lives on the parameter,
    // not in its value — so the rebuild cannot restore it.
    const rebuilt = buildApplyProposedChangeProposal(
      pendingFor('set_factor_value', naive, original.entity.id),
      { id: original.entity.id, kind: 'node', label: null },
    );
    expect(rebuilt.parameters[0]?.operator).toBeUndefined();
    // …whereas the real inverse keeps it.
    expect(
      proposalParamsToRecord('set_factor_value', original).operator,
    ).toBe('set');
  });
});

describe('CHANGE DESCRIPTION — the user is told what is on offer, in their own units', () => {
  it('add_constraint at_most reads as an upper bound', () => {
    const d = buildWarrantDemotion(addConstraintAction(), []);
    expect(d.ok && d.changeDescription).toBe(
      'a limit keeping "Customer Churn Rate" at or below 3%',
    );
  });

  it('add_constraint at_least reads as a lower bound (the direction is not hard-coded)', () => {
    const action = addConstraintAction();
    const atLeast = {
      ...action,
      parameters: action.parameters.map((p) =>
        p.name === 'constraint_type' ? { ...p, value: 'at_least' } : p,
      ),
    } as ProposalAction;
    const d = buildWarrantDemotion(atLeast, []);
    expect(d.ok && d.changeDescription).toContain('at or above 3%');
  });

  it('set_factor_value reads as a value, unwrapping the structured value object', () => {
    const d = buildWarrantDemotion(setFactorValueAction(), []);
    expect(d.ok && d.changeDescription).toBe('setting "Customer Churn Rate" to 2%');
  });

  it('a mutating handler outside the three proposable intents is REFUSED, never executed', () => {
    const rogue = { ...addConstraintAction(), handler_id: 'some_future_mutation' } as ProposalAction;
    const d = buildWarrantDemotion(rogue, []);
    expect(d).toEqual({ ok: false, reason: 'not_a_proposable_mutation' });
  });

  it('chip copy carries no forbidden token and no digits (emitProposedChange would refuse it)', () => {
    for (const build of [addConstraintAction, setFactorValueAction, adjustEdgeStrengthAction]) {
      const d = buildWarrantDemotion(build(), []);
      expect(d.ok).toBe(true);
      if (!d.ok) continue;
      for (const copy of [d.proposal.label, d.proposal.message]) {
        expect(copy).not.toMatch(/\d/);
        expect(copy).not.toContain('add_constraint');
        expect(copy).not.toContain('set_factor_value');
        expect(copy).not.toContain('adjust_edge_strength');
        expect(copy).not.toContain('—');
      }
    }
  });
});

describe('INV-2 — the residual-constraint rule (ROADMAP 2.659 rider)', () => {
  const floor = { constraint_id: 'c1', node_id: 'f-churn', operator: '>=', label: 'churn floor' };

  it('a DIFFERENT operator on the SAME node survives → disclose', () => {
    expect(findSurvivingConstraint('f-churn', '<=', [floor])).toEqual({ label: 'churn floor' });
  });

  it('the SAME operator on the same node updates in place → disclose nothing', () => {
    expect(
      findSurvivingConstraint('f-churn', '<=', [{ ...floor, operator: '<=' }]),
    ).toBeNull();
  });

  it('a different operator on a DIFFERENT node is irrelevant → disclose nothing', () => {
    expect(findSurvivingConstraint('f-churn', '<=', [{ ...floor, node_id: 'f-other' }])).toBeNull();
  });

  it('an unknown constraint direction discloses nothing rather than guessing', () => {
    expect(findSurvivingConstraint('f-churn', null, [floor])).toBeNull();
  });

  it('the full build wires the disclosure through, naming the surviving row', () => {
    const d = buildWarrantDemotion(addConstraintAction(), [floor]);
    expect(d.ok && d.residualDisclosure).toContain('churn floor');
    expect(d.ok && d.residualDisclosure).toContain('stay in place');
  });

  it('…and omits it when nothing survives', () => {
    const d = buildWarrantDemotion(addConstraintAction(), [{ ...floor, operator: '<=' }]);
    expect(d.ok && d.residualDisclosure).toBeNull();
  });

  it('a non-constraint mutation never carries the disclosure', () => {
    const d = buildWarrantDemotion(setFactorValueAction(), [floor]);
    expect(d.ok && d.residualDisclosure).toBeNull();
  });
});
