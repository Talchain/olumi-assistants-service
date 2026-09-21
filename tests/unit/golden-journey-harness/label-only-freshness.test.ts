/**
 * Label-only (cosmetic) edit freshness — current CEE truth pinned at the
 * wire, plus the tracked server-authoritative-freshness known gap.
 *
 * ── ISSUE-9021 — label-only edit freshness: UI and CEE disagree ──────────
 * Current issue    UI and CEE may disagree on whether a label-only edit
 *                  makes the analysis stale. CEE truth (pinned in
 *                  src/orchestrator-v5/__tests__/cosmetic-edit-pending-gate.test.ts):
 *                  a label-only edit moves the CEE-local graphIdentityHash
 *                  but NOT the analysis-affecting hash, so analysis stays
 *                  'fresh' and pending proposals survive. The UI has no
 *                  access to either hash and may derive its own answer.
 * Target           Server-authoritative freshness is the single source of
 *                  truth. UI and CEE must agree because both read the same
 *                  authoritative signal, not because they run the same
 *                  local heuristic.
 * Owner            Canonical State / freshness substrate.
 * Track 4 rule     Track 4 must NOT compute local freshness as product
 *                  truth — it consumes `analysis_ready.freshness` (and the
 *                  flag-gated `_context_summary.analysis_state`) verbatim.
 * Conversion       When the identity/freshness substrate becomes
 *                  wire-observable or otherwise authoritative (see the
 *                  identity-exposure hook, ISSUE-9024, in
 *                  tests/unit/ai-harness/future-hooks-registry.test.ts),
 *                  un-skip the parity case below and convert the A3
 *                  blind-spot pin into an enforcing durability check.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * The harness asserts wire behaviour only. It must never recompute hashes,
 * normalise graphs, or derive freshness locally — the architecture-protection
 * scan enforces that. Everything here reads classifier verdicts over
 * hand-built observations.
 */

import { describe, expect, it } from 'vitest';

import {
  a1AnalysisCoherence,
  a3DurableStateChanged,
  a4NoFalseSuccess,
} from '../../../tools/golden-journey-harness/invariants.js';
import {
  getFreshness,
  hasProposedPendingAction,
  type TurnObservation,
  type TurnRole,
  type WireBody,
} from '../../../tools/golden-journey-harness/observation.js';

function obs(partial: Partial<TurnObservation> & { role: TurnRole; body?: WireBody }): TurnObservation {
  return {
    step: partial.step ?? `step_${partial.role}`,
    role: partial.role,
    httpStatus: partial.httpStatus ?? 200,
    body: partial.body,
    diagnosticTraceExpected: partial.diagnosticTraceExpected ?? true,
    priorRunHash: partial.priorRunHash ?? null,
    priorGraphHash: partial.priorGraphHash ?? null,
    optionLabels: partial.optionLabels ?? [],
    factorLabels: partial.factorLabels ?? [],
  };
}

/**
 * A label-only edit turn as it appears ON THE WIRE today: the
 * analysis-affecting hash did not move (label edits are analysis-neutral),
 * freshness stays 'fresh', and the prior pending proposal is still live.
 * The copy names the rename without any mutation-success claim shape.
 */
const LABEL_ONLY_TURN = obs({
  role: 'mutate',
  step: 'label_only_edit',
  priorRunHash: 'a1b2c3d4e5f6a1b2',
  priorGraphHash: 'a1b2c3d4e5f6a1b2',
  body: {
    assistant_text:
      'The factor is now called Team capacity. Renaming it does not change the analysis — your results are still current.',
    pending_actions: [{ action: { kind: 'proposed_concept' } }],
    analysis_ready: {
      status: 'ready',
      freshness: 'fresh',
      freshness_reason: 'graph_hash_match',
      graph_hash_at_run: 'a1b2c3d4e5f6a1b2',
      current_graph_hash: 'a1b2c3d4e5f6a1b2',
    },
  },
});

describe('label-only edit — current CEE truth pinned at the wire (ISSUE-9021 context)', () => {
  it('freshness stays "fresh" and the pending proposal stays visible — the harness reads, never derives', () => {
    // CEE-side ownership of WHY this is fresh (analysisAffectingHash
    // unchanged) is pinned by cosmetic-edit-pending-gate.test.ts. The
    // harness only proves the wire projection of that truth.
    expect(getFreshness(LABEL_ONLY_TURN.body)).toBe('fresh');
    expect(hasProposedPendingAction(LABEL_ONLY_TURN.body)).toBe(true);
  });

  it('the harness raises no staleness or false-success finding for CEE-correct label-only behaviour', () => {
    const a1 = a1AnalysisCoherence(LABEL_ONLY_TURN);
    expect(a1[0]!.status).toBe('pass');
    const a4 = a4NoFalseSuccess(LABEL_ONLY_TURN);
    expect(a4[0]!.status).toBe('pass');
  });

  it('documented blind spot, not silently green: A3 cannot distinguish a durable label-only edit from a no-op today', () => {
    // The analysis-affecting hash is the ONLY durability signal on the
    // wire, and a label-only edit deliberately does not move it. So A3
    // reads this durable-but-analysis-neutral edit as "a counted action
    // did not change canonical state" — a false RED that is exactly the
    // identity-hash-exposure gap (ISSUE-9021 / ISSUE-9024). This pin keeps
    // the blind spot VISIBLE; do not "fix" it by teaching the harness to
    // hash graphs locally. When an authoritative identity/freshness signal
    // reaches an observable surface, convert this case to an enforcing
    // durability check that reads that signal.
    const a3 = a3DurableStateChanged(LABEL_ONLY_TURN);
    expect(a3[0]!.status).toBe('fail');
    expect(a3[0]!.evidence).toMatch(/UNCHANGED after a mutation step/);
  });

  // TODO: ISSUE-9021 — server-authoritative freshness: UI/CEE label-only parity.
  // Owner: Canonical State / freshness substrate. Unblocked by an authoritative,
  // observable identity/freshness signal (see ISSUE-9024 hook). Track 4 must not
  // compute local freshness as product truth.
  it.skip('when server-authoritative freshness lands: UI and CEE agree on label-only edits, and durable label-only edits are distinguishable from no-ops', () => {
    // Expected when unblocked:
    //  - the wire (or another authoritative surface) carries a signal that
    //    distinguishes “durable but analysis-neutral” from “no write”;
    //  - a label-only edit keeps analysis_ready.freshness === 'fresh' AND
    //    proves durability via that signal;
    //  - the same signal is what the UI renders — no UI-local derivation;
    //  - the A3 blind-spot pin above is converted to enforce it.
    expect.unreachable('blocked-future: no authoritative wire signal for label-only durability exists yet');
  });
});
