/**
 * Brief 4 — E1-gated structural action honesty (CEE-native gate).
 *
 * Ports the red-eval E1 CONTRACT into a CEE test that exercises the REAL
 * turn-executor against the FIXED code. The frozen historical replay
 * (`_audit-artefacts/.../E1.add_option_must_mutate_or_decline.test.mjs`)
 * stays RED as evidence of the deployed bug; THIS file is the green CI gate.
 *
 * The captured failure (`c92614a8` turn `f15ede2f`): an intent-miss /
 * direct-answer turn (turn_class=direct_answer, handler_id=null) where Sonnet
 * replied "I'll add the \"Coach …\" option to your model now …", NO durable
 * typed operation committed, the graph never gained the option, and a later
 * turn contradicted the claim. Invariant: never emit structural-success copy
 * unless a typed mutation actually committed.
 *
 * RED-FIRST NOTE: this file is intentionally SELF-CONTAINED. It does NOT
 * import the new gate symbols (containsStructuralSuccessClaim /
 * V5_STRUCTURAL_DECLINE_TEXT / classifyStructuralClaim). It asserts the
 * end-to-end BEHAVIOUR (the leak is gone, the decline shipped), so on
 * unmodified `7479cda4` the swap assertions fail BEHAVIOURALLY (the success
 * claim still ships) — not as a missing-symbol import error. The expected
 * decline copy is duplicated as a literal here and pinned to the exported
 * constant by the unit test (mutation-language.test.ts).
 */

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Stateful session-store mock (no Supabase). Captures append writes and
// serves a persisted graph so the set_factor_value reverse-trust case can
// commit a real mutation.
// ---------------------------------------------------------------------------

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  turn_class?: unknown;
  handler_facts?: unknown;
  assistantMessage?: unknown;
  pending_actions?: unknown;
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) {
        currentPersistedGraph = write.graph;
      }
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => currentPersistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: currentPersistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// E1 contract oracle — VERBATIM from the red-eval pack so this CEE test
// asserts the identical contract. (Source: E1.add_option_must_mutate_or_decline)
// ---------------------------------------------------------------------------

const SUCCESS_CLAIM: readonly RegExp[] = [
  /\bI['’]?ll add\b/i,
  /\bI['’]?ve added\b/i,
  /\bI have added\b/i,
  /add(?:ing|ed)?\b[^.]*\boption\b[^.]*\bnow\b/i,
  /\boption\b[^.]*\bto your model now\b/i,
];
const hasSuccessClaim = (txt: unknown): boolean =>
  typeof txt === 'string' && SUCCESS_CLAIM.some((p) => p.test(txt));

/**
 * Approved decline copy (Brief 4 req #6): no em dash, no canvas-capability
 * claim. Pinned to the exported `V5_STRUCTURAL_DECLINE_TEXT` constant by
 * mutation-language.test.ts so the two cannot silently diverge.
 */
const EXPECTED_DECLINE =
  "I haven't changed the model. This version can't make that kind of model edit yet.";

// The verbatim captured false-success turn (c92614a8 / f15ede2f).
const E1_CAPTURED_CLAIM =
  'I\'ll add the "Coach Internal Developer into Tech Lead Role" option to your model now, connecting it to the relevant factors as discussed.';

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

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
      .mockResolvedValue(mkTextResult(text)),
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on the deterministic value-update path');
      }),
  };
}

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload(message: string, turnId: string, stage: 'frame' | 'decide' = 'frame'): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: stage,
    stage,
  };
}

// EXP-01 captured fixtures (reused from the D1 mutation harness) — let the
// set_factor_value deterministic pre-route commit a real graph mutation.
const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(new URL('./fixtures/exp01/rich-persisted-graph.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(new URL('./fixtures/exp01/echo-graph-state.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
const swapEvents = (): Event[] => events.filter((e) => e.event === 'v5.structural_success_claim_swapped');
const monitorEvents = (): Event[] =>
  events.filter((e) => e.event === 'v5.structural_success_claim_candidate_miss');

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  appendCalls.length = 0;
  currentPersistedGraph = null;
});
afterEach(() => setTestSink(null));

// ---------------------------------------------------------------------------
// E1 behavioural gate — intent-miss / direct-answer must not leak success
// ---------------------------------------------------------------------------

