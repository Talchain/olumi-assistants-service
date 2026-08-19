/**
 * ⭐⭐ ROADMAP 2.1266 / A3 — THE MOUNT. THE REDIRECT'S ONLY CONSUMER, DRIVEN.
 *
 * ⚠⚠ WHY THIS FILE EXISTS, stated as the defect it closes rather than as a
 * feature it covers. `resolveOutstandingAskClarifyRedirect` has exactly ONE
 * call site — `turn-executor.ts`'s `dispatch === 'clarify'` branch — and before
 * this file NO test at any level exercised that call site with the redirect
 * ACTIVE. The two clarify tests that could have
 * (`orchestrate-v2-clarify-reply-two-turn`, `clarification-resume-route-level`)
 * both drive TWO candidates, so `chip_clarify_factor_1` is present, the
 * redirect's conjunct (b) fails, and the redirect never fires in them.
 *
 * ⭐ MEASURED CONSEQUENCE, not an argument: reverting the pending-suppression
 * at the call site to `deterministicValueUpdate.candidates` — i.e. RESTORING
 * THE EXACT WITNESSED WRONG WRITE, the `set_factor_value` pending the
 * clarification resumer applied two turns later to move
 * `3a75cabd.observed_state.value` 0.5 → 0.8 — left the whole suite GREEN. The
 * PR's own body calls that pending removal *"the half that actually stopped
 * the witnessed write"*. A fix whose removal turns nothing red is not guarded.
 *
 * WHAT IS ASSERTED, BY IDENTITY (trap 19 — never a value predicate another
 * object could satisfy):
 *   (a) the commit carries `pending_actions: []` — NO factor-baseline proposal
 *       is held at all, so there is nothing for the resumer to apply;
 *   (b) the emitted chip is `chip_prompt_option_effect_bind_1`, carrying the
 *       product's own advised-format message for the ASKED pair.
 *
 * ⚠ THE FIXTURE INPUTS ARE DERIVED BY RUNNING THE PRODUCER, NEVER HAND-WRITTEN
 * (trap 16-inverse: *a fixture you wrote yourself is not evidence about the
 * wire*). The candidates and the quantity come out of
 * `tryDeterministicValueUpdate` on the RUN-B witness graph, and the pre-route's
 * verdict is asserted in-test BEFORE the executor is driven — so this file
 * cannot pass on a turn that never reached the branch it claims to pin
 * (trap 13b: a guard must pin its own precondition).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = randomUUID();

/** Every `store.append` write this turn performed — the pendings authority. */
const appendCalls: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { extractQuantities } = await import('../context/cqe/extract-quantities.js');
const { buildGraphLookup } = await import('../routing/graph-lookup-adapter.js');
const { tryDeterministicValueUpdate } = await import(
  '../routing/deterministic-value-update.js'
);
const { buildCanonicalAnalysisReadyFromGraph } = await import(
  '../../orchestrator/tools/analysis-ready-helper.js'
);
const { deriveAskedEffectPair } = await import('../routing/repair-value-binding.js');
const { buildConfigureOptionAdvisedFormat } = await import(
  '../configure-option-chip-text.js'
);

interface RunBFixture {
  readonly ids: {
    readonly asked_option_id: string;
    readonly asked_option_label: string;
    readonly asked_factor_id: string;
    readonly asked_factor_label: string;
  };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}

const WITNESS = JSON.parse(
  readFileSync(
    new URL('./fixtures/witness-2026-08-18/composed-journey-run-b.json', import.meta.url),
    'utf8',
  ),
) as RunBFixture;

const OPTION_ID = WITNESS.ids.asked_option_id;
const OPTION_LABEL = WITNESS.ids.asked_option_label;
const FACTOR_ID = WITNESS.ids.asked_factor_id;
const FACTOR_LABEL = WITNESS.ids.asked_factor_label;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const graph = () => clone(WITNESS.draft_graph);

/**
 * ⭐ A SINGLE-CANDIDATE ANSWER. The witnessed R1 sentence now BINDS through
 * `resolveOptionEffectWrite` (that is #1037's other half), so it no longer
 * reaches the clarify branch at all. This message does: measured below, it is
 * declined by the answered-ask writer and claimed by the factor-baseline
 * pre-route with ONE candidate — the asked factor. That is the shape the
 * redirect exists for, and the shape no existing test drives.
 */
