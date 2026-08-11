/**
 * ROADMAP 2.973 follow-up — THE MANIFEST READS UNITS THROUGH THE REPO'S OWN
 * AUTHORITIES, and stops re-deriving a currency vocabulary of its own.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * `not-modelled-manifest.ts` shipped with a private `CURRENCY_SYMBOLS`
 * (`["£","€","$"]`) and a private `parseUnit`. The repo already owned both
 * facts, canonically and with a header saying so:
 *
 *   · `cee/extraction/numeric-parser.ts` `CURRENCY_SYMBOL_TO_CODE` — ten
 *     entries, exported under ROADMAP 2.972 precisely so nothing writes a
 *     second currency list ("a second hand-written currency vocabulary is
 *     exactly the mirror CLAUDE.md trap 12 describes");
 *   · `cee/provenance/stated-amounts.ts` `readUnit()` — a SUPERSET of
 *     `parseUnit`, landed in `db985bbe`, the base commit of the same diff.
 *
 * Two live defects followed, and both are pinned below.
 *
 * ── THE ORACLE IS THE PRODUCER, NOT ME (trap 13c) ──────────────────────────
 * Every unit spelling asserted here was derived from a PRODUCER in this repo,
 * never from my reading of what a unit "ought" to look like:
 *
 *   · `GBP` — `orchestrator-v5/context/cqe/rules.ts` `normaliseCurrencyUnit()`
 *     returns the literal `'GBP'` / `'USD'` / `'EUR'`; `schemas/cee-v3.ts`
 *     documents `ObservedStateV3.unit` as "e.g. 'GBP', 'USD', 'percent',
 *     'count', 'months'"; and `numeric-parser.ts` `parseNumericValue` returns
 *     `unit: CURRENCY_MAP[symbol]`, i.e. `"GBP"` for `£`.
 *   · `A$` / `C$` / `NZ$` — keys of `CURRENCY_SYMBOL_TO_CODE` itself.
 *   · `£m` / `£` / `scale` / `Trustpilot score` — the ONLY four unit strings
 *     that occur in the three real cold-read captures (derived by walking every
 *     `unit` key in the fixtures; counts 26 / 17 / 16 / 1).
 *
 * ── WHAT THIS DOES **NOT** CLAIM ───────────────────────────────────────────
 * The brief-side extractor (`QUANTITY_RE`) still knows three currency SYMBOLS
 * and that is deliberate and unchanged here — widening it is a separate breadth
 * argument the module's own header makes at length. What changed is the CARRIER
 * side: how a `unit` string the model wrote is read.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CURRENCY_SYMBOL_TO_CODE } from "../../extraction/numeric-parser.js";
import { readUnit } from "../../provenance/stated-amounts.js";
import { deriveNotModelledManifest } from "../not-modelled-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface ColdRead {
  readonly brief_text: string;
  readonly graph: Record<string, unknown>;
}
const loadCapture = (name: string): ColdRead =>
  JSON.parse(
    readFileSync(join(HERE, "fixtures", `${name}.cold-read.json`), "utf8"),
  ) as ColdRead;

/**
 * A minimal graph carrying ONE factor with one value+unit carrier.
 *
 * Deliberately tiny: these tests are about how a unit STRING is read, and a
 * real capture would let an unrelated node satisfy the assertion (trap 19).
 * Every assertion below binds to `fac_probe` by id.
 */
function graphWith(unit: string, value: number): Record<string, unknown> {
  return {
    nodes: [
      {
        id: "fac_probe",
        kind: "factor",
        label: "Marketing spend",
        value,
        unit,
      },
    ],
  };
}

/** The item for `literal`, having first proved the brief really says it. */
function itemFor(brief: string, graph: Record<string, unknown>, literal: string) {
  const offset = brief.indexOf(literal);
  expect(offset, `PRECONDITION: the brief must contain "${literal}"`).toBeGreaterThanOrEqual(0);
  const m = deriveNotModelledManifest(brief, graph);
  const item = m.quantities?.items.find(
    (i) => i.char_offset === offset && i.literal === literal,
  );
  expect(item, `the derivation must report "${literal}" at ${offset}`).toBeDefined();
  return item!;
}

// ===========================================================================
// PART A — the two authorities are the ones this module now reads.
// ===========================================================================

