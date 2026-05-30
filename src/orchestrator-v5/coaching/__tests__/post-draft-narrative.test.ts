/**
 * Tests for `buildPostDraftNarrative` — the deterministic post-draft
 * coaching gated-hybrid composer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPostDraftNarrative,
  validateUncertaintyDriver,
} from '../post-draft-narrative.js';
import { sanitiseUserFacingText } from '../../compose/output-safety.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import type { GraphV3T, DraftCoachingWideningLog } from '../../../orchestrator/types.js';
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

  it('renders two options as an Options compared bullet section', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B]),
    });
    expect(text).toContain('Options compared');
    expect(text).toMatch(/^• Hire a tech lead$/m);
    expect(text).toMatch(/^• Hire two mid-weight developers$/m);
    assertCleanCopy(text);
  });

  it('renders three options as three bullets under Options compared', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, OPTION_C]),
    });
    expect(text).toContain('Options compared');
    expect(text).toMatch(/^• Hire a tech lead$/m);
    expect(text).toMatch(/^• Hire two mid-weight developers$/m);
    expect(text).toMatch(/^• Hire one tech lead plus one developer$/m);
    assertCleanCopy(text);
  });

  it('renders four options as four bullets under Options compared', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, OPTION_C, OPTION_D]),
    });
    expect(text).toContain('Options compared');
    expect(text).toMatch(/^• Continue with the current team$/m);
    assertCleanCopy(text);
  });

  it('collapses 5+ options to three named bullets plus a canvas-overflow bullet', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, OPTION_C, OPTION_D, OPTION_E]),
    });
    expect(text).toContain('Options compared');
    expect(text).toContain('Other variants are on the canvas.');
    // Only the first three labels should appear as bullets.
    expect(text).toMatch(/^• Hire a tech lead$/m);
    expect(text).toMatch(/^• Hire two mid-weight developers$/m);
    expect(text).toMatch(/^• Hire one tech lead plus one developer$/m);
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

  it('frames the trade-off as a Main trade-off bullet using the first two factor labels', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain('What the model is weighing');
    expect(text).toContain('Leadership quality');
    expect(text).toContain('Delivery capacity');
    expect(text).toMatch(/^• Main trade-off:.+balanced against/m);
    assertCleanCopy(text);
  });

  it('falls back to a Key consideration bullet when only one factor exists', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY]),
    });
    expect(text).toContain('What the model is weighing');
    expect(text).toMatch(/^• Key consideration: Leadership quality$/m);
    assertCleanCopy(text);
  });

  it('uses the first risk in a Key consideration bullet when no factors exist', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, RISK_RAMP]),
    });
    expect(text).toMatch(/^• Key consideration: the risk of New hires take time to ramp up$/m);
    assertCleanCopy(text);
  });

  it('renders an uncertainty driver as an Assumption to check bullet when present on a factor', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain('Assumption to check:');
    expect(text).toContain('extra developers may add coordination overhead');
    assertCleanCopy(text);
  });

  it('uses the deterministic generic Assumption to check bullet when only model_adjustments are present', () => {
    // The gated-hybrid composer drops `analysisReady.model_adjustments`
    // from the assumption-bullet source set: the LLM-authored coaching
    // surface is now richer (strengthenItems / coachingBiasSignals /
    // bias_findings) and model_adjustments are operational reasons, not
    // user-facing assumption signals. When they are the only available
    // signal, the builder falls through to the fixed-generic copy
    // (lifted into the bullet as `Assumption to check: whether …`).
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
      "Assumption to check: whether the model's key inputs reflect your real delivery constraints",
    );
    expect(text).not.toContain('per-month rate');
    assertCleanCopy(text);
  });

  it('falls back to a bias_finding explanation in the Assumption to check bullet when no other source is available', () => {
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
    expect(text).toContain('Assumption to check:');
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

  it('contains all four sections (confirm, options, weighing, next step) when data is rich', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toContain("I've built a first decision model");      // confirm
    expect(text).toContain('Options compared');                         // options section
    expect(text).toContain('What the model is weighing');               // weighing section
    expect(text).toMatch(/run the analysis/);                           // next step
  });

  it('renders confirm, options bullets and the next step even when no factors or risks exist', () => {
    // No factors, no risks, no analysisReady → no trade-off bullet. The
    // weighing block still carries the fixed-generic Assumption to
    // check bullet, so all four section slots are present.
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B]),
    });
    expect(text).toContain("I've built a first decision model");
    expect(text).toContain('Options compared');
    expect(text).toMatch(/^• Hire a tech lead$/m);
    expect(text).toMatch(/^• Hire two mid-weight developers$/m);
    expect(text).toContain('Assumption to check:');
    expect(text).toContain('run the analysis');
  });

  // ───── Grammar guard — fallback when an unsafe driver is the only signal
  it('substitutes the fixed-generic Assumption to check bullet when the only driver is question-shaped', () => {
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
      "Assumption to check: whether the model's key inputs reflect your real delivery constraints",
    );
    // The bad driver itself must not appear verbatim — the guard short-circuits.
    expect(text).not.toContain('how the team will absorb');
    assertCleanCopy(text);
  });

  it('substitutes the fixed-generic Assumption to check bullet when the only driver ends with punctuation', () => {
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
      "Assumption to check: whether the model's key inputs reflect your real delivery constraints",
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
      "Assumption to check: whether the model's key inputs reflect your real delivery constraints",
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
    expect(text).toContain('Options compared');
    // The labels appear as Options compared bullets exactly as supplied.
    expect(text).toMatch(/^• go_to_market$/m);
    expect(text).toMatch(/^• b2b_partnership$/m);
  });

  // ───── Sectioned-shape regressions
  it('renders the assistant text as multiple blank-line-separated blocks', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    // Confirm + Options compared + What the model is weighing + Next-step
    // = 4 blocks separated by blank lines. The single-option case
    // collapses Options compared to an inline sentence (3 blocks); this
    // fixture has two options so we expect 4.
    const blocks = text.split('\n\n');
    expect(blocks.length).toBe(4);
    expect(blocks[0]).toMatch(/^I've built a first decision model/);
    expect(blocks[1]).toMatch(/^Options compared\n• /);
    expect(blocks[2]).toMatch(/^What the model is weighing\n• /);
    expect(blocks[3]).toMatch(/^Next, run the analysis/);
  });

  it('uses • (U+2022) for bullets, not - or *', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B]),
    });
    expect(text).toMatch(/^• /m);
    // No markdown-style list characters at line start (would trip
    // MARKDOWN_LIST_REGEX in the coachingSummary gate; the deterministic
    // builder must not introduce them either).
    expect(text).not.toMatch(/^[-*+]\s/m);
    expect(text).not.toMatch(/^\d+\.\s/m);
    expect(text).not.toMatch(/^#+\s/m);
  });

  it('emits an inline single-option line (no bullets) when only one option exists', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A]),
    });
    expect(text).toContain('The model so far includes one route: Hire a tech lead.');
    // The single-option degrade has no bullet glyph on the options line.
    expect(text).not.toMatch(/^• Hire a tech lead$/m);
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

  it('uses strengthenItems[0].detail in the Assumption to check bullet when it passes the gate', () => {
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
    expect(result.text).toContain('Assumption to check:');
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
    expect(result.text).toContain('Assumption to check:');
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

  it('does not split decimal numbers when extracting the first sentence from a long strengthen detail', () => {
    // Previously the picker matched `^([^.!?]+)[.!?]` which truncated at
    // the first `.`, even decimal points — so `"$1.5M"` got chopped to
    // `"$1"`. The lookahead-for-whitespace fix in extractFirstSentence
    // skips decimal points and lands on the real sentence terminator.
    const items = [
      {
        id: 's-decimal',
        label: 'tighten ramp curve',
        // ~180-char detail with a decimal in the first sentence; too
        // long to pass the fragment cap whole, so the first-sentence
        // slice is exercised.
        detail:
          'the cost ramp passes $1.5M in the second year before stabilising. Stress-test the trajectory against a 20 percent overrun to surface what the comparison routes look like under pressure.',
        action_type: 'add_constraint',
      },
    ];
    const result = buildPostDraftNarrative({ graph: baseGraph, strengthenItems: items });
    expect(result.telemetry.assumption_source).toBe('strengthen_item_detail');
    // The whole first sentence (including the decimal) lands in the
    // assumption tail; the decimal is NOT truncated to "$1.".
    expect(result.text).toContain('the cost ramp passes $1.5M');
    expect(result.text).not.toMatch(/passes \$1\.\s/);
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

  it('falls through to the fixed-generic Assumption to check bullet when every source fails or is missing', () => {
    const items = [
      { id: 's7', label: 'recommend foo', detail: 'we recommend doing foo', action_type: 'x' },
    ];
    const result = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]),
      strengthenItems: items,
    });
    expect(result.text).toContain(
      "Assumption to check: whether the model's key inputs reflect your real delivery constraints",
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

  // ───── Round-3: coaching_summary_reject_reason telemetry
  it('telemetry surfaces coaching_summary_reject_reason when the summary is rejected', () => {
    const summary =
      "I've built a decision model with seven nodes and eight edges. The options weigh cost against risk. Next, run the analysis to validate.";
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.telemetry.coaching_summary_present).toBe(true);
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
    expect(result.telemetry.coaching_summary_reject_reason).toBe('graph_shape');
  });

  it('telemetry surfaces premature_recommendation as the reject reason', () => {
    const summary =
      "I've built a decision model. The best route here is to hire a tech lead. The options weigh cost against risk. Next, run the analysis.";
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.telemetry.coaching_summary_reject_reason).toBe('premature_recommendation');
  });

  it('telemetry surfaces internal_id as the reject reason for factor_* leaks', () => {
    const summary =
      "I've built a decision model. The options weigh delivery speed against risk in factor_delivery_cost. Next, run the analysis to compare the routes.";
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.telemetry.coaching_summary_reject_reason).toBe('internal_id');
  });

  it('telemetry reject_reason is null when the summary passes the gate', () => {
    const summary =
      'The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare.';
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.telemetry.coaching_summary_passed_gate).toBe(true);
    expect(result.telemetry.coaching_summary_reject_reason).toBeNull();
  });

  it('telemetry reject_reason is null when the summary is missing entirely', () => {
    const result = buildPostDraftNarrative({ graph: baseGraph, coachingSummary: null });
    expect(result.telemetry.coaching_summary_present).toBe(false);
    expect(result.telemetry.coaching_summary_reject_reason).toBeNull();
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

// ============================================================================
// Scope A — multi-point coaching + widening_log delivery
// ============================================================================

const TWO_FACTOR_GRAPH = makeGraph([
  GOAL_NODE,
  OPTION_A,
  OPTION_B,
  FACTOR_QUALITY,
  FACTOR_CAPACITY,
]);

function strengthen(id: string, label: string, detail: string) {
  return { id, label, detail, action_type: 'add_context' };
}
function biasSignal(type: string, detail: string) {
  return { type, detail };
}

/** Assert the rendered text survives BOTH egress guards and the clean-copy
 *  helper — proving new copy never trips success-claim / forbidden-phrase
 *  detection and leaks no IDs / internal labels. */
