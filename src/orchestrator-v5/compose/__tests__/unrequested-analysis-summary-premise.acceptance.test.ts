/**
 * ACCEPTANCE — the unrequested-run summary stops asserting a premise the
 * ADMISSION has already recorded as ended, and still ships it when it holds.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MEASURED CONTRADICTION (founder session, deployed staging, 2026-09-14)
 *
 * ONE payload carried BOTH of these:
 *
 *     analysis_ready.analysis_admission.permitted_analysis_mode = "comparative_leader"
 *     reason CONFIDENCE_PARAMETERS_PARTLY_USER_STATED — "At least one of the
 *     estimates this comparison rests on is yours, so a leading option can be named."
 *
 *     blocks[].summary — "... Nothing in it is confirmed yet, so no option is
 *     put forward and no result is called reliable."
 *
 * The second is the direct negation of the first. `deriveMode` grants
 * `comparative_leader` on exactly one branch (`semanticSufficient === true`) and
 * `semanticQualitySufficient` is `material_parameters_user_stated > 0` — so the
 * mode ENTAILS the user has confirmed an estimate the comparison rests on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CORPUS IS TWO REAL CAPTURES, ONE PER ARM — NOT A FIXTURE I WROTE
 *
 *   PREMISE ENDED  `fixtures/analysis-admission-comparative-leader-2026-09-14.json`
 *                  — the admission from the founder export above.
 *   PREMISE HOLDS  `fixtures/c2-context-response-20260907T203538Z.json`
 *                  — an EXISTING dated capture already in this repo, whose
 *                    admission reads `quantified_provisional` /
 *                    `CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED` BESIDE the very
 *                    same summary sentence. On that arm the sentence is TRUE.
 *
 * ⭐ THAT SECOND FILE IS WHY THIS IS NOT A ONE-ARMED TEST. The same constant
 * shipped on both captures nine days apart; only the admission distinguishes
 * them. A corpus drawn from the author's head could not have contained the pair
 * (parent CLAUDE.md trap 22), and both files are HISTORIC RECORDS — read, never
 * edited (trap 14b).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT EACH ARM PROVES, AND WHY THE NEGATIVE ARM IS THE LOAD-BEARING ONE
 *
 * Silencing the disclosure everywhere would be WORSE than the defect it fixes:
 * on a run that genuinely cannot name a leader the product must still say so.
 * So `premise holds ⇒ byte-identical` is asserted first and asserted by
 * IDENTITY against the exported constant, and every "the disclosure is gone"
 * assertion is paired with POSITIVE SURVIVAL assertions — that a summary is
 * still present, still non-empty, and still names no option — so the test
 * cannot pass by the answer having collapsed to nothing (trap 19).
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  ANALYSIS_MODE_RANK,
  PERMITTED_ANALYSIS_MODES,
} from '../../admission/analysis-admission.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { buildAutoRunProvenance } from '../../context/run-initiator.js';
import { textNamesLeadingOption } from '../leading-option-egress-guard.js';
import {
  UNREQUESTED_ANALYSIS_SUMMARY,
  confineUnrequestedAnalysisBlock,
  unrequestedSummaryPremiseHolds,
} from '../unrequested-analysis-confinement.js';
import { WITHHELD_ANALYSIS_SUMMARY } from '../withheld-claim-projection.js';

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf-8'));

/** PREMISE ENDED — the founder capture that contradicted itself. */
const ENDED = readJson('analysis-admission-comparative-leader-2026-09-14.json') as {
  readonly analysis_admission: Record<string, unknown>;
};

/** PREMISE HOLDS — an existing dated capture already in this repo. */
const HELD = (
  readJson('c2-context-response-20260907T203538Z.json') as {
    readonly analysis_ready: { readonly analysis_admission: Record<string, unknown> };
  }
).analysis_ready.analysis_admission;

const analysisReadyOf = (admission: Record<string, unknown>): unknown => ({
  analysis_admission: admission,
});

const LEADER_ASSERTING_SUMMARY =
  'Raise Price to £59 with Feature Release currently leads by 18 percentage points.';
const LEADER_FREE_SUMMARY = 'Higher capacity leads to faster delivery on every option tested.';

