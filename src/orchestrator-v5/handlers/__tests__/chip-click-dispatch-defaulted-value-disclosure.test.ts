/**
 * F6 — the defaulted-value egress invariant on the CHIP-CLICK exit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXIT NEEDS ITS OWN SPEC
 *
 * `DETERMINISTIC_CHIP_ACTION_TYPES` contains `run_analysis`, so the
 * ANALYSIS-COMPLETION turn bypasses the turn executor entirely — route-v2
 * detects the chip shape and calls `dispatchDeterministicChipClick` instead.
 * That turn is the one that ships
 *
 *   "… came out ahead in NN% of runs of this model."
 *
 * (`coaching/analysis-result-headline.ts`, reaching the user through the
 * validation registry's confirmation template), which is the single most
 * analysis-bearing sentence the product emits. Until this block existed it was
 * also the one sentence the F6 invariant could not see, because
 * `enforceDefaultedValueDisclosureGuard` lives in a function this path never
 * enters.
 *
 * The estate already knew this shape: `applyEgressForbiddenPhraseGuard` is
 * hand-duplicated at the same seam for exactly the same reason. F6 was not,
 * which an adversarial review caught.
 *
 * ⭐ THE DUPLICATION IS DELIBERATE AND BOTH COPIES ARE PINNED — this file for
 * the chip exit, `__tests__/turn-executor-defaulted-value-disclosure.test.ts`
 * for the executor exit. Two live copies of one rule with only one of them
 * tested is how the rule silently becomes one copy.
 *
 * ⚠ THE ENRICHMENT IS THE PRODUCER'S, VERBATIM, read off the committed capture.
 * Nothing here hand-builds an enrichment envelope — authoring one is the exact
 * mistake that made F6 invisible for the whole of #940's life.
 *
 * Harness mirrors `chip-click-dispatch-rerun-coaching.test.ts` (registry +
 * commit + enricher mocked at their module seams; the composer and the egress
 * block run REAL).
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { DEFAULTED_DISCLOSURE_TAIL } from '../../coaching/pick-defaulted-assumptions.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {
        can_run_analysis: false,
        can_edit_graph: false,
        can_run_decision_review: false,
        can_generate_coaching: false,
        can_invoke_tools: false,
        can_commit_session_state: false,
      },
      messages: [{ role: 'user', content: 'Run the analysis' }],
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      request_id: 'req-test',
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
    })),
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: createRegistryMock,
    getDefaultRegistry: () => new Map([['run_analysis', handlerFnMock]]),
    resolveHandler: (_registry: unknown, id: string) =>
      id === 'run_analysis' ? handlerFnMock : undefined,
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The producer's real enrichment envelope, verbatim. */
const REAL_ENRICHMENT = JSON.parse(
  readFileSync(
    new URL(
      '../../compose/__tests__/fixtures/dsk-walk/session-a.enrichment.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * The captured envelope plus the status the chip path's own fixtures carry.
 * The DEFAULTED KEY IS UNTOUCHED and stays where PLoT put it.
 */
function enrichmentWithDefaults(): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(REAL_ENRICHMENT)), analysis_status: 'completed' };
}

/** The SAME envelope with the one key removed — the direction twin. */
function enrichmentWithoutDefaults(): Record<string, unknown> {
  const copy = enrichmentWithDefaults();
  const brief = copy['decision_brief'] as Record<string, unknown>;
  delete brief['defaulted_assumptions'];
  return copy;
}

const READY_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
  ],
  edges: [
    { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_launch', to: 'opt_status_quo', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_status_quo', to: 'fac_marketing', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

function snapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: READY_GRAPH,
    options: [
      { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
      { id: 'opt_status_quo', option_id: 'opt_status_quo', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
    ],
    goal_node_id: 'goal_revenue',
    rawPersistedGraph: READY_GRAPH,
  };
}

/**
 * THE LIVE HEADLINE SHAPE. `analysis-result-headline.ts` mints
 * `came out ahead in ${leadPercent}% of runs of this model` — the sentence the
 * user reads on an analysis-completion chip turn.
 */
const HEADLINE = 'Launch now came out ahead in 62% of runs of this model.';

function handlerOutcome(enrichment: Record<string, unknown>) {
  return {
    assistant_text: HEADLINE,
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_launch',
          summary: 'Analysis ran with two options compared.',
          enrichment,
          constraint_verdict: {
            may_name_leading_option: true,
            constraint_verdict_state: 'not_applicable',
          },
        },
      },
    ],
    llm_calls_used: 0,
  };
}

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function egressEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.egress.defaulted_value_applied');
}

