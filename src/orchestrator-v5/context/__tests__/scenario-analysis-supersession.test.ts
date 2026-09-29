/**
 * G3 — the ONE-WAY scenario-over-window precedence, at the pure layer.
 *
 * WHAT THIS FILE IS FOR, and what it deliberately is not. The wire behaviour it
 * enables is pinned separately (`g3-scenario-freshness-wire.test.ts`) and the
 * producer's two-authority separation is pinned at the executor
 * (`turn-executor-scenario-freshness-authority.test.ts`). This file pins the
 * RULE: which verdicts may be corrected, by what, and under which precondition.
 *
 * ⭐ EVERY DERIVATION HERE COMES OUT OF `deriveAnalysisFreshness` OVER REAL
 * FACTS, never out of a hand-written `FreshnessDerivation` literal. A literal
 * would encode this author's model of the producer rather than the producer
 * (CLAUDE.md trap 16's load-bearing clause: *a fixture you wrote yourself is not
 * evidence about the wire*), and the verdicts this rule keys on — `none` vs
 * `fresh` vs `stale` — are exactly what a literal would beg the question about.
 * The two graph hashes are computed, not spelled.
 *
 * BINDING BY IDENTITY (trap 19). Where a supersession is expected, the
 * assertion names the object: the returned derivation must be the SAME OBJECT
 * as the scenario derivation passed in (`toBe`), never merely a derivation with
 * a matching verdict — a value predicate the window derivation could also
 * satisfy in some other test.
 */

import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { deriveAnalysisFreshness } from '../freshness.js';
import { clampRefusalFreshness } from '../../compose/analysis-ready-emit.js';
import { resolveScenarioAnalysisSupersession } from '../scenario-analysis-supersession.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The hash the saved analysis was computed against. */
const ANALYSED_HASH = 'hash_analysed_0001';
/** The graph as it stands on the turn under test — same for both derivations. */
const CURRENT_HASH = 'hash_current_0002';

function runAnalysisFact(graphHashAtRun: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Saved analysis',
      graph_hash_at_run: graphHashAtRun,
      computed_at: '2026-09-01T09:00:00.000Z',
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
    },
  } as unknown as HandlerFact;
}

/** The hot window on a turn where the saved analysis has rolled out of it. */
const WINDOW_WITHOUT_FACT: readonly HandlerFact[] = [];
/** The durable scenario history, which still holds it. */
const DURABLE_WITH_FACT: readonly HandlerFact[] = [runAnalysisFact(ANALYSED_HASH)];

function windowNone(currentHash: string | null = CURRENT_HASH) {
  return deriveAnalysisFreshness(WINDOW_WITHOUT_FACT, currentHash, undefined, {
    priorFactsReadOk: true,
  });
}

function scenarioStale(currentHash: string | null = CURRENT_HASH) {
  return deriveAnalysisFreshness(DURABLE_WITH_FACT, currentHash, undefined, {
    priorFactsReadOk: true,
  });
}

describe('G3 — resolveScenarioAnalysisSupersession: preconditions hold', () => {
  it('the fixtures produce the verdicts this whole file keys on', () => {
    // Trap 13b — a discriminator must pin its own precondition. If either of
    // these stopped being true, every "declines"/"supersedes" case below would
    // pass for the wrong reason and nothing else would notice.
    expect(windowNone().freshness).toBe('none');
    expect(windowNone().reason).toBe('no_successful_run_analysis_fact');
    expect(scenarioStale().freshness).toBe('stale');
    expect(scenarioStale().graph_hash_at_run).toBe(ANALYSED_HASH);
    expect(ANALYSED_HASH).not.toBe(CURRENT_HASH);
  });

  it('a REFUSAL turn can never present `none`, which is why there is no refusal conjunct', () => {
    // This pins the derived premise the implementation relies on instead of
    // restating it: `clampRefusalFreshness` is the sole writer of
    // `refusal_declared`, and it rewrites a `none` verdict to `unknown`. A
    // refusal turn therefore fails the `none` conjunct and never reaches the
    // precedence at all — so substituting the derivation handed to
    // `composeAnalysisStateV1` cannot erase a `run_state.kind: 'refused'`.
    //
    // If the clamp is ever changed to PRESERVE `none`, this REDs, and the
    // precedence needs an explicit refusal conjunct before it ships again.
    const clamped = clampRefusalFreshness(windowNone());
    expect(clamped.refusal_declared).toBe(true);
    expect(clamped.freshness).not.toBe('none');
    expect(clamped.freshness).toBe('unknown');
  });
});

