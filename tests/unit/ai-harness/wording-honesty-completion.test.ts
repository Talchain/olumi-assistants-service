/**
 * AI Harness completion pass — wording-honesty regression coverage.
 *
 * Copy about graph changes must be grounded in authoritative handler/output
 * state, never in prose pattern-matching alone. This suite proves, against
 * the REAL src detectors and gates (no local substitutes):
 *
 *   1. The forbidden false-success claim classes the product DOES detect
 *      today ("Applied…", "Updated the graph", "Added the risk…",
 *      "Changed the model", has-been-saved/committed forms) are detected.
 *   2. The claim classes the product does NOT detect today (Restored /
 *      Rolled back / version-noun claims) are pinned as an HONEST gap:
 *      src deliberately does not block them — no version substrate exists
 *      and the runtime swap is precision-first. The HARNESS carries this
 *      class on replay (broadened A4/A8 classifiers,
 *      tools/golden-journey-harness/invariants.ts + the
 *      golden-journey-v1-false-restore fixture). Do not read these pins as
 *      "src blocks restore wording" — it does not, and that is the point.
 *   3. The honest distinct states (proposal declined safely, stale,
 *      unconfirmed, nothing-changed) carry no success claims and no
 *      forbidden phrases, and rerun affordances are specific + executable.
 *   4. Freshness truth: stale is stale, never absent.
 *
 * Authoritative-state grounding: `classifyStructuralClaim` takes the
 * handler truth (`handlerEmittedMutatedGraph`) as input — the same signal
 * the turn-executor swap site uses — so these proofs bind copy verdicts to
 * committed-write state, not to wording alone.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyStructuralClaim,
  V5_STRUCTURAL_DECLINE_TEXT,
} from '../../../src/orchestrator-v5/routing/mutation-language.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';
import { tryRunComparisonGate } from '../../../src/orchestrator-v5/routing/run-comparison-gate.js';
import { deriveAnalysisFreshness } from '../../../src/orchestrator-v5/context/freshness.js';
import { generateChips } from '../../../src/orchestrator-v5/compose/chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../src/orchestrator-v5/routing/validation-registry.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphPatchBlockData, V2RunResponseEnvelope } from '../../../src/orchestrator/types.js';
import type { TurnOutcome } from '../../../src/orchestrator-v5/turn-outcome.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

// ── shared fixture builders (mirrors run-comparison-gate.test.ts / ─────────
// chip-generator-post-mutation.test.ts — view-building only, no logic) ──────

function envelope(
  options: Array<{ id: string; label: string; win: number }>,
  band?: string,
): V2RunResponseEnvelope {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({ option_id: o.id, option_label: o.label, win_probability: o.win })),
    ...(band ? { robustness_synthesis: { overall_assessment: band } } : {}),
  } as unknown as V2RunResponseEnvelope;
}

function runFact(env: V2RunResponseEnvelope, opts: { computedAt?: string; hash?: string | null } = {}): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: env,
      computed_at: opts.computedAt ?? '2026-06-06T00:00:00.000Z',
      graph_hash_at_run: opts.hash === undefined ? 'a1b2c3d4e5f6a1b2' : opts.hash,
    },
  } as unknown as HandlerFact;
}

function setFactorValueFact(): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: { target_id: 'factor_x', status: 'applied', before: { value: 6 }, after: { value: 9 } },
  } as unknown as HandlerFact;
}

const READY: AnalysisReadyPayload = { options: [], goal_node_id: 'goal', status: 'ready' };

function turnOutcomeWithFreshness(freshness: 'fresh' | 'stale' | 'unknown' | 'none'): TurnOutcome {
  return {
    graph_mutated: false,
    analysis_run: false,
    analysis_selected_fact_index: null,
    analysis_freshness: freshness,
    freshness_reason: 'no_successful_run_analysis_fact',
  };
}

// ── 1. detected false-success claim classes (current coverage pinned) ──────

describe('forbidden false-success claims the product detects today', () => {
  const DETECTED_CLAIMS: readonly string[] = [
    'Applied the change.',
    'Updated the graph.',
    'Added the risk factor to your model.',
    'Changed the model as you asked.',
    'The change has been saved.',
    'The edit has been committed.',
  ];

  it.each(DETECTED_CLAIMS)('findSuccessClaimHit detects: %s', (text) => {
    expect(findSuccessClaimHit(text)).not.toBeNull();
  });

  it('the same wording is TRUE (and kept) when the handler actually committed a write', () => {
    // Copy honesty is a function of authoritative state, not of the words:
    // with handlerEmittedMutatedGraph=true the identical claim must pass.
    const decision = classifyStructuralClaim({
      assistantText: 'I added the risk factor to your model.',
      handlerEmittedMutatedGraph: true,
      proposedHandlerId: 'edit_graph',
    });
    expect(decision.verdict).toBe('pass');
  });

  it('the structural claim with NO committed write is swapped to the decline text', () => {
    const decision = classifyStructuralClaim({
      assistantText: 'I added the risk factor to your model.',
      handlerEmittedMutatedGraph: false,
      proposedHandlerId: null,
    });
    expect(decision.verdict).toBe('swap');
  });
});

// ── 2. the src gap: restore/rollback/version claims (HONEST pin) ───────────

describe('src gap pinned honestly: restore/rollback/version claims are NOT runtime-detected today', () => {
  // These pins document that src does NOT block this wording. The harness
  // replay classifiers (A4/A8) carry the class instead — see
  // tools/golden-journey-harness/invariants.ts and the
  // golden-journey-v1-false-restore fixture. Runtime detection is
  // Model-Management-owned future work: 'version|versions' sits in the
  // mutation-language NON-graph artefact-noun exclusion on purpose (there
  // is no version substrate, so "your version of the plan" prose must not
  // be declined), and the egress SUCCESS_CLAIM_PATTERNS verb lists do not
  // include restored/reverted/rolled back. If any of these pins flips,
  // src gained (or lost) coverage — update the harness coverage note and
  // the ISSUE-9022 hook deliberately, in the same change.

  it.each([
    'Restored the previous version.',
    'Rolled back your changes.',
    'I have restored your earlier model.',
    'Committed the change to your model.',
  ])('findSuccessClaimHit returns null (undetected) for: %s', (text) => {
    expect(findSuccessClaimHit(text)).toBeNull();
  });

  it.each([
    ['Restored the previous version.', 'pass'],
    ['Rolled back your changes.', 'pass'],
    ['I have restored your earlier model.', 'pass'],
  ])('classifyStructuralClaim does not swap %s (verdict: %s)', (text, verdict) => {
    const decision = classifyStructuralClaim({
      assistantText: text,
      handlerEmittedMutatedGraph: false,
      proposedHandlerId: null,
    });
    expect(decision.verdict).toBe(verdict);
  });

  it('version-noun claim is monitor-only by design: "I created a version of the model…" → monitor, not swap', () => {
    const decision = classifyStructuralClaim({
      assistantText: 'I created a version of the model so you can restore it later.',
      handlerEmittedMutatedGraph: false,
      proposedHandlerId: null,
    });
    expect(decision.verdict).toBe('monitor');
  });

  // Restore/revert/rolled-back/version-claim runtime detection is deferred until a
  // Model Management substrate exists (owner: Model Management; see the model-versions
  // hook in tests/unit/ai-harness/future-hooks-registry.test.ts). The harness A4/A8
  // replay classifiers carry assurance coverage meanwhile.
  // TODO: ISSUE-9022 — src-side restore/version claim detection (Model Management).
  it.skip('when model versioning exists: uncommitted restore/version claims must swap or be egress-blocked', () => {
    // Expected when unblocked: the pins above INVERT — findSuccessClaimHit
    // detects restore/rollback claims, classifyStructuralClaim swaps them
    // when no committed write/version operation backs them, and the
    // 'version' noun leaves the mutation-language NON-graph exclusion. The
    // owning track makes those src changes; this harness case then enforces.
    expect.unreachable('blocked-future: no model-version substrate exists');
  });
});

// ── 3. honest distinct states: no success claims, no forbidden phrases ─────

describe('honest distinct states carry no success claims and no forbidden phrases', () => {
  const TWO_RUNS_CHANGED = [
    runFact(envelope([{ id: 'b', label: 'Onshore', win: 0.55 }, { id: 'a', label: 'Offshore', win: 0.45 }], 'high'), {
      computedAt: '2026-06-07T00:00:00.000Z',
    }),
    runFact(envelope([{ id: 'a', label: 'Offshore', win: 0.62 }, { id: 'b', label: 'Onshore', win: 0.38 }], 'low'), {
      computedAt: '2026-06-06T00:00:00.000Z',
    }),
  ];
  const TWO_RUNS_IDENTICAL = [
    runFact(envelope([{ id: 'a', label: 'Offshore', win: 0.62 }, { id: 'b', label: 'Onshore', win: 0.38 }], 'low'), {
      computedAt: '2026-06-07T00:00:00.000Z',
    }),
    runFact(envelope([{ id: 'a', label: 'Offshore', win: 0.62 }, { id: 'b', label: 'Onshore', win: 0.38 }], 'low'), {
      computedAt: '2026-06-06T00:00:00.000Z',
    }),
  ];

  it('proposal declined safely: V5_STRUCTURAL_DECLINE_TEXT has no success claim and no forbidden phrase', () => {
    expect(findSuccessClaimHit(V5_STRUCTURAL_DECLINE_TEXT)).toBeNull();
    expect(findForbiddenPhraseHit(V5_STRUCTURAL_DECLINE_TEXT)).toBeNull();
  });

  it('stale what-changed: staleness framing + executable rerun chip, no success claim, no freshness claim', () => {
    const r = tryRunComparisonGate({ message: 'what changed?', priorFacts: TWO_RUNS_CHANGED, freshness: 'stale', mayNameLeadingOption: true });
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.mode).toBe('stale');
    // Grounded staleness framing — the model is KNOWN to have changed.
    expect(r.assistant_text).toMatch(/model has changed since the last analysis/i);
    expect(findSuccessClaimHit(r.assistant_text)).toBeNull();
    expect(findForbiddenPhraseHit(r.assistant_text)).toBeNull();
    // The rerun affordance is specific and executable: pinned id, real action.
    expect(r.suggested_actions?.[0]?.id).toBe('chip_action_rerun_analysis');
    expect(r.suggested_actions?.[0]?.action_type).toBe('run_analysis');
    expect(r.suggested_actions?.[0]?.label).toMatch(/^Re-run (the )?analysis/i);
  });

  it('unknown freshness: unconfirmed framing — must NOT claim the model changed, must NOT claim freshness', () => {
    const r = tryRunComparisonGate({ message: 'what changed?', priorFacts: TWO_RUNS_CHANGED, freshness: 'unknown', mayNameLeadingOption: true });
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    expect(r.mode).toBe('unconfirmed');
    expect(r.assistant_text).toMatch(/can['’]t confirm|may be out of date/i);
    expect(r.assistant_text).not.toMatch(/\bmodel has changed\b/i);
    // Must not claim the ANALYSIS is confirmed-current ("current model" /
    // "current result" refer to the model and the post-rerun result — fine).
    expect(r.assistant_text).not.toMatch(/\banalysis is (?:up to date|current|fresh)\b|\bstill up to date\b/i);
    expect(findSuccessClaimHit(r.assistant_text)).toBeNull();
    expect(findForbiddenPhraseHit(r.assistant_text)).toBeNull();
    expect(r.suggested_actions?.[0]?.id).toBe('chip_action_rerun_analysis');
  });

  it('fresh + identical runs: nothing-changed is said honestly and does not trip the egress denial-phrase guard', () => {
    const r = tryRunComparisonGate({ message: 'what changed?', priorFacts: TWO_RUNS_IDENTICAL, freshness: 'fresh', mayNameLeadingOption: true });
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    // Grounded comparison: same leader, unchanged margin — honest wording.
    expect(r.assistant_text).toMatch(/unchanged|still/i);
    expect(findSuccessClaimHit(r.assistant_text)).toBeNull();
    // The delicate pin: honest nothing-changed copy must stay compatible
    // with FORBIDDEN_USER_FACING_PHRASES (which bans the "no changes were
    // made/applied" DENIAL class after real edits). If this fails, the
    // comparison copy and the egress denial list have drifted into
    // conflict — resolve in src, not by weakening this assertion.
    expect(findForbiddenPhraseHit(r.assistant_text)).toBeNull();
  });

  it('freshness gate is fail-closed: no comparison prose is produced on stale/unknown, only rerun guidance', () => {
    for (const freshness of ['stale', 'unknown'] as const) {
      const r = tryRunComparisonGate({ message: 'what changed?', priorFacts: TWO_RUNS_CHANGED, freshness, mayNameLeadingOption: true });
      expect(r.matched).toBe(true);
      if (!r.matched) continue;
      // The changed-leader story in TWO_RUNS_CHANGED must never surface
      // without confirmed freshness.
      expect(r.assistant_text).not.toMatch(/Onshore|Offshore/);
      expect(r.leading_option_changed).toBeNull();
    }
  });
});

// ── rerun affordance after a model-relevant edit ────────────────────────────

describe('rerun is offered clearly after a model-relevant edit', () => {
  it('mutation turn + prior analysis + stale → the pinned after-mutation rerun chip', () => {
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: [setFactorValueFact()],
      priorFacts: [runFact(envelope([{ id: 'a', label: 'Offshore', win: 0.62 }]))],
      analysis: null,
      analysisReady: READY,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
      turnOutcome: turnOutcomeWithFreshness('stale'),
    });
    expect(chips).toHaveLength(1);
    // id byte-exact (contract identifier); label as an anchored pattern
    // (copy-edit tolerant).
    expect(chips[0]!.id).toBe('chip_action_rerun_analysis_after_mutation');
    expect(chips[0]!.action_type).toBe('run_analysis');
    expect(chips[0]!.label).toMatch(/^Run (the )?analysis again/i);
  });
});

// ── 4. stale is stale, never absent ─────────────────────────────────────────

describe('freshness truth: stale ≠ absent (deriveAnalysisFreshness)', () => {
  it('a successful run fact + a moved graph hash → "stale", never "none"', () => {
    const d = deriveAnalysisFreshness(
      [runFact(envelope([{ id: 'a', label: 'Offshore', win: 0.62 }]), { hash: 'a1b2c3d4e5f6a1b2' })],
      'c3d4e5f6a1b2c3d4',
    );
    expect(d.freshness).toBe('stale');
    expect(d.reason).toBe('graph_hash_diverged');
  });

  it('a legacy fact with no run-time hash → "unknown" (currency unconfirmable), never "none"', () => {
    const d = deriveAnalysisFreshness(
      [runFact(envelope([{ id: 'a', label: 'Offshore', win: 0.62 }]), { hash: null })],
      'c3d4e5f6a1b2c3d4',
    );
    expect(d.freshness).toBe('unknown');
  });
});
