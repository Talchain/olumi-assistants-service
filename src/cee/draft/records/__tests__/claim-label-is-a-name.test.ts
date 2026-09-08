/**
 * ⭐⭐ A NODE'S NAME IS NOT A SENTENCE — and the `prior` claim kind is where the
 * product learned to say otherwise.
 *
 * ── THE WITNESSED DEFECT (Paul's manual test, 6 Sep 2026) ──────────────────
 * Two canvas nodes rendered with IDENTICAL visible titles. Factor `8a8da466`
 * (`kind: factor`, `category: external`) carried
 *
 *   "Tech lead hiring typically takes 6–10 weeks; two developers may be found
 *    faster but add coordination cost"                          — 105 chars
 *
 * and the deterministic sweep minted a mediating outcome from it, labelled
 * `${factorLabel} Impact` (112 chars). The canvas clamps a title to two lines by
 * an explicit design ruling, so both nodes render the same visible string and
 * the user cannot tell them apart.
 *
 * ── THE MECHANISM, DERIVED AT THE BYTES (not the concatenation) ────────────
 * `claims[].label` answers TWO DIFFERENT QUESTIONS depending on `claim_kind`,
 * and one consumer reads both as a display name (trap 21 — one name, two
 * questions):
 *
 *   · `factor` / `risk` / `outcome` / `option_refinement` — the model supplies a
 *     NOUN PHRASE, and every one of the 41 such labels in the banked corpora is
 *     name-shaped ("Copilot Year-One Revenue", "Platform Velocity Drag").
 *   · `prior` — `instruction.ts:275` asks for *"what you believe about a
 *     quantity, and how sure you are"*, so the model supplies a BELIEF SENTENCE.
 *     `CLAIM_KIND_TO_NODE_KIND` (`projector.ts:853`) maps `prior → "factor"`, so
 *     that sentence becomes a FACTOR NODE'S DISPLAY NAME.
 *   · `causal_link` — a relationship sentence, and it mints an EDGE, never a
 *     node. Its labels run to 103 chars in the corpora and are CORRECT that way.
 *
 * A `prior` claim is, in practice, ONLY ever a factor node: `prior` appears in
 * exactly four places in `src/` (the instruction line, the grammar enum, the
 * `prior: "factor"` map entry, and one unrelated comment). Nothing reads a
 * prior's label as a belief, extracts its uncertainty, or renders it anywhere
 * but the node title. So this is not model variance — "two of twelve" is the two
 * `prior` claims in that draft.
 *
 * ── THE CORPUS IS FROM OUTSIDE THIS AUTHOR'S HEAD (trap 22) ────────────────
 * Measured over the four banked fixtures in this directory, split by whether the
 * claim kind MINTS A NODE (the spec-derived scope, trap 13d — not the symptom
 * the lane came in through):
 *
 *   kind               n    min  median  max   mints
 *   factor             33    16      26   60   factor
 *   option_refinement   8    14      39   59   option
 *   prior              15    48      65  104   factor   ← the defect class
 *   causal_link        82    36      53  103   EDGE (out of scope)
 *
 * ── WHY THE GRAMMAR IS NOT THE PLACE FOR THE BOUND ────────────────────────
 * `buildDraftClaimItemSchema` declares ONE `label` for ALL claim kinds. A
 * `maxLength` tight enough to force a name would truncate legitimate
 * `causal_link` labels (103 chars observed) AT THE DECODER — trading a bad node
 * name for silently mutilated edge copy. The per-kind rule therefore lives in
 * the INSTRUCTION, which already speaks per kind, and this guard is its backstop.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../projector.js";
import { isNameShapedLabel, CLAIM_LABEL_NAME_MAX_CHARS } from "../claim-label-shape.js";
import type { DraftRecordSet } from "../grammar.js";

/** Claim kinds that MINT A NODE — `CLAIM_KIND_TO_NODE_KIND` minus `causal_link`. */
const NODE_MINTING_KINDS = new Set(["factor", "option_refinement", "prior", "risk", "outcome"]);

/** Every claim label in the banked fixtures, harvested from the JSON itself. */
function corpusLabels(): Array<{ kind: string; label: string }> {
  const dir = join(__dirname, "fixtures");
  const out: Array<{ kind: string; label: string }> = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.claim_kind === "string" && typeof o.label === "string") {
        out.push({ kind: o.claim_kind, label: o.label });
      }
      Object.values(o).forEach(walk);
    }
  };
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    walk(JSON.parse(readFileSync(join(dir, f), "utf8")));
  }
  return out;
}

