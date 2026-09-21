/**
 * HOLD-WIPE fix (task_2e1b8c87) — pure-core matrix for
 * `threadHoldsThroughMutatingCommit` + lapse-notice copy safety.
 *
 * Dispatcher-level behaviour (commit metadata, wire notice, telemetry) is
 * pinned in edit-graph-dispatch-hold-thread-through.test.ts and
 * draft-graph-dispatch-hold-thread-through.test.ts; this suite pins the
 * decision core kind-by-kind and the deterministic copy against the
 * egress guards.
 */

import { describe, expect, it } from 'vitest';

import {
  buildHoldMutationLapseNotice,
  appendLapseNotice,
  threadHoldsThroughMutatingCommit,
} from '../hold-thread-through.js';
import { GM_HELD_HANDLER_ID } from '../edit-graph-referee-gate.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = Date.parse('2026-07-11T12:00:00.000Z');
const LIVE_EXPIRY = new Date(NOW + 600_000).toISOString();

const NEW_GRAPH = {
  nodes: [
    { id: 'goal_g', kind: 'goal', label: 'Goal' },
    { id: 'fac_demand', kind: 'factor', label: 'Demand', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'fac_demand', to: 'goal_g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as GraphStateIngress);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

const NEW_HASH = hashOf(NEW_GRAPH);
const OLD_HASH = 'aag_v1:0000000000000000';

function basePending(overrides: Partial<PendingAction> & { action: PendingAction['action'] }): PendingAction {
  return {
    id: 'pend-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip-1',
    preconditions: { graph_hash: OLD_HASH },
    expires_at_turn_count: 4,
    expires_at_iso: LIVE_EXPIRY,
    emitted_at_iso: new Date(NOW).toISOString(),
    ...overrides,
  } as PendingAction;
}

function gmHold(operations: readonly unknown[], overrides: Partial<PendingAction> = {}): PendingAction {
  return basePending({
    chip_id: 'gmh_abcdef123456',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: 'gmh_abcdef123456',
      inline_patch: {
        handler_id: GM_HELD_HANDLER_ID,
        apply_wiring: 'held_execute_v1',
        operations,
        operations_count: operations.length,
        candidate_id: 'cand-1',
        candidate_kind: 'update_node_field',
        mutation_class: 'tune',
        blocker_code: null,
        base_hash_match: true,
        params: {},
        target_entity_ids: [],
      },
      public_label: 'Continue with this change',
      public_message: 'Yes',
    },
    ...overrides,
  });
}

function threadInput(priors: readonly PendingAction[], graphHash: string | null = NEW_HASH) {
  return {
    priorPendingActions: priors,
    graphAfterCommit: graphHash === null ? null : NEW_GRAPH,
    graphHashAfterCommit: graphHash,
    nowMs: NOW,
    scenarioId: SCENARIO_ID,
    turnId: 'turn-1',
    requestId: 'req-1',
  };
}

describe('threadHoldsThroughMutatingCommit — kind matrix', () => {
  it('no graph written (null hash): every prior threads through untouched', () => {
    const priors = [gmHold([{ op: 'update_node', path: 'fac_gone', value: { observed_state: { value: 1 } } }])];
    const r = threadHoldsThroughMutatingCommit(threadInput(priors, null));
    expect(r.threaded).toEqual(priors);
    expect(r.lapsed).toHaveLength(0);
    expect(r.notice).toBeNull();
  });

  it('pin matches the new hash (mutation did not move the analysis-affecting hash): threads untouched', () => {
    const hold = gmHold([{ op: 'update_node', path: 'fac_demand', value: { observed_state: { value: 0.7 } } }], {
      preconditions: { graph_hash: NEW_HASH },
    });
    const r = threadHoldsThroughMutatingCommit(threadInput([hold]));
    expect(r.threaded).toEqual([hold]);
    expect(r.lapsed).toHaveLength(0);
  });

  it('unpinned pending: threads untouched', () => {
    const concept = basePending({
      action: {
        kind: 'proposed_concept',
        concept: 'team morale',
        preferred_kind: 'factor',
        public_label: 'Continue with the proposed update',
        public_message: 'Continue with team morale.',
      },
      preconditions: {},
    });
    const r = threadHoldsThroughMutatingCommit(threadInput([concept]));
    expect(r.threaded).toEqual([concept]);
    expect(r.lapsed).toHaveLength(0);
  });

  it('already-expired hold with a stale pin: threads untouched — expiry bookkeeping belongs to the commit carry-forward', () => {
    const dead = gmHold([{ op: 'update_node', path: 'fac_gone', value: { observed_state: { value: 1 } } }], {
      expires_at_iso: new Date(NOW - 1_000).toISOString(),
    });
    const r = threadHoldsThroughMutatingCommit(threadInput([dead]));
    expect(r.threaded).toEqual([dead]);
    expect(r.lapsed).toHaveLength(0);
    expect(r.notice).toBeNull();
  });

  it('non-confirmation-expecting kinds with a stale pin thread untouched (carry-forward hash rule owns their lifecycle)', () => {
    const setValue = basePending({
      action: { kind: 'set_factor_value', factor_id: 'fac_demand', value: 3, operator: 'set' },
    });
    const addRisk = basePending({
      id: 'pend-2',
      chip_id: 'chip-2',
      action: { kind: 'edit_graph_add_risk', label: 'Churn risk' },
    });
    const r = threadHoldsThroughMutatingCommit(threadInput([setValue, addRisk]));
    expect(r.threaded).toEqual([setValue, addRisk]);
    expect(r.lapsed).toHaveLength(0);
  });

  it('GM hold whose batch still referees cleanly against the new graph: threaded RE-PINNED to the new hash (TTL untouched)', () => {
    const hold = gmHold([{ op: 'update_node', path: 'fac_demand', value: { observed_state: { value: 0.7 } } }]);
    const r = threadHoldsThroughMutatingCommit(threadInput([hold]));
    expect(r.lapsed).toHaveLength(0);
    expect(r.threaded).toHaveLength(1);
    expect(r.threaded[0]!.preconditions.graph_hash).toBe(NEW_HASH);
    expect(r.threaded[0]!.expires_at_turn_count).toBe(4);
    // Everything else is untouched.
    expect(r.threaded[0]!.action).toBe(hold.action);
  });

  it('GM hold whose batch fails the post-mutation referee (target gone): honest lapse with governing verdict', () => {
    const hold = gmHold([{ op: 'update_node', path: 'fac_gone', value: { observed_state: { value: 1 } } }]);
    const r = threadHoldsThroughMutatingCommit(threadInput([hold]));
    expect(r.threaded).toHaveLength(0);
    expect(r.lapsed).toHaveLength(1);
    expect(r.lapsed[0]!.detail).toBe('held_batch_invalid_post_mutation');
    expect(r.lapsed[0]!.governing).toBe('rejected');
    expect(r.notice).toContain("'Continue with this change'");
    expect(r.notice).toContain('has lapsed because the model changed');
  });

  it('payload-less GM hold (decline posture) with a stale pin: honest lapse as proposal_base_moved', () => {
    const hold = basePending({
      chip_id: 'gmh_abcdef123456',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'gmh_abcdef123456',
        inline_patch: {
          handler_id: GM_HELD_HANDLER_ID,
          apply_wiring: 'decline_with_clarify_v0',
          params: {},
          target_entity_ids: [],
        },
        public_label: 'Continue with this change',
        public_message: 'Yes',
      },
    });
    const r = threadHoldsThroughMutatingCommit(threadInput([hold]));
    expect(r.threaded).toHaveLength(0);
    expect(r.lapsed).toEqual([
      { pending: hold, detail: 'proposal_base_moved', governing: null },
    ]);
  });

  it('generic (non-GM) apply proposal with a stale pin: honest lapse — its confirm path is hash-gated by design', () => {
    const hold = basePending({
      chip_id: 'prop_0123456789ab',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_0123456789ab',
        inline_patch: { handler_id: 'set_factor_value', params: {}, target_entity_ids: [] },
        public_label: 'Set Demand to 0.7',
        public_message: 'Yes, set it',
      },
    });
    const r = threadHoldsThroughMutatingCommit(threadInput([hold]));
    expect(r.threaded).toHaveLength(0);
    expect(r.lapsed[0]!.detail).toBe('proposal_base_moved');
    expect(r.notice).toContain("'Set Demand to 0.7'");
  });

  it('hash-pinned concept offer with a stale pin: honest lapse, notice names the concept', () => {
    const concept = basePending({
      action: {
        kind: 'proposed_concept',
        concept: 'team morale',
        preferred_kind: 'factor',
        public_label: 'Continue with the proposed update',
        public_message: 'Continue with team morale.',
      },
    });
    const r = threadHoldsThroughMutatingCommit(threadInput([concept]));
    expect(r.threaded).toHaveLength(0);
    expect(r.lapsed[0]!.detail).toBe('proposal_base_moved');
    expect(r.notice).toBe(
      "The suggestion to add 'team morale' has lapsed because the model changed, say the word if you still want it.",
    );
  });

  it('several lapse at once: ONE notice, first in prior order (F-HELD 2b precedent); every lapse is reported for telemetry', () => {
    const first = gmHold([{ op: 'update_node', path: 'fac_gone', value: { observed_state: { value: 1 } } }]);
    const second = basePending({
      id: 'pend-2',
      chip_id: 'prop_0123456789ab',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_0123456789ab',
        inline_patch: { handler_id: 'set_factor_value', params: {}, target_entity_ids: [] },
        public_label: 'Set Demand to 0.7',
        public_message: 'Yes, set it',
      },
    });
    const r = threadHoldsThroughMutatingCommit(threadInput([first, second]));
    expect(r.lapsed).toHaveLength(2);
    expect(r.notice).toContain("'Continue with this change'");
    expect(r.notice).not.toContain("'Set Demand to 0.7'");
  });
});

