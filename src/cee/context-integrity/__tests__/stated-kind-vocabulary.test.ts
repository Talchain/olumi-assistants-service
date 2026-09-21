/**
 * S1 — THE RECEIPT GETS A KIND VOCABULARY.
 *
 * ── THE MEASURED PROBLEM, AT THE BYTES ─────────────────────────────────────
 * On the deployed cold read for the 4-day-week brief (CEE build `32f06dd`,
 * captured 2026-08-10T22:50Z, carried whole in
 * `fixtures/live-4day-week.cold-read.json`) the manifest reports:
 *
 *   "85%"      kind=percent  verdict=prose_only   ← the board's HARD FLOOR
 *   "15%"      kind=percent  verdict=prose_only   ← the ops lead's guess
 *   "4%"       kind=percent  verdict=prose_only   ← the Manchester pilot
 *
 * Three different KINDS of thing, reported identically. The invariant — that
 * every stated goal, constraint, figure, evidence item and assumption is
 * retained and correctly CLASSIFIED — is not merely unmet; it is unmeasurable,
 * because the receipt has no word in which to state it.
 *
 * ── THE ORACLE IS THE PRODUCER, NOT MY READING ─────────────────────────────
 * trap 13c: a mutant kit measures whether a test can DETECT a change, never
 * whether the EXPECTATION is right. So `constraint` is asserted ONLY where the
 * graph's own `goal_constraints[]` row claims the figure, with its
 * `source_quote` — the live producer at `anthropic-graph-schema.ts:447-467`.
 * Nothing here re-reads the brief to decide what kind of thing a figure is.
 * A figure no producer claims is a `figure`, and that is the honest answer.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT ASSERT ────────────────────────────
 * That "85%" is a constraint. It IS one in English, and the pipeline lost it
 * (measured: `goal_constraints[]` carries the £250,000 limit and NOT the CSAT
 * floor in this run). Classifying it from prose would be a fifth extractor and
 * a misclassification risk; ROADMAP 2.1051 forbids exactly that. S1's job is to
 * make the loss VISIBLE, not to guess it back.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  deriveNotModelledManifest,
  STATED_KINDS,
  type StatedKind,
  type NotModelledItem,
} from "../not-modelled-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface ColdRead {
  readonly brief_text: string;
  readonly graph: Record<string, unknown>;
}

function loadCapture(name: string): ColdRead {
  return JSON.parse(
    readFileSync(join(HERE, "fixtures", `${name}.cold-read.json`), "utf8"),
  ) as ColdRead;
}

const LIVE = loadCapture("live-4day-week");
const B1 = loadCapture("b1-growth");
const B2 = loadCapture("b2-restructuring");
const B3 = loadCapture("b3-product-bet");

function derive(c: ColdRead) {
  const m = deriveNotModelledManifest(c.brief_text, c.graph);
  if (m.status !== "derived" || m.quantities === null) {
    throw new Error(`fixture did not derive: ${m.status}`);
  }
  return m;
}

/**
 * ANTI-VACUITY (trap 19): bind by IDENTITY — `(literal, char_offset)` — never
 * by a value predicate another item could satisfy. "85%" occurs TWICE in this
 * brief (offsets 173 and 468); a lookup by literal alone would silently pick
 * whichever came first and the assertion would be about the wrong object.
 */
function itemAt(
  items: readonly NotModelledItem[],
  literal: string,
  charOffset: number,
): NotModelledItem {
  const hit = items.find(
    (i) => i.literal === literal && i.char_offset === charOffset,
  );
  if (hit === undefined) {
    throw new Error(
      `no item ${JSON.stringify(literal)}@${charOffset}; present: ` +
        items.map((i) => `${i.literal}@${i.char_offset}`).join(", "),
    );
  }
  return hit;
}

/** Proves the fixture genuinely carries that literal at that offset, so a
 *  typo'd expectation cannot pass by finding nothing. */
function expectStatedAt(brief: string, literal: string, at: number): void {
  expect(brief.slice(at, at + literal.length)).toBe(literal);
}

describe("S1 · every reported item carries a stated_kind", () => {
  it("emits stated_kind on every item of every captured brief", () => {
    for (const [name, cap] of [
      ["live", LIVE],
      ["b1", B1],
      ["b2", B2],
      ["b3", B3],
    ] as const) {
      const m = derive(cap);
      expect(m.quantities!.items.length, `${name} has items`).toBeGreaterThan(0);
      for (const item of m.quantities!.items) {
        expect(
          STATED_KINDS as readonly string[],
          `${name} ${item.literal}@${item.char_offset}`,
        ).toContain(item.stated_kind);
      }
    }
  });
});