describe('E1 — structural success claim is swapped to an honest decline (no commit)', () => {
  it('verbatim captured false-success (turn_class=direct_answer, handler_id=null) → declines, no leak on ANY derived surface', async () => {
    const { response, turn_outcome } = await runTurnExecutor(
      payload('1. A new option, "Coach Internal Developer into Tech Lead Role"', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),
      'req-e1-verbatim',
      { routingAdapter: mockRoutingAdapter(E1_CAPTURED_CLAIM) },
    );

    OlumiResponseSchema.parse(response); // still a valid envelope

    // (1) final assistant text: the swap shipped, the claim did not.
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(hasSuccessClaim(response.assistant_text)).toBe(false);

    // (2) no durable mutation this turn.
    expect(turn_outcome?.graph_mutated ?? false).toBe(false);

    // (3) stored turn text (durable public form) carries no claim.
    const stored = appendCalls.at(-1)!;
    expect(hasSuccessClaim(stored.assistantMessage)).toBe(false);

    // (4) no graph_patch block.
    const blocks = (response.blocks ?? []) as Array<Record<string, unknown>>;
    expect(blocks.some((b) => b.block_type === 'graph_patch' || b.type === 'graph_patch')).toBe(false);

    // (5) no pending action / proposal capture implying the change was made.
    const pendings = (stored.pending_actions ?? []) as unknown[];
    expect(JSON.stringify(pendings).toLowerCase()).not.toContain('coach');

    // (6) telemetry: exactly one swap event, carrying only safe metadata.
    expect(swapEvents()).toHaveLength(1);
    const ev = swapEvents()[0]!.data;
    expect(typeof ev.text_length).toBe('number');
    // No raw assistant text in telemetry.
    for (const v of Object.values(ev)) {
      if (typeof v === 'string') {
        expect(v.toLowerCase()).not.toContain('coach');
        expect(hasSuccessClaim(v)).toBe(false);
      }
    }
  });

  it('route-level intent miss ("Start by adding this option...") still gets contained', async () => {
    const { response } = await runTurnExecutor(
      payload('Start by adding this option to my model: Coach Internal Developer into Tech Lead Role', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02'),
      'req-e1-intent-miss',
      { routingAdapter: mockRoutingAdapter("Sure — I'll add that option to your model now.") },
    );
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(1);
  });

  it('past-tense completion claim → declines', async () => {
    const { response } = await runTurnExecutor(
      payload('continue please', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03'),
      'req-e1-pasttense',
      { routingAdapter: mockRoutingAdapter("I've added the Coach option to the model.") },
    );
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(1);
  });

  it('high-confidence claim with an unambiguous structural noun ("added a factor") → declines', async () => {
    const { response } = await runTurnExecutor(
      payload('do that', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09'),
      'req-e1-edge',
      { routingAdapter: mockRoutingAdapter("I've added a new factor to your model.") },
    );
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Conservative — advisory / benign phrasing must be PRESERVED (not swapped)
// ---------------------------------------------------------------------------

describe('conservative — advisory and benign phrasing is preserved', () => {
  // NB: the converse path legitimately sanitises prose (e.g. em-dash → ",").
  // "Preserved" therefore means "not swapped to the decline + content intact",
  // asserted on a stable substring rather than byte-exact equality.
  it('advisory suggestion ("you could add an option") is NOT swapped', async () => {
    const text = 'You could add an option called Coach if that helps the comparison.';
    const { response } = await runTurnExecutor(
      payload('what else?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05'),
      'req-adv-1',
      { routingAdapter: mockRoutingAdapter(text) },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect((response.assistant_text ?? '').toLowerCase()).toContain('you could add an option');
    expect(swapEvents()).toHaveLength(0);
  });

  it('advisory "I\'d suggest adding a factor" is NOT swapped, but IS flagged as a candidate miss (monitor)', async () => {
    const text = "I'd suggest adding a competitive risk factor to capture market dynamics.";
    const { response } = await runTurnExecutor(
      payload('any gaps?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06'),
      'req-adv-2',
      { routingAdapter: mockRoutingAdapter(text) },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE); // preserved
    expect((response.assistant_text ?? '').toLowerCase()).toContain('competitive risk factor');
    expect(swapEvents()).toHaveLength(0); // never swapped on advisory
    expect(monitorEvents()).toHaveLength(1); // broad-language candidate FN surfaced
  });

  it('benign pronoun phrase ("I\'ll add that to my notes") is NOT swapped', async () => {
    const text = "I'll add that to my notes for the write-up.";
    const { response } = await runTurnExecutor(
      payload('remember this', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07'),
      'req-benign',
      { routingAdapter: mockRoutingAdapter(text) },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect((response.assistant_text ?? '').toLowerCase()).toContain('to my notes');
    expect(swapEvents()).toHaveLength(0);
  });

  it('legitimate read-out ("your model now has four options") is NOT swapped', async () => {
    const text = 'Your model now has four options ready to compare.';
    const { response } = await runTurnExecutor(
      payload('what do I have so far?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10'),
      'req-readout',
      { routingAdapter: mockRoutingAdapter(text) },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect((response.assistant_text ?? '').toLowerCase()).toContain('four options');
    expect(swapEvents()).toHaveLength(0);
  });

  it('grounded "model now includes/contains" read-out is NOT swapped (review round 3)', async () => {
    const text = 'The model now contains three factors and two existing options.';
    const { response } = await runTurnExecutor(
      payload('summarise the model', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11'),
      'req-readout-includes',
      { routingAdapter: mockRoutingAdapter(text) },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect((response.assistant_text ?? '').toLowerCase()).toContain('three factors');
    expect(swapEvents()).toHaveLength(0);
  });

  it('idiom with an edge verb ("connected the dots between") is NOT swapped', async () => {
    const text = 'I connected the dots between cost and growth for you.';
    const { response } = await runTurnExecutor(
      payload('explain', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12'),
      'req-idiom',
      { routingAdapter: mockRoutingAdapter(text) },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('noun-less edge claim ("I connected X to Y") with NO edit intent is NOT swapped but IS monitored', async () => {
    const text = 'I connected Marketing to Revenue.';
    const { response } = await runTurnExecutor(
      payload('hook them up', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13'),
      'req-edge-residual',
      { routingAdapter: mockRoutingAdapter(text) },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE); // not false-declined
    expect(swapEvents()).toHaveLength(0);
    expect(monitorEvents()).toHaveLength(1); // surfaced, not lost
  });
});

// ---------------------------------------------------------------------------
// Intent-gated rail — noun-less / actorless claims SWAP when the USER requested
// a structural edit this turn (the round-4 fix).
// ---------------------------------------------------------------------------

describe('intent-gated — structural-edit request + broad claim → declines', () => {
  it('add-option intent + noun-less edge claim → swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Add a new option, then hook it up', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14'),
      'req-intent-edge',
      { routingAdapter: mockRoutingAdapter('Done, I connected Marketing to Revenue.') },
    );
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(1);
  });

  it('add-option request + actorless "model now includes" claim → swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Add a new option called Coach', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15'),
      'req-intent-state',
      { routingAdapter: mockRoutingAdapter('Your model now includes the Coach option.') },
    );
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(1);
  });

  // Codex blocker 4 — edit/update request on the model + vague false success.
  it('"Update the model to include a new option" + "I updated it" → swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Update the model to include a new option', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa16'),
      'req-intent-edit',
      { routingAdapter: mockRoutingAdapter('Done, I updated it.') },
    );
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Codex round-5 preservation cases — must NOT swap (no false declines).
// ---------------------------------------------------------------------------

describe('Codex round-5 — preserved (not swapped)', () => {
  it('state/read-out question ("Did you add an option?") + state answer → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Did you add an option?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa17'),
      'req-statequery',
      { routingAdapter: mockRoutingAdapter('Your model now includes four options.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('social connection request ("connect Alice with Bob") + social claim → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Can you connect Alice with Bob?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa18'),
      'req-social',
      { routingAdapter: mockRoutingAdapter('Sure, I connected Alice with Bob.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('conditional advice ("I would add … if …") even under edit intent → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Could you add a risk factor?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa19'),
      'req-conditional',
      { routingAdapter: mockRoutingAdapter('I would add a risk factor if we needed more sensitivity.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reverse-trust — a REAL committed mutation is NOT swapped (isDraftOrEditGraph
// branch is unit-proven in mutation-language.test.ts; here we prove the
// handlerEmittedMutatedGraph branch end-to-end through the real pipeline).
// ---------------------------------------------------------------------------

describe('reverse-trust — committed scalar mutation is never swapped', () => {
  it('set_factor_value commits a real graph mutation → text preserved, graph_mutated=true, no swap', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);
    const { response, turn_outcome } = await runTurnExecutor(
      payload('Set the Local Senior Hire Indicator factor to 1.0.', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08', 'decide'),
      'req-scalar',
      { routingAdapter: throwingRoutingAdapter(), graphState: clone(ECHO_GRAPH_STATE) as never },
    );
    expect(turn_outcome?.graph_mutated).toBe(true);
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
    // The mutation really committed (handler fact / set_factor_value handler_id).
    const mutationWrite = appendCalls.at(-1)!;
    expect(mutationWrite.handler_id).toBe('set_factor_value');
    // Durable persistence (Brief 4 review): the COMMITTED graph reflects the
    // change, not just the derived metadata flag — the factor value moved to 1.
    const committed = mutationWrite.graph as { nodes?: Array<{ id: string; observed_state?: { value?: number } }> };
    const mutatedNode = (committed.nodes ?? []).find((n) => n.id === 'fac_local_hire');
    expect(mutatedNode?.observed_state?.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Codex round-6 — possessive state query / passive success / ambiguous edge.
// ---------------------------------------------------------------------------

describe('Codex round-6 — state query, passive success, ambiguous edge', () => {
  it('possessive state query ("Does your model include an option?") + read-out → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Does your model include an option?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20'),
      'req-possessive-statequery',
      { routingAdapter: mockRoutingAdapter('Your model now includes four options.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('passive success ("The option has been added.") under add-intent → swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Add a new option called Coach', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21'),
      'req-passive-add',
      { routingAdapter: mockRoutingAdapter('The option has been added.') },
    );
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(1);
  });

  it('passive structural success ("The factor has been changed.") under intent → swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Change the churn factor structure', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22'),
      'req-passive-struct',
      { routingAdapter: mockRoutingAdapter('The factor has been changed.') },
    );
    expect(response.assistant_text).toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(1);
  });

  it('non-graph doc link ("I created a link to the documentation") → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('where are the docs?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa23'),
      'req-doclink',
      { routingAdapter: mockRoutingAdapter('I created a link to the documentation.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('non-graph social connection ("I established a connection with the team") → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('introduce me to the team', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa24'),
      'req-socialconn',
      { routingAdapter: mockRoutingAdapter('I established a connection with the team.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Codex round-7 — non-graph context (documentation/presentation), people/doc
// edges, and passive change verbs. Exclusions must apply across the path.
// ---------------------------------------------------------------------------

describe('Codex round-7 — non-graph context & ambiguous edges preserved', () => {
  it('"update the model documentation" → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Please update the model documentation.', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa30'),
      'req-model-docs',
      { routingAdapter: mockRoutingAdapter('I updated the model documentation.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('"change the model presentation" → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Change the model presentation.', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa31'),
      'req-model-pres',
      { routingAdapter: mockRoutingAdapter('I changed the model presentation.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('"add an option to the presentation" → NOT swapped (unconditional noun guarded)', async () => {
    const { response } = await runTurnExecutor(
      payload('Can you add an option to the presentation?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa32'),
      'req-option-pres',
      { routingAdapter: mockRoutingAdapter('I added an option to the presentation.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('people edge ("relationship between Alice and Bob") → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Create a relationship between Alice and Bob.', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa33'),
      'req-people-edge',
      { routingAdapter: mockRoutingAdapter('I established a relationship between Alice and Bob.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });

  it('doc edge ("link between the release notes and the documentation") → NOT swapped', async () => {
    const { response } = await runTurnExecutor(
      payload('Add a link between the release notes and the documentation.', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa34'),
      'req-doc-edge',
      { routingAdapter: mockRoutingAdapter('I added a link between the release notes and the documentation.') },
    );
    expect(response.assistant_text).not.toBe(EXPECTED_DECLINE);
    expect(swapEvents()).toHaveLength(0);
  });
});
