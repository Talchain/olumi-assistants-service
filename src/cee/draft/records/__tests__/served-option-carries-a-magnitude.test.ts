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
 * ⛔⛔ THE BASELINE CLAIM HAS NOW BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS, AND
 * THE REASON IS THAT `is_baseline` HAS THREE CARRIERS THAT DO NOT AGREE.
 *
 *   v1  "the AI-invented near-duplicate TOOK the baseline flag."
 *       Refuted: my fixture had DROPPED `is_baseline` while banking `provenance`
 *       from the same node object, so "status-quo marked" meant only "the label
 *       matches a regex".
 *   v2  "the 16 Sep graph declares NO baseline at all."
 *       Also wrong — as a general statement. True of the carriers I measured,
 *       false of the one a peer measured, in a different bundle of the same
 *       session.
 *
 * ⭐ MEASURED ACROSS ALL THREE CARRIERS, which is what finally settled it:
 *
 *   bundle      option                                  node   OptionV3  analysis_ready
 *   08513e02    Hire Tech Lead (Status Quo Headcount)    -      -         TRUE
 *   (16 Sep)    Hire a Tech Lead / Two Developers        false  false     -
 *   1994c9c1    Hire Tech Lead (Status Quo Headcount)    -      TRUE      TRUE
 *   (16 Sep)    every other option                       -      false     false
 *   573ebbd7    Status Quo: Keep Current Team            TRUE   TRUE      TRUE
 *   (15 Sep)    every other option                       false  false     -
 *
 * ⇒ In `08513e02` NEITHER declared carrier sets a baseline and `analysis_ready`
 *   reports one anyway — so it is INFERRED, not declared, and it picks the
 *   AI-invented hiring option.
 * ⇒ In `1994c9c1` the node carrier is absent while `OptionV3` is TRUE — the two
 *   DECLARED carriers disagree on one graph.
 * ⇒ `analysable-option-gate` reads `input.options` and its `optionIdOf` prefers
 *   `option_id` over `id`, so it is reading the OptionV3-shaped carrier, not the
 *   node.
 *
 * ⛔ SO NO SENTENCE ABOUT "THE BASELINE" IS TRUE WITHOUT NAMING ITS CARRIER AND
 * ITS BUNDLE, and this file now names both everywhere. Three carriers for one
 * concept is trap 21 on a single field; reconciling their VALUES is the wrong
 * move, and naming them apart is the right one.
 *
 * ⭐⭐ AND THE FINDING THAT SURVIVES ALL OF IT, which is the one that matters to
 * the person: in BOTH 16 Sep bundles the baseline — however it is carried — is
 * `Hire Tech Lead (Status Quo Headcount)`, **a hiring action**. On a brief whose
 * entire question is WHETHER to hire, the reference point every option is ranked
 * against is itself a hire, and "do neither" is never on the board. That holds
 * under every carrier and both bundles, and it does not depend on which of us
 * was right about the flag.
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
  it("⛔ 16 Sep (08513e02): no warning, and no DECLARED baseline on the node carrier", () => {
    // ⚠ CARRIER NAMED DELIBERATELY. This asserts the NODE carrier only. A
    // different bundle of the same session (`1994c9c1`) carries TRUE on the
    // OptionV3 carrier, and `analysis_ready` reports TRUE even here — so
    // "declares no baseline" is only true of the carrier it names.
    const g = at("08513e02");
    const declaredOnNode = g.nodes.filter((n) => n.kind === "option" && n.is_baseline === true);
    expect(declaredOnNode, "node carrier: nothing declares a baseline").toEqual([]);
    const result = detectMissingBaseline(asGraphV1(g) as never);
    expect(result.hasBaseline, "yet the detector is satisfied").toBe(true);
    expect(result.detected, "so the warning is never raised").toBe(false);
  });

  it("⭐ and `analysis_ready` reports a baseline the declared carriers never set", () => {
    // The inference, isolated. This is the substantive finding of the whole
    // block: where nothing declares a baseline, something downstream supplies
    // one — and it supplies the AI-invented hiring option.
    const g = at("08513e02");
    const inferred = g.nodes.filter(
      (n) => n.kind === "option" && n.analysis_ready_is_baseline === true,
    );
    expect(inferred.map((n) => String(n.label)), "inferred, not declared").toEqual([
      "Hire Tech Lead (Status Quo Headcount)",
    ]);
    expect(inferred[0]?.is_baseline ?? null, "and the node carrier is silent").not.toBe(true);
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

  it("15 Sep: the same brief declared one on EVERY carrier, and the detector agrees", () => {
    // The contrast that makes the 16 Sep state legible: here all three carriers
    // say TRUE on a genuine do-nothing. Consistency is achievable; 16 Sep is not
    // the normal case.
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
