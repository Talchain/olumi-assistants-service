/**
 * Lane 8 — edit_graph referee gate unit coverage.
 *
 * Pins:
 *  - shadow NEVER blocks (any verdict mix → blockApply=false);
 *  - live verdict routing: proceed / held / stale / rejected / clarify;
 *  - the held pending is a REAL parse-valid apply_proposed_change whose
 *    inline_patch.handler_id is OUTSIDE the synthesis allowlist (resume is
 *    structurally decline-with-clarify, never a silent drop);
 *  - deterministic held handle (same scenario+target → same gmh_ ref, the
 *    §6.7 supersession bridge into the commit carry-forward);
 *  - unreadable frame (null hash) fails closed: held WITHOUT a pending;
 *  - every user-facing template survives the egress guards (§6.6 by
 *    construction: no success claims, no forbidden phrases);
 *  - fail-closed catch: a hostile operations array (throwing getter) is
 *    log-only in shadow, block-with-clarify in live.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  evaluateEditGraphMutations,
  gmHeldProposalRef,
  GM_HELD_PENDING_TURN_TTL,
  GM_HELD_ASSISTANT_TEXT,
  GM_HELD_CHIP_LABEL,
  GM_HELD_CHIP_MESSAGE,
  GM_HELD_NO_PENDING_ASSISTANT_TEXT,
  GM_STALE_ASSISTANT_TEXT,
  GM_REJECTED_ASSISTANT_TEXT,
  GM_CLARIFY_ASSISTANT_TEXT,
} from '../edit-graph-referee-gate.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { parsePendingAction } from '../../session/pending-action.js';
import { decideProposedChangeSynthesis } from '../../routing/proposed-change-synthesis.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import * as telemetry from '../../../utils/telemetry.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const GRAPH = {
  nodes: [
    { id: 'g-profit', kind: 'goal', label: 'Profit' },
    { id: 'd-choice', kind: 'decision', label: 'Which plan' },
    { id: 'f-spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
    { id: 'f-reach', kind: 'factor', label: 'Audience reach', observed_state: { value: 0.5 } },
    { id: 'o-a', kind: 'option', label: 'Plan A', interventions: { 'f-spend': { value: 0.6 } } },
    { id: 'o-b', kind: 'option', label: 'Plan B', interventions: { 'f-reach': { value: 0.3 } } },
  ],
  edges: [
    { from: 'd-choice', to: 'o-a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'd-choice', to: 'o-b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-a', to: 'f-spend', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-b', to: 'f-reach', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-spend', to: 'g-profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-reach', to: 'g-profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

const RENAME_OP = { op: 'update_node', path: 'f-spend', value: { label: 'Ad spend' } };
const FIELD_OP = { op: 'update_node', path: 'f-spend', value: { description: 'Quarterly budget' } };
const REMOVE_OP = { op: 'remove_node', path: 'f-reach' };
const UNKNOWN_OP = { op: 'exotic_future_op', path: 'x' };
const NON_MUTATING_OP = {
  // add_node against an EXISTING id → R3 ENTITY_ID_COLLISION → rejected.
  op: 'add_node',
  path: 'f-spend',
  value: { id: 'f-spend', kind: 'factor', label: 'Marketing spend' },
};

function baseInput(overrides: Partial<Parameters<typeof evaluateEditGraphMutations>[0]> = {}) {
  const hash = hashOf(GRAPH);
  return {
    mode: 'live' as const,
    operations: [RENAME_OP],
    currentGraph: GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none' as const,
    scenarioId: 'scn-gate',
    turnId: 'turn-gate',
    requestId: 'req-gate',
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

// ── copy safety (§6.6 by construction) ──────────────────────────────────────

describe('gate copy survives the egress guards (never ack prose on a blocked flow)', () => {
  const SURFACES = [
    GM_HELD_ASSISTANT_TEXT,
    GM_HELD_NO_PENDING_ASSISTANT_TEXT,
    GM_STALE_ASSISTANT_TEXT,
    GM_REJECTED_ASSISTANT_TEXT,
    GM_CLARIFY_ASSISTANT_TEXT,
    GM_HELD_CHIP_LABEL,
    GM_HELD_CHIP_MESSAGE,
  ];
  it.each(SURFACES)('no success claim and no forbidden phrase in: %s', (text) => {
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });
});

// ── verdict routing ─────────────────────────────────────────────────────────

describe('live verdict routing', () => {
  it('all-would_apply (rename) → proceed, no block, no copy', () => {
    const d = evaluateEditGraphMutations(baseInput());
    expect(d.governing).toBe('proceed');
    expect(d.blockApply).toBe(false);
    expect(d.assistantText).toBeNull();
    expect(d.pendingActions).toBeNull();
  });

  it('tunable field update → held with a REAL parse-valid pending + confirm chip', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP] }));
    expect(d.governing).toBe('held');
    expect(d.blockApply).toBe(true);
    // CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — doctrine (a): the
    // held ask NAMES the change it is holding, keeping the swept
    // consent framing ("Nothing in the model moves until you confirm").
    expect(d.assistantText).toContain("update 'Marketing spend'");
    expect(d.assistantText).toContain('Nothing in the model moves until you confirm');
    expect(findSuccessClaimHit(d.assistantText!)).toBeNull();
    expect(findForbiddenPhraseHit(d.assistantText!)).toBeNull();
    expect(d.pendingActions).toHaveLength(1);
    const pending = d.pendingActions![0]!;
    // The pending is REAL: it round-trips the session parser.
    expect(parsePendingAction(pending)).not.toBeNull();
    expect(pending.action.kind).toBe('apply_proposed_change');
    expect(pending.chip_id).toBe(d.suggestedActions![0]!.id);
    expect(pending.preconditions.graph_hash).toBe(hashOf(GRAPH));
    // Chip copy names its subject (consent-clarity), so a chip click /
    // typed reply resolves to THIS hold via exact-match, never a bare
    // 'Yes' colliding with other live consents.
    expect(d.suggestedActions![0]!.label).toBe("Update 'Marketing spend'");
    expect(d.suggestedActions![0]!.message).toBe("Yes, update 'Marketing spend'.");
    expect(findForbiddenPhraseHit(d.suggestedActions![0]!.label)).toBeNull();
    expect(d.publicReason).toMatchObject({
      source: 'graph_management',
      verdict: 'held',
      blocker_code: 'TUNABLE_APPLY_HELD',
      base_hash_match: true,
    });
  });

  it('F-HELD lifecycle: the held pending carries the GM hold turn-TTL (4), not the chip default (2)', () => {
    // F-HELD fix 2a (wire finding 2026-07-11): a hold that lapses after the
    // chip-default 2 turns dies before a short clarify detour resolves.
    // GM holds get their own, longer turn budget; wall TTL is unchanged.
    // NOTE the budget only counts TURN-EXECUTOR-committed turns — edit/
    // draft-classified commits thread no priorPendingActions and wipe live
    // holds outright (known residual; see GM_HELD_PENDING_TURN_TTL doc).
    const d = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP] }));
    expect(d.governing).toBe('held');
    const pending = d.pendingActions![0]!;
    expect(GM_HELD_PENDING_TURN_TTL).toBe(4);
    expect(pending.expires_at_turn_count).toBe(GM_HELD_PENDING_TURN_TTL);
    // Still parse-valid with the longer TTL.
    expect(parsePendingAction(pending)).not.toBeNull();
  });

  it('the GENERIC synthesis path still declines the held pending (lane 34: only the dedicated live-mode held-execute branch may apply it)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP] }));
    const pending = d.pendingActions![0]!;
    const decision = decideProposedChangeSynthesis({
      pending,
      currentGraphHash: hashOf(GRAPH), // graph unchanged — the block persisted nothing
      priorFactsWithTurn: [],
    });
    // 'invalid' routes to the deterministic commitProposedChangeRecovery
    // clarify copy in the turn-executor — never a silent drop, never an
    // un-reviewed apply THROUGH THIS PATH. Lane 34: the TurnExecutor
    // branches to the dedicated held-execute resume BEFORE this synthesis
    // when the mode is 'live' (gm-held-execute-route-level.test.ts); in
    // off/shadow this generic decline remains the fallback posture, so the
    // handler id MUST stay outside ALLOWED_HANDLER_IDS.
    expect(decision).toEqual({ status: 'invalid', reason: 'unknown_handler_id' });
  });

  it('base-hash divergence → stale with the rerun affordance', () => {
    const d = evaluateEditGraphMutations(
      baseInput({ operations: [FIELD_OP], baseGraphHash: 'divergent-hash' }),
    );
    expect(d.governing).toBe('stale');
    expect(d.blockApply).toBe(true);
    expect(d.assistantText).toBe(GM_STALE_ASSISTANT_TEXT);
    expect(d.suggestedActions![0]!.action_type).toBe('run_analysis');
    expect(d.publicReason).toMatchObject({ verdict: 'stale', blocker_code: 'BASE_HASH_DIVERGED' });
  });

  it('not-fresh analysis (pre-edit freshness=stale) → stale (frame gate fails closed)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP], freshness: 'stale' }));
    expect(d.governing).toBe('stale');
    expect(d.publicReason).toMatchObject({ blocker_code: 'ANALYSIS_NOT_FRESH' });
  });

  it('integrity failure (id collision) governs as rejected over a held sibling', () => {
    const d = evaluateEditGraphMutations(
      baseInput({ operations: [NON_MUTATING_OP, FIELD_OP] }),
    );
    expect(d.governing).toBe('rejected');
    expect(d.blockApply).toBe(true);
    expect(d.assistantText).toBe(GM_REJECTED_ASSISTANT_TEXT);
    expect(d.publicReason).toMatchObject({ verdict: 'rejected', blocker_code: 'ENTITY_ID_COLLISION' });
    // NEVER RefereeVerdict.candidate internals on the public reason.
    expect(Object.keys(d.publicReason!)).not.toContain('candidate');
  });

  it('unknown op (R1 reject) blocks in live — a malformed projection can never silently apply', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [UNKNOWN_OP] }));
    expect(d.governing).toBe('rejected');
    expect(d.blockApply).toBe(true);
  });

  it('destructive remove governs held (REMOVE_UNCONFIRMED) with a pending', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [REMOVE_OP] }));
    expect(d.governing).toBe('held');
    expect(d.publicReason).toMatchObject({ blocker_code: 'REMOVE_UNCONFIRMED' });
    expect(d.pendingActions).toHaveLength(1);
  });

  it('unreadable frame (null hash) → held WITHOUT a pending (parse-valid pendings need a graph hash)', () => {
    const d = evaluateEditGraphMutations(
      baseInput({ operations: [FIELD_OP], currentGraphHash: null, baseGraphHash: null }),
    );
    expect(d.governing).toBe('held');
    expect(d.blockApply).toBe(true);
    expect(d.assistantText).toBe(GM_HELD_NO_PENDING_ASSISTANT_TEXT);
    expect(d.pendingActions).toBeNull();
  });
});

// ── shadow mode ─────────────────────────────────────────────────────────────

describe('shadow mode never blocks', () => {
  it.each([
    ['held', [FIELD_OP]],
    ['rejected', [UNKNOWN_OP]],
    ['stale', [FIELD_OP]],
  ] as const)('%s verdict mix → blockApply=false, no copy, no pendings', (label, ops) => {
    const d = evaluateEditGraphMutations(
      baseInput({
        mode: 'shadow',
        operations: ops as never,
        ...(label === 'stale' ? { baseGraphHash: 'divergent' } : {}),
      }),
    );
    expect(d.blockApply).toBe(false);
    expect(d.assistantText).toBeNull();
    expect(d.suggestedActions).toBeNull();
    expect(d.pendingActions).toBeNull();
  });

  it('emits exactly one registered v5.candidate_mutation.<verdict> event per envelope', () => {
    evaluateEditGraphMutations(baseInput({ mode: 'shadow', operations: [RENAME_OP, FIELD_OP] }));
    const names = emitSpy.mock.calls.map((c: readonly unknown[]) => c[0]);
    expect(names).toEqual([
      telemetry.TelemetryEvents.V5CandidateMutationWouldApply,
      telemetry.TelemetryEvents.V5CandidateMutationHeld,
    ]);
    for (const name of names) {
      expect(telemetry.VALID_EVENT_NAMES.has(name as string)).toBe(true);
    }
    // Redaction: closed enums / booleans / ids only — never payload values.
    const heldPayload = emitSpy.mock.calls[1]![1] as Record<string, unknown>;
    expect(heldPayload).toMatchObject({
      verdict: 'held',
      kind: 'update_node_field',
      mode: 'shadow',
      dispatch_path: 'edit_graph',
      source: 'edit_graph_llm',
      scenario_id: 'scn-gate',
      turn_id: 'turn-gate',
    });
    expect(JSON.stringify(heldPayload)).not.toContain('Quarterly budget');
  });
});

// ── deterministic held handle (§6.7 supersession bridge) ───────────────────

describe('held handle determinism', () => {
  it('same scenario + target → same gmh_ ref (newer offer supersedes via carry-forward same-key rule)', () => {
    const a = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP] }));
    const b = evaluateEditGraphMutations(
      baseInput({ operations: [{ op: 'update_node', path: 'f-spend', value: { description: 'Different content' } }] }),
    );
    expect(a.pendingActions![0]!.chip_id).toBe(b.pendingActions![0]!.chip_id);
    expect(a.pendingActions![0]!.chip_id).toMatch(/^gmh_[0-9a-f]{12}$/);
  });

  it('different targets → different refs; ref helper is stable', () => {
    expect(gmHeldProposalRef('s', 'node:a')).not.toBe(gmHeldProposalRef('s', 'node:b'));
    expect(gmHeldProposalRef('s', 'node:a')).toBe(gmHeldProposalRef('s', 'node:a'));
  });
});

// ── fail-closed catch (mission 2d) ──────────────────────────────────────────

describe('fail-closed on internal error', () => {
  const HOSTILE_OPS = new Proxy([RENAME_OP], {
    get(target, prop, receiver) {
      if (prop === 'forEach') throw new Error('hostile ops');
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as readonly (typeof RENAME_OP)[];

  it('shadow: log-only, existing path proceeds', () => {
    const d = evaluateEditGraphMutations(baseInput({ mode: 'shadow', operations: HOSTILE_OPS }));
    expect(d.governing).toBe('proceed');
    expect(d.blockApply).toBe(false);
  });

  it('live: block-with-clarify (never crash, never silently apply)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: HOSTILE_OPS }));
    expect(d.governing).toBe('held');
    expect(d.blockApply).toBe(true);
    expect(d.assistantText).toBe(GM_HELD_NO_PENDING_ASSISTANT_TEXT);
    expect(d.pendingActions).toBeNull();
  });
});
