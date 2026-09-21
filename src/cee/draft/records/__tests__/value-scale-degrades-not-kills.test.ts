/**
 * ⛔⛔ A MALFORMED `value_scale` MUST DEGRADE TO ABSENCE, NEVER KILL THE DRAFT.
 *
 * ── THE HARM, MEASURED BEFORE THE FIX ──────────────────────────────────────
 * `value_scale` was a plain `z.enum(...).optional()` on both the stated and the
 * claims wire shapes. One out-of-enum string on ONE record failed that item,
 * which failed `DraftRecordSetWire.safeParse`, which the seam turns into
 * `not_a_record_set` — **the entire draft lost**: every quote, every figure,
 * every limit the user stated, over a field that did not exist last week.
 *
 * The grammar normally forbids it. But the adapter falls back to PROMPT-ONLY
 * JSON whenever the compiled grammar is rejected (see `grammar.ts` on the
 * unpublished compiled-size budget and its silent fallback) — and that is
 * precisely the path where nothing enforces the enum provider-side. So the
 * shape is reachable exactly when the draft is already degraded.
 *
 * ── WHY TOLERANCE IS RIGHT HERE AND NOT EVERYWHERE ─────────────────────────
 * This is the ruling `applies_to_*` already carries, and it turns on one
 * property: `value_scale` is an OPTIONAL ENHANCEMENT whose ABSENCE is defined
 * as byte-identical to the behaviour before it existed. So absence IS the
 * honest degradation, and failing the whole record set to reach it is
 * disproportionate.
 *
 * ⚠ IT MUST NOT WIDEN TO THE DISCRIMINATORS. `kind`, `source_quote`,
 * `claim_kind` and `label` are LOAD-BEARING: a malformed one means the
 * projector's switch has nothing to branch on, and refusing loudly is correct.
 * The last test is that contrast — without it, this file would be evidence that
 * the seam has simply become permissive.
 */
import { describe, expect, it } from "vitest";

import { DraftRecordSetWire, projectDraftRecords } from "../seam.js";

const BRIEF = "we have 6 engineers and want to grow revenue next year";

/** The stated figure is index 1 in every fixture below. */
function records(mutate: (r: Record<string, unknown>) => void): unknown {
  const r = {
    stated_items: [
      { kind: "goal", source_quote: "grow revenue next year" },
      {
        kind: "figure",
        source_quote: "we have 6 engineers",
        value: 6,
        unit: "engineers",
        value_scale: "raw_count",
      },
    ],
    claims: [] as unknown[],
  };
  mutate(r as unknown as Record<string, unknown>);
  return r;
}

const seam = (r: unknown) => projectDraftRecords(r, BRIEF) as {
  ok: boolean;
  reason?: string;
  records?: { stated_items: Array<{ value_scale?: string }> };
};

