/**
 * ACCEPTANCE — an analysis nobody asked for makes no quantified leader or
 * robustness claim, and an analysis the user asked for is untouched.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CORPUS IS A LIVE CAPTURE, NOT A FIXTURE THE AUTHOR WROTE
 *
 * `fixtures/analysis-result-live-2026-09-03.json` is the VERBATIM
 * `analysis_result` block from a real staging run
 * (`Talchain/olumi-programme-docs`,
 * `artefacts/leg5-postrun-2026-09-03/B1-run-1/`). It is a historic record:
 * append-only, never edited (parent CLAUDE.md trap 14b).
 *
 * That matters because a self-authored fixture encodes the author's model of
 * the producer rather than the producer (trap 16-inverse). It is precisely what
 * caught the second carrier: the same win probability ships in BOTH
 * `enrichment.option_comparison[]` AND `enrichment.decision_brief.options[]`,
 * and a hand-built fixture would have had one of them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DISCRIMINATING PAIR (parent CLAUDE.md trap 19)
 *
 * Both arms are built from the SAME captured result. They differ in exactly one
 * field — `enrichment.run_provenance`, the stamp
 * `handlers/chip-click-dispatch.ts` writes on the post-draft auto-run. So a
 * green REQUESTED arm and a green UNREQUESTED arm together prove the projection
 * binds to run PROVENANCE and not to something else in the payload.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY ABSENCE ASSERTION HAS A POSITIVE CONTROL
 *
 * Each "the confined block does not carry X" is preceded by "the CAPTURE
 * carries X", asserted against the same reader. An absence probe that cannot
 * see a presence proves nothing (trap 13), and this file's readers are walkers
 * over an untyped record — exactly the kind that silently stops matching.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { buildAnalysisResultBlock } from '../../compose.js';
import {
  UNREQUESTED_ANALYSIS_SUMMARY,
  UNREQUESTED_OPTION_ROW_DROPPED_MEMBERS,
  UNREQUESTED_ROBUSTNESS_KEPT_MEMBERS,
  confineUnrequestedAnalysisBlock,
  keyStatesComparativeStanding,
  keyStatesRobustnessVerdict,
  mayPresentLeaderClaimForFact,
  wasAnalysisRequestedByUser,
} from '../unrequested-analysis-confinement.js';
import { buildAutoRunProvenance } from '../../context/run-initiator.js';
import { textNamesLeadingOption } from '../leading-option-egress-guard.js';

/**
 * Read from disk, not via a JSON import attribute: the root tsconfig's `module`
 * setting rejects `with { type: 'json' }` (TS2823), and `pnpm typecheck` cannot
 * see it because `tsconfig.build.json` excludes tests. The separate CI check
 * `Typecheck Drift (ratchet)` is the one that catches it — which is the whole
 * reason a green local typecheck is necessary and not sufficient here.
 */
const capture = JSON.parse(
  readFileSync(
    new URL('./fixtures/analysis-result-live-2026-09-03.json', import.meta.url),
    'utf-8',
  ),
) as {
  readonly summary: string;
  readonly leading_option_id: string;
  readonly win_probabilities: Record<string, number>;
  readonly enrichment: Record<string, unknown>;
};

const GRAPH_HASH = 'gh_live_20260903_b1run1';

/**
 * The captured run, as a persisted fact.
 *
 * `constraint_verdict` is stamped PERMITTED on both arms deliberately: the
 * captured run really did name a leader, and a withheld verdict would let the
 * existing projection do the work and hide whether this module does any. The
 * unrequested arm must therefore reach its result through run provenance alone.
 */
function makeCapturedFact(opts: { readonly autoInitiated: boolean }): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {
    ...(capture.enrichment as Record<string, unknown>),
    ...(opts.autoInitiated
      ? { run_provenance: buildAutoRunProvenance('11111111-1111-4111-8111-111111111111') }
      : {}),
  };
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      leading_option_id: capture.leading_option_id,
      summary: capture.summary,
      win_probabilities: capture.win_probabilities,
      graph_hash_at_run: GRAPH_HASH,
      computed_at: '2026-09-03T00:00:00.000Z',
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

/** Every dotted path in `value` whose LEAF is a finite number. */
function numericPaths(value: unknown, path = ''): string[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => numericPaths(entry, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, member]) =>
      numericPaths(member, path === '' ? key : `${path}.${key}`),
    );
  }
  return [];
}

