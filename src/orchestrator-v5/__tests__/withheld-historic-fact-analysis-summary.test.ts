/**
 * T1 claim safety — F1. THE HISTORIC-FACT CONTRADICTION, MANUFACTURED BY THE
 * FAIL-CLOSED DEFAULT ITSELF.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SHAPE NO WALK EVER INDUCED, AND WHY.
 *
 * Every acceptance walk of this arc induces a FRESH scenario: it runs an
 * analysis, so the fact it then reasons over was written by the current handler
 * and carries a `constraint_verdict` stamp. The failing shape is the opposite —
 * a fact persisted BEFORE #708's headline gate, which carries NEITHER
 * `result.constraint_verdict` NOR `enrichment.__cee_claim_safety`, and whose
 * `summary` was composed under the pre-gate template that names the leader:
 *
 *     "The MacBook Pro currently leads by 18 percentage points."
 *
 * (verbatim class from the live staging defect quoted in
 * `coaching/constraint-gap-disclosure.ts`'s own docstring.)
 *
 * There is no data migration — that was the ruling — so those facts are still
 * in the store. Reopen such a scenario, click explain, get freshness `fresh`,
 * and `compose.ts`'s prior-fact lifecycle branch rebuilds the block from that
 * fact. `readMayNameLeadingOptionFromResult` fails CLOSED on the missing stamp,
 * so the turn is WITHHELD: `leading_option_id` is nulled, the enrichment is
 * projected, the leader-presuming Phase-3 blocks are dropped, and the assistant
 * text says no option can be put forward.
 *
 * And `summary` ships VERBATIM on every branch. Byte-for-byte the G-CEE-1
 * contradiction, manufactured by the gate's own fail-closed default.
 *
 * TWO INDEPENDENT HALVES ARE PINNED HERE, because either alone is theatre:
 *
 *   (a) THE PRODUCER — `buildAnalysisResultBlock` must not ship a leader-naming
 *       summary on a withheld turn. With a PERMITTED positive control proving
 *       the summary still ships VERBATIM when the verdict licenses it:
 *       over-suppression is an equal failure and this test refuses it.
 *   (b) THE ALARM — `summary` was absent from `BLOCK_PROSE_FIELDS` and its key
 *       name matches no `LEADER_DESIGNATING_KEY_PATTERNS` entry, so `scanKey`
 *       could not see it either. The telemetry meant to SIZE this residue
 *       reported zero hits on exactly the class it was missing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { composeToolCallResponse } from '../compose.js';
import type { FreshnessDerivation } from '../context/freshness.js';
import {
  findLeaderClaims,
  textNamesLeadingOption,
} from '../compose/leading-option-egress-guard.js';
import { log } from '../../utils/telemetry.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_GRAPH_HASH = 'gh_historic_9f8e7d6c';

/**
 * The live pre-#708 summary class, verbatim in shape. `\bleads\b` is
 * `LEADER_CLAIM_PATTERNS[0]`, so both readers see it — and neither was pointed
 * at this field.
 */
const HISTORIC_LEADER_SUMMARY =
  'The MacBook Pro currently leads by 18 percentage points.';

/** A pre-#708 summary that names no leader — the over-suppression control. */
const HISTORIC_NEUTRAL_SUMMARY = 'Ran analysis on your current scenario.';

/**
 * A run_analysis fact as persisted BEFORE #708.
 *
 * CONSTRUCTED, NOT ARCHIVED, AND SAID SO (TESTING-DISCIPLINE rule 8): no
 * archived body of a pre-#708 fact is available to this lane — the corpora all
 * post-date the stamp. What is NOT constructed is the shape: the absence of
 * both stamps is the documented pre-#708 state
 * (`readMayNameLeadingOptionFromResult`'s own docstring, "every fact written
 * before #710 carries neither"), and the summary is the live sentence class
 * quoted in `constraint-gap-disclosure.ts`.
 *
 * `stamp` promotes the same fixture to a POST-#708 permitted fact, so the
 * withheld case and its positive control differ in exactly ONE field.
 */
function makeHistoricFact(opts: {
  readonly summary: string;
  readonly stamp?: 'permitted';
}): RunAnalysisHandlerFact {
  const result: Record<string, unknown> = {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_macbook',
    summary: opts.summary,
    win_probabilities: { opt_macbook: 0.59, opt_dell: 0.41 },
    graph_hash_at_run: SOURCE_GRAPH_HASH,
    computed_at: '2026-06-01T00:00:00.000Z',
    enrichment: {
      option_comparison: [
        { option_id: 'opt_macbook', option_label: 'MacBook Pro', win_probability: 0.59 },
        { option_id: 'opt_dell', option_label: 'Dell XPS', win_probability: 0.41 },
      ],
      factor_sensitivity: [{ factor_id: 'fac_cost', influence_score: 0.5 }],
    },
  };
  if (opts.stamp === 'permitted') {
    result.constraint_verdict = {
      may_name_leading_option: true,
      constraint_verdict_state: 'evaluated_feasible',
    };
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result,
  } as unknown as RunAnalysisHandlerFact;
}

function freshDerivation(): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: SOURCE_GRAPH_HASH,
    current_graph_hash: SOURCE_GRAPH_HASH,
    computed_at: '2026-06-01T00:00:00.000Z',
  };
}

