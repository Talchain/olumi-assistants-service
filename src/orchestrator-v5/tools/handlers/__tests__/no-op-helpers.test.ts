/**
 * Unit tests for the shared no-op handler helpers.
 *
 * `resolveOptionCount` and `buildAnalysisAbsentTemplate` are imported by
 * all three V5 no-op explanation handlers (explain_from_structure,
 * explain_results, what_would_flip). Tests live here so the contract is
 * tested once rather than three times.
 */

import { describe, it, expect } from 'vitest';

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import type { HandlerInvocation } from '../../registry.js';
import {
  buildAnalysisAbsentTemplate,
  buildAnalysisDegradedTemplate,
  buildAnalysisStaleTemplate,
  buildAnalysisUnconfirmedTemplate,
  buildPreconditionAssistantText,
  decideExplanationPrecondition,
  resolveOptionCount,
} from '../no-op-helpers.js';
import { findForbiddenPhraseHit } from '../../../compose/forbidden-user-facing-phrases.js';

function makeInvocation(overrides: {
  optionIds?: readonly string[];
  analysisReady?: HandlerInvocation['analysisReady'];
}): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: {
        option_ids: overrides.optionIds ?? [],
        goal_id: 'g',
      },
      capabilities: {},
      messages: [],
      session_id: 's',
      request_id: 'r',
      budgets: { turn_ms: 1000, llm_narrate_ms: 500 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't',
      scenario_id: 's',
      message: 'm',
      turn_class: 'decide',
      stage: 'analyse',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'r',
    signal: new AbortController().signal,
    orientationText: '',
    analysisReady: overrides.analysisReady,
  };
}

function makeAnalysisReady(
  optionCount: number,
  status: string,
): HandlerInvocation['analysisReady'] {
  return {
    options: Array.from({ length: optionCount }, (_, i) => ({
      option_id: `opt_${i + 1}`,
      label: `Option ${i + 1}`,
      status,
      interventions: { f: 1 },
    })),
    goal_node_id: 'g',
    status,
  };
}

describe('resolveOptionCount', () => {
  it('returns analysisReady.options.length when analysisReady is present', () => {
    const inv = makeInvocation({
      analysisReady: makeAnalysisReady(3, 'ready'),
      optionIds: [], // entity_registry stub deliberately empty
    });
    expect(resolveOptionCount(inv)).toBe(3);
  });

  it('preserves analysisReady count even when entity_registry stub is non-empty (analysisReady wins)', () => {
    const inv = makeInvocation({
      analysisReady: makeAnalysisReady(2, 'ready'),
      optionIds: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(resolveOptionCount(inv)).toBe(2);
  });

  it('falls back to entity_registry.option_ids.length when analysisReady is undefined', () => {
    const inv = makeInvocation({
      analysisReady: undefined,
      optionIds: ['opt_1', 'opt_2', 'opt_3'],
    });
    expect(resolveOptionCount(inv)).toBe(3);
  });

  it('returns 0 when both sources are empty', () => {
    const inv = makeInvocation({ analysisReady: undefined, optionIds: [] });
    expect(resolveOptionCount(inv)).toBe(0);
  });
});

describe('buildAnalysisAbsentTemplate', () => {
  it('uses singular "option" wording when option_count === 1', () => {
    const text = buildAnalysisAbsentTemplate(1, 'ready');
    // Source wording is "X option set up" — the prior "configured"
    // assertion was test/source drift from an earlier wording revision.
    expect(text).toContain('1 option set up');
    expect(text).not.toContain('1 options');
  });

  it('uses plural "options" wording when option_count !== 1', () => {
    expect(buildAnalysisAbsentTemplate(0, 'ready')).toContain('0 options set up');
    expect(buildAnalysisAbsentTemplate(2, 'ready')).toContain('2 options set up');
    expect(buildAnalysisAbsentTemplate(7, 'ready')).toContain('7 options set up');
  });

  it('uses "ready to analyse" copy when readinessStatus === "ready"', () => {
    const text = buildAnalysisAbsentTemplate(2, 'ready');
    expect(text).toContain('ready to analyse');
    expect(text).toContain('Would you like me to run the analysis?');
  });

  // ROADMAP 2.308 / S3 — these three used to assert the tail
  // "still need to be set up", which the head clause "N options set up "
  // contradicted in the same sentence. They now assert the per-status copy
  // that replaced it. The contradiction itself is pinned as a property in
  // `analysis-absent-template-contradiction.test.ts`.
  it('says what needs_user_input actually means — too few options to compare', () => {
    const text = buildAnalysisAbsentTemplate(2, 'needs_user_input');
    expect(text).toContain('at least two to compare');
    expect(text).not.toContain('ready to analyse');
    expect(text).not.toContain('still need to be set up');
  });

  it('says the options have no effect values when readinessStatus === "needs_user_mapping"', () => {
    const text = buildAnalysisAbsentTemplate(2, 'needs_user_mapping');
    expect(text).toContain('no effect values yet');
    expect(text).not.toContain('still need to be set up');
  });

  it('says the options have no effect values when readinessStatus === "needs_encoding"', () => {
    const text = buildAnalysisAbsentTemplate(2, 'needs_encoding');
    expect(text).toContain('no effect values yet');
    expect(text).not.toContain('still need to be set up');
  });

  it('falls back to "ready to analyse" wording when readinessStatus is undefined', () => {
    // Undefined readiness implies the chip generator's own readiness gate
    // will suppress the executable run-analysis chip, so the user is not
    // misled into clicking a chip that won't fire. Keeping the neutral
    // wording here preserves the existing UX.
    const text = buildAnalysisAbsentTemplate(2, undefined);
    expect(text).toContain('ready to analyse');
  });

  it('falls back to "ready to analyse" wording for unknown readiness literals', () => {
    const text = buildAnalysisAbsentTemplate(2, 'some_future_status');
    expect(text).toContain('ready to analyse');
  });
});

// ---------------------------------------------------------------------------
// P0 V5 golden-path repair (follow-up): shared explanation-precondition
// helper. The same predicate is consumed by explain_results and
// what_would_flip; this test pins it so future predicate changes apply
// to both handlers in lockstep without re-introducing the drift the
// original Wave 1 work fixed.
// ---------------------------------------------------------------------------

function makeRunAnalysisFactWithStatus(status: string | null): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (status !== null) enrichment.analysis_status = status;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: '00000000-0000-4000-8000-000000000001',
      leading_option_id: 'opt_1',
      summary: 'prior',
      enrichment,
    },
  };
}