describe('G3 — resolveScenarioAnalysisSupersession: the one case it fires', () => {
  it('supersedes a hot-window `none` with the durable verdict, returning THAT derivation', () => {
    const scenario = scenarioStale();
    const out = resolveScenarioAnalysisSupersession({
      windowFreshness: windowNone(),
      scenarioFreshness: scenario,
    });

    expect(out).toBeDefined();
    // Identity, not a value predicate: the returned derivation IS the durable
    // one, so nothing has been rebuilt, narrowed or re-enforced on its way out.
    expect(out!.freshness).toBe(scenario);
    // …and the canonical projection describes the same verdict, because
    // `analysis_state` branches on the canonical state and not the derivation.
    expect(out!.canonicalState.freshness).toBe('stale');
    expect(out!.canonicalState.graph_hash_at_run).toBe(ANALYSED_HASH);
  });

  it('threads readiness into the canonical projection, same as the caller\'s own call', () => {
    const out = resolveScenarioAnalysisSupersession({
      windowFreshness: windowNone(),
      scenarioFreshness: scenarioStale(),
      readiness: { status: 'ready', blockers: [] },
    });
    expect(out?.canonicalState.status).toBe('ready');
  });
});

describe('G3 — resolveScenarioAnalysisSupersession: the one-way rule', () => {
  // The whole safety argument is that this list is exhaustive in the
  // supersede-able direction. Each row names the harm it prevents.
  it.each([
    ['fresh', 'a window `fresh` is a claim about THIS turn\'s graph and is never corrected'],
    ['stale', 'a window `stale` is likewise a supported claim'],
    ['unknown', 'a window `unknown` already says "could not tell"; the durable set cannot improve it'],
  ] as const)('declines when the window verdict is `%s` (%s)', (verdict: 'fresh' | 'stale' | 'unknown', _why: string) => {
    // Build each window verdict through the producer, not by hand.
    const window =
      verdict === 'fresh'
        ? deriveAnalysisFreshness(DURABLE_WITH_FACT, ANALYSED_HASH, undefined, {
            priorFactsReadOk: true,
          })
        : verdict === 'stale'
          ? deriveAnalysisFreshness(DURABLE_WITH_FACT, CURRENT_HASH, undefined, {
              priorFactsReadOk: true,
            })
          : deriveAnalysisFreshness(DURABLE_WITH_FACT, null, undefined, {
              priorFactsReadOk: true,
            });
    expect(window.freshness).toBe(verdict);

    expect(
      resolveScenarioAnalysisSupersession({
        windowFreshness: window,
        scenarioFreshness: scenarioStale(window.current_graph_hash),
      }),
    ).toBeUndefined();
  });

  it('never supersedes WITH `none` — the durable set may only ever find a fact, never lose one', () => {
    const durableEmpty = deriveAnalysisFreshness([], CURRENT_HASH, undefined, {
      priorFactsReadOk: true,
    });
    expect(durableEmpty.freshness).toBe('none');
    expect(
      resolveScenarioAnalysisSupersession({
        windowFreshness: windowNone(),
        scenarioFreshness: durableEmpty,
      }),
    ).toBeUndefined();
  });

  it('declines when no scenario derivation was supplied — absence IS the authority gate', () => {
    // The producer populates the field only behind
    // `isScenarioAnalysisReasoningAuthority`. A `degraded` carrier therefore
    // arrives as `undefined` here rather than as a
    // `unknown`/`derivation_failed` non-verdict.
    expect(
      resolveScenarioAnalysisSupersession({
        windowFreshness: windowNone(),
        scenarioFreshness: undefined,
      }),
    ).toBeUndefined();
  });

  it('declines when there is no window verdict to correct', () => {
    expect(
      resolveScenarioAnalysisSupersession({
        windowFreshness: undefined,
        scenarioFreshness: scenarioStale(),
      }),
    ).toBeUndefined();
  });
});

