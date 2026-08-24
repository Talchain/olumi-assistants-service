/**
 * THE NOUN-FORM PATH MEASURED AT THE WIRE, OVER FOUR CORPORA.
 *
 * ⚠⚠ THE BASELINE THAT MATTERS IS ZERO, AND THE FIRST VERSION OF THIS LANE
 * REPORTED FIVE.
 * At the EXTRACTOR the false-positive count was 5 before and 5 after, so the fix
 * looked free. At the WIRE it was **0 before**, because the #888 direction gate
 * drops all five of {B3, C4, D3, F1, G1} before they reach a user. The
 * user-visible move was therefore 0 → 18 false positives, not 5 → 5. An
 * extractor-scoped number is not a product number, and this file exists so the
 * product number is the one on record.
 *
 * A spurious row is not cosmetic. `MAY_NAME_LEADING_OPTION` is `false` for three
 * of five constraint-verdict states, and a ratified row takes the turn off
 * `not_applicable` — so **a false positive silences a correct recommendation**.
 *
 * ── WHY THE ORIGINAL CORPUS COULD NOT HAVE CAUGHT THIS ────────────────────
 * The 72-case reviewer corpus contains only NINE silent cases inside this path's
 * actual input space (a currency-bearing noun form). Six screens were built on
 * nine cases, and each screen was right about the one construction that produced
 * it and blind to its concept's other realisations — trap 22 one level down.
 * The 88-case adversarial corpus is the instrument that could see it, and it was
 * blind-adjudicated against doctrine with no code and no tools.
 *
 * ── THE FOUR CORPORA, AND WHAT EACH CAN AND CANNOT SHOW ───────────────────
 *   adversarial (88)    — labelled. The WORST case. Yields FP and FN.
 *   edge (16)           — labelled. Target/qualifier resolution. FP and FN.
 *   real-transport (40) — text the product HAS ACTUALLY RECEIVED. Mostly
 *                         unlabelled, so it yields a REGRESSION COUNT, not FP/FN,
 *                         except where a case is adjudicated in-file below.
 *   real (164)          — unlabelled repo-harvested briefs. Regression count only.
 *
 * ⚠ SCOPE, NOT SOFTENED: every string in every corpus traces to Paul, an agent
 * operator, or a fixture author. THERE IS NO CORPUS OF BRIEFS TYPED BY AN
 * UNAFFILIATED END USER ANYWHERE IN THIS ESTATE. The real-transport corpus is
 * real TRANSPORT and authored LANGUAGE; it is the best available evidence and it
 * is still not a stranger's words.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runCompoundGoals } from "../../unified-pipeline/stages/repair/compound-goals.js";
import { runLateStrp } from "../../unified-pipeline/stages/repair/late-strp.js";
import { transformResponseToV3 } from "../../transforms/schema-v3.js";
import { CEEGraphResponseV3 } from "../../../schemas/cee-v3.js";

interface Case { id: string; brief: string; expect?: "fire" | "silent"; note?: string; class?: string }

function corpus(file: string): Case[] {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", file), "utf8")).cases;
}

const ADVERSARIAL = corpus("noun-form-adversarial-corpus.json");
const EDGE = corpus("noun-form-edge-corpus.json");
const REAL_TRANSPORT = corpus("noun-form-real-transport-corpus.json");
const REAL = corpus("noun-form-real-briefs.json");

/** The graph a drafted brief realistically carries for these metrics. */
function makeCtx(brief: string): any {
  return {
    requestId: "noun-form-wire-corpora",
    effectiveBrief: brief,
    graph: {
      nodes: [
        { id: "goal_outcome", kind: "goal", label: "Programme outcome" },
        { id: "fac_budget", kind: "factor", label: "Budget", data: { value: 100000 } },
        { id: "fac_cost", kind: "factor", label: "Total cost", data: { value: 100000 } },
        { id: "fac_headcount", kind: "factor", label: "Headcount", data: { value: 10 } },
        { id: "fac_margin", kind: "factor", label: "Gross margin", data: { value: 0.8 } },
        { id: "opt_a", kind: "option", label: "Option A" },
        { id: "opt_b", kind: "option", label: "Option B" },
      ],
      edges: [
        { from: "fac_budget", to: "goal_outcome" },
        { from: "fac_cost", to: "goal_outcome" },
        { from: "fac_headcount", to: "goal_outcome" },
        { from: "fac_margin", to: "goal_outcome" },
        { from: "opt_a", to: "fac_budget" },
        { from: "opt_b", to: "fac_cost" },
      ],
    },
    goalConstraints: undefined,
  };
}

