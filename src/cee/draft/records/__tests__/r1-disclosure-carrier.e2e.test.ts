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
import { projectRecordsToGraph } from "../projector.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The REAL B3 brief the two banked captures were drafted from. */
const B3_BRIEF = JSON.parse(
  readFileSync(
    join(HERE, "../../../context-integrity/__tests__/fixtures/b3-product-bet.cold-read.json"),
    "utf8",
  ),
).brief_text as string;

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

  // ⭐ EVERY ENTRY IS SELF-CONSISTENT, asserted over ALL of them rather than the
  // named one: an anchored disclosure must resolve in `nodes[]`, and a withdrawn
  // one must carry no anchor at all. The pair is the invariant — checking only
  // the first would pass on a response that anchored everything to one node.
  const nodeIds = new Set(wire.nodes.map((n) => n.id));
  for (const d of disclosures) {
    if (d.withdrawn) {
      expect(d.node_id, `withdrawn ${d.reason} must not claim an anchor`).toBeUndefined();
    } else {
      expect(nodeIds.has(d.node_id!), `anchored ${d.reason} resolves in nodes[]`).toBe(true);
    }
  }
  // …and the anchor is the RIGHT node, bound by identity, not merely a real one.
  const constraintNode = wire.nodes.find((n) => n.label === "Cash must stay above 1000 pounds");
  expect(direction!.withdrawn).toBe(false);
  expect(direction!.node_id).toBe(constraintNode!.id);
});

/**
 * ⭐⭐ D1 — A WITHDRAWN RECORD IS THE DISCLOSURE THAT MATTERS MOST, AND IT USED TO
 * BE THE ONE THAT VANISHED.
 *
 * The first cut required an anchor in `nodes[]`. `unconnected_to_goal` — 51 of 56
 * real disclosures — describes a record REMOVED from the graph, so its subject
 * can never be in `nodes[]`: not being there is the entire content of the notice.
 * The rule therefore deleted precisely the class that says *"you told me this and
 * it is not in your model"* and kept the ones about things already on screen.
 */
it("a WITHDRAWN record still reaches the wire, flagged rather than deleted", () => {
  const seam = projectDraftRecords(RECORDS, BRIEF);
  expect(seam.ok).toBe(true);
  if (!seam.ok) return;

  const wire = CEEGraphResponseV3.parse(
    transformResponseToV3(
      {
        graph: seam.projection.graph,
        record_disclosures: [
          ...seam.projection.dropped,
          // A record the projector withdrew: it names a node id that is on no
          // final graph, which is exactly the shape of every `unconnected_to_goal`.
          {
            claim_index: -1,
            claim_kind: "stated_item",
            label: "Headcount is 20",
            node_id: "zz_withdrawn",
            reason: "unconnected_to_goal",
          },
        ],
      } as never,
      { brief: BRIEF },
    ),
  );

  const disclosures = wire.record_disclosures ?? [];
  const withdrawn = disclosures.find((d) => d.label === "Headcount is 20");
  expect(withdrawn, "a withdrawn record must NOT be silently dropped").toBeDefined();
  expect(withdrawn!.withdrawn).toBe(true);
  expect(withdrawn!.node_id).toBeUndefined();
  // …and nothing was lost on the way: every input disclosure came out.
  expect(disclosures.length).toBe(seam.projection.dropped.length + 1);
  expect(wire.record_disclosures_omitted).toBeUndefined();
});

/**
 * ⭐⭐ D3 — THE ANCHOR RESOLVES BY ID, NOT BY LABEL, AND THIS TEST IS WHY.
 *
 * The first version built a label→id map, FIRST-WINS. Two nodes can legitimately
 * share a label (`mintUnique` disambiguates the ID, never the label), so a notice
 * about the second one silently anchored to the first — a disclosure pointing at
 * the wrong entity, which is worse than one pointing at nothing because it reads
 * as authoritative.
 *
 * ⚠ ADDED AFTER A MUTANT SURVIVED: reverting the transform to a label lookup left
 * every other test in this lane GREEN. The fix was real and nothing was watching
 * it — a fix without a biting test is a fix waiting to be undone.
 */
it("anchors by ID when two nodes share a label, not by first-label-wins", () => {
  const graph = {
    nodes: [
      { id: "n_first", kind: "factor", label: "Handling capacity" },
      { id: "n_second", kind: "factor", label: "Handling capacity" },
    ],
    edges: [],
  };
  // The disclosure is about the SECOND node. A label lookup would return the first.
  const wire = CEEGraphResponseV3.parse(
    transformResponseToV3(
      {
        graph,
        record_disclosures: [
          {
            claim_index: -1,
            claim_kind: "claim",
            label: "Handling capacity",
            node_id: "n_second",
            reason: "parallel_intervention_conflict",
          },
        ],
      } as never,
      { brief: BRIEF },
    ),
  );
  const d = (wire.record_disclosures ?? [])[0];
  expect(d, "the disclosure must survive").toBeDefined();
  // The precondition that gives this test its power, pinned in-test: the two
  // nodes really do share a label, so a label lookup really is ambiguous.
  expect(wire.nodes.filter((n) => n.label === "Handling capacity")).toHaveLength(2);
  expect(d!.withdrawn).toBe(false);
  expect(d!.node_id, "must anchor to the node the projector named").toBe("n_second");
});

/**
 * ⭐⭐ THE VOLUME TEST, ON REAL MODEL OUTPUT. This is the assertion that would
 * have caught D1: the first design passed every unit test it had while delivering
 * 1 of 56 on the real captures. A per-case test cannot see a systematic loss —
 * only counting the whole channel can.
 */
it("VOLUME: every disclosure the projector produces reaches the wire, on both real B3 captures", () => {
  let totalProduced = 0;
  let totalEmitted = 0;
  for (const name of ["round7-completion-pass05-tie.json", "round7-completion-pass08.json"]) {
    const capture = JSON.parse(
      readFileSync(join(HERE, "fixtures", name), "utf8"),
    ) as { __PROVENANCE__: { brief: string }; records: unknown };
    expect(capture.__PROVENANCE__.brief).toBe("B3");
    const projection = projectRecordsToGraph(capture.records as never, B3_BRIEF);
    // Non-vacuity: a capture that produced nothing could not detect a loss.
    expect(projection.dropped.length).toBeGreaterThan(0);

    const wire = CEEGraphResponseV3.parse(
      transformResponseToV3(
        { graph: projection.graph, record_disclosures: projection.dropped } as never,
        { brief: B3_BRIEF },
      ),
    );
    totalProduced += projection.dropped.length;
    totalEmitted += (wire.record_disclosures ?? []).length;
    expect(wire.record_disclosures_omitted).toBeUndefined();
  }
  // The measurement that condemned the first design read 56 produced / 1 emitted.
  expect(totalProduced).toBeGreaterThan(50);
  expect(totalEmitted, "every produced disclosure must reach the wire").toBe(totalProduced);
});