describe("a malformed value_scale degrades, a malformed discriminator refuses", () => {
  it("POSITIVE CONTROL — a valid record set parses and carries the declaration", () => {
    // Without this the three assertions below could all be satisfied by a seam
    // that refuses everything, or one that accepts everything and carries
    // nothing. It pins that the fixture is capable of succeeding at all.
    const out = seam(records(() => {}));
    expect(out.ok).toBe(true);
    expect(out.records?.stated_items[1]?.value_scale).toBe("raw_count");
  });

  it("an out-of-enum STATED value_scale loses the field, not the draft", () => {
    const out = seam(records((r) => {
      (r.stated_items as Array<Record<string, unknown>>)[1]!.value_scale = "percent";
    }));
    expect(out.ok, `the draft must survive; got reason=${out.reason}`).toBe(true);
    expect(
      out.records?.stated_items[1]?.value_scale,
      "and the bad value must not be carried through as if it were declared",
    ).toBeUndefined();
  });

  it("an out-of-enum CLAIM value_scale does not take the stated items down with it", () => {
    // The v10 twin. The blast radius of a bad claim field was the whole record
    // set, including every stated item — which is what makes this the same
    // defect rather than a neighbouring one.
    const out = seam(records((r) => {
      (r.claims as unknown[]).push({
        claim_kind: "factor",
        label: "Engineering Capacity",
        value: 1,
        value_scale: "percent",
      });
    }));
    expect(out.ok).toBe(true);
    expect(
      out.records?.stated_items[1]?.value_scale,
      "the user's own declaration is untouched by the model's bad one",
    ).toBe("raw_count");
  });

  it("CONTRAST — a malformed REQUIRED discriminator still refuses", () => {
    // `kind` is load-bearing: the projector's switch branches on it. If this
    // ever goes green, the seam has become permissive in general and the three
    // tests above stop being evidence about `value_scale` specifically.
    const out = seam(records((r) => {
      (r.stated_items as Array<Record<string, unknown>>)[1]!.kind = "nonsense";
    }));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("not_a_record_set");
  });

  it("CONTRAST — a malformed OPTIONAL enum still refuses, which is the case `kind` cannot see", () => {
    // ⚠⚠ THE TEST ABOVE DOES NOT SUPPORT THE CLAIM IT SOUNDS LIKE, and an
    // independent reviewer proved it with two mutants: adding `.catch` to
    // `role` — or to `effect` — left this file **4 of 4 GREEN**. `kind` is
    // REQUIRED, so it cannot witness a tolerance that spreads to an OPTIONAL
    // enum, and an optional enum is exactly the shape the next `.catch` would
    // land on.
    //
    // `role` is the nearest neighbour by every axis that matters: optional,
    // enum-typed, same wire shape, same file, three lines away — and
    // LOAD-BEARING in a way `value_scale` is not. Dropping it silently changes
    // what the record MEANS: a stated `target` becomes a figure with no role,
    // and `goalValueIsATarget` reads an unstated role as a target anyway. So
    // absence is NOT byte-identical to prior behaviour here, which is precisely
    // the criterion that admits `value_scale` and refuses `role`.
    const out = seam(records((r) => {
      (r.stated_items as Array<Record<string, unknown>>)[1]!.role = "nonsense";
    }));
    expect(out.ok, "the tolerance must not have spread to the optional enums").toBe(false);
    expect(out.reason).toBe("not_a_record_set");
  });

  it("CONTRAST — and on the CLAIMS shape too, which the stated rows cannot witness", () => {
    // ⚠ HALF-CLOSING THIS WAS NOT ENOUGH, and the mutants said so. Adding the
    // `role` row above made the reviewer's `role` mutant bite — and its
    // `effect` mutant STAYED INVISIBLE, because `effect` lives on the CLAIMS
    // wire shape and every fixture above carries an empty `claims` array. Two
    // shapes, two `.catch` sites, so two contrasts: a guard over one shape is
    // no evidence at all about the other.
    //
    // `effect` is load-bearing in the strongest sense available here — it is
    // the SIGN of a causal relationship. Dropping it silently does not degrade
    // a display, it reverses what the model said about the world.
    const out = seam(records((r) => {
      (r.claims as unknown[]).push({
        claim_kind: "causal_link",
        label: "headcount bears on revenue",
        from_stated: 1,
        to_stated: 0,
        effect: "nonsense",
      });
    }));
    expect(out.ok, "a malformed causal SIGN must never degrade to absence").toBe(false);
    expect(out.reason).toBe("not_a_record_set");
  });
});

/**
 * ⭐⭐ THE DERIVED HALF — WHICH FIELDS ARE TOLERANT, ASKED OF THE SCHEMA ITSELF.
 *
 * ⚠ THE BEHAVIOURAL CONTRASTS ABOVE CANNOT ANSWER THIS, and mutants proved it
 * twice in a row. Adding `.catch` to `role` was invisible until a `role` row
 * existed; adding it to `effect` was invisible until a CLAIMS row existed; and
 * `category` and `direction` were STILL invisible after both. Each fix bought
 * exactly one field, which is the signature of a hand-maintained mirror — the
 * defect this estate pays for most.
 *
 * So this asks the wire schema which fields carry `.catch()`, rather than
 * guessing a list. A NEW tolerance anywhere on either shape — including on a
 * field that does not exist yet — turns this red without anyone remembering to
 * add a row.
 */
