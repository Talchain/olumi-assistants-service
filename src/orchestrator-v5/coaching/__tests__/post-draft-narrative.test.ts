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
  MODEL_VARIANCE_NOTE,
} from '../post-draft-narrative.js';
import { sanitiseUserFacingText } from '../../compose/output-safety.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { buildAnalysisReadyPayload } from '../../../cee/transforms/analysis-ready.js';
import { renderDirectionClarifications } from '../../../cee/compound-goal/direction-gate.js';
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
  // Most historical builder tests exercise the ready path. Production always
  // supplies the terminal analysis_ready payload on a persisted draft; make
  // that premise explicit here so a missing payload can be tested separately
  // instead of silently meaning "ready" in every fixture.
  const withExplicitReadiness = Object.prototype.hasOwnProperty.call(input, 'analysisReady')
    ? input
    : { ...input, analysisReady: { status: 'ready' as const } };
  return buildPostDraftNarrative(withExplicitReadiness).text;
}

function buildReadyNarrative(
  input: Parameters<typeof buildPostDraftNarrative>[0],
): ReturnType<typeof buildPostDraftNarrative> {
  return buildPostDraftNarrative({
    ...input,
    analysisReady: { ...input.analysisReady, status: 'ready' },
  });
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

  it('ends with a run-analysis nudge only when the typed readiness authority says ready', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
    });
    expect(text).toMatch(/run the analysis/);
    expect(text).toMatch(/\.$/);
  });

  it.each(['needs_user_mapping', 'needs_encoding', 'needs_user_input', 'blocked'] as const)(
    '%s never receives a Run instruction',
    (status) => {
      const text = buildPostDraftNarrative({
        graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY]),
        analysisReady: { status },
      }).text;
      expect(text).not.toMatch(/\brun(?:ning)?\b/i);
      expect(text).toMatch(/Next,/);
    },
  );

  it('missing readiness is unknown, never silently promoted to ready', () => {
    const text = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY]),
    }).text;
    expect(text).not.toMatch(/\brun(?:ning)?\b/i);
    expect(text).toContain('review the model');
  });

  it('names only the first typed blocker and leaves the value for the user to choose', () => {
    const text = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]),
      analysisReady: {
        status: 'needs_user_input',
        blockers: [
          {
            option_id: OPTION_A.id,
            option_label: OPTION_A.label,
            factor_id: FACTOR_QUALITY.id,
            factor_label: FACTOR_QUALITY.label,
            blocker_type: 'missing_value',
            suggested_action: 'add_value',
          },
          {
            option_id: OPTION_B.id,
            option_label: OPTION_B.label,
            factor_id: FACTOR_CAPACITY.id,
            factor_label: FACTOR_CAPACITY.label,
            blocker_type: 'missing_value',
            suggested_action: 'add_value',
          },
        ],
      },
    }).text;

    const blocks = text.split('\n\n');
    const nextStep = blocks[blocks.length - 1] ?? '';
    expect(nextStep).toBe(
      `Next, choose the missing effect value for "${OPTION_A.label}" on "${FACTOR_QUALITY.label}" so the comparison can be prepared.`,
    );
    expect(nextStep).toContain(OPTION_A.label);
    expect(nextStep).toContain(FACTOR_QUALITY.label);
    expect(nextStep).not.toContain(OPTION_B.label);
    expect(nextStep).not.toContain(FACTOR_CAPACITY.label);
    expect(nextStep).not.toMatch(/\b(?:0(?:\.\d+)?|1(?:\.0+)?)\b/);
    expect(nextStep).not.toMatch(/\brun(?:ning)?\b/i);
  });

  it('uses mapping recovery for a real producer-built unreachable factor blocker', () => {
    const optionId = 'opt_existing_route';
    const reachableFactorId = 'fac_reachable_capacity';
    const unreachableFactorId = 'fac_unreachable_budget';
    const producerGraph = {
      nodes: [
        { id: 'goal_real', kind: 'goal', label: 'Improve delivery confidence' },
        { id: optionId, kind: 'option', label: 'Strengthen the current team' },
        { id: reachableFactorId, kind: 'factor', label: 'Delivery capacity', category: 'controllable' },
        { id: unreachableFactorId, kind: 'factor', label: 'Budget flexibility', category: 'controllable' },
      ],
      edges: [{ from: optionId, to: reachableFactorId }],
    } as unknown as Parameters<typeof buildAnalysisReadyPayload>[2];
    const producerOptions = [{
      id: optionId,
      label: 'Strengthen the current team',
      status: 'ready',
      interventions: {
        [reachableFactorId]: {
          value: 0.6,
          source: 'brief_extraction',
          target_match: {
            node_id: reachableFactorId,
            match_type: 'exact_id',
            confidence: 'high',
          },
        },
      },
    }] as unknown as Parameters<typeof buildAnalysisReadyPayload>[0];

    const analysisReady = buildAnalysisReadyPayload(
      producerOptions,
      'goal_real',
      producerGraph,
      { requestId: 'post-draft-real-unreachable-factor' },
    );
    const unreachableBlocker = analysisReady.blockers?.find(
      (blocker) => blocker.factor_id === unreachableFactorId,
    );

    expect(analysisReady.status).toBe('needs_user_mapping');
    expect(analysisReady.options).toHaveLength(1);
    expect(analysisReady.options[0]?.status).toBe('ready');
    expect(unreachableBlocker).toEqual(expect.objectContaining({
      factor_id: unreachableFactorId,
      factor_label: 'Budget flexibility',
      blocker_type: 'missing_value',
      suggested_action: 'add_value',
    }));
    expect(unreachableBlocker?.option_id).toBeUndefined();

    const result = buildPostDraftNarrative({
      graph: producerGraph as unknown as GraphV3T,
      analysisReady,
    });
    const nextStep = result.text.split('\n\n').at(-1);

    expect(nextStep).toBe(
      'Next, configure the unresolved mapping by choosing which option changes which factor and by how much.',
    );
    expect(nextStep).not.toContain('missing effect value');
    expect(nextStep).not.toMatch(/\brun(?:ning)?\b/i);
  });

  it('blocked status cannot be overridden by an incidental precise blocker', () => {
    const result = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, FACTOR_QUALITY]),
      analysisReady: {
        status: 'blocked',
        blockers: [{
          option_id: OPTION_A.id,
          option_label: OPTION_A.label,
          factor_id: FACTOR_QUALITY.id,
          factor_label: FACTOR_QUALITY.label,
          blocker_type: 'missing_value',
          suggested_action: 'add_value',
        }],
      },
    });
    const nextStep = result.text.split('\n\n').at(-1);

    expect(nextStep).toBe('Next, resolve the model issue shown before comparing the options.');
    expect(nextStep).not.toContain('missing effect value');
    expect(nextStep).not.toContain(OPTION_A.label);
    expect(nextStep).not.toContain(FACTOR_QUALITY.label);
  });

  it.each([
    [
      'missing value without an option',
      {
        factor_id: FACTOR_QUALITY.id,
        factor_label: FACTOR_QUALITY.label,
        blocker_type: 'missing_value',
        suggested_action: 'add_value',
      },
      /missing effect value/i,
    ],
    [
      'ambiguous value without a factor',
      {
        option_id: OPTION_A.id,
        option_label: OPTION_A.label,
        blocker_type: 'ambiguous_value',
        suggested_action: 'confirm_value',
      },
      /confirm the effect value/i,
    ],
    [
      'missing connection without a factor',
      {
        option_id: OPTION_A.id,
        option_label: OPTION_A.label,
        blocker_type: 'missing_connection',
        suggested_action: 'add_edge',
      },
      /\bconnect\b/i,
    ],
  ])('falls back to named option configuration for %s', (_label, blocker, forbiddenAction) => {
    const result = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, FACTOR_QUALITY]),
      analysisReady: {
        status: 'needs_user_input',
        options: [{ id: OPTION_A.id, label: OPTION_A.label, status: 'needs_user_mapping' }],
        blockers: [blocker],
      },
    });
    const nextStep = result.text.split('\n\n').at(-1);

    expect(nextStep).toBe(
      `Next, configure "${OPTION_A.label}" by choosing which factor it changes and by how much.`,
    );
    expect(nextStep).not.toMatch(forbiddenAction);
  });

  it('needs_encoding ignores an incidental value blocker and asks for representation', () => {
    const result = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, FACTOR_QUALITY]),
      analysisReady: {
        status: 'needs_encoding',
        options: [{ id: OPTION_A.id, label: OPTION_A.label, status: 'needs_encoding' }],
        blockers: [{
          option_id: OPTION_A.id,
          option_label: OPTION_A.label,
          factor_id: FACTOR_QUALITY.id,
          factor_label: FACTOR_QUALITY.label,
          blocker_type: 'missing_value',
          suggested_action: 'add_value',
        }],
      },
    });
    const nextStep = result.text.split('\n\n').at(-1);

    expect(nextStep).toBe(
      `Next, choose how "${OPTION_A.label}" should be represented on the effect scale before comparing the options.`,
    );
    expect(nextStep).not.toContain('missing effect value');
  });

  it('needs_user_mapping ignores an incidental value blocker and names the non-ready option', () => {
    const result = buildPostDraftNarrative({
      graph: makeGraph([GOAL_NODE, OPTION_A, FACTOR_QUALITY]),
      analysisReady: {
        status: 'needs_user_mapping',
        options: [{ id: OPTION_A.id, label: OPTION_A.label, status: 'needs_user_mapping' }],
        blockers: [{
          option_id: OPTION_A.id,
          option_label: OPTION_A.label,
          factor_id: FACTOR_QUALITY.id,
          factor_label: FACTOR_QUALITY.label,
          blocker_type: 'missing_value',
          suggested_action: 'add_value',
        }],
      },
    });
    const nextStep = result.text.split('\n\n').at(-1);

    expect(nextStep).toBe(
      `Next, configure "${OPTION_A.label}" by choosing which factor it changes and by how much.`,
    );
    expect(nextStep).not.toContain('missing effect value');
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
    // Confirm + Options compared + What the model is weighing + the
    // model-variance note + Next-step = 5 blocks separated by blank lines. The
    // single-option case collapses Options compared to an inline sentence;
    // this fixture has two options.
    //
    // ⭐ THE ORDER IS THE ASSERTION, NOT JUST THE COUNT. The variance note is
    // second-to-last by design: the reply must not open with two hedges, and
    // the call to action must stay terminal. A change that merely inserted the
    // note SOMEWHERE would pass a count check and fail this.
    const blocks = text.split('\n\n');
    expect(blocks.length).toBe(5);
    expect(blocks[0]).toMatch(/^I've built a first decision model/);
    expect(blocks[1]).toMatch(/^Options compared\n• /);
    expect(blocks[2]).toMatch(/^What the model is weighing\n• /);
    expect(blocks[3]).toMatch(/^This is one of several models I could build/);
    expect(blocks[4]).toMatch(/^Next, run the analysis/);
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
    const result = buildReadyNarrative({ graph: baseGraph, strengthenItems: items });
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
    const result = buildReadyNarrative({ graph: baseGraph, strengthenItems: items });
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
    const result = buildReadyNarrative({ graph: baseGraph, strengthenItems: items });
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
    const result = buildReadyNarrative({ graph: baseGraph, strengthenItems: items });
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
    const result = buildReadyNarrative({
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
    const result = buildReadyNarrative({
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
    const result = buildReadyNarrative({ graph: baseGraph, strengthenItems: items });
    expect(result.text).not.toContain('fac_cost');
    expect(result.telemetry.assumption_source).not.toBe('strengthen_item_detail');
    assertCleanCopy(result.text);
  });

  it('rejects schema-term leaks from coachingBiasSignals (intervention)', () => {
    const signals = [
      { type: 'narrow_framing', detail: 'the intervention modelling looks shaky on the third route' },
    ];
    const result = buildReadyNarrative({ graph: baseGraph, coachingBiasSignals: signals });
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
    const result = buildReadyNarrative({ graph: baseGraph, strengthenItems: items });
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

describe('buildPostDraftNarrative — non-ready freeform exclusion', () => {
  const actionCopy = 'run the analysis before committing to a route';
  const baseGraph = makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]);
  const fixedAssumption =
    "Assumption to check: whether the model's key inputs reflect your real delivery constraints";
  const typedRecovery =
    `Next, choose the missing effect value for "${OPTION_A.label}" on "${FACTOR_QUALITY.label}" so the comparison can be prepared.`;
  const needsInputReadiness = {
    status: 'needs_user_input',
    blockers: [{
      option_id: OPTION_A.id,
      option_label: OPTION_A.label,
      factor_id: FACTOR_QUALITY.id,
      factor_label: FACTOR_QUALITY.label,
      blocker_type: 'missing_value',
      suggested_action: 'add_value',
    }],
  } as const;

  const sourceCases: ReadonlyArray<{
    name: string;
    input: Parameters<typeof buildPostDraftNarrative>[0];
  }> = [
    {
      name: 'strengthen detail',
      input: {
        graph: baseGraph,
        strengthenItems: [{
          id: 'freeform-detail',
          label: 'Check delivery assumptions',
          detail: actionCopy,
          action_type: 'add_context',
        }],
      },
    },
    {
      name: 'strengthen label',
      input: {
        graph: baseGraph,
        strengthenItems: [{
          id: 'freeform-label',
          label: actionCopy,
          detail: 'recommend option A',
          action_type: 'add_context',
        }],
      },
    },
    {
      name: 'bias finding explanation',
      input: {
        graph: baseGraph,
        analysisReady: {
          bias_findings: [{
            id: 'freeform-bias',
            category: 'action_copy',
            severity: 'medium',
            explanation: actionCopy,
          }],
        },
      },
    },
    {
      name: 'coaching bias signal detail',
      input: {
        graph: baseGraph,
        coachingBiasSignals: [{ type: 'action_copy', detail: actionCopy }],
      },
    },
    {
      name: 'uncertainty driver',
      input: {
        graph: makeGraph([
          GOAL_NODE,
          OPTION_A,
          OPTION_B,
          {
            ...FACTOR_QUALITY,
            observed_state: { value: 0.5, uncertainty_drivers: [actionCopy] },
          },
          FACTOR_CAPACITY,
        ]),
      },
    },
  ];

  it.each(sourceCases)('does not read $name bytes when typed readiness is non-ready', ({ input }) => {
    const result = buildPostDraftNarrative({
      ...input,
      analysisReady: {
        ...needsInputReadiness,
        ...input.analysisReady,
        status: 'needs_user_input',
        blockers: needsInputReadiness.blockers,
      },
    });

    expect(result.text.toLowerCase()).not.toContain(actionCopy);
    expect(result.text).not.toMatch(/\brun the analysis\b/i);
    expect(result.text).toContain(fixedAssumption);
    expect(result.text.split('\n\n').at(-1)).toBe(typedRecovery);
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
    expect(result.telemetry.fallback_reason).toBe('no_candidate');
    expect(result.telemetry.additional_checks_surfaced).toBe(0);
    expect(result.telemetry.additional_check_source).toBeNull();
    expect(result.telemetry.direction_clarifications_surfaced).toBe(0);
    expect(wordCount(result.text)).toBeLessThanOrEqual(140);
  });

  it.each([
    ['missing', { bias_findings: [{ explanation: actionCopy }] }],
    ['unknown', { status: 'future_readiness_state', bias_findings: [{ explanation: actionCopy }] }],
  ])('fails closed for a %s readiness status before reading freeform coaching', (_name, analysisReady) => {
    const result = buildPostDraftNarrative({ graph: baseGraph, analysisReady });

    expect(result.text.toLowerCase()).not.toContain(actionCopy);
    expect(result.text).toContain(fixedAssumption);
    expect(result.text.split('\n\n').at(-1)).toBe(
      'Next, review the model and fill any gaps before comparing the options.',
    );
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
    expect(result.telemetry.additional_checks_surfaced).toBe(0);
  });

  it.each([
    ['needs_user_mapping', 'Next, configure the unresolved mapping by choosing which option changes which factor and by how much.'],
    ['needs_encoding', 'Next, choose how the unresolved option should be represented on the effect scale.'],
    ['blocked', 'Next, resolve the model issue shown before comparing the options.'],
  ])('excludes freeform coaching for the %s recovery class', (status, expectedRecovery) => {
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      strengthenItems: [{ detail: actionCopy }],
      analysisReady: { status },
    });

    expect(result.text.toLowerCase()).not.toContain(actionCopy);
    expect(result.text).toContain(fixedAssumption);
    expect(result.text.split('\n\n').at(-1)).toBe(expectedRecovery);
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
    expect(result.telemetry.additional_checks_surfaced).toBe(0);
  });

  it('serves a producer-rendered direction clarification only when exact readiness is ready', () => {
    const [directionCard] = renderDirectionClarifications([{
      metric_text: 'customer satisfaction',
      amount_text: '85%',
      value: 0.85,
      unit: '%',
      reason: 'explicit_ambiguity',
      question: 'Should customer satisfaction stay above or below 85%?',
      options: ['At least 85%', 'At most 85%'],
      node_label: 'Customer satisfaction',
    }]);
    expect(directionCard).toBeDefined();

    const ready = buildReadyNarrative({ graph: baseGraph, strengthenItems: [directionCard] });
    expect(ready.text).toContain('Limit to confirm:');
    expect(ready.text).toContain('You mentioned 85% for customer satisfaction.');
    expect(ready.telemetry.direction_clarifications_surfaced).toBe(1);

    const nonReady = buildPostDraftNarrative({
      graph: baseGraph,
      strengthenItems: [directionCard],
      analysisReady: needsInputReadiness,
    });
    expect(nonReady.text).not.toContain('Limit to confirm:');
    expect(nonReady.text).not.toContain('85%');
    expect(nonReady.text.split('\n\n').at(-1)).toBe(typedRecovery);
    expect(nonReady.telemetry.direction_clarifications_surfaced).toBe(0);
  });
});

describe('buildPostDraftNarrative — coachingSummary whole-response replacement', () => {
  const baseGraph = makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]);

  const withReadySummary = (
    input: Omit<Parameters<typeof buildPostDraftNarrative>[0], 'analysisReady'>,
  ) => buildPostDraftNarrative({ ...input, analysisReady: { status: 'ready' } });

  const needsInputReadiness = {
    status: 'needs_user_input',
    blockers: [{
      option_id: OPTION_A.id,
      option_label: OPTION_A.label,
      factor_id: FACTOR_QUALITY.id,
      factor_label: FACTOR_QUALITY.label,
      blocker_type: 'missing_value',
      suggested_action: 'add_value',
    }],
  } as const;
  const acceptedSummaryMarker =
    'The review describes a trade-off between delivery speed and quality risk.';
  const typedRecovery =
    `Next, choose the missing effect value for "${OPTION_A.label}" on "${FACTOR_QUALITY.label}" so the comparison can be prepared.`;
  const gateAcceptedSummary = (modelAction: string) =>
    `${acceptedSummaryMarker} ${modelAction}`;
  const withNeedsInputSummary = (coachingSummary: string) => buildPostDraftNarrative({
    graph: baseGraph,
    coachingSummary,
    analysisReady: needsInputReadiness,
  });

  it('replaces the whole response with coachingSummary when it passes the full-response gate', () => {
    // Summary intentionally does NOT use the builder's deterministic
    // opener "I've built a first decision model for …" — so any
    // accidental concat with builder output would be detectable.
    const summary =
      'The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare under stress.';
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
      analysisReady: { status: 'ready' },
    });
    // Exact pass-through of the model's own bytes — no deterministic opener
    // was prepended. The undroppable model-variance note is APPENDED as its
    // own block (it rides every draft, on both builder paths); the summary
    // itself is still used verbatim, which is what this pin exists for.
    expect(result.text).toBe(`${summary}\n\n${MODEL_VARIANCE_NOTE}`);
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
      analysisReady: { status: 'ready' },
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
    const result = withReadySummary({
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
    const result = withReadySummary({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.text).not.toContain('fac_cost');
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
    expect(result.telemetry.assumption_source).not.toBe('coaching_summary');
    assertCleanCopy(result.text);
  });

  it('ignores empty / missing coachingSummary cleanly', () => {
    const r1 = withReadySummary({ graph: baseGraph, coachingSummary: '' });
    const r2 = withReadySummary({ graph: baseGraph, coachingSummary: null });
    const r3 = withReadySummary({ graph: baseGraph, coachingSummary: '   \n\t  ' });
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
    const result = withReadySummary({
      graph: baseGraph,
      coachingSummary: summary,
      strengthenItems: items,
    });
    expect(result.text).toBe(`${summary}\n\n${MODEL_VARIANCE_NOTE}`);
    expect(result.telemetry.assumption_source).toBe('coaching_summary');
  });

  // ───── Round-3: coaching_summary_reject_reason telemetry
  it('telemetry surfaces coaching_summary_reject_reason when the summary is rejected', () => {
    const summary =
      "I've built a decision model with seven nodes and eight edges. The options weigh cost against risk. Next, run the analysis to validate.";
    const result = withReadySummary({
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
    const result = withReadySummary({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.telemetry.coaching_summary_reject_reason).toBe('premature_recommendation');
  });

  it('telemetry surfaces internal_id as the reject reason for factor_* leaks', () => {
    const summary =
      "I've built a decision model. The options weigh delivery speed against risk in factor_delivery_cost. Next, run the analysis to compare the routes.";
    const result = withReadySummary({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.telemetry.coaching_summary_reject_reason).toBe('internal_id');
  });

  it('telemetry reject_reason is null when the summary passes the gate', () => {
    const summary =
      'The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare.';
    const result = withReadySummary({
      graph: baseGraph,
      coachingSummary: summary,
    });
    expect(result.telemetry.coaching_summary_passed_gate).toBe(true);
    expect(result.telemetry.coaching_summary_reject_reason).toBeNull();
  });

  it('falls back when an accepted ready summary exceeds the 140-word narrative budget', () => {
    const summary =
      `Options weigh risk ${Array.from({ length: 135 }, () => 'risk').join(' ')}. Next, review the model.`;
    expect(summary.length).toBeLessThanOrEqual(800);
    expect(wordCount(summary)).toBeGreaterThan(140);

    const result = withReadySummary({ graph: baseGraph, coachingSummary: summary });

    expect(result.text).not.toBe(summary);
    expect(result.text.startsWith("I've built a first decision model for")).toBe(true);
    expect(wordCount(result.text)).toBeLessThanOrEqual(140);
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
    expect(result.telemetry.coaching_summary_reject_reason).toBe('too_long');
  });

  it('telemetry reject_reason is null when the summary is missing entirely', () => {
    const result = withReadySummary({ graph: baseGraph, coachingSummary: null });
    expect(result.telemetry.coaching_summary_present).toBe(false);
    expect(result.telemetry.coaching_summary_reject_reason).toBeNull();
  });

  it.each([
    ['Start', 'Start the analysis to compare the options under stress.'],
    ['Begin', 'Begin the analysis to compare the options under stress.'],
    ['Compare', 'Compare the options to see which assumptions matter.'],
    ['Analyse', 'Analyse the options to see which route holds up.'],
    ['Run', 'Next, run the analysis to compare the options.'],
    ['Explore', 'Next, explore how the options compare under stress.'],
    ['Stress-test', 'Next, stress-test the options to see which route holds up.'],
    ['Inspect', 'Next, compare the routes and inspect what shifts the outcome.'],
    ['Validate', 'Validate the options against the delivery assumptions.'],
    ['Try', 'Try comparing the options under a tighter delivery constraint.'],
    ['Check', 'Check how the options respond to the quality risk.'],
    ['Review', 'Review the options before choosing a route.'],
    ['Next', 'Next, compare the routes under stress.'],
    ['Then', 'Then compare the routes under stress.'],
  ])('drops a gate-accepted %s summary wholesale when non-ready', (_label, modelAction) => {
    const summary = gateAcceptedSummary(modelAction);
    const result = withNeedsInputSummary(summary);

    expect(result.text).not.toContain(summary);
    expect(result.text).not.toContain(acceptedSummaryMarker);
    expect(result.text).not.toContain(modelAction);
    expect(result.text.split('\n\n').at(-1)).toBe(typedRecovery);
    expect(result.text.match(/\bNext,/g) ?? []).toHaveLength(1);
    expect(wordCount(result.text)).toBeLessThanOrEqual(140);
    expect(result.telemetry.assumption_source).not.toBe('coaching_summary');
    expect(result.telemetry.coaching_summary_present).toBe(true);
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
    expect(result.telemetry.coaching_summary_reject_reason).toBe('readiness_conflict');
  });

  it.each([
    [
      'first sentence',
      `Start the analysis to compare the options under stress. ${acceptedSummaryMarker}`,
    ],
    [
      'middle sentence',
      'The review describes a trade-off in delivery speed. Compare the options under stress. Quality risk remains uncertain.',
    ],
    [
      'final sentence',
      `${acceptedSummaryMarker} Begin the analysis to compare the options.`,
    ],
    [
      'quoted action',
      `${acceptedSummaryMarker} "Analyse the options to see which route holds up."`,
    ],
    [
      'newline action',
      `${acceptedSummaryMarker}\nTry comparing the options under stress.`,
    ],
    [
      'colon action',
      `${acceptedSummaryMarker} Next: validate which route holds up under pressure.`,
    ],
    [
      'em-dash action',
      `${acceptedSummaryMarker} Next — inspect which route holds up under pressure.`,
    ],
    [
      'one sentence',
      'The review describes a trade-off between delivery speed and quality risk; start the analysis to compare the options under stress.',
    ],
  ])('drops the whole accepted summary for the %s form', (_label, summary) => {
    const result = withNeedsInputSummary(summary);

    expect(result.text).not.toContain(summary);
    expect(result.text).not.toContain('The review describes');
    expect(result.text.split('\n\n').at(-1)).toBe(typedRecovery);
    expect(result.text.match(/\bNext,/g) ?? []).toHaveLength(1);
    expect(result.telemetry.assumption_source).not.toBe('coaching_summary');
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
    expect(result.telemetry.coaching_summary_reject_reason).toBe('readiness_conflict');
  });

  it.each([
    [
      'needs_user_mapping',
      { status: 'needs_user_mapping' },
      'Next, configure the unresolved mapping by choosing which option changes which factor and by how much.',
    ],
    [
      'needs_encoding',
      { status: 'needs_encoding' },
      'Next, choose how the unresolved option should be represented on the effect scale.',
    ],
    [
      'needs_user_input',
      { status: 'needs_user_input' },
      'Next, configure the unresolved option by choosing its factor and effect.',
    ],
    [
      'blocked',
      { status: 'blocked' },
      'Next, resolve the model issue shown before comparing the options.',
    ],
    [
      'missing',
      undefined,
      'Next, review the model and fill any gaps before comparing the options.',
    ],
  ])('never serves an accepted summary for %s readiness', (_label, analysisReady, expectedRecovery) => {
    const summary = gateAcceptedSummary('Start the analysis to compare the options under stress.');
    const result = buildPostDraftNarrative({ graph: baseGraph, coachingSummary: summary, analysisReady });

    expect(result.text).not.toContain(summary);
    expect(result.text).not.toContain(acceptedSummaryMarker);
    expect(result.text.split('\n\n').at(-1)).toBe(expectedRecovery);
    expect(result.text.match(/\bNext,/g) ?? []).toHaveLength(1);
    expect(result.telemetry.assumption_source).not.toBe('coaching_summary');
    expect(result.telemetry.coaching_summary_passed_gate).toBe(false);
    expect(result.telemetry.coaching_summary_reject_reason).toBe('readiness_conflict');
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

  it('surfaces NO advisory line for a partial brief (ROADMAP 2.972(d) — withdrawn 2026-08-13)', () => {
    // Was `surfaces the partial-brief advisory line`. The advisory said "Your
    // brief covered the main points", which is a claim about the user's input
    // that nothing derives — and it was witnessed on deployed staging being
    // paid to a 52-character brief the product had itself just called
    // insufficient. The rule and the witness live at COMPLETENESS_ADVISORY;
    // the behavioural pins live in
    // `src/cee/provenance/__tests__/brief-completeness-claim.test.ts`.
    const wideningLog: DraftCoachingWideningLog = {
      elements_added: [],
      elements_considered_but_excluded: ['Regulatory pause unlikely in this horizon'],
      brief_completeness: 'partial',
    };
    const result = buildPostDraftNarrative({ graph: TWO_FACTOR_GRAPH, wideningLog });
    expect(result.text).not.toContain('covered the main points');
    expect(result.text).not.toContain('sharpen the comparison');
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
    // The enum is still reported to ops, and still never emitted verbatim.
    expect(result.telemetry.brief_completeness).toBe('partial');
    expect(result.text).not.toMatch(/\bpartial\b/i);
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
    // The enum value is never emitted verbatim (the block is omitted entirely).
    expect(result.text).not.toMatch(/\bcomplete\b/i);
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
    const result = buildReadyNarrative({ graph: TWO_FACTOR_GRAPH, strengthenItems });
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
    const result = buildReadyNarrative({ graph: TWO_FACTOR_GRAPH, strengthenItems });
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
    const result = buildReadyNarrative({
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
    const result = buildReadyNarrative({ graph: TWO_FACTOR_GRAPH, strengthenItems });
    const checkBullets = result.text.split('\n').filter((line) => line.includes('Worth a look:'));
    expect(checkBullets.length).toBe(0);
    expect(result.telemetry.additional_checks_surfaced).toBe(0);
    expect(result.telemetry.additional_check_source).toBeNull();
  });

  // Documents accepted formatting (per review): the copy-quality gate accepts
  // numeric PROSE figures in coaching fragments (e.g. "$23.5M range") — these
  // are legitimate references to the user's own inputs, not leaked computed
  // values. The new "Worth a look" check path uses the SAME
  // gateAssumptionFragment as the primary assumption bullet, so it introduces
  // no new numeric exposure vs the existing path. Raw COMPUTED long-decimals
  // (sensitivity/probability values) are an ANALYSIS-copy concern handled by
  // the analysis-value formatters — they are not produced in LLM-authored
  // post-draft coaching prose.
  it('handles a numeric prose figure identically on the assumption and the extra check (parity, no new regression)', () => {
    const figure = 'Widen the 23.5M synergy estimate into a downside range before deciding';

    // As the primary assumption (single strengthen item).
    const asAssumption = buildReadyNarrative({
      graph: TWO_FACTOR_GRAPH,
      strengthenItems: [strengthen('s1', 'L1', figure)],
    });
    expect(asAssumption.text).toContain('Assumption to check:');
    expect(asAssumption.text).toContain('23.5M');

    // As the extra "Worth a look" check (a distinct item[0], the figure at [1]).
    const asCheck = buildReadyNarrative({
      graph: TWO_FACTOR_GRAPH,
      strengthenItems: [
        strengthen('s0', 'L0', 'Confirm the delivery timeline assumption holds under load'),
        strengthen('s1', 'L1', figure),
      ],
    });
    expect(asCheck.text).toContain('Worth a look:');
    expect(asCheck.text).toContain('23.5M');
    expect(asCheck.telemetry.additional_check_source).toBe('strengthen_item');
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
    const result = buildReadyNarrative({
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
    const result = buildReadyNarrative({
      graph: fixture.graph,
      // Exercise the deterministic sectioned path (summary absent / rejected) —
      // that is where the structured widening / strengthen / bias fields surface.
      coachingSummary: null,
      strengthenItems: fixture.coaching.strengthen_items,
      coachingBiasSignals: fixture.coaching.bias_signals,
      wideningLog: fixture.coaching.widening_log,
    });

    // ROADMAP 2.972(d): this fixture carries `brief_completeness: "partial"`,
    // whose advisory was WITHDRAWN on 2026-08-13 (it made a claim about the
    // user's brief that nothing derived). The delivery contract this test
    // exists for — strengthen_items and bias_signals reaching the surface —
    // is unchanged and asserted below; only the advisory is gone.
    expect(result.text).not.toContain('covered the main points');
    expect(result.telemetry.brief_completeness).toBe('partial');
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
    // A primary assumption AND a deduped second check bullet both reached the surface.
    expect(result.text).toContain('Assumption to check:');
    expect(result.text).toContain('Worth a look:');
    expect(result.telemetry.additional_checks_surfaced).toBe(1);

    // No raw IDs leak — elements_added node-id and strengthen item ids.
    expect(result.text).not.toContain('risk_runway');
    expect(result.text).not.toContain('strengthen_001');
    expect(result.text).not.toContain('strengthen_002');

    // ⭐⭐ THE COACHING AND THE VARIANCE NOTE BOTH SURVIVE ON REAL DATA, AND
    // THIS PAIR IS THE GUARD ON THAT.
    //
    // Measured on this fixture: 108 words of composed content, note 31, served
    // 139. In a first cut the note was charged to the ladder's 140-word budget
    // and the `Worth a look:` bullet asserted above was SHED — silently, under
    // a green suite, because nothing else here observes that bullet on real
    // data. The note is a fixed footer now and is spliced in AFTER the ladder
    // has measured, so it displaces nothing.
    //
    // ⚠ WHAT THIS TEST DOES *NOT* GUARD, DEMONSTRATED RATHER THAN ASSUMED. A
    // mutant putting the note back inside the budget leaves THIS test GREEN:
    // at 31 words the fixture still fits (108 + 31 = 139 <= 140), so only the
    // 35-word version ever shed the bullet here. The guards that DO bite that
    // regression are the content-heavy case below (120 words of content, which
    // no longer fits once the note is charged to the ladder) and
    // `tests/integration/orchestrator/route-v2-direction-clarification-served
    // .test.ts` ("does not CROWD OUT ordinary coaching"), both verified RED
    // under that mutant. An earlier version of this comment claimed the
    // coexistence pinned here was that guard; the mutant refuted it.
    expect(result.text).toContain(MODEL_VARIANCE_NOTE);
    expect(wordCount(result.text)).toBeLessThanOrEqual(140);
    assertPassesAllGuards(result.text);
  });
});

// ============================================================================
// RC4 proportionate remedies (2026-07-15 session RCA) — the em-dash STYLE
// offence must never cost the user the drafted coaching summary. Live
// evidence: turn 1 of the session generated a good coaching summary that the
// gate killed for a single em dash (`coaching_summary_passed_gate:false,
// reject_reason:"em_dash"` → strengthen_item_label fallback). The remedy is
// now an in-place deterministic rewrite; the summary SHIPS.
// This asserts through the real composition path (`buildPostDraftNarrative`
// is what draft-graph-dispatch renders as final user-visible text).
// ============================================================================

describe('RC4 — em-dash coaching summary survives with the dash rewritten', () => {
  const baseGraph = makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]);

  it('ships the LLM coaching summary with the em dash rewritten in place', () => {
    const summary =
      'Your decision model weighs delivery speed against hiring risk — the trade-off that matters most here. One assumption worth checking is the hiring timeline. Next, run the analysis to see how the options compare.';
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
      analysisReady: { status: 'ready' },
    });
    expect(result.telemetry.assumption_source).toBe('coaching_summary');
    expect(result.telemetry.coaching_summary_passed_gate).toBe(true);
    expect(result.telemetry.coaching_summary_reject_reason).toBeNull();
    expect(result.telemetry.coaching_summary_style_rewritten).toBe(true);
    expect(result.text).toBe(
      'Your decision model weighs delivery speed against hiring risk, the trade-off that matters most here. One assumption worth checking is the hiring timeline. Next, run the analysis to see how the options compare.' +
        `\n\n${MODEL_VARIANCE_NOTE}`,
    );
    expect(result.text).not.toMatch(/[–—]/);
    assertCleanCopy(result.text);
  });

  it('reports style_rewritten=false for a dash-free summary that passes', () => {
    const summary =
      'The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare.';
    const result = buildPostDraftNarrative({
      graph: baseGraph,
      coachingSummary: summary,
      analysisReady: { status: 'ready' },
    });
    expect(result.telemetry.assumption_source).toBe('coaching_summary');
    expect(result.telemetry.coaching_summary_style_rewritten).toBe(false);
    expect(result.text).toBe(`${summary}\n\n${MODEL_VARIANCE_NOTE}`);
  });
});

/**
 * ⭐⭐ COPY HONESTY WHEN NO DECISION COULD BE DERIVED FROM THE BRIEF.
 *
 * MEASURED DEFECT: three open strategic briefs — each explicitly disclaiming a
 * choice between fixed options — were each organised as 1 `decision` node +
 * 3-5 `option` nodes, and the narrative asserted "I've built a first decision
 * model from your brief" above an "Options compared" block. The MODEL SHAPE is
 * an architectural constraint (`DRAFT_RECORD_STATED_KINDS` has no vocabulary
 * for "a thing under consideration" other than `option`, and a decision-free
 * model is not expressible — `graph-validator.ts:348-382` raises
 * `MISSING_DECISION` at error severity). That is NOT fixed here. What is fixed
 * is the CLAIM ABOUT the model, which was false.
 *
 * ⚠ THE GATE IS `node.label_authored`, NOT `provenance.label_authored`.
 * The projector writes `provenance.label_authored` as an OBJECT field
 * (`projector.ts:3255-3262`), but `NodeV3.provenance` is a bare STRING ENUM
 * (`schemas/cee-v3.ts:255`) and `NodeV3` STRIPS undeclared keys. The object is
 * flattened by `projectNodeProvenance` (`transforms/schema-v3.ts:1183`), which
 * LIFTS the flag to node level, where `NodeV3` declares it
 * (`cee-v3.ts:284`) and it survives to this builder. Reading
 * `provenance.label_authored` here would read a property off a string and get
 * `undefined` on EVERY draft — the gate would fire on all of them, converting
 * "always decides" into "always hedges". Two same-named flags at two levels;
 * the pin below is what stops that distinction rotting.
 */
describe('provisional-decision framing (open brief)', () => {
  const DECISION_UNAUTHORED = { id: 'd1', kind: 'decision' as const, label: 'Decision' };
  const DECISION_AUTHORED = {
    id: 'd1',
    kind: 'decision' as const,
    label: 'Build our own fleet or partner with third-party couriers',
    label_authored: true,
  };

  /**
   * PRECONDITION PIN (trap 13b). This gate is only meaningful if the producer
   * actually delivers `label_authored` AT NODE LEVEL. If a refactor moved it
   * back under `provenance`, or `NodeV3` stopped declaring it, every gate below
   * would silently read `undefined` and the provisional framing would ship on
   * every draft — with no red anywhere. This asserts the lift, in BOTH
   * directions, so the discrimination itself is pinned rather than assumed.
   */
  it('PIN: the v3 producer lifts provenance.label_authored to node level', async () => {
    const { projectGraphAndOptionsToV3 } = await import('../../../cee/transforms/schema-v3.js');
    const decisionRecord = (authored: boolean) => ({
      id: 'dec1',
      kind: 'decision',
      label: authored ? 'Build our own fleet or partner with couriers' : 'Decision',
      provenance: {
        provenance_class: 'projector_structural',
        source_quote: 'structural',
        ...(authored ? { label_authored: true } : {}),
      },
    });
    const project = (authored: boolean) => {
      const out = projectGraphAndOptionsToV3(
        { nodes: [decisionRecord(authored)], edges: [] } as never,
        {},
      ) as { graph: { nodes: ReadonlyArray<Record<string, unknown>> } };
      return out.graph.nodes.find((n) => n.kind === 'decision');
    };

    // Authored: the flag arrives at NODE level, and `provenance` has collapsed
    // to the bare string enum — the exact shape this builder reads.
    const authored = project(true);
    expect(authored?.label_authored).toBe(true);
    expect(typeof authored?.provenance).toBe('string');

    // Contrast control: unauthored produces NO flag, so absence is a real
    // signal and not merely a field this probe cannot see.
    expect(project(false)?.label_authored).toBeUndefined();
  });

  it('reframes the opener when the projector could not author a decision label', () => {
    const text = textOf({
      graph: makeGraph([
        DECISION_UNAUTHORED,
        OPTION_A,
        OPTION_B,
        OPTION_C,
        FACTOR_QUALITY,
      ] as unknown as GraphV3T['nodes']),
    });
    // The false claim is gone...
    expect(text).not.toContain("I've built a first decision model");
    // ...and replaced by one that is true of what actually happened: a model
    // exists and THIS BUILDER framed its decision rather than lifting one from
    // the brief.
    //
    // ⚠ THE MARKER MOVED, THE GATE DID NOT. This assertion used to read
    // `toContain("I couldn't pin down a single decision")`. That sentence made
    // a claim about the USER'S BRIEF and fired on 7 of 9 drafts including
    // briefs that plainly posed a decision (measured on the deployed build).
    // What this test pins is unchanged: the provisional gate fires here, and
    // the opener says so. Only the subject of the sentence changed.
    expect(text).toContain('framed the decision provisionally');
    expect(text).toContain('provisional');
    assertCleanCopy(text);
  });

  it('retitles the options block, and still shows the options', () => {
    const text = textOf({
      graph: makeGraph([
        DECISION_UNAUTHORED,
        OPTION_A,
        OPTION_B,
        OPTION_C,
      ] as unknown as GraphV3T['nodes']),
    });
    // "compared" asserts a comparison of alternatives the user chose between.
    expect(text).not.toContain('Options compared');
    expect(text).toContain('Options on the canvas');
    // ⚠ The options are NOT removed. They are on the user's canvas; pretending
    // otherwise would be a second lie, not a fix for the first.
    expect(text).toContain('Hire a tech lead');
    expect(text).toContain('Hire two mid-weight developers');
  });

  /**
   * ⭐ THE OVER-CORRECTION CONTROL. Without this, an "honest" fix that simply
   * degrades EVERY draft to the hedged wording is indistinguishable from a
   * correct one. A genuine decision must be completely untouched.
   */
  it('CONTROL: a genuinely authored decision keeps the existing wording', () => {
    const text = textOf({
      graph: makeGraph([
        DECISION_AUTHORED,
        GOAL_NODE,
        OPTION_A,
        OPTION_B,
        OPTION_C,
        FACTOR_QUALITY,
      ] as unknown as GraphV3T['nodes']),
    });
    expect(text.startsWith("I've built a first decision model")).toBe(true);
    expect(text).toContain('Options compared');
    expect(text).not.toContain('framed the decision provisionally');
    expect(text).not.toContain('Options on the canvas');
    assertCleanCopy(text);
  });

  /**
   * ⭐⭐ THE CONTROL THIS LANE ORIGINALLY LACKED, AND THE ONE THAT MATTERED.
   *
   * The first cut gated on `label_authored` ALONE. That is not the producer's
   * signature for "could not derive a decision" — it is merely the absence of a
   * RESPONSE-ONLY field, which a hand-built, user-edited or round-tripped graph
   * will also lack while carrying a perfectly good decision. On such a graph the
   * "honest" fix told the user *"I couldn't pin down a single decision in your
   * brief"* about a decision node reading "Launch product?" — swapping one false
   * claim for another.
   *
   * It was caught by an existing integration fixture, NOT by this file: the
   * over-correction control below sets `label_authored: true` explicitly, so it
   * was structurally incapable of observing this class. A control that pins only
   * the shape you imagined is a guard agreeing with itself.
   */
  it('CONTROL: an unflagged decision with a REAL label is not hedged', () => {
    const text = textOf({
      graph: makeGraph([
        // No `label_authored` — and a label the projector would never emit as a
        // fallback. This is a genuine decision, so nothing may be hedged.
        { id: 'd1', kind: 'decision', label: 'Launch product?' },
        GOAL_NODE,
        OPTION_A,
        OPTION_B,
      ] as unknown as GraphV3T['nodes']),
    });
    expect(text.startsWith("I've built a first decision model")).toBe(true);
    expect(text).not.toContain('framed the decision provisionally');
    expect(text).toContain('Options compared');
  });

  /**
   * DERIVED PIN AGAINST THE MIRROR (trap 12). `UNAUTHORED_DECISION_LABEL` is a
   * copy of the producer's fallback literal. A copy that nothing checks is the
   * hand-maintained mirror this estate keeps paying for — so ask the producer
   * itself. If `deriveDecisionLabel` ever returns a different placeholder, this
   * REDs instead of the gate silently never firing again.
   */
  it('PIN: the gate\'s placeholder matches what deriveDecisionLabel emits', async () => {
    const { deriveDecisionLabel } = await import(
      '../../../cee/draft/records/objective-label.js'
    );
    const declined = deriveDecisionLabel({
      brief: 'Our burn rate is too high and the team is stretched thin.',
      goalQuotes: [],
    });
    // Contrast control: a brief that DOES pose a choice must author a label,
    // otherwise this pin would pass against a producer that authored nothing.
    const authored = deriveDecisionLabel({
      brief: 'We are deciding whether to build our own fleet or partner with third-party couriers.',
      goalQuotes: [],
    });
    expect(authored.authored).toBe(true);

    expect(declined.authored).toBe(false);
    expect(declined.label).toBe('Decision');
  });

  /**
   * ⭐⭐ THE KNOWN-DROPPED SET, PINNED AS AN EXACT SET OVER A NAMED CORPUS.
   *
   * This lane's gate reads the producer's "I declined to author" signature. It
   * therefore cannot see a brief whose disclaimer or exploratory framing is
   * itself run through the sentence-stripper into a confident label: those set
   * `label_authored` AND carry a non-placeholder label, so they are
   * indistinguishable here BY CONSTRUCTION. The honest fix is upstream, in
   * `deriveDecisionLabel` (`objective-label.ts`), and is deliberately not
   * attempted here.
   *
   * ⚠ WHY A SET AND NOT A CASE. The first version of this pin held ONE member
   * (the negated disclaimer) and asserted it in prose. An independent 36-brief
   * corpus then found a SECOND member the pin was structurally unable to see,
   * because it arrives by a DIFFERENT MECHANISM: not a negation at all, but the
   * ordinary exploratory frame `"figuring out "` (`objective-label.ts:158`,
   * `DELIBERATION_FRAMES`). A pin shaped around "negated disclaimers" could
   * never have caught it. So the pin is now a SET over a corpus, asserted in
   * BOTH directions — it REDs if the set SHRINKS (the producer was fixed: delete
   * the member, the builder starts catching it for free) and if it GROWS (the
   * extraction gap widened). A gap recorded in the suite is honest; a gap
   * invisible to it is how this shipped green in the first place.
   *
   * ⚠ SCOPE OF THE CLAIM. `OPEN_BRIEF_CORPUS` is this file's corpus, not the
   * world: "exactly these" is exact OVER THIS CORPUS. Measured 29 Aug 2026 at
   * the producer. The sibling frames `"working out "` / `"work out "` /
   * `"considering "` in the same list produce the same shape (measured:
   * `"We are working out where our margin actually goes each month."` ->
   * `{ authored: true, label: "Where Margin Actually Goes Each Month" }`); they
   * are recorded with the extraction row rather than asserted here, because
   * whether a `considering `-framed brief poses a decision is a judgement this
   * lane is not entitled to mint.
   */
  const OPEN_BRIEF_CORPUS: ReadonlyArray<{ readonly name: string; readonly brief: string }> = [
    { name: 'negated-disclaimer', brief: 'We are not choosing between fixed options yet.' },
    {
      name: 'exploratory-figuring-out',
      brief: 'We are figuring out what our customers actually value most about the service.',
    },
    { name: 'burn-rate', brief: 'Our burn rate is too high and the team is stretched thin.' },
    { name: 'churn-symptom', brief: 'Churn has climbed for three quarters and nobody agrees on why.' },
    { name: 'morale', brief: 'Morale in the support team has fallen and recruitment is slow.' },
    {
      name: 'no-shortlist',
      brief: 'We have no shortlist yet; we just want to understand the market better.',
    },
  ];

  /** The members of `OPEN_BRIEF_CORPUS` this builder CANNOT catch, and the exact
   *  label each one authors. Both were established by an outside corpus, never
   *  from this lane's head (trap 22). */
  const KNOWN_DROPPED: ReadonlyArray<{ readonly name: string; readonly label: string }> = [
    { name: 'negated-disclaimer', label: 'Choose Between Fixed Options Yet' },
    {
      name: 'exploratory-figuring-out',
      label: 'What Customers Actually Value Most About the Service',
    },
  ];

  it('KNOWN-DROPPED: exactly these open briefs still author a decision label', async () => {
    const { deriveDecisionLabel } = await import(
      '../../../cee/draft/records/objective-label.js'
    );
    const derived = OPEN_BRIEF_CORPUS.map((c) => ({
      name: c.name,
      ...deriveDecisionLabel({ brief: c.brief, goalQuotes: [] }),
    }));

    // POSITIVE CONTROL (trap 13). An "exactly these" assertion would also hold
    // over a probe that authored NOTHING, or that authored EVERYTHING — so
    // assert the corpus still exhibits both classes before believing the set.
    expect(derived.some((d) => d.authored)).toBe(true);
    expect(derived.some((d) => !d.authored)).toBe(true);

    // (a) SHRINK direction — every pinned member is still dropped, with the
    // exact label it authors.
    for (const member of KNOWN_DROPPED) {
      const observed = derived.find((d) => d.name === member.name);
      expect(observed, `corpus member missing: ${member.name}`).toBeDefined();
      expect(observed?.authored, `${member.name}: expected still-dropped`).toBe(true);
      expect(observed?.label, `${member.name}: label drifted`).toBe(member.label);
    }

    // (b) GROW direction — and nothing ELSE in the corpus is dropped.
    const droppedNow = derived.filter((d) => d.authored).map((d) => d.name).sort();
    expect(droppedNow).toEqual(KNOWN_DROPPED.map((m) => m.name).sort());

    // (c) The caught members are caught for the producer's actual reason — the
    // placeholder literal this builder's gate reads — not incidentally.
    for (const d of derived.filter((x) => !x.authored)) {
      expect(d.label, `${d.name}: expected the placeholder`).toBe('Decision');
    }
  });

  it('KNOWN-DROPPED: each dropped member still ships the un-hedged claim here', async () => {
    const { deriveDecisionLabel } = await import(
      '../../../cee/draft/records/objective-label.js'
    );
    const briefOf = (name: string): string => {
      const entry = OPEN_BRIEF_CORPUS.find((c) => c.name === name);
      if (entry === undefined) throw new Error(`no corpus member named ${name}`);
      return entry.brief;
    };

    for (const member of KNOWN_DROPPED) {
      const derived = deriveDecisionLabel({ brief: briefOf(member.name), goalQuotes: [] });
      const text = textOf({
        graph: makeGraph([
          { id: 'd1', kind: 'decision', label: derived.label, label_authored: derived.authored },
          OPTION_A,
          OPTION_B,
        ] as unknown as GraphV3T['nodes']),
      });
      expect(text.startsWith("I've built a first decision model"), member.name).toBe(true);
      expect(text, member.name).not.toContain('framed the decision provisionally');
    }

    // CONTRAST CONTROL: a CAUGHT member takes the hedged path through the very
    // same assembly, so the loop above is observing the gap and not simply
    // failing to reach the gate.
    const caught = deriveDecisionLabel({ brief: briefOf('burn-rate'), goalQuotes: [] });
    const caughtText = textOf({
      graph: makeGraph([
        { id: 'd1', kind: 'decision', label: caught.label, label_authored: caught.authored },
        OPTION_A,
        OPTION_B,
      ] as unknown as GraphV3T['nodes']),
    });
    expect(caughtText).toContain('framed the decision provisionally');
  });

  /**
   * The gate is DECISION-NODE-SCOPED, not "absence of a flag". A graph with no
   * decision node at all must not claim a decision was framed provisionally —
   * nothing framed one. This also keeps every pre-existing fixture in this file
   * (none of which carries a decision node) on its original wording.
   */
  it('CONTROL: a graph with no decision node is unaffected', () => {
    const text = textOf({
      graph: makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY]),
    });
    expect(text.startsWith("I've built a first decision model")).toBe(true);
    expect(text).not.toContain('framed the decision provisionally');
  });

  /**
   * ⭐ THE RESIDUAL COMPARISON CLAIM, FOUR LINES BELOW THE HEADING THIS PR
   * CHANGED AWAY FROM `Options compared`.
   *
   * `Options compared` was changed because it asserts a comparison of
   * alternatives the user chose between. The next-step nudge assembled
   * immediately below it (`assembleSectionedNarrative` appends
   * `input.nextStep` last) shipped, verbatim on the same provisional path:
   *
   *   "Next, run the analysis to see how the options compare ..."
   *
   * Weaker — forward-looking rather than past-tense — but the same message on
   * the same path, and ungated. It is now selected by the SAME
   * `provisionalDecision` signal, so the two cannot disagree.
   */
  it('the provisional path drops the comparison promise from the next step too', () => {
    const text = textOf({
      graph: makeGraph([
        DECISION_UNAUTHORED,
        OPTION_A,
        OPTION_B,
        OPTION_C,
      ] as unknown as GraphV3T['nodes']),
    });
    // Precondition pinned IN-TEST (trap 13b): this fixture must actually be on
    // the provisional path, or the assertion below passes for the wrong reason.
    expect(text).toContain('Options on the canvas');

    expect(text).not.toContain('the options compare');
    expect(text).toContain(
      'Next, run the analysis to see how the options on the canvas hold up and what could shift the outcome.',
    );
    assertCleanCopy(text);
  });

  /**
   * ⭐ THE OVER-CORRECTION CONTROL FOR THE NUDGE. Without it, a change that
   * simply retitled the nudge for EVERY draft would be indistinguishable from a
   * gated one — and the historic reply corpus
   * (`compose/__tests__/fixtures/live-assistant-text-corpus-2026-08-17/`)
   * records the old sentence on genuine decisions, where it is true.
   */
  it('CONTROL: a genuinely authored decision keeps the original next step', () => {
    const text = textOf({
      graph: makeGraph([
        DECISION_AUTHORED,
        GOAL_NODE,
        OPTION_A,
        OPTION_B,
        OPTION_C,
      ] as unknown as GraphV3T['nodes']),
    });
    expect(text).toContain('Options compared');
    expect(text).toContain(
      'Next, run the analysis to see how the options compare and what could shift the outcome.',
    );
  });

  /**
   * The selector is bound to the recovery KIND (`run`), not to a string
   * predicate another branch could satisfy (trap 19). A non-ready readiness on
   * the provisional path must keep its own recovery copy untouched.
   *
   * ⚠ RECORDED, NOT FIXED: the `blocked` and `review_model` branches carry the
   * same presupposition in their own words ("before comparing the options",
   * `readiness-recovery.ts`). They are outside this lane's scope and are rowed
   * with the extraction gap.
   */
  it('CONTROL: the provisional signal only reaches the run nudge', async () => {
    const { buildReadinessNextStep } = await import('../readiness-recovery.js');
    const blocked = { status: 'blocked' as const };
    expect(buildReadinessNextStep(blocked, [], { provisionalDecision: true })).toBe(
      buildReadinessNextStep(blocked, [], { provisionalDecision: false }),
    );
    // Contrast control: the run branch DOES differ, so the equality above is a
    // real scoping result and not a selector that never fires.
    const ready = { status: 'ready' as const };
    expect(buildReadinessNextStep(ready, [], { provisionalDecision: true })).not.toBe(
      buildReadinessNextStep(ready, [], { provisionalDecision: false }),
    );
  });

  /**
   * ⭐ PIN FOR THE `label_authored !== true` CONJUNCT, WHICH WAS UNPINNED.
   *
   * An adversarial review dropped that conjunct from `hasProvisionalDecision`
   * and 164/164 stayed GREEN. It then DEMONSTRATED — not asserted — that the
   * mutant is equivalent on today's producer (48 inputs; contrast control saw
   * 13 authored labels and 0 carrying `label === "Decision"`), so there is no
   * live defect. But the docstring above calls that conjunct load-bearing and
   * NOTHING would RED if the producer ever authored the literal "Decision", or
   * if another writer set the flag on a placeholder label. A guard that cannot
   * fail is not a guard.
   *
   * This fixture is the exact shape the two conjuncts disagree about — the
   * placeholder label WITH the authored flag — so only the flag can decide it.
   * Its discriminating twin is the "unflagged decision with a REAL label"
   * control above, which the OTHER conjunct decides.
   */
  it('PIN: an authored decision is not hedged even when its label reads "Decision"', () => {
    const text = textOf({
      graph: makeGraph([
        { id: 'd1', kind: 'decision', label: 'Decision', label_authored: true },
        GOAL_NODE,
        OPTION_A,
        OPTION_B,
      ] as unknown as GraphV3T['nodes']),
    });
    expect(text.startsWith("I've built a first decision model")).toBe(true);
    expect(text).not.toContain('framed the decision provisionally');
    expect(text).toContain('Options compared');
  });
});

/**
 * ⭐⭐ THE OPENER MADE A CLAIM ABOUT THE USER'S BRIEF, AND IT WAS THE FIRST
 * THING ANYONE READ.
 *
 * ── THE MEASURED DEFECT (16 signed-in runs / 84 turns, deployed build) ──────
 *   "I couldn't pin down a single decision in your brief, so I've framed one
 *    provisionally."
 *
 * fired on **7 of 9 drafts**, including briefs that literally open
 * *"Should we A, or B, or C?"* — and the product then built a perfectly good
 * model of that decision, which makes the sentence self-evidently wrong to the
 * one person qualified to judge it.
 *
 * ── WHY THE FIX IS COPY AND NOT CLASSIFICATION ─────────────────────────────
 * The sentence is TRUE of our extractor: `deriveDecisionLabel` did decline. It
 * is FALSE as the user reads it, because it is phrased as a finding about
 * THEIR brief. Widening the extractor is the opposite-direction harm of the
 * change that stopped the product falsely CLAIMING a decision on briefs posing
 * none (18/18 → 1/18 on an independent corpus); that win is not for sale, and
 * the predicate's breadth is rowed (ROADMAP 2.1341) precisely because "one
 * more rule" on it oscillates.
 *
 * So the opener now describes **what this builder did** — it framed the
 * decision itself, provisionally — and invites correction. That claim is
 * verifiable HERE, in this function, on every input, and it cannot be false in
 * either direction:
 *   · brief posed a decision and extraction declined → we framed it, so true;
 *   · brief posed none                              → we framed it, so true.
 *
 * ⚠ WHAT THE OLD SENTENCE GOT RIGHT AND THE NEW ONE MUST KEEP: it never said
 * "your brief contained no decision". Neither does this. The failure was not
 * that the claim was negative about the brief in form — it is that a sentence
 * whose subject is the brief READS as a verdict on the brief whatever its
 * modality. The fix is to change the subject, not to soften the verb.
 */
describe('the provisional opener claims only what the product did', () => {
  /**
   * Corpus sourced from OUTSIDE this lane's head — the four brief shapes named
   * in the measured defect report, plus three genuinely open briefs. Each is
   * run through the REAL producer (`deriveDecisionLabel`) rather than through a
   * hand-built node, because a fixture I wrote myself is not evidence about
   * what the producer emits (trap 16-inverse).
   */
  const BRIEF_CORPUS: ReadonlyArray<{ readonly name: string; readonly brief: string }> = [
    {
      name: 'explicit-should-we',
      brief: 'Should we build our own delivery fleet, partner with third-party couriers, or do nothing this year?',
    },
    {
      name: 'weighing-whether',
      brief: "We're weighing whether to open a second warehouse in Leeds or to expand the one we already have.",
    },
    {
      name: 'board-recommendation',
      brief: 'The board wants a recommendation on whether to acquire the smaller competitor or to build the capability in house.',
    },
    {
      name: 'or-shaped',
      brief: 'Do we raise prices by ten percent, cut the free tier, or hold everything as it is until the new year?',
    },
    { name: 'burn-rate', brief: 'Our burn rate is too high and the team is stretched thin.' },
    { name: 'churn-symptom', brief: 'Churn has climbed for three quarters and nobody agrees on why.' },
    {
      name: 'no-shortlist',
      brief: 'We have no shortlist yet; we just want to understand the market better.',
    },
  ];

  /**
   * Phrases whose SUBJECT is the user's brief rather than this product. Each
   * one asserts something this builder cannot see and the user can — which is
   * the whole defect. Absence of every one of them is the invariant, written
   * against the spec ("say only what the product did"), not against the single
   * sentence that happened to be witnessed.
   */
  const CLAIMS_ABOUT_THE_BRIEF: readonly string[] = [
    "couldn't pin down",
    'could not pin down',
    "didn't contain",
    'did not contain',
    "wasn't clear",
    'was not clear',
    'no decision',
    'unclear',
    'vague',
    'ambiguous',
    'missing a decision',
    "you didn't",
    'you did not',
  ];

  const openerFor = (label: string, authored: boolean): string =>
    textOf({
      graph: makeGraph([
        { id: 'd1', kind: 'decision', label, ...(authored ? { label_authored: true } : {}) },
        OPTION_A,
        OPTION_B,
        OPTION_C,
      ] as unknown as GraphV3T['nodes']),
    }).split('\n\n')[0];

  it('BOTH DIRECTIONS: no opener in the corpus asserts anything about the brief', async () => {
    const { deriveDecisionLabel } = await import(
      '../../../cee/draft/records/objective-label.js'
    );
    const cases = BRIEF_CORPUS.map((c) => {
      const derived = deriveDecisionLabel({ brief: c.brief, goalQuotes: [] });
      return { ...c, derived, opener: openerFor(derived.label, derived.authored) };
    });

    // POSITIVE + CONTRAST CONTROL (trap 13). An "asserts nothing" sweep would
    // also pass over a corpus that never reached the provisional path at all.
    // Assert BOTH builder paths are exercised before believing the absence.
    expect(
      cases.filter((c) => !c.derived.authored).map((c) => c.name).length,
      'corpus must contain at least one PROVISIONAL case',
    ).toBeGreaterThan(0);
    expect(
      cases.filter((c) => c.derived.authored).map((c) => c.name).length,
      'corpus must contain at least one AUTHORED case',
    ).toBeGreaterThan(0);

    for (const c of cases) {
      const lower = c.opener.toLowerCase();
      for (const claim of CLAIMS_ABOUT_THE_BRIEF) {
        expect(lower, `${c.name}: opener asserts "${claim}" about the brief: ${c.opener}`)
          .not.toContain(claim);
      }
    }
  });

  it('the provisional opener names what the builder did, and invites correction', () => {
    const text = textOf({
      graph: makeGraph([
        { id: 'd1', kind: 'decision', label: 'Decision' },
        OPTION_A,
        OPTION_B,
        OPTION_C,
        FACTOR_QUALITY,
      ] as unknown as GraphV3T['nodes']),
    });
    // ⭐ THE COPY IS THE DELIVERABLE, so it is pinned as a literal here.
    expect(text.split('\n\n')[0]).toBe(
      "I've built a first model from your brief. I've framed the decision provisionally, so tell me if it isn't the one you're weighing.",
    );
    assertCleanCopy(text);
  });

  it('the provisional opener quotes a whole goal when one exists, and still invites correction', () => {
    const text = textOf({
      graph: makeGraph([
        { id: 'd1', kind: 'decision', label: 'Decision' },
        { id: 'g1', kind: 'goal', label: 'Cut delivery cost per parcel' },
        OPTION_A,
        OPTION_B,
      ] as unknown as GraphV3T['nodes']),
    });
    expect(text.split('\n\n')[0]).toBe(
      'I\'ve built a first model for "Cut delivery cost per parcel". I\'ve framed the decision provisionally, so tell me if it isn\'t the one you\'re weighing.',
    );
    assertCleanCopy(text);
  });

  /**
   * ⭐ THE OVER-CORRECTION CONTROL, RESTATED FOR THE NEW COPY. A change that
   * simply gave EVERY draft the invitation would be indistinguishable from a
   * correct one. A genuinely authored decision is untouched.
   */
  it('CONTROL: a genuinely authored decision gets neither the provisional framing nor the invitation', () => {
    const text = textOf({
      graph: makeGraph([
        {
          id: 'd1',
          kind: 'decision',
          label: 'Build our own fleet or partner with third-party couriers',
          label_authored: true,
        },
        GOAL_NODE,
        OPTION_A,
        OPTION_B,
      ] as unknown as GraphV3T['nodes']),
    });
    expect(text.startsWith("I've built a first decision model")).toBe(true);
    expect(text).not.toContain('framed the decision provisionally');
    expect(text).not.toContain("the one you're weighing");
  });
});

/**
 * ⭐⭐ THE MODEL IS ONE OF SEVERAL THE SYSTEM COULD HAVE BUILT, AND NOTHING
 * SAID SO.
 *
 * ── THE MEASURED FACT, AND WHY THERE IS NO FIX FOR IT ──────────────────────
 * The same brief produces materially different models: 5 of 5 runs gave
 * distinct option sets, and the journeys inverted
 * (retain 66% → 45% → blocked → 75% → CLOSE 52%). The request was
 * BYTE-IDENTICAL every time (`temperature: 0`, same prompt hash) and the
 * analysis solver is bit-identical to 16 significant figures, so every bit of
 * that variance is in the DRAFT. The Anthropic API exposes no seed parameter
 * and temperature is already 0: this is a property of the system, not a defect
 * with a fix.
 *
 * ── THE TRUTHFULNESS GAP THIS CLOSES ───────────────────────────────────────
 * The product hedges honestly WITHIN a model. Nothing told a user their model
 * was one of several. Two colleagues comparing notes each saw honest hedging
 * and no hint that their models differ — and they WILL compare notes.
 *
 * ── WHERE IT SITS, AND WHY NOT AT THE TOP ──────────────────────────────────
 * Read together with the opener above, a variance note in block 1 would open
 * every draft with two hedges in a row. It is the CLOSING frame instead —
 * after the content, BEFORE the call to action, so the last thing the reader
 * takes away is still the next step. On the verbatim-summary path there is no
 * builder-composed call to action, so it closes the reply.
 */
describe('every draft says the model is one of several the system could build', () => {
  const NOTE =
    'This is one of several models I could build from your brief: a starting point to argue with, not an answer. Ask me again and you would get a different one.';

  const authoredGraph = makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_QUALITY, FACTOR_CAPACITY]);
  const provisionalGraph = makeGraph([
    { id: 'd1', kind: 'decision', label: 'Decision' },
    OPTION_A,
    OPTION_B,
    OPTION_C,
  ] as unknown as GraphV3T['nodes']);

  /**
   * ⭐ THE LITERAL IS THE AUTHORITY. `NOTE` above is written out by hand; the
   * module's exported constant is what ships. Pinning them equal here means a
   * copy edit REDs on the literal (where a human reads it) rather than
   * silently carrying every composed assertion in this file along with it.
   */
  it('PIN: the shipped constant is exactly the copy pinned here', () => {
    expect(MODEL_VARIANCE_NOTE).toBe(NOTE);
  });

  it('the deterministic sectioned narrative carries the note', () => {
    const text = textOf({ graph: authoredGraph });
    expect(text).toContain(NOTE);
    assertCleanCopy(text);
  });

  it('the verbatim coaching-summary path carries the note too', () => {
    // ⭐ THIS PATH IS THE MAJORITY OF REPLIES. The deterministic opener carried
    // 146 of 688 replies in the 18 Aug live capture; a note added only to the
    // sectioned builder would be DARK for most users while the register said
    // the gap was closed.
    const summary =
      'The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare under stress.';
    const result = buildPostDraftNarrative({
      graph: authoredGraph,
      coachingSummary: summary,
      analysisReady: { status: 'ready' },
    });
    // The model's own summary is still used verbatim and is still not prefixed
    // by the deterministic opener — the note is appended, nothing is rewritten.
    expect(result.text).toBe(`${summary}\n\n${NOTE}`);
    expect(result.text).not.toContain("I've built a first decision model");
    expect(result.telemetry.assumption_source).toBe('coaching_summary');
  });

  it('the note never opens the reply — the draft must not lead with two hedges', () => {
    const text = textOf({ graph: provisionalGraph });
    const blocks = text.split('\n\n');
    expect(blocks[0]).not.toContain('one of several models');
    // The block immediately after the opener is the model's content, not a
    // second hedge stacked on the first.
    expect(blocks[1]).toContain('Options on the canvas');
  });

  it('the call to action still comes last on the deterministic path', () => {
    const text = textOf({ graph: provisionalGraph });
    const blocks = text.split('\n\n');
    expect(blocks.at(-1)?.startsWith('Next,')).toBe(true);
    expect(blocks.at(-2)).toBe(NOTE);
  });

  /**
   * ⭐⭐ THE NOTE MUST NOT DISPLACE COACHING — THE GUARD, ON A FIXTURE BIG
   * ENOUGH TO SHOW IT.
   *
   * Measured here: 120 words of composed content, note 31, served 151. Charge
   * the note to the ladder's 140-word budget (as a first cut did) and rung 2
   * sheds the `Worth a look:` bullet. The footer is spliced in after the
   * ladder has measured, so both survive.
   *
   * The final assertion bounds the COMPOSED CONTENT, derived from the constant
   * rather than written as a second magic number, so it cannot drift out of
   * agreement with the copy.
   */
  it('the note does not displace coaching on a content-heavy draft', () => {
    const result = buildReadyNarrative({
      graph: makeGraph([
        { id: 'g1', kind: 'goal', label: 'Reduce cost to serve per enterprise account' },
        { id: 'o1', kind: 'option', label: 'Consolidate onto a single support platform' },
        { id: 'o2', kind: 'option', label: 'Move tier-one triage to a partner' },
        { id: 'o3', kind: 'option', label: 'Automate the top twenty ticket types' },
        { id: 'o4', kind: 'option', label: 'Hold the current operating model' },
        { id: 'f1', kind: 'factor', label: 'Support cost per account' },
        { id: 'f2', kind: 'factor', label: 'Time to first response' },
        { id: 'r1', kind: 'risk', label: 'Enterprise churn during migration' },
      ] as unknown as GraphV3T['nodes']),
      strengthenItems: [
        {
          id: 's1',
          label: 'Range the migration cost',
          detail:
            'the migration cost sits as a point value and would benefit from a 2 to 6M range across the transition window',
          action_type: 'add_constraint',
        },
        {
          id: 's2',
          label: 'Check the partner capacity',
          detail:
            'partner triage capacity is assumed constant through the peak renewal quarter when volumes historically double',
          action_type: 'add_constraint',
        },
      ],
    });
    // PRECONDITION PINNED IN-TEST (trap 13b): this fixture is only a guard if
    // it actually carries an extra check bullet AND is big enough that the
    // note would push it over the ladder's budget. Assert both, or the test
    // below passes for the wrong reason.
    expect(result.telemetry.additional_checks_surfaced).toBe(1);
    expect(wordCount(result.text)).toBeGreaterThan(140);

    expect(result.text).toContain('Worth a look:');
    expect(result.text).toContain(MODEL_VARIANCE_NOTE);
    expect(wordCount(result.text) - wordCount(MODEL_VARIANCE_NOTE)).toBeLessThanOrEqual(140);
  });

  it('CONTROL: a draft with no model does not claim one was built', () => {
    // Nothing was built, so "one of several models I could build" would be a
    // fresh false claim in the opposite direction.
    const readyText = textOf({ graph: makeGraph([]) });
    expect(readyText).not.toContain('one of several models');
    const nonReady = buildPostDraftNarrative({
      graph: null,
      analysisReady: { status: 'blocked' },
    });
    expect(nonReady.text).not.toContain('one of several models');
  });

  it('the 140-word narrative budget still holds with the note in it', () => {
    const text = textOf({
      graph: makeGraph([
        { id: 'd1', kind: 'decision', label: 'Decision' },
        GOAL_NODE,
        OPTION_A,
        OPTION_B,
        OPTION_C,
        OPTION_D,
        FACTOR_QUALITY,
        FACTOR_CAPACITY,
      ] as unknown as GraphV3T['nodes']),
    });
    expect(text).toContain(NOTE);
    expect(wordCount(text)).toBeLessThanOrEqual(140);
  });
});
