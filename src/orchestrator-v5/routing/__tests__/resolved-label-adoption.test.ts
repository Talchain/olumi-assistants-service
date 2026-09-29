/**
 * RESOLVED-LABEL ADOPTION — the entity-kind repair adopted the graph's KIND
 * and left the model's LABEL in place.
 *
 * DEFECT (adversarial review, altitude): `validateToolCall` builds
 * `effectiveProposal` from `{...proposal.entity, kind: resolved_kind}` — kind
 * only. `resolvedEntity.label` is ground truth, is already in hand at that
 * exact moment, and was used ONLY to decorate an ENTITY_KIND_MISMATCH error's
 * details. On every path that does NOT take that error branch, the MODEL's
 * label rides downstream and reaches `safeLabel()`-based user prose (the
 * turn-executor's VALUE_UNIT_UNRESOLVED and OPTION_INTERVENTION_MISROUTE
 * errors both stamp `factor_label` from the proposal entity). A model that
 * resolved the right id under an invented name made us repeat the invented
 * name back to the user as if it were their own model's.
 *
 * ⚠ AND THE OBVIOUS FIX SILENTLY REMOVES A GUARD. `detectSuspiciousLabelMatch`
 * scores `bigramDice(entity.label, chosen.label)` where `chosen` is the GRAPH
 * entry for `entity.id`. Set `entity.label` to the graph's own label and that
 * score is 1.0 by construction, so `bestOther.score - chosenScore >= 0.15` can
 * never hold and ENTITY_RESOLUTION_SUSPICIOUS becomes unreachable — a guard
 * deleted by a refactor that reads like an improvement. The Dice check must
 * keep seeing the label the MODEL proposed; that is the whole input it exists
 * to judge. Both halves are pinned here.
 */

import { describe, expect, it } from 'vitest';

import { buildGraphLookup } from '../graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { validateToolCall, type GraphLookup } from '../validator.js';
import type { ProposalAction } from '../types.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const NODES = [
  { id: 'dec_laptops', kind: 'decision', label: 'Engineering Team Laptop Selection' },
  {
    id: 'fac_unit_cost',
    kind: 'factor',
    label: 'Hardware Unit Cost per Device',
    observed_state: { value: 1200, unit: '£', cap: 5000 },
  },
  {
    id: 'fac_support_cost',
    kind: 'factor',
    label: 'Annual Support Cost',
    observed_state: { value: 400, unit: '£', cap: 5000 },
  },
  { id: 'goal_effectiveness', kind: 'goal', label: 'Maximise Team Effectiveness' },
  { id: 'opt_dell', kind: 'option', label: 'Standardise on Dell XPS' },
  { id: 'out_tco_efficiency', kind: 'outcome', label: 'Three-Year TCO Efficiency' },
];

function lookupFor(nodes: ReadonlyArray<Record<string, unknown>>): GraphLookup {
  const result = buildGraphLookup({ nodes, edges: [] } as unknown as GraphStateIngress);
  if (result.kind !== 'ok') throw new Error(`expected ok adapter result, got ${result.kind}`);
  return result.lookup;
}

const GRAPH = lookupFor(NODES);

function setFactorValueProposal(entity: {
  id: string;
  kind: string;
  label?: string;
  resolution_method?: string;
}): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      resolution_status: 'resolved',
      resolution_method: entity.resolution_method ?? 'id_match',
      ...entity,
    },
    parameters: [{ name: 'value', value: { value: 1500, unit: '£' }, source: 'user_explicit' }],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