function makeFact(opts: {
  readonly autoInitiated: boolean;
  readonly summary: string;
}): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      leading_option_id: 'opt_raise_59',
      summary: opts.summary,
      win_probabilities: { opt_raise_59: 0.72395, opt_hold_49: 0.0943 },
      graph_hash_at_run: 'gh_premise_arms',
      computed_at: '2026-09-14T17:37:49.552Z',
      // PERMITTED on both arms deliberately: a withheld constraint verdict
      // would let the existing projection do the work and hide whether this
      // gate does any. The unrequested arm must reach its result through run
      // provenance alone.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment: {
        robustness: { display_verdict: 'fragile', is_robust: false, fragile_edges: [] },
        ...(opts.autoInitiated
          ? { run_provenance: buildAutoRunProvenance('11111111-1111-4111-8111-111111111111') }
          : {}),
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

const summaryOf = (fact: RunAnalysisHandlerFact, analysisReady?: unknown): string =>
  (buildAnalysisResultBlock(fact, analysisReady) as unknown as { readonly summary: string })
    .summary;

describe('the two captured admissions really differ (positive controls)', () => {
  it('the founder capture reads comparative_leader BECAUSE a material parameter is the user’s', () => {
    // Without this, every "premise ended" assertion below is vacuous.
    expect(ENDED.analysis_admission.permitted_analysis_mode).toBe('comparative_leader');
    expect(ENDED.analysis_admission.semantic_quality_sufficient).toBe(true);
    const signals = ENDED.analysis_admission.semantic_signals as Record<string, number>;
    expect(signals.material_parameters_user_stated).toBeGreaterThan(0);
  });

  it('the 7 Sep capture reads quantified_provisional with NO user-stated material parameter', () => {
    expect(HELD.permitted_analysis_mode).toBe('quantified_provisional');
    expect(HELD.semantic_quality_sufficient).toBe(false);
    const signals = HELD.semantic_signals as Record<string, number>;
    expect(signals.material_parameters_user_stated).toBe(0);
  });

  it('⭐ the 7 Sep capture shipped the DISCLOSURE SENTENCE beside that admission', () => {
    // The pair is the whole argument: one constant, two admissions, nine days
    // apart. This asserts the historic record really does contain it, so the
    // "true on one arm, false on the other" claim is measured, not asserted.
    const blocks = (
      readJson('c2-context-response-20260907T203538Z.json') as {
        readonly blocks: readonly { readonly type: string; readonly summary?: string }[];
      }
    ).blocks;
    const analysisBlock = blocks.find((b) => b.type === 'analysis_result');
    expect(analysisBlock?.summary).toBe(UNREQUESTED_ANALYSIS_SUMMARY);
  });
});

describe('unrequestedSummaryPremiseHolds — the gate itself', () => {
  it('holds on the 7 Sep admission and has ENDED on the 14 Sep one', () => {
    expect(unrequestedSummaryPremiseHolds(analysisReadyOf(HELD))).toBe(true);
    expect(unrequestedSummaryPremiseHolds(analysisReadyOf(ENDED.analysis_admission))).toBe(false);
  });

  it('FAILS OPEN on every shape that cannot establish a mode', () => {
    // `null` from the shared reader means "could not establish one", never
    // "no" — the schema's own rule. Absent/older/hostile payloads must keep
    // today's sentence exactly as it ships now.
    for (const absent of [
      undefined,
      null,
      {},
      { analysis_admission: null },
      { analysis_admission: {} },
      { analysis_admission: { permitted_analysis_mode: 'not_a_mode' } },
      { analysis_admission: { permitted_analysis_mode: 42 } },
      // An inherited key must not be read as a mode.
      { analysis_admission: { permitted_analysis_mode: 'toString' } },
    ]) {
      expect(unrequestedSummaryPremiseHolds(absent)).toBe(true);
    }
  });

  it('is DERIVED from the mode lattice, not from a hand-written list of names', () => {
    // Every mode below comparative_leader keeps the disclosure; only the top
    // rank stands it down. Iterating the lattice means a mode added later is
    // ordered by construction (parent CLAUDE.md trap 12).
    expect(PERMITTED_ANALYSIS_MODES.length).toBeGreaterThan(1);
    for (const mode of PERMITTED_ANALYSIS_MODES) {
      const expected = ANALYSIS_MODE_RANK[mode] < ANALYSIS_MODE_RANK.comparative_leader;
      expect(unrequestedSummaryPremiseHolds({ analysis_admission: { permitted_analysis_mode: mode } })).toBe(
        expected,
      );
    }
  });
});