function occurrences(text: string, needle: string): number {
  let n = 0;
  let i = text.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = text.indexOf(needle, i + needle.length);
  }
  return n;
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshot());
  createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  enrichRunAnalysisMock.mockImplementation(
    async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
  );
  commitDirectAnswerMock.mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  });
});

describe('chip-click run_analysis — F6 defaulted-value disclosure (WIRING)', () => {
  it('PRECONDITION — the capture really carries defaults at the producer’s nested path', () => {
    const e = enrichmentWithDefaults();
    const brief = e['decision_brief'] as Record<string, unknown>;
    expect(Array.isArray(brief['defaulted_assumptions'])).toBe(true);
    expect(Object.hasOwn(e, 'defaulted_assumptions')).toBe(false);
  });

  it('discloses exactly once on the analysis-completion answer', async () => {
    handlerFnMock.mockResolvedValue(handlerOutcome(enrichmentWithDefaults()));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-f6-discloses',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    const text = out.response.assistant_text ?? '';
    expect(occurrences(text, DEFAULTED_DISCLOSURE_TAIL)).toBe(1);
    // The headline SURVIVES — this layer qualifies, it never withholds.
    expect(text).toContain('came out ahead in 62% of runs');
  });

  it('emits the guard telemetry tagged to the chip dispatch path', async () => {
    handlerFnMock.mockResolvedValue(handlerOutcome(enrichmentWithDefaults()));

    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-f6-telemetry',
    });

    const evt = egressEvent();
    expect(evt, 'F6 chip egress telemetry should fire').toBeDefined();
    // The dispatch_path is what lets the dashboard tell the two live copies of
    // this rule apart — without it a regression at one exit is invisible.
    expect(evt!.data.dispatch_path).toBe('chip_click_finalise');
    expect(evt!.data.defaulted_count).toBe(1);
    expect(evt!.data.disclosure_added).toBe(true);
  });

  /**
   * DIRECTION TWIN — the SAME capture with ONE key removed. Without this, a
   * block that unconditionally stapled the caveat to every analysis-completion
   * turn would pass both assertions above.
   */
  it('adds NOTHING when the run defaulted nothing', async () => {
    handlerFnMock.mockResolvedValue(handlerOutcome(enrichmentWithoutDefaults()));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-f6-no-defaults',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    const text = out.response.assistant_text ?? '';
    expect(text).not.toContain(DEFAULTED_DISCLOSURE_TAIL);
    expect(text).toContain('came out ahead in 62% of runs');
    expect(egressEvent()).toBeUndefined();
  });

  /**
   * The disclosed text must be what gets PERSISTED, not merely what gets sent.
   * The block sits before `commitDirectAnswer` precisely so the stored turn and
   * the shipped turn cannot disagree about what the user was told.
   */
  it('persists the disclosed text, not the undisclosed original', async () => {
    handlerFnMock.mockResolvedValue(handlerOutcome(enrichmentWithDefaults()));

    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-f6-persisted',
    });

    expect(commitDirectAnswerMock).toHaveBeenCalledTimes(1);
    // ARG 0 is the response — `commitDirectAnswer`'s own comment states the
    // stored assistant answer auto-derives from `response.assistant_text`, so
    // this is the byte that gets persisted.
    const committedResponse = commitDirectAnswerMock.mock.calls[0]![0] as {
      assistant_text?: string;
    };
    const persisted = committedResponse.assistant_text ?? '';
    expect(persisted).toContain(DEFAULTED_DISCLOSURE_TAIL);
  });
});