function assertPassesAllGuards(text: string): void {
  assertCleanCopy(text);
  expect(findForbiddenPhraseHit(text), `forbidden phrase in:\n${text}`).toBeNull();
  expect(findSuccessClaimHit(text), `success-claim phrase in:\n${text}`).toBeNull();
}

describe('buildPostDraftNarrative — widening_log brief completeness', () => {
  it('surfaces a calm advisory for a thin brief without leaking the enum or node IDs', () => {
    const wideningLog: DraftCoachingWideningLog = {
      // elements_added holds NODE IDs — must never be rendered.
      elements_added: ['fac_hidden_cost', 'risk_runway'],
      elements_considered_but_excluded: [],
      brief_completeness: 'thin',
    };
    const result = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH, wideningLog });
    expect(result.text).toContain('adding specifics will make the comparison more reliable');
    // The schema enum value is never emitted verbatim.
    expect(result.text).not.toMatch(/\bthin\b/);
    // elements_added node IDs never surface.
    expect(result.text).not.toContain('fac_hidden_cost');
    expect(result.text).not.toContain('risk_runway');
    assertPassesAllGuards(result.text);
    expect(result.telemetry.widening_log_present).toBe(true);
    expect(result.telemetry.brief_completeness).toBe('thin');
    expect(result.telemetry.brief_completeness_surfaced).toBe(true);
  });

  it('surfaces the partial-brief advisory line', () => {
    const wideningLog: DraftCoachingWideningLog = {
      elements_added: [],
      elements_considered_but_excluded: ['Regulatory pause unlikely in this horizon'],
      brief_completeness: 'partial',
    };
    const result = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH, wideningLog });
    expect(result.text).toContain('adding detail on the lighter areas would sharpen the comparison');
    expect(result.telemetry.brief_completeness_surfaced).toBe(true);
    assertPassesAllGuards(result.text);
  });

  it('renders no advisory block for a complete brief', () => {
    const wideningLog: DraftCoachingWideningLog = {
      elements_added: [],
      elements_considered_but_excluded: [],
      brief_completeness: 'complete',
    };
    const result = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH, wideningLog });
    expect(result.text).not.toContain('sharpen the comparison');
    expect(result.text).not.toContain('more reliable');
    expect(result.telemetry.widening_log_present).toBe(true);
    expect(result.telemetry.brief_completeness).toBe('complete');
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
  });

  it('is byte-identical to the no-widening output when widening_log is absent or null', () => {
    const without = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH });
    const withNull = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH, wideningLog: null });
    expect(without.text).toBe(withNull.text);
    expect(without.telemetry.widening_log_present).toBe(false);
    expect(without.telemetry.brief_completeness).toBeNull();
    expect(without.telemetry.brief_completeness_surfaced).toBe(false);
  });
});