/** Extractor → remap → direction gate → package → V3 transform → schema parse. */
function wireRows(brief: string): string[] {
  const ctx = makeCtx(brief);
  runCompoundGoals(ctx);
  runLateStrp(ctx);
  const wire = CEEGraphResponseV3.parse(
    transformResponseToV3({ graph: ctx.graph, goal_constraints: ctx.goalConstraints } as never, { brief }),
  );
  const gc = (wire as any).goal_constraints;
  return Array.isArray(gc) ? gc.map((r: any) => `${r.operator}${r.value}@${r.node_id}`) : [];
}

const onWire = (b: string) => wireRows(b).length > 0;

/**
 * ⭐ THE OPEN-CLASS RESIDUE — RECORDED, NOT CLOSED.
 *
 * Seven cases where a limit that is somebody else's, historical, or merely
 * wondered about still reaches the wire. Every one turns on a class that is
 * GENUINELY OPEN and cannot be enumerated:
 *
 *   third-party VERBS beyond have/has/had — "run on", "ran to", "spent against",
 *   "sets", "operates on", "imposes" — an unbounded set of English verbs that
 *   attach a limit to a subject; and INDIRECT QUESTIONS with no `?` to key on.
 *
 * Closing these needs a predicate over arbitrary English, which is the shape
 * that cost this programme four rounds of oscillation. So they are PINNED as an
 * exact set rather than chased: RED if the set grows, RED if it shrinks. A gap
 * recorded in the suite is honest; a gap invisible to it is how four rounds
 * happen.
 */
const KNOWN_WIRE_LEAKS = new Set([
  "AD-DESC-05", // "Deals in this segment typically run on a £90,000 budget."
  "AD-DESC-06", // "The previous programme ran to a £1.2m budget and delivered late."
  "AD-DESC-07", // "We spent against a £250,000 cap last quarter and came in under."
  "AD-OTH-02",  // "The regulator sets a cost ceiling: £50,000 per claim."
  "AD-OTH-04",  // "The incumbent operates on a £2m budget."
  "AD-OTH-07",  // "The parent group imposes a budget of £120,000 on every subsidiary."
  "AD-Q-03",    // "I am wondering whether a budget of £120,000 is realistic."
]);

/**
 * Stated limits that do not reach the wire. Four distinct causes, none of them
 * a defect in the screens:
 *   AD-VERB-*  — pre-existing verb-form controls whose targets this graph does
 *                not carry. Unchanged from the pristine baseline; a probe
 *                artefact, deliberately left visible rather than hidden by a
 *                graph tuned to make them pass.
 *   AD-CUR-*   — currency spelled as a WORD or SUFFIX ("50,000 GBP", "five
 *                hundred thousand pounds", "120,000 pounds", "£400k annual").
 *                The noun path requires a currency SYMBOL.
 *   AD-NON-*   — non-currency noun forms (hires, %, ms). Same requirement.
 *   AD-TP-03 / AD-WIN-05 / AD-MIX-01 — minted and bound, then withheld by the
 *                #888 direction gate on `unspent_negation`.
 *   AD-TP-08   — the first-person genitive this lane declares a known gap.
 */
