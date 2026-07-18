/**
 * Lane 34 — GM held-execute module coverage (hold-side payload embed +
 * confirm-side read/re-referee/apply/receipt).
 *
 * Pins:
 *  - the hold-side pending now embeds the executable batch
 *    (`inline_patch.operations`, apply_wiring 'held_execute_v1') and still
 *    round-trips `parsePendingAction`; an oversize batch degrades to the
 *    lane-8 decline posture (no operations key);
 *  - `readGmHeldResume`: not_gm_held for generic proposals; no_payload for
 *    legacy / malformed payloads; ok for a valid batch;
 *  - `executeGmHeldResume`: the full propose→hold→confirm→apply loop over
 *    a gate-emitted pending applies the batch, preserves rich top-level
 *    graph fields, and emits an `edit_graph` receipt fact (DL-7);
 *  - a "yes" can never override integrity: rejected / stale re-referee
 *    verdicts decline (`referee_blocked`), nothing returned to persist;
 *  - applied receipt copy survives the forbidden-phrase guard (it IS a
 *    success claim — sanctioned because it ships only post-commit).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  evaluateEditGraphMutations,
  GM_HELD_APPLY_WIRING_DECLINE,
  GM_HELD_APPLY_WIRING_EXECUTE,
  GM_HELD_HANDLER_ID,
  GM_HELD_OPERATIONS_MAX_JSON_CHARS,
} from '../edit-graph-referee-gate.js';
import {
  executeGmHeldResume,
  readGmHeldResume,
  GM_HELD_APPLIED_ASSISTANT_TEXT,
  GM_HELD_APPLIED_RERUN_CHIP,
} from '../gm-held-execute.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import * as telemetry from '../../../utils/telemetry.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/** Ingress-shaped graph with rich top-level fields GraphV3 strips on parse. */
const GRAPH = {
  goal_node_id: 'g-profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g-profit', kind: 'goal', label: 'Profit' },
    {
      id: 'f-spend',
      kind: 'factor',
      label: 'Marketing spend',
      observed_state: { value: 0.4 },
    },
    { id: 'o-a', kind: 'option', label: 'Plan A' },
  ],
  edges: [
    {
      from: 'f-spend',
      to: 'g-profit',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

const FIELD_OP = {
  op: 'update_node',
  path: 'f-spend',
  value: { description: 'Quarterly budget' },
};

// D-S (ROADMAP §D, Paul 2026-07-12): tunables auto-apply, so a hold-side
// pending now needs a STRUCTURAL op in the batch. The hold/confirm machinery
// under pin here is class-independent.
const STRUCT_OP = {
  op: 'add_node',
  path: 'fac_new',
  value: { id: 'fac_new', kind: 'factor', label: 'New factor' },
};

function gateInput(
  overrides: Partial<Parameters<typeof evaluateEditGraphMutations>[0]> = {},
) {
  const hash = hashOf(GRAPH);
  return {
    mode: 'live' as const,
    operations: [FIELD_OP],
    currentGraph: GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none' as const,
    scenarioId: 'scn-l34',
    turnId: 'turn-l34',
    requestId: 'req-l34',
    ...overrides,
  };
}

function executeInput(
  overrides: Partial<Parameters<typeof executeGmHeldResume>[0]> = {},
): Parameters<typeof executeGmHeldResume>[0] {
  return {
    operations: [FIELD_OP] as never,
    currentGraph: GRAPH,
    currentGraphHash: hashOf(GRAPH),
    freshness: 'none',
    hasExistingAnalysis: false,
    scenarioId: 'scn-l34',
    turnId: 'turn-l34',
    requestId: 'req-l34',
    ...overrides,
  };
}

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

// ── copy safety ─────────────────────────────────────────────────────────────

describe('applied receipt copy', () => {
  it.each([
    GM_HELD_APPLIED_ASSISTANT_TEXT,
    GM_HELD_APPLIED_RERUN_CHIP.label,
    GM_HELD_APPLIED_RERUN_CHIP.message,
  ])('no forbidden phrase in: %s', (text) => {
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });
});

// ── hold side: executable payload embed ─────────────────────────────────────

describe('hold-side pending payload (gate)', () => {
  it('held pending embeds the WHOLE validated batch + held_execute_v1 wiring and round-trips the parser', () => {
    const ops = [FIELD_OP, { op: 'remove_node', path: 'o-a' }];
    const d = evaluateEditGraphMutations(gateInput({ operations: ops }));
    expect(d.governing).toBe('held');
    const pending = d.pendingActions![0]!;
    expect(parsePendingAction(pending)).not.toBeNull();
    const patch = (pending.action as { inline_patch: Record<string, unknown> }).inline_patch;
    expect(patch.handler_id).toBe(GM_HELD_HANDLER_ID);
    expect(patch.apply_wiring).toBe(GM_HELD_APPLY_WIRING_EXECUTE);
    expect(patch.operations).toEqual(ops);
    expect(patch.operations_count).toBe(2);
  });

  it('oversize batch degrades to the decline posture (no operations key, commit-safe)', () => {
    // (op switched tunable → structural per D-S: a tunable no longer holds,
    // so an oversize TUNABLE batch simply auto-applies; the degrade path
    // under pin belongs to the held classes.)
    const bloated = 'x'.repeat(GM_HELD_OPERATIONS_MAX_JSON_CHARS + 1);
    const d = evaluateEditGraphMutations(
      gateInput({
        operations: [
          { op: 'add_node', path: 'fac_bloat', value: { id: 'fac_bloat', kind: 'factor', label: bloated } },
        ],
      }),
    );
    expect(d.governing).toBe('held');
    const patch = (d.pendingActions![0]!.action as { inline_patch: Record<string, unknown> })
      .inline_patch;
    expect(patch.apply_wiring).toBe(GM_HELD_APPLY_WIRING_DECLINE);
    expect(patch.operations).toBeUndefined();
    // Still a parse-valid pending — the confirm declines, never crashes.
    expect(parsePendingAction(d.pendingActions![0]!)).not.toBeNull();
  });
});

// ── confirm side: read ──────────────────────────────────────────────────────

function pendingWithPatch(patch: Record<string, unknown>): PendingAction {
  return {
    id: 'pa-1',
    scenario_id: 'scn-l34',
    chip_id: 'gmh_bbbbbbbbbbbb',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: 'gmh_bbbbbbbbbbbb',
      inline_patch: patch,
      public_label: 'Continue with this change',
      public_message: 'Yes',
    },
    preconditions: { graph_hash: hashOf(GRAPH) },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-08T11:00:00.000Z',
  };
}

describe('readGmHeldResume', () => {
  it('generic (non-GM) proposal → not_gm_held', () => {
    const read = readGmHeldResume(
      pendingWithPatch({ handler_id: 'add_constraint', params: {}, target_entity_ids: [] }),
    );
    expect(read.kind).toBe('not_gm_held');
  });

  it('non-proposal pending kinds → not_gm_held', () => {
    const pending = {
      ...pendingWithPatch({}),
      action: { kind: 'run_analysis' },
    } as unknown as PendingAction;
    expect(readGmHeldResume(pending).kind).toBe('not_gm_held');
  });

  it('legacy GM pending (no operations) → no_payload', () => {
    const read = readGmHeldResume(
      pendingWithPatch({ handler_id: GM_HELD_HANDLER_ID, apply_wiring: GM_HELD_APPLY_WIRING_DECLINE }),
    );
    expect(read.kind).toBe('no_payload');
  });

  it.each([
    ['non-array', { ops: 'not-an-array' }],
    ['empty array', []],
    ['unknown op kind', [{ op: 'exotic', path: 'x' }]],
    ['missing path', [{ op: 'update_node', value: { description: 'x' } }]],
  ])('malformed operations payload (%s) → no_payload', (_label, operations) => {
    const read = readGmHeldResume(
      pendingWithPatch({ handler_id: GM_HELD_HANDLER_ID, operations }),
    );
    expect(read.kind).toBe('no_payload');
  });

  it('valid batch → ok with the parsed operations', () => {
    const read = readGmHeldResume(
      pendingWithPatch({ handler_id: GM_HELD_HANDLER_ID, operations: [FIELD_OP] }),
    );
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.operations).toEqual([FIELD_OP]);
  });
});