/**
 * Every dotted path in `value` whose KEY satisfies `matches` AND whose value is
 * a SCALAR.
 *
 * ⚠ Scalar-only, and that is not a convenience. A claim is a value —
 * `"fragile"`, `0.5058` — so a CONTAINER whose name matches (the
 * `enrichment.robustness` blob itself) is not a claim and must not be counted;
 * counting it would make the after-assertion unsatisfiable unless the whole
 * blob were deleted, which is precisely the over-suppression this module
 * refuses.
 */
function pathsWhereKey(value: unknown, matches: (key: string) => boolean, path = ''): string[] {
  const hits: string[] = [];
  const isScalar = (node: unknown): boolean =>
    node === null || (typeof node !== 'object' && typeof node !== 'function');
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${at}[${index}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, member] of Object.entries(node as Record<string, unknown>)) {
      const next = at === '' ? key : `${at}.${key}`;
      if (matches(key) && isScalar(member)) hits.push(next);
      walk(member, next);
    }
  };
  walk(value, path);
  return hits;
}

const comparativeStandingPaths = (value: unknown): string[] =>
  pathsWhereKey(value, keyStatesComparativeStanding);
const robustnessVerdictPaths = (value: unknown): string[] =>
  pathsWhereKey(value, keyStatesRobustnessVerdict);

/** Collapse array indices so a path names a SHAPE, not one row. */
function shapes(paths: readonly string[]): string[] {
  return [...new Set(paths.map((p) => p.replace(/\[\d+\]/g, '[]')))].sort();
}

interface AnalysisResultBlockShape {
  readonly type: string;
  readonly summary: string;
  readonly leading_option_id?: string | null;
  readonly win_probabilities?: Record<string, number>;
  readonly enrichment?: Record<string, unknown>;
}

function build(autoInitiated: boolean): AnalysisResultBlockShape {
  return buildAnalysisResultBlock(
    makeCapturedFact({ autoInitiated }),
  ) as unknown as AnalysisResultBlockShape;
}

describe('the captured corpus really carries the claims (positive controls)', () => {
  it('the live capture names a leading option, quantifies it, and passes a robustness verdict', () => {
    // Without these four, every absence assertion below is vacuous.
    expect(capture.leading_option_id).toEqual(expect.any(String));
    expect(Object.keys(capture.win_probabilities as Record<string, number>).length).toBeGreaterThan(
      0,
    );
    expect(textNamesLeadingOption(capture.summary)).toBe(true);

    const robustness = (capture.enrichment as Record<string, unknown>).robustness as Record<
      string,
      unknown
    >;
    expect(robustness.display_verdict).toEqual(expect.any(String));
    expect(robustness.display_verdict_reason).toEqual(expect.any(String));
    expect(robustness.is_robust).toEqual(expect.any(Boolean));
    expect(robustness.level).toEqual(expect.any(String));
  });

  it('carries the SAME comparative claim in two arrays — the reason a one-array fix would pass', () => {
    const found = shapes(comparativeStandingPaths(capture.enrichment));
    expect(found).toContain('option_comparison[].win_probability');
    expect(found).toContain('decision_brief.options[].win_probability');
  });
});

describe('a run the user asked for is untouched', () => {
  it('is returned BY REFERENCE — the requested path cannot change by one byte', () => {
    const fact = makeCapturedFact({ autoInitiated: false });
    const block = buildAnalysisResultBlock(fact);
    // The confinement is the last step of the builder, so identity here proves
    // it took its early return rather than rebuilding an equal-looking object.
    expect(confineUnrequestedAnalysisBlock(block, fact)).toBe(block);
  });

  it('keeps the leader, the probabilities, the summary and the robustness verdict', () => {
    const block = build(false);
    expect(block.leading_option_id).toBe(capture.leading_option_id);
    expect(block.win_probabilities).toEqual(capture.win_probabilities);
    expect(block.summary).toBe(capture.summary);
    expect(block.summary).not.toBe(UNREQUESTED_ANALYSIS_SUMMARY);
    const robustness = block.enrichment?.robustness as Record<string, unknown>;
    expect(robustness.display_verdict).toBe('fragile');
    expect(robustness.is_robust).toBe(false);
  });

  it('keeps decision_review, which the unrequested arm drops', () => {
    expect(build(false).enrichment?.decision_review).toBeDefined();
  });
});

