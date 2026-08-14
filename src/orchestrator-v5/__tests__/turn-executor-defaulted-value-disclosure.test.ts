/**
 * F6 — the defaulted-value egress guard, exercised THROUGH THE EXECUTOR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS, AND IT IS NOT A FORMALITY
 *
 * PR #945 shipped this guard with a mutant kit that scored 7/7. One of those
 * mutants was labelled "remove the egress invariant". It neutered
 * `applyDefaultedValueEgress` — the PURE FUNCTION — and the pure-function spec
 * went red, which was reported as evidence that the invariant was wired.
 *
 * It was not. An adversarial review neutered the actual CALL SITE
 * (`enforceDefaultedValueDisclosureGuard` in `turn-executor.ts`) and measured
 * **37/37 and 11/11 still GREEN**. Every existing test bound to the function;
 * none bound to the wiring. A repo-wide sweep found ZERO references to the
 * guard or its call site, while its three sibling finaliser guards each have a
 * dedicated behaviour spec.
 *
 * ⭐ THAT IS F6'S OWN DEFECT CLASS, ONE LEVEL UP. F6 was a reader pointed at a
 * path the producer never wrote to, certified by a suite that tested the reader
 * against a self-authored fixture. The mutant kit then made the identical
 * mistake about itself: it proved the component worked and called that proof
 * that the PRODUCT worked. A mutant is only evidence about the object it
 * actually mutates (CLAUDE.md trap 19), and mislabelling which object that was
 * turns a green kit into a false certificate.
 *
 * So this suite asserts on `response.assistant_text` returned by
 * `runTurnExecutor` — what the wire actually carries. Neutering the call site
 * MUST turn it red; that is its whole reason to exist, and it is pinned by the
 * mutant table in the PR body.
 *
 * Modelled deliberately on `turn-executor-egress-forbidden-phrase.test.ts`, the
 * sibling guard's spec, so the four finaliser guards are pinned the same way.
 *
 * ⚠ THE FACT CARRIES A REAL CAPTURED ENRICHMENT, read verbatim off
 * `compose/__tests__/fixtures/dsk-walk/session-a.enrichment.json`. Nothing here
 * hand-builds an enrichment envelope — that is exactly the mistake that made
 * F6 invisible for the whole of #940's life.
 */

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { DEFAULTED_DISCLOSURE_TAIL } from '../coaching/pick-defaulted-assumptions.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * A persisted graph plus a fact whose `graph_hash_at_run` MATCHES it.
 *
 * ⚠ THE FRESHNESS IS LOAD-BEARING AND WAS LEARNED THE HARD WAY. Without a
 * matching hash the freshness derivation returns `unknown`, the stale-analysis
 * recovery REPLACES the whole answer with "The last analysis may be out of
 * date…", and that replacement is not analysis-bearing — so this guard
 * correctly stands down and every assertion below would be testing the
 * staleness path instead of the guard. A wiring spec that does not reach the
 * code it names is the same class of defect this file exists to catch.
 */
const READY_GRAPH = {
  nodes: [
    { id: 'goal_crm', kind: 'goal', label: 'CRM outcome' },
    { id: 'fac_market', kind: 'factor', label: 'Market Conditions' },
    { id: 'opt_hubspot', kind: 'option', label: 'Adopt HubSpot', interventions: { fac_market: 1 } },
    { id: 'opt_hold', kind: 'option', label: 'Hold', is_baseline: true, interventions: { fac_market: 0 } },
  ],
  edges: [
    { from: 'opt_hubspot', to: 'fac_market', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_hold', to: 'fac_market', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_market', to: 'goal_crm', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
  goal_node_id: 'goal_crm',
};
const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

/** The producer's real enrichment envelope, verbatim. */
const REAL_ENRICHMENT = JSON.parse(
  readFileSync(
    new URL(
      '../compose/__tests__/fixtures/dsk-walk/session-a.enrichment.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Record<string, unknown>;

/** The same envelope with the ONE key removed — the direction twin. */
function enrichmentWithoutDefaults(): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(REAL_ENRICHMENT)) as Record<string, unknown>;
  const brief = copy['decision_brief'] as Record<string, unknown>;
  delete brief['defaulted_assumptions'];
  return copy;
}

/**
 * Which enrichment the mocked store hands back on this test. A module-scoped
 * switch because `vi.mock` is hoisted and cannot close over per-test state.
 */
let enrichmentForTurn: Record<string, unknown> = REAL_ENRICHMENT;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [
      {
        id: 'turn-prev',
        scenario_id: SCENARIO_ID,
        user_id: null,
        turn_id: 'turn-prev-id',
        turn_class: 'handler' as const,
        handler_id: 'run_analysis' as const,
        request_hash: 'sha256:prev',
        response_emitted: true,
        llm_calls_used: 1,
        duration_ms: 100,
        created_at: '2026-08-13T19:30:00.000Z',
      },
    ],
    readFactsFor: async () => [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_hubspot',
          summary: 'Prior analysis.',
          constraint_verdict: {
            may_name_leading_option: true,
            constraint_verdict_state: 'evaluated_feasible' as const,
          },
          graph_hash_at_run: READY_GRAPH_HASH,
          computed_at: new Date(Date.now() - 60_000).toISOString(),
          win_probabilities: { opt_hubspot: 0.96, opt_hold: 0.02 },
          // VERBATIM producer envelope — nothing is constructed here.
          enrichment: enrichmentForTurn,
        },
      },
    ],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => READY_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: READY_GRAPH, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation((async () => mkTextResult(text)) as never),
  };
}

