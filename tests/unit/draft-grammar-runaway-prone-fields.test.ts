/**
 * DRAFT GRAMMAR — runaway-prone free-text field removal (2026-07-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * The draft runaway was mis-characterised for two lanes as "the model
 * enumerates NODES and never emits EDGES". Re-probed at the wire against
 * `api.anthropic.com` with the SERVED prompt (draft_graph v195, 59,293 chars),
 * the LIVE grammar (`buildDraftGraphSchema()`), the live model
 * (claude-sonnet-4-6), `temperature: 0`, `thinking: disabled`,
 * `max_tokens: 8550` — i.e. the live request minus CEE — the control arm
 * reproduced the live failure (5/16 usable) and every single failure had the
 * SAME anatomy:
 *
 *   …"factor_type":"cost","display_value":"No additional headcount hired yet
 *   (baseline)  ␣␣␣␣… (8,113 more U+200B ZERO WIDTH SPACE) …
 *
 * A character-repetition loop INSIDE the string value of
 * `node.data.display_value`. 10 of 10 characterised failures ended in that
 * field (the repeated payload varies — U+200B runs, `"← display only.  "`,
 * `"No additional headcount hired in place currently."` — the field never
 * does), always in the SIXTH node, the first `factor`. The whole token budget
 * is spent inside one string of one field, which is why `time_to_edges` was
 * NULL 17/17, why the schema error was always `edges: Required`, why
 * `completion_tokens == cap` exactly at 8,550 / 12,000 / 16,000, and why
 * raising the ceiling rescued nothing: an unterminated string has no length it
 * is trying to reach.
 *
 * THE FIX, AND THE CONTROL THAT PROVES IT IS THE FIELD
 * ----------------------------------------------------
 * Four arms at the wire, same brief / prompt / model, run concurrently:
 *
 *   control (today's live request)                          5/16 = 31%
 *   temperature 0 -> 0.5                                     3/8  = 38%
 *   two-call nodes-then-edges decomposition                  5/8  = 63%
 *   DROP data.display_value from the sent grammar          16/16 = 100%
 *   CONTROL: drop a DIFFERENT unconstrained free-text
 *            string (data.encoding_map)                      2/8  = 25%
 *
 * Fisher exact, fix vs control: 16/16 vs 5/16, p ~ 1.4e-5.
 *
 * The `encoding_map` arm is the load-bearing control: if the benefit came from
 * "a smaller grammar" or "one less optional parameter" it would have moved too.
 * It did not. The effect is specific to the field the loop happens in.
 *
 * WHY DROPPING IT IS SAFE
 * -----------------------
 * The served prompt states the field's own status at line 392: "display_value
 * is display-only; never affects inference or intervention logic." CEE already
 * carries the deterministic replacement — `synthesiseDisplayValue`
 * (src/cee/factor-extraction/display-value.ts) — and
 * `formatGraphForContext` (src/orchestrator-v5/format/format-graph-for-context.ts)
 * already prefers an existing `display_value` and SYNTHESISES one when absent.
 * Removing the key from the grammar therefore routes the field from
 * "free prose the model writes, capped by nothing" to "a deterministic
 * formatter, capped at 50 characters" — which is the better answer regardless
 * of the runaway.
 *
 * SCOPE OF THE CLAIM (do not over-read it)
 * ----------------------------------------
 * This removes the field the loop was measured in. It does NOT prove no other
 * unconstrained string can ever host a repetition loop: `label`,
 * `uncertainty_drivers[]`, `unit` and `encoding_map` remain unconstrained by
 * construction (`maxLength` is accepted-but-not-enforced by the compiler and is
 * stripped by `enforceAnthropicSchemaCompliance`). 16/16 at the wire is
 * evidence the loop did not migrate; it is not a proof that it cannot.
 */

import { describe, it, expect } from "vitest";
import {
  ANTHROPIC_DRAFT_GRAPH_SCHEMA,
  buildDraftGraphSchema,
  countOptionalParams,
  RUNAWAY_PRONE_NODE_DATA_KEYS,
} from "../../src/cee/draft/anthropic-graph-schema.js";
import { synthesiseDisplayValue } from "../../src/cee/factor-extraction/display-value.js";

type AnyRec = Record<string, any>;

/** The `data` object schema inside a node item, for a given draft schema. */
function nodeDataObject(schema: AnyRec): AnyRec | undefined {
  return schema?.properties?.nodes?.items?.properties?.data?.anyOf?.[0];
}

