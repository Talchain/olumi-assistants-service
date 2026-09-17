/**
 * ⭐⭐⭐ ACCEPTANCE ITEM 1, ON SERVED OUTPUT: A PERSON'S OWN OPTION MUST CARRY A
 * MAGNITUDE, OR IT IS RANKED NOWHERE.
 *
 * Paul's transcript, on every analysis after the first:
 *   "'Hire a Tech Lead' was left out of this comparison because it has no values set."
 * and, when he asked the product to configure it, it replied that a *similar*
 * option already existed — one it had invented — and asked HIM to explain the
 * difference.
 *
 * ⭐ THE DISCRIMINATING PAIR, and it is the reason this file exists rather than a
 * grep. The SAME option, from the SAME brief, one day apart:
 *
 *   served-573ebbd7 (15 Sep)  Hire a Tech Lead  from_brief  2 edges  2 magnitudes  HEALTHY
 *   served-08513e02 (16 Sep)  Hire a Tech Lead  from_brief  3 edges  0 magnitudes  ORPHANED
 *
 * ⛔⛔ WHAT THAT DOES AND DOES NOT ESTABLISH. It proves the product CAN draft this
 * option correctly, so the orphaning is not inherent to the brief — which is the
 * claim worth having, because "that brief is just hard" is the comfortable
 * reading and it is false. It does NOT establish a regression, a cause, or a
 * rate: two bundles on two dates is one draw each, and one draw per date reads
 * variance as a trend. No causal claim is made here and none should be inherited
 * from this file.
 *
 * ⚠ Note the shape of the failure, because it is the opposite of what "no values
 * set" suggests: the orphaned option has MORE factor edges than any other option
 * on that graph. The structure is right and the quantities are missing. A fix
 * that adds edges would be aimed at the wrong half.
 *
 * Held as an EXACT known-gap set, this estate's ratified way to keep a live
 * defect honest: the suite stays green for the right reason and REDs if the set
 * GROWS (a new leak) or SHRINKS (a stale note, or a fix nobody updated this for).
 *
 * Offline. Zero provider calls. Fixtures are minimal structural extracts of
 * served bundles — ids, kinds, labels, provenance, edges, option magnitudes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANKED = resolve(HERE, "fixtures/2026-09-16-served-draft-graphs");

type Served = {
  source_bundle: string;
  nodes: Array<{ id: string; kind: string; label: string; provenance?: string | null }>;
  edges: Array<{ from: string; to: string }>;
  option_interventions: Record<string, Record<string, unknown>>;
};

const GRAPHS: ReadonlyArray<Served> = readdirSync(BANKED)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(resolve(BANKED, f), "utf8")) as Served);

/**
 * ⛔ THE EXACT KNOWN GAP. Every user-stated option that is wired to factors and
 * sets a magnitude on none of them. Adding a row means a new leak; removing one
 * without editing this line means the note has gone stale.
 */
const KNOWN_OPTIONS_WIRED_BUT_UNVALUED: ReadonlyArray<string> = [
  "olumi-debug-08513e02-20260916.json :: Hire a Tech Lead",
];

/** An option the person stated, joined to factors, that sets no magnitude at all. */
function wiredButUnvalued(g: Served): string[] {
  const isFactor = new Set(g.nodes.filter((n) => n.kind === "factor").map((n) => n.id));
  return g.nodes
    .filter((n) => n.kind === "option" && n.provenance === "from_brief")
    .filter((n) => g.edges.some((e) => e.from === n.id && isFactor.has(e.to)))
    .filter((n) => Object.keys(g.option_interventions[String(n.label)] ?? {}).length === 0)
    .map((n) => `${g.source_bundle} :: ${String(n.label)}`);
}

describe("served draft graphs — a stated option carries a magnitude", () => {
  it("PRECONDITION: the corpus is non-empty and carries stated options", () => {
    // ⛔ An absence assertion over an empty corpus passes by testing nothing.
    // This estate has shipped that exact vacuity, so the guard asserts its own
    // input before asserting anything about the product.
    expect(GRAPHS.length, "banked served graphs").toBeGreaterThanOrEqual(2);
    const stated = GRAPHS.flatMap((g) =>
      g.nodes.filter((n) => n.kind === "option" && n.provenance === "from_brief"),
    );
    expect(stated.length, "user-stated options across the corpus").toBeGreaterThanOrEqual(3);
  });

  it("THE EXACT SET — REDs if it grows OR shrinks", () => {
    const found = GRAPHS.flatMap(wiredButUnvalued).sort();
    expect(
      found,
      "a stated option wired to factors that sets no magnitude is ranked nowhere",
    ).toEqual([...KNOWN_OPTIONS_WIRED_BUT_UNVALUED].sort());
  });

  it("POSITIVE CONTROL: the same option, same brief, is healthy in the 15 Sep draft", () => {
    // ⭐ This is what makes the gap a defect rather than a property of the brief.
    const healthy = GRAPHS.find((g) => g.source_bundle.includes("573ebbd7"));
    expect(healthy, "the 15 Sep served graph is banked").toBeDefined();
    const mags = Object.keys(healthy!.option_interventions["Hire a Tech Lead"] ?? {});
    expect(mags.length, "the product CAN draft this option with magnitudes").toBeGreaterThan(0);
    expect(wiredButUnvalued(healthy!), "and that whole graph is clean").toEqual([]);
  });

  it("THE SHAPE: the orphaned option is the BEST-connected option on its graph", () => {
    // Pinned because it inverts the obvious remedy. "No values set" reads like a
    // wiring problem; the option has three factor edges, more than any other.
    const broken = GRAPHS.find((g) => g.source_bundle.includes("08513e02"))!;
    const isFactor = new Set(broken.nodes.filter((n) => n.kind === "factor").map((n) => n.id));
    const edgeCount = (id: string) =>
      broken.edges.filter((e) => e.from === id && isFactor.has(e.to)).length;
    const options = broken.nodes.filter((n) => n.kind === "option");
    const orphan = options.find((n) => n.label === "Hire a Tech Lead")!;
    const others = options.filter((n) => n.id !== orphan.id);
    expect(Object.keys(broken.option_interventions["Hire a Tech Lead"] ?? {})).toEqual([]);
    expect(
      edgeCount(orphan.id),
      "more factor edges than every other option, and no magnitudes",
    ).toBeGreaterThan(Math.max(...others.map((n) => edgeCount(n.id))));
  });

  it("AND AN AI-INVENTED NEAR-DUPLICATE OF IT DOES CARRY ONE", () => {
    // The user-visible consequence: the invention competes, the person's own
    // option does not, and the product then asks the person to justify the
    // difference.
    const broken = GRAPHS.find((g) => g.source_bundle.includes("08513e02"))!;
    const dup = broken.nodes.find(
      (n) => n.kind === "option" && String(n.label).startsWith("Hire Tech Lead ("),
    );
    expect(dup?.provenance, "the near-duplicate is model-authored").toBe("ai_inferred");
    expect(
      Object.keys(broken.option_interventions[String(dup!.label)] ?? {}).length,
      "and it is ranked while the person's own option is not",
    ).toBeGreaterThan(0);
  });
});

