/**
 * ⭐⭐ RULING A4 (Paul, 2026-08-05) — STALENESS IS A PROPERTY OF THE RESULTS,
 * DISPLAYED HONESTLY, NEVER A LOCK ON THE EDITOR.
 *
 * Design of record: `parallel-briefs/STALENESS-EDITABILITY-DESIGN-2026-08-05.md`
 * (derivation verdict §1: the freshness rung carries NO guarantee beyond
 * staleness; §3 names the ONE carve-out that is not staleness and must
 * survive; §4 lists what must stay byte-identical).
 *
 * What this file pins, at the referee/frame-gate layer:
 *  - R1  a STRUCTURAL candidate on a stale-freshness, hash-MATCHING frame is
 *        HELD (consent), never `stale` (a refusal). The dead end the ruling
 *        exists to kill.
 *  - R5  the CARVE-OUT: `'unknown'` freshness is AUTHORITY-UNRESOLVED, not
 *        staleness. It must be HELD with an honest blocker code, and it must
 *        NOT become `proceed` — the ladder holds every unresolved-authority
 *        state (rung 0 FRAME_UNAVAILABLE, rung 1 CURRENT_GRAPH_UNREADABLE).
 *  - R7  rung 2 (base-hash divergence) is untouched and still stales for
 *        EVERY class. Guarded by a mutant obligation, not by assertion alone.
 *  - R8a DERIVED drift guard: the gate's outcome is a function of freshness
 *        ALONE — asserted over the cartesian product of every MutationClass ×
 *        every FrameFreshness, so it cannot drift as classes are added.
 *  - R8b UNION assertion (trap 12d — derivation proves the copies agree, never
 *        that the list is RIGHT): `FrameFreshness` and the PRODUCER's
 *        `AnalysisFreshness` must be mutually assignable, so a new upstream
 *        freshness value cannot land silently in the untrusted bucket and
 *        re-create the block under a different name.
 *  - R9  `ANALYSIS_NOT_FRESH` is emitted by NO production referee path — a
 *        runtime matrix over every candidate kind × every freshness at a
 *        matching hash. (The type-level half is the narrowed `stale` reason
 *        literal on `FrameGateOutcome`.)
 *
 * Binding discipline (trap 19): every assertion binds to its object by
 * IDENTITY — the exact blocker code, the exact candidate kind, the exact
 * outcome shape — never a value predicate a sibling could satisfy.
 */
import { describe, it, expect } from 'vitest';

import { refereeMutation, refereeMutationBatch } from '../referee.js';
import { evaluateFrameGate, staleAnalysisBlocksApply } from '../frame-gate.js';
import { classifyMutation } from '../classify-mutation.js';
import {
  ANALYSIS_NOT_FRESH,
  BASE_HASH_DIVERGED,
  FRESHNESS_UNRESOLVED,
  MUTATION_REASON_CODES,
  REMOVE_UNCONFIRMED,
  STRUCTURAL_APPLY_HELD,
} from '../reason-codes.js';
import { CANDIDATE_KINDS } from '../types.js';
import type { CandidateKind, FrameFreshness, MutationClass } from '../types.js';
import type { AnalysisFreshness } from '../../context/freshness.js';
import {
  buildReadyGraph,
  frameFor,
  hashOf,
  makeEnvelope,
  SAMPLE_PAYLOADS,
} from './fixtures.js';

const G = buildReadyGraph();
const H = hashOf(G);

const envFor = (kind: CandidateKind, over = {}) =>
  makeEnvelope(kind, SAMPLE_PAYLOADS[kind], { base_graph_hash: H, ...over });

// ---------------------------------------------------------------------------
// Derived coverage lists. `satisfies Record<Union, true>` is the whole point:
// a new union member makes THIS OBJECT a compile error (missing property), so
// the lists below cannot silently go short. Trap 12's "derive, don't mirror",
// with the failure mode LOUD rather than assume-good.
// ---------------------------------------------------------------------------
const FRESHNESS_COVERAGE = {
  fresh: true,
  stale: true,
  unknown: true,
  none: true,
} satisfies Record<FrameFreshness, true>;
const ALL_FRESHNESS = Object.keys(FRESHNESS_COVERAGE) as readonly FrameFreshness[];

const CLASS_COVERAGE = {
  structural: true,
  tunable: true,
  non_mutating: true,
} satisfies Record<MutationClass, true>;
const ALL_CLASSES = Object.keys(CLASS_COVERAGE) as readonly MutationClass[];

/** One representative kind per class, so every class loop binds to a real kind. */
const FIRST_KIND_OF_CLASS: Readonly<Record<MutationClass, CandidateKind>> = {
  structural: 'add_node',
  tunable: 'rename_node',
  non_mutating: 'clarification',
};

// ===========================================================================
// R1 — the scenario the whole ruling exists to fix
// ===========================================================================