describe("draft grammar — runaway-prone free-text fields are unemittable", () => {
  it("the SENT grammar cannot emit any runaway-prone node-data key", () => {
    const sent = buildDraftGraphSchema() as unknown as AnyRec;
    const data = nodeDataObject(sent);
    expect(data, "node.data object schema must still exist").toBeTruthy();

    for (const key of RUNAWAY_PRONE_NODE_DATA_KEYS) {
      expect(
        Object.keys(data!.properties),
        `data.${key} must be absent from the SENT grammar — it is the field the ` +
          `measured repetition loop lives in`,
      ).not.toContain(key);
      expect(data!.required ?? []).not.toContain(key);
    }

    // UNEMITTABLE, not merely unrequired. Without additionalProperties:false the
    // model could still emit the key and loop inside it, and this whole change
    // would be decorative.
    expect(
      data!.additionalProperties,
      "additionalProperties:false is what makes the removed key UNEMITTABLE rather than optional",
    ).toBe(false);
  });

  it("the removal is DERIVED from the base object, and every key is anchored there", () => {
    // Trap #12 (hand-maintained mirror): a key list that drifts out of the base
    // object would make buildDraftGraphSchema() a silent no-op — it would remove
    // nothing and the grammar would keep the field. Every key must be present in
    // the BASE object, so the removal provably has something to remove.
    const baseData = nodeDataObject(ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as AnyRec);
    expect(RUNAWAY_PRONE_NODE_DATA_KEYS.length).toBeGreaterThan(0);
    for (const key of RUNAWAY_PRONE_NODE_DATA_KEYS) {
      expect(
        Object.keys(baseData!.properties),
        `ANCHOR: '${key}' must exist on the BASE node.data object, or its removal ` +
          `is a no-op that silently leaks the field back into the grammar`,
      ).toContain(key);
    }
  });

  it("POSITIVE CONTROL: the absence assertion can SEE a presence", () => {
    // Trap #13 — an absence assertion that has never been shown to detect a
    // presence is vacuous. Prove the same predicate FAILS on a schema that
    // still carries the key.
    const withField = JSON.parse(JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA));
    const data = nodeDataObject(withField);
    expect(Object.keys(data.properties)).toContain(RUNAWAY_PRONE_NODE_DATA_KEYS[0]);

    // …and the SENT schema, run through the identical predicate, does not.
    const sentData = nodeDataObject(buildDraftGraphSchema() as unknown as AnyRec);
    expect(Object.keys(sentData!.properties)).not.toContain(RUNAWAY_PRONE_NODE_DATA_KEYS[0]);
  });

  it("the BASE object is never mutated — ingress tolerance is preserved and the builder is idempotent", () => {
    // The base object is the single source of truth for the guard counts and
    // for what CEE will TOLERATE at ingress (a prompt-only fallback response, or
    // a model that emits the key anyway, must still parse). Only the SENT
    // grammar loses the key.
    const before = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    buildDraftGraphSchema();
    buildDraftGraphSchema();
    expect(JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA)).toBe(before);
    expect(
      Object.keys(nodeDataObject(ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as AnyRec)!.properties),
    ).toContain("display_value");

    // Idempotent: two builds are byte-identical.
    expect(JSON.stringify(buildDraftGraphSchema())).toBe(JSON.stringify(buildDraftGraphSchema()));
  });

  it("the optional-parameter budget IMPROVES by exactly the number of keys removed", () => {
    // Derived, not asserted against a hand-written number. The optional budget
    // sits one slot from Anthropic's hard limit of 24; this change buys a slot
    // back, and the arithmetic must be visible rather than claimed.
    const baseOptional = countOptionalParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    const sentOptional = countOptionalParams(buildDraftGraphSchema());
    // The deferred TOP-LEVEL aux keys are all `required`, so they contribute 0
    // optional params; the whole delta is the node-data keys removed here.
    expect(baseOptional - sentOptional).toBe(RUNAWAY_PRONE_NODE_DATA_KEYS.length);
  });

  it("the deterministic replacement exists and produces a bounded display string", () => {
    // Dropping the field is only safe because a deterministic formatter already
    // fills the same slot downstream (format-graph-for-context.ts prefers an
    // existing display_value and synthesises one when absent). Pin that the
    // replacement mechanism WORKS — not merely that it is imported.
    expect(synthesiseDisplayValue({ raw_value: 180_000, unit: "£" })).toBe("£180k");
    expect(synthesiseDisplayValue({ raw_value: 18, unit: "months" })).toBe("18 months");
    expect(synthesiseDisplayValue({ raw_value: 3, unit: "%" })).toBe("3%");

    // And it is BOUNDED — the property the LLM-written field never had, and the
    // absence of which is the entire defect.
    const out = synthesiseDisplayValue({ raw_value: 1.234567e12, unit: "$" });
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(50);
  });
});