describe('buildPostDraftNarrative — multiple coaching points', () => {
  it('surfaces a second "Worth a look" check bullet from a second strengthen item', () => {
    const strengthenItems = [
      strengthen(
        'strengthen_001',
        'Stress the synergy estimate',
        'The synergy figure is a single point value; widen it to a range to surface downside scenarios',
      ),
      strengthen(
        'strengthen_002',
        'Add a staged path',
        'A phased pilot is a real third path that the binary framing hides from the comparison',
      ),
    ];
    const result = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH, strengthenItems });
    expect(result.text).toContain('Assumption to check:');
    expect(result.text).toContain('Worth a look:');
    expect(result.telemetry.additional_checks_surfaced).toBe(1);
    expect(result.telemetry.additional_check_source).toBe('strengthen_item');
    assertPassesAllGuards(result.text);
  });

  it('caps the extra check bullets at one (no overload)', () => {
    const strengthenItems = [
      strengthen('s1', 'L1', 'First specific assumption worth testing against the real delivery plan'),
      strengthen('s2', 'L2', 'Second distinct assumption that also merits a closer look before analysis'),
      strengthen('s3', 'L3', 'Third separate point that should not appear because the cap is one extra item'),
    ];
    const result = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH, strengthenItems });
    const checkBullets = result.text.split('\n').filter((line) => line.includes('Worth a look:'));
    expect(checkBullets.length).toBe(1);
    expect(result.telemetry.additional_checks_surfaced).toBe(1);
  });

  it('draws the extra check from a bias signal when strengthen items are exhausted', () => {
    const strengthenItems = [
      strengthen('s1', 'L1', 'Only one strengthen item, which becomes the primary assumption bullet here'),
    ];
    const coachingBiasSignals = [
      biasSignal('narrow_framing', 'The brief frames the choice as binary when phased routes also exist'),
      biasSignal('overconfidence', 'The estimate is a single point with no stated uncertainty band'),
    ];
    const result = buildPostDraftNarrative({
      graph: TWO_FACTOR_GRAPH,
      strengthenItems,
      coachingBiasSignals,
    });
    expect(result.text).toContain('Worth a look:');
    expect(result.telemetry.additional_check_source).toBe('coaching_bias_signal');
    assertPassesAllGuards(result.text);
  });

  it('does not repeat the primary assumption text as the extra check (dedup)', () => {
    const strengthenItems = [
      strengthen('s1', 'L1', 'The single coaching point that becomes the assumption bullet only'),
    ];
    const result = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH, strengthenItems });
    const checkBullets = result.text.split('\n').filter((line) => line.includes('Worth a look:'));
    expect(checkBullets.length).toBe(0);
    expect(result.telemetry.additional_checks_surfaced).toBe(0);
    expect(result.telemetry.additional_check_source).toBeNull();
  });
});

