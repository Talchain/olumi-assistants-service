/**
 * ⭐⭐ THE COMPOSED RESPONSE — a BUILT analysis_result block, not `blocks: []`.
 *
 * ⛔ THIS FILE'S FIRST VERSION COULD NOT SUPPORT ITS OWN CLAIM, and the
 *    independent review said so (`5592620999` at `39557a98`): it constructed
 *    `blocks: []` with synthetic ALREADY-QUALIFIED assistant prose, so it never
 *    built an `analysis_result`, never exercised a composer, and could not
 *    establish the structured-summary acceptance it was named for. Withdrawn.
 *    This version builds the block with the REAL producer
 *    (`compose.ts::buildAnalysisResultBlock` from a schema-parsed
 *    `run_analysis` fact — the same idiom as
 *    `__tests__/c2-analysis-interpretation-composition.test.ts`) and feeds the
 *    enforcer prose that is NOT pre-qualified.
 *
 * The witnessed failure, native request `23ab579d-5dda-4e5f-9ed9-a9eb889446f8`:
 * a comparative assessment beside "No single option can be put forward yet."
 *
 * Populations (confusing them reverses a ruling):
 *   · Paul, relayed `olumi-programme-docs#38` comment `5576895511`:
 *     `quantified_provisional` is **caveat, not withhold**.
 *   · #1254 (merged `9de184f1`): withhold where options CANNOT be separated.
 * Disposition: `contextual-research/SCOPE-DISPOSITION-f361-20260908.md`.
 *
 * Case (1)/(2) are the corrected behaviour: the qualified arm must produce
 * QUALIFIED output on BOTH surfaces, not permit unqualified output. (3)-(7) are
 * the restrictions that must not move — each a distinct reason to withhold, so
 * a permit that widened past the named population REDs on one of them.
 *
 * Synthetic prose. No provider, browser or DB call. NOT RUN LOCALLY: root's
 * resource direction is hosted-only, so hosted CI is this file's first execution.
 */
import { describe, expect, it } from 'vitest';
import { OlumiResponseSchema, type OlumiResponse } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { buildAnalysisResultBlock } from '../../compose.js';
import {
  enforceLeadingOptionClaimsAtWire,
  PROVISIONAL_FIGURES_CAVEAT,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
} from '../leading-option-wire-enforcement.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEAD = 'Adopt RudderStack';
const OTHER = 'Adopt Segment';
const GRAPH = {
  nodes: [
    { id: 'option-a', kind: 'option', label: LEAD },
    { id: 'option-b', kind: 'option', label: OTHER },
  ],
  edges: [],
};

/** The producer's own summary — honest figures, goal-fit wording, no caveat. */
const PRODUCER_SUMMARY = `${LEAD} scored highest against your goal in 55% of runs, ${OTHER} in 36%.`;

function runFact(): RunAnalysisHandlerFact {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO,
      graph_hash_at_run: 'e6aceffe33a51baf',
      computed_at: '2026-09-08T19:18:21.292Z',
      leading_option_id: 'option-a',
      summary: PRODUCER_SUMMARY,
      win_probabilities: { 'option-a': 0.55, 'option-b': 0.36 },
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment: {
        analysis_status: 'completed',
        robustness: { level: 'moderate', near_tie: { is_tie: false } },
        option_comparison: [
          { option_id: 'option-a', option_label: LEAD, win_probability: 0.55 },
          { option_id: 'option-b', option_label: OTHER, win_probability: 0.36 },
        ],
      },
    },
  });
}

/** Deliberately NOT pre-qualified — the reviewer's exact counterexample shape. */
const UNQUALIFIED_ANSWER = `${LEAD} is the best option.`;

function envelope(assistantText: string): OlumiResponse {
  return OlumiResponseSchema.parse({
    response_version: 2,
    assistant_text: assistantText,
    blocks: [buildAnalysisResultBlock(runFact())],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  });
}