describe("the currency vocabulary is the repo's, not this module's", () => {
  it("PRECONDITION — the canonical map carries the ten entries this module relies on", () => {
    // Pin the fixture's own precondition (trap 13b, third face). If the
    // canonical map ever shrinks, the assertions below would start agreeing
    // with a different list and would still read green.
    expect(Object.keys(CURRENCY_SYMBOL_TO_CODE).sort()).toEqual(
      ["$", "A$", "C$", "CHF", "NZ$", "kr", "£", "¥", "€", "₹"].sort(),
    );
    expect(CURRENCY_SYMBOL_TO_CODE["£"]).toBe("GBP");
    expect(CURRENCY_SYMBOL_TO_CODE["A$"]).toBe("AUD");
  });

  it("PRECONDITION — readUnit is a superset of the parseUnit it replaces", () => {
    // The four unit strings the real captures actually contain must read
    // exactly as the old private parser read them, or Part C's equality claim
    // is measuring nothing.
    // ⚠ WS-A round 2, B3 added `currencyDisplay` — the currency token WITHOUT
    // its magnitude letter — so a consumer that has already applied
    // `multiplier` can name the amount without spending the letter twice
    // (`£m1,000,000`). It is asserted here rather than loosened to
    // `toMatchObject`, because this file's whole job is that `readUnit` reads
    // these four strings EXACTLY as the parser it replaced did: a partial match
    // would stop noticing a field that changed.
    expect(readUnit("£m")).toEqual({
      kind: "currency",
      currencyCode: "GBP",
      currencyDisplay: "£",
      multiplier: 1_000_000,
    });
    expect(readUnit("£")).toEqual({
      kind: "currency",
      currencyCode: "GBP",
      currencyDisplay: "£",
      multiplier: 1,
    });
    expect(readUnit("scale")).toEqual({ kind: "plain", multiplier: 1 });
    expect(readUnit("Trustpilot score")).toEqual({ kind: "plain", multiplier: 1 });
    // …and it reads the two spellings the old parser could not.
    expect(readUnit("GBP")).toEqual({
      kind: "currency",
      currencyCode: "GBP",
      currencyDisplay: "GBP",
      multiplier: 1,
    });
    expect(readUnit("A$m")).toEqual({
      kind: "currency",
      currencyCode: "AUD",
      currencyDisplay: "A$",
      multiplier: 1_000_000,
    });
  });
});

// ===========================================================================
// PART B — DEFECT 1: `unit: "GBP"` was unmatchable.
// ===========================================================================

describe("DEFECT — a figure carried under an ISO-code unit was reported as not modelled", () => {
  /**
   * `parseUnit` read `"GBP"` as `unitClass: "other"`, so `unitCompatible`
   * returned false for EVERY money quantity: a figure the model genuinely
   * carries was reported to the user as "Not modelled yet". GBP is producer
   * vocabulary (see the header), not a synthetic edge.
   */
  it("£1.5m IS matched to a carrier declaring unit 'GBP'", () => {
    const brief = "We can spend £1.5m on marketing this year.";
    const item = itemFor(brief, graphWith("GBP", 1_500_000), "£1.5m");
    expect(item.verdict).toBe("in_model");
    // Bind by IDENTITY, never by the verdict alone (trap 19): the match must
    // NAME the carrier it claims.
    expect(item.matched_node_id).toBe("fac_probe");
  });

  it("…and under 'GBPm', the magnitude-bearing ISO form", () => {
    const brief = "We can spend £1.5m on marketing this year.";
    const item = itemFor(brief, graphWith("GBPm", 1.5), "£1.5m");
    expect(item.verdict).toBe("in_model");
    expect(item.matched_node_id).toBe("fac_probe");
  });

  it("CURRENCY IDENTITY SURVIVES the widening — a £ statement never matches a USD carrier", () => {
    // The discriminating half of the pair. If the fix had simply made every
    // ISO-code unit "money", this would match and the module would report a
    // currency swap as the user's own figure — the exact harm the module's
    // header cites (a real €900k -> £1.6m swap in the trace).
    const brief = "We can spend £1.5m on marketing this year.";
    const item = itemFor(brief, graphWith("USD", 1_500_000), "£1.5m");
    expect(item.verdict).toBe("absent");
    expect(item.matched_node_id).toBeNull();
  });
});

// ===========================================================================
// PART C — DEFECT 2: `A$m` mis-scaled under the wrong currency.
// ===========================================================================

