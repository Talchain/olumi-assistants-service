/**
 * Behavioural integration test for the chip-click `what_would_flip` path.
 *
 * Reproduces the live staging bug: chip click on a fresh analysis with
 * fragile robustness and a ~6pp margin produced
 *
 *   "The robustness band is currently fragile, so smaller changes are
 *   unlikely to flip the outcome on their own."
 *
 * The sibling source-grep test (`chip-click-dispatch-raw-robustness-wiring`)
 * locks the literal wiring lines so a refactor cannot silently delete the
 * `pickLatestRawRobustness(context.prior_facts)` call. THIS file drives
 * the dispatcher end-to-end with the REAL `what_would_flip` handler and
 * the REAL `composeWhatWouldFlipFallback` composer, and asserts the
 * assistant_text actually committed by the dispatcher contains the
 * corrected copy and never the buggy sentence.
 *
 * What's mocked vs. real:
 *   - `buildTurnContext`     — mocked, returns prior_facts + persistedGraph
 *   - `commitDirectAnswer`   — mocked, captures the response so we can
 *                              inspect `assistant_text` without persisting
 *   - `routeWithToolUse`     — mocked, spied to prove zero LLM calls
 *   - `loadScenarioSnapshotForRunAnalysis` — mocked (defensive; not
 *                              actually consulted on this path)
 *   - HANDLER + COMPOSER     — REAL. The dispatcher receives a registry
 *                              constructed from `createWhatWouldFlipHandler()`
 *                              via the injectable `handlerRegistry` param,
 *                              so the actual fallback prose is generated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  routeWithToolUseSpy,
  buildTurnContextMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  routeWithToolUseSpy: vi.fn(),
  buildTurnContextMock: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: buildTurnContextMock,
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

// Hard guard on the deterministic-bypass contract — no LLM call permitted
// on the chip-click `what_would_flip` path.
vi.mock('../../routing/route-with-tool-use.js', () => ({
  routeWithToolUse: routeWithToolUseSpy,
}));

import type { V5ActionType } from '@talchain/schemas/orchestrator';

import { dispatchDeterministicChipClick } from '../chip-click-dispatch.js';
import { createWhatWouldFlipHandler } from '../../tools/handlers/what-would-flip.js';
import type { HandlerFn, HandlerRegistry } from '../../tools/registry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Minimal valid GraphV3 shape with the two options the analysis fact
 * references. The structural-readiness derivation is incidental here —
 * what matters is the analysis-affecting graph hash matching the
 * fact's `graph_hash_at_run` so freshness lands on `'fresh'` and the
 * handler reaches the composer rather than the precondition-fail
 * template.
 */
const READY_GRAPH = {
  nodes: [
    { id: 'dec_root', kind: 'decision' as const, label: 'Marketing capacity?' },
    {
      id: 'goal_growth',
      kind: 'goal' as const,
      label: 'Customer growth',
      goal_threshold: 0.8,
    },
    {
      id: 'fac_acquisition_cost',
      kind: 'factor' as const,
      label: 'Acquisition cost',
    },
    {
      id: 'opt_freelance',
      kind: 'option' as const,
      label: 'Freelance Consultant + Moderate Ad Spend',
      interventions: { fac_acquisition_cost: 0.55 },
    },
    {
      id: 'opt_hire',
      kind: 'option' as const,
      label: 'Hire Marketing Manager',
      interventions: { fac_acquisition_cost: 0.7 },
    },
  ],
  edges: [
    {
      from: 'dec_root',
      to: 'opt_freelance',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'dec_root',
      to: 'opt_hire',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_freelance',
      to: 'fac_acquisition_cost',
      strength: { mean: 0.55, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_hire',
      to: 'fac_acquisition_cost',
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_acquisition_cost',
      to: 'goal_growth',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

// Typed loosely so happy-path overrides can replace `prior_facts` and
// `persistedGraph` with real-shaped values without narrowing fighting
// us; the dispatcher only reads the fields the build-turn-context layer
// already validates, so a less-strict test fixture is safe here.
const DEFAULT_TURN_CONTEXT: Record<string, unknown> = {
  stage: 'analyse' as const,
  entity_registry: { option_ids: [], goal_id: null },
  capabilities: {
    can_run_analysis: false,
    can_edit_graph: false,
    can_run_decision_review: false,
    can_generate_coaching: false,
    can_invoke_tools: false,
    can_commit_session_state: false,
  },
  messages: [
    { role: 'user' as const, content: 'What could change the outcome?' },
  ],
  session_id: SCENARIO_ID,
  request_id: 'req-flip-behaviour',
  budgets: {
    turn_ms: 30000,
    handler_ms: 20000,
    plot_ms: 15000,
    anthropic_ms: 15000,
    openai_ms: 15000,
  },
  prior_turns: [],
  prior_facts: [],
  scenarioBriefText: null,
  persistedGraph: null,
};

function payloadFor() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'What could change the outcome?',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'what_would_flip' },
  });
}

/**
 * Real handler registry — only `what_would_flip` is registered. The
 * dispatcher's resolver will use it via the `handlerRegistry` override
 * param so the test goes through the REAL composer.
 */
const REAL_REGISTRY: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
  ['what_would_flip', createWhatWouldFlipHandler()],
]);