function readSummary(response: OlumiResponse): string | undefined {
  const block = response.blocks.find(
    (candidate) => (candidate as { type?: unknown }).type === 'analysis_result',
  ) as { summary?: unknown } | undefined;
  return typeof block?.summary === 'string' ? block.summary : undefined;
}

function readLeadingOptionId(response: OlumiResponse): unknown {
  const block = response.blocks.find(
    (candidate) => (candidate as { type?: unknown }).type === 'analysis_result',
  ) as { leading_option_id?: unknown } | undefined;
  return block?.leading_option_id;
}

function readiness(mode: string | null): unknown {
  return mode === null
    ? {}
    : { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: mode } };
}

const BASE = {
  requestId: 'separable-provisional-composed',
  exitPath: 'edit_graph',
  graph: GRAPH,
};

describe('separable provisional — one qualified interpretation across both surfaces', () => {
  it('(1) UNQUALIFIED assistant prose is QUALIFIED, not waved through', () => {
    // The finding, verbatim: the previous arm returned the whole response
    // unchanged, so this exact sentence shipped unqualified.
    const result = enforceLeadingOptionClaimsAtWire(envelope(UNQUALIFIED_ANSWER), {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: true,
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(UNQUALIFIED_ANSWER);
    expect(result.response.assistant_text).toContain(PROVISIONAL_FIGURES_CAVEAT);
    // Caveat, NOT withhold: the honest figures survive.
    expect(result.response.assistant_text).not.toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(2) the BUILT analysis_result summary carries the same qualification, figures intact', () => {
    const built = envelope(UNQUALIFIED_ANSWER);
    expect(readSummary(built)).toContain('55%');
    const result = enforceLeadingOptionClaimsAtWire(built, {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: true,
    });
    const summary = readSummary(result.response);
    expect(summary).toContain(PROVISIONAL_FIGURES_CAVEAT);
    // The producer's honest statistic is retained, not replaced.
    expect(summary).toContain('55%');
    expect(summary).not.toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
    // ⚠ The ID the producer set is UNTOUCHED. This seam never restores an ID
    //   over a legitimate null projection and never removes a legitimate one.
    expect(readLeadingOptionId(result.response)).toBe(readLeadingOptionId(built));
    expect(result.blocksProjected).toBe(true);
  });

  it('(3) attaching is idempotent — an already-qualified answer is not caveated twice', () => {
    const once = enforceLeadingOptionClaimsAtWire(envelope(UNQUALIFIED_ANSWER), {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: true,
    }).response;
    const twice = enforceLeadingOptionClaimsAtWire(once, {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: true,
    });
    expect(twice.changed).toBe(false);
    expect(twice.response).toBe(once);
  });

  it('(4) NEAR TIE: still withheld — #1254 untouched', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(UNQUALIFIED_ANSWER), {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: false,
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
    expect(result.response.assistant_text).not.toContain(PROVISIONAL_FIGURES_CAVEAT);
  });

  it('(5) separation NOT COMPUTED (operand absent): fail-closed', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(UNQUALIFIED_ANSWER), {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(6) NOT entitled: a genuine constraint restriction withholds, separation regardless', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(UNQUALIFIED_ANSWER), {
      ...BASE,
      mayNameLeadingOption: false,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: true,
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(7) a LOWER mode is not the named population, even when separated', () => {
    // `exploratory` sits below the provisional cap in `ANALYSIS_MODE_RANK`. It
    // is a different admission answer and keeps its restriction; the receiving
    // branch names the same exact population, so the two cannot disagree.
    const result = enforceLeadingOptionClaimsAtWire(envelope(UNQUALIFIED_ANSWER), {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('exploratory'),
      separationEstablished: true,
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(8) missing admission compatibility: legacy permit, byte-identical', () => {
    const input = envelope(UNQUALIFIED_ANSWER);
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness(null),
    });
    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
    expect(result.response.assistant_text).not.toContain(PROVISIONAL_FIGURES_CAVEAT);
  });
});
