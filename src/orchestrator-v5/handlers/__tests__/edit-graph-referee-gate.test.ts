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
// D-S (ROADMAP §D, Paul 2026-07-12): tunable ops now would_apply, so the
// held-machinery pins below use a STRUCTURAL op (add_node, new id) — the
// propose-confirm class post-D-S.
const STRUCT_OP = {
  op: 'add_node',
  path: 'fac_new',
  value: { id: 'fac_new', kind: 'factor', label: 'New factor' },
};
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

  it('tunable field update → PROCEED, no block, no pending (D-S tunable auto-apply — ROADMAP §D, Paul 2026-07-12; pre-D-S pin: held TUNABLE_APPLY_HELD with pending)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP] }));
    expect(d.governing).toBe('proceed');
    expect(d.blockApply).toBe(false);
    // Honest receipt comes from the EXISTING applied path: the gate leaves
    // the V4 applied narration + rerun chip untouched (assistantText null =
    // no copy swap; the F3 four-state guard class in edit-graph.ts owns the
    // applied vocabulary).
    expect(d.assistantText).toBeNull();
    expect(d.pendingActions).toBeNull();
    expect(d.verdictCounts.would_apply).toBe(1);
  });

  it('MIXED tunable+structural batch → held WHOLESALE (D-S boundary: no partial apply around a held structural)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP, STRUCT_OP] }));
    expect(d.governing).toBe('held');
    expect(d.blockApply).toBe(true);
    expect(d.verdictCounts.would_apply).toBe(1);
    expect(d.verdictCounts.held).toBe(1);
  });

  it('structural change → held with a REAL parse-valid pending + confirm chip (propose-confirm unchanged by D-S)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [STRUCT_OP] }));
    expect(d.governing).toBe('held');
    expect(d.blockApply).toBe(true);
    // CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — doctrine (a): the
    // held ask NAMES the change it is holding, keeping the swept
    // consent framing ("Nothing in the model moves until you confirm").
    // D-O consent naming unchanged by D-S.
    expect(d.assistantText).toContain("add factor 'New factor'");
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
    expect(d.suggestedActions![0]!.label).toBe("Add factor 'New factor'");
    expect(d.suggestedActions![0]!.message).toBe("Yes, add factor 'New factor'.");
    expect(findForbiddenPhraseHit(d.suggestedActions![0]!.label)).toBeNull();
    expect(d.publicReason).toMatchObject({
      source: 'graph_management',
      verdict: 'held',
      blocker_code: 'STRUCTURAL_APPLY_HELD',
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
    // (op switched FIELD_OP → STRUCT_OP: D-S un-holds tunables; the TTL
    // machinery under pin is class-independent.)
    const d = evaluateEditGraphMutations(baseInput({ operations: [STRUCT_OP] }));
    expect(d.governing).toBe('held');
    const pending = d.pendingActions![0]!;
    expect(GM_HELD_PENDING_TURN_TTL).toBe(4);
    expect(pending.expires_at_turn_count).toBe(GM_HELD_PENDING_TURN_TTL);
    // Still parse-valid with the longer TTL.
    expect(parsePendingAction(pending)).not.toBeNull();
  });

  it('the GENERIC synthesis path still declines the held pending (lane 34: only the dedicated live-mode held-execute branch may apply it)', () => {
    // (op switched FIELD_OP → STRUCT_OP per D-S; the synthesis-allowlist pin
    // is class-independent.)
    const d = evaluateEditGraphMutations(baseInput({ operations: [STRUCT_OP] }));
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

  /**
   * FLIPPED by RULING A4 only in its AFFORDANCE, not its verdict: a base-hash
   * divergence still stales (rung 2 is byte-identical). The rerun chip goes
   * because re-running the analysis cannot resolve a divergence — the candidate
   * was generated against a graph that has since moved, and what resolves that
   * is restating the change. After A4, BASE_HASH_DIVERGED is the ONLY thing a
   * `stale` governing verdict can mean, so the futile affordance stopped being
   * half-right (design §2.4(b)).
   */
  it('base-hash divergence → stale, and NO rerun affordance (A4: a rerun cannot resolve a divergence)', () => {
    const d = evaluateEditGraphMutations(
      baseInput({ operations: [FIELD_OP], baseGraphHash: 'divergent-hash' }),
    );
    expect(d.governing).toBe('stale');
    expect(d.blockApply).toBe(true);
    expect(d.assistantText).toBe(GM_STALE_ASSISTANT_TEXT);
    expect(d.suggestedActions).toEqual([]);
    expect(d.publicReason).toMatchObject({ verdict: 'stale', blocker_code: 'BASE_HASH_DIVERGED' });
  });

  it('TUNABLE on a stale-freshness frame (hash matching) → PROCEED (D-S R2 relaxation: consecutive tunable tweaks; pre-D-S pin: stale ANALYSIS_NOT_FRESH)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP], freshness: 'stale' }));
    expect(d.governing).toBe('proceed');
    expect(d.blockApply).toBe(false);
  });

  /**
   * FLIPPED by RULING A4. This was the exact pin the design named as "a guard
   * agreeing with itself" (trap 13b): it asserted the verdict but never read
   * the COPY against `base_hash_match`, so it happily pinned a decision that
   * told the user "the model has moved" while shipping `base_hash_match: true`
   * in the same payload. The carve-out re-homes it as a HOLD, and the honesty
   * invariant that would have caught the contradiction now lives in
   * `staleness-editability-a4-gate.test.ts` R6.
   */
  it('TUNABLE on an UNKNOWN-freshness frame → HELD FRESHNESS_UNRESOLVED (A4 carve-out: authority unresolved is an ask, not a refusal)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [FIELD_OP], freshness: 'unknown' }));
    expect(d.governing).toBe('held');
    expect(d.publicReason).toMatchObject({
      blocker_code: 'FRESHNESS_UNRESOLVED',
      base_hash_match: true,
    });
  });

  /** FLIPPED by RULING A4 — the dead end the ruling exists to kill. */
  it('STRUCTURAL on a stale-freshness frame → HELD (A4: reaches the confirm chip instead of dead-ending)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [STRUCT_OP], freshness: 'stale' }));
    expect(d.governing).toBe('held');
    expect(d.publicReason).toMatchObject({ blocker_code: 'STRUCTURAL_APPLY_HELD' });
  });

  it('integrity failure (id collision) governs as rejected over a held sibling', () => {
    // (sibling switched FIELD_OP → STRUCT_OP per D-S so it still HOLDS;
    // rejected would also govern over a would_apply tunable.)
    const d = evaluateEditGraphMutations(
      baseInput({ operations: [NON_MUTATING_OP, STRUCT_OP] }),
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

  it('unreadable frame (null hash) → held WITHOUT a pending (parse-valid pendings need a graph hash) — class-independent, tunables included (D-S does not relax readability)', () => {
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
    ['held', [STRUCT_OP]], // structural (D-S: tunables no longer hold)
    ['rejected', [UNKNOWN_OP]],
    ['stale', [FIELD_OP]], // hash-diverged tunable still stales (CAS untouched)
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
    // (second expected event flipped Held → WouldApply per D-S tunable
    // auto-apply; the per-envelope emit contract itself is unchanged.)
    evaluateEditGraphMutations(baseInput({ mode: 'shadow', operations: [RENAME_OP, FIELD_OP] }));
    const mutationCalls = emitSpy.mock.calls.filter((c: readonly unknown[]) =>
      typeof c[0] === 'string' && c[0].startsWith('v5.candidate_mutation.'),
    );
    const names = mutationCalls.map((c: readonly unknown[]) => c[0]);
    expect(names).toEqual([
      telemetry.TelemetryEvents.V5CandidateMutationWouldApply,
      telemetry.TelemetryEvents.V5CandidateMutationWouldApply,
    ]);
    for (const name of names) {
      expect(telemetry.VALID_EVENT_NAMES.has(name as string)).toBe(true);
    }
    // Redaction: closed enums / booleans / ids only — never payload values
    // (the would_apply event must not leak the candidate or field values).
    const fieldPayload = mutationCalls[1]![1] as Record<string, unknown>;
    expect(fieldPayload).toMatchObject({
      verdict: 'would_apply',
      kind: 'update_node_field',
      mode: 'shadow',
      dispatch_path: 'edit_graph',
      source: 'edit_graph_llm',
      scenario_id: 'scn-gate',
      turn_id: 'turn-gate',
    });
    expect(JSON.stringify(fieldPayload)).not.toContain('Quarterly budget');
  });
});

// ── deterministic held handle (§6.7 supersession bridge) ───────────────────

describe('held handle determinism', () => {
  it('same scenario + target → same gmh_ ref (newer offer supersedes via carry-forward same-key rule)', () => {
    // (ops switched to STRUCTURAL adds per D-S — tunables no longer mint
    // held pendings; the supersession keying under pin is class-independent.)
    const a = evaluateEditGraphMutations(baseInput({ operations: [STRUCT_OP] }));
    const b = evaluateEditGraphMutations(
      baseInput({
        operations: [
          { op: 'add_node', path: 'fac_new', value: { id: 'fac_new', kind: 'factor', label: 'Different label' } },
        ],
      }),
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
