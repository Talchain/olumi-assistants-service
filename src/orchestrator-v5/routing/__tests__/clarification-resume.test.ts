/**
 * Unit tests for the clarification-resume pre-route (Wave 5E).
 *
 * The brief evidence #3 closure: a user who types just a factor
 * label after a value-update clarify must dispatch the
 * deterministically reconstructed set_factor_value with the
 * persisted quantity, not fall through to the LLM.
 */

import { describe, expect, it } from 'vitest';

import {
  tryClarificationResume,
  PENDING_ACTION_KIND_SAFETY,
} from '../clarification-resume.js';
import type { PendingAction } from '../../session/pending-action.js';
import { RESUMABLE_ACTION_TYPES } from '../../session/pending-action.js';
import type { GraphLookup } from '../validator.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW_MS = Date.parse('2026-05-06T12:00:00.000Z');

// Default fixture matches the production invariant: every emitted
// set_factor_value pending carries a graph_hash precondition. Tests
// that exercise the legacy/missing-hash path override `preconditions`
// explicitly. The default `currentGraphHash` ('sha256:default')
// matches this fixture so the safety gate passes by default; tests
// that exercise divergence override `currentGraphHash` on the call.
const DEFAULT_GRAPH_HASH = 'sha256:default';

function setFactorValuePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: `pa-${Math.random()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip-clarify-1',
    action: {
      kind: 'set_factor_value',
      factor_id: 'f_eng_time',
      value: 0.3,
      operator: 'set',
    },
    preconditions: { graph_hash: DEFAULT_GRAPH_HASH },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-05-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeGraphLookup(
  nodes: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  return {
    findEntityById(id: string) {
      const found = nodes.find((n) => n.id === id);
      if (!found) return null;
      return { id: found.id, kind: 'node' as const, label: found.label };
    },
    listEntitiesByKind(_kind) {
      return nodes.map((n) => ({ id: n.id, label: n.label }));
    },
  } as GraphLookup;
}

describe('tryClarificationResume — negative gates', () => {
  it('messages with edit verbs fall through to the value-update detector', () => {
    const r = tryClarificationResume({
      message: 'set engineering time commitment to 30%',
      pendingActions: [setFactorValuePending()],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({
      matched: false,
      skip_reason: 'message_likely_value_update',
    });
  });

  it('bare confirmation messages fall through to the short-confirm pre-route', () => {
    const r = tryClarificationResume({
      message: 'yes',
      pendingActions: [setFactorValuePending()],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({
      matched: false,
      skip_reason: 'message_likely_short_confirm',
    });
  });

  it('returns no_pending_clarification when no set_factor_value pending exists', () => {
    const r = tryClarificationResume({
      message: 'engineering time commitment',
      pendingActions: [],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_pending_clarification' });
  });

  it('returns no_graph when graph lookup is undefined', () => {
    const r = tryClarificationResume({
      message: 'engineering time commitment',
      pendingActions: [setFactorValuePending()],
      graphLookup: undefined,
      // currentGraphHash matches the default fixture so the
      // graph-hash safety gate passes; the test isolates the
      // no_graph skip reason that fires after the gate.
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_graph' });
  });
});

describe('tryClarificationResume — match cases', () => {
  it('matches a single set_factor_value pending by exact label match', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.dispatch).toBe('set_factor_value');
      expect(r.pending.id).toBe(pending.id);
      expect(r.factorLabel).toBe('Engineering Time Commitment');
    }
  });

  it('matches when the message is a label substring', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      message: 'the Engineering Time Commitment one',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
  });

  it('matches case-insensitively', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      message: 'engineering time commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
  });

  it('returns no_label_match when the message does not match any candidate', () => {
    const r = tryClarificationResume({
      message: 'something completely different',
      pendingActions: [setFactorValuePending()],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_label_match' });
  });

  it('returns multiple_label_matches when more than one candidate label is contained in the message', () => {
    const pending1 = setFactorValuePending({
      id: 'pa-1',
      action: { kind: 'set_factor_value', factor_id: 'f_eng', value: 0.3, operator: 'set' },
    });
    const pending2 = setFactorValuePending({
      id: 'pa-2',
      action: { kind: 'set_factor_value', factor_id: 'f_owner', value: 0.3, operator: 'set' },
    });
    const r = tryClarificationResume({
      message: 'Engineering Owner',
      pendingActions: [pending1, pending2],
      graphLookup: makeGraphLookup([
        { id: 'f_eng', label: 'Engineering' },
        { id: 'f_owner', label: 'Owner' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    // Wave 5I-2 — multi-candidate match becomes a focused
    // recovery_label_ambiguous dispatch (caller emits one chip per
    // candidate). Previously fell through to LLM with skip_reason.
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.dispatch).toBe('recovery_label_ambiguous');
      if (r.dispatch === 'recovery_label_ambiguous') {
        expect(r.candidates.map((c) => c.factorLabel).sort()).toEqual([
          'Engineering',
          'Owner',
        ]);
      }
    }
  });

  it('returns recovery_targets_missing when persisted factor is gone from the live graph', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      // Empty graph — the factor_id from the prior pending action is gone.
      graphLookup: makeGraphLookup([]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toEqual({ matched: true, dispatch: 'recovery_targets_missing' });
  });

  it('returns recovery_expired when pending action wall-clock expiry has passed', () => {
    const expired = setFactorValuePending({
      expires_at_iso: '2026-01-01T00:00:00.000Z', // before NOW_MS
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [expired],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({
      matched: true,
      dispatch: 'recovery_expired',
      expired_count: 1,
    });
  });

  it('returns recovery_expired for malformed expires_at_iso (defence-in-depth)', () => {
    const malformed = setFactorValuePending({
      expires_at_iso: 'not-a-date',
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [malformed],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({
      matched: true,
      dispatch: 'recovery_expired',
      expired_count: 1,
    });
  });

  it('returns recovery_graph_changed when persisted hash diverges from live hash', () => {
    const pending = setFactorValuePending({
      preconditions: { graph_hash: 'sha256:before' },
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: 'sha256:after',
    });
    expect(r).toEqual({ matched: true, dispatch: 'recovery_graph_changed' });
  });

  it('returns recovery_graph_changed when persisted hash exists but live hash is unknown', () => {
    const pending = setFactorValuePending({
      preconditions: { graph_hash: 'sha256:before' },
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      // currentGraphHash omitted — defence-in-depth treats as conflict
    });
    expect(r).toEqual({ matched: true, dispatch: 'recovery_graph_changed' });
  });

  it('passes when both persisted and current graph hashes match', () => {
    const pending = setFactorValuePending({
      preconditions: { graph_hash: 'sha256:abc' },
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: 'sha256:abc',
    });
    expect(r.matched).toBe(true);
  });

  it('Wave 5J-2: legacy set_factor_value pending without preconditions.graph_hash dispatches recovery_graph_changed (fail closed)', () => {
    // Pre-Wave-5I-1 rows in production may carry no graph_hash, and
    // any future emit path that forgets to pass it falls into the
    // same shape. For mutating kinds (set_factor_value) the resumer
    // must fail closed: missing hash on the pending → cannot prove
    // the model is still safe to mutate → focused recovery.
    const legacyPending = setFactorValuePending({
      preconditions: { target_entity_ids: ['f_eng_time'] },
    });
    expect(legacyPending.preconditions?.graph_hash).toBeUndefined();
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [legacyPending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: 'sha256:live',
    });
    expect(r).toEqual({ matched: true, dispatch: 'recovery_graph_changed' });
  });

  it('Wave 5J-2: set_factor_value pending where the live graph hash is undefined dispatches recovery_graph_changed', () => {
    const pending = setFactorValuePending({
      preconditions: {
        target_entity_ids: ['f_eng_time'],
        graph_hash: 'sha256:emit',
      },
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      // currentGraphHash deliberately omitted — proves the safety
      // gate fires when the live hash cannot be computed (e.g. no
      // graph_state on the resume turn).
    });
    expect(r).toEqual({ matched: true, dispatch: 'recovery_graph_changed' });
  });

  it('fuzzy match catches typos with bigram-Dice ≥ 0.5', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      // Typo: missing 'i' in "Engineering" and missing 'm' in "Commitment"
      message: 'Engneering Time Comitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.matchKind).toBe('fuzzy');
    }
  });

  it('fuzzy match returns multiple_label_matches when more than one candidate clusters above threshold', () => {
    const pending1 = setFactorValuePending({
      id: 'pa-1',
      action: { kind: 'set_factor_value', factor_id: 'f_a', value: 0.3, operator: 'set' },
    });
    const pending2 = setFactorValuePending({
      id: 'pa-2',
      action: { kind: 'set_factor_value', factor_id: 'f_b', value: 0.3, operator: 'set' },
    });
    const r = tryClarificationResume({
      // Typed message that is fuzzy-similar to BOTH labels.
      message: 'time commitment',
      pendingActions: [pending1, pending2],
      graphLookup: makeGraphLookup([
        { id: 'f_a', label: 'Engineering Time Commitment' },
        { id: 'f_b', label: 'Owner Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    // Both labels share "Time Commitment" — substring match fires for
    // BOTH, producing a recovery_label_ambiguous dispatch with both
    // candidates surfaced for a focused re-clarify (no LLM call).
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'recovery_label_ambiguous') {
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates.map((c) => c.factorLabel).sort()).toEqual([
        'Engineering Time Commitment',
        'Owner Time Commitment',
      ]);
    } else {
      throw new Error(`expected recovery_label_ambiguous, got ${JSON.stringify(r)}`);
    }
  });

  it('matchKind is "exact" for exact-equal label, "substring" for substring, "fuzzy" otherwise', () => {
    const pending = setFactorValuePending();
    const exact = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(exact.matched).toBe(true);
    if (exact.matched) expect(exact.matchKind).toBe('exact');

    const substring = tryClarificationResume({
      message: 'the Engineering Time Commitment one',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(substring.matched).toBe(true);
    if (substring.matched) expect(substring.matchKind).toBe('substring');
  });

  it('ignores pending actions of other kinds', () => {
    const runAnalysisPending: PendingAction = {
      id: 'pa-ra',
      scenario_id: SCENARIO_ID,
      chip_id: 'chip-ra',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-05-05T00:00:00.000Z',
    };
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [runAnalysisPending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_pending_clarification' });
  });
});

describe('tryClarificationResume — kind classification regression', () => {
  // The resumer's fail-closed divergence guard branches on
  // `PENDING_ACTION_KIND_SAFETY_CLASSIFICATION`, a `Record<PendingActionKind,
  // 'mutating' | 'non_mutating'>`. TypeScript enforces exhaustiveness at
  // compile time — adding a kind to the union without classifying it is
  // a type error.
  //
  // What TypeScript does NOT enforce is the SEMANTIC correctness of the
  // classification. A future refactor could move `set_factor_value` out
  // of `mutating` by mistake, or classify a graph-mutating kind as
  // `non_mutating`, and the type would still compile.
  //
  // This regression pins the EXPECTED classification per kind. The
  // `EXPECTED_CLASSIFICATION` table below uses `Record<PendingActionKind, ...>`
  // so adding a kind to the union without updating the table is a
  // compile error, AND moving an existing kind's classification flips
  // the runtime assertion. Both halves of the contract are guarded.

  const EXPECTED_CLASSIFICATION: Record<
    PendingAction['action']['kind'],
    'mutating' | 'non_mutating'
  > = {
    // Graph-mutating today.
    set_factor_value: 'mutating',
    // Reserved graph-mutating kinds (depend on graph_hash per the
    // PendingAction docstring). Classifying as `mutating` now means
    // they fail closed when wired, rather than slipping through the
    // non-mutating branch.
    apply_proposed_change: 'mutating',
    edit_graph_add_risk: 'mutating',
    // Non-mutating: resuming reads from analysis state, does not
    // change the graph.
    run_analysis: 'non_mutating',
    what_would_flip: 'non_mutating',
    // V5 P0 proposal-memory continuation — server-only, never applies
    // a graph mutation when resumed (the resumer in edit-graph-dispatch
    // emits deterministic Stage 1 / Stage 2 clarification copy only).
    // Graph-hash divergence is observed at the resume site but does
    // NOT use this classification's divergence guard.
    proposed_concept: 'non_mutating',
    // ROADMAP 2.63 C3/C4 — draft/redraft offer, resumed at route level only.
    // MUTATING fail-closed: the C4 variant's consent REPLACES the persisted
    // graph, and the offer pins preconditions.graph_hash.
    draft_graph: 'mutating',
  };

  it('every PendingAction kind has the expected safety classification (semantic regression)', () => {
    const expectedEntries = Object.entries(EXPECTED_CLASSIFICATION) as Array<
      [PendingAction['action']['kind'], 'mutating' | 'non_mutating']
    >;
    for (const [kind, expected] of expectedEntries) {
      const actual = PENDING_ACTION_KIND_SAFETY.byKind[kind];
      expect(
        actual,
        `kind '${kind}' should be classified as '${expected}', but the production ` +
          `module classifies it as '${actual}'. If this change is intentional, ` +
          `update EXPECTED_CLASSIFICATION in this test AND verify the resumer's ` +
          `divergence guard semantics are still correct.`,
      ).toBe(expected);
    }
  });

  it('every kind in RESUMABLE_ACTION_TYPES is also classified (no orphans either way)', () => {
    const expectedKeys = new Set<string>(Object.keys(EXPECTED_CLASSIFICATION));
    const resumableKinds = new Set<string>(RESUMABLE_ACTION_TYPES);
    // EXPECTED_CLASSIFICATION covers everything in the union (TypeScript
    // enforces this). RESUMABLE_ACTION_TYPES should also cover the
    // union; this asserts the two stay in sync.
    expect([...expectedKeys].sort()).toEqual([...resumableKinds].sort());
  });

  it('PENDING_ACTION_KIND_SAFETY.mutating is derived correctly from the classification table', () => {
    const expectedMutating = (
      Object.entries(EXPECTED_CLASSIFICATION) as Array<
        [PendingAction['action']['kind'], 'mutating' | 'non_mutating']
      >
    )
      .filter(([, c]) => c === 'mutating')
      .map(([k]) => k)
      .sort();
    const actualMutating = [...PENDING_ACTION_KIND_SAFETY.mutating].sort();
    expect(actualMutating).toEqual(expectedMutating);
  });
});