/** The label Paul witnessed, byte-for-byte (note the EN DASH in "6–10"). */
const LIVE_DEFECT_LABEL =
  "Tech lead hiring typically takes 6–10 weeks; two developers may be found faster but add coordination cost";

/**
 * A record set whose `prior` claim carries the witnessed label, connected to the
 * goal so the connectivity prune cannot withdraw it — the node must SURVIVE for
 * this to be a test about its NAME rather than about its removal.
 */
function recordsWithPriorLabel(label: string): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "ship the platform rewrite on time" },
      { kind: "option", source_quote: "hire a tech lead" },
    ],
    claims: [
      { claim_kind: "prior", label, basis: [1] },
      { claim_kind: "causal_link", label: "Hiring option sets the factor", from_stated: 1, to_claim: 0 },
      { claim_kind: "causal_link", label: "Factor drives the goal", from_claim: 0, to_stated: 0 },
    ],
  } as unknown as DraftRecordSet;
}

describe("a claim that mints a node must be NAMED, not narrated", () => {
  it("discloses a prior whose label is a belief sentence, and binds the disclosure BY NODE ID", () => {
    const projection = projectRecordsToGraph(recordsWithPriorLabel(LIVE_DEFECT_LABEL));

    // The node is on the graph — this is a naming defect, not a withdrawal.
    const node = projection.graph.nodes.find((n) => n.label === LIVE_DEFECT_LABEL);
    expect(node, "the prior's factor node must survive the prune").toBeDefined();

    // ⭐ BOUND BY IDENTITY (trap 19), never by a value predicate another
    // disclosure could satisfy: the disclosure must name THIS node's minted id.
    const disclosure = projection.dropped.find(
      (d) => d.reason === "claim_label_not_a_name" && d.node_id === node!.id,
    );
    expect(
      disclosure,
      "a node named by a sentence must be DISCLOSED, not silently shipped",
    ).toBeDefined();
  });

  it("does NOT truncate or rewrite the label — the guard discloses, it does not mutilate", () => {
    const projection = projectRecordsToGraph(recordsWithPriorLabel(LIVE_DEFECT_LABEL));
    const labels = projection.graph.nodes.map((n) => n.label);
    expect(labels).toContain(LIVE_DEFECT_LABEL);
    expect(labels.some((l) => l.includes("…"))).toBe(false);
  });
});

/**
 * ⭐⭐ THE SCOPE IS A CLAIM, SO IT IS TESTED — added after a mutant proved it was
 * not (trap 13b: ask what would have to be true for the guard to pass while the
 * property fails, then write THAT case).
 *
 * Deleting the `provenance_class === "ai_inferred"` line left the entire records
 * suite at 725/725 GREEN. Nothing anywhere asserted the scope, so a tidy-up
 * could have removed it silently — and the consequence is not cosmetic: the
 * product would start telling the user that THEIR OWN QUOTED WORDS are "not a
 * name". A stated item's label is a verbatim span of the brief by construction
 * (`instruction.ts`: "copied VERBATIM … do not paraphrase, tidy, translate or
 * summarise"), so long sentences there are CORRECT, not a defect.
 */
describe("the user's own words are never judged by a predicate written for model names", () => {
  /** A `cause` keeps its verbatim quote as its label — no objective is derived. */
  const LONG_USER_QUOTE =
    "the product has fallen behind competitors on integrations; sales keep losing deals over it and nobody owns the roadmap";

  function statedCauseRecords(): DraftRecordSet {
    return {
      stated_items: [
        { kind: "goal", source_quote: "grow ARR" },
        { kind: "option", source_quote: "rebuild the integrations layer" },
        { kind: "cause", source_quote: LONG_USER_QUOTE },
      ],
      claims: [
        { claim_kind: "causal_link", label: "Option drives the goal", from_stated: 1, to_stated: 0 },
        { claim_kind: "causal_link", label: "Cause drives the goal", from_stated: 2, to_stated: 0 },
      ],
    } as unknown as DraftRecordSet;
  }

  it("does not disclose a STATED node whose label is the user's own long sentence", () => {
    const projection = projectRecordsToGraph(statedCauseRecords());

    // ⭐ PIN THE PRECONDITION IN-TEST (trap 13b). Without this the assertion
    // below passes just as happily when the node never reached the graph, or
    // when its label was shortened — i.e. for reasons that have nothing to do
    // with the scope it claims to be testing.
    const stated = projection.graph.nodes.find((n) => n.label === LONG_USER_QUOTE);
    expect(stated, "the stated cause must be on the graph, labelled verbatim").toBeDefined();
    expect(
      isNameShapedLabel(stated!.label),
      "the precondition: this label WOULD be flagged if the scope did not hold",
    ).toBe(false);
    expect(projection.provenance[stated!.id]?.provenance_class).toBe("stated");

    expect(
      projection.dropped.filter(
        (d) => d.reason === "claim_label_not_a_name" && d.node_id === stated!.id,
      ),
      "the user's own words must never be disclosed as a bad name",
    ).toEqual([]);
  });
});

