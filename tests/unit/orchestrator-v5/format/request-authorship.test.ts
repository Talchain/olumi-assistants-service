/**
 * ⭐⭐⭐ THE ACCEPTANCE ASSERTION FOR "THE ASSISTANT MUST NOT CALL A NUMBER YOU
 * TYPED ITS OWN ESTIMATE" — AND IT IS DELIBERATELY NOT A HELPER-LEVEL TEST.
 *
 * The first head of this change taught `compactGraph` to read authorship from
 * `observed_state.source`, and proved it with fifteen tests against the
 * COMPACTED STATE. All fifteen were green and the product was unchanged,
 * because the field died one hop later: `format-graph-for-context.ts`
 * `projectNode` built the display-safe node WITHOUT any authorship field, and
 * `model-facing-context-pack.ts` then replaces the raw graph with that display
 * graph before serialization. An independent review executed the production
 * selector → compactor → assembler → display formatter → `routeWithToolUse`
 * chain and measured the consequence exactly:
 *
 *   > Changing only the target source `user_override` ↔ `cee_inference`
 *   > changes the compact graph but produces BYTE-IDENTICAL entire request
 *   > text.
 *
 * A correction the model cannot observe is not a correction. So this spec
 * asserts on THE ACTUAL ADAPTER-BOUND REQUEST — the `ChatWithToolsArgs` object
 * handed to the provider adapter, serialized — and not on the return value of
 * any helper in the chain. That is the whole point of the file: every
 * intermediate stage can be green while the bytes on the wire are identical,
 * and only a test at this boundary can tell the difference.
 *
 * ── WHAT IS REAL HERE AND WHAT IS STUBBED ─────────────────────────────────
 * REAL: `selectContextGraphSnapshot`, `compactSelectedGraphForContextPack`,
 * `assembleContextPack`, `projectModelFacingContextPack`, `routeWithToolUse`
 * and the whole display projection — the production path.
 * STUBBED: the prompt loader (so the test does not depend on a prompt version)
 * and the provider adapter (so nothing leaves the process). The stub adapter is
 * the CAPTURE POINT, which is why it can see the real request.
 *
 * ⚠ SCOPE, STATED SO IT IS NOT OVER-READ (CLAUDE.md trap 20). This is an
 * OFFLINE assertion about the bytes CEE builds. It is CODE EXISTS → TESTED. It
 * is NOT a deployed witness, and it does NOT measure what the assistant then
 * SAYS — the context payload is a necessary condition for the model to speak
 * truthfully about authorship, never proof that it does (trap 23). The honest
 * outcome metric is a wire-witnessed turn after a real edit, and it is not
 * measured here.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../../src/adapters/llm/types.js';
import { GraphV3 } from '../../../../src/schemas/cee-v3.js';
import { selectContextGraphSnapshot } from '../../../../src/orchestrator-v5/context/context-graph-snapshot.js';
import { compactSelectedGraphForContextPack } from '../../../../src/orchestrator-v5/context/compact-graph-for-contextpack.js';
import { assembleContextPack } from '../../../../src/orchestrator-v5/context/context-pack-assembler.js';
import { routeWithToolUse } from '../../../../src/orchestrator-v5/routing/route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../../../../src/orchestrator-v5/routing/tool-schema.js';
import { makeMessagePayload } from '../../../../src/orchestrator-v5/__tests__/fixtures.js';

vi.mock('../../../../src/orchestrator-v5/routing/prompt-loader.js', () => ({
  LOADED_PROMPT: { text: 'OFFLINE CONTROL PROMPT', version: 'offline', hash: 'offline' },
  getCachedRoutingPromptIdentity: () => null,
  ensureRoutingPromptSnapshot: async () => ({
    text: 'OFFLINE CONTROL PROMPT',
    version: 'offline',
    sent_hash: 'offline',
  }),
}));

/** The user's own corrected number. */
const TARGET = 'fac_user_typed';
/**
 * The decoy, carrying the IDENTICAL value. CLAUDE.md trap 19: an assertion
 * that finds its subject by a value another node could satisfy proves nothing
 * about the named object. Every assertion below resolves its node BY ID.
 */
const DECOY = 'fac_ai_guess';
/** A brief-stated goal baseline — the no-broadcast control. See its test. */
const GOAL = 'goal_service';

