/**
 * THE FOUNDER CORRECTION LOOP — a user-stated value against a
 * normalisation-minted cap, driven through the real TurnExecutor.
 *
 * ⚠ HISTORIC RECORD. The graph fixture below is the node the wire carried at
 * deployed CEE `578e809` (journey capture `captures-20260906T230616Z.json`,
 * turns[0] `draft_graph`, node `919d7f50`), and `CAPTURED_USER_ANSWER` is the
 * sentence the founder actually typed at turn 4. Do not tidy either to match
 * later behaviour — they are evidence of what the product did on a dated build
 * (CLAUDE.md trap 14b). The sentence this suite DRIVES is a de-anaphorised
 * variant; the reason, and the measurement behind it, are at `USER_ANSWER`.
 *
 * WHAT WAS WITNESSED. The brief said the first hire would cost "£80-120k".
 * The extractor read a bare 80; the enricher normalised it to
 * `{value: 0.8, raw_value: 80, cap: 100, unit: '£'}`. The product then
 * correctly noticed its own error — turn 2: "the model currently shows the
 * sales headcount investment as just £80, which looks like a unit slip" — and
 * offered £80,000 / £100,000 / £120,000. The founder answered "Set it to
 * £120,000." and was refused:
 *
 *     "Taking that as Sales Headcount Investment. Value £120,000 exceeds the
 *      factor's cap of £100. I haven't changed anything."
 *
 * THE CAP BLOCKING THE FIX WAS THE SAME EXTRACTION DEFECT THE FIX EXISTED TO
 * REPAIR. `graph_hash` moved on none of the eight captured turns and zero
 * `graph_patch` blocks were emitted — the correction loop could not complete.
 *
 * THE ASYMMETRY. `chip_prompt_rescale_extend_cap` ("Set to £120,000 and
 * extend the scale") was ON THE WIRE beside that refusal, so the affordance
 * existed; it works because its pending action carries a structured `cap` that
 * arrives as `proposalCap`, and `cap = proposalCap ?? factorCap` in the shared
 * predicate. The spoken answer synthesised `{value, unit}` with no cap and so
 * could never reach it. One affordance, two routes, one of them blind.
 *
 * ⚠ THE GATE IS UNCHANGED. `evaluateFactorValueProposalImpl` is not touched by
 * this work. What changed is what the deterministic value-update path
 * PROPOSES. The refusal direction is therefore pinned here as an
 * opposite-direction twin, not assumed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';

const SCENARIO_ID = 'c34c7b95-b413-45ad-a925-bbfe2d46f9af';

let persistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      if (write.graph !== undefined) persistedGraph = write.graph;
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

/**
 * The founder's own sentence, verbatim from turn 4 of the capture. Kept as the
 * record of what was typed.
 */
const CAPTURED_USER_ANSWER = 'Set it to £120,000.';

/**
 * ⚠ WHAT THIS SUITE DRIVES, AND WHY IT IS NOT THE VERBATIM SENTENCE.
 * `CAPTURED_USER_ANSWER` is ANAPHORIC — "it" resolved on staging against the
 * preceding turn, where the assistant had just named the factor and offered
 * three amounts. Reproducing that referent needs a seeded session, which would
 * make this suite a test of anaphora resolution rather than of the cap. The
 * defect under test is the CAP, so these cases name the factor explicitly and
 * reach the same deterministic value-update synthesis site by the same route.
 * Measured, not assumed: with the verbatim sentence and an empty history the
 * deterministic path declines and the turn falls through to LLM routing
 * (`failure_type: LLM_UNAVAILABLE`, `llm_calls_used: 1`) — it never reaches
 * the code this suite is about.
 */
const USER_ANSWER = 'Set Sales Headcount Investment to £120,000.';

/**
 * The capture's node. `cap: 100` is `computeNormalisationCap(80)` — an
 * artefact of the mis-extracted 80, not a bound anyone stated.
 */
function founderGraph(overrides?: {
  readonly unit?: string;
  readonly cap?: number;
  readonly raw_value?: number;
  readonly value?: number;
}) {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Reach £30k MRR within 18 months' },
      {
        id: '919d7f50',
        kind: 'factor',
        label: 'Sales Headcount Investment',
        observed_state: {
          value: overrides?.value ?? 0.8,
          raw_value: overrides?.raw_value ?? 80,
          unit: overrides?.unit ?? '£',
          cap: overrides?.cap ?? 100,
          source: 'brief_extraction',
        },
      },
      { id: 'opt_hire', kind: 'option', label: 'Hire a Dedicated Sales Team' },
      { id: 'opt_founder', kind: 'option', label: 'Continue With Founder-Led Sales' },
    ],
    edges: [{ id: 'e1', from: '919d7f50', to: 'goal_1', kind: 'influences', strength: 0.5 }],
  };
}

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: randomUUID(),
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  });
}

/**
 * A `set_factor_value` spy standing in for the real handler. The validator
 * runs for real BETWEEN synthesis and dispatch, so "the spy was called" means
 * the proposal passed every gate — and the recorded parameter is the exact
 * shape the handler would have normalised.
 */
