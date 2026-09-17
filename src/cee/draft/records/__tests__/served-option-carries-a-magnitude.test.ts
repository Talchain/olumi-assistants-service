/**
 * ⭐⭐⭐ TWO DEFECTS ON ONE SERVED GRAPH: A PERSON'S OWN OPTION IS RANKED NOWHERE,
 * AND THE WARNING THAT WOULD HAVE SURFACED IT IS SUPPRESSED BY A LABEL.
 *
 * Paul's transcript, on every analysis after the first:
 *   "'Hire a Tech Lead' was left out of this comparison because it has no values set."
 * and, when he asked the product to configure it, it replied that a *similar*
 * option already existed — one it had invented — and asked HIM to explain the
 * difference.
 *
 * ⭐ THE DISCRIMINATING PAIR. The same option, same brief, one day apart:
 *   served-573ebbd7 (15 Sep)  Hire a Tech Lead  from_brief  2 edges  2 magnitudes
 *   served-08513e02 (16 Sep)  Hire a Tech Lead  from_brief  3 edges  0 magnitudes
 * That proves the product CAN draft it correctly, so the orphaning is not
 * inherent to the brief — "that brief is just hard" is the comfortable reading
 * and it is false.
 *
 * ⛔ IT ESTABLISHES NOTHING ABOUT CAUSE OR RATE. Two bundles on two dates is ONE
 * DRAW EACH, and one draw per date reads variance as a trend. No causal claim is
 * made here and none should be inherited from this file.
 *
 * ⛔⛔ AND MY FIRST VERSION OF THIS FILE OVERCLAIMED, in the exact way independent
 * review predicted. I wrote that the AI-invented near-duplicate "took the
 * baseline flag". My fixture had DROPPED `is_baseline` while banking
 * `provenance` and `display_value` from the same node object, so "status-quo
 * marked" meant only "the label matches a regex". Review named three states the
 * fixture could not separate and the truth is the one that is WORSE than my
 * story:
 *
 *     16 Sep  Hire Tech Lead (Status Quo Headcount)  is_baseline ABSENT
 *             Two Developers                         is_baseline false
 *             Hire a Tech Lead                       is_baseline false
 *     15 Sep  Status Quo: Keep Current Team          is_baseline TRUE
 *
 * **The 16 Sep draft graph declares NO baseline at all.** Nothing took the flag;
 * the flag was never set. `analysis_ready` later reports the label-matching
 * option as the baseline, and `analysable-option-gate` reads `is_baseline ===
 * true` strictly — so a MISSING verdict EXCLUDES rather than holds.
 * ⭐ An honest measurement (labels) became a structural claim (the ranking's
 * reference point) in the act of my recording it. The measurement was fine.
 *
 * Offline. Zero provider calls. Fixtures are minimal structural extracts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ⭐ PRODUCT IMPORTS, and they are the point. An earlier version of this file
// imported nothing but vitest and node builtins, so every assertion bound to
// the FIXTURE and a product change could not RED it — it pinned the evidence
// while its own docblock claimed to pin the behaviour.
import { detectMissingBaseline } from "../../../structure/index.js";
import { matchesStatusQuoLabel } from "../../../structure/status-quo-patterns.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANKED = resolve(HERE, "fixtures/2026-09-16-served-draft-graphs");

type ServedNode = {
  id: string;
  kind: string;
  label: string;
  provenance?: string | null;
  is_baseline?: boolean | null;
  data_is_status_quo?: boolean | null;
  analysis_ready_is_baseline?: boolean | null;
};
type Served = {
  source_bundle: string;
  nodes: ServedNode[];
  edges: Array<{ from: string; to: string }>;
  /** ⚠ Keyed by option_id, which is what the contract keys by (`cee-v3.ts:552`).
   *  An earlier version keyed by LABEL, so two colliding labels would have
   *  merged silently and the keys were authored re-keys rather than captured
   *  bytes. */
  option_interventions_by_id: Record<string, Record<string, unknown>>;
};

const GRAPHS: ReadonlyArray<Served> = readdirSync(BANKED)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(resolve(BANKED, f), "utf8")) as Served);