function constraintProposal(entity: {
  id: string;
  kind: string;
  label?: string;
}): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: {
      resolution_status: 'resolved',
      resolution_method: 'id_match',
      ...entity,
    },
    parameters: [
      { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
      { name: 'value', value: 0.6, source: 'user_explicit' },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

// ---------------------------------------------------------------------------
// (a) The label the graph knows wins over the label the model invented.
// ---------------------------------------------------------------------------

describe('resolved-label adoption — the graph is authoritative on the label too', () => {
  it('adopts the GRAPH label onto the validated proposal when the model invented a different one', () => {
    const result = validateToolCall(
      setFactorValueProposal({
        id: 'fac_unit_cost',
        kind: 'node',
        // The model resolved the right id under a name that is nowhere in the
        // graph. Left alone this string is what the user is told they edited.
        label: 'the laptop budget',
      }),
      GRAPH,
      HANDLER_VALIDATION_REGISTRY,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.proposal.entity.label).toBe('Hardware Unit Cost per Device');
    // The id — the only thing that selects a target — is never altered.
    expect(result.proposal.entity.id).toBe('fac_unit_cost');
  });

  it('adopts the graph label even when the KIND was already correct (no kind repair)', () => {
    const result = validateToolCall(
      setFactorValueProposal({ id: 'fac_unit_cost', kind: 'node', label: 'unit costs' }),
      GRAPH,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.proposal.entity.label).toBe('Hardware Unit Cost per Device');
    // A label-only repair is NOT a kind repair — the routing-prompt signal
    // `v5.entity_kind_repaired` measures must keep its exact population.
    expect(result.kind_repair).toBeUndefined();
  });

  it('discloses WHICH attributes were repaired when both kind and label were wrong', () => {
    const result = validateToolCall(
      constraintProposal({
        id: 'out_tco_efficiency',
        kind: 'constraint',
        label: 'TCO',
      }),
      GRAPH,
      HANDLER_VALIDATION_REGISTRY,
    );

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind_repair?.repaired_attributes).toEqual(['kind', 'label']);
    expect(result.proposal.entity.kind).toBe('node');
    expect(result.proposal.entity.label).toBe('Three-Year TCO Efficiency');
  });

  it("reports repaired_attributes ['kind'] when the model's label was already right", () => {
    const result = validateToolCall(
      constraintProposal({
        id: 'out_tco_efficiency',
        kind: 'constraint',
        label: 'Three-Year TCO Efficiency',
      }),
      GRAPH,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind_repair?.repaired_attributes).toEqual(['kind']);
  });

  it('leaves the model label alone when the graph entry carries no label of its own', () => {
    const unlabelled = lookupFor([
      { id: 'dec_x', kind: 'decision', label: 'A Decision' },
      {
        id: 'fac_nameless',
        kind: 'factor',
        observed_state: { value: 1200, unit: '£', cap: 5000 },
      },
    ]);
    const result = validateToolCall(
      setFactorValueProposal({ id: 'fac_nameless', kind: 'node', label: 'the mystery factor' }),
      unlabelled,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // Never blank a label we cannot better — an absent graph label is not
    // ground truth, it is missing data.
    expect(result.proposal.entity.label).toBe('the mystery factor');
  });
});

// ---------------------------------------------------------------------------
// (b) The guard the obvious fix would have deleted.
// ---------------------------------------------------------------------------

describe('resolved-label adoption — the Dice suspicion guard still discriminates', () => {
  it('STILL flags a suspicious label match after the graph label is adopted', () => {
    // The model label matches `fac_support_cost` far better than the id it
    // actually chose (`fac_unit_cost`). If adoption fed the Dice check the
    // graph's own label for the chosen id, chosenScore would be 1.0 and this
    // could never fire.
    const result = validateToolCall(
      setFactorValueProposal({
        id: 'fac_unit_cost',
        kind: 'node',
        label: 'Annual Support Cost',
        resolution_method: 'label_match',
      }),
      GRAPH,
      HANDLER_VALIDATION_REGISTRY,
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error.code).toBe('ENTITY_RESOLUTION_SUSPICIOUS');
    // The user-facing chips are built from these two — both graph labels.
    expect(result.error.details?.chosen).toMatchObject({
      id: 'fac_unit_cost',
      label: 'Hardware Unit Cost per Device',
    });
    expect(result.error.details?.closer_candidate).toMatchObject({
      id: 'fac_support_cost',
      label: 'Annual Support Cost',
    });
  });

  it('does NOT flag when the model label genuinely matches the id it chose', () => {
    const result = validateToolCall(
      setFactorValueProposal({
        id: 'fac_unit_cost',
        kind: 'node',
        label: 'Hardware Unit Cost per Device',
        resolution_method: 'label_match',
      }),
      GRAPH,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });
});