type Mutable = Record<string, any>;

/**
 * One graph, parameterised on the ONE field under test. `extractionType` is
 * left at the producer's `inferred` on the target deliberately: that is the
 * REAL persisted state after a user edit, because no writer updates
 * `extractionType` and none can.
 */
function fixture(targetSource: string): unknown {
  return GraphV3.parse({
    nodes: [
      {
        id: TARGET,
        kind: 'factor',
        label: 'Billing accuracy',
        observed_state: {
          value: 0.85,
          raw_value: 85,
          unit: '%',
          cap: 100,
          extractionType: 'inferred',
          source: targetSource,
        },
      },
      {
        id: DECOY,
        kind: 'factor',
        label: 'Capacity availability',
        observed_state: {
          value: 0.85,
          raw_value: 85,
          unit: '%',
          cap: 100,
          extractionType: 'inferred',
          source: 'cee_inference',
        },
      },
      {
        // Minted the way `schema-v3.ts:351-358` mints a goal baseline:
        // `brief_extraction` with NO `extractionType`.
        id: GOAL,
        kind: 'goal',
        label: 'Sustainable service',
        observed_state: { value: 0.9, raw_value: 90, unit: '%', cap: 100, source: 'brief_extraction' },
      },
      { id: 'opt_a', kind: 'option', label: 'Current approach' },
    ],
    edges: [
      {
        from: TARGET,
        to: GOAL,
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'user_specified' },
      },
    ],
  });
}

interface Capture {
  readonly requestBytes: string;
  readonly args: ChatWithToolsArgs;
  readonly compactNodes: readonly Record<string, unknown>[];
}

/**
 * Drive the production chain and capture the request the adapter is actually
 * handed. `ChatWithToolsArgs` is a plain data object (system / messages /
 * tools / tool_choice / temperature / maxTokens / system_cache_blocks), so
 * `JSON.stringify` over it IS the request text — not a proxy for it.
 */
async function capture(graph: unknown): Promise<Capture> {
  const frozenBefore = JSON.stringify(graph);
  const selection = selectContextGraphSnapshot({
    canonicalRead: { status: 'ok_present', graph },
    requestGraph: null,
  });
  expect(selection.status, 'the selector rejected the fixture').toBe('canonical');

  const outcome = compactSelectedGraphForContextPack(selection, { requestId: 'authorship-guard' });
  if (outcome.kind !== 'compacted') throw new Error('compaction did not happen');

  const message = 'Which of these values did I give you, and which did you estimate?';
  const pack = assembleContextPack({
    payload: makeMessagePayload({ message }),
    priorTurns: [],
    priorFacts: [],
    compactedGraph: outcome.compact,
    graphContext: { status: selection.status },
  });

  const calls: ChatWithToolsArgs[] = [];
  await routeWithToolUse(pack, message, {
    requestId: 'authorship-guard',
    systemPromptOverride: 'OFFLINE CONTROL PROMPT',
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs): Promise<ChatWithToolsResult> => {
        calls.push(args);
        return {
          content: [
            {
              type: 'tool_use',
              id: 'stub-tool',
              name: OLUMI_ACTION_TOOL_NAME,
              input: {
                intent_class: 'execute',
                action: {
                  handler_id: 'run_analysis',
                  entity: {
                    id: 'opt_a',
                    kind: 'option',
                    resolution_status: 'resolved',
                    resolution_method: 'id_match',
                  },
                  parameters: [],
                  cited_context_fields: ['graph.options'],
                },
              },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 } as ChatWithToolsResult['usage'],
          model: 'OFFLINE-STUB-NOT-A-PROVIDER',
          latencyMs: 0,
        } as ChatWithToolsResult;
      },
    },
  });

  expect(calls, 'the adapter was not called exactly once').toHaveLength(1);
  // The chain must not mutate the caller's graph.
  expect(JSON.stringify(graph)).toBe(frozenBefore);

  return {
    requestBytes: JSON.stringify(calls[0]),
    args: calls[0]!,
    compactNodes: outcome.compact.nodes as unknown as readonly Record<string, unknown>[],
  };
}