function makePreconditionInvocation(
  overrides: {
    priorFacts?: readonly HandlerFact[];
    analysisProjection?: unknown;
    freshness?: 'fresh' | 'stale' | 'unknown' | 'none';
  },
) {
  return {
    context: { prior_facts: overrides.priorFacts ?? [] },
    analysisProjection: overrides.analysisProjection,
    analysisFreshness: overrides.freshness
      ? { freshness: overrides.freshness }
      : undefined,
  };
}

describe('buildAnalysisStaleTemplate (V5 stale-aware explain recovery)', () => {
  it('opens with the brief\'s exact required wording', () => {
    // The V5 stale-aware explain recovery brief mandates this exact
    // opening sentence on stale-explain turns. Pinned verbatim so
    // future copy-polish cannot drift the runtime out of brief
    // compliance without flipping this test. Coordinate the replay
    // harness assertion with this constant.
    const text = buildAnalysisStaleTemplate();
    expect(text).toMatch(
      /^These results may be out of date because the model has changed since the last analysis\./,
    );
  });

  it('contains no FORBIDDEN_USER_FACING_PHRASES entry', () => {
    expect(findForbiddenPhraseHit(buildAnalysisStaleTemplate())).toBeNull();
  });

  it('offers a re-run recovery affordance so the user has a path forward', () => {
    expect(buildAnalysisStaleTemplate()).toMatch(/re-run analysis/i);
  });

  it('contains no prescription-shaped nouns (recommendation, winner, etc.)', () => {
    // Pins the post-audit copy fix: the foamy-bee UI handoff brief bans
    // `recommended` / `winner` / `winning` from user-facing copy and the
    // noun form `recommendation` is treated in scope by the same rule.
    const text = buildAnalysisStaleTemplate();
    expect(text).not.toMatch(/\brecommendation\b/i);
    expect(text).not.toMatch(/\brecommended\b/i);
    expect(text).not.toMatch(/\bwinner\b/i);
    expect(text).not.toMatch(/\bwinning\b/i);
  });
});

describe('buildAnalysisDegradedTemplate', () => {
  it('contains no FORBIDDEN_USER_FACING_PHRASES entry', () => {
    expect(findForbiddenPhraseHit(buildAnalysisDegradedTemplate())).toBeNull();
  });
});

describe('buildAnalysisUnconfirmedTemplate (Tier 0 unknown→stale)', () => {
  it('contains no FORBIDDEN_USER_FACING_PHRASES entry', () => {
    expect(findForbiddenPhraseHit(buildAnalysisUnconfirmedTemplate())).toBeNull();
  });

  it('uses "the last analysis" — not the forbidden "previous/prior analysis"', () => {
    const text = buildAnalysisUnconfirmedTemplate();
    expect(text).toMatch(/the last analysis/i);
    expect(text).not.toMatch(/\bprevious\s+analysis\b/i);
    expect(text).not.toMatch(/\bprior\s+analysis\b/i);
  });

  it('says it cannot confirm the analysis still matches the current model', () => {
    expect(buildAnalysisUnconfirmedTemplate()).toMatch(
      /can'?t confirm it still matches the current model/i,
    );
  });

  it('does NOT assert the model has changed (distinct from the stale template)', () => {
    // For 'unknown' we lack evidence of a change; claiming one would be a
    // false statement. Only the stale template (known hash divergence) may say
    // "the model has changed".
    expect(buildAnalysisUnconfirmedTemplate()).not.toMatch(/the model has changed/i);
  });

  it('offers a re-run recovery affordance so the user has a path forward', () => {
    expect(buildAnalysisUnconfirmedTemplate()).toMatch(/re-run analysis/i);
  });
});