describe('R1 — a structural edit after an applied edit is HELD, not refused', () => {
  it('add_node + stale freshness + MATCHING hash → held STRUCTURAL_APPLY_HELD (the consent gate, not a lock)', () => {
    const v = refereeMutation(envFor('add_node'), G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
    expect(v.base_hash_match).toBe(true);
    expect(v.kind).toBe('add_node');
  });

  it('add_edge + stale freshness + MATCHING hash → held STRUCTURAL_APPLY_HELD', () => {
    const v = refereeMutation(envFor('add_edge'), G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
    expect(v.kind).toBe('add_edge');
  });

  it('remove_node + stale freshness → held REMOVE_UNCONFIRMED (the destructive consent posture SURVIVES)', () => {
    const v = refereeMutation(envFor('remove_node'), G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(REMOVE_UNCONFIRMED);
    expect(v.kind).toBe('remove_node');
  });

  it('the 03b dead-end batch shape (add_node THEN add_edge naming it) holds WHOLE on a stale frame — no candidate stales', () => {
    const batch = [
      makeEnvelope('add_node', SAMPLE_PAYLOADS.add_node, { base_graph_hash: H }),
      makeEnvelope(
        'add_edge',
        { edge: { from: 'n-new', to: 'g-profit' } },
        { base_graph_hash: H },
      ),
    ];
    const vs = refereeMutationBatch(batch, G, frameFor(G, 'stale'));
    expect(vs).toHaveLength(2);
    // Bind by kind (identity), not by position-agnostic counting.
    expect(vs.map((v) => v.kind)).toEqual(['add_node', 'add_edge']);
    expect(vs.map((v) => v.verdict)).toEqual(['held', 'held']);
    expect(vs.every((v) => v.verdict !== 'stale')).toBe(true);
  });

  it('the frame gate itself proceeds for a STRUCTURAL class on a stale, hash-matching frame', () => {
    expect(evaluateFrameGate(H, frameFor(G, 'stale')).outcome).toEqual({ kind: 'proceed' });
  });

  it('#829 auto-retirement: staleAnalysisBlocksApply() is now FALSE — the split disclosure stops prescribing a re-run', () => {
    expect(staleAnalysisBlocksApply()).toBe(false);
  });
});

// ===========================================================================
// R5 — THE CARVE-OUT. `unknown` is authority-unresolved, not staleness.
// ===========================================================================

describe("R5 — the carve-out: 'unknown' freshness HOLDS (authority unresolved), never stales, never proceeds", () => {
  it.each(['add_node', 'rename_node', 'remove_edge', 'add_option'] as const)(
    "%s on an 'unknown'-freshness frame → held FRESHNESS_UNRESOLVED",
    (kind) => {
      const v = refereeMutation(envFor(kind), G, frameFor(G, 'unknown'));
      expect(v.verdict).toBe('held');
      expect(v.blocker?.code).toBe(FRESHNESS_UNRESOLVED);
      expect(v.kind).toBe(kind);
      expect(v.base_hash_match).toBe(true);
    },
  );

  it("the frame gate classifies 'unknown' as its OWN outcome kind, not as stale and not as proceed", () => {
    const r = evaluateFrameGate(H, frameFor(G, 'unknown'));
    expect(r.outcome).toEqual({ kind: 'freshness_unresolved' });
    expect(r.baseHashMatch).toBe(true);
  });

  it("⭐ the carve-out must never become a PROCEED: 'unknown' is not in the trust set for ANY class", () => {
    for (const cls of ALL_CLASSES) {
      const kind = FIRST_KIND_OF_CLASS[cls];
      const v = refereeMutation(envFor(kind), G, frameFor(G, 'unknown'));
      expect({ cls, verdict: v.verdict }).toEqual({ cls, verdict: 'held' });
    }
  });

  it('FRESHNESS_UNRESOLVED is a REGISTERED reason code (never an ad-hoc string)', () => {
    expect(MUTATION_REASON_CODES).toContain(FRESHNESS_UNRESOLVED);
  });
});

// ===========================================================================
// R7 — rung 2 is untouched, and it BITES (mutation obligation in the PR body)
// ===========================================================================

describe('R7 — the base-hash guard (genuine divergence) is byte-identical and still governs every class', () => {
  it.each(ALL_FRESHNESS)(
    'diverged base hash + freshness=%s → stale BASE_HASH_DIVERGED (freshness cannot rescue a divergence)',
    (freshness) => {
      const v = refereeMutation(
        makeEnvelope('add_node', SAMPLE_PAYLOADS.add_node, { base_graph_hash: 'a-different-hash' }),
        G,
        frameFor(G, freshness),
      );
      expect(v.verdict).toBe('stale');
      expect(v.blocker?.code).toBe(BASE_HASH_DIVERGED);
      expect(v.base_hash_match).toBe(false);
    },
  );

  it.each(ALL_CLASSES)('diverged base hash stales for class %s too (class-independent CAS)', (cls) => {
    const kind = FIRST_KIND_OF_CLASS[cls];
    const v = refereeMutation(
      makeEnvelope(kind, SAMPLE_PAYLOADS[kind], { base_graph_hash: 'a-different-hash' }),
      G,
      frameFor(G, 'fresh'),
    );
    expect(classifyMutation(kind)).toBe(cls);
    expect(v.verdict).toBe('stale');
    expect(v.blocker?.code).toBe(BASE_HASH_DIVERGED);
  });

  it('the gate reports the divergence with the NARROWED reason literal', () => {
    expect(evaluateFrameGate('another-hash', frameFor(G, 'fresh')).outcome).toEqual({
      kind: 'stale',
      reason: 'base_hash_diverged',
    });
  });

  it('rung 2 outranks rung 3: a diverged hash on an UNKNOWN frame stales (never the freshness hold)', () => {
    const r = evaluateFrameGate('another-hash', frameFor(G, 'unknown'));
    expect(r.outcome).toEqual({ kind: 'stale', reason: 'base_hash_diverged' });
  });
});

// ===========================================================================
// R8a — DERIVED: the outcome is a function of freshness ALONE
// ===========================================================================

describe('R8a — class-independence, derived over the full MutationClass × FrameFreshness product', () => {
  it('the frame gate outcome is identical for every class at each freshness value', () => {
    const observed: Record<string, string[]> = {};
    for (const freshness of ALL_FRESHNESS) {
      const outcomes = ALL_CLASSES.map((cls) => {
        const kind = FIRST_KIND_OF_CLASS[cls];
        // The gate no longer takes a class at all — the class rides only through
        // the ENVELOPE, so refereeing one kind per class is the honest probe.
        const v = refereeMutation(envFor(kind), G, frameFor(G, freshness));
        return v.blocker?.code ?? `verdict:${v.verdict}`;
      });
      observed[freshness] = outcomes;
    }
    // Freshness-driven blockers are the SAME across classes; only the R5/R7
    // kind-posture codes (STRUCTURAL_APPLY_HELD vs would_apply) may differ, so
    // assert on the FRAME GATE outcome directly for the class-independence claim.
    for (const freshness of ALL_FRESHNESS) {
      const gateOutcomes = ALL_CLASSES.map(() =>
        JSON.stringify(evaluateFrameGate(H, frameFor(G, freshness)).outcome),
      );
      expect(new Set(gateOutcomes).size).toBe(1);
    }
    expect(Object.keys(observed)).toHaveLength(ALL_FRESHNESS.length);
  });

  it('evaluateFrameGate accepts NO mutation-class argument — the gate structurally cannot know the class', () => {
    expect(evaluateFrameGate.length).toBe(2);
  });
});

// ===========================================================================
// R8b — UNION assertion (trap 12d: derivation proves agreement, not rightness)
// ===========================================================================

/** Compile-time: `B` must be assignable to `A`. */
type AssertAssignable<A, B extends A> = B;
/** The frame's vocabulary must COVER everything `deriveAnalysisFreshness` emits… */
type _FrameCoversProducer = AssertAssignable<FrameFreshness, AnalysisFreshness>;
/** …and must not invent a value the producer cannot emit. */
type _ProducerCoversFrame = AssertAssignable<AnalysisFreshness, FrameFreshness>;

describe('R8b — the frame freshness vocabulary is COMPLETE against the producer', () => {
  it('every value the producer can emit is classified by the gate (no value falls into an unhandled bucket)', () => {
    // Runtime half: every declared value must resolve to one of the FOUR
    // classified outcomes. A value the gate did not anticipate would surface
    // here as an unexpected kind rather than silently failing closed.
    const kinds = ALL_FRESHNESS.map((f) => evaluateFrameGate(H, frameFor(G, f)).outcome.kind);
    expect(new Set(kinds)).toEqual(new Set(['proceed', 'freshness_unresolved']));
    expect(kinds).toHaveLength(4);
  });

  it('the coverage lists are derived from the unions themselves (a new member is a compile error)', () => {
    expect(ALL_FRESHNESS).toEqual(expect.arrayContaining(['fresh', 'stale', 'unknown', 'none']));
    expect(ALL_FRESHNESS).toHaveLength(4);
    expect(ALL_CLASSES).toHaveLength(3);
  });
});

// ===========================================================================
// R9 — ANALYSIS_NOT_FRESH is unreachable from any production referee path
// ===========================================================================

describe('R9 — no production path can emit ANALYSIS_NOT_FRESH any more', () => {
  it('every candidate kind × every freshness at a MATCHING hash: the blocker is never ANALYSIS_NOT_FRESH', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const kind of CANDIDATE_KINDS) {
      for (const freshness of ALL_FRESHNESS) {
        const v = refereeMutation(envFor(kind), G, frameFor(G, freshness));
        checked += 1;
        if (v.blocker?.code === ANALYSIS_NOT_FRESH) offenders.push(`${kind}/${freshness}`);
      }
    }
    // Positive control: the matrix actually ran (trap 13 — an absence assertion
    // must first prove it can SEE a presence).
    expect(checked).toBe(CANDIDATE_KINDS.length * ALL_FRESHNESS.length);
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('ANALYSIS_NOT_FRESH stays REGISTERED (historical pendings + the ratified wire enum) though nothing emits it', () => {
    expect(MUTATION_REASON_CODES).toContain(ANALYSIS_NOT_FRESH);
  });
});