describe("S1 · constraint is sourced from the live producer, never from prose", () => {
  it("classifies £250,000 as a constraint — the graph's goal_constraints[] row claims it, with its source_quote", () => {
    // The producer's own row, read at the fixture bytes. If this changes, the
    // expectation must change with it — the producer is the oracle.
    const gc = (LIVE.graph as any).goal_constraints as Array<
      Record<string, unknown>
    >;
    const spendRow = gc.find((r) => r.node_id === "fac_impl_spend");
    expect(spendRow, "fixture carries the producer row this test is about").toBeDefined();
    expect(spendRow!.source_quote).toBe(
      "Total implementation spend must not exceed £250,000",
    );

    expectStatedAt(LIVE.brief_text, "£250,000", 258);
    const m = derive(LIVE);
    expect(itemAt(m.quantities!.items, "£250,000", 258).stated_kind).toBe(
      "constraint",
    );
  });

  it("classifies the board's CSAT floor as a figure — NO producer claimed it, and inventing the classification is the failure mode", () => {
    // MEASURED: in this deployed run the CSAT floor never reached
    // goal_constraints[]. That is the M1 loss. The receipt must not paper over
    // it by re-deriving `constraint` from the brief's prose.
    const gc = (LIVE.graph as any).goal_constraints as Array<
      Record<string, unknown>
    >;
    expect(
      gc.some((r) => r.node_id === "out_csat"),
      "precondition: no producer row for the CSAT floor in this capture",
    ).toBe(false);

    expectStatedAt(LIVE.brief_text, "85%", 173);
    const m = derive(LIVE);
    expect(itemAt(m.quantities!.items, "85%", 173).stated_kind).toBe("figure");
  });

  it("does not classify a figure as a constraint merely because its number appears in a constraint row", () => {
    // OPPOSITE-DIRECTION TWIN (trap 22b). "87%" is the CURRENT CSAT — a stated
    // observation, not a limit — and it is `in_model` on `out_csat`. A binding
    // rule keyed on value-or-node alone would sweep it up as a constraint.
    expectStatedAt(LIVE.brief_text, "87%", 141);
    const m = derive(LIVE);
    const cur = itemAt(m.quantities!.items, "87%", 141);
    expect(cur.verdict).toBe("in_model");
    expect(cur.matched_node_id).toBe("out_csat");
    expect(cur.stated_kind).toBe("figure");
  });

  it("binds the constraint to the OCCURRENCE the producer quoted, not to every occurrence of the same literal", () => {
    // "£250,000" occurs at 258 (inside the quoted constraint sentence) and at
    // 493 (inside the success restatement, which no producer row quotes).
    // A literal-keyed rule would mark both; identity binding must not.
    expectStatedAt(LIVE.brief_text, "£250,000", 258);
    expectStatedAt(LIVE.brief_text, "£250,000", 493);
    const m = derive(LIVE);
    expect(itemAt(m.quantities!.items, "£250,000", 258).stated_kind).toBe(
      "constraint",
    );
    expect(itemAt(m.quantities!.items, "£250,000", 493).stated_kind).toBe(
      "figure",
    );
  });
});

/**
 * ── THE CLASSES MY CAPTURED CORPUS DOES NOT CONTAIN ────────────────────────
 *
 * Four real briefs are evidence about the shapes they happen to contain, and
 * silent about every shape they do not. The mutation kit made that concrete:
 * two mutants that break the classifier SURVIVED, not because the guards are
 * equivalent but because no captured brief reaches those branches. A corpus
 * that omits a class the contract admits cannot certify the code over that
 * class — so the omitted classes are constructed here, deliberately, from the
 * producer's own declared shape.
 *
 * The graphs below are hand-built ON PURPOSE and say nothing about the wire.
 * They exist to exercise `goal_constraints[]` rows the drafting model is
 * PERMITTED to emit — `value` is optional in the grammar, and `source_quote` is
 * a model CLAIM about the brief, not proof of one.
 */