/** Read the node the model is actually shown, out of the request bytes. */
function requestNode(requestBytes: string, id: string): Record<string, unknown> {
  const found: Record<string, unknown>[] = [];
  // The display graph is embedded as pretty-printed JSON inside the user
  // message. Rather than re-deriving the projection (which would let this test
  // agree with a bug in it), scan the literal request text for the node object.
  const pattern = new RegExp(`\\{[^{}]*"id": "${id}"[^{}]*\\}`, 'g');
  for (const match of requestBytes.replace(/\\n/g, '\n').replace(/\\"/g, '"').matchAll(pattern)) {
    try {
      found.push(JSON.parse(match[0]) as Record<string, unknown>);
    } catch {
      /* not a complete object — ignore */
    }
  }
  expect(found.length, `node ${id} was not found in the request bytes`).toBeGreaterThan(0);
  return found[0]!;
}

function compactNode(c: Capture, id: string): Record<string, unknown> {
  const found = c.compactNodes.find((n) => n.id === id);
  expect(found, `compact node ${id} is missing`).toBeDefined();
  return found!;
}

describe('the adapter-bound request tells the model which numbers the user gave it', () => {
  /**
   * ⭐⭐⭐ THE DELIVERABLE. Two inputs differing in NOTHING BUT AUTHORSHIP must
   * not produce the same request. This is the assertion whose absence let the
   * first head ship a fix the model could not see.
   */
  it('⭐ source-only opposite inputs produce DIFFERENT adapter-bound request bytes', async () => {
    const userGraph = fixture('user_override');
    const aiGraph = fixture('cee_inference');

    // PIN THE PREMISE IN-TEST (CLAUDE.md trap 13b): prove the two inputs really
    // do differ ONLY in authorship, or "the requests differ" says nothing about
    // authorship. Blanking that one field must make them byte-identical.
    const blankAuthorship = (g: unknown): string => {
      const clone = structuredClone(g) as Mutable;
      clone.nodes[0].observed_state.source = '<AUTHORSHIP>';
      return JSON.stringify(clone);
    };
    expect(blankAuthorship(userGraph)).toBe(blankAuthorship(aiGraph));
    expect(JSON.stringify(userGraph)).not.toBe(JSON.stringify(aiGraph));

    const authored = await capture(userGraph);
    const inferred = await capture(aiGraph);

    expect(
      authored.requestBytes,
      'the user-authored and AI-authored graphs produced BYTE-IDENTICAL requests — ' +
        'the authorship correction dies before serialization and the model cannot see it',
    ).not.toBe(inferred.requestBytes);
  });

  /**
   * The difference must be the RIGHT difference, on the RIGHT node. Two
   * requests can differ for many reasons; this binds the delta to the target
   * BY ID, against a decoy carrying the identical value.
   */
  it('⭐ the user-authored factor reaches the model marked user_set — and the same-valued decoy does not', async () => {
    const authored = await capture(fixture('user_override'));

    const target = requestNode(authored.requestBytes, TARGET);
    const decoy = requestNode(authored.requestBytes, DECOY);

    // The pair is genuinely indistinguishable by value: without this, a value
    // predicate could have latched onto the wrong node and the test would
    // still pass.
    expect(target.display_value).toBe('85%');
    expect(decoy.display_value).toBe(target.display_value);

    expect(target.provenance).toBe('user_set');
    expect(decoy.provenance).toBeUndefined();
  });

  /**
   * ⚠ THE ASSERTION IS SCOPED TO NODES, AND THE FIRST DRAFT OF IT WAS WRONG.
   * A blanket `not.toContain('user_set')` over the request FAILED here — and
   * correctly so: `DisplaySafeEdge.provenance` has carried the same literal
   * across this boundary since long before this change, and the edge in this
   * fixture is `user_specified`. A whole-request string search cannot tell a
   * node's authorship claim from an edge's, so it is the wrong instrument;
   * the same mistake would have made the positive control below vacuous, since
   * that control depends on the edge literal being present. Bind by id.
   */
  it('the AI-authored twin of the same graph puts user_set on no NODE', async () => {
    const inferred = await capture(fixture('cee_inference'));
    for (const id of [TARGET, DECOY, GOAL, 'opt_a']) {
      expect(
        requestNode(inferred.requestBytes, id).provenance,
        `node ${id} claims authorship in a graph where nobody authored anything`,
      ).toBeUndefined();
    }
  });

  /**
   * POSITIVE CONTROL (CLAUDE.md trap 13). Every assertion above about a field
   * being ABSENT is vacuous unless this capture can be shown to carry the
   * things it should. A harness that captured an empty request would satisfy
   * all of them.
   */
  it('positive control: the capture carries a real request, not an empty one', async () => {
    const authored = await capture(fixture('user_override'));
    expect(authored.requestBytes.length).toBeGreaterThan(500);
    expect(authored.args.messages.length).toBeGreaterThan(0);
    expect(authored.requestBytes).toContain('Billing accuracy');
    expect(authored.requestBytes).toContain('85%');
    // Edge provenance already survived this boundary before this change —
    // proof the request genuinely carries provenance-shaped data, so a missing
    // NODE provenance is a real absence rather than a blind spot.
    expect(authored.requestBytes).toContain('user_set');
  });

  /**
   * CONTRAST CONTROL on the harness itself: it must be able to see a change it
   * is not looking for. If the capture returned a constant, the headline
   * assertion would be meaningless.
   */
  it('contrast control: a label change also moves the request bytes', async () => {
    const base = fixture('user_override');
    const changed = structuredClone(base) as Mutable;
    changed.nodes[0].label = 'Exactly changed label';

    const before = await capture(base);
    const after = await capture(changed);

    expect(after.requestBytes).not.toBe(before.requestBytes);
    expect(after.requestBytes).toContain('Exactly changed label');
    // …and the same input twice is stable, so "differs" above means something.
    const repeat = await capture(fixture('user_override'));
    expect(repeat.requestBytes).toBe(before.requestBytes);
  });

  /**
   * ⚠⚠ THE NO-BROADCAST GUARD, AND IT PINS A DELIBERATE SCOPE DECISION.
   *
   * `compactGraph` sets `provenance: 'ai_inferred'` both as a FINDING and as a
   * catch-all DEFAULT, and by the display projection the two are
   * indistinguishable. A brief-stated goal baseline — `source:
   * 'brief_extraction'`, NO `extractionType`, exactly as `schema-v3.ts:351-358`
   * mints it — defers and lands on that default.
   *
   * Transporting it would tell the model *"I estimated this myself"* about a
   * target the user stated in their own brief: the SAME false-authorship claim
   * this change exists to close, with the roles swapped. So only `user_set`
   * crosses the boundary.
   *
   * This test fails if a later change widens the projection to the full
   * vocabulary — which is the point. It also proves the compactor really does
   * produce the default here, so the guard is not passing on a case that
   * cannot arise.
   */
  it('⚠ the compactor\'s ai_inferred DEFAULT is not broadcast — a brief-stated goal is not called the model\'s own', async () => {
    const authored = await capture(fixture('user_override'));

    // Precondition, pinned in-test: the compactor really does default this
    // brief-stated goal to `ai_inferred`. Without this the guard below could
    // pass because nothing was there to leak.
    expect(compactNode(authored, GOAL).provenance).toBe('ai_inferred');
    expect(compactNode(authored, DECOY).provenance).toBe('ai_inferred');

    // …and none of it reaches the model. Scoped to NODES for the reason given
    // on the AI-twin test above: edges carry their own `provenance` on this
    // boundary and `ai_inferred` is their default, so a whole-request string
    // search would be asserting about the wrong objects.
    for (const id of [GOAL, DECOY]) {
      const node = requestNode(authored.requestBytes, id);
      expect(node.provenance, `the compactor's default leaked to the model on ${id}`).toBeUndefined();
    }
    // The target is the one node that SHOULD carry a claim — otherwise this
    // test could pass on a projection that transports nothing at all.
    expect(requestNode(authored.requestBytes, TARGET).provenance).toBe('user_set');
  });

  /**
   * The internal `source` vocabulary (`user | assumption | system`) and
   * `_raw_provenance` stay stripped, as do the raw floats. This change adds one
   * closed display literal, not a channel — asserted rather than asserted-in-
   * prose.
   */
  it('the existing raw-field exclusions are preserved', async () => {
    const authored = await capture(fixture('user_override'));
    const target = requestNode(authored.requestBytes, TARGET);

    expect(target.source).toBeUndefined();
    expect(target._raw_provenance).toBeUndefined();
    expect(target.value).toBeUndefined();
    expect(target.raw_value).toBeUndefined();
    expect(target.cap).toBeUndefined();
  });
});
