/**
 * ⭐ THE CHIP-CLICK PATH READS THE DERIVED STAGE, NOT THE CLIENT'S ECHO.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 * `dispatchChipClickRunAnalysis` calls `buildTurnContext` at the top of the
 * function, so the ONE stage authority (`context/derive-stage.ts`, applied in
 * `build-turn-context.ts`) has already run and `context.stage` is in scope for
 * the whole dispatch. Five sites then ignored it and stamped `payload.stage` —
 * the client's own guess — back onto the wire. Before CEE #1042 that was
 * harmless, because `context.stage` WAS `payload.stage`. It is not any more, so
 * the chip-click family could echo a stale `decide` the derivation had already
 * corrected.
 *
 * ── HOW THIS BINDS BY IDENTITY, AND WHY THAT MATTERS HERE ────────────────────
 * `buildTurnContext` is stubbed to return a stage that DIFFERS from the one on
 * the payload, in BOTH directions across the suite. Every assertion therefore
 * names a value that only ONE of the two sources could have produced: a test
 * that agreed with `payload.stage` cannot also agree with `context.stage`, so
 * no value predicate satisfies both readings (CLAUDE.md trap 19). A single
 * direction would not do it — a mutant that hardcoded the expected literal
 * would pass one and fail the other.
 *
 * ── ⚠ THE LIMITATION THIS SUITE DOES NOT HIDE ────────────────────────────────
 * `buildTurnContext` runs BEFORE the run_analysis handler. On a `run_analysis`
 * chip click the analysis has therefore NOT yet run when the stage is derived,
 * so a promotion to `decide` cannot ORIGINATE on the turn that completes the
 * analysis — it lands on the next routed turn. These tests pin the stale-echo
 * half only. The origination ordering is untouched and out of scope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { log } from '../../../utils/telemetry.js';

// Mutable stage holder so each test can pick the context stage the stub
// returns. `vi.hoisted` guarantees it exists before the hoisted mock factory.
const { contextStage, generateChipsCalls } = vi.hoisted(() => ({
  contextStage: { value: 'analyse' as string },
  generateChipsCalls: [] as Array<{ stage: unknown }>,
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    buildTurnContext: vi.fn(async () => ({
      stage: contextStage.value,
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'Run analysis' }],
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      request_id: 'req-stage',
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

// SPY, not a replacement: the real generator still runs, so the response under
// test is the real one. Recording the `stage` argument is the only way to
// observe the `generateChips` site — its effect on the chip SET is indirect and
// stage-dependent rules may legitimately produce the same chips.
vi.mock('../../compose/chip-generator.js', async () => {
  const actual = await vi.importActual<typeof import('../../compose/chip-generator.js')>(
    '../../compose/chip-generator.js',
  );
  return {
    ...actual,
    generateChips: (input: { stage: unknown }) => {
      generateChipsCalls.push({ stage: input.stage });
      return actual.generateChips(input as never);
    },
  };
});

vi.mock('../../commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../commit.js')>('../../commit.js');
  return {
    ...actual,
    commitDirectAnswer: vi.fn(async () => ({
      response: {},
      performed: true,
      persisted_row_id: 'row-stage-1',
      graphPersisted: false,
    })),
  };
});

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: vi.fn(
    async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
  ),
}));

const { dispatchChipClickRunAnalysis } = await import('../chip-click-dispatch.js');
const { HandlerInvocationFailedError } = await import('../../tools/handler-errors.js');
import type { HandlerFn, HandlerRegistry } from '../../tools/registry.js';
import type { HandlerInvocationFailedCause } from '../../tools/handler-errors.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** A chip-click payload whose OWN stage is the value under contest. */
function payloadWithStage(stage: 'frame' | 'analyse' | 'decide' | 'review') {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage,
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

function registryThrowing(cause: HandlerInvocationFailedCause, retryable = false): HandlerRegistry {
  const fn: HandlerFn = () =>
    Promise.reject(
      new HandlerInvocationFailedError(`forced ${cause}`, {
        cause_kind: cause,
        retryable,
        details: {
          handler_id: 'run_analysis',
          specific_issue: 'simulated',
          first_option_label: 'Aggressive In-House Build',
        },
      }),
    );
  return new Map<V5ActionType, HandlerFn>([['run_analysis', fn]]);
}

function registrySucceeding(): HandlerRegistry {
  const fn: HandlerFn = (() =>
    Promise.resolve({
      assistant_text: 'Ran analysis.',
      handler_facts: [
        {
          fact_type: 'run_analysis' as const,
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: SCENARIO_ID,
            leading_option_id: 'opt_a',
            win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
            summary: 'Done.',
            enrichment: {},
          },
        },
      ],
      llm_calls_used: 0,
    })) as unknown as HandlerFn;
  return new Map<V5ActionType, HandlerFn>([['run_analysis', fn]]);
}

