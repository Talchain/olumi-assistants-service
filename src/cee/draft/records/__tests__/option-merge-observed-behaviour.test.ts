/**
 * ⭐⭐ THE OPTION-ABSORPTION LOSS I RECORDED EARLIER DOES NOT REPRODUCE, AND THIS
 * FILE IS THE WITHDRAWAL PLUS THE MECHANISM IT REVEALED.
 *
 * An earlier note in this programme claimed one clear alternative loss —
 * "Hold Price, Invest in Conversion" absorbed into another option. Checked
 * against every banked live capture: **that label appears in none of them.**
 * Either it came from a capture no longer held, or the note was wrong. Either
 * way it is not evidence, and I am not building a fix on it.
 *
 * ⛔ WHAT IS REAL, measured across the banked tapes. Exactly two merge
 * disclosures exist in the whole corpus, both in `sharedrelease`:
 *
 *   refinement_merged_into_stated_option :: 'Raise to £59 on Feature Release'
 *   refinement_merged_into_stated_option :: 'Hold at £49, Drive Volume'
 *
 * **Both are correct.** Each is a shorter restatement of the user's own stated
 * option ("increase the Pro plan price to £59 with the next Pro feature
 * release" / "hold at £49 and ship the same feature release to drive volume").
 * Absorbing a second name for the user's alternative is exactly what the merge
 * exists to do.
 *
 * ⭐ AND THE MECHANISM IS VISIBLE IN THE SAME TAPE, WHICH IS WHY THIS TEST
 * EXISTS. The selection predicate is BASIS ARITY ALONE —
 * `if (namedOptions.length !== 1) return;` — and the third refinement in that
 * capture, 'Staged Increase: £54 Now, £59 at Next Release', cites TWO stated
 * options (`basis: [2, 3]`) and therefore **survives untouched**. So today a
 * refinement's fate turns on how many of the user's options it happened to cite
 * as evidence, not on whether it is a different alternative.
 *
 * ⚠ THAT IS STILL A LATENT RISK worth naming even though the corpus shows no
 * harm from it: `basis` is an EVIDENCE field ("the array positions of the
 * stated_items your claim builds on"), so a genuinely distinct alternative that
 * cites ONE of the user's options as its point of contrast is, by this
 * predicate, indistinguishable from a restatement of it. A synthetic case built
 * to exploit that was NOT absorbed — the existing conflict guard caught it — so
 * the hole is narrower than the predicate suggests, and I could not construct a
 * reproducing input. Recorded as a risk with no measured instance rather than
 * fixed on speculation.
 *
 * This file pins the observed behaviour so a change to it is deliberate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { projectDraftRecords } from "../seam.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * ⚠ THE IN-REPO BANKED CAPTURE, not a path into someone's evidence directory. A
 * test that reads an absent file and returns early is vacuous in CI — it passes
 * by testing nothing, which is the failure mode this suite exists to hunt. So
 * this loads the fixture the repo carries and throws if it cannot.
 */
const TAPE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/2026-09-15-option-effect-references/live-option-effect-refs-off-by-one-2026-09-15.json",
);

function findList(o: unknown, key: string): unknown[] | undefined {
  if (Array.isArray(o)) {
    for (const v of o) {
      const r = findList(v, key);
      if (r) return r;
    }
    return undefined;
  }
  if (o !== null && typeof o === "object") {
    const rec = o as Record<string, unknown>;
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
    for (const v of Object.values(rec)) {
      const r = findList(v, key);
      if (r) return r;
    }
  }
  return undefined;
}

function tape(): DraftRecordSet {
  const raw: unknown = JSON.parse(readFileSync(TAPE, "utf8"));
  const stated_items = findList(raw, "stated_items");
  const claims = findList(raw, "claims");
  if (!stated_items || !claims) throw new Error("banked capture is missing stated_items/claims");
  return { stated_items, claims } as unknown as DraftRecordSet;
}

describe("M1 — the observed merge behaviour, from the live capture", () => {
  const records = tape();

  it("M1a PRECONDITION: the capture is readable and carries three refinements", () => {
    const refs = (records.claims as ReadonlyArray<Record<string, unknown>>).filter(
      (c) => c.claim_kind === "option_refinement",
    );
    expect(refs).toHaveLength(3);
  });

  it("M1b the two ABSORBED refinements are both restatements — the merge is right", () => {
    const out = projectDraftRecords(records, undefined);
    expect(out.ok, "the banked capture must project").toBe(true);
    if (!out.ok) throw new Error(out.reason);
    const merged = (
      out.projection as unknown as { dropped: ReadonlyArray<{ reason: string; label: string }> }
    ).dropped
      .filter((d) => d.reason === "refinement_merged_into_stated_option")
      .map((d) => d.label)
      .sort();
    expect(merged).toEqual(["Hold at £49, Drive Volume", "Raise to £59 on Feature Release"]);
  });

  it("M1c THE MECHANISM: the refinement citing TWO stated options survives, by arity alone", () => {
    const out = projectDraftRecords(records, undefined);
    if (!out.ok) throw new Error(out.reason);
    const labels = (
      out.projection as unknown as { graph: { nodes: ReadonlyArray<{ kind: string; label: string }> } }
    ).graph.nodes
      .filter((n) => n.kind === "option")
      .map((n) => n.label);
    expect(
      labels,
      "basis: [2, 3] — two cited options, so `namedOptions.length !== 1` and it is never a merge candidate",
    ).toContain("Staged Increase: £54 Now, £59 at Next Release");
  });

  it("M1d the user's OWN stated options are never the thing absorbed", () => {
    const out = projectDraftRecords(records, undefined);
    if (!out.ok) throw new Error(out.reason);
    const labels = (
      out.projection as unknown as { graph: { nodes: ReadonlyArray<{ kind: string; label: string }> } }
    ).graph.nodes
      .filter((n) => n.kind === "option")
      .map((n) => n.label);
    expect(labels).toContain("hold at £49 and ship the same feature release to drive volume");
    expect(labels).toContain("increase the Pro plan price to £59 with the next Pro feature release");
  });
});