const KNOWN_WIRE_MISSES = new Set([
  "AD-CUR-04", "AD-CUR-05", "AD-CUR-06", "AD-CUR-08",
  "AD-MIX-01", "AD-NON-01", "AD-NON-02", "AD-NON-03",
  "AD-TP-03", "AD-TP-08",
  "AD-VERB-01", "AD-VERB-02", "AD-VERB-03", "AD-VERB-04",
  "AD-WIN-05",
]);

describe("adversarial corpus (88) — at the wire", () => {
  it("collects the corpus (a shrunk fixture voids every number below)", () => {
    expect(ADVERSARIAL).toHaveLength(88);
    expect(ADVERSARIAL.filter((c) => c.expect === "silent")).toHaveLength(57);
    expect(ADVERSARIAL.filter((c) => c.expect === "fire")).toHaveLength(31);
  });

  it("records EXACTLY the known open-class leaks and no others", () => {
    const fps = ADVERSARIAL.filter((c) => c.expect === "silent" && onWire(c.brief)).map((c) => c.id);
    expect(new Set(fps)).toEqual(KNOWN_WIRE_LEAKS);
  });

  it("records EXACTLY the known misses and no others", () => {
    const fns = ADVERSARIAL.filter((c) => c.expect === "fire" && !onWire(c.brief)).map((c) => c.id);
    expect(new Set(fns)).toEqual(KNOWN_WIRE_MISSES);
  });

  it("scores 7 FP / 15 FN at the wire — pinned in BOTH directions", () => {
    let fp = 0, fn = 0;
    for (const c of ADVERSARIAL) {
      const fired = onWire(c.brief);
      if (fired && c.expect === "silent") fp++;
      if (!fired && c.expect === "fire") fn++;
    }
    // Was 18/15 before the three closed-class screen fixes; 0/31 at pristine.
    expect({ fp, fn }).toEqual({ fp: 7, fn: 15 });
  });
});

describe("edge corpus (16) — at the wire", () => {
  it("collects the corpus", () => {
    expect(EDGE).toHaveLength(16);
  });

  /**
   * ⚠ THE ONE TRADE THE THREE FIXES COST, REPORTED RATHER THAN PATCHED.
   *
   *   E-CONF-01  "Our budget is £50,000 and the budget of £120,000 was approved."
   *
   * One sentence asserting TWO different values for ONE target. The past-tense
   * screen is sentence-scoped, so `was` in the second clause suppresses the
   * genuine present-tense limit in the first — the same scoping question that
   * S3 needed WIDENED, now biting a different screen from the other side.
   *
   * Narrowing the past-tense screen to the clause is a FOURTH HEURISTIC on a
   * predicate that has already traded one direction for another, and this lane's
   * stop condition is explicit: when closing one opens another, report rather
   * than iterate. The loss is in the GAP direction — a limit not recorded, not a
   * limit invented — which is this file's stated safe direction. It is also a
   * sentence whose correct reading is genuinely ambiguous: recording £50,000
   * while the same sentence says £120,000 `was approved` is a coin-flip, and the
   * #888 exit for an undecidable direction is to ask, not to guess.
   */
  it("loses E-CONF-01 and nothing else — the one trade, pinned", () => {
    const fns = EDGE.filter((c) => c.expect === "fire" && !onWire(c.brief)).map((c) => c.id);
    expect(new Set(fns)).toEqual(new Set(["E-CONF-01"]));
    const fps = EDGE.filter((c) => c.expect === "silent" && onWire(c.brief)).map((c) => c.id);
    expect(fps).toEqual([]);
  });
});

