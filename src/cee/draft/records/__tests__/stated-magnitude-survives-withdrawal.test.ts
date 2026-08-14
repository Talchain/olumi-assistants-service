/**
 * M1a — THE USER'S NUMBER MUST SURVIVE THE WITHDRAWAL THAT REMOVES ITS NODE.
 *
 * ── WHAT WAS MEASURED, AND WHERE THE DEFECT LIVES ──────────────────────────
 * The first-use acceptance shield (`first-use-acceptance-2026-08-14/VERDICT.md`,
 * P0-1) scored **0 of 18 stated money magnitudes extracted as a value** on the
 * deployed build. Replaying the banked live emission at `b3c0c7b3` reproduces the
 * mechanism exactly: 12 of the 20 stated items carry a numeric value, and the
 * projector's connectivity prune (`projector.ts`, Pass 3b) withdraws every one of
 * them with `reason: "unconnected_to_goal"`.
 *
 * The withdrawal itself is CORRECT and this suite does not challenge it — forcing
 * the node onto the graph means either inventing a causal edge (a machine-authored
 * claim shown to the user as their own model) or letting `NO_PATH_TO_GOAL` reject
 * the draft. Both are worse than disclosing.
 *
 * ⚠ AND THE ALTERNATIVE WAS MEASURED, NOT ASSUMED
 * (`m1a-frombrief-lane-2026-08-14/01-M1a-SHAPE-PROBE-lane-G-premise-REFUTED.md`).
 * Exempting stated-value nodes from this prune does NOT deliver them: the
 * deterministic sweep reclassifies all 12 to `external` and
 * `pruneDisconnectedObservables` then removes 11 of them, logging nothing but a
 * hashed id. The post-sweep graph is the same 14 nodes either way. An exemption
 * therefore MOVES the loss from a disclosed channel to an undisclosed one — a fix
 * that closes a gap and reopens a lie (CLAUDE.md trap 22b).
 *
 * ── SO WHAT THIS SUITE PINS ────────────────────────────────────────────────
 * The defect that IS in scope: the disclosure carried the user's WORDS and threw
 * away their NUMBER. `DroppedRecordRef` had `label` and `node_id` and nothing
 * else, so "you told me this and it is not in the model" reached the wire without
 * the magnitude that makes the sentence worth reading, and every downstream
 * surface would have had to re-parse the quote to recover it.
 *
 * ── THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT AGAINST THE SYMPTOM (13d) ─
 * The spec is: **the disclosed magnitude is the number the USER stated**, i.e.
 * `stated_items[].value` as the model transcribed it. It is NOT the normalised
 * level the graph computes on, which is frame-relative (£7.2m becomes `0.72` on a
 * £10m frame) and which the user never wrote. Every assertion below therefore
 * compares against the FIXTURE's own `value`, never against whatever the node
 * happens to hold, and the level is asserted to be ABSENT from the disclosure.
 *
 * The producer reads this from the carriers whose declared contract is "the raw
 * user magnitude, KEPT, never overwritten with the level" —
 * `observed_state.raw_value` for a figure, `observed_state.metadata.original_value`
 * for a constraint — and deliberately NOT from `data.value`, which holds the user's
 * number only because the frame pass has not run yet at the moment the prune fires.
 * A source that is right by accident of pass ORDER is a defect waiting for a
 * refactor; these tests pin the number, and the producer's comment pins the reason.
 *
 * ── EVERY ASSERTION BINDS BY IDENTITY (trap 19) ────────────────────────────
 * Disclosures are located by the projector's own minted `node_id`, or by the EXACT
 * verbatim `source_quote` the projector uses as the node's label — never by "the
 * disclosure whose value is 7200000", which a second record could satisfy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DraftRecordSet } from "../index.js";
import { projectRecordsToGraph, statedMagnitudeOf } from "../projector.js";
import { replayRecordSet } from "../replay.js";
import { transformResponseToV3 } from "../../../transforms/schema-v3.js";
import { CEEGraphResponseV3 } from "../../../../schemas/cee-v3.js";

const FIXTURES = join(__dirname, "fixtures");

function loadBankedEmission(): DraftRecordSet {
  return JSON.parse(
    readFileSync(join(FIXTURES, "live-emission-round11-set12.json"), "utf8"),
  ) as DraftRecordSet;
}

/** The stated items that carry a magnitude, paired with their verbatim quote. */
function statedMagnitudes(set: DraftRecordSet): Array<{ quote: string; value: number; unit?: string }> {
  return (set.stated_items as ReadonlyArray<Record<string, unknown>>)
    .filter((s) => typeof s.value === "number")
    .map((s) => ({
      quote: String(s.source_quote ?? ""),
      value: s.value as number,
      ...(typeof s.unit === "string" ? { unit: s.unit } : {}),
    }));
}

