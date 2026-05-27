/**
 * Tests for `buildPostDraftNarrative` — the deterministic post-draft
 * coaching gated-hybrid composer.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPostDraftNarrative,
  validateUncertaintyDriver,
} from '../post-draft-narrative.js';
import { sanitiseUserFacingText } from '../../compose/output-safety.js';
import type { GraphV3T } from '../../../orchestrator/types.js';
import type { AnalysisReadyPayloadT } from '../../../schemas/analysis-ready.js';

const FORBIDDEN_TERMS = [
  'intervention',
  'schema',
  'graph node',
  'graph_node',
  'payload',
  'analysis_ready',
  'factor id',
  'factor_id',
  'node id',
  'node_id',
  'model adjustment',
  'model_adjustment',
  'bias finding',
  'bias_finding',
  'recommend',
  'best option',
  'winner',
] as const;

function assertCleanCopy(text: string): void {
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    expect(lower, `should not contain "${term}": ${text}`).not.toContain(term);
  }
  // No em dashes.
  expect(text, 'should not contain em dash').not.toMatch(/—/);
  // No internal-id-shaped prefix tokens (only the specific internal-ID
  // prefixes leak — legitimate user-facing snake-case labels like
  // `go_to_market` or `b2b_partnership` must survive.)
  expect(text, 'should not expose internal id prefixes').not.toMatch(
    /\b(?:fac|opt|out|risk|goal|dec|node)_[a-z0-9]+/i,
  );
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function makeGraph(nodes: GraphV3T['nodes']): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

/**
 * Helper: most tests only care about the rendered `text` field of the
 * builder result. Kept as a thin adapter so the existing assertions
 * remain readable.
 */
function textOf(input: Parameters<typeof buildPostDraftNarrative>[0]): string {
  return buildPostDraftNarrative(input).text;
}

const GOAL_NODE = {
  id: 'g1',
  kind: 'goal' as const,
  label: 'Deliver Successful Launch Within Three Months at Acceptable Quality',
};

const OPTION_A = { id: 'o1', kind: 'option' as const, label: 'Hire a tech lead' };
const OPTION_B = { id: 'o2', kind: 'option' as const, label: 'Hire two mid-weight developers' };
const OPTION_C = { id: 'o3', kind: 'option' as const, label: 'Hire one tech lead plus one developer' };
const OPTION_D = { id: 'o4', kind: 'option' as const, label: 'Continue with the current team' };
const OPTION_E = { id: 'o5', kind: 'option' as const, label: 'Outsource delivery to an agency' };

const FACTOR_QUALITY = {
  id: 'f1',
  kind: 'factor' as const,
  label: 'Leadership quality',
  observed_state: {
    value: 0.5,
    // Driver phrasing chosen to pass `validateUncertaintyDriver`: no
    // interrogative prefix, ends on a word character, well under the
    // 80-char ceiling, no internal jargon.
    uncertainty_drivers: ['extra developers may add coordination overhead rather than throughput'],
  },
};
const FACTOR_CAPACITY = {
  id: 'f2',
  kind: 'factor' as const,
  label: 'Delivery capacity',
};

const RISK_RAMP = { id: 'r1', kind: 'risk' as const, label: 'New hires take time to ramp up' };