const at = (fragment: string): Served => {
  const g = GRAPHS.find((x) => x.source_bundle.includes(fragment));
  if (!g) throw new Error(`fixture ${fragment} is not banked`);
  return g;
};

/** A stated option, joined to factors, that sets no magnitude at all. */
function wiredButUnvalued(g: Served): string[] {
  const isFactor = new Set(g.nodes.filter((n) => n.kind === "factor").map((n) => n.id));
  return g.nodes
    .filter((n) => n.kind === "option" && n.provenance === "from_brief")
    .filter((n) => g.edges.some((e) => e.from === n.id && isFactor.has(e.to)))
    .filter((n) => Object.keys(g.option_interventions_by_id[n.id] ?? {}).length === 0)
    .map((n) => `${g.source_bundle} :: ${String(n.label)}`);
}

/** The fixture shaped as the product's own detector expects. */
function asGraphV1(g: Served) {
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      ...(n.data_is_status_quo === null || n.data_is_status_quo === undefined
        ? {}
        : { data: { is_status_quo: n.data_is_status_quo } }),
    })),
    edges: g.edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to })),
  };
}

const KNOWN_OPTIONS_WIRED_BUT_UNVALUED: ReadonlyArray<string> = [
  "olumi-debug-08513e02-20260916.json :: Hire a Tech Lead",
];

describe("a stated option carries a magnitude", () => {
  it("PRECONDITION: the corpus is non-empty and carries stated options", () => {
    // An absence assertion over an empty corpus passes by testing nothing.
    expect(GRAPHS.length, "banked served graphs").toBeGreaterThanOrEqual(2);
    const stated = GRAPHS.flatMap((g) =>
      g.nodes.filter((n) => n.kind === "option" && n.provenance === "from_brief"),
    );
    expect(stated.length, "user-stated options across the corpus").toBeGreaterThanOrEqual(3);
  });

  it("THE EXACT SET — REDs if it grows OR shrinks", () => {
    expect(
      GRAPHS.flatMap(wiredButUnvalued).sort(),
      "a stated option wired to factors that sets no magnitude is ranked nowhere",
    ).toEqual([...KNOWN_OPTIONS_WIRED_BUT_UNVALUED].sort());
  });

  it("POSITIVE CONTROL: the same option, same brief, is healthy in the 15 Sep draft", () => {
    const healthy = at("573ebbd7");
    const own = healthy.nodes.find((n) => n.label === "Hire a Tech Lead")!;
    expect(
      Object.keys(healthy.option_interventions_by_id[own.id] ?? {}).length,
      "the product CAN draft this option with magnitudes",
    ).toBeGreaterThan(0);
    expect(wiredButUnvalued(healthy), "and that whole graph is clean").toEqual([]);
  });

  it("THE SHAPE: the orphaned option is the BEST-connected option on its graph", () => {
    // Pinned because it inverts the obvious remedy. "No values set" reads like a
    // wiring problem; the option has three factor edges, more than any other.
    const g = at("08513e02");
    const isFactor = new Set(g.nodes.filter((n) => n.kind === "factor").map((n) => n.id));
    const edgeCount = (id: string) => g.edges.filter((e) => e.from === id && isFactor.has(e.to)).length;
    const options = g.nodes.filter((n) => n.kind === "option");
    const orphan = options.find((n) => n.label === "Hire a Tech Lead")!;
    expect(Object.keys(g.option_interventions_by_id[orphan.id] ?? {})).toEqual([]);
    expect(
      edgeCount(orphan.id),
      "more factor edges than every other option, and no magnitudes",
    ).toBeGreaterThan(Math.max(...options.filter((n) => n.id !== orphan.id).map((n) => edgeCount(n.id))));
  });

  it("AND AN AI-INVENTED NEAR-DUPLICATE OF IT DOES CARRY ONE", () => {
    const g = at("08513e02");
    const dup = g.nodes.find((n) => n.kind === "option" && String(n.label).startsWith("Hire Tech Lead ("))!;
    expect(dup.provenance, "the near-duplicate is model-authored").toBe("ai_inferred");
    expect(
      Object.keys(g.option_interventions_by_id[dup.id] ?? {}).length,
      "and it is ranked while the person's own option is not",
    ).toBeGreaterThan(0);
  });
});

