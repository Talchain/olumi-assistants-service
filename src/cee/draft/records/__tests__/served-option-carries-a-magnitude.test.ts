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