describe('buildPostDraftNarrative', () => {
  it('returns a graceful single line when the graph is null', () => {
    const text = textOf({ graph: null });
    expect(text).toBe('Your decision model is ready to explore.');
  });

  it('returns a graceful single line when the graph has no nodes', () => {
    const text = textOf({ graph: makeGraph([]) });
    expect(text).toBe('Your decision model is ready to explore.');
  });

  it('confirms the goal label and uses it in the lead sentence', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain('"Deliver Successful Launch Within Three Months at Acceptable Quality"');
    expect(text.startsWith("I've built a first decision model")).toBe(true);
    assertCleanCopy(text);
  });

  it('falls back to a goalless confirmation when no goal node exists', () => {
    const text = textOf({
      graph: makeGraph([OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain("I've built a first decision model from your brief");
    assertCleanCopy(text);
  });

  it('summarises two options as "two routes"', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B]),
    });
    expect(text).toContain('comparing two routes');
    expect(text).toContain('Hire a tech lead');
    expect(text).toContain('Hire two mid-weight developers');
    assertCleanCopy(text);
  });

  it('summarises three options as "three routes" with serial layout', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, OPTION_C]),
    });
    expect(text).toContain('comparing three routes');
    expect(text).toContain('Hire a tech lead');
    expect(text).toContain('Hire two mid-weight developers');
    expect(text).toContain('Hire one tech lead plus one developer');
    assertCleanCopy(text);
  });

  it('summarises four options as "four routes"', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, OPTION_C, OPTION_D]),
    });
    expect(text).toContain('comparing four routes');
    expect(text).toContain('Continue with the current team');
    assertCleanCopy(text);
  });

  it('collapses 5+ options to "main routes include …" with up to three named', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, OPTION_C, OPTION_D, OPTION_E]),
    });
    expect(text).toContain('main routes include');
    expect(text).toContain('with further variants on the canvas');
    // Only the first three labels should appear in the option list line.
    expect(text).toContain('Hire a tech lead');
    expect(text).toContain('Hire two mid-weight developers');
    expect(text).toContain('Hire one tech lead plus one developer');
    expect(text).not.toContain('Continue with the current team');
    expect(text).not.toContain('Outsource delivery to an agency');
    assertCleanCopy(text);
  });

  it('truncates over-long option labels at a word boundary', () => {
    const longOpt = {
      id: 'o_long',
      kind: 'option' as const,
      label: 'Hire a tech lead and rebuild the entire engineering organisation top-to-bottom this quarter',
    };
    const text = textOf({
      graph: makeGraph([GOAL_NODE, longOpt, OPTION_B]),
    });
    // The truncated label should fit within ~40 chars and should not chop mid-word.
    expect(text).toContain('Hire a tech lead');
    expect(text).not.toContain('engineering organisation top-to-bottom');
    assertCleanCopy(text);
  });

  it('frames the trade-off using the first two factor labels', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain('Leadership quality');
    expect(text).toContain('Delivery capacity');
    expect(text).toMatch(/trade-off centres on|balanced against/);
    assertCleanCopy(text);
  });

  it('falls back to a single key consideration when only one factor exists', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY]),
    });
    expect(text).toContain('A key consideration is Leadership quality');
    assertCleanCopy(text);
  });

  it('uses the first risk when no factors exist', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, RISK_RAMP]),
    });
    expect(text).toContain('A key consideration is the risk of');
    expect(text).toContain('New hires take time to ramp up');
    assertCleanCopy(text);
  });

  it('mentions an uncertainty driver when present on a factor', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain('One assumption worth checking');
    expect(text).toContain('extra developers may add coordination overhead');
    assertCleanCopy(text);
  });

  it('uses the deterministic generic when only model_adjustments are present (no longer a sentence-4 source)', () => {
    // The gated-hybrid composer drops `analysisReady.model_adjustments`
    // from the sentence-4 source set: the LLM-authored coaching surface
    // is now richer (strengthenItems / coachingBiasSignals / bias_findings)
    // and model_adjustments are operational reasons, not user-facing
    // assumption signals. When they are the only available signal, the
    // builder falls through to the fixed-generic copy.
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [],
      model_adjustments: [
        {
          code: 'STRP_NORMALISE_PROBABILITY',
          reason: 'we normalised the threshold from a per-quarter rate to a per-month rate',
        },
      ],
    } as unknown as AnalysisReadyPayloadT;
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]),
      analysisReady,
    });
    expect(text).toContain(
      "One assumption worth checking is whether the model's key inputs reflect your real delivery constraints.",
    );
    expect(text).not.toContain('per-month rate');
    assertCleanCopy(text);
  });

  it('falls back to a bias_finding explanation when no other assumption source is available', () => {
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [
        {
          id: 'b1',
          category: 'confirmation',
          severity: 'medium',
          explanation: 'the brief leans on a single positive prior for the leadership scenario',
        },
      ],
    } as unknown as AnalysisReadyPayloadT;
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]),
      analysisReady,
    });
    expect(text).toContain('One assumption worth checking');
    expect(text).toContain('single positive prior');
    assertCleanCopy(text);
  });

  it('always ends with a run-analysis nudge', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toMatch(/run the analysis/);
    expect(text).toMatch(/\.$/);
  });

  it('does not exceed 140 words even with long inputs and a long adjustment reason', () => {
    const longReason = 'we assumed a baseline ramp-up window of six weeks based on prior hiring cycles ' +
      'observed across similar engineering teams, and that interview throughput would not be the binding ' +
      'constraint during the planning horizon';
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [],
      model_adjustments: [{ code: 'X', reason: longReason }],
    } as unknown as AnalysisReadyPayloadT;
    const text = textOf({
      graph: makeGraph([
        { ...GOAL_NODE, label: GOAL_NODE.label + ' across three product lines' },
        OPTION_A, OPTION_B, OPTION_C, OPTION_D, OPTION_E,
        FACTOR_QUALITY, FACTOR_CAPACITY,
        { id: 'f3', kind: 'factor' as const, label: 'Cost' },
        RISK_RAMP,
      ]),
      analysisReady,
    });
    expect(wordCount(text)).toBeLessThanOrEqual(140);
    assertCleanCopy(text);
  });

  it('produces output free of forbidden technical terms on a rich input', () => {
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [{ id: 'b1', category: 'x', severity: 'low', explanation: 'a clean explanation in user words' }],
      model_adjustments: [{ code: 'STRP', reason: 'we made the threshold consistent across options' }],
    } as unknown as AnalysisReadyPayloadT;
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, OPTION_C, FACTOR_QUALITY, FACTOR_CAPACITY, RISK_RAMP]),
      analysisReady,
    });
    assertCleanCopy(text);
    // Sanity: keeps the run-analysis line.
    expect(text).toMatch(/run the analysis/);
  });

  it('does not make any recommendation before analysis has run', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, OPTION_C, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text.toLowerCase()).not.toContain('best');
    expect(text.toLowerCase()).not.toContain('recommend');
    expect(text.toLowerCase()).not.toContain('winner');
    expect(text.toLowerCase()).not.toContain('we suggest');
    expect(text.toLowerCase()).not.toContain('you should');
    expect(text.toLowerCase()).not.toContain('the strongest option');
  });

  it('contains the lead, options, key trade-off and next step when data is rich', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain("I've built a first decision model");      // lead
    expect(text).toMatch(/two routes/);                                 // options summary
    expect(text).toMatch(/trade-off|consideration/);                    // trade-off / consideration
    expect(text).toMatch(/run the analysis/);                           // next step
  });

  it('drops the assumption sentence first when the budget is tight', () => {
    // No factors and no analysisReady → no trade-off sentence and no
    // assumption sentence will be built; output should be 3 sentences.
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B]),
    });
    expect(text).toContain("I've built a first decision model");
    expect(text).toContain('two routes');
    expect(text).toContain('run the analysis');
  });

  // ───── Grammar guard — fallback when an unsafe driver is the only signal
  it('substitutes the fixed-generic assumption when the only driver is question-shaped', () => {
    const factorWithBadDriver = {
      id: 'f_bad',
      kind: 'factor' as const,
      label: 'Capacity',
      observed_state: {
        value: 0.5,
        uncertainty_drivers: ['how the team will absorb the extra workload'],
      },
    };
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, factorWithBadDriver]),
    });
    expect(text).toContain(
      "One assumption worth checking is whether the model's key inputs reflect your real delivery constraints.",
    );
    // The bad driver itself must not appear verbatim — the guard short-circuits.
    expect(text).not.toContain('how the team will absorb');
    assertCleanCopy(text);
  });

  it('substitutes the fixed-generic assumption when the only driver ends with punctuation', () => {
    const factorWithBadDriver = {
      id: 'f_bad',
      kind: 'factor' as const,
      label: 'Capacity',
      observed_state: {
        value: 0.5,
        uncertainty_drivers: ['the launch ships on time.'],
      },
    };
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, factorWithBadDriver]),
    });
    expect(text).toContain(
      "One assumption worth checking is whether the model's key inputs reflect your real delivery constraints.",
    );
    expect(text).not.toContain('on time.');
  });

  it('does NOT fall through to model_adjustment when the driver candidate fails the guard', () => {
    // When a driver exists but is malformed, the fixed-generic copy wins —
    // we deliberately do not switch topics by falling through to a
    // model_adjustment, because the driver itself signals where the
    // assumption pressure is.
    const factorWithBadDriver = {
      id: 'f_bad',
      kind: 'factor' as const,
      label: 'Capacity',
      observed_state: {
        value: 0.5,
        uncertainty_drivers: ['?'], // trips length AND end-character checks
      },
    };
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [],
      model_adjustments: [{ code: 'STRP', reason: 'we adjusted a threshold to make options comparable' }],
    } as unknown as AnalysisReadyPayloadT;
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, factorWithBadDriver]),
      analysisReady,
    });
    expect(text).toContain(
      "One assumption worth checking is whether the model's key inputs reflect your real delivery constraints.",
    );
    expect(text).not.toContain('we adjusted a threshold');
  });

  // ───── Regression: legitimate snake-case option labels must survive
  it('preserves legitimate snake-case option labels verbatim in the assistant_text', () => {
    // go_to_market / b2b_partnership are ID-shaped but ARE the user's
    // chosen labels. The builder must not mangle, mask, or substitute
    // them. This guards against false positives in any downstream
    // ID-leak heuristic that might mistake real labels for IDs.
    const goToMarket = { id: 'opt_one', kind: 'option' as const, label: 'go_to_market' };
    const b2b = { id: 'opt_two', kind: 'option' as const, label: 'b2b_partnership' };
    const text = textOf({
      graph: makeGraph([GOAL_NODE, goToMarket, b2b, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain('go_to_market');
    expect(text).toContain('b2b_partnership');
    expect(text).toContain('two routes');
    // The labels appear in the options list line exactly as supplied.
    expect(text).toMatch(/two routes:\s+go_to_market\s+and\s+b2b_partnership\./);
  });

  it('snake-case option labels survive the egress sanitiser unchanged', () => {
    // End-to-end protection: the egress sanitiser (sanitiseUserFacingText)
    // scans for `<prefix>_<suffix>` patterns and rewrites detected ID
    // leaks. The `go` and `b2b` prefixes are NOT entity-id prefixes — the
    // sanitiser's PREFIX_SPLIT_RE recognises only `fac|opt|goal|dec|out|
    // risk|con|factor|option|decision|outcome|constraint`. This test pins
    // that contract so a future widening of the sanitiser's prefix set
    // cannot silently corrupt legitimate user-chosen labels.
    const goToMarket = { id: 'opt_one', kind: 'option' as const, label: 'go_to_market' };
    const b2b = { id: 'opt_two', kind: 'option' as const, label: 'b2b_partnership' };
    const graph = makeGraph([GOAL_NODE, goToMarket, b2b, FACTOR_QUALITY, FACTOR_CAPACITY]);
    const text = textOf({ graph });
    const sanitised = sanitiseUserFacingText(text, graph);
    expect(sanitised.text).toContain('go_to_market');
    expect(sanitised.text).toContain('b2b_partnership');
    // No replacement / mangling happened on these labels — the
    // sanitiser's matches array is empty.
    expect(sanitised.matches).toEqual([]);
    // And the post-sanitiser text equals the pre-sanitiser text — no
    // hidden whitespace / punctuation changes either.
    expect(sanitised.text).toBe(text);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Gated-hybrid composer — strengthen / bias_finding / coaching_bias_signal
// source priority and `coachingSummary` whole-response replacement.
// ───────────────────────────────────────────────────────────────────────

describe('buildPostDraftNarrative — gated-hybrid sources', () => {
  // Common short-graph fixture without uncertainty drivers — keeps the
  // sentence-4 source priority deterministic across cases.
  const baseGraph = makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]);

  it('uses strengthenItems[0].detail in sentence 4 when it passes the gate', () => {
    // Short, declarative detail well within the 150-char fragment cap;
    // no schema terms, no premature recommendation, no question shape.
    const items = [
      {
        id: 's1',
        label: 'Stress synergy estimate',
        detail: 'the synergy assumption sits as a point value and would benefit from a 10 to 30M range',
        action_type: 'add_constraint',
      },
    ];
    const result = buildPostDraftNarrative({ graph: baseGraph, strengthenItems: items });
    expect(result.text).toContain('One assumption worth checking');
    expect(result.text).toContain('synergy assumption sits as a point value');
    expect(result.telemetry.assumption_source).toBe('strengthen_item_detail');
    expect(result.telemetry.fallback_reason).toBeNull();
    assertCleanCopy(result.text);
  });

  it('falls back to strengthenItems[0].label when detail is too long and has no usable first sentence', () => {
    // Detail too long for the fragment cap AND has no sentence-ending
    // punctuation, so the first-sentence fallback inside the picker
    // also fails — we land on the label.
    const longDetail =
      'a long uninterrupted clause that runs well past the fragment cap and offers no sentence boundary the picker could trim back to before the assumption gate even has a chance to look at the candidate';
    const items = [
      {
        id: 's2',
        label: 'tighten the cost ramp curve',
        detail: longDetail,
        action_type: 'add_constraint',
      },
    ];
    const result = buildPostDraftNarrative({ graph: baseGraph, strengthenItems: items });
    expect(result.text).toContain('One assumption worth checking');
    expect(result.text).toContain('tighten the cost ramp curve');
    expect(result.text).not.toContain('long uninterrupted clause');
    expect(result.telemetry.assumption_source).toBe('strengthen_item_label');
  });

  it('extracts the first sentence from a long strengthen detail when it ends with sentence punctuation', () => {
    const items = [
      {
        id: 's3',
        label: 'too short',
        detail:
          'the synergy assumption sits as a point value. Recast it as a 10 to 30M range to surface downside scenarios and let the simulation expose fragility under stress.',
        action_type: 'add_constraint',
      },
    ];
    const result = buildPostDraftNarrative({ graph: baseGraph, strengthenItems: items });
    expect(result.text).toContain('the synergy assumption sits as a point value');
    expect(result.text).not.toContain('Recast it as a 10');
    expect(result.telemetry.assumption_source).toBe('strengthen_item_detail');
  });

  it('falls back to bias_findings when both strengthen.detail and .label fail the gate', () => {
    const items = [
      {
        id: 's4',
        // Premature recommendation language — gate rejects both fields.
        label: 'we recommend hiring',
        detail: 'we recommend hiring a senior lead before scaling the team further',
        action_type: 'add_constraint',
      },
    ];
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [
        {
          id: 'b1',
          category: 'confirmation',
          severity: 'medium',
          explanation: 'the brief leans on a single positive prior for the leadership scenario',
        },
      ],
    } as unknown as AnalysisReadyPayloadT;
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      strengthenItems: items,
      analysisReady,
    });
    expect(result.text).toContain('single positive prior');
    expect(result.text).not.toContain('we recommend hiring');
    expect(result.telemetry.assumption_source).toBe('bias_finding');
    expect(result.telemetry.fallback_reason).toBe('gate_rejected');
  });

  it('falls back to coachingBiasSignals when strengthen and bias_findings both fail', () => {
    const items = [
      { id: 's5', label: 'recommend foo', detail: 'we recommend doing foo', action_type: 'x' },
    ];
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [
        {
          id: 'b1',
          category: 'x',
          severity: 'low',
          // Trips the schema-term rule.
          explanation: 'the intervention sets baseline incorrectly across all options',
        },
      ],
    } as unknown as AnalysisReadyPayloadT;
    const signals = [
      {
        type: 'narrow_framing',
        detail: 'the brief frames the decision as binary acquire-or-skip when partner routes also exist',
      },
    ];
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      strengthenItems: items,
      analysisReady,
      coachingBiasSignals: signals,
    });
    expect(result.text).toContain('binary acquire-or-skip');
    expect(result.telemetry.assumption_source).toBe('coaching_bias_signal');
    expect(result.telemetry.fallback_reason).toBe('gate_rejected');
  });

  it('falls back to uncertainty_driver when all coaching sources fail', () => {
    const items = [
      { id: 's6', label: 'recommend foo', detail: 'we recommend doing foo', action_type: 'x' },
    ];
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [
        { id: 'b1', category: 'x', severity: 'low', explanation: 'the intervention frames things badly' },
      ],
    } as unknown as AnalysisReadyPayloadT;
    const signals = [{ type: 't', detail: 'the model_adjustment is suspect across the board' }];
    const result = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
      strengthenItems: items,
      analysisReady,
      coachingBiasSignals: signals,
    });
    expect(result.text).toContain('extra developers may add coordination overhead');
    expect(result.telemetry.assumption_source).toBe('uncertainty_driver');
    expect(result.telemetry.fallback_reason).toBe('gate_rejected');
  });

  it('falls through to fixed-generic when every source fails or is missing', () => {
    const items = [
      { id: 's7', label: 'recommend foo', detail: 'we recommend doing foo', action_type: 'x' },
    ];
    const result = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]),
      strengthenItems: items,
    });
    expect(result.text).toContain(
      "One assumption worth checking is whether the model's key inputs reflect your real delivery constraints.",
    );
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
    expect(result.telemetry.fallback_reason).toBe('gate_rejected');
  });

  it('reports `no_candidate` fallback when no source was available at all', () => {
    const result = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]),
    });
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
    expect(result.telemetry.fallback_reason).toBe('no_candidate');
  });

  it('rejects internal-id prefixes from strengthen.detail (fac_xxx)', () => {
    const items = [
      {
        id: 's8',
        label: 'review fac cost',
        detail: 'fac_cost may understate the real overhead by a wide margin under stress',
        action_type: 'x',
      },
    ];
    const result = buildPostDraftNarrative({ graph: baseGraph, strengthenItems: items });
    expect(result.text).not.toContain('fac_cost');
    expect(result.telemetry.assumption_source).not.toBe('strengthen_item_detail');
    assertCleanCopy(result.text);
  });

  it('rejects schema-term leaks from coachingBiasSignals (intervention)', () => {
    const signals = [
      { type: 'narrow_framing', detail: 'the intervention modelling looks shaky on the third route' },
    ];
    const result = buildPostDraftNarrative({ graph: baseGraph, coachingBiasSignals: signals });
    expect(result.text).not.toMatch(/intervention/i);
    expect(result.telemetry.assumption_source).not.toBe('coaching_bias_signal');
  });

  it('accepts user-facing snake-case labels inside a coaching source (go_to_market)', () => {
    const items = [
      {
        id: 's9',
        label: 'stress the go_to_market timing',
        detail: 'the go_to_market path may compress timelines too aggressively in the first quarter',
        action_type: 'add_constraint',
      },
    ];
    const result = buildPostDraftNarrative({ graph: baseGraph, strengthenItems: items });
    expect(result.text).toContain('go_to_market');
    // Source accepted — the legitimate user-facing label is NOT a
    // matching internal-id prefix and so passes the gate cleanly.
    expect(result.telemetry.assumption_source).toBe('strengthen_item_detail');
  });

  it('telemetry counts reflect the input arrays', () => {
    const items = [
      { id: 'a', label: 'A', detail: 'detail A', action_type: 'x' },
      { id: 'b', label: 'B', detail: 'detail B', action_type: 'x' },
    ];
    const analysisReady = {
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      bias_findings: [{ id: 'b1', category: 'x', severity: 'low', explanation: 'a clean finding' }],
    } as unknown as AnalysisReadyPayloadT;
    const signals = [{ type: 't', detail: 'a signal' }, { type: 't', detail: 'another signal' }, { type: 't', detail: 'third' }];
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      strengthenItems: items,
      analysisReady,
      coachingBiasSignals: signals,
    });
    expect(result.telemetry.strengthen_items_count).toBe(2);
    expect(result.telemetry.bias_findings_count).toBe(1);
    expect(result.telemetry.coaching_bias_signals_count).toBe(3);
  });
});

