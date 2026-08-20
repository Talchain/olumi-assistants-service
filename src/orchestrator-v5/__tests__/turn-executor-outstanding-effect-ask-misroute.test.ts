/**
 * ⭐⭐ THE GUARD IS WIRED — the two witnessed wrong writes never reach the graph,
 * and the chip that offered one is never minted.
 *
 * A resolver nothing routes to is dark code (CLAUDE.md trap 16), and the unit
 * spec beside `outstanding-effect-ask-misroute.ts` proves only that the module
 * answers correctly. THIS spec asserts the property at the PERSISTENCE BOUNDARY
 * — `append`'s `graph` — through the real `runTurnExecutor`, exactly as its
 * sibling `mutation-warrant-consent-parity.test.ts` does, and for the same
 * reason: the witnessed build's WORDS were partly honest; the WRITE was the
 * defect.
 *
 * ── THE FIXTURE IS CAPTURED, NOT AUTHORED (trap 16: *a fixture you wrote
 * yourself is not evidence about the wire*). `witness-2026-08-18/
 * model-compiler-option-effect.json` is a real drafted graph from a deployed
 * fresh-guest journey. It carries eight outstanding `MISSING_OPTION_VALUE`
 * pairs and option → factor edges whose `strength.mean` is **1** — the same
 * shape the 20 Aug browser witness saw written down to 0.6.
 *
 * ── EVERY REFUSAL HAS A POSITIVE CONTROL (trap 13). The "no chip was offered"
 * and "nothing was written" assertions each sit beside a run of the SAME
 * harness, SAME adapter and SAME graph that DOES produce the chip / DOES land
 * the write, so an assertion cannot pass because the harness went blind.
 *
 * ── AND AN OPPOSITE-DIRECTION TWIN (trap 22b). The factor arm's twin is the
 * load-bearing one: the SAME factor, the SAME value, WITHOUT effect framing,
 * must still be written. Measured at this tip, the two messages differ only in
 * the classifier's own trigger — `effect_vocab` vs `option_value_set`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { safeLabel } from '../compose/helpers.js';
import { resolveOptionEffectWrite } from '../routing/option-effect-write.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) persistedGraph = write.graph;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// ---------------------------------------------------------------------------
// THE CAPTURED GRAPH AND ITS IDENTITIES.
// ---------------------------------------------------------------------------
interface WitnessFixture {
  readonly ids: {
    readonly option_id: string;
    readonly option_label: string;
    readonly factor_id: string;
    readonly factor_label: string;
  };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}
const J18 = JSON.parse(
  readFileSync(
    new URL('./fixtures/witness-2026-08-18/model-compiler-option-effect.json', import.meta.url),
    'utf8',
  ),
) as WitnessFixture;

const OPTION_ID = J18.ids.option_id;
const FACTOR_ID = J18.ids.factor_id;
/** The outstanding pair, in the handler's own `from→to` edge spelling. */
const OUTSTANDING_EDGE = `${OPTION_ID}→${FACTOR_ID}`;
/** A factor → outcome link. Nothing is outstanding on it (asserted below). */
const UNRELATED_EDGE = '4d3256b4→ce6b11d2';

function graph(): GraphV3T {
  return JSON.parse(JSON.stringify(J18.draft_graph)) as GraphV3T;
}

/**
 * The witnessed defect-A utterance shape: an OPINION carrying a number, no
 * imperative — so INV-1 finds no mutation warrant and the proposal is DEMOTED
 * to the "Adjust this link" chip rather than executed.
 */
const OPINION_NO_WARRANT = 'I would say it drives sales headcount fairly strongly, about 0.6.';
/** Defect B, effect-framed with the option referred to only by a pronoun. */
const EFFECT_FRAMED = `Set its effect on ${J18.ids.factor_label} to 0.8.`;
/** Defect B's TWIN: the same factor, the same value, an ordinary baseline edit. */
const BASELINE_EDIT = `Set ${J18.ids.factor_label} to 0.8.`;

/**
 * The chip literal the browser witness captured, verbatim. Bound as a string
 * because it is the user-visible artefact under test — `warrant-demotion.ts`'s
 * `CHIP_COPY.adjust_edge_strength.label`, the estate's only producer of it.
 */