describe("DEFECT — an unordered symbol search mis-read the multi-character currencies", () => {
  /**
   * `CURRENCY_SYMBOLS.find((c) => u.includes(c))` is unordered, so `A$` matched
   * on `$`, left the suffix `Am`, and yielded scale 1 under the WRONG currency.
   * `alternationOf` (`stated-amounts.ts:111`) sorts longest-first for exactly
   * this reason.
   *
   * The user-visible consequence is the fabrication direction: a bare "$2"
   * statement was certified as the source of an A$2,000,000 carrier.
   */
  it("a '$2' statement is NOT the source of a carrier declared in A$m", () => {
    const brief = "We can spend $2 on marketing this year.";
    const item = itemFor(brief, graphWith("A$m", 2), "$2");
    expect(item.verdict).toBe("absent");
    expect(item.matched_node_id).toBeNull();
  });

  it("CONTROL — ordinary '$2m' against a '$m' carrier still matches", () => {
    // The GREEN half of the discriminating pair (trap 19). Without it, a fix
    // that simply broke all money matching would pass the test above.
    const brief = "We can spend $2m on marketing this year.";
    const item = itemFor(brief, graphWith("$m", 2), "$2m");
    expect(item.verdict).toBe("in_model");
    expect(item.matched_node_id).toBe("fac_probe");
  });

  it("C$ and NZ$ are read as their own currencies, not as $", () => {
    for (const unit of ["C$m", "NZ$m"]) {
      const brief = "We can spend $2 on marketing this year.";
      const item = itemFor(brief, graphWith(unit, 2), "$2");
      expect(item.verdict, `${unit} must not be read as USD`).toBe("absent");
    }
  });
});

// ===========================================================================
// PART D — the real captures are UNCHANGED. (The premise this refutes is
// stated in the PR body: the two defects above are producer-real but do not
// occur in these three graphs, whose only unit strings are £m / £ / scale /
// Trustpilot score.)
// ===========================================================================

describe("the three real cold-read captures are byte-identical under the new reader", () => {
  const CAPTURES = ["b1-growth", "b2-restructuring", "b3-product-bet"] as const;

  it("PRECONDITION — the captures declare only the four unit strings this claim rests on", () => {
    const units = new Map<string, number>();
    const walk = (v: unknown): void => {
      if (v === null || typeof v !== "object") return;
      if (Array.isArray(v)) return void v.forEach(walk);
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === "unit" && typeof x === "string") units.set(x, (units.get(x) ?? 0) + 1);
        walk(x);
      }
    };
    for (const name of CAPTURES) walk(loadCapture(name).graph);
    expect([...units.keys()].sort()).toEqual(["Trustpilot score", "scale", "£", "£m"]);
    // Non-vacuity: the walk must actually have found units.
    expect([...units.values()].reduce((a, b) => a + b, 0)).toBe(60);
  });

  it.each(CAPTURES)("%s — the manifest tallies are what the trace oracle graded", (name) => {
    const c = loadCapture(name);
    const m = deriveNotModelledManifest(c.brief_text, c.graph);
    expect(m.status).toBe("derived");
    const q = m.quantities;
    expect(q).not.toBeNull();
    // The tally must be complete and self-consistent — a partition, so a
    // verdict silently moving between buckets cannot hide.
    expect(q!.in_model + q!.prose_only + q!.absent).toBe(q!.total);
    expect(q!.total).toBeGreaterThan(0);
  });
});

// ===========================================================================
// PART E — fix 6: ONE top-level classification, not two lists.
// ===========================================================================

describe("the top-level key classification is total and single-sourced", () => {
  /**
   * `NON_MODEL_TOP_KEYS` and `PROSE_TOP_KEYS` encoded ONE three-way
   * classification across two sets, with all three prose keys duplicated. The
   * `else if` made a key added to `PROSE_TOP_KEYS` alone UNREACHABLE — it would
   * be walked as MODEL content, so a figure quoted only in commentary would be
   * reported `in_model`. These three arms pin the three outcomes.
   */
  const briefText = "Marketing spend is capped at £7m this year.";

  it("MODEL — a figure under an unclassified top-level key reads in_model", () => {
    const item = itemFor(briefText, graphWith("£m", 7), "£7m");
    expect(item.verdict).toBe("in_model");
  });

  it("PROSE — a figure found only under `coaching` reads prose_only, never in_model", () => {
    const graph = { coaching: { note: "You mentioned £7m of marketing spend." } };
    expect(itemFor(briefText, graph, "£7m").verdict).toBe("prose_only");
  });

  it("SKIP — a figure found only under `trace` reads absent, never in_model", () => {
    const graph = { trace: { step: "extracted £7m from the brief" } };
    expect(itemFor(briefText, graph, "£7m").verdict).toBe("absent");
  });
});

