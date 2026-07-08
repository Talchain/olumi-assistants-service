/**
 * Lane CEE-W5 Mission A — referee field-allowlist vs the sanctioned edit
 * vocabulary (live shadow capture replay).
 *
 * Live staging telemetry captured 2× `v5.candidate_mutation.rejected`
 * (kind `update_node_field`, blocker `FIELD_NOT_ALLOWED`, dispatch
 * `edit_graph`) for a user edit CEE's own edit_graph validation ACCEPTED
 * and APPLIED: "Add a factor called Client Referral Rate with a positive
 * link to <outcome>".
 *
 * Root cause (diagnosed 2026-07-07): the edit producer
 * (`edit-graph-producer.ts`) fans each top-level key of a validated
 * `update_node.value` verbatim into ONE `update_node_field` envelope —
 * including the wire-canonical slash-keyed leaf paths that
 * `normalisePath` produces from prompt paths (`/nodes/<id>/data/value` →
 * field `data/value`, `/nodes/<id>/data/interventions/<fac>` → field
 * `data/interventions/<fac>`) and whole-object fields (`data`, `prior`,
 * `observed_state`, `goal_threshold`…). The R4 allowlist
 * (`field-safety.ts`) recognised only 7 spellings — `label`,
 * `description`, `category`, `display_value`, and three DOTTED
 * `observed_state.*` entries the producer can never emit (the edit wire
 * canonical is `data`, and nested paths arrive slash-keyed). Every
 * value-class node edit — the dominant sanctioned edit class — therefore
 * tripped FIELD_NOT_ALLOWED.
 *
 * This file replays the captured op shapes through the SHADOW gate:
 *  - the add-factor batch (add_node + add_edge + per-option intervention
 *    configuration on the two PRE-EXISTING option nodes — the 2×
 *    update_node_field rejection signature);
 *  - a plain value edit (`data/value` on an existing factor);
 *  - the goal-threshold value-edit class (Mission B's sanctioned write).
 *
 * GREEN contract (post-reconciliation): ZERO FIELD_NOT_ALLOWED for
 * sanctioned fields — tunable field edits resolve to the doctrine posture
 * `held TUNABLE_APPLY_HELD` (§3b/§6 pending; no tunable auto-apply), never
 * a schema-class reject. Negative controls stay rejected: identity
 * (`id`, `kind`), pipeline-owned analysis fields (`sensitivity_score`),
 * provenance-class stamps (`provenance`, edge `validation`), and unknown
 * fields.
 *
 * Residual at the time of this lane (since CLOSED by lane 32 / ROADMAP
 * 1.34): the referee used to judge each envelope INDEPENDENTLY against the
 * PRE-edit frame graph, so the add_edge of an add-factor batch rejected
 * ENTITY_NOT_FOUND. `refereeMutationBatch` is now sequenced — later
 * envelopes see entities introduced earlier in the batch — so the add_edge
 * holds at the structural posture and the batch governs 'held' (see
 * referee-intra-batch-sequencing.test.ts for the full acceptance).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import type { EditPatchOperationLike } from '../../graph-management/adapters/edit-graph-producer.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import {
  FIELD_NOT_ALLOWED,
  PIPELINE_OWNED_FIELD,
  TUNABLE_APPLY_HELD,
  STRUCTURAL_APPLY_HELD,
  ENTITY_NOT_FOUND,
} from '../../graph-management/reason-codes.js';
import * as telemetry from '../../../utils/telemetry.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/** Pre-edit frame graph (the strict persisted base the live gate referees against). */
const GRAPH = {
  nodes: [
    { id: 'g-bookings', kind: 'goal', label: 'Bookings Growth' },
    { id: 'd-choice', kind: 'decision', label: 'Which growth plan' },
    { id: 'f-spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
    { id: 'o-a', kind: 'option', label: 'Plan A', interventions: { 'f-spend': { value: 0.6 } } },
    { id: 'o-b', kind: 'option', label: 'Plan B', interventions: { 'f-spend': { value: 0.3 } } },
  ],
  edges: [
    { from: 'd-choice', to: 'o-a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'd-choice', to: 'o-b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-a', to: 'f-spend', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-b', to: 'f-spend', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-spend', to: 'g-bookings', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

/**
 * The captured add-factor op shapes ("Add a factor called Client Referral
 * Rate with a positive link to <outcome>"), post `handleEditGraph`
 * canonicalisation: add_node carries the wire-canonical `data` sub-object;
 * the per-option configuration ops arrive as `update_node` with the
 * slash-keyed field `normalisePath` extracts from
 * `/nodes/<opt>/data/interventions/<fac>` — one per pre-existing option,
 * which is exactly the 2× update_node_field signature in the capture.
 */
const ADD_FACTOR_OPS: EditPatchOperationLike[] = [
  {
    op: 'add_node',
    path: 'fac_client_referral_rate',
    value: {
      id: 'fac_client_referral_rate',
      kind: 'factor',
      label: 'Client Referral Rate',
      category: 'controllable',
      data: { value: 0.3, unit: '%', cap: 100 },
    },
  },
  {
    op: 'add_edge',
    path: 'fac_client_referral_rate::g-bookings',
    value: {
      from: 'fac_client_referral_rate',
      to: 'g-bookings',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  },
  {
    op: 'update_node',
    path: 'o-a',
    value: { 'data/interventions/fac_client_referral_rate': { value: 0.5, unit: '%', cap: 100 } },
    old_value: { 'data/interventions/fac_client_referral_rate': null },
  },
  {
    op: 'update_node',
    path: 'o-b',
    value: { 'data/interventions/fac_client_referral_rate': { value: 0.3, unit: '%', cap: 100 } },
    old_value: { 'data/interventions/fac_client_referral_rate': null },
  },
];

/** Plain value edit on an EXISTING factor — `/nodes/f-spend/data/value` → field `data/value`. */
const VALUE_EDIT_OPS: EditPatchOperationLike[] = [
  {
    op: 'update_node',
    path: 'f-spend',
    value: { 'data/value': 0.45 },
    old_value: { 'data/value': 0.4 },
  },
];

/** Whole-object observed_state update (CEE V3 spelling of the same class). */
const OBSERVED_STATE_OPS: EditPatchOperationLike[] = [
  {
    op: 'update_node',
    path: 'f-spend',
    value: { observed_state: { value: 0.45, baseline: 0.4, unit: '%' } },
    old_value: { observed_state: { value: 0.4 } },
  },
];

/** Goal-threshold value edit — the Mission B sanctioned write, refereed here. */
const GOAL_THRESHOLD_OPS: EditPatchOperationLike[] = [
  {
    op: 'update_node',
    path: 'g-bookings',
    value: {
      goal_threshold: 0.15,
      goal_threshold_raw: 15,
      goal_threshold_unit: '%',
      goal_threshold_cap: 100,
    },
    old_value: {},
  },
];

function shadowInput(operations: readonly EditPatchOperationLike[]) {
  const hash = hashOf(GRAPH);
  return {
    mode: 'shadow' as const,
    operations,
    currentGraph: GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none' as const,
    scenarioId: 'scn-allowlist',
    turnId: 'turn-allowlist',
    requestId: 'req-allowlist',
  };
}

interface EmittedEvent {
  readonly name: string;
  readonly kind: unknown;
  readonly blocker_code: unknown;
  readonly verdict: unknown;
}

let emitted: EmittedEvent[];
let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitted = [];
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(((name: string, payload: Record<string, unknown>) => {
    emitted.push({
      name,
      kind: payload.kind,
      blocker_code: payload.blocker_code,
      verdict: payload.verdict,
    });
  }) as never);
});
afterEach(() => {
  emitSpy.mockRestore();
});

// ── the captured live defect, replayed ──────────────────────────────────────

describe('shadow replay: captured add-factor flow (2× update_node_field)', () => {
  it('shadow never blocks, regardless of verdict mix', () => {
    const d = evaluateEditGraphMutations(shadowInput(ADD_FACTOR_OPS));
    expect(d.blockApply).toBe(false);
    expect(d.assistantText).toBeNull();
  });

  it('sanctioned per-option intervention fields no longer trip FIELD_NOT_ALLOWED (they hold as tunables)', () => {
    const d = evaluateEditGraphMutations(shadowInput(ADD_FACTOR_OPS));

    // GREEN (was the RED pin of the live capture): the 2× update_node_field
    // envelopes (fields `data/interventions/fac_client_referral_rate` on
    // o-a / o-b) are sanctioned edit vocabulary → doctrine posture held
    // TUNABLE_APPLY_HELD, NOT a FIELD_NOT_ALLOWED reject.
    const fieldEvents = emitted.filter((e) => e.kind === 'update_node_field');
    expect(fieldEvents).toHaveLength(2);
    for (const e of fieldEvents) {
      expect(e.name).toBe('v5.candidate_mutation.held');
      expect(e.blocker_code).toBe(TUNABLE_APPLY_HELD);
    }
    expect(emitted.some((e) => e.blocker_code === FIELD_NOT_ALLOWED)).toBe(false);

    // add_node holds at the §6 structural posture (unchanged).
    const addNode = emitted.find((e) => e.kind === 'add_node');
    expect(addNode?.blocker_code).toBe(STRUCTURAL_APPLY_HELD);

    // Intra-batch gap CLOSED (lane 32 / ROADMAP 1.34): the add_edge names
    // the factor added earlier in the SAME batch, and the sequenced
    // referee judges it against the batch's working view → the §6
    // structural posture hold, no ENTITY_NOT_FOUND. (Was pinned 'rejected'
    // while the referee judged every envelope against the PRE-edit frame.)
    const addEdge = emitted.find((e) => e.kind === 'add_edge');
    expect(addEdge?.name).toBe('v5.candidate_mutation.held');
    expect(addEdge?.blocker_code).toBe(STRUCTURAL_APPLY_HELD);
    expect(emitted.some((e) => e.blocker_code === ENTITY_NOT_FOUND)).toBe(false);

    // Governing verdict for the WHOLE batch is now 'held' — live mode
    // would hold add-factor-with-link for confirm, not wholesale-block it.
    expect(d.governing).toBe('held');
  });
});

describe('shadow replay: plain value edits (the dominant sanctioned edit class)', () => {
  it('slash-keyed `data/value` on an existing factor holds as a tunable (was rejected FIELD_NOT_ALLOWED)', () => {
    const d = evaluateEditGraphMutations(shadowInput(VALUE_EDIT_OPS));
    expect(d.verdictCounts.held).toBe(1);
    expect(d.verdictCounts.rejected).toBeUndefined();
    const e = emitted.find((x) => x.kind === 'update_node_field');
    expect(e?.name).toBe('v5.candidate_mutation.held');
    expect(e?.blocker_code).toBe(TUNABLE_APPLY_HELD);
    expect(d.governing).toBe('held');
  });

  it('whole-object `observed_state` update holds as a tunable (was rejected FIELD_NOT_ALLOWED)', () => {
    const d = evaluateEditGraphMutations(shadowInput(OBSERVED_STATE_OPS));
    expect(d.verdictCounts.held).toBe(1);
    expect(d.verdictCounts.rejected).toBeUndefined();
    expect(emitted.some((e) => e.blocker_code === FIELD_NOT_ALLOWED)).toBe(false);
  });

  it('goal_threshold edits are sanctioned-writer-only: piecemeal candidates reject (review hardening 2026-07-07)', () => {
    const d = evaluateEditGraphMutations(shadowInput(GOAL_THRESHOLD_OPS));
    // HARDENED: the threshold quad has exactly ONE sanctioned writer — the
    // add_constraint goal-join, which keeps raw/unit/cap/normalised
    // consistent. Piecemeal candidate writes create the registered/scored
    // desync the receipt guard exists to prevent → all 4 reject.
    expect(d.verdictCounts.rejected).toBe(4);
    expect(d.verdictCounts.held).toBeUndefined();
    expect(emitted.some((e) => e.blocker_code === FIELD_NOT_ALLOWED)).toBe(true);
    expect(d.governing).toBe('rejected');
  });
});

// ── negative controls: genuinely protected fields STILL reject ──────────────

describe('negative controls (protected fields keep rejecting)', () => {
  it('identity fields still reject: `kind` re-typing via update_node', () => {
    evaluateEditGraphMutations(
      shadowInput([
        { op: 'update_node', path: 'f-spend', value: { kind: 'goal' }, old_value: { kind: 'factor' } },
      ]),
    );
    const e = emitted.find((x) => x.kind === 'update_node_field');
    expect(e?.name).toBe('v5.candidate_mutation.rejected');
    expect(e?.blocker_code).toBe(FIELD_NOT_ALLOWED);
  });

  it('pipeline-owned analysis fields still reject: sensitivity_score', () => {
    evaluateEditGraphMutations(
      shadowInput([
        { op: 'update_node', path: 'f-spend', value: { sensitivity_score: 0.9 }, old_value: {} },
      ]),
    );
    const e = emitted.find((x) => x.kind === 'update_node_field');
    expect(e?.name).toBe('v5.candidate_mutation.rejected');
    expect(e?.blocker_code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('provenance-class stamps still reject: node provenance, edge validation', () => {
    evaluateEditGraphMutations(
      shadowInput([
        { op: 'update_node', path: 'f-spend', value: { provenance: 'from_brief' }, old_value: {} },
        { op: 'update_edge', path: 'f-spend::g-bookings', value: { validation: { status: 'ok' } }, old_value: {} },
      ]),
    );
    // Post-reconciliation these carry the PRECISE code: PIPELINE_OWNED_FIELD
    // (pipeline-recomputed / pipeline-review stamps) — still rejected.
    const nodeEvent = emitted.find((x) => x.kind === 'update_node_field');
    expect(nodeEvent?.name).toBe('v5.candidate_mutation.rejected');
    expect(nodeEvent?.blocker_code).toBe(PIPELINE_OWNED_FIELD);
    const edgeEvent = emitted.find((x) => x.kind === 'update_edge_field');
    expect(edgeEvent?.name).toBe('v5.candidate_mutation.rejected');
    expect(edgeEvent?.blocker_code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('unknown / invented fields still reject: FIELD_NOT_ALLOWED', () => {
    evaluateEditGraphMutations(
      shadowInput([
        { op: 'update_node', path: 'f-spend', value: { totally_invented_field: 1 }, old_value: {} },
      ]),
    );
    const e = emitted.find((x) => x.kind === 'update_node_field');
    expect(e?.name).toBe('v5.candidate_mutation.rejected');
    expect(e?.blocker_code).toBe(FIELD_NOT_ALLOWED);
  });

  it('edge identity + edge pipeline stamps: `defaulted` rejects; sanctioned `strength` holds', () => {
    evaluateEditGraphMutations(
      shadowInput([
        { op: 'update_edge', path: 'f-spend::g-bookings', value: { defaulted: true }, old_value: {} },
        { op: 'update_edge', path: 'f-spend::g-bookings', value: { strength: { mean: 0.6, std: 0.1 } }, old_value: { strength: { mean: 0.5, std: 0.1 } } },
      ]),
    );
    const events = emitted.filter((x) => x.kind === 'update_edge_field');
    expect(events).toHaveLength(2);
    // `defaulted` (CIL pipeline flag) rejects with the precise
    // PIPELINE_OWNED_FIELD code post-reconciliation.
    expect(events[0]?.name).toBe('v5.candidate_mutation.rejected');
    expect(events[0]?.blocker_code).toBe(PIPELINE_OWNED_FIELD);
    // `strength` is on the edge allowlist both before and after.
    expect(events[1]?.name).toBe('v5.candidate_mutation.held');
    expect(events[1]?.blocker_code).toBe(TUNABLE_APPLY_HELD);
  });
});