describe('buildPostDraftNarrative — new copy passes the real egress guards', () => {
  it('protects commit-verb-leading coaching text behind bullet labels (success-claim guard)', () => {
    // Details that START with commit verbs (Set/Added/Updated) would trip
    // SUCCESS_CLAIM_PATTERNS at a line start; the bullet glyph + label prefix
    // must keep them off the line lead. This is the regression the user asked
    // for: prove the new bullets cannot accidentally read as a success claim.
    const strengthenItems = [
      strengthen('s1', 'Set a deadline', 'Set a firm go or no-go deadline before the full budget is committed'),
      strengthen('s2', 'Add a pilot', 'Added scope for a staged pilot path is worth weighing before deciding'),
    ];
    const coachingBiasSignals = [
      biasSignal('anchoring', 'Updated estimates may anchor on the first figure rather than the evidence'),
    ];
    const wideningLog: DraftCoachingWideningLog = {
      elements_added: ['fac_x'],
      elements_considered_but_excluded: ['Set aside FX exposure as immaterial at this scale'],
      brief_completeness: 'thin',
    };
    const result = buildPostDraftNarrative({
      graph: TWO_FACTOR_GRAPH,
      strengthenItems,
      coachingBiasSignals,
      wideningLog,
    });
    // The commit-verb text DID reach a bullet (proves the guard ran on real copy).
    expect(result.text).toMatch(/Worth a look:|Assumption to check:/);
    assertPassesAllGuards(result.text);
  });
});