describe('G3 — resolveScenarioAnalysisSupersession: the same-current-graph conjunct', () => {
  /**
   * ⚠ THIS IS THE CONJUNCT THE DESIGN BRIEF DID NOT HAVE, and the case below is
   * the reachable harm it prevents.
   *
   * The wire-bound verdict is RE-DERIVED POST-DISPATCH against the post-edit
   * graph hash on a turn that committed a mutation; the scenario derivation is
   * taken at ORIENT and still holds the pre-dispatch hash. So on an edit turn
   * whose window has lost its fact, the durable verdict can read `fresh`
   * against the PRE-edit graph while the truth about the POST-edit graph is
   * `stale`. Adopting it would ship `analysis_ready.freshness: 'fresh'` over
   * edits CEE has never analysed — the measured harm at
   * `compose/analysis-ready-emit.ts` ("clears the local-edits dirty overlay").
   */
  it('declines a durable `fresh` that was computed against a DIFFERENT current graph', () => {
    // Durable derivation taken pre-edit: the saved fact's hash matches, so it
    // reads `fresh`.
    const durableFreshPreEdit = deriveAnalysisFreshness(
      DURABLE_WITH_FACT,
      ANALYSED_HASH,
      undefined,
      { priorFactsReadOk: true },
    );
    expect(durableFreshPreEdit.freshness).toBe('fresh');
    // Wire verdict re-derived post-edit over a window that has lost the fact.
    const windowPostEdit = windowNone(CURRENT_HASH);
    expect(windowPostEdit.freshness).toBe('none');
    // Precondition of THIS case specifically: the two hashes genuinely differ.
    expect(durableFreshPreEdit.current_graph_hash).not.toBe(
      windowPostEdit.current_graph_hash,
    );

    expect(
      resolveScenarioAnalysisSupersession({
        windowFreshness: windowPostEdit,
        scenarioFreshness: durableFreshPreEdit,
      }),
    ).toBeUndefined();
  });

  it('DISCRIMINATING TWIN: the same durable verdict DOES supersede once the hashes agree', () => {
    // The pair is what proves the conjunct discriminates rather than just
    // blocks. Identical inputs but for the hash the durable derivation was
    // taken against; only this arm supersedes.
    const durableFresh = deriveAnalysisFreshness(
      DURABLE_WITH_FACT,
      ANALYSED_HASH,
      undefined,
      { priorFactsReadOk: true },
    );
    const windowSameGraph = windowNone(ANALYSED_HASH);
    expect(windowSameGraph.freshness).toBe('none');
    expect(durableFresh.current_graph_hash).toBe(windowSameGraph.current_graph_hash);

    const out = resolveScenarioAnalysisSupersession({
      windowFreshness: windowSameGraph,
      scenarioFreshness: durableFresh,
    });
    expect(out?.freshness).toBe(durableFresh);
  });

  it('a null current hash on one side only also declines', () => {
    const durableUnknown = deriveAnalysisFreshness(DURABLE_WITH_FACT, null, undefined, {
      priorFactsReadOk: true,
    });
    expect(durableUnknown.current_graph_hash).toBeNull();
    expect(
      resolveScenarioAnalysisSupersession({
        windowFreshness: windowNone(CURRENT_HASH),
        scenarioFreshness: durableUnknown,
      }),
    ).toBeUndefined();
  });
});