// ---------------------------------------------------------------------------
// F-HELD fix 4b (A-variant) — driver-answer resume for edit_graph_add_risk.
// Wire shape 04c→10c (2026-07-11): the add-risk clarify asks "What factor
// drives it most?" and the user's answer ("Team size drives it most.") was
// dropped. The resumer must claim that reply against a live, hash-safe
// edit_graph_add_risk pending, mirroring the set_factor_value pattern
// (kind gate + liveness + hash gate, then label match).
// ---------------------------------------------------------------------------

describe('tryClarificationResume — edit_graph_add_risk driver-answer resume (F-HELD 4b)', () => {
  function addRiskPending(overrides: Partial<PendingAction> = {}): PendingAction {
    return {
      id: `pa-add-risk-${Math.random()}`,
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_add_risk_clarify',
      action: {
        kind: 'edit_graph_add_risk',
        label: 'client concentration',
      },
      preconditions: { graph_hash: DEFAULT_GRAPH_HASH },
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-05-05T00:00:00.000Z',
      ...overrides,
    };
  }

  const FACTOR_LOOKUP = makeGraphLookup([
    { id: 'f_team_size', label: 'Team size' },
    { id: 'f_budget', label: 'Available budget' },
  ]);

  it('wire 10c shape: "Team size drives it most." resolves the driver against the graph', () => {
    const pending = addRiskPending();
    const r = tryClarificationResume({
      message: 'Team size drives it most.',
      pendingActions: [pending],
      graphLookup: FACTOR_LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'edit_graph_add_risk') {
      expect(r.pending.id).toBe(pending.id);
      expect(r.riskLabel).toBe('client concentration');
      expect(r.driverFactorId).toBe('f_team_size');
      expect(r.driverLabel).toBe('Team size');
    } else {
      throw new Error(`expected edit_graph_add_risk dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('a bare factor-label reply also resolves (chip-click / terse answer shape)', () => {
    const r = tryClarificationResume({
      message: 'Team size',
      pendingActions: [addRiskPending()],
      graphLookup: FACTOR_LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'edit_graph_add_risk') {
      expect(r.driverFactorId).toBe('f_team_size');
    } else {
      throw new Error(`expected edit_graph_add_risk dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('an answer-shaped reply naming a NEW driver (not in the graph) is still claimed, with driverFactorId null', () => {
    // The clarify examples routinely suggest factors that do NOT exist yet
    // ("for example team size, hiring pace, or onboarding complexity") — the
    // answer scaffold is the strong signal, not graph membership.
    const r = tryClarificationResume({
      message: 'Hiring pace drives it most.',
      pendingActions: [addRiskPending()],
      graphLookup: FACTOR_LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'edit_graph_add_risk') {
      expect(r.driverFactorId).toBeNull();
      expect(r.driverLabel).toBe('Hiring pace');
      expect(r.matchKind).toBe('answer_shape');
    } else {
      throw new Error(`expected edit_graph_add_risk dispatch, got ${JSON.stringify(r)}`);
    }
  });

  it('an unrelated free-text reply is NOT claimed (falls through to the LLM)', () => {
    const r = tryClarificationResume({
      message: 'what should we look at next',
      pendingActions: [addRiskPending()],
      graphLookup: FACTOR_LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_label_match' });
  });

  it('all add-risk pendings expired → recovery_expired', () => {
    const r = tryClarificationResume({
      message: 'Team size drives it most.',
      pendingActions: [
        addRiskPending({ expires_at_iso: '2026-05-06T11:00:00.000Z' }), // 1h before NOW_MS
      ],
      graphLookup: FACTOR_LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toMatchObject({ matched: true, dispatch: 'recovery_expired' });
  });

  it('graph hash diverged since the clarify → recovery_graph_changed (mutating kind, fail-closed)', () => {
    const r = tryClarificationResume({
      message: 'Team size drives it most.',
      pendingActions: [addRiskPending()],
      graphLookup: FACTOR_LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: 'sha256:diverged',
    });
    expect(r).toMatchObject({ matched: true, dispatch: 'recovery_graph_changed' });
  });

  it('missing graph_hash on the pending → recovery_graph_changed (house hash gate fails closed)', () => {
    const r = tryClarificationResume({
      message: 'Team size drives it most.',
      pendingActions: [addRiskPending({ preconditions: {} })],
      graphLookup: FACTOR_LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toMatchObject({ matched: true, dispatch: 'recovery_graph_changed' });
  });

  it('the edit-verb negative gate still protects real edit messages ("add it to the model")', () => {
    const r = tryClarificationResume({
      message: 'add it to the model',
      pendingActions: [addRiskPending()],
      graphLookup: FACTOR_LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'message_likely_value_update' });
  });

  it('set_factor_value pendings take precedence when both kinds coexist (existing flow unchanged)', () => {
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [setFactorValuePending(), addRiskPending()],
      graphLookup: makeGraphLookup([{ id: 'f_eng_time', label: 'Engineering Time Commitment' }]),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.dispatch).toBe('set_factor_value');
    }
  });
});

// ---------------------------------------------------------------------------
// F-HELD round 2, FIXUP 4 — negation/filler stop-list for the driver matcher.
// Scaffold 2 ("probably <X>") previously captured "not" from "Probably not"
// and claimed it as a NEW driver concept — a declined clarify must fall to
// the LLM, not mint an add-risk continuation for the driver "not".
// ---------------------------------------------------------------------------

describe('tryClarificationResume — driver stop-list rejects negations/fillers (F-HELD round 2)', () => {
  function addRiskPendingR2(): PendingAction {
    return {
      id: `pa-add-risk-r2-${Math.random()}`,
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_add_risk_clarify',
      action: { kind: 'edit_graph_add_risk', label: 'client concentration' },
      preconditions: { graph_hash: DEFAULT_GRAPH_HASH },
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-05-05T00:00:00.000Z',
    };
  }
  const LOOKUP = makeGraphLookup([{ id: 'f_team_size', label: 'Team size' }]);

  it.each([
    'Probably not',
    'probably not.',
    'Mostly nothing',
    'Mainly no',
    'It is mostly unsure',
    'probably maybe',
  ])('"%s" is NOT claimed as a driver answer (falls through to the LLM)', (msg) => {
    const r = tryClarificationResume({
      message: msg,
      pendingActions: [addRiskPendingR2()],
      graphLookup: LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_label_match' });
  });

  it('a genuine driver answer still resolves after the stop-list ("Probably hiring pace")', () => {
    const r = tryClarificationResume({
      message: 'Probably hiring pace',
      pendingActions: [addRiskPendingR2()],
      graphLookup: LOOKUP,
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'edit_graph_add_risk') {
      expect(r.driverLabel).toBe('hiring pace');
      expect(r.matchKind).toBe('answer_shape');
    } else {
      throw new Error(`expected edit_graph_add_risk dispatch, got ${JSON.stringify(r)}`);
    }
  });
});