/**
 * ⭐⭐ THE CORPUS IS THE LOAD-BEARING EVIDENCE, NOT THE UNIT CASES ABOVE.
 *
 * `isNameShapedLabel` is a predicate over natural language, and trap 22 is
 * explicit that a corpus drawn from the author's head cannot see the class the
 * author did not imagine. These labels were emitted by the model on real briefs
 * and banked before this lane existed, so they are evidence about the predicate
 * rather than a restatement of it.
 */
describe("the predicate, measured against the banked live emissions", () => {
  it("collects a non-empty corpus (an empty sweep would make every claim below vacuous)", () => {
    const all = corpusLabels();
    expect(all.length).toBeGreaterThan(100);
    // CONTRAST CONTROL: the corpus must contain BOTH classes, or a clean result
    // below would only mean the sweep found one of them.
    expect(all.filter((c) => c.kind === "prior").length).toBeGreaterThan(0);
    expect(all.filter((c) => c.kind === "factor").length).toBeGreaterThan(0);
    expect(all.filter((c) => c.kind === "causal_link").length).toBeGreaterThan(0);
  });

  it("flags ZERO legitimate names — the false-positive claim this predicate rests on", () => {
    const names = corpusLabels().filter(
      (c) => c.kind === "factor" || c.kind === "option_refinement",
    );
    expect(names.length).toBe(41);
    const flagged = names.filter((c) => !isNameShapedLabel(c.label)).map((c) => c.label);
    expect(flagged, "a legitimate node name must never be flagged").toEqual([]);
  });

  it("never judges a causal_link — it mints an EDGE, and its labels are sentences by design", () => {
    const links = corpusLabels().filter((c) => c.kind === "causal_link");
    expect(links.length).toBeGreaterThan(0);
    // Stated as the SCOPE claim, not as a pass: most of these WOULD be flagged
    // if the predicate were ever pointed at them, which is exactly why the
    // projector applies it only where a node is minted.
    expect(links.some((c) => !isNameShapedLabel(c.label))).toBe(true);
    expect(NODE_MINTING_KINDS.has("causal_link")).toBe(false);
  });

  /**
   * ⭐ THE KNOWN GAP, PINNED BY NAME (trap 22f).
   *
   * The predicate catches 12 of the 15 corpus `prior` labels. These three read
   * as belief sentences to a human and are NOT caught: each is inside the length
   * bound and carries no clause punctuation. They are pinned EXACTLY so this
   * REDs if the set grows (a regression) OR shrinks (someone tightened the
   * predicate without re-measuring the false-positive claim above).
   */
  it("pins the three prior labels it does NOT catch, exactly", () => {
    const missed = corpusLabels()
      .filter((c) => c.kind === "prior" && isNameShapedLabel(c.label))
      .map((c) => c.label)
      .sort();
    expect([...new Set(missed)]).toEqual([
      "German TAM likely 50-100% of stated €400m figure",
      "NRR of 112% supports UK expansion ARR floor of ~£15.8m by FY28",
      "Rewrite duration likely 18–24 months given doubling heuristic",
    ]);
  });

  it("catches the belief sentences it claims to — 12 of the 15 banked priors", () => {
    const priors = corpusLabels().filter((c) => c.kind === "prior");
    expect(priors.length).toBe(15);
    expect(priors.filter((c) => !isNameShapedLabel(c.label)).length).toBe(12);
  });

  /**
   * The bound sits ABOVE the largest legitimate name, not AT it. A bound tuned
   * to exactly admit the corpus maximum is overfitted to the sample; this
   * asserts the headroom is real rather than incidental.
   */
  it("leaves headroom over the longest legitimate name observed", () => {
    const longest = Math.max(
      ...corpusLabels()
        .filter((c) => c.kind === "factor" || c.kind === "option_refinement")
        .map((c) => c.label.length),
    );
    expect(longest).toBe(60);
    expect(CLAIM_LABEL_NAME_MAX_CHARS).toBeGreaterThan(longest);
  });
});
