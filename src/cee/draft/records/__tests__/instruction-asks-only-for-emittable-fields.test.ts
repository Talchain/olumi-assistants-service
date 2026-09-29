/**
 * ⭐⭐ AN ASK POINTED AT A SHAPE THAT CANNOT ANSWER IS AN UNANSWERABLE ASK.
 *
 * ── THE DEFECT THIS EXISTS TO STOP RECURRING ───────────────────────────────
 * Grammar v10 put `value_scale` on `claims[]` only. The instruction taught it
 * in the `stated_items` section — 4 of its 6 mentions, the whole vocabulary and
 * BOTH worked examples — where `additionalProperties: false` made the field
 * literally unemittable. The model was told to set a field it could not set.
 *
 * MEASURED CONSEQUENCE, five windows / 61 draft calls / 2,157 claims since v10
 * shipped: `value_scale` declared on **9 of 2,157 = 0.42%**. And the only two
 * draws that declared both had `stated_kinds = {goal 1, option 2, figure 2}`
 * and declared on EVERY factor claim — i.e. the model engages with that section
 * only when the brief has figures, and then carries the convention across.
 * A merged, serving feature was near-inert for a week, and nothing was red.
 *
 * ── WHY THIS GUARD AND NOT A BIGGER ONE ────────────────────────────────────
 * ⚠ Deliberately NOT a prose parser. Scanning free text for every field name
 * would fire on the instruction legitimately DISCUSSING a field (contrasting
 * `unit` with `value_scale`, or naming a claims field while explaining what
 * does NOT belong in `stated_items`), and a guard with false positives gets
 * weakened until it means nothing. It matches one narrow, unambiguous
 * construction — an imperative `set \`x\`` — and resolves it against the field
 * list DERIVED from that section's own schema. No hand-maintained list on
 * either side.
 *
 * ── SCOPE, STATED SO IT IS NOT OVER-READ ───────────────────────────────────
 * It proves the ask is EMITTABLE. It does not prove the projector HONOURS it:
 * `figure role=target|constraint|context` are emittable and still discarded
 * downstream (2 of 5 figure shapes land). That is a different guard over a
 * different seam, and it is rowed, not built here.
 */
import { describe, expect, it } from "vitest";

import { buildDraftRecordsSchema } from "../grammar.js";
import { DRAFT_RECORDS_INSTRUCTION } from "../instruction.js";

/** The instruction's own section marker — the same string a reader navigates by. */
const CLAIMS_MARKER = "**claims**";

function sections(): { stated: string; claims: string } {
  const i = DRAFT_RECORDS_INSTRUCTION.indexOf(CLAIMS_MARKER);
  // A precondition, not a convenience: if the marker moves or is reworded, the
  // split silently puts every ask in one section and the guard stops
  // discriminating while staying green.
  expect(i, `the instruction must contain the section marker ${CLAIMS_MARKER}`).toBeGreaterThan(0);
  return {
    stated: DRAFT_RECORDS_INSTRUCTION.slice(0, i),
    claims: DRAFT_RECORDS_INSTRUCTION.slice(i),
  };
}

function schemaKeys(): { stated: Set<string>; claims: Set<string> } {
  const s = buildDraftRecordsSchema() as {
    properties: {
      stated_items: { items: { properties: Record<string, unknown> } };
      claims: { items: { properties: Record<string, unknown> } };
    };
  };
  return {
    stated: new Set(Object.keys(s.properties.stated_items.items.properties)),
    claims: new Set(Object.keys(s.properties.claims.items.properties)),
  };
}

/** Imperative asks only: ``set `x` ``. Not every mention of a field. */
const asksIn = (text: string): string[] => [
  ...new Set([...text.matchAll(/\bset\s+`([a-z_]+)`/gi)].map((m) => m[1]!)),
];

describe("each instruction section only asks for fields its own shape can emit", () => {
  it("PRECONDITION — the probe finds asks in BOTH sections", () => {
    // Without this every assertion below is satisfied by a regex that matches
    // nothing, in a file whose whole subject is an ask that could not be
    // answered. A guard agreeing with itself, on exactly this topic.
    const { stated, claims } = sections();
    expect(asksIn(stated).length).toBeGreaterThan(0);
    expect(asksIn(claims).length).toBeGreaterThan(0);
  });

  it("STATED — every `set \\`x\\`` names a field on the stated_items schema", () => {
    const keys = schemaKeys().stated;
    const unsatisfiable = asksIn(sections().stated).filter((f) => !keys.has(f));
    expect(
      unsatisfiable,
      `the stated_items section asks the model to set ${unsatisfiable.join(", ")}, ` +
        `which its schema cannot carry (additionalProperties: false)`,
    ).toEqual([]);
  });

  it("CLAIMS — every `set \\`x\\`` names a field on the claims schema", () => {
    const keys = schemaKeys().claims;
    const unsatisfiable = asksIn(sections().claims).filter((f) => !keys.has(f));
    expect(
      unsatisfiable,
      `the claims section asks the model to set ${unsatisfiable.join(", ")}, ` +
        `which its schema cannot carry`,
    ).toEqual([]);
  });

  it("DISCRIMINATION — the two shapes really do differ, so the split is doing work", () => {
    // If the two schemas had identical keys, the section split would be
    // decorative and the guard would pass for the wrong reason. They do not:
    // `source_quote`/`role`/`direction` are stated-only, `claim_kind`/`label`/
    // `sets_to`/`effect` are claims-only.
    const { stated, claims } = schemaKeys();
    expect([...stated].filter((k) => !claims.has(k)).length).toBeGreaterThan(0);
    expect([...claims].filter((k) => !stated.has(k)).length).toBeGreaterThan(0);
  });
});