describe('buildPostDraftNarrative — coachingSummary whole-response replacement', () => {
  const baseGraph = makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]);

  it('replaces the whole response with coachingSummary when it passes the full-response gate', () => {
    // Summary intentionally does NOT use the builder's deterministic
    // opener "I've built a first decision model for …" — so any
    // accidental concat with builder output would be detectable.
    const summary =
      'The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare under stress.';
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
    });
    // Exact pass-through — no deterministic opener was prepended.
    expect(result.text).toBe(summary);
    expect(result.telemetry.assumption_source).toBe('coaching_summary');
    expect(result.telemetry.coaching_summary_present).toBe(true);
    expect(result.telemetry.coaching_summary_passed_gate).toBe(true);
    expect(result.telemetry.fallback_reason).toBeNull();
    // The five-sentence builder's lead never appears.
    expect(result.text).not.toContain("I've built a first decision model");
    assertCleanCopy(result.text);
  });

  it('ignores coachingSummary with premature recommendation and falls back to the five-sentence builder', () => {
    const summary =
      "I've built a first decision model. The options weigh delivery speed against risk. We recommend hiring a tech lead first given the timeline pressure. Next, run the analysis to validate the assumptions across all routes.";
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
    });
    // Five-sentence builder ran — text starts with our deterministic confirm.
    expect(result.text.startsWith("I've built a first decision model for")).toBe(true);
    // The premature recommendation does not appear anywhere in the output.
    expect(result.text.toLowerCase()).not.toContain('we recommend hiring');
    expect(result.telemetry.assumption_source).not.toBe('coaching_summary');
    expect(result.telemetry.coaching_summary_present).toBe(true);
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
    assertCleanCopy(result.text);
  });

  it('ignores coachingSummary missing a next-step token', () => {
    const summary =
      "I've built a decision model for the launch. The options weigh delivery speed against quality risk, with assumptions to consider. One assumption is whether the team can absorb extra overhead under load conditions in the coordination flow.";
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.text.startsWith("I've built a first decision model for")).toBe(true);
    expect(result.telemetry.coaching_summary_present).toBe(true);
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
  });

  it('ignores coachingSummary leaking an internal id prefix', () => {
    const summary =
      "I've built a first decision model for your launch. The routes weigh delivery against risk in fac_cost. Next, run the analysis to validate the assumptions across the comparison routes.";
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.text).not.toContain('fac_cost');
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
    expect(result.telemetry.assumption_source).not.toBe('coaching_summary');
    assertCleanCopy(result.text);
  });

  it('ignores empty / missing coachingSummary cleanly', () => {
    const r1 = buildPostDraftNarrative({ graph: baseGraph, coachingSummary: '' });
    const r2 = buildPostDraftNarrative({ graph: baseGraph, coachingSummary: null });
    const r3 = buildPostDraftNarrative({ graph: baseGraph, coachingSummary: '   \n\t  ' });
    for (const r of [r1, r2, r3]) {
      expect(r.telemetry.coaching_summary_present).toBe(false);
      expect(r.telemetry.coaching_summary_passed_gate).toBe(false);
      expect(r.telemetry.assumption_source).not.toBe('coaching_summary');
    }
  });

  it('treats coachingSummary as full-replace even when richer strengthen sources are present', () => {
    const summary =
      "I've built a first decision model for the launch. The routes weigh delivery speed against quality risk, and one assumption worth checking is whether the team can absorb extra coordination overhead. Next, run the analysis to compare them.";
    const items = [
      { id: 's', label: 'L', detail: 'detail to consider as an assumption worth checking later', action_type: 'x' },
    ];
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
      strengthenItems: items,
    });
    expect(result.text).toBe(summary);
    expect(result.telemetry.assumption_source).toBe('coaching_summary');
  });
});