describe('buildPostDraftNarrative — staging-fixture field-to-surface delivery (contract)', () => {
  // Real staging-shaped draft capture: 9-node graph + LLM coaching with a
  // canonical widening_log object (elements_added: ["risk_runway"],
  // brief_completeness: "partial"), two strengthen_items and two bias_signals.
  const fixture = JSON.parse(
    readFileSync(
      join(process.cwd(), 'tests/fixtures/cross-service/draft-graph.coaching-populated.staging.json'),
      'utf8',
    ),
  ) as {
    graph: GraphV3T;
    coaching: {
      summary: string;
      strengthen_items: ReadonlyArray<unknown>;
      bias_signals: ReadonlyArray<unknown>;
      widening_log: DraftCoachingWideningLog;
    };
  };

  it('surfaces structured coaching from a real staging draft into the rendered narrative, leaking no IDs', () => {
    const result = buildPostDraftNarrative({
      graph: fixture.graph,
      // Exercise the deterministic sectioned path (summary absent / rejected) —
      // that is where the structured widening / strengthen / bias fields surface.
      coachingSummary: null,
      strengthenItems: fixture.coaching.strengthen_items,
      coachingBiasSignals: fixture.coaching.bias_signals,
      wideningLog: fixture.coaching.widening_log,
    });

    // Brief-completeness advisory reached the rendered surface text.
    expect(result.text).toContain('adding detail on the lighter areas would sharpen the comparison');
    // A primary assumption AND a deduped second check bullet both reached the surface.
    expect(result.text).toContain('Assumption to check:');
    expect(result.text).toContain('Worth a look:');
    expect(result.telemetry.additional_checks_surfaced).toBe(1);
    expect(result.telemetry.brief_completeness_surfaced).toBe(true);

    // No raw IDs leak — elements_added node-id and strengthen item ids.
    expect(result.text).not.toContain('risk_runway');
    expect(result.text).not.toContain('strengthen_001');
    expect(result.text).not.toContain('strengthen_002');

    // Word budget respected and all egress guards clean on real data.
    expect(wordCount(result.text)).toBeLessThanOrEqual(140);
    assertPassesAllGuards(result.text);
  });
});