function registry() {
  const received: Array<{ value: unknown }> = [];
  const mutationSpy = vi.fn(async (invocation: {
    proposal?: { parameters?: ReadonlyArray<{ name: string; value: unknown }> };
  }) => {
    const valueParam = (invocation.proposal?.parameters ?? []).find((p) => p.name === 'value');
    received.push({ value: valueParam?.value });
    return { assistant_text: 'SET-FACTOR-VALUE-RAN', handler_facts: [], llm_calls_used: 0 };
  });
  const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
    ['set_factor_value' as V5ActionType, mutationSpy as unknown as HandlerFn],
  ]);
  return { handlers, mutationSpy, received };
}

/** The deterministic path must not reach the LLM; a call here is a test bug. */
function throwingRoutingAdapter() {
  return {
    chatWithTools: vi.fn(async () => {
      throw new Error('routing adapter must not be called on the deterministic value-update path');
    }),
  };
}

beforeEach(() => {
  persistedGraph = null;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('a user-stated value outranks a normalisation-minted cap', () => {
  it('precondition: the driven sentence differs from the captured one ONLY in the referent', () => {
    // Keeps the de-anaphorisation honest and visible. If someone later makes
    // the captured sentence drivable, this row is where they will see that the
    // two have converged.
    expect(CAPTURED_USER_ANSWER).toContain('£120,000');
    expect(USER_ANSWER).toContain('£120,000');
    expect(CAPTURED_USER_ANSWER).not.toContain('Sales Headcount Investment');
    expect(USER_ANSWER).toContain('Sales Headcount Investment');
  });

  it('THE FOUNDER TURN — the £120,000 answer is APPLIED, carrying an extended scale', async () => {
    const { handlers, mutationSpy, received } = registry();

    const { response } = await runTurnExecutor(payload(USER_ANSWER), `req-${randomUUID()}`, {
      routingAdapter: throwingRoutingAdapter(),
      handlerRegistry: handlers,
      graphState: founderGraph(),
    });

    // (1) The refusal the founder actually got must be gone.
    expect(response.assistant_text, 'the witnessed refusal').not.toContain(
      "exceeds the factor's cap",
    );
    expect(response.assistant_text).not.toContain("I haven't changed anything");

    // (2) The proposal reached the handler — i.e. it passed the UNCHANGED
    //     validator gate rather than being waved through.
    expect(mutationSpy, response.assistant_text).toHaveBeenCalledTimes(1);

    // (3) It carried the user's value AND a cap that admits it. Bound by
    //     identity to the `value` parameter, never to a bare number another
    //     parameter could satisfy (CLAUDE.md trap 19).
    expect(received).toHaveLength(1);
    const sent = received[0]!.value as { value?: number; unit?: string; cap?: number };
    expect(sent.value).toBe(120_000);
    expect(sent.unit).toBe('£');
    expect(sent.cap, 'the consented extended scale').toBeGreaterThanOrEqual(120_000);
    // The same number the user's own rescale chip would have carried —
    // suggestExtendedCap(120000) = 120000*1.25 = 150000, 2 s.f.
    expect(sent.cap).toBe(150_000);
  });

  it('TWIN — a PERCENTAGE factor on 0-100 still REFUSES the same sentence shape', async () => {
    // The unit-slip catch. Numbers otherwise identical to a minted cap
    // (100 === computeNormalisationCap(80)); only the unit differs, so this
    // row cannot pass by accident. `120000%` matches the factor's unit, so it
    // reaches the cap gate rather than stopping at `unit_mismatch`.
    const { handlers, mutationSpy } = registry();

    const { response } = await runTurnExecutor(payload('Set Sales Headcount Investment to 120000%.'), `req-${randomUUID()}`, {
      routingAdapter: throwingRoutingAdapter(),
      handlerRegistry: handlers,
      graphState: founderGraph({ unit: '%', cap: 100, raw_value: 80, value: 0.8 }),
    });

    expect(mutationSpy, response.assistant_text).not.toHaveBeenCalled();
    expect(response.assistant_text).toContain("exceeds the factor's cap");
  });

  it('TWIN — a DECLARED scale the minting rule could not have produced still REFUSES', async () => {
    // cap 200,000 is not a power of ten, so it is not this function's output
    // for the stored 80,000: a bound somebody chose, which a stated value must
    // not silently overwrite. The rescale chip remains the consented route.
    const { handlers, mutationSpy } = registry();

    const { response } = await runTurnExecutor(
      payload('Set Sales Headcount Investment to £500,000.'),
      `req-${randomUUID()}`,
      {
        routingAdapter: throwingRoutingAdapter(),
        handlerRegistry: handlers,
        graphState: founderGraph({ unit: '£', cap: 200_000, raw_value: 80_000, value: 0.4 }),
      },
    );

    expect(mutationSpy, response.assistant_text).not.toHaveBeenCalled();
    expect(response.assistant_text).toContain("exceeds the factor's cap");
  });

  it('TWIN — a value WITHIN the minted cap is untouched by any of this', async () => {
    // The path that always worked must keep working, and must NOT acquire a
    // cap it never needed: the extension fires only on `value_exceeds_cap`.
    const { handlers, mutationSpy, received } = registry();

    await runTurnExecutor(payload('Set Sales Headcount Investment to £90.'), `req-${randomUUID()}`, {
      routingAdapter: throwingRoutingAdapter(),
      handlerRegistry: handlers,
      graphState: founderGraph(),
    });

    expect(mutationSpy).toHaveBeenCalledTimes(1);
    const sent = received[0]!.value as { value?: number; cap?: number };
    expect(sent.value).toBe(90);
    expect(sent.cap, 'no cap extension on a value that never exceeded one').toBeUndefined();
  });
});
