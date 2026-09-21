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

import { projectDraftRecords } from "../seam.js";

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

  it("CONTRAST — a malformed DISCRIMINATOR still refuses, so the tolerance has not widened", () => {
    // `kind` is load-bearing: the projector's switch branches on it. If this
    // ever goes green, the seam has become permissive in general and the three
    // tests above stop being evidence about `value_scale` specifically.
    const out = seam(records((r) => {
      (r.stated_items as Array<Record<string, unknown>>)[1]!.kind = "nonsense";
    }));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("not_a_record_set");
  });
});