const SINGLE_CANDIDATE_MESSAGE = 'Set sales headcount to 0.8.';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: randomUUID(),
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('the deterministic clarify pre-route must claim this turn');
      }),
  };
}

describe('2.1266 / A3 — the outstanding-ask redirect AT ITS MOUNT (turn-executor clarify branch)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('⭐ a SINGLE-candidate clarify emits the option-effect chip and holds NO factor-baseline pending', async () => {
    // ── PRECONDITION, DERIVED FROM THE PRODUCER AND PINNED IN-TEST ────────
    // Without this the assertions below could pass on a turn that never
    // reached the branch (trap 13b). The candidates and the quantity the
    // redirect consumes are NOT hand-authored — they are read off
    // `tryDeterministicValueUpdate`, the same call the executor makes.
    const built = buildGraphLookup({
      nodes: graph().nodes,
      edges: graph().edges,
    } as unknown as Parameters<typeof buildGraphLookup>[0]);
    if (built.kind !== 'ok') throw new Error(`graph lookup ${built.kind}`);
    const factorIds = new Set(
      graph().nodes.filter((n) => n.kind === 'factor').map((n) => n.id as string),
    );
    const dispatch = tryDeterministicValueUpdate(
      SINGLE_CANDIDATE_MESSAGE,
      extractQuantities(SINGLE_CANDIDATE_MESSAGE),
      built.lookup,
      [],
      factorIds,
      false,
    );
    expect(dispatch.matched && dispatch.dispatch).toBe('clarify');
    if (!dispatch.matched || dispatch.dispatch !== 'clarify') throw new Error('unreachable');
    // EXACTLY ONE candidate, and it IS the factor the product is asking about —
    // the redirect's conjunct (b). The two existing clarify tests both carry
    // TWO candidates, which is precisely why neither could reach this code.
    expect(dispatch.candidates.map((c) => c.id)).toEqual([FACTOR_ID]);
    expect(dispatch.quantity.value).toBe(0.8);
    expect(dispatch.quantity.approximate).toBe(false);
    // …and the product IS asking for this option's effect on it (conjunct (a)).
    const asked = deriveAskedEffectPair(buildCanonicalAnalysisReadyFromGraph(graph()));
    expect(asked).not.toBeNull();
    expect([asked!.optionId, asked!.factorId]).toEqual([OPTION_ID, FACTOR_ID]);

    // ── DRIVE THE MOUNT ──────────────────────────────────────────────────
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload(SINGLE_CANDIDATE_MESSAGE),
      `req-${randomUUID()}`,
      { routingAdapter: adapter, graphState: graph() as never },
    );
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);

    // (b) THE CHIP, BY IDENTITY. `chip_clarify_factor_0` is the witnessed
    //     factor-baseline chip; its absence is asserted alongside the new id so
    //     a partial revert cannot pass by emitting both.
    const chips = (result.response.suggested_actions ?? []) as ReadonlyArray<{
      id: string;
      label: string;
      message: string;
    }>;
    expect(chips.map((c) => c.id)).toEqual(['chip_prompt_option_effect_bind_1']);
    expect(chips[0]!.message).toBe(
      `${buildConfigureOptionAdvisedFormat(OPTION_LABEL, FACTOR_LABEL, '0.8')}.`,
    );
    // The advised format names the OPTION'S EFFECT, never the factor baseline.
    expect(chips[0]!.message).toContain("option's effect on");
    expect(chips[0]!.message).not.toBe(`Set ${FACTOR_LABEL} to 0.8.`);

    // (a) NO PENDING IS HELD. This is the half that actually stopped the
    //     witnessed write: the user never clicked the chip — it was the
    //     PENDING the resumer applied two turns later.
    expect(appendCalls.length).toBeGreaterThan(0);
    const committed = appendCalls[appendCalls.length - 1]!;
    expect(committed.pending_actions).toEqual([]);
    // Stated as the identity claim too, so a future non-empty list of some
    // other kind still REDs on the line above rather than reading as fine.
    const pendings = committed.pending_actions as ReadonlyArray<{
      chip_id: string;
      action: { kind: string; factor_id?: string };
    }>;
    expect(
      pendings.filter((p) => p.action.kind === 'set_factor_value' && p.action.factor_id === FACTOR_ID),
    ).toEqual([]);
  });
});