describe("M1a — a withdrawn stated figure keeps its magnitude on the disclosure", () => {
  it("carries the USER'S value and unit on every `unconnected_to_goal` disclosure, 12 of 12", async () => {
    const set = loadBankedEmission();
    const magnitudes = statedMagnitudes(set);
    // The suite's own precondition (trap 13): a fixture that stopped carrying
    // values would make every assertion below pass by testing nothing.
    expect(magnitudes.length).toBe(12);

    const result = await replayRecordSet(set, { brief: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const withdrawn = result.projection.dropped.filter((d) => d.reason === "unconnected_to_goal");
    // Bind by the EXACT verbatim quote — the projector uses it as the node label.
    for (const m of magnitudes) {
      const disclosure = withdrawn.find((d) => d.label === m.quote);
      expect(disclosure, `no disclosure for stated quote: ${m.quote}`).toBeDefined();
      expect(disclosure!.value, `magnitude lost for: ${m.quote}`).toBe(m.value);
      if (m.unit !== undefined) expect(disclosure!.unit).toBe(m.unit);
    }
  });

  it("discloses the STATED magnitude, never the normalised level (the spec, not the symptom)", () => {
    // £7,200,000 is carried on the node as `raw_value: 7200000` with a
    // frame-relative `value` far below it. A disclosure that emitted the level
    // would be a NEW lie — a number the user never wrote, attributed to them.
    const set = loadBankedEmission();
    const projection = projectRecordsToGraph(set, { brief: undefined });
    const quote = "up to £7.2m a year if attach were 100%";
    const disclosure = projection.dropped.find(
      (d) => d.reason === "unconnected_to_goal" && d.label === quote,
    );
    expect(disclosure).toBeDefined();
    expect(disclosure!.value).toBe(7200000);
    expect(disclosure!.unit).toBe("£");
    // …and the level is NOT what got disclosed.
    expect(disclosure!.value).not.toBe(0.72);
  });

  it("OPPOSITE TWIN — a withdrawn record with no stated magnitude gains no value key at all", async () => {
    // The prune's established behaviour for everything else must be byte-stable:
    // an absent magnitude is an ABSENT KEY, never `undefined`, never 0.
    const result = await replayRecordSet(loadBankedEmission(), { brief: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Claim-derived withdrawals (`claim_kind: "claim"`) are the model's own
    // factors, not the user's figures — bound by kind, and asserted non-empty so
    // this twin cannot pass vacuously.
    const claimWithdrawals = result.projection.dropped.filter(
      (d) => d.reason === "unconnected_to_goal" && d.claim_kind === "claim",
    );
    expect(claimWithdrawals.length).toBeGreaterThan(0);
    for (const d of claimWithdrawals) {
      expect(Object.prototype.hasOwnProperty.call(d, "value"), `${d.label} gained a value key`).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(d, "unit")).toBe(false);
    }

    // And every non-connectivity disclosure is untouched by this change.
    const others = result.projection.dropped.filter((d) => d.reason !== "unconnected_to_goal");
    expect(others.length).toBeGreaterThan(0);
    for (const d of others) {
      expect(Object.prototype.hasOwnProperty.call(d, "value"), `${d.reason} gained a value`).toBe(
        false,
      );
    }
  });

  /**
   * ⭐ THE DISCRIMINATING PAIR FOR THE PROVENANCE GUARD (trap 19).
   *
   * The end-to-end twin above cannot see this guard, and the mutant kit proved
   * it: deleting `provenance_class !== "stated"` SURVIVED every fixture, because
   * no model-derived node holds `observed_state.raw_value` at the moment the
   * prune runs. The twin was agreeing with itself — it observed the ABSENCE OF A
   * CARRIER and read that as the guard working (trap 13b).
   *
   * So the guard is exercised where it is observable: hand it the exact node the
   * fixture cannot produce. The two cases differ ONLY in `provenance_class`, so a
   * pass here is the guard's doing and not the payload's.
   */
  it("refuses a magnitude on a MODEL-derived node, and accepts the identical STATED one", () => {
    const carrier = {
      id: "n_probe",
      kind: "factor" as const,
      label: "Copilot Year-One Revenue",
      observed_state: { value: 0.7, raw_value: 700000 },
      data: { unit: "£" },
    };

    const modelDerived = statedMagnitudeOf({
      ...carrier,
      provenance: { provenance_class: "claim" },
    } as never);
    expect(modelDerived).toEqual({});

    const userStated = statedMagnitudeOf({
      ...carrier,
      provenance: { provenance_class: "stated" },
    } as never);
    // The payload IS capable of yielding a magnitude — so the refusal above was
    // the guard refusing, not the carrier being empty.
    expect(userStated).toEqual({ value: 700000, unit: "£" });
  });

  it("takes a constraint's magnitude from `metadata.original_value`, and refuses a non-finite one", () => {
    const constraint = statedMagnitudeOf({
      id: "n_c",
      kind: "constraint",
      label: "the board approved £2m",
      provenance: { provenance_class: "stated" },
      observed_state: { value: 1200000, metadata: { original_value: 1200000, unit: "£" } },
      data: { operator: "<=" },
    } as never);
    expect(constraint).toEqual({ value: 1200000, unit: "£" });

    // NaN/Infinity are absent, never disclosed.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        statedMagnitudeOf({
          id: "n_bad",
          kind: "factor",
          label: "bad",
          provenance: { provenance_class: "stated" },
          observed_state: { raw_value: bad },
        } as never),
      ).toEqual({});
    }
  });

  it("is byte-stable across two replays", async () => {
    const a = await replayRecordSet(loadBankedEmission(), { brief: undefined });
    const b = await replayRecordSet(loadBankedEmission(), { brief: undefined });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("M1a — the magnitude reaches the CEE V3 wire, not just `projection.dropped`", () => {
  it("carries value and unit through `transformResponseToV3` and past the schema", () => {
    // The disclosure channel STRIPS undeclared fields silently
    // (`cee-v3.ts`: "THE TOP LEVEL OF THIS SCHEMA IS PLAIN `z.object`"), so a
    // producer-side fix that is not declared here dies at validation with only a
    // warn log. This drives the real transform and then the real parse.
    const set = loadBankedEmission();
    const projection = projectRecordsToGraph(set, { brief: undefined });

    const wire = CEEGraphResponseV3.parse(
      transformResponseToV3(
        { graph: projection.graph, record_disclosures: projection.dropped } as never,
        { brief: undefined },
      ),
    );

    const disclosures = wire.record_disclosures ?? [];
    // Nothing lost on the way — the channel's own invariant.
    expect(disclosures.length).toBe(projection.dropped.length);
    expect(wire.record_disclosures_omitted).toBeUndefined();

    const quote = "up to £7.2m a year if attach were 100%";
    const withdrawn = disclosures.find((d) => d.label === quote);
    expect(withdrawn).toBeDefined();
    expect(withdrawn!.withdrawn).toBe(true);
    expect(withdrawn!.value).toBe(7200000);
    expect(withdrawn!.unit).toBe("£");

    // All twelve survive the wire, bound by their verbatim quotes.
    const magnitudes = statedMagnitudes(set);
    expect(magnitudes.length).toBe(12);
    for (const m of magnitudes) {
      const d = disclosures.find((x) => x.label === m.quote);
      expect(d?.value, `magnitude lost at the wire for: ${m.quote}`).toBe(m.value);
    }
  });

  it("OPPOSITE TWIN — refuses a non-numeric or empty magnitude rather than emitting it", () => {
    // The disclosure is a sentence shown to a person. A producer that hands over
    // a string, a NaN or an empty unit must lose the field, not smuggle it: the
    // one channel whose job is telling the truth about a loss may not invent a
    // second falsehood in the process.
    const graph = { nodes: [], edges: [] };
    const wire = CEEGraphResponseV3.parse(
      transformResponseToV3(
        {
          graph,
          record_disclosures: [
            { claim_index: -1, claim_kind: "stated_item", label: "a string value",
              reason: "unconnected_to_goal", value: "7200000", unit: "£" },
            { claim_index: -1, claim_kind: "stated_item", label: "a NaN value",
              reason: "unconnected_to_goal", value: Number.NaN, unit: "£" },
            { claim_index: -1, claim_kind: "stated_item", label: "an empty unit",
              reason: "unconnected_to_goal", value: 42, unit: "" },
          ],
        } as never,
        { brief: undefined },
      ),
    );

    const byLabel = (l: string) => (wire.record_disclosures ?? []).find((d) => d.label === l)!;
    // Nothing is DROPPED — a rejected field is not a rejected disclosure.
    expect((wire.record_disclosures ?? []).length).toBe(3);
    expect(byLabel("a string value").value).toBeUndefined();
    expect(byLabel("a NaN value").value).toBeUndefined();
    expect(byLabel("an empty unit").value).toBe(42);
    expect(byLabel("an empty unit").unit).toBeUndefined();
  });
});