describe('decideExplanationPrecondition', () => {
  it('no run_analysis fact at all → missing', () => {
    expect(decideExplanationPrecondition(makePreconditionInvocation({}))).toBe('missing');
  });

  it('only a degraded fact (status=partial) → degraded', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({ priorFacts: [makeRunAnalysisFactWithStatus('partial')] }),
      ),
    ).toBe('degraded');
  });

  // Invariant: 'missing' ⟺ no successful fact. A successful fact with no
  // buildable projection (and no freshness derivation threaded) must NOT be
  // denied as "no analysis"; it degrades honestly instead. (Previously this
  // returned 'missing' → "No analysis has been run", which violated the Tier
  // 0 rule that Olumi must not deny analysis that has run.)
  it('successful fact + null projection (no freshness derivation) → degraded, never missing', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: undefined,
        }),
      ),
    ).toBe('degraded');
  });

  it('successful fact + projection + freshness=stale → stale', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: { status: 'complete' },
          freshness: 'stale',
        }),
      ),
    ).toBe('stale');
  });

  // THE BUG-FIX PROOF: a stale fact whose projection failed to build must be
  // labelled stale (currency judged BEFORE the projection guard), NOT denied
  // as "no analysis". This is the live-path defect this lane fixes.
  it('successful fact + NULL projection + freshness=stale → stale (never "no analysis")', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: undefined,
          freshness: 'stale',
        }),
      ),
    ).toBe('stale');
  });

  it('successful fact + projection + freshness=fresh → execute', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: { status: 'complete' },
          freshness: 'fresh',
        }),
      ),
    ).toBe('execute');
  });

  // The 'fresh' switch arm: a current fact with no buildable projection
  // degrades honestly (never 'missing'), completing branch coverage of the
  // exhaustive currency switch.
  it('successful fact + NULL projection + freshness=fresh → degraded', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: undefined,
          freshness: 'fresh',
        }),
      ),
    ).toBe('degraded');
  });

  // Tier 0 doctrine: 'unknown' (legacy fact missing its run-time hash, or the
  // current graph hash unavailable this turn) is treated as stale for user-
  // facing freshness — it must NOT execute as if fresh. Distinct 'unconfirmed'
  // verdict so the copy can say "can't confirm" rather than "model changed".
  it('legacy/unknown fact + projection + freshness=unknown → unconfirmed (not execute)', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus(null)],
          analysisProjection: { status: 'complete' },
          freshness: 'unknown',
        }),
      ),
    ).toBe('unconfirmed');
  });

  it('successful fact + NULL projection + freshness=unknown → unconfirmed (currency before projection)', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: undefined,
          freshness: 'unknown',
        }),
      ),
    ).toBe('unconfirmed');
  });

  // Single source of truth: when the canonical derivation reports freshness
  // 'none' (no successful fact selected), the verdict is missing/degraded even
  // though a raw prior fact is present — the precondition trusts the verdict,
  // not an independent prior_facts scan.
  it('freshness=none drives missing even when a (degraded) prior fact is present', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('partial')],
          analysisProjection: { status: 'complete' },
          freshness: 'none',
        }),
      ),
    ).toBe('degraded');
  });

  // Graceful fallback: when no freshness derivation is threaded (chip-click
  // fixtures / legacy callers), the local prior_facts scan + projection guard
  // still produce a sensible verdict.
  it('no freshness derivation + successful fact + projection → execute (fallback)', () => {
    expect(
      decideExplanationPrecondition(
        makePreconditionInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: { status: 'complete' },
        }),
      ),
    ).toBe('execute');
  });
});

describe('buildPreconditionAssistantText', () => {
  it('missing → absent template', () => {
    expect(buildPreconditionAssistantText('missing', 2, 'ready')).toMatch(
      /No analysis has been run/,
    );
  });

  it('stale → stale template', () => {
    expect(buildPreconditionAssistantText('stale', 2, 'ready')).toMatch(
      /model has changed since the last analysis/,
    );
  });

  it('unconfirmed → unconfirmed template', () => {
    expect(buildPreconditionAssistantText('unconfirmed', 2, 'ready')).toMatch(
      /can'?t confirm it still matches the current model/i,
    );
  });

  it('degraded → degraded template', () => {
    expect(buildPreconditionAssistantText('degraded', 2, 'ready')).toMatch(
      /didn't produce a usable result/,
    );
  });
});