/**
 * Which fields silently accept something they should refuse — asked of
 * BEHAVIOUR, not of zod's internals.
 *
 * ⚠⚠ THE FIRST VERSION READ `_def.typeName === "ZodCatch"` AND WAS BLIND TO THE
 * SAME TWO WORDS IN THE OTHER ORDER. An independent reviewer measured it:
 *
 *   optional().catch()   outermost ZodCatch     -> seen
 *   catch().optional()   outermost ZodOptional  -> INVISIBLE, and tolerant at
 *                                                  runtime all the same
 *   preprocess+optional  outermost ZodEffects   -> INVISIBLE
 *
 * Reproduced end to end: mutating `category` to `.catch().optional()` made
 * `category: "nonsense"` parse to `undefined` instead of refusing — a real
 * widening — and this file stayed **9 of 9 green**. The precondition could not
 * help, because the three genuinely-tolerant fields still read as `ZodCatch`,
 * so the set was non-empty and not everything.
 *
 * ⭐ So it asks each field to parse a value NO schema on this wire accepts. A
 * field that succeeds is tolerant, however that tolerance is spelled — and a
 * zod rename cannot blind a reader that never touches `_def`. Same answer as
 * the internals reader on every pristine shape; strictly more on the mutants.
 *
 * ⛔ THE EXPECTED SETS BELOW STAY HAND-WRITTEN, deliberately. Deriving them too
 * would prove the code agrees with itself and could never say the list is
 * WRONG (trap 12d). The reader is derived; the decision is written down.
 */
const REFUSED_BY_EVERY_FIELD_TYPE = Symbol("no schema on this wire accepts this") as unknown;

function tolerantFields(shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }>): string[] {
  return Object.entries(shape)
    .filter(([, field]) => field.safeParse(REFUSED_BY_EVERY_FIELD_TYPE).success)
    .map(([k]) => k)
    .sort();
}

describe("the tolerance is exactly where it was decided, and nowhere else", () => {
  const arr = (DraftRecordSetWire as unknown as { shape: Record<string, { element: { shape: Record<string, unknown> } }> }).shape;
  const stated = arr.stated_items!.element.shape;
  const claims = arr.claims!.element.shape;

  it("STATED — only `value_scale` and the two `applies_to_*` degrade", () => {
    // `applies_to_*` is the pre-existing ruling this one follows; `value_scale`
    // is this change. Anything else appearing here is a tolerance nobody argued
    // for.
    expect(tolerantFields(stated)).toEqual(["applies_to_claim", "applies_to_stated", "value_scale"]);
  });

  it("CLAIMS — only `value_scale` degrades", () => {
    expect(tolerantFields(claims)).toEqual(["value_scale"]);
  });

  it("EVERY top-level shape is covered — a third one cannot appear unnoticed", () => {
    // The two assertions above name their shapes by hand, so a third top-level
    // shape would be uncovered with nothing to fail. Latent today, and closed
    // here rather than rowed because it is one line.
    expect(Object.keys(arr).sort()).toEqual(["claims", "stated_items"]);
  });

  it("PRECONDITION — the probe can see a tolerance at all", () => {
    // Without this, both assertions above are satisfied by a reader that always
    // returns [] — a guard agreeing with itself. Belt and braces now that the
    // reader is behavioural, rather than the only defence it was when the
    // reader depended on a zod-internal spelling.
    expect(tolerantFields(stated).length).toBeGreaterThan(0);
    expect(Object.keys(stated).length).toBeGreaterThan(tolerantFields(stated).length);
  });
});