describe("real-transport corpus (40) — text the product has actually received", () => {
  it("collects the corpus, including the 16 sha256-verified wire captures", () => {
    expect(REAL_TRANSPORT).toHaveLength(40);
    expect(REAL_TRANSPORT.filter((c) => c.class === "wire-capture-sha256-verified")).toHaveLength(16);
  });

  /**
   * B1 IS THE BEST SINGLE TEST CASE IN THE ESTATE because it carries BOTH
   * classes in one brief: three genuine hard constraints and five money mentions
   * that are historical, third-party, hedged or a projection.
   */
  it("B1: records both genuine constraints and NONE of the five descriptive money mentions", () => {
    const b1 = REAL_TRANSPORT.find((c) => c.id === "BRAINDUMP-B1")!;
    const rows = wireRows(b1.brief);

    // The genuine limits, bound by identity.
    expect(rows).toContain(">=0.78@fac_margin");   // "without dropping gross margin below 78%"
    expect(rows).toContain("<=1500000@fac_budget"); // "marketing spend is capped at £1.5m"

    // ⚠ THE FIVE THAT MUST NOT BECOME CONSTRAINTS. Asserted by VALUE, because
    // that is what would reach ISL and silence a recommendation.
    const values = rows.map((r) => r.replace(/^[<>]=/, "").split("@")[0]);
    for (const forbidden of [
      "400000000", // "TAM is supposedly €400m"        — third-party, hedged
      "250000",    // "legal quoted us €250k"          — a quotation
      "900000",    // "say €900k a year fully loaded"  — an estimate, hedged twice
      "15800000",  // "£15.8m by FY28"                 — a projection
      "3100000",   // "We have £3.1m cash"             — a position, not a limit
    ]) {
      expect(values, `descriptive money became a constraint: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("B3: does NOT mint the £2m the brief retracts mid-sentence", () => {
    // "the board approved £2m for strategic initiatives. Realistically it's
    // £1.2m after the security remediation eats its share, which it will."
    // Minting £2m would record a limit the author has just superseded.
    const b3 = REAL_TRANSPORT.find((c) => c.id === "BRAINDUMP-B3")!;
    expect(wireRows(b3.brief)).toEqual([]);
  });

  it("B2: the `ideally` hedged target and the descriptive money stay silent", () => {
    const b2 = REAL_TRANSPORT.find((c) => c.id === "BRAINDUMP-B2")!;
    expect(wireRows(b2.brief)).toEqual([]);
  });

  /**
   * ⚠ THIS ONE PASSES FOR A REASON UNRELATED TO THE SCREENS, AND SAYS SO.
   * The browser-witness brief spells currency AS WORDS — "8 million pounds ARR",
   * "about 6 million pounds of cash". Neither is a limit, so silence is correct;
   * but it is silent because the noun path requires a currency SYMBOL, not
   * because any screen recognised it. Recorded so a future reader does not count
   * this as evidence the screens handle word-denominated currency. They do not
   * see it at all — in EITHER direction (see AD-CUR-06).
   */
  it("browser-witness brief (word-denominated currency) stays silent — by non-recognition", () => {
    const bw = REAL_TRANSPORT.find((c) => c.id === "BROWSER-WITNESS")!;
    expect(bw.brief).toContain("million pounds");
    expect(wireRows(bw.brief)).toEqual([]);
  });

  it("exactly one real-transport brief puts a row on the wire, and it is B1", () => {
    const firing = REAL_TRANSPORT.filter((c) => onWire(c.brief)).map((c) => c.id);
    expect(firing).toEqual(["BRAINDUMP-B1"]);
  });
});

describe("real corpus (164, unlabelled) — regression count only", () => {
  it("pins exactly which real briefs put a row on the wire", () => {
    const firing = REAL.filter((c) => onWire(c.brief)).map((c) => c.id).sort();
    // 2 at pristine (verb forms); 13 now. Unlabelled, so this is a REGRESSION
    // COUNT and not an accuracy claim — it cannot yield FP or FN.
    expect(firing).toEqual([
      "REAL-003", "REAL-004", "REAL-007", "REAL-015", "REAL-021", "REAL-026",
      "REAL-125", "REAL-129", "REAL-138", "REAL-139", "REAL-144", "REAL-145",
      "REAL-146",
    ]);
  });
});