let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
let errorSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  generateChipsCalls.length = 0;
  contextStage.value = 'analyse';
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('chip-click run_analysis — the response carries the DERIVED stage, not the client echo', () => {
  // ── the composed `ok` exit (chip-click-dispatch.ts, composeToolCallResponse) ──

  it('the `ok` exit stamps context.stage when the client asked for something else', async () => {
    contextStage.value = 'analyse';
    const out = await dispatchChipClickRunAnalysis({
      payload: payloadWithStage('decide'),
      requestId: 'req-stage-ok-a',
      handlerRegistry: registrySucceeding(),
    });

    expect(out.outcome, 'this must be the composed success exit, not a failure floor').toBe('ok');
    expect(
      out.response.stage_indicator,
      'the chip-click success response echoed the client\'s `decide` instead of the ' +
        'stage CEE derived from the model it holds',
    ).toBe('analyse');
  });

  it('DISCRIMINATING TWIN — the same exit stamps `decide` when THAT is what the derivation said', async () => {
    // ⭐ Without this the test above is satisfied by a build that hardcoded
    // `'analyse'`. The two differ only in the derived stage, over the identical
    // payload family, so the passing PAIR is evidence about the SOURCE of the
    // value rather than about the literal.
    contextStage.value = 'decide';
    const out = await dispatchChipClickRunAnalysis({
      payload: payloadWithStage('frame'),
      requestId: 'req-stage-ok-b',
      handlerRegistry: registrySucceeding(),
    });

    expect(out.outcome).toBe('ok');
    expect(out.response.stage_indicator).toBe('decide');
  });

  // ── the generateChips site ──────────────────────────────────────────────

  it('generateChips is handed context.stage — the pill and the chips cannot disagree', async () => {
    contextStage.value = 'decide';
    await dispatchChipClickRunAnalysis({
      payload: payloadWithStage('frame'),
      requestId: 'req-stage-chips',
      handlerRegistry: registrySucceeding(),
    });

    // POSITIVE CONTROL for the assertion below: a zero-length record would make
    // any claim about the argument vacuous.
    expect(
      generateChipsCalls.length,
      'the chip generator was never called — the assertion below would be vacuous',
    ).toBeGreaterThan(0);
    expect(
      generateChipsCalls.map(c => c.stage),
      'the chip generator was handed the client echo while the pill carried the ' +
        'derived stage — the two-authorities defect the derivation exists to remove',
    ).toEqual(generateChipsCalls.map(() => 'decide'));
  });

  // ── the typed-failure floor (`failureResponse`) ──────────────────────────

  it('the FATAL typed-failure floor stamps the derived stage', async () => {
    contextStage.value = 'analyse';
    const out = await dispatchChipClickRunAnalysis({
      payload: payloadWithStage('decide'),
      requestId: 'req-stage-fatal',
      handlerRegistry: registryThrowing('fatal'),
    });

    expect(out.outcome, 'this must be the fatal floor, not a recovery').toBe('handler_failure');
    expect(out.response.stage_indicator).toBe('analyse');
  });

  // ── the recoverable-cause floor (tryComposeRecoverableChipOutcome) ───────
  //
  // ⚠ THIS SITE IS NOT GOVERNED BY THE DERIVATION, AND THAT IS DELIBERATE —
  // SO THIS TEST PINS THE HARDCODE RATHER THAN CLAIMING A FIX.
  //
  // `tryComposeRecoverableChipOutcome` takes a `stage` parameter and then
  // `void stage`s it, composing with the literal `ANALYSE_STAGE_INDICATOR`
  // instead. That is load-bearing, not laziness: ROADMAP 2.1085 measured a
  // deployed-UI path where a refusal carrying `stage_indicator !== 'analyse'`
  // AND no `analysis_result` block takes the present-but-invalid branch and
  // CLEARS ten fields of user state. The call site's argument was swapped to
  // `context.stage` for source consistency — the function reads neither source.
  //
  // So this test is NOT red-first, and does not pretend to be. It exists to
  // stop a later reader "completing" the swap by threading the stage through,
  // which would re-open a state-destroying defect.

  it('PIN, NOT A FIX — the recoverable floor is ALWAYS `analyse`, from NEITHER source', async () => {
    // Both sources say `decide`. If the floor read either of them it would say
    // `decide`; it says `analyse`, so the literal is proven to be the producer.
    contextStage.value = 'decide';
    const out = await dispatchChipClickRunAnalysis({
      payload: payloadWithStage('decide'),
      requestId: 'req-stage-recoverable',
      handlerRegistry: registryThrowing('options_not_configured'),
    });

    expect(out.outcome, 'this must be the graceful recovery, not the fatal floor').toBe(
      'handler_recovered',
    );
    expect(
      out.response.stage_indicator,
      'the recoverable refusal stopped being analyse-shaped — the deployed UI ' +
        'clears ten fields of user state on a non-analyse refusal with no ' +
        'analysis_result block (ROADMAP 2.1085)',
    ).toBe('analyse');
  });

  // ── the registry safety net ──────────────────────────────────────────────

  it('the missing-handler safety net stamps the derived stage', async () => {
    contextStage.value = 'analyse';
    const out = await dispatchChipClickRunAnalysis({
      payload: payloadWithStage('decide'),
      requestId: 'req-stage-no-handler',
      // Empty registry: `resolveHandler` returns null and the safety-net exit
      // composes its own response. This is the ONLY way to reach that site.
      handlerRegistry: new Map<V5ActionType, HandlerFn>(),
    });

    expect(out.outcome, 'this must be the missing-handler safety net').toBe('commit_failed');
    expect(out.response.stage_indicator).toBe('analyse');
  });
});