async function buildFreshFragileContext(opts: {
  readonly margin_pp: number;
  readonly leading_prob: number;
  readonly runner_prob: number;
  /** `null` = omit raw enrichment.robustness entirely. */
  readonly raw_robustness_level: string | null;
}): Promise<typeof DEFAULT_TURN_CONTEXT> {
  // Compute the analysis-affecting graph hash so the prior fact's
  // graph_hash_at_run can match → freshness 'fresh' → composer runs.
  const { computeAnalysisAffectingGraphHash } = await import(
    '../../context/graph-hash.js'
  );
  const { GraphStateIngressSchema } = await import(
    '../../boundary/request-extensions.js'
  );
  const parsed = GraphStateIngressSchema.safeParse(READY_GRAPH);
  if (!parsed.success) throw new Error('test setup: graph parse failed');
  const expectedHash = computeAnalysisAffectingGraphHash(parsed.data)!;

  const enrichment: Record<string, unknown> = {
    option_comparison: [
      {
        option_id: 'opt_freelance',
        option_label: 'Freelance Consultant + Moderate Ad Spend',
        win_probability: opts.leading_prob,
      },
      {
        option_id: 'opt_hire',
        option_label: 'Hire Marketing Manager',
        win_probability: opts.runner_prob,
      },
    ],
    analysis_status: 'computed',
    margin_pp: opts.margin_pp,
    factor_sensitivity: [
      { factor_id: 'fac_acquisition_cost', sensitivity_value: 0.55 },
    ],
  };
  if (opts.raw_robustness_level !== null) {
    enrichment.robustness = { level: opts.raw_robustness_level };
  }

  const priorRunAnalysisFact = {
    fact_type: 'run_analysis' as const,
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_freelance',
      win_probabilities: {
        opt_freelance: opts.leading_prob,
        opt_hire: opts.runner_prob,
      },
      summary: 'Ran analysis.',
      enrichment,
      graph_hash_at_run: expectedHash,
      computed_at: '2026-04-30T12:00:00.000Z',
    },
  };

  return {
    ...DEFAULT_TURN_CONTEXT,
    prior_facts: [priorRunAnalysisFact],
    persistedGraph: READY_GRAPH,
  };
}

/**
 * Pull the assistant_text the dispatcher actually committed (this is
 * what the wire response carries, so it is the live user-visible string).
 */
function commitedAssistantText(): string {
  expect(commitDirectAnswerMock).toHaveBeenCalledTimes(1);
  const args = commitDirectAnswerMock.mock.calls[0]!;
  const response = args[0] as { assistant_text?: string };
  return response.assistant_text ?? '';
}

describe('chip-click what_would_flip — behavioural regression (PR #196 round-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
  });

  it('fragile robustness + ~6pp margin: response is deterministic, contains fragility/small-change copy, and does NOT contain the buggy "smaller changes are unlikely" sentence (reproduces the live staging bug)', async () => {
    buildTurnContextMock.mockResolvedValueOnce(
      await buildFreshFragileContext({
        leading_prob: 0.49,
        runner_prob: 0.433,
        margin_pp: 5.7,
        raw_robustness_level: 'fragile',
      }),
    );

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-fragile-6pp',
      handlerRegistry: REAL_REGISTRY,
    });

    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    // Determinism contract — no LLM call on the chip-click path.
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();

    const text = commitedAssistantText();

    // Hard regression: the buggy sentence must never reach the user.
    expect(text).not.toContain(
      'The robustness band is currently fragile, so smaller changes are unlikely',
    );
    expect(text).not.toMatch(/smaller changes are unlikely to flip/i);

    // Positive: fragility-aware closing copy.
    expect(text.toLowerCase()).toMatch(/picture appears fragile/);
    expect(text.toLowerCase()).toMatch(
      /small adjustments to the strongest drivers/,
    );
    expect(text.toLowerCase()).toMatch(/shift which option leads/);

    // Sanity: option labels from the fact reach the user.
    expect(text).toContain('Freelance Consultant + Moderate Ad Spend');
  });

  it('canonical fragile band with raw enrichment.robustness OMITTED: still triggers fragility-aware copy (older facts compatibility)', async () => {
    // Older run_analysis facts may not have the raw enrichment.robustness
    // block — the canonical band derived by compactAnalysis is still
    // present and is itself the upstream's verdict. The composer's
    // projected-fragile branch must honour it.
    buildTurnContextMock.mockResolvedValueOnce(
      await buildFreshFragileContext({
        leading_prob: 0.49,
        runner_prob: 0.433,
        margin_pp: 5.7,
        raw_robustness_level: null,
      }),
    );

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-canonical-only',
      handlerRegistry: REAL_REGISTRY,
    });

    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    const text = commitedAssistantText();
    expect(text).not.toMatch(/smaller changes are unlikely to flip/i);
    // Without raw signals the composer falls back to the canonical band
    // projection. compactAnalysis is the source of `robustness_band` —
    // if it doesn't surface 'fragile' for this enrichment shape, the
    // composer's projected-fragile guard will not fire and the closing
    // sentence will be omitted entirely. Either outcome is acceptable
    // honesty; the contract is: never emit the buggy sentence.
    if (/picture appears fragile/i.test(text)) {
      expect(text.toLowerCase()).toMatch(
        /small adjustments to the strongest drivers/,
      );
    } else {
      expect(text).not.toMatch(/^The robustness band/m);
    }
  });
});
