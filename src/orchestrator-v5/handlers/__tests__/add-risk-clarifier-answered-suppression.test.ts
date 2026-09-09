/**
 * ⭐⭐ AN ANSWERED ADD-RISK CLARIFICATION MUST NOT BE RE-OPENED AS STAGE 1.
 *
 * Measured on request `b0d541a9-1631-4604-9546-f089dbb916cc` (8 Sep 2026, CEE
 * `0f1cbc6b`, diagnosis `output/olumi-manual-b0d541a9-20260908/`): after a
 * proposal, "Please can you add it as a risk?" produced `add_risk_clarified`,
 * and then `no_op_recovery` fired `proposal_stage_one` with
 * `rewrote_text: true`, replacing that specific clarification with the generic
 * "one of these" kind chooser. Zero LLM calls, zero operations, 12 nodes / 21
 * edges unchanged. Clicking "Add as risk" repeated the chooser.
 *
 * PR #212 already established the contract — the recovery's `proposal_stage_*`
 * ladder must not fire when this turn has ALREADY answered deterministically —
 * but it keyed on the pre-LLM intercept alone. The add-risk fast path is the
 * SIBLING deterministic answer (the intercept lives in its `else`: "Add-risk
 * still wins"), and `edit-graph-dispatch.ts` says so in its own comment at the
 * fall-through: "or this is the add-risk branch where the intercept is
 * skipped". Same contract, one path short.
 *
 * ⚠ ANSWERED, NOT MATCHED. The dispatch already has
 *   `deterministicAddRiskAttempted` for "the classifier matched"; keying on
 *   that would suppress the ladder on turns the clarifier began and did not
 *   finish. The flag is set only where the clarification is returned.
 *
 * ⚠ THE PAIR IS THE EVIDENCE. Suppression alone proves nothing — a fixture that
 *   never triggered Stage 1 would "pass" it. The unsuppressed case proves this
 *   exact input DOES reach `proposal_stage_one`, so the suppressed case is the
 *   flag's doing and not the fixture's failure.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { decideNoOpRecovery } from '../edit-graph-dispatch.js';

/** The captured shape: a pending proposal plus a bare agreement. */
const PENDING = {
  concept: 'competitor reactive AI-feature launches',
  preferred_kind: 'risk' as const,
};
const AGREEMENT = 'Yes please';

describe('an add-risk clarification that ANSWERED the turn is not re-opened', () => {
  it('NEGATIVE CONTROL — unsuppressed, this exact input DOES reach proposal_stage_one', () => {
    const decision = decideNoOpRecovery({
      message: AGREEMENT,
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING,
    });
    // Without this, the assertion below would pass on a fixture that never
    // triggers the ladder at all.
    expect(decision.branch).toBe('proposal_stage_one');
  });

  it('SUPPRESSED — the answered turn keeps its clarification, Stage 1 does not fire', () => {
    const decision = decideNoOpRecovery({
      message: AGREEMENT,
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING,
      // Set by the dispatch call site when the pre-LLM intercept emitted, and
      // now also when the add-risk clarifier actually answered.
      proposalAlreadyEmittedInThisTurn: true,
    });
    expect(decision.branch).not.toBe('proposal_stage_one');
    expect(decision.branch).not.toBe('proposal_stage_two');
  });

  it('a genuinely ambiguous agreement with NO answered clarifier still reaches Stage 1', () => {
    // The behaviour that must NOT move: this repair narrows only the case where
    // the turn was already answered. Ambiguity still gets the chooser.
    const decision = decideNoOpRecovery({
      message: 'ok',
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: { concept: 'onboarding effort', preferred_kind: 'either' },
    });
    expect(decision.branch).toBe('proposal_stage_one');
  });
});
