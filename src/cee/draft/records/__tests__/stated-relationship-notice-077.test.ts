/**
 * ⭐ schemas 0.77.0 — a relationship THE USER STATED is counted as the user's, never as "Connections Olumi proposed"
 * (SPINE X8; olumi-schemas #88 → main b0378e7f; DL order: DGAI served 0.77 first, PLoT second, CEE last).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Every relationship refusal is counted under `relationship_not_used`, which every consumer words as Olumi's
 * ("Connections Olumi proposed but couldn't place in the model"). When the refused record was STATED by the user, that
 * credits the user's own words to Olumi. 0.77.0 adds the closed member `stated_relationship_not_used` for exactly this.
 *
 * ── THE CARRIER, HOP BY HOP (each one strips an undeclared field) ──────────
 *   projector `DroppedRecordRef.stated_relationship` → adapter (passes drops whole) → V3 transform (copies declared fields only)
 *   → `CEEGraphResponseV3` (`record_disclosures` items are a plain, STRIPPING `z.object`) → `buildModelBuildingNotices`.
 * A flag the transform does not copy, or the schema does not declare, vanishes silently — so the rows below go through
 * the REAL transform and the REAL schema parse, never a hand-built disclosure handed straight to the builder.
 *
 * ⚠ The flag is `stated_relationship`, not a generic `stated`: the reference-failure reasons fire identically for a
 * causal link and for a stated LIMIT (`completion.ts:811-830`), and the transform does not carry `claim_kind`, so only
 * the producer can assert "this refused record is a relationship the user stated" (codex r1, #2595).
 *
 * ⚠ The producer side is NOT in this file's scope: no staging reason disposes of a user-stated relationship yet
 * (records-v25 lands with #2576, which sets `stated_relationship: true` on its drops of `provenance_class: 'stated'` records). Until
 * then this path is byte-identical on every current input — pinned in row (e).
 */
import { ModelBuildingNoticeKindSchema } from "@talchain/schemas/boundary";
import { describe,expect,it } from "vitest";
import { CEEGraphResponseV3 } from "../../../../schemas/cee-v3.js";
import { transformResponseToV3 } from "../../../transforms/schema-v3.js";



const STATED = "stated_relationship_not_used";
const BRIEF = "Each extra support agent cuts customers waiting over a day by about 2 percentage points.";
const GRAPH = {
  nodes: [
    { id: "fac_agents", kind: "factor", label: "Support agents" },
    { id: "out_wait", kind: "outcome", label: "Customers waiting over a day" },
  ],
  edges: [],
};

/** One disclosure through the real V3 transform and the real (stripping) V3 schema, as `draft-graph.ts` reads it. */
function throughTheWire(disclosures: readonly Record<string, unknown>[]) {
  return CEEGraphResponseV3.parse(
    transformResponseToV3({ graph: GRAPH, record_disclosures: disclosures } as never, { brief: BRIEF }),
  );
}

const drop = (over: Record<string, unknown>) => ({
  claim_index: 0,
  claim_kind: "causal_link",
  label: "Support agents → Customers waiting over a day",
  reason: "missing_ref",
  ...over,
});

describe("0.77.0 — a stated relationship's refusal is the user's (SPINE X8)", () => {
  it("PRECONDITION: the vendored contract carries the member", () => {
    expect(ModelBuildingNoticeKindSchema.options).toContain(STATED);
  });

  it("(a) a relationship refusal flagged `stated_relationship: true` survives the transform AND the stripping schema", () => {
    const wire = throughTheWire([drop({ stated_relationship: true })]);
    expect((wire.record_disclosures?.[0] as { stated_relationship?: unknown } | undefined)?.stated_relationship).toBe(true);
  });







  it("(e) BYTE-IDENTICAL on every current input: an unflagged disclosure carries no `stated_relationship` key", () => {
    const wire = throughTheWire([drop({})]);
    expect(Object.hasOwn(wire.record_disclosures![0]!, "stated_relationship")).toBe(false);
  });






});
