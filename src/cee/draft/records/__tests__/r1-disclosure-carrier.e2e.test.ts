/**
 * ⭐⭐ ROOT 4(b) — THE DISCLOSURES REACH THE WIRE. EXECUTED, NOT ASSERTED.
 *
 * ── WHY THIS FILE IS THE POINT OF THE WHOLE REMEDIATION ────────────────────
 * The projector was taught to stop inventing: it will not guess a constraint's
 * direction, will not silently pick between contradictory intervention levels,
 * and will not pretend a stated target became a goal threshold. Each refusal was
 * recorded in `projection.dropped[]`.
 *
 * **And `projection.dropped[]` had no reader.** An independent review put it
 * exactly right: *"The projector's honesty improved; the product's has not."* A
 * user saw a graph quietly weaker than their brief and was told nothing. Every
 * disclosure the remediation added was dark.
 *
 * So this file drives the ADAPTER — the real producer, through the real record
 * grammar — and then the real V3 transform and the real wire schema, and asserts
 * the disclosures arrive **anchored to nodes that exist in `nodes[]`**. A notice
 * naming an entity the user cannot see is not a disclosure.
 *
 * ⚠ WHAT THIS FILE DOES *NOT* COVER, STATED SO NOBODY READS IT AS AN
 * END-TO-END CLAIM. Between the adapter and the transform sit two places that
 * would silently eat the field — `stages/parse.ts` DESTRUCTURES the adapter
 * result, and `stages/package.ts` rebuilds the payload as a fresh object literal
 * from named keys — and `ctx.ceeResponse` is assigned from an `any`, so
 * TypeScript cannot catch a drop. Both are patched and both are named in their
 * own stage, but **neither hop is exercised here**: the existing unified-pipeline
 * tests mock every stage, so there is no cheap harness for them. The rung this
 * evidence reaches is WIRE-WITNESSED at the two ends, not JOURNEY-WITNESSED; a
 * staging journey is what closes the middle.
 */
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { CEEGraphResponseV3 } from "../../../../schemas/cee-v3.js";
import { transformResponseToV3 } from "../../../transforms/schema-v3.js";
import { projectDraftRecords } from "../seam.js";

const h = vi.hoisted(() => ({ payload: "", completionPayload: JSON.stringify({ claims: [] }) }));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      stream: () => {
        const payload = h.payload;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: payload } };
          },
          async finalMessage() {
            return {
              content: [{ type: "text", text: payload }],
              usage: { input_tokens: 100, output_tokens: 50 },
              stop_reason: "end_turn",
            };
          },
        };
      },
      create: async () => ({
        content: [{ type: "text", text: h.completionPayload }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn",
      }),
    };
  }
  return { default: MockAnthropic };
});

/**
 * A brief whose constraint direction the model omits. The projector refuses to
 * guess `<=` (which would have been the OPPOSITE constraint) and discloses.
 */
const BRIEF =
  "We need to protect runway. Cash must stay above 1000 pounds. We can expand or hold.";
const RECORDS = {
  stated_items: [
    { kind: "goal", source_quote: "protect runway" },
    { kind: "option", source_quote: "expand" },
    { kind: "option", source_quote: "hold" },
    // No `direction` — grammar-admitted, and the whole point of ROOT 2(a).
    { kind: "constraint", source_quote: "Cash must stay above 1000 pounds", value: 1000 },
  ],
  claims: [
    { claim_kind: "factor", label: "Cash use", basis: [0] },
    { claim_kind: "causal_link", label: "expand changes cash use", from_stated: 1, to_claim: 0, sets_to: 0.8 },
    { claim_kind: "causal_link", label: "hold changes cash use", from_stated: 2, to_claim: 0, sets_to: 0.4 },
    { claim_kind: "causal_link", label: "Cash use affects runway", from_claim: 0, to_stated: 0 },
    { claim_kind: "causal_link", label: "Cash floor protects runway", from_stated: 3, to_stated: 0 },
  ],
};