// ───────────────────────────────────────────────────────────────────────
// validateUncertaintyDriver — explicit pass/fail fixtures.
// Pure heuristic; no graph context required.
// ───────────────────────────────────────────────────────────────────────

describe('validateUncertaintyDriver', () => {
  it.each([
    'extra developers may add coordination overhead',
    'the team can ramp up within the planning window',
    'a tech lead joins by end of month',
    'budget assumptions hold across both teams',
    'velocity drops as headcount grows',
    'recruitment timelines compress in Q3',
  ])('accepts well-formed declarative phrase: %s', (driver) => {
    expect(validateUncertaintyDriver(driver)).toBe(true);
  });

  it.each([
    // Interrogative-prefixed
    'how quickly a tech lead can ramp up',
    'what the actual budget will be',
    'why the timeline is so tight',
    'when the release ships',
    'where the bottleneck sits',
    'which option performs best',
    'who owns the launch',
    'is the team aligned',
    'are the costs locked',
    'does the budget cover hires',
    'do the timelines hold',
    'can we deliver on time',
    'should we hire externally',
    'would two engineers move faster',
    // Capitalised interrogative — case-insensitive check
    'What capacity we still have',
    // Trailing punctuation breaking sentence flow
    'the launch ships on time.',
    'the launch ships on time?',
    'the launch ships on time!',
    'the launch ships on time,',
    'the launch ships on time;',
    // Too short (< 5 chars after trim)
    'a',
    '   ',
    '',
    'no',
    // Too long (> 80 chars)
    'a'.repeat(81),
    'the team can absorb the extra workload across all eight engineering pods without slipping',
    // Forbidden jargon — exact substring matches
    'intervention values need review',
    'check the schema for drift',
    'the payload sets baseline incorrectly',
    'model_adjustment shifted the threshold',
    'a bias finding emerged from the review',
  ])('rejects malformed phrase: %s', (driver) => {
    expect(validateUncertaintyDriver(driver)).toBe(false);
  });

  it('rejects non-string inputs defensively', () => {
    // Argument typing forces these casts; the function still guards at
    // runtime so a stray `undefined` from a passthrough schema cannot
    // produce malformed copy.
    expect(validateUncertaintyDriver(undefined as unknown as string)).toBe(false);
    expect(validateUncertaintyDriver(null as unknown as string)).toBe(false);
    expect(validateUncertaintyDriver(123 as unknown as string)).toBe(false);
  });
});