const WITNESSED_CHIP_LABEL = 'Adjust this link';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
  });
}

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function edgeStrengthAdapter(edgeId: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'adjust_edge_strength',
            entity: {
              id: edgeId,
              kind: 'edge',
              label: edgeId,
              resolution_status: 'resolved',
              resolution_method: 'label_match',
            },
            parameters: [{ name: 'strength', value: 0.6, source: 'user_explicit' }],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

function setFactorValueAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'set_factor_value',
            entity: {
              id: FACTOR_ID,
              kind: 'node',
              label: J18.ids.factor_label,
              resolution_status: 'resolved',
              resolution_method: 'label_match',
            },
            parameters: [{ name: 'value', value: { value: 0.8 }, source: 'user_explicit' }],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

/** Every graph write this turn made. Empty === the model is untouched. */
function graphWrites(): AppendWrite[] {
  return appendCalls.filter((c) => c.graph !== undefined && c.graph !== null);
}

/** TRAP 19 — the factor by IDENTITY, never "the node whose value is 0.8". */
function factorValue(g: unknown): unknown {
  const nodes = (g as { nodes?: Array<Record<string, unknown>> }).nodes ?? [];
  const node = nodes.find((n) => n.id === FACTOR_ID) as
    | { observed_state?: { value?: unknown } }
    | undefined;
  return node?.observed_state?.value;
}

beforeEach(() => {
  appendCalls.length = 0;
  persistedGraph = null;
  setTestSink(() => undefined);
});
afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('DEFECT A — the offer against the product’s own blocker', () => {
  it('⭐ THE WITNESSED OFFER IS NEVER MINTED: no "Adjust this link" chip on the outstanding pair’s edge', async () => {
    const { response } = await runTurnExecutor(
      payload(OPINION_NO_WARRANT),
      'req-effect-ask-edge-refused',
      { routingAdapter: edgeStrengthAdapter(OUTSTANDING_EDGE), graphState: graph() },
    );

    const chipLabels = (response.suggested_actions ?? []).map((c) => c.label);
    expect(chipLabels).not.toContain(WITNESSED_CHIP_LABEL);
    // …and nothing was written either way.
    expect(graphWrites()).toHaveLength(0);
    // The refusal NAMES the entity — the whole point of the fix.
    expect(response.assistant_text).toContain(J18.ids.factor_label);
    expect(response.assistant_text.toLowerCase()).not.toContain('applied');
  });

  it('⭐ POSITIVE CONTROL — the SAME adapter on an UNRELATED edge still offers the chip', async () => {
    // Without this the assertion above could pass because the harness never
    // produces that chip at all (trap 13: an absence needs a presence first).
    const { response } = await runTurnExecutor(
      payload(OPINION_NO_WARRANT),
      'req-effect-ask-edge-control',
      { routingAdapter: edgeStrengthAdapter(UNRELATED_EDGE), graphState: graph() },
    );
    const chipLabels = (response.suggested_actions ?? []).map((c) => c.label);
    expect(chipLabels).toContain(WITNESSED_CHIP_LABEL);
  });
});

describe('DEFECT B — the effect-framed sentence whose option is a pronoun', () => {
  it('⭐ THE WITNESSED WRITE NEVER LANDS: the factor’s own value is untouched', async () => {
    const { response } = await runTurnExecutor(
      payload(EFFECT_FRAMED),
      'req-effect-ask-factor-refused',
      { routingAdapter: setFactorValueAdapter(), graphState: graph() },
    );

    expect(graphWrites()).toHaveLength(0);
    expect(persistedGraph).toBeNull();
    // The refusal names BOTH the entity and the option it is still waiting on.
    // The option is asserted through `safeLabel` — the estate's own user-facing
    // renderer — rather than as the raw 84-character brief fragment, because
    // that renderer TRUNCATES and the raw form never reaches a screen.
    expect(response.assistant_text).toContain(J18.ids.factor_label);
    expect(response.assistant_text).toContain(
      safeLabel({ label: J18.ids.option_label, kind: undefined }),
    );
    expect(response.assistant_text.toLowerCase()).not.toContain('applied');
    // …and it names the FIELD the request would have moved instead. This is the
    // half the witnessed "Applied" badge never carried.
    expect(response.assistant_text).toContain(`${J18.ids.factor_label}'s own value`);
  });

  it('⭐⭐ THE SENTENCE THE REFUSAL ADVISES ROUTES BACK AND BINDS THE SAME PAIR — no dead end', async () => {
    // The estate's most expensive recurring defect is advising a phrasing the
    // product cannot execute (P8, `option-effect-write.ts`'s header). A refusal
    // that hands the user an unroutable exemplar has replaced a wrong write with
    // a loop, which is not an improvement. So: take the exemplar OUT of the
    // rendered copy and feed it to the writer.
    const { response } = await runTurnExecutor(
      payload(EFFECT_FRAMED),
      'req-effect-ask-exemplar-routes',
      { routingAdapter: setFactorValueAdapter(), graphState: graph() },
    );
    const quoted = /"([^"]+)"/.exec(response.assistant_text);
    expect(quoted).not.toBeNull();
    const exemplar = quoted![1]!;
    // Bound by identity to the pair the refusal was about — not merely "it
    // matched something".
    expect(resolveOptionEffectWrite({ message: `${exemplar}.`, graph: graph() })).toMatchObject({
      matched: true,
      kind: 'write',
      optionId: OPTION_ID,
      factorId: FACTOR_ID,
    });
  });

  it('⭐⭐ OPPOSITE-DIRECTION TWIN — the SAME factor and value WITHOUT effect framing still writes', async () => {
    const before = factorValue(graph());
    await runTurnExecutor(payload(BASELINE_EDIT), 'req-effect-ask-factor-twin', {
      routingAdapter: setFactorValueAdapter(),
      graphState: graph(),
    });

    expect(graphWrites().length).toBeGreaterThan(0);
    expect(factorValue(persistedGraph)).toBe(0.8);
    expect(factorValue(persistedGraph)).not.toBe(before);
  });
});