/** Reopen-and-explain: no current-turn fact, the prior fact rebuilt as FRESH. */
function composeFromPriorFact(fact: RunAnalysisHandlerFact): OlumiResponse {
  return composeToolCallResponse({
    answerKind: 'functional',
    orientation: '',
    confirmation: 'No single option can be put forward on this result yet.',
    coaching: null,
    stage: 'decide',
    handlerFacts: [],
    lifecycle: {
      priorFacts: [fact],
      freshness: freshDerivation(),
      requestId: 'req-historic',
      scenarioId: SCENARIO_ID,
    },
  });
}

function analysisResultSummary(response: OlumiResponse): string {
  const block = response.blocks.find((b) => b.type === 'analysis_result');
  expect(block, 'the FRESH lifecycle branch must emit an analysis_result block').toBeDefined();
  const summary = (block as unknown as Record<string, unknown>).summary;
  expect(typeof summary, 'analysis_result.summary is a REQUIRED wire string').toBe('string');
  return summary as string;
}

describe('F1 — a PRE-#708 fact must not ship a leader-naming summary on a withheld turn', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('PRECONDITION: the fixture really is unstamped, and really does read as WITHHELD', () => {
    // Rule 1 non-vacuity. If a future release started stamping historic facts,
    // or the fail-closed default were relaxed, this whole file would pass by
    // testing the PERMITTED path — green, and measuring nothing.
    const fact = makeHistoricFact({ summary: HISTORIC_LEADER_SUMMARY });
    const result = fact.result as unknown as Record<string, unknown>;
    expect(result.constraint_verdict, 'the pre-#708 fact carries no typed verdict').toBeUndefined();
    expect(
      (result.enrichment as Record<string, unknown>).__cee_claim_safety,
      'the pre-#708 fact carries no interim stamp either',
    ).toBeUndefined();

    // The withheld projection is observable on the block: the id is nulled.
    const response = composeFromPriorFact(fact);
    const block = response.blocks.find((b) => b.type === 'analysis_result')!;
    expect(
      (block as unknown as Record<string, unknown>).leading_option_id,
      'an unstamped fact must fail CLOSED — this is the state the defect rides on',
    ).toBeNull();
  });

  it('the withheld wire carries NO leader language in analysis_result.summary', () => {
    const response = composeFromPriorFact(
      makeHistoricFact({ summary: HISTORIC_LEADER_SUMMARY }),
    );
    const summary = analysisResultSummary(response);
    expect(
      textNamesLeadingOption(summary),
      'the block shipped a leader-naming summary on a turn whose own assistant_text says no ' +
        'option can be put forward — the G-CEE-1 contradiction, manufactured by the ' +
        'fail-closed default on a historic fact',
    ).toBe(false);
    expect(summary).not.toContain('MacBook Pro');
  });

  it('POSITIVE CONTROL (over-suppression): a PERMITTED turn ships the summary VERBATIM', () => {
    // Equal-weighted failure. A gate that blanks every summary would pass the
    // assertion above and destroy the product's answer on every healthy turn.
    const response = composeFromPriorFact(
      makeHistoricFact({ summary: HISTORIC_LEADER_SUMMARY, stamp: 'permitted' }),
    );
    expect(analysisResultSummary(response)).toBe(HISTORIC_LEADER_SUMMARY);
  });

  it('a WITHHELD turn whose summary names no leader keeps it VERBATIM', () => {
    // The second half of the anti-over-suppression property: withholding is
    // scoped to the CLAIM, not to the field. A neutral summary is content the
    // user is entitled to on exactly the turn a recommendation is withheld.
    const response = composeFromPriorFact(
      makeHistoricFact({ summary: HISTORIC_NEUTRAL_SUMMARY }),
    );
    expect(analysisResultSummary(response)).toBe(HISTORIC_NEUTRAL_SUMMARY);
  });
});

describe('F1(b) — the ALARM can see blocks[].summary at all', () => {
  /**
   * Pinned against `findLeaderClaims` directly rather than through the guard,
   * because the guard is observe-only: its only observable is the log line, and
   * a scan-surface hole is invisible there by construction.
   */
  function envelopeWithSummary(summary: string): OlumiResponse {
    return {
      assistant_text: 'No single option can be put forward on this result yet.',
      blocks: [{ type: 'analysis_result', summary, leading_option_id: null }],
    } as unknown as OlumiResponse;
  }

  it('reports a leader-naming blocks[].summary', () => {
    const hits = findLeaderClaims(envelopeWithSummary(HISTORIC_LEADER_SUMMARY));
    expect(
      hits.map((h) => h.path),
      'the one field the disclosure doctrine says the disclosure RIDES was outside the ' +
        'residue meter, so the telemetry sizing this class under-counted exactly it',
    ).toContain('blocks[0].summary');
    expect(hits.find((h) => h.path === 'blocks[0].summary')!.code).toBe('leads');
  });

  it('POSITIVE CONTROL: a leader-free summary is NOT reported', () => {
    // Rule 2 — an alarm that fires on everything is not an alarm.
    const hits = findLeaderClaims(envelopeWithSummary(HISTORIC_NEUTRAL_SUMMARY));
    expect(hits.map((h) => h.path)).not.toContain('blocks[0].summary');
  });
});