describe('a run nobody asked for makes no quantified leader or robustness claim', () => {
  it('names no leading option', () => {
    expect(build(true).leading_option_id).toBeNull();
  });

  it('ships no win_probabilities record', () => {
    expect(build(true)).not.toHaveProperty('win_probabilities');
  });

  it('states no comparative standing ANYWHERE in the enrichment it still ships', () => {
    const before = shapes(comparativeStandingPaths(capture.enrichment));
    // Non-vacuity: the walker must be able to see the claims it will later
    // report absent.
    expect(before.length).toBeGreaterThan(0);

    const after = shapes(comparativeStandingPaths(build(true).enrichment));

    // Closed against the ENUMERATION, not against the instances that came to
    // mind. The survivors are named individually below, so a NEW comparative
    // key arriving in the payload REDs here rather than shipping unnoticed.
    expect(after).toEqual([
      // ── DELIBERATE SURVIVORS, each with its reason. This is the whole
      // enumeration the walker can see, so a NEW comparative key arriving in
      // the payload REDs here rather than shipping unnoticed. It is a
      // SAMPLED FLOOR over one live capture, not a claim that the producer
      // can emit nothing else — but it is derived from the payload rather
      // than from what came to mind, which is the property that caught the
      // second win-probability carrier.

      // A bucket probability whose option IDENTITY has already been dropped by
      // `projectTransportEnrichmentForWithheldClaim` (which runs first on this
      // path — note `winner_id` / `winner_label` are absent from this list).
      // Kept by the 2026-07-27 anti-over-suppression ruling: stripped of the
      // name, it measures a split and ranks nobody.
      'conditional_winners[].high_bucket.win_probability',
      'conditional_winners[].low_bucket.win_probability',
      // "THAT the winning option changes across this split", never which one.
      // The withheld projection keeps it deliberately, for the same reason.
      'conditional_winners[].winner_flips',
      // FACTOR-scoped, not option-scoped: these rank factors. They are the
      // "what matters most" science this confinement exists to preserve.
      'factor_sensitivity[].importance_rank',
      'factor_sensitivity[].influence_rank',
      'factor_sensitivity[].rank_flip_rate',
      // The COUNTERFACTUAL winner if this threshold is crossed — same class as
      // `fragile_edges[].alternative_winner_*` below.
      'flip_thresholds[].alternative_winner_id',
      'flip_thresholds[].alternative_winner_label',
      // FACTOR-scoped again: "moving this factor moves the comparison by this
      // much". It names no option and states no standing.
      'p_win_sensitivity[].p_win_delta',
      'p_win_sensitivity[].p_win_delta_percentage_points',
      // The COUNTERFACTUAL winner if this edge flips. `keyDesignatesLeadingOption`
      // is anchored at `^` specifically to spare these (see its docstring);
      // suppressing them here would reverse a ratified ruling by accident.
      'robustness.fragile_edges[].alternative_winner_id',
      'robustness.fragile_edges[].alternative_winner_label',
      'robustness.robust_edges[].alternative_winner_id',
      'robustness.robust_edges[].alternative_winner_label',
    ]);

    // ⭐ AND THE SET MUST SHRINK, NOT MERELY DIFFER. Asserting a survivor set
    // alone would pass if the projection deleted everything; asserting the
    // drop alone would pass if it deleted the payload. Both directions:
    expect(after.length).toBeLessThan(before.length);
    for (const dropped of UNREQUESTED_OPTION_ROW_DROPPED_MEMBERS) {
      // ⚠ THE `conditional_winners` CARVE-OUT IS NOT A FUDGE, AND IT IS SPELT
      // OUT RATHER THAN LEFT AS A BARE PREDICATE. That blob's buckets carry a
      // `win_probability` too, and it is a DELIBERATE survivor: the withheld
      // projection has already removed each bucket's `winner_id` /
      // `winner_label`, and a probability with no name attached measures a
      // split rather than ranking anybody (the 2026-07-27 ruling). It appears
      // by name in the survivor set above, so removing this clause would not
      // hide it — it would make this loop contradict that set.
      const optionScoped = after.filter((path) => !path.startsWith('conditional_winners'));
      expect(optionScoped.some((path) => path.endsWith(`.${dropped}`))).toBe(false);
    }

    // And specifically: the two arrays that carried the same figure are both
    // clean. Named apart from the set assertion so a reader can see WHICH
    // claim this test is about.
    expect(after).not.toContain('option_comparison[].win_probability');
    expect(after).not.toContain('decision_brief.options[].win_probability');
  });

  it('passes no robustness verdict ANYWHERE — the second claim class, and the one I missed', () => {
    /**
     * ⭐ THIS TEST EXISTS BECAUSE THE FIRST ENUMERATION WAS OF ONE CLASS ONLY.
     * The comparative-standing walk found the win probability in two arrays and
     * I stopped. Walking the EMITTED block again for VERDICT keys found the
     * robustness verdict in two more places outside `enrichment.robustness`:
     * `decision_brief.robustness` (a bare "fragile") and
     * `decision_brief.analysis_summary.robustness_band`.
     *
     * "Closed against the enumeration" is only as good as the enumeration's
     * CLASSES. One walk per claim class, each with its own reader.
     */
    const before = robustnessVerdictPaths(capture.enrichment);
    // Non-vacuity first: the walker must SEE the verdicts before it can report
    // them gone. Measured on the capture, not listed from memory.
    expect(shapes(before)).toEqual([
      // The brief's own bare copy — `"fragile"` — outside `enrichment.robustness`
      // entirely. This is the pair the first enumeration could not see.
      'decision_brief.analysis_summary.robustness_band',
      'decision_brief.robustness',
      'robustness.display_verdict',
      'robustness.display_verdict_reason',
      'robustness.is_robust',
    ]);

    expect(robustnessVerdictPaths(build(true).enrichment)).toEqual([]);
  });

  it('passes no robustness verdict — only the fragility science survives', () => {
    const robustness = build(true).enrichment?.robustness as Record<string, unknown>;
    expect(Object.keys(robustness).sort()).toEqual([...UNREQUESTED_ROBUSTNESS_KEPT_MEMBERS].sort());
    for (const verdictMember of [
      'display_verdict',
      'display_verdict_reason',
      'is_robust',
      'level',
      'confidence',
      'confidence_basis',
    ]) {
      expect(robustness).not.toHaveProperty(verdictMember);
    }
  });

  it('substitutes a summary that names nobody and quantifies nothing', () => {
    const block = build(true);
    expect(block.summary).toBe(UNREQUESTED_ANALYSIS_SUMMARY);
    expect(textNamesLeadingOption(block.summary)).toBe(false);
    expect(block.summary).not.toMatch(/\d/);
  });

  it('drops decision_review, whose prose is authored on the premise of a leader', () => {
    expect(build(true).enrichment?.decision_review).toBeUndefined();
  });

  it('still ships the material the founder ruled this run exists to produce', () => {
    // Over-suppression is weighted equally with the leak. A confinement that
    // empties the panel has not contained anything — it has deleted the run.
    const enrichment = build(true).enrichment as Record<string, unknown>;
    const factorSensitivity = enrichment.factor_sensitivity as unknown[];
    expect(factorSensitivity.length).toBe(
      ((capture.enrichment as Record<string, unknown>).factor_sensitivity as unknown[]).length,
    );

    const optionComparison = enrichment.option_comparison as Array<Record<string, unknown>>;
    expect(optionComparison.length).toBe(
      ((capture.enrichment as Record<string, unknown>).option_comparison as unknown[]).length,
    );
    for (const row of optionComparison) {
      expect(row.outcome).toBeDefined();
      expect(row.downside).toBeDefined();
      expect(row.option_label).toEqual(expect.any(String));
    }

    const robustness = enrichment.robustness as Record<string, unknown>;
    expect((robustness.fragile_edges as unknown[]).length).toBeGreaterThan(0);
  });

  it('leaves a numeric surface — the run still measured things', () => {
    // The inverse guard for the assertion above: if this ever collapses to a
    // handful of numbers, the confinement has become suppression.
    expect(numericPaths(build(true).enrichment).length).toBeGreaterThan(20);
  });
});