// ── confirm side: the full loop ─────────────────────────────────────────────

describe('executeGmHeldResume', () => {
  it('propose→hold→confirm→apply loop: a gate-emitted pending executes and preserves rich top-level fields', () => {
    // HOLD: the live gate holds a MIXED tunable+structural batch WHOLESALE
    // (D-S boundary: pre-D-S a lone tunable held; post-D-S the structural
    // sibling governs and the WHOLE batch — tunable included — waits for
    // the confirm; no partial apply) and embeds the batch.
    const held = evaluateEditGraphMutations(gateInput({ operations: [FIELD_OP, STRUCT_OP] }));
    expect(held.governing).toBe('held');
    const pending = held.pendingActions![0]!;
    // CONFIRM: read the payload back off the (parse-valid) pending.
    const read = readGmHeldResume(pending);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    // APPLY: re-referee + apply through the existing apply path.
    const outcome = executeGmHeldResume(
      executeInput({ operations: read.operations as never }),
    );
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    const factor = (outcome.mutatedGraph.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'f-spend',
    );
    expect(factor?.description).toBe('Quarterly budget');
    // The structural sibling applied in the SAME confirm (whole batch).
    expect(
      (outcome.mutatedGraph.nodes as Array<Record<string, unknown>>).some(
        (n) => n.id === 'fac_new',
      ),
    ).toBe(true);
    // Rich top-level fields survive (persisted-shape merge, no V3 strip).
    expect((outcome.mutatedGraph as Record<string, unknown>).goal_node_id).toBe('g-profit');
    expect((outcome.mutatedGraph as Record<string, unknown>).schema_version).toBe('v3');
    // DL-7 receipt.
    expect(outcome.fact.fact_type).toBe('edit_graph');
    expect(outcome.fact.result.status).toBe('applied');
    expect(outcome.fact.result.operations_count).toBe(2);
    expect(outcome.fact.noop).toBe(false);
  });

  // ── P1b (real-user run 2026-07-17, scenario c510030e) ─────────────────────
  // A confirmed mixed batch must be ATOMIC: if a tunable value op's write
  // does not survive canonicalisation onto the persisted graph (the live
  // repro: the edit pipeline's canonical `data` field spelling — and the
  // slash-keyed `observed_state/value` — are STRIPPED by GraphV3, so
  // `applyPatchOperations` silently no-ops the value while the structural
  // siblings land), the WHOLE batch must refuse rather than persist a
  // partial under a wholesale "Confirmed" receipt.
  const VALUE_GRAPH = {
    goal_node_id: 'g-profit',
    schema_version: 'v3',
    nodes: [
      { id: 'g-profit', kind: 'goal', label: 'Profit' },
      { id: 'fac_setup', kind: 'factor', label: 'Setup Complexity', observed_state: { value: 0.1 } },
    ],
    edges: [
      { from: 'fac_setup', to: 'g-profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
  const RISK_ADD = {
    op: 'add_node',
    path: 'risk_dq',
    value: { id: 'risk_dq', kind: 'risk', label: 'Data quality' },
  };
  const RISK_LINK = {
    op: 'add_edge',
    path: 'risk_dq::g-profit',
    value: { from: 'risk_dq', to: 'g-profit', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
  };

  it.each([
    ['data spelling', { op: 'update_node', path: 'fac_setup', value: { data: { value: 0.5 } } }],
    ['slash-keyed spelling', { op: 'update_node', path: 'fac_setup', value: { 'observed_state/value': 0.5 } }],
  ])(
    'P1b: mixed batch whose tunable value op (%s) is stripped by canonicalisation refuses the WHOLE batch (no partial apply)',
    (_label, tunable) => {
      const outcome = executeGmHeldResume(
        executeInput({
          operations: [tunable, RISK_ADD, RISK_LINK] as never,
          currentGraph: VALUE_GRAPH,
          currentGraphHash: hashOf(VALUE_GRAPH),
        }),
      );
      // Must NOT execute a partial: the structural ops landing while the
      // value silently drops is exactly the trust-spine defect.
      expect(outcome.status).not.toBe('executed');
    },
  );

  it('P1b control: a tunable value op that DOES survive (observed_state) still executes the mixed batch and sets the value', () => {
    const outcome = executeGmHeldResume(
      executeInput({
        operations: [
          { op: 'update_node', path: 'fac_setup', value: { observed_state: { value: 0.5 } } },
          RISK_ADD,
          RISK_LINK,
        ] as never,
        currentGraph: VALUE_GRAPH,
        currentGraphHash: hashOf(VALUE_GRAPH),
      }),
    );
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    const fac = (outcome.mutatedGraph.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'fac_setup',
    );
    expect((fac?.observed_state as Record<string, unknown>).value).toBe(0.5);
    expect(
      (outcome.mutatedGraph.nodes as Array<Record<string, unknown>>).some((n) => n.id === 'risk_dq'),
    ).toBe(true);
  });

  it('a "yes" never overrides integrity: unknown op kind re-referees rejected → referee_blocked', () => {
    // Bypass the read-side Zod (defence-in-depth pin on the referee layer).
    const outcome = executeGmHeldResume(
      executeInput({ operations: [{ op: 'exotic_future_op', path: 'x' }] as never }),
    );
    expect(outcome).toEqual({ status: 'referee_blocked', governing: 'rejected' });
  });

  it('a "yes" never overrides staleness: STRUCTURAL batch + freshness=stale re-referees stale → referee_blocked', () => {
    // (op switched tunable → structural per D-S: the R2 relaxation makes a
    // stale-freshness TUNABLE legitimately executable — it would not even
    // hold at dispatch — so the staleness override pin belongs to the
    // structural class. The unknown-freshness pin below still covers
    // tunables: 'unknown' fails closed for every class.)
    const outcome = executeGmHeldResume(
      executeInput({ operations: [STRUCT_OP] as never, freshness: 'stale' }),
    );
    expect(outcome).toEqual({ status: 'referee_blocked', governing: 'stale' });
  });

  it('D-S: a confirmed TUNABLE on a stale-freshness frame executes (R2 relaxation applies at confirm-time re-referee too)', () => {
    const outcome = executeGmHeldResume(executeInput({ freshness: 'stale' }));
    expect(outcome.status).toBe('executed');
  });

  it('unknown freshness fails closed (frame gate → stale → declined)', () => {
    const outcome = executeGmHeldResume(executeInput({ freshness: 'unknown' }));
    expect(outcome).toEqual({ status: 'referee_blocked', governing: 'stale' });
  });

  it('re-referee telemetry is attributed to the resume path (dispatch_path=gm_held_resume, registered names only)', () => {
    executeGmHeldResume(executeInput());
    const verdictEmits = (emitSpy.mock.calls as Array<[unknown, unknown]>).filter(([name]) =>
      String(name).startsWith('v5.candidate_mutation.'),
    );
    expect(verdictEmits.length).toBeGreaterThan(0);
    for (const [, payload] of verdictEmits) {
      expect((payload as Record<string, unknown>).dispatch_path).toBe('gm_held_resume');
      expect((payload as Record<string, unknown>).mode).toBe('live');
    }
  });
});