const BASE_PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: SCENARIO_ID,
  message: 'how solid is this?',
  turn_class: 'frame',
  stage: 'frame',
};

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  enrichmentForTurn = REAL_ENRICHMENT;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
});

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

/** The deployed witness (13 Aug 2026, CEE `a3d74857`), verbatim in shape. */
const STABILITY_LEAK =
  "'Adopt HubSpot' currently leads, with a probability of 96%. This result looks "
  + 'stable, so smaller changes are less likely to flip the outcome on their own.';

describe('turn-executor finaliser — defaulted-value disclosure guard (WIRING)', () => {
  it('appends the disclosure exactly once to the text the wire carries', async () => {
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'how solid is this?' },
      'req-f6-wiring-discloses',
      { routingAdapter: mockRoutingAdapter(STABILITY_LEAK) },
    );

    const text = response.assistant_text ?? '';
    expect(occurrences(text, DEFAULTED_DISCLOSURE_TAIL)).toBe(1);
  });

  it('stands down the stability assertion on the text the wire carries', async () => {
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'is this stable?' },
      'req-f6-wiring-suppresses',
      { routingAdapter: mockRoutingAdapter(STABILITY_LEAK) },
    );

    const text = response.assistant_text ?? '';
    expect(text).not.toContain('This result looks stable');
    expect(text).not.toContain('less likely to flip');
    // The recited probability SURVIVES — this layer qualifies, never withholds.
    expect(text).toContain('96%');
  });

  it('emits the guard telemetry with the dispatch path', async () => {
    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'walk me through it' },
      'req-f6-wiring-telemetry',
      { routingAdapter: mockRoutingAdapter(STABILITY_LEAK) },
    );

    const evt = egressEvent();
    expect(evt, 'F6 egress telemetry should fire').toBeDefined();
    expect(evt!.data.dispatch_path).toBe('turn_executor_finalise');
    expect(evt!.data.defaulted_count).toBe(1);
    expect(evt!.data.disclosure_added).toBe(true);
  });

  /**
   * DIRECTION TWIN, through the executor. The SAME capture with ONE key
   * removed: no disclosure may appear and the guard must not fire. Without
   * this, a guard that unconditionally stapled the caveat onto every turn would
   * pass all three assertions above.
   */
  it('adds NOTHING when the same run defaulted nothing', async () => {
    enrichmentForTurn = enrichmentWithoutDefaults();

    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'how solid is this?' },
      'req-f6-wiring-no-defaults',
      { routingAdapter: mockRoutingAdapter(STABILITY_LEAK) },
    );

    const text = response.assistant_text ?? '';
    expect(text).not.toContain(DEFAULTED_DISCLOSURE_TAIL);
    expect(text).toContain('This result looks stable');
    expect(egressEvent()).toBeUndefined();
  });

  /**
   * An answer that makes no analysis claim must not collect the caveat, or the
   * disclosure becomes boilerplate and stops being read — the harm the
   * analysis-bearing gate exists to prevent, asserted here at the wire rather
   * than only on the pure function.
   */
  it('leaves a non-analysis answer untouched', async () => {
    const receipt = "I've noted that. What would you like to look at next?";
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'thanks' },
      'req-f6-wiring-receipt',
      { routingAdapter: mockRoutingAdapter(receipt) },
    );

    expect(response.assistant_text).toBe(receipt);
    expect(egressEvent()).toBeUndefined();
  });
});