describe('fulfilment-aware lapse — no false notice when THIS turn delivered the held change (adversarial round-3 concern 1)', () => {
  /** NEW_GRAPH + the very node the concept hold proposed. */
  const NEW_GRAPH_WITH_MORALE = {
    nodes: [
      ...NEW_GRAPH.nodes,
      { id: 'fac_team_morale', kind: 'factor', label: 'Team morale', observed_state: { value: 0.5 } },
    ],
    edges: [
      ...NEW_GRAPH.edges,
      { from: 'fac_team_morale', to: 'goal_g', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  };
  const MORALE_HASH = hashOf(NEW_GRAPH_WITH_MORALE);

  function conceptHold(): PendingAction {
    return basePending({
      action: {
        kind: 'proposed_concept',
        concept: 'team morale',
        preferred_kind: 'factor',
        public_label: 'Continue with the proposed update',
        public_message: 'Continue with team morale.',
      },
    });
  }

  function fulfilInput(overrides: {
    graph?: unknown;
    graphHash?: string;
    appliedOperations?: readonly { op: string; path: string; value?: unknown }[] | null;
    priors: readonly PendingAction[];
  }) {
    return {
      priorPendingActions: overrides.priors,
      graphAfterCommit: overrides.graph ?? NEW_GRAPH_WITH_MORALE,
      graphHashAfterCommit: overrides.graphHash ?? MORALE_HASH,
      appliedOperations: overrides.appliedOperations ?? null,
      nowMs: NOW,
      scenarioId: SCENARIO_ID,
      turnId: 'turn-1',
      requestId: 'req-1',
    };
  }

  it("user's edit FULFILS a prior proposed_concept hold (applied add_node matches the concept): lapse reported for telemetry, NO notice", () => {
    const r = threadHoldsThroughMutatingCommit(
      fulfilInput({
        priors: [conceptHold()],
        appliedOperations: [
          { op: 'add_node', path: 'fac_team_morale', value: { kind: 'factor', label: 'Team morale' } },
        ],
      }),
    );
    expect(r.threaded).toHaveLength(0);
    expect(r.lapsed).toHaveLength(1);
    expect(r.lapsed[0]!.detail).toBe('fulfilled_by_this_mutation');
    // The false "your held proposal lapsed" sentence must NOT fire on the
    // very turn the user fulfilled the proposal.
    expect(r.notice).toBeNull();
  });

  it('draft turn whose NEW graph contains the proposed concept (no per-op record): NO notice', () => {
    const r = threadHoldsThroughMutatingCommit(
      fulfilInput({ priors: [conceptHold()], appliedOperations: null }),
    );
    expect(r.threaded).toHaveLength(0);
    expect(r.lapsed[0]!.detail).toBe('fulfilled_by_this_mutation');
    expect(r.notice).toBeNull();
  });

  it('GM hold whose held batch the user applied by hand this turn (same op kind + target): NO notice, governing still reported', () => {
    // Full canonical shape — PatchOperationsArraySchema requires value.id on
    // add_node (readGmHeldResume gate), mirroring what buildHeldPending stores.
    const heldAdd = { op: 'add_node', path: 'fac_team_morale', value: { id: 'fac_team_morale', kind: 'factor', label: 'Team morale' } };
    const hold = gmHold([heldAdd]);
    const r = threadHoldsThroughMutatingCommit(
      fulfilInput({ priors: [hold], appliedOperations: [heldAdd] }),
    );
    expect(r.threaded).toHaveLength(0);
    expect(r.lapsed).toHaveLength(1);
    expect(r.lapsed[0]!.detail).toBe('fulfilled_by_this_mutation');
    // The re-referee genuinely failed (id collision) — the verdict is still
    // reported honestly even though the notice is suppressed.
    expect(r.lapsed[0]!.governing).toBe('rejected');
    expect(r.notice).toBeNull();
  });

  it('GM held REMOVE already performed (end state satisfied, applied ops unrelated): NO notice', () => {
    const hold = gmHold([{ op: 'remove_node', path: 'fac_gone' }]);
    const r = threadHoldsThroughMutatingCommit(
      fulfilInput({
        graph: NEW_GRAPH,
        graphHash: NEW_HASH,
        priors: [hold],
        appliedOperations: [
          { op: 'update_node', path: 'fac_demand', value: { observed_state: { value: 0.6 } } },
        ],
      }),
    );
    expect(r.threaded).toHaveLength(0);
    expect(r.lapsed[0]!.detail).toBe('fulfilled_by_this_mutation');
    expect(r.notice).toBeNull();
  });

  it('GUARD — an UNRELATED applied edit does not suppress the concept lapse notice', () => {
    const r = threadHoldsThroughMutatingCommit(
      fulfilInput({
        graph: NEW_GRAPH,
        graphHash: NEW_HASH,
        priors: [conceptHold()],
        appliedOperations: [
          { op: 'add_node', path: 'fac_other', value: { kind: 'factor', label: 'Something else' } },
        ],
      }),
    );
    expect(r.lapsed[0]!.detail).toBe('proposal_base_moved');
    expect(r.notice).toContain("'team morale'");
  });

  it('GUARD — mixed lapse: the notice names the first NON-fulfilled hold; both lapses are reported for telemetry', () => {
    const fulfilledConcept = conceptHold();
    const genuinelyInvalidated = gmHold(
      [{ op: 'update_node', path: 'fac_gone', value: { observed_state: { value: 1 } } }],
      { id: 'pend-2', chip_id: 'gmh_fedcba654321' },
    );
    const r = threadHoldsThroughMutatingCommit(
      fulfilInput({
        priors: [fulfilledConcept, genuinelyInvalidated],
        appliedOperations: [
          { op: 'add_node', path: 'fac_team_morale', value: { kind: 'factor', label: 'Team morale' } },
        ],
      }),
    );
    expect(r.lapsed).toHaveLength(2);
    expect(r.lapsed[0]!.detail).toBe('fulfilled_by_this_mutation');
    expect(r.lapsed[1]!.detail).toBe('held_batch_invalid_post_mutation');
    expect(r.notice).toContain("'Continue with this change'");
    expect(r.notice).not.toContain("'team morale'");
  });
});

describe('lapse-notice copy safety (§6.6 by construction)', () => {
  const NOTICES = [
    buildHoldMutationLapseNotice(gmHold([])),
    buildHoldMutationLapseNotice(
      basePending({
        action: {
          kind: 'proposed_concept',
          concept: 'team morale',
          preferred_kind: 'factor',
          public_label: 'Continue with the proposed update',
          public_message: 'Continue with team morale.',
        },
      }),
    ),
    // Legacy apply variant without public copy → generic fallback line.
    buildHoldMutationLapseNotice(
      basePending({
        chip_id: 'prop_legacy_12345',
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_legacy_12345',
          inline_patch: {},
          __legacy_no_public_copy: true,
        },
      }),
    ),
  ];

  it.each(NOTICES)('no success claim, no forbidden phrase, no em dash in: %s', (text) => {
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
    expect(text).not.toContain('—');
  });

  it('appendLapseNotice joins with a blank line and stands alone on empty text', () => {
    expect(appendLapseNotice('Done.', 'Notice.')).toBe('Done.\n\nNotice.');
    expect(appendLapseNotice('', 'Notice.')).toBe('Notice.');
    expect(appendLapseNotice(undefined, 'Notice.')).toBe('Notice.');
  });
});