describe('every surface reads the ONE shared admission (call-site pin)', () => {
  /**
   * ⭐ THE GUARD FOR THE DEFECT THIS CHANGE CREATED AND THEN CLOSED.
   *
   * The first cut took the conjunction inline in `compose.ts`. That left SIX
   * other readers of the constraint-verdict leaf — including
   * `routes/scenario-graph-analysis-read.ts`, the auto-run's OWN delivery path,
   * whose `analysis_state.leader_claim.permitted` is the UI's entitlement grant.
   * The block would have said "no leader" while the state beside it granted
   * permission to name one: same fact, same second, two answers.
   *
   * So the invariant is not "the sites agree" — that is a mirror somebody has to
   * maintain. It is that **the leaf has exactly ONE production call site, inside
   * the shared admission itself.** A new consumer reaching for the leaf fails
   * here, by name, with the reason.
   */
  const PRODUCTION_CALL_SITE = 'src/orchestrator-v5/compose/unrequested-analysis-confinement.ts';

  function productionCallSitesOf(symbol: string): string[] {
    // Repo root: this file sits at src/orchestrator-v5/compose/__tests__/.
    // ⚠ The first version used one `../` too few and scanned `src/src`, which
    // ENOENTed — caught by the positive control below, which is the only reason
    // the verdicts underneath it were not trusted. A path-resolution slip in a
    // scanner is invisible unless something asserts the scanner can SEE.
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
        const source = readFileSync(full, 'utf-8');
        // Strip line comments so a PROSE mention of the symbol is not counted as
        // a call — `compose.ts` carries one, and counting it would make this
        // guard fire on a sentence rather than on a reader.
        const code = source
          .split('\n')
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .join('\n');
        if (code.includes(`${symbol}(`)) {
          hits.push(relative(root, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(join(root, 'src'));
    return hits.sort();
  }

  it('finds the calls it is looking for (positive control)', () => {
    // A scanner that finds nothing agrees with every other scanner that finds
    // nothing. Prove it can see a symbol with many production callers before
    // trusting it about one with few.
    expect(productionCallSitesOf('projectTransportEnrichmentForWithheldClaim').length).toBeGreaterThan(
      0,
    );
    // Contrast control: a symbol that does not exist must read ZERO, so a
    // non-empty result is about the code and not about the walker.
    expect(productionCallSitesOf('thisSymbolDoesNotExistAnywhere')).toEqual([]);
  });

  it('the constraint-verdict LEAF is called from exactly one production file', () => {
    expect(productionCallSitesOf('mayNameLeadingOptionForFact')).toEqual([
      // Its own definition and re-export.
      'src/orchestrator-v5/compose/withheld-claim-projection.ts',
      // The shared admission — the ONLY consumer.
      PRODUCTION_CALL_SITE,
    ].sort());
  });

  it('the surfaces that decide what to SHOW about a leader read the admission', () => {
    expect(productionCallSitesOf('mayPresentLeaderClaimForFact')).toEqual(
      [
        PRODUCTION_CALL_SITE,
        'src/orchestrator-v5/compose.ts',
        'src/orchestrator-v5/compose/phase3-blocks.ts',
        'src/orchestrator-v5/compose/ui-directive.ts',
        // The auto-run's own delivery path — the one that mattered most.
        'src/routes/scenario-graph-analysis-read.ts',
      ].sort(),
    );
  });
});

describe('the provenance predicate is the thing being read', () => {
  it('reads unstamped facts as the user’s — the fail-safe direction', () => {
    expect(wasAnalysisRequestedByUser(makeCapturedFact({ autoInitiated: false }))).toBe(true);
    expect(wasAnalysisRequestedByUser(makeCapturedFact({ autoInitiated: true }))).toBe(false);
  });

  it('the shared admission is a CONJUNCTION — either question closing withholds', () => {
    // All four cells, so neither term can be dropped without a RED. A test of
    // only the two diagonal cells would pass on either single term alone.
    const withdrawVerdict = (fact: RunAnalysisHandlerFact): RunAnalysisHandlerFact =>
      ({
        ...fact,
        result: {
          ...fact.result,
          constraint_verdict: {
            may_name_leading_option: false,
            constraint_verdict_state: 'evaluated_infeasible',
          },
        },
      }) as unknown as RunAnalysisHandlerFact;

    const requested = makeCapturedFact({ autoInitiated: false });
    const unrequested = makeCapturedFact({ autoInitiated: true });

    expect(mayPresentLeaderClaimForFact(requested)).toBe(true);
    expect(mayPresentLeaderClaimForFact(unrequested)).toBe(false);
    expect(mayPresentLeaderClaimForFact(withdrawVerdict(requested))).toBe(false);
    expect(mayPresentLeaderClaimForFact(withdrawVerdict(unrequested))).toBe(false);
  });

  it('the two arms differ in exactly one enrichment key', () => {
    const requested = Object.keys(
      (makeCapturedFact({ autoInitiated: false }).result.enrichment ?? {}) as Record<
        string,
        unknown
      >,
    );
    const unrequested = Object.keys(
      (makeCapturedFact({ autoInitiated: true }).result.enrichment ?? {}) as Record<
        string,
        unknown
      >,
    );
    expect(unrequested.filter((k) => !requested.includes(k))).toEqual(['run_provenance']);
  });
});