describe("S1 · producer rows the captured corpus never contained", () => {
  function graphWithConstraintRow(row: Record<string, unknown>) {
    return { nodes: [{ id: "out_csat", kind: "outcome", label: "CSAT" }], edges: [], goal_constraints: [row] };
  }
  const BRIEF = "Do not let CSAT drop below 85% — that is a hard limit for the board.";

  it("PRECONDITION: an ordinary row over this brief DOES classify — so a null below means the guard fired, not that nothing was found", () => {
    // Without this, every "not a constraint" assertion here could pass because
    // the fixture never classified anything in the first place (trap 13).
    const m = deriveNotModelledManifest(
      BRIEF,
      graphWithConstraintRow({
        node_id: "out_csat",
        value: 85,
        unit: "%",
        source_quote: "Do not let CSAT drop below 85%",
      }),
    );
    const item = (m.quantities!.items as NotModelledItem[]).find((i) => i.literal === "85%")!;
    expect(item.stated_kind).toBe("constraint");
  });

  it("classifies nothing from a row with NO value — a quote alone cannot say which figure it is about", () => {
    // `value` is optional in the producer's grammar. Position alone would mark
    // EVERY quantity inside the quoted span, and a limit sentence routinely
    // contains figures that are not the limit.
    const m = deriveNotModelledManifest(
      BRIEF,
      graphWithConstraintRow({ node_id: "out_csat", source_quote: "Do not let CSAT drop below 85%" }),
    );
    for (const item of m.quantities!.items) expect(item.stated_kind).toBe("figure");
  });

  it("THE FABRICATION GATE: an unlocatable source_quote classifies nothing", () => {
    // A model quote is a CLAIM about the brief. The estate has measured a
    // hallucinated figure receiving `from_brief` provenance identically to a
    // quoted one, so substring verification is an invariant, not a courtesy.
    // A quote that cannot be located must classify NOTHING — never fall back to
    // "somewhere in the brief".
    const m = deriveNotModelledManifest(
      BRIEF,
      graphWithConstraintRow({
        node_id: "out_csat",
        value: 85,
        unit: "%",
        source_quote: "The board mandated a 85% floor in the Q3 offsite",
      }),
    );
    for (const item of m.quantities!.items) expect(item.stated_kind).toBe("figure");
  });

  it("locates a quote whose whitespace differs from the brief's — a newline is not a fabrication", () => {
    // OPPOSITE-DIRECTION TWIN of the gate above. Failing closed on a real quote
    // that merely wrapped differently would silently under-classify, which is
    // the same harm pointed the other way.
    const wrapped = "Do not let CSAT\n  drop below 85% — that is a hard limit.";
    const m = deriveNotModelledManifest(
      wrapped,
      graphWithConstraintRow({
        node_id: "out_csat",
        value: 85,
        unit: "%",
        source_quote: "Do not let CSAT drop below 85%",
      }),
    );
    const item = (m.quantities!.items as NotModelledItem[]).find((i) => i.literal === "85%")!;
    expect(item.stated_kind).toBe("constraint");
  });
});

describe("S1 · the adoption manifest — no kind ships dark", () => {
  /**
   * ⚠ THE EXPECTATION IS HAND-WRITTEN AND MUST STAY HAND-WRITTEN.
   *
   * The first version of this test derived its expectation from `STATED_KINDS`
   * — the very list it guards. A reviewer added a NINTH member and the spec
   * stayed 17/17 GREEN: a derived check proves the copies AGREE and can never
   * prove the list is RIGHT. An unsanctioned kind could have shipped, dark, past
   * a green suite.
   *
   * These eight are the vocabulary the design ratified. Adding a ninth is a
   * PRODUCT decision — it must RED here and be argued for, not arrive as a
   * silent widening.
   */
  const SANCTIONED_KINDS = [
    "assumption",
    "constraint",
    "correction",
    "disagreement",
    "evidence",
    "figure",
    "goal",
    "option",
  ] as const;

  it("emits exactly the eight sanctioned kinds — a ninth must RED here", () => {
    expect([...STATED_KINDS].sort()).toEqual([...SANCTIONED_KINDS]);
  });

  it("partitions the sanctioned kinds into sourced and unsourced, with no overlap and no omission", () => {
    const m = derive(LIVE);
    const sk = m.stated_kinds;
    expect(sk.status).toBe("derived");

    // Compared against the HAND-WRITTEN set, not against `STATED_KINDS`.
    const union = [...sk.sourced, ...sk.unsourced].sort();
    expect(union).toEqual([...SANCTIONED_KINDS]);

    const overlap = sk.sourced.filter((k) => (sk.unsourced as readonly StatedKind[]).includes(k));
    expect(overlap, "a kind cannot be both sourced and unsourced").toEqual([]);
  });

  it("names the producer for every sourced kind — an unnamed producer is a dark ship", () => {
    const m = derive(LIVE);
    for (const kind of m.stated_kinds.sourced) {
      const producer = m.stated_kinds.producers[kind];
      expect(typeof producer, `producer named for ${kind}`).toBe("string");
      expect((producer ?? "").length, `producer non-empty for ${kind}`).toBeGreaterThan(0);
    }
  });

  it("DEMONSTRATES every sourced kind actually producing, across the whole corpus", () => {
    // ⚠ NAMING A PRODUCER IS NOT HAVING ONE. The mutation kit proved it: adding
    // `disagreement: "none"` to the producer map moved a kind into `sourced`
    // and every other assertion here stayed green — a guard agreeing with
    // itself. The estate's named failure mode is meaning fields that shipped
    // with a declared producer and no output, dark from birth.
    //
    // So the claim is checked the only way it can be: a kind may sit in
    // `sourced` ONLY if some real captured brief actually yields an item of
    // that kind. If a future kind is genuinely sourced but appears in none of
    // these four briefs, this test SHOULD fail — that is exactly the moment
    // someone must add a capture that demonstrates it, or move it to
    // `unsourced` and be honest.
    const observed = new Set<StatedKind>();
    for (const cap of [LIVE, B1, B2, B3]) {
      for (const item of derive(cap).quantities!.items) observed.add(item.stated_kind);
    }
    for (const kind of derive(LIVE).stated_kinds.sourced) {
      expect(
        observed.has(kind),
        `${kind} is declared sourced but no captured brief produces one`,
      ).toBe(true);
    }
  });

  it("emits no item of an unsourced kind — the partition is a claim about the data, not a label", () => {
    for (const cap of [LIVE, B1, B2, B3]) {
      const m = derive(cap);
      const unsourced = new Set<string>(m.stated_kinds.unsourced);
      for (const item of m.quantities!.items) {
        expect(
          unsourced.has(item.stated_kind),
          `${item.literal}@${item.char_offset} is ${item.stated_kind}, declared unsourced`,
        ).toBe(false);
      }
    }
  });

  it("tallies exactly the reported items, per kind", () => {
    const m = derive(LIVE);
    const counted: Record<string, number> = {};
    for (const i of m.quantities!.items) {
      counted[i.stated_kind] = (counted[i.stated_kind] ?? 0) + 1;
    }
    for (const kind of STATED_KINDS) {
      expect(m.stated_kinds.tally[kind], `tally[${kind}]`).toBe(
        counted[kind] ?? 0,
      );
    }
  });
});