let draftGraphWithAnthropic: typeof import("../../../../adapters/llm/anthropic.js").draftGraphWithAnthropic;
const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ["ANTHROPIC_API_KEY", "CEE_ANTHROPIC_STRUCTURED_OUTPUTS"]) prior[key] = process.env[key];
  process.env.ANTHROPIC_API_KEY = "sk-ant-carrier";
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = "true";
  const { _resetConfigCache } = await import("../../../../config/index.js");
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import("../../../../adapters/llm/anthropic.js"));
});

afterAll(async () => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { _resetConfigCache } = await import("../../../../config/index.js");
  _resetConfigCache();
});

it("PRODUCER: the adapter emits the projector's disclosures instead of only logging them", async () => {
  // The precondition, pinned in-test: the projector really did refuse something.
  // Without this the assertion below could pass on an empty array forever.
  const seam = projectDraftRecords(RECORDS, BRIEF);
  expect(seam.ok).toBe(true);
  if (!seam.ok) return;
  expect(
    seam.projection.dropped.some((d) => d.reason === "constraint_direction_unstated"),
    "fixture must produce at least one disclosure",
  ).toBe(true);

  h.payload = JSON.stringify(RECORDS);
  const result = await draftGraphWithAnthropic(
    { brief: BRIEF, docs: [], seed: 1, model: "claude-sonnet-4-6" },
    { timeoutMs: 120_000, forceDefault: true },
  );

  const carried = (result as unknown as { record_disclosures?: unknown }).record_disclosures;
  expect(Array.isArray(carried), "the adapter must carry the disclosures out").toBe(true);
  expect((carried as unknown[]).length).toBeGreaterThan(0);
  expect((carried as { reason: string }[]).map((d) => d.reason)).toContain(
    "constraint_direction_unstated",
  );
});

it("CONSUMER: they survive to the wire, anchored to a node the user can actually see", () => {
  const seam = projectDraftRecords(RECORDS, BRIEF);
  expect(seam.ok).toBe(true);
  if (!seam.ok) return;

  const wire = CEEGraphResponseV3.parse(
    transformResponseToV3(
      { graph: seam.projection.graph, record_disclosures: seam.projection.dropped } as never,
      { brief: BRIEF },
    ),
  );

  const disclosures = wire.record_disclosures ?? [];
  expect(disclosures.length, "disclosures must survive the STRIP-mode wire schema").toBeGreaterThan(0);
  const direction = disclosures.find((d) => d.reason === "constraint_direction_unstated");
  expect(direction, "the unstated-direction notice must reach the wire").toBeDefined();
  expect(direction!.label).toBe("Cash must stay above 1000 pounds");

  // ⭐ THE ANCHOR IS THE LOAD-BEARING PART, asserted over EVERY entry rather than
  // the named one: a disclosure pointing at a node that is not in `nodes[]`
  // cannot be rendered beside anything and is not a disclosure at all.
  const nodeIds = new Set(wire.nodes.map((n) => n.id));
  for (const d of disclosures) {
    expect(nodeIds.has(d.node_id), `disclosure ${d.reason} anchors to a real node`).toBe(true);
  }
  // …and the anchor is the RIGHT node, bound by identity, not merely a real one.
  const constraintNode = wire.nodes.find((n) => n.label === "Cash must stay above 1000 pounds");
  expect(direction!.node_id).toBe(constraintNode!.id);
});

it("an unanchorable disclosure is DROPPED rather than emitted pointing at nothing", () => {
  const seam = projectDraftRecords(RECORDS, BRIEF);
  expect(seam.ok).toBe(true);
  if (!seam.ok) return;

  const wire = CEEGraphResponseV3.parse(
    transformResponseToV3(
      {
        graph: seam.projection.graph,
        record_disclosures: [
          ...seam.projection.dropped,
          // Names an entity that is on no graph anywhere, and no survivor.
          { claim_index: -1, claim_kind: "stated_item", label: "A node that does not exist", reason: "unconnected_to_goal" },
        ],
      } as never,
      { brief: BRIEF },
    ),
  );

  const disclosures = wire.record_disclosures ?? [];
  expect(disclosures.some((d) => d.label === "A node that does not exist")).toBe(false);
  // The real ones are untouched — this is a filter, not a refusal to emit.
  expect(disclosures.some((d) => d.reason === "constraint_direction_unstated")).toBe(true);
});