/**
 * ⭐⭐⭐ THE USER-FACING HALF, and it runs PRODUCT CODE rather than reading the
 * fixture back to itself.
 *
 * `detectMissingBaseline` (`structure/index.ts:1663`) decides `hasBaseline` from
 * `data.is_status_quo === true`, and failing that from `matchesStatusQuoLabel`.
 * **It never reads `is_baseline`** — which is the field `analysable-option-gate`
 * reads strictly (`=== true`, so absent EXCLUDES).
 *
 * ⇒ On the 16 Sep graph the label `Hire Tech Lead (Status Quo Headcount)`
 * satisfies the detector, so **no `missing_baseline` warning is raised — on a
 * graph where every option hires and no option declares the baseline flag at
 * all.** The label-shaped invention suppresses the one warning that would have
 * surfaced the gap to the person.
 *
 * Two different questions under one name (trap 21): *"does any label look like a
 * status quo?"* and *"is a baseline declared?"*. Reconciling their answers is the
 * wrong move; naming them apart and deciding which the warning consumes is the
 * right one — and that is a decision with an owner, not a patch for this file.
 */
describe("the missing-baseline warning, on the product's own detector", () => {
  it("⛔ 16 Sep: NO warning, on a graph where no option declares a baseline", () => {
    const g = at("08513e02");
    const result = detectMissingBaseline(asGraphV1(g) as never);
    const declared = g.nodes.filter((n) => n.kind === "option" && n.is_baseline === true);
    expect(declared, "not one option carries is_baseline === true").toEqual([]);
    expect(result.hasBaseline, "yet the detector is satisfied").toBe(true);
    expect(result.detected, "so the warning is never raised").toBe(false);
  });

  it("⭐ and it is satisfied by the LABEL alone — the discriminator", () => {
    // Binds the cause, not just the outcome: remove the label match and the
    // detector flips, which is what makes this a statement about the predicate.
    const g = at("08513e02");
    const marked = g.nodes.filter((n) => n.kind === "option" && matchesStatusQuoLabel(String(n.label)));
    expect(marked.map((n) => String(n.label)), "one option, and it hires").toEqual([
      "Hire Tech Lead (Status Quo Headcount)",
    ]);
    const withoutTheLabel = asGraphV1(g) as { nodes: Array<{ label: string }> };
    withoutTheLabel.nodes = withoutTheLabel.nodes.map((n) =>
      n.label === "Hire Tech Lead (Status Quo Headcount)" ? { ...n, label: "Hire Tech Lead (Same Headcount)" } : n,
    );
    const flipped = detectMissingBaseline(withoutTheLabel as never);
    expect(flipped.hasBaseline, "rename it and the detector is no longer satisfied").toBe(false);
    expect(flipped.detected, "and the warning the person should have seen appears").toBe(true);
  });

  it("15 Sep: the same brief DID declare a baseline, and the detector agrees", () => {
    const g = at("573ebbd7");
    const declared = g.nodes.filter((n) => n.kind === "option" && n.is_baseline === true);
    expect(declared.map((n) => String(n.label)), "explicitly flagged, not inferred").toEqual([
      "Status Quo: Keep Current Team",
    ]);
    expect(detectMissingBaseline(asGraphV1(g) as never).hasBaseline).toBe(true);
  });

  it("⛔ a model-authored baseline is CORRECT — pinned so nobody 'fixes' it", () => {
    // A person asking "should I do A or B" rarely writes down "neither", so the
    // model supplying it is the product working. A rule refusing model-authored
    // baselines would delete the most useful option on most graphs.
    const g = at("573ebbd7");
    const sq = g.nodes.find((n) => String(n.label) === "Status Quo: Keep Current Team")!;
    expect(sq.provenance).toBe("ai_inferred");
    expect(sq.is_baseline).toBe(true);
  });
});