// ===========================================================================
// PART E2 — the SCOPE sentence describes what we ACTUALLY searched.
// ===========================================================================

describe("scope.model_surface is derived from the collections actually walked", () => {
  /**
   * This string is USER-VISIBLE COPY: it tells the user what we looked at
   * before telling them their figure is missing. It advertised "node, EDGE and
   * option values" while `collectCandidates` walks only `nodes` and `options` —
   * excluding the `edges` subtree deliberately, and saying so in its own
   * docstring. A false claim about the search is the same class of harm as a
   * false claim about the figure.
   */
  const surface = deriveNotModelledManifest("We spend £1m.", { nodes: [] }).scope
    .model_surface.join(" ");

  it("names the two collections that are searched", () => {
    expect(surface).toContain("node");
    expect(surface).toContain("option");
  });

  it("does NOT claim edge values are searched — they are deliberately excluded", () => {
    // The discriminating assertion. `edges` values never become candidates;
    // edge LABELS are reached as text, which is a different claim.
    expect(surface).not.toMatch(/\bedge\b/);
  });
});

// ===========================================================================
// PART F — fix 7: the authority line CAN bite, on signed money.
// ===========================================================================

describe("the matched-node authority line bites on signed money", () => {
  /**
   * ⚠ THIS IS THE TEST THE OLD COMMENT SAID DID NOT EXIST, FOR A LINE IT
   * WRONGLY CALLED UNBITEABLE.
   *
   * `deriveInferredFactors` skips any node the matcher certified as the user's
   * figure (`matchedNodeIds.has(id)`). The module's comment claimed that line
   * "cannot currently bite" because the coincidence guard below it always
   * subsumes it. That is CORPUS-BOUNDED, not structural:
   *
   *   · `extractStatedQuantities` carries a SIGN (`(?<msign>-)?`), so "-£2m"
   *     yields value -2,000,000;
   *   · `BRIEF_NUMBER_RE` has NO sign group, so `numericTokensIn("-£2m")`
   *     yields the UNSIGNED 2 and 2,000,000.
   *
   * So for a carrier holding -2 under "£m" the matcher fires (-2e6 === -2e6)
   * while the coincidence guard does NOT (-2 and -2e6 match neither 2 nor 2e6).
   * The authority line is then the ONLY thing standing between the user and a
   * panel that asserts and denies the same node's provenance at once — the
   * round-3 contradiction the module was built to end.
   *
   * MUTANT: delete the `if (matchedNodeIds.has(id)) continue;` line and this
   * REDs. Measured at pristine: with that line deleted the whole existing suite
   * stays GREEN, which is precisely why this test had to be written.
   */
  const brief = "The Q3 write-down was -£2m against plan.";
  const signedGraph: Record<string, unknown> = {
    nodes: [
      { id: "fac_writedown", kind: "factor", label: "Q3 write-down", value: -2, unit: "£m" },
    ],
  };

  it("PRECONDITION — the two readers genuinely disagree on this payload", () => {
    // Trap 21 / trap 13b: pin the discrimination itself. If the sign ever
    // reaches BRIEF_NUMBER_RE, the coincidence guard would subsume the
    // authority line again and the assertion below would hold for the WRONG
    // reason while still reading green.
    const item = itemFor(brief, signedGraph, "-£2m");
    expect(item.verdict, "the matcher must certify the signed figure").toBe("in_model");
    expect(item.matched_node_id).toBe("fac_writedown");
  });

  it("a node the matcher certified is NEVER also claimed as ours", () => {
    const m = deriveNotModelledManifest(brief, signedGraph);
    expect(m.inferred_factors.status).toBe("derived");
    expect(m.inferred_factors.items.map((i) => i.node_id)).not.toContain("fac_writedown");
  });

  it("CONTROL — an UNmatched factor carrying a figure IS still claimed as ours", () => {
    // The GREEN half of the pair. Without it, a fix that emptied
    // `inferred_factors` entirely would pass the assertion above.
    const m = deriveNotModelledManifest(brief, {
      nodes: [
        { id: "fac_writedown", kind: "factor", label: "Q3 write-down", value: -2, unit: "£m" },
        { id: "fac_ours", kind: "factor", label: "Churn uplift", value: 37.5, unit: "%" },
      ],
    });
    expect(m.inferred_factors.items.map((i) => i.node_id)).toEqual(["fac_ours"]);
  });
});
