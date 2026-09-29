/**
 * Group A — cosmetic-edit / pending-gate proof.
 *
 * The load-bearing acceptance criterion of the two-hash contract
 * (Olumi_Cross_Workstream_Graph_Data_Contract_v0.2 §6.2 / §9.3): a cosmetic
 * (label-only / display-only) edit must NOT silently discard a valid pending
 * structural proposal. Concretely, for a label-only edit:
 *
 *   - graphIdentityHash CHANGES              (full persisted identity moved);
 *   - analysisAffectingHash does NOT change  (analysis-neutral);
 *   - the pending-action stale-gate — which is keyed on analysisAffectingHash —
 *     leaves the proposal LIVE.
 *
 * And the gate must still be real: a value edit (analysis-affecting) DOES
 * change analysisAffectingHash and DOES drop the pending. Proving both halves
 * pins that pending staleness stays owned by analysisAffectingHash and is never
 * re-homed onto graphIdentityHash.
 *
 * This test wires NOTHING new into the runtime — it composes the existing
 * `computeSurvivingPriorPendings` stale-gate with the two hashers to prove the
 * cross-cutting invariant.
 */
import { describe, it, expect } from 'vitest';

import { computeSurvivingPriorPendings } from '../commit.js';
import type { PendingAction } from '../session/pending-action.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { computeGraphIdentityHash } from '../context/graph-identity.js';

const NOW = Date.parse('2026-07-04T12:00:00.000Z');
const SCENARIO = 'sc-cosmetic-edit';

// Single `unknown`-typed cast (not a double cast, which the boundary-pattern
// ratchet counts) — the fixture is a loose wire-shaped graph.
function ingress(graph: unknown): GraphStateIngress {
  return graph as GraphStateIngress;
}

function buildGraph(nodes: unknown[]): GraphStateIngress {
  return ingress({ nodes, edges: [] });
}

const factor = (id: string, value: number, label: string): Record<string, unknown> => ({
  id,
  kind: 'factor',
  label,
  category: 'controllable',
  observed_state: { value, baseline: value, unit: 'GBP', source: 'brief_extraction' },
});

/**
 * A pending structural proposal whose precondition carries the analysis-
 * affecting hash the graph had when it was emitted (this is the hash the live
 * carry-forward gate persists into `preconditions.graph_hash`).
 */
function pendingForHash(analysisHash: string): PendingAction {
  return {
    id: 'pa-add-risk',
    scenario_id: SCENARIO,
    chip_id: 'prop_add_risk',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: 'prop_add_risk',
      inline_patch: {
        handler_id: 'edit_graph_add_risk',
        params: {},
        target_entity_ids: ['budget'],
      },
      public_label: 'Add the risk',
      public_message: 'Add the risk to the model.',
    },
    preconditions: { graph_hash: analysisHash },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-04T11:59:00.000Z',
  } as PendingAction;
}

describe('cosmetic edit does not stale a pending proposal (contract §6.2/§9.3)', () => {
  const before = buildGraph([factor('budget', 100, 'Budget')]);
  const analysisBefore = computeAnalysisAffectingGraphHash(before)!;
  const identityBefore = computeGraphIdentityHash(before)!.value;
  const pending = pendingForHash(analysisBefore);

  it('label-only edit moves graphIdentityHash but not analysisAffectingHash', () => {
    const afterLabel = buildGraph([factor('budget', 100, 'Total Budget')]);
    expect(computeAnalysisAffectingGraphHash(afterLabel)).toBe(analysisBefore);
    expect(computeGraphIdentityHash(afterLabel)!.value).not.toBe(identityBefore);
  });

  it('after a label-only edit the pending proposal SURVIVES the stale-gate', () => {
    const afterLabel = buildGraph([factor('budget', 100, 'Total Budget')]);
    const currentAnalysisHash = computeAnalysisAffectingGraphHash(afterLabel)!;

    const survivors = computeSurvivingPriorPendings([pending], [], [], currentAnalysisHash, NOW);

    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.chip_id).toBe('prop_add_risk');
  });

  it('control: a value edit changes analysisAffectingHash and DROPS the pending', () => {
    const afterValue = buildGraph([factor('budget', 200, 'Budget')]);
    const currentAnalysisHash = computeAnalysisAffectingGraphHash(afterValue)!;

    // The gate is genuinely keyed on the analysis-affecting hash — this edit
    // moved it, so the proposal is correctly invalidated.
    expect(currentAnalysisHash).not.toBe(analysisBefore);
    const survivors = computeSurvivingPriorPendings([pending], [], [], currentAnalysisHash, NOW);
    expect(survivors).toHaveLength(0);
  });
});