/**
 * ⚠⚠ CONJUNCT 4 IS VACUOUS WHEN BOTH HASHES ARE `null`, AND ITS SAFETY IS AN
 * INVARIANT IN A DIFFERENT MODULE. Pinned here so a change over there REDs here.
 *
 * The conjunct is `scenarioFreshness.current_graph_hash !== windowFreshness.current_graph_hash`.
 * `FreshnessDerivation.current_graph_hash` is `string | null`, and `null !== null`
 * is `false` — so with no graph on either side the conjunct PASSES. It proves
 * agreement, not that a graph was compared, and its STATED meaning ("computed
 * against the SAME current graph") is not what it enforces in that state.
 *
 * It is harmless today, and the reason is not in this file: `deriveAnalysisFreshness`
 * cannot reach `fresh` when the current hash is null, because **TWO** guards
 * above the `===` comparison short-circuit first (`freshness.ts`: the fact's own
 * `graph_hash_at_run === null` branch, and the `currentGraphHash === null`
 * branch). So the worst the both-null path can do is adopt an `unknown` or
 * `stale` verdict, both of which are at least as honest as the `never_run` they
 * replace.
 *
 * ⚠ THE COUNT IS TWO, NOT ONE, AND IT WAS MEASURED. Removing EITHER guard alone
 * leaves the other protecting — both single-guard mutants were run and the pin
 * below correctly stayed GREEN, because neither reaches `fresh`. Only the
 * compound mutant (both dropped) reaches `null === null` and REDs it. An earlier
 * write-up of this vacuity named one guard; the safety is a CONJUNCTION, and a
 * pin demonstrated against the wrong mutant would have looked discriminating
 * while proving nothing (trap 13c: a mutant kit validates sensitivity, never
 * correctness).
 *
 * ⚠ THAT IS A GUARD WHOSE SAFETY RESTS ON SOMEONE ELSE'S INVARIANT, which is
 * CLAUDE.md trap 12b's decay pattern: the day a null-hash derivation is allowed
 * to reach `fresh`, this conjunct silently stops protecting anything and ships
 * `analysis_ready.freshness: 'fresh'` about a graph it cannot identify. The
 * cases below make that day RED instead of silent — and they assert the SPEC
 * ("never adopt `fresh` about a graph we cannot name"), not the failure mode in
 * hand (trap 13d).
 */
describe('G3 — conjunct 4 with NO graph on either side (the pinned vacuity)', () => {
  /** A saved analysis whose own hash is missing too — the legacy-fact shape. */
  const DURABLE_HASHLESS_FACT: readonly HandlerFact[] = [
    (() => {
      const fact = runAnalysisFact(ANALYSED_HASH) as unknown as {
        result: Record<string, unknown>;
      };
      return {
        ...(fact as unknown as Record<string, unknown>),
        result: { ...fact.result, graph_hash_at_run: null },
      } as unknown as HandlerFact;
    })(),
  ];

  it('DOCUMENTS THE VACUITY: both hashes null passes conjunct 4 and the supersession FIRES', () => {
    // Not an endorsement — a record of what the code does, so the next reader
    // is not surprised by it and the contrast below has something to contrast.
    const windowNoGraph = windowNone(null);
    const durableNoGraph = deriveAnalysisFreshness(DURABLE_HASHLESS_FACT, null, undefined, {
      priorFactsReadOk: true,
    });
    expect(windowNoGraph.current_graph_hash).toBeNull();
    expect(durableNoGraph.current_graph_hash).toBeNull();

    const out = resolveScenarioAnalysisSupersession({
      windowFreshness: windowNoGraph,
      scenarioFreshness: durableNoGraph,
    });
    expect(out?.freshness).toBe(durableNoGraph);
  });

  it('⭐ THE PIN: a verdict adopted with NO current graph can never claim `fresh`', () => {
    // This is the assertion that carries the safety, and it is deliberately
    // stated over the whole class rather than over one fixture: every fact
    // shape this estate admits, derived against a null current hash, must
    // produce a verdict the supersession may adopt without lying. The moment
    // `deriveAnalysisFreshness` lets any of them reach `fresh`, this REDs.
    const factShapes: ReadonlyArray<readonly [string, readonly HandlerFact[]]> = [
      ['durable fact WITH a run hash', DURABLE_WITH_FACT],
      ['durable fact WITHOUT a run hash', DURABLE_HASHLESS_FACT],
    ];
    for (const [label, facts] of factShapes) {
      const derived = deriveAnalysisFreshness(facts, null, undefined, {
        priorFactsReadOk: true,
      });
      expect(derived.current_graph_hash, label).toBeNull();
      expect(
        derived.freshness,
        `${label}: a null current graph hash must never derive \`fresh\` — conjunct 4 cannot catch it`,
      ).not.toBe('fresh');

      // …and therefore neither can anything the seam adopts from it.
      const out = resolveScenarioAnalysisSupersession({
        windowFreshness: windowNone(null),
        scenarioFreshness: derived,
      });
      expect(
        out?.freshness.freshness,
        `${label}: the supersession must not put \`fresh\` on the wire about an unidentifiable graph`,
      ).not.toBe('fresh');
    }
  });
});