/**
 * ⭐⭐ THE SAME SPLIT ALSO TOOK THE BASELINE — so "do nothing" left the board.
 *
 * ⛔ FIRST, THE THING THAT IS **NOT** A DEFECT, because the obvious reading is
 * wrong and would produce a harmful "fix". Almost every baseline in the corpus
 * is model-authored — "Status Quo: Keep Current Team", "Continue as-is",
 * "Hold Price at £49 (Status Quo)". That is CORRECT and wanted: a person asking
 * "should I do A or B" rarely writes down "neither", and the model supplying it
 * is the product working. A rule that refused model-authored baselines would
 * delete the most useful option on most graphs.
 *
 * ⭐ THE ACTUAL DEFECT is narrower and it is the same split this file already
 * pins. On 16 Sep the baseline is `Hire Tech Lead (Status Quo Headcount)` — a
 * near-duplicate of the person's own option, and an option that HIRES. Every one
 * of that graph's five options hires somebody. **There is no do-nothing option
 * at all**, so every ranking is measured against a fabricated hiring action and
 * the person can never see what happens if they do neither.
 *
 * The 15 Sep draft of the SAME brief gets it right — `Status Quo: Keep Current
 * Team`, a genuine do-nothing. Same discriminating pair, same root cause: the
 * model split the person's option in two, and the invention took the magnitudes
 * AND the baseline flag while the person's own option was left inert.
 *
 * ⚠ SCOPE, because the summary number is easy to misread: only 2 of 21 bundles
 * carry the `draft_graph` provenance this needs. The other 19 are UNMEASURABLE
 * for baseline authorship, not clean.
 */
describe("served draft graphs — the baseline is a real alternative", () => {
  /**
   * ⚠ MY FIRST VERSION OF THIS ASSERTED "every option hires" VIA A LABEL REGEX
   * AND IT WAS WRONG — `Two Developers` and `Engage Fractional/Contract Tech
   * Lead` carry no hiring verb, so the regex said the graph was fine. The claim
   * I wanted was SEMANTIC ("no option leaves the team as it is") and a label
   * predicate cannot carry it. Rather than widen the pattern — this estate's
   * documented way to lose four rounds — the assertion is narrowed to the
   * structural fact, which is the part that is actually checkable and is also
   * the part that matters.
   */
  const statusQuoMarked = (g: Served) =>
    g.nodes.filter((n) => n.kind === "option" && /status quo|as-is|as is|keep current/i.test(String(n.label)));

  it("16 Sep: the only status-quo-marked option is itself a hiring action", () => {
    const g = GRAPHS.find((x) => x.source_bundle.includes("08513e02"))!;
    const marked = statusQuoMarked(g).map((n) => String(n.label));
    // The reference point everything is ranked against is `Hire Tech Lead
    // (Status Quo Headcount)` — "status quo" qualifies the HEADCOUNT, not the
    // decision. It is a near-duplicate of the person's own option, and it is the
    // option that took the magnitudes while theirs was left inert.
    expect(marked, "one status-quo-marked option, and it hires").toEqual([
      "Hire Tech Lead (Status Quo Headcount)",
    ]);
    expect(marked[0].startsWith("Hire"), "the reference point is an action").toBe(true);
  });

  it("15 Sep: the SAME brief produced a genuine do-nothing — not inherent to the brief", () => {
    const g = GRAPHS.find((x) => x.source_bundle.includes("573ebbd7"))!;
    expect(
      statusQuoMarked(g).map((n) => String(n.label)),
      "model-authored and exactly right — this is the product working",
    ).toContain("Status Quo: Keep Current Team");
  });

  it("and that 15 Sep baseline is model-authored, which is CORRECT", () => {
    // ⛔ Pinned so nobody reads this block as "model-authored baselines are bad".
    // A person asking "should I do A or B" rarely writes down "neither"; the
    // model supplying it is the product working. A rule refusing model-authored
    // baselines would delete the most useful option on most graphs.
    const g = GRAPHS.find((x) => x.source_bundle.includes("573ebbd7"))!;
    const sq = g.nodes.find((n) => String(n.label) === "Status Quo: Keep Current Team");
    expect(sq?.provenance).toBe("ai_inferred");
  });
});