describe('PREMISE HOLDS — the disclosure is untouched (the negative control)', () => {
  it('ships the exported constant BYTE-IDENTICAL on the 7 Sep admission', () => {
    const fact = makeFact({ autoInitiated: true, summary: LEADER_ASSERTING_SUMMARY });
    expect(summaryOf(fact, analysisReadyOf(HELD))).toBe(UNREQUESTED_ANALYSIS_SUMMARY);
  });

  it('ships it when NO admission is supplied at all — the fail-open path', () => {
    const fact = makeFact({ autoInitiated: true, summary: LEADER_ASSERTING_SUMMARY });
    expect(summaryOf(fact)).toBe(UNREQUESTED_ANALYSIS_SUMMARY);
    expect(summaryOf(fact, undefined)).toBe(UNREQUESTED_ANALYSIS_SUMMARY);
  });
});

describe('PREMISE ENDED — the false clause goes, the honesty does not', () => {
  const analysisReady = analysisReadyOf(ENDED.analysis_admission);

  it('⭐ stops asserting that nothing is confirmed', () => {
    const fact = makeFact({ autoInitiated: true, summary: LEADER_ASSERTING_SUMMARY });
    const summary = summaryOf(fact, analysisReady);

    expect(summary).not.toBe(UNREQUESTED_ANALYSIS_SUMMARY);
    expect(summary).not.toContain('Nothing in it is confirmed yet');

    // POSITIVE SURVIVAL — the answer did not collapse to nothing.
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('⭐ still names NO option — a leader-asserting summary is replaced, not released', () => {
    const fact = makeFact({ autoInitiated: true, summary: LEADER_ASSERTING_SUMMARY });
    const summary = summaryOf(fact, analysisReady);

    // Positive control: the INPUT really does name a leader, so this absence
    // assertion is not vacuous.
    expect(textNamesLeadingOption(LEADER_ASSERTING_SUMMARY)).toBe(true);

    expect(summary).toBe(WITHHELD_ANALYSIS_SUMMARY);
    expect(textNamesLeadingOption(summary)).toBe(false);
  });

  it('keeps an already-honest summary byte-identical rather than blanking it', () => {
    // Anti-over-suppression: withholding is scoped to the CLAIM, not the field.
    const fact = makeFact({ autoInitiated: true, summary: LEADER_FREE_SUMMARY });
    expect(summaryOf(fact, analysisReady)).toBe(LEADER_FREE_SUMMARY);
  });

  it('⛔ changes ONLY the summary — every field-level confinement still fires', () => {
    // The gate must not become a back door out of the confinement. These are
    // governed by run PROVENANCE alone and must be identical on both arms.
    const fact = makeFact({ autoInitiated: true, summary: LEADER_ASSERTING_SUMMARY });
    const block = buildAnalysisResultBlock(fact, analysisReady) as unknown as {
      readonly leading_option_id: string | null;
      readonly win_probabilities?: Record<string, number>;
      readonly enrichment?: Record<string, unknown>;
    };

    // Positive control: the FACT really does carry both.
    expect(fact.result.leading_option_id).toEqual(expect.any(String));
    expect(Object.keys(fact.result.win_probabilities as Record<string, number>)).not.toHaveLength(
      0,
    );

    expect(block.leading_option_id).toBeNull();
    expect(block).not.toHaveProperty('win_probabilities');
    const robustness = block.enrichment?.robustness as Record<string, unknown> | undefined;
    expect(robustness).not.toHaveProperty('display_verdict');
    expect(robustness).not.toHaveProperty('is_robust');
  });
});

describe('a run the user asked for is untouched on BOTH admissions', () => {
  it('is returned BY REFERENCE whichever admission is supplied', () => {
    // The requested path — every analysis a user has ever clicked for — cannot
    // change by one byte, and the new parameter must not perturb it.
    const fact = makeFact({ autoInitiated: false, summary: LEADER_ASSERTING_SUMMARY });
    const block = buildAnalysisResultBlock(fact);
    for (const ready of [
      undefined,
      analysisReadyOf(HELD),
      analysisReadyOf(ENDED.analysis_admission),
    ]) {
      expect(confineUnrequestedAnalysisBlock(block, fact, ready)).toBe(block);
    }
  });

  it('keeps the leader and the probabilities on the requested path', () => {
    const fact = makeFact({ autoInitiated: false, summary: LEADER_ASSERTING_SUMMARY });
    const block = buildAnalysisResultBlock(
      fact,
      analysisReadyOf(ENDED.analysis_admission),
    ) as unknown as {
      readonly leading_option_id: string | null;
      readonly win_probabilities?: Record<string, number>;
      readonly summary: string;
    };
    expect(block.leading_option_id).toBe('opt_raise_59');
    expect(block.win_probabilities).toEqual(fact.result.win_probabilities);
    expect(block.summary).toBe(LEADER_ASSERTING_SUMMARY);
  });
});
