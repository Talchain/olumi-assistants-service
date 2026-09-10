/**
 * ⛔⛔ A USER'S STATED LIMIT SURVIVES THE REAL DRAFT PATH — the A/B, on the
 * class the product actually calls.
 *
 * ── WHY THIS FILE EXISTS, AND WHY THE PROJECTOR TESTS COULD NOT REPLACE IT ──
 * `RecordProjection` has a `.graph` and a sibling `.goalConstraints`. The
 * binding pass wrote the user's limit to the SIBLING and removed it from
 * `.graph` — and `AnthropicAdapter.draftGraph` copies ONLY `.graph`
 * (`rawJson = { ...activeProjection.graph }`). Every projector-level test can
 * read both siblings, so every one of them could watch the limit move from one
 * to the other and call it carried. ONLY A TEST AT THE ADAPTER CAN SEE THAT
 * ONE OF THE TWO NEVER TRAVELS. That is trap 16's shape: reachability inside
 * one function is not reachability in the product.
 *
 * ── THE MEASURED DEFECT, reproduced here as a standing guard ───────────────
 * Two arms differing in ONE key, the constraint LINKED to the goal so the
 * connectivity prune is NOT the variable:
 *   without `applies_to_claim` → the graph carries a `constraint` node for
 *                                "keeping monthly churn under 4%"
 *   with    `applies_to_claim` → THAT NODE WAS DELETED, `dropped` was EMPTY,
 *                                and nothing carried the limit anywhere.
 * A user's own stated cap left the product silently, on the first draft after
 * deploy.
 *
 * ⚠⚠ LINKING THE CONSTRAINT IS LOAD-BEARING IN THIS FIXTURE. An independent
 * review's first attempt at this A/B left the constraint unconnected — the
 * prune then removed the node in BOTH arms, the arms agreed, and the
 * experiment "passed" while measuring the prune instead of the change. Both
 * the constraint and its target are linked below, which is also what the draft
 * instruction tells the model to produce.
 *
 * SCOPE, stated precisely (trap 20): this drives the adapter with a MOCKED SDK,
 * so it is evidence about the adapter's own post-LLM projection and carriage —
 * not a wire witness of a live provider draft.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  bodies: [] as Array<Record<string, unknown>>,
  payload: { text: '' },
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: Record<string, unknown>) => {
        h.bodies.push(body);
        const payload = h.payload.text;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: payload } };
          },
          async finalMessage() {
            return {
              content: [{ type: 'text', text: payload }],
              usage: { input_tokens: 100, output_tokens: 50 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
    };
  }
  return { default: MockAnthropic };
});

const BRIEF =
  'Should we invest in onboarding or in win-back campaigns? ' +
  'We need to grow net revenue while keeping monthly churn under 4%.';

/** The two arms differ in EXACTLY ONE KEY. */
const recordSet = (constraintExtras: Record<string, unknown>) =>
  JSON.stringify({
    stated_items: [
      { kind: 'goal', source_quote: 'grow net revenue', role: 'target' },
      { kind: 'option', source_quote: 'invest in onboarding' },
      { kind: 'option', source_quote: 'invest in win-back campaigns' },
      {
        kind: 'constraint',
        source_quote: 'keeping monthly churn under 4%',
        value: 4,
        unit: '%',
        direction: 'ceiling',
        ...constraintExtras,
      },
    ],
    claims: [
      // claims[0] — the model's OWN name for the quantity. It shares no usable
      // token with "monthly churn": this is the pair the string matcher could
      // not join, and the whole reason the reference field exists.
      { claim_kind: 'factor', label: 'Subscriber Churn Rate', category: 'controllable' },
      { claim_kind: 'causal_link', label: 'onboarding lowers churn', from_stated: 1, to_claim: 0, effect: 'negative' },
      { claim_kind: 'causal_link', label: 'win-back lowers churn', from_stated: 2, to_claim: 0, effect: 'negative' },
      { claim_kind: 'causal_link', label: 'churn erodes revenue', from_claim: 0, to_stated: 0, effect: 'negative' },
      // ⚠ THE CONSTRAINT IS LINKED TO THE GOAL — see the header. Without this
      // the prune removes the node in BOTH arms and the A/B measures nothing.
      { claim_kind: 'causal_link', label: 'the churn limit bears on revenue', from_stated: 3, to_stated: 0, effect: 'negative' },
    ],
  });

type AnyNode = { id: string; kind: string; label: string; data?: unknown; observed_state?: unknown };

let AnthropicAdapter: typeof import('../anthropic.js').AnthropicAdapter;
const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ['ANTHROPIC_API_KEY', 'CEE_ANTHROPIC_STRUCTURED_OUTPUTS']) prior[k] = process.env[k];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-constraint-survives';
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ AnthropicAdapter } = await import('../anthropic.js'));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => { h.bodies = []; });

/** Drives the REAL `AnthropicAdapter.draftGraph` — the method `parse.ts` calls. */
type DraftOut = { nodes: AnyNode[]; result: Record<string, unknown> };

async function draft(responseText: string): Promise<DraftOut> {
  h.payload.text = responseText;
  const result = await new AnthropicAdapter('claude-sonnet-4-6').draftGraph(
    { brief: BRIEF, docs: [], seed: 1 },
    { requestId: 'constraint-survives-ab', timeoutMs: 120_000, forceDefault: true },
  );
  expect(h.bodies.length, 'no request body captured — the adapter never called the SDK').toBeGreaterThanOrEqual(1);
  const graph = (result as unknown as { graph: { nodes: AnyNode[] } }).graph;
  expect(graph, 'the adapter returned no graph').toBeDefined();
  return { nodes: graph.nodes, result: result as unknown as Record<string, unknown> };
}