/**
 * ── THE DEPLOYED-CONSUMER COMPATIBILITY CONTROL ────────────────────────────
 *
 * ⛔ DEPLOY ORDER (design §5): consumers deploy fail-closed BEFORE the producer
 * emits. The deployed UI parser
 * (`DecisionGuideAI/src/adapters/cee/notModelled.ts`, read at
 * `084ff1f77cd3e9e763647368ae423d1e294886e0`) validates each item against
 * CLOSED sets and then does this:
 *
 *     const item = parseItem(r)
 *     if (item === null) return null      // ← the WHOLE manifest, not the item
 *
 * So ONE item carrying a `kind` or `verdict` the deployed UI does not know
 * turns the entire "What I was given" section from eleven honest rows into
 * "we cannot tell you". An additive server change would silently delete a
 * shipped user surface.
 *
 * The sets below are PINNED TO THAT COMMIT (trap 12b — a control whose
 * reference is "whatever is deployed now" is a control with an expiry date
 * nobody wrote down). They are the deployed UI's, not ours, and they are
 * deliberately NOT imported from this module: a control derived from the thing
 * it controls is a guard agreeing with itself (trap 13b).
 */
describe("S1 · the legacy axes stay byte-identical for the deployed UI", () => {
  const UI_SHA = "084ff1f77cd3e9e763647368ae423d1e294886e0";
  const DEPLOYED_UI_KINDS = ["money", "percent", "count", "date", "period"];
  const DEPLOYED_UI_VERDICTS = ["in_model", "prose_only", "absent"];

  it(`emits only kinds the UI at ${UI_SHA} accepts`, () => {
    for (const cap of [LIVE, B1, B2, B3]) {
      for (const item of derive(cap).quantities!.items) {
        expect(DEPLOYED_UI_KINDS).toContain(item.kind);
      }
    }
  });

  it(`emits only verdicts the UI at ${UI_SHA} accepts`, () => {
    for (const cap of [LIVE, B1, B2, B3]) {
      for (const item of derive(cap).quantities!.items) {
        expect(DEPLOYED_UI_VERDICTS).toContain(item.verdict);
      }
    }
  });

  it("keeps stated_kind on a SEPARATE axis — the deployed parser reads five named fields and ignores the rest", () => {
    // The parser destructures {literal, kind, char_offset, verdict,
    // matched_node_id}. Extra properties are ignored, which is why the kind
    // axis can ship from CEE alone. This asserts the five it reads are all
    // still present and still the right primitive types.
    const item = derive(LIVE).quantities!.items[0]!;
    expect(typeof item.literal).toBe("string");
    expect(typeof item.kind).toBe("string");
    expect(Number.isInteger(item.char_offset)).toBe(true);
    expect(typeof item.verdict).toBe("string");
    expect(
      item.matched_node_id === null || typeof item.matched_node_id === "string",
    ).toBe(true);
  });
});