/**
 * ⚠⚠ FOUND BY DUMPING THE ADAPTER'S ACTUAL OUTPUT, AND IT CHANGED THIS TEST.
 * The projector's `constraint` node does NOT reach the adapter's return value
 * as `kind: "constraint"` — a downstream V3 transform maps it to
 * `kind: "risk"`. A `kind === 'constraint'` filter therefore reads ZERO in BOTH
 * arms and would have made this whole file agree with itself while proving
 * nothing (trap 20: identical answers for every input are evidence about the
 * probe). The limit is found by IDENTITY — the node whose label is the user's
 * own words, whose id is the content hash minted from them — never by kind and
 * never by "some node carrying a 4" (trap 19).
 */
const LIMIT_QUOTE = 'keeping monthly churn under 4%';
const limitNodes = (g: { nodes: AnyNode[] }) => g.nodes.filter((n) => n.label === LIMIT_QUOTE);

describe('⛔ the node carrying a user-stated limit survives the real draft path', () => {
  /**
   * ⭐ THE CONTROL ARM — and it is a PRECONDITION, not a nicety. If the limit
   * were absent here too, the experiment would prove nothing about the field:
   * a node missing in both arms is the prune, not the binding.
   */
  it('CONTROL — without the reference, the draft carries the limit as its own node', async () => {
    const graph = await draft(recordSet({}));
    const found = limitNodes(graph);
    expect(found, 'precondition: the control arm must carry the limit').toHaveLength(1);
    expect((found[0]!.observed_state as { value?: number }).value).toBe(4);
  });

  /**
   * ⭐⭐ THE ARM THAT WAS DESTRUCTIVE. One key differs. The limit must still be
   * on the graph the user receives — by its parts, bound by IDENTITY to the
   * label the user's own words produced, never to "some node with a 4".
   */
  it('WITH the reference, the limit is STILL on the graph the user receives', async () => {
    const graph = await draft(recordSet({ applies_to_claim: 0 }));
    const found = limitNodes(graph);
    expect(
      found,
      'the user\'s stated limit was deleted from the graph the adapter returns',
    ).toHaveLength(1);
    expect((found[0]!.data as { operator?: string }).operator).toBe('<=');
    expect((found[0]!.observed_state as { value?: number }).value).toBe(4);
    expect((found[0]!.observed_state as { metadata?: { unit?: string } }).metadata!.unit).toBe('%');
  });

  /**
   * ⭐⭐ THE A/B ITSELF — the two arms compared, which is the claim that
   * actually matters and the one no single-arm assertion can make.
   */
  it('A/B — the two arms return the SAME node set, so the field takes nothing away', async () => {
    const without = await draft(recordSet({}));
    const with_ = await draft(recordSet({ applies_to_claim: 0 }));

    const census = (g: { nodes: AnyNode[] }) =>
      g.nodes.map((n) => `${n.kind}:${n.label}`).sort();

    // Pinned in-test so this cannot pass by both arms being empty (trap 13b).
    expect(census(without).length, 'precondition: the control arm must have nodes').toBeGreaterThan(0);
    expect(census(with_)).toEqual(census(without));
    expect(with_.nodes.map((n) => n.id).sort()).toEqual(without.nodes.map((n) => n.id).sort());
  });

  /**
   * ⭐ THE SECOND BLOCK, AT THE ADAPTER. A malformed optional reference used to
   * refuse the whole record set (`not_a_record_set`), which the adapter turns
   * into a THROWN `anthropic_response_invalid_schema` — the entire draft lost
   * over an enhancement field. It must now degrade to absence.
   */
  /**
   * ⭐⭐ COEXISTENCE — THE SPECIFIC HAZARD OF "PRESERVE WHILE YOU CARRY".
   *
   * While the standalone node is preserved AND a bound row is minted, the same
   * user limit exists in TWO representations at once. That is the correct state
   * for this step of the sequence, but it creates a hazard the old splice did
   * not have: a consumer that reads both would count the limit TWICE — and a
   * limit applied twice is a wrong answer that looks like a careful one.
   *
   * ⭐ WHY IT IS SAFE TODAY, ASSERTED RATHER THAN ARGUED: only ONE of the two
   * representations reaches the caller at all. The bound row lives on
   * `RecordProjection.goalConstraints`, which the adapter does not carry, so
   * what a consumer receives holds the limit exactly once. This guard REDs the
   * moment a carrier lane makes the row travel WITHOUT retiring the node — which
   * is precisely the transition where double-counting becomes reachable, and the
   * point at which someone must look at it.
   */
  it('COEXISTENCE — the limit reaches the caller EXACTLY ONCE, never counted twice', async () => {
    const out = await draft(recordSet({ applies_to_claim: 0 }));

    // Representation 1 — the node. Exactly one.
    expect(limitNodes(out), 'the limit must be present, and present once').toHaveLength(1);
    const limitId = limitNodes(out)[0]!.id;

    // Representation 2 — a bound row travelling alongside it. There must be
    // none, because a consumer reading both would apply the limit twice.
    const rows = (out.result.goal_constraints ?? []) as Array<{ node_id?: string }>;
    const duplicates = rows.filter((r) => r.node_id === limitId);
    expect(
      duplicates,
      'the same limit is travelling as BOTH a node and a bound row — a consumer reading both counts it twice',
    ).toHaveLength(0);
  });

  it('a malformed `applies_to_claim: "0"` no longer kills the whole draft', async () => {
    const graph = await draft(recordSet({ applies_to_claim: '0' }));
    expect(limitNodes(graph), 'the limit must still be on the graph').toHaveLength(1);
    // Degraded to exactly the no-reference behaviour.
    const without = await draft(recordSet({}));
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(without.nodes.map((n) => n.id).sort());
  });
});
