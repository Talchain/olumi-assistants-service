/**
 * ⭐⭐ ROOT CAUSE OF THE 28 Aug EGRESS P0 — A NODE LABEL LONGER THAN THE
 * PUBLISHED CONTRACT ALLOWS, MINTED BY CEE ITSELF.
 *
 * ── WHAT #1178 FIXED, AND WHAT IT LEFT OPEN ────────────────────────────────
 * #1178 stopped a receipt-confined validation failure from DELETING THE USER'S
 * ENTIRE ASSISTANT REPLY ("The server produced a response that failed
 * validation."). That is the symptom. The CAUSE is that CEE copies a brief
 * sentence VERBATIM into a node's `label` with no bound anywhere upstream,
 * while the published `NodeV3Schema.label` is `z.string().min(1).max(200)`
 * (`@talchain/schemas` 0.50.0 `dist/graph.js:259`). Until the producer stops
 * minting them, every detailed brief silently loses its model-version receipt.
 *
 * ── ⚠ THE CORPUS IS EXTERNAL, AND IT OVERTURNED THE DIAGNOSIS (trap 22) ────
 * The P0 report observed `label === source_quote` on a GOAL node in 4/4
 * captures, and the obvious fix is a goal-only bound. Measured instead on the
 * FROZEN GOVERNED BASELINE — 14 real staging captures at `b9389df`, 238 nodes,
 * already in-tree and written by nobody on this lane:
 *
 *   labels > 200 chars   1   — and it is an **option**, not a goal (205 chars)
 *   labels > 150 chars   3   — option 205, goal 178, goal 159
 *   per-kind maxima      option 205 · goal 178 · factor 138 · outcome 50 ·
 *                        risk 48 · decision 8
 *
 * `projector.ts:2172` authors labels for `kind === "goal"` ONLY; `option`,
 * `constraint` and `figure` take `{ label: quote }` unconditionally. So a
 * goal-only bound would have missed the corpus's ONLY actual violation. The
 * four captures were a sample, not a scope — the corpus is what says so.
 *
 * ── ⚠ WHY THE BOUND IS APPLIED AT `projectRecordsToGraph`'s RETURN, NOT AT
 * THE MINT SITES. There are THREE node-mint sites (stated `:2185`, claim
 * `:2593`, decision `:3264`), so a per-site fix is a hand-maintained list
 * (trap 12) — and one of them is load-bearing in the other direction: a CLAIM
 * node's id is `sha8(claim_kind, label)` (`:2575`). Bounding BEFORE that id is
 * minted would make two claims differing only after character 199 collide into
 * a single node — trading a dropped receipt for a silently deleted node.
 * Bounding after every id is minted is id-preserving by construction, and that
 * is asserted below rather than argued.
 *
 * ── WHAT IS CONSERVED. Nothing of the user's is lost: the verbatim rides on
 * `provenance.source_quote` → `NodeV3.source_quote` (`cee-v3.ts:276`,
 * deliberately unbounded), which is the field the inspector/hover renders, and
 * `label_authored` is set so the product says out loud that the display string
 * is ours. That is quality bar §8 A2, already ratified for this exact module.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeV3Schema, GraphV3Schema } from "@talchain/schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";
import {
  boundNodeLabel,
  readStringBound,
  NODE_LABEL_MAX_CHARS,
  NODE_LABEL_MIN_CHARS,
} from "../label-bound.js";
import { enforceSingleGoal } from "../../../structure/index.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const GOVERNED = path.join(
  REPO_ROOT,
  "tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json",
);

interface CorpusNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly provenance?: { readonly source_quote?: string };
}
interface CorpusCase {
  readonly brief_id: string;
  readonly graph?: { readonly nodes?: readonly CorpusNode[] };
}

function corpusCases(): readonly CorpusCase[] {
  const run = JSON.parse(fs.readFileSync(GOVERNED, "utf8")) as {
    run: { cases: readonly CorpusCase[] };
  };
  return run.run.cases;
}

const corpusNodes = (): readonly CorpusNode[] =>
  corpusCases().flatMap((c) => c.graph?.nodes ?? []);

/**
 * THE REAL 205-CHARACTER OPTION QUOTE, read out of the governed corpus rather
 * than written here — `11-feedback-loop-trap`, node `009b519e`,
 * `provenance_class: stated`, `brief_binding: verified`, `label === source_quote`.
 *
 * A fixture a lane writes for itself is not evidence about the wire (trap 16).
 * This one is a real staging capture; if it ever stops being over-long the
 * instrument check below goes RED rather than quietly testing nothing.
 */
function governedOverlongQuote(): string {
  const node = corpusNodes().find((n) => n.label.length > NODE_LABEL_MAX_CHARS);
  if (!node) throw new Error("corpus carries no over-long label — instrument is blind");
  return node.provenance?.source_quote ?? node.label;
}

/**
 * ⭐⭐ THE OVER-LONG OPTION'S REAL SIBLING — the OTHER course of action the same
 * user stated in the same brief (`11-feedback-loop-trap`, node `5845e0cb`, 92
 * chars), read out of the governed corpus rather than written here.
 *
 * ── WHY THIS EXISTS: THE 31 Aug STAGING RED, AND THE FIX THAT WOULD HAVE BEEN
 * WORSE THAN THE RED ────────────────────────────────────────────────────────
 * The badge test below is a PAIR, and the pair is the whole instrument: a
 * SHORTENED option must earn `label_authored`, and an ORDINARY one must not.
 * Its ordinary arm used to be the hand-written `"cut prices"`.
 *
 * #1180 (this spec) and #1206 (`101219c6`, "an option is a course of action")
 * were each green alone and red together, with no textual conflict: #1206 added
 * `deriveOptionActionLabel` at the display boundary (`schema-v3.ts:1337-1345`),
 * which authors a label for any option quote it can name as a course of action.
 * `"cut prices"` is exactly that — two tokens, no deliberation frame, no clause
 * to discard — so it became `"Cut Prices"` with `label_authored: true`, and the
 * ordinary arm's `toBeUndefined()` stopped holding.
 *
 * ⚠ THE ASSERTION IS NOT WHAT WAS WRONG. Flipping `toBeUndefined()` to
 * `toBe(true)` turns the suite green and DESTROYS the discrimination: under
 * #1206 both arms are authored, so a flipped assertion would assert nothing
 * whatever about the bound — the one property this spec exists to protect. The
 * FIXTURE is what had to catch up.
 *
 * ── WHY THIS QUOTE ─────────────────────────────────────────────────────────
 * It is not a tidier invention; it is the real staging sibling of the real
 * over-long option, so the pair is now two alternatives a real user actually
 * stated in one brief (trap 16 — a fixture a lane writes for itself is not
 * evidence about the wire). It is 92 chars, so THE BOUND LEAVES IT ALONE, and
 * `deriveOptionActionLabel` REFUSES it (`clause_discarded`: the trailing "who
 * hand-pick supplier recommendations" would be thrown away). Nothing authors
 * it, so it reaches the wire as the user's own verbatim.
 *
 * ── HOW THE REFUSAL IS PINNED, AND WHY NOT BY ITS `reason` ─────────────────
 * At the WIRE (`label === the quote` in the test below), not by re-calling
 * `deriveOptionActionLabel` here. The two are not the same assertion and the
 * wire one is STRICTLY BROADER: re-calling the producer proves only what this
 * file believes about that function, while the wire pin proves that NOTHING in
 * the whole chain — the bound, this deriver, `structure/index.ts`, the v3
 * transform — authored that label. A `reason === "clause_discarded"` pin would
 * pass just as happily while some other hop had authored it.
 *
 * And this arm does not depend on WHICH refusal it gets: it needs an option
 * nothing authored, so a quote that began refusing for a different structural
 * reason would still be doing its job here, while a `reason` pin would red on a
 * change that cannot affect this spec's property. Which quotes refuse, and for
 * which reason, is pinned once in `option-action-labels.test.ts` — restating it
 * here would be two answers to one question (trap 21).
 *
 * ── THE ALTERNATIVES CONSIDERED, SO A REVIEWER NEED NOT RE-DERIVE THEM ──────
 * · `"Should we hire a sales lead?"` (#1206's witnessed `asks_a_question`
 *   refusal). Real, and already pinned there — but it is NOT IN THIS CORPUS
 *   (measured: 0 occurrences in the frozen baseline, against 2 for the quote
 *   above), so it would have to be hand-written into a file whose whole
 *   discipline is reading its fixtures out of the governed capture. It is also
 *   a QUESTION — a specimen of the misclassification #1206's instruction half
 *   exists to stop — which reads oddly as the "ordinary option" arm of an
 *   over-correction control, and dates the fixture to a defect we intend to
 *   remove.
 * · The `"hire a sales lead?"` / `"hire a sales lead"` minimal pair. A genuinely
 *   elegant discriminator — for the DERIVER'S REFUSAL PREDICATE, which is
 *   #1206's property and is already pinned by it. This spec's question is
 *   whether THE BOUND stamps authorship on what it shortened and only on that;
 *   the refusal is a means here, not the subject.
 */
function governedOrdinaryOptionQuote(): string {
  const withOverlong = corpusCases().find((c) =>
    (c.graph?.nodes ?? []).some((n) => n.label.length > NODE_LABEL_MAX_CHARS),
  );
  if (!withOverlong) throw new Error("corpus carries no over-long label — instrument is blind");
  const siblings = (withOverlong.graph?.nodes ?? [])
    .filter((n) => n.kind === "option")
    .map((n) => n.provenance?.source_quote ?? "")
    .filter((q) => q.length > 0 && q.length <= NODE_LABEL_MAX_CHARS);
  // Derived, not mirrored (trap 12) — and it fails loud in BOTH directions: a
  // zero means the corpus no longer carries the pair this test is built on, and
  // a two means the choice has become ambiguous and a reader must make it.
  if (siblings.length !== 1) {
    throw new Error(
      `expected exactly one within-bound option sibling of the over-long one, found ${siblings.length}`,
    );
  }
  return siblings[0]!;
}

/** The whole live chain, exactly as `structure/index.ts:392` documents it. */
function driveTheRealChain(records: DraftRecordSet, brief: string) {
  const projection = projectRecordsToGraph(records, brief);
  const merged = enforceSingleGoal({
    nodes: projection.graph.nodes,
    edges: projection.graph.edges,
  } as never);
  const afterStructure = (merged?.graph as { nodes: unknown[]; edges: unknown[] }) ?? {
    nodes: projection.graph.nodes,
    edges: projection.graph.edges,
  };
  const v3 = projectGraphAndOptionsToV3(afterStructure as never, { brief });
  return { projection, v3 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. THE INSTRUMENTS, BEFORE ANYTHING IS CONCLUDED FROM THEM (trap 13).
// ─────────────────────────────────────────────────────────────────────────────
describe("the instruments this suite reasons with can see what they claim to", () => {
  it("derives the bound FROM THE PUBLISHED CONTRACT, and the published contract still declares one", () => {
    // The number is never restated here either: it is read from the same schema
    // the egress boundary validates against, so this assertion cannot drift
    // from the gate it describes.
    const checks = (NodeV3Schema.shape.label as { _def: { checks: readonly { kind: string; value?: number }[] } })
      ._def.checks;
    expect(checks.find((c) => c.kind === "max")?.value).toBe(NODE_LABEL_MAX_CHARS);
    expect(checks.find((c) => c.kind === "min")?.value).toBe(NODE_LABEL_MIN_CHARS);
    // A positive control on the derivation itself: the bound must be a real
    // finite limit, not `undefined` coerced into agreement with itself.
    expect(Number.isFinite(NODE_LABEL_MAX_CHARS)).toBe(true);
    expect(NODE_LABEL_MAX_CHARS).toBeGreaterThan(NODE_LABEL_MIN_CHARS);
  });

  /**
   * ⭐⭐ THE DERIVATION IS FALSIFIABLE, NOT MERELY SELF-CONSISTENT (trap 12d).
   *
   * A guard derived from a list proves the copies AGREE and can never prove the
   * list is RIGHT. `expect(NODE_LABEL_MAX_CHARS).toBe(200)` would be satisfied
   * just as happily by a hardcoded `200` — the exact mirror this module exists
   * to remove, passing the test written to prevent it. So the READER is aimed
   * at a synthetic schema whose bounds are deliberately NOT the contract's: a
   * constant cannot pass this, only a real read can.
   */
  it("READS the bound rather than agreeing with a remembered number", () => {
    const synthetic = z.string().min(7).max(37);
    expect(readStringBound(synthetic, "max")).toBe(37);
    expect(readStringBound(synthetic, "min")).toBe(7);
    // …and the synthetic bounds are genuinely different from the contract's,
    // so a constant could not have produced both answers.
    expect(37).not.toBe(NODE_LABEL_MAX_CHARS);
    expect(7).not.toBe(NODE_LABEL_MIN_CHARS);
  });

  it("FAILS LOUD when a schema declares no such check, rather than defaulting", () => {
    // A default here would silently restore the unbounded behaviour that
    // deleted a user's reply, under a fully green suite.
    expect(() => readStringBound(z.string(), "max")).toThrow(/declares no 'max' check/);
  });

  it("the governed corpus carries exactly one over-long label, and it is an OPTION not a goal", () => {
    const nodes = corpusNodes();
    // Contrast control: the corpus is populous, so a zero here would be
    // blindness rather than absence.
    expect(nodes.length).toBe(238);
    const overlong = nodes.filter((n) => n.label.length > NODE_LABEL_MAX_CHARS);
    expect(overlong).toHaveLength(1);
    expect(overlong[0]!.kind).toBe("option");
    expect(overlong[0]!.label.length).toBe(205);
    // …and it is the verbatim, which is what makes it the P0's shape exactly.
    expect(overlong[0]!.provenance?.source_quote).toBe(overlong[0]!.label);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE LEAD RED — a real over-long brief sentence must produce a graph the
//    PUBLISHED contract accepts, through the whole live chain.
// ─────────────────────────────────────────────────────────────────────────────
describe("an over-long brief sentence still produces a contract-valid graph", () => {
  const brief =
    "We run a two-sided marketplace and growth has stalled. " +
    `We could ${governedOverlongQuote()}. ` +
    "Alternatively we could cut prices.";

  const records = (): DraftRecordSet => ({
    stated_items: [
      { kind: "goal", source_quote: "grow marketplace liquidity" },
      { kind: "option", source_quote: governedOverlongQuote() },
      { kind: "option", source_quote: "cut prices" },
    ],
    claims: [
      { claim_kind: "factor", label: "Match Quality", basis: [1] },
      {
        claim_kind: "causal_link",
        label: "matching moves match quality",
        from_stated: 1,
        to_claim: 0,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "match quality reaches the goal",
        from_claim: 0,
        to_stated: 0,
        effect: "positive",
      },
    ],
  });

  it("EVERY node the projector mints satisfies the PUBLISHED NodeV3Schema", () => {
    const { projection } = driveTheRealChain(records(), brief);
    // Bound by IDENTITY to the published validator — not to a length predicate
    // restated here, which could agree with a wrong number (trap 19).
    for (const node of projection.graph.nodes) {
      const verdict = NodeV3Schema.safeParse(node);
      expect(
        verdict.success,
        `node ${node.id} (${node.kind}) rejected: ${
          verdict.success ? "" : JSON.stringify(verdict.error.issues)
        }`,
      ).toBe(true);
    }
  });

  it("and the graph that reaches the wire passes the PUBLISHED GraphV3Schema", () => {
    const { v3 } = driveTheRealChain(records(), brief);
    const verdict = GraphV3Schema.safeParse(v3.graph);
    expect(
      verdict.success,
      verdict.success ? "" : JSON.stringify(verdict.error.issues),
    ).toBe(true);
  });

  it("the user's exact words survive in full on `source_quote`, which is what makes shortening honest", () => {
    const { projection } = driveTheRealChain(records(), brief);
    const quote = governedOverlongQuote();
    const node = projection.graph.nodes.find(
      (n) => n.provenance?.source_quote === quote,
    );
    expect(node, "the over-long option must still be a node").toBeDefined();
    // NOT A LENGTH ASSERTION: the verbatim is byte-identical and complete.
    expect(node!.provenance!.source_quote).toBe(quote);
    expect(node!.provenance!.source_quote!.length).toBeGreaterThan(NODE_LABEL_MAX_CHARS);
    // The label is shortened, and the product SAYS the display string is ours.
    expect(node!.label.length).toBeLessThanOrEqual(NODE_LABEL_MAX_CHARS);
    expect(node!.label).not.toBe(quote);
    expect(node!.provenance!.label_authored).toBe(true);
    // Every visible character is still the user's own — nothing is invented.
    expect(quote.startsWith(node!.label.replace(/…$/, ""))).toBe(true);
  });

  /**
   * ⭐ THE DISCRIMINATING PAIR for `label_authored`'s scope (trap 19/13b).
   *
   * `label_authored` means *the display string is OURS rather than the user's
   * verbatim words*, and its contract is to sit BESIDE `source_quote` so a
   * surface can say "you said: …". A shortened STATED label must earn it — the
   * field would otherwise lie, because absent means "the label IS the user's
   * own text". A shortened `ai_inferred` CLAIM label must NOT: it has no
   * `source_quote`, so the badge would promise a verbatim that does not exist.
   *
   * Neither half alone shows the scoping is real. Both, in one projection, do.
   */
  it("badges a shortened STATED label as ours, and does NOT badge a shortened INFERRED one", () => {
    const quote = governedOverlongQuote();
    const brief = `We must decide. We could ${quote}. Or we could wait.`;
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow marketplace liquidity" },
        { kind: "option", source_quote: quote },
      ],
      claims: [
        // A model-authored label that is also over-long — same treatment, but
        // it is the MODEL's text, not the user's.
        { claim_kind: "factor", label: `${quote} across every segment`, basis: [1] },
        {
          claim_kind: "causal_link",
          label: "the option moves the factor",
          from_stated: 1,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "the factor reaches the goal",
          from_claim: 0,
          to_stated: 0,
          effect: "positive",
        },
      ],
    };
    const { projection } = driveTheRealChain(records, brief);

    const stated = projection.graph.nodes.find((n) => n.provenance?.source_quote === quote);
    const inferred = projection.graph.nodes.find(
      (n) => n.provenance?.provenance_class === "ai_inferred" && n.label.length > 0 && n.kind === "factor",
    );

    // PIN THE PRECONDITION: both must actually have been shortened, or this
    // test passes by testing nothing (trap 13b).
    expect(stated, "the stated option node must exist").toBeDefined();
    expect(inferred, "the inferred factor node must exist").toBeDefined();
    expect(stated!.label.endsWith("…"), "the stated label must have been shortened").toBe(true);
    expect(inferred!.label.endsWith("…"), "the inferred label must have been shortened").toBe(true);

    // The discrimination itself.
    expect(stated!.provenance!.label_authored).toBe(true);
    expect(inferred!.provenance!.source_quote).toBeUndefined();
    expect(inferred!.provenance!.label_authored).toBeUndefined();
  });

  /**
   * ⭐⭐ THE ONE DOWNSTREAM COUPLING THAT COULD BITE, MEASURED RATHER THAN
   * REASONED ABOUT.
   *
   * `projector.ts:2164-2170` warns that option labels are not authored because
   * `transforms/schema-v3.ts:1188` binds an option's provenance ON ITS LABEL
   * (`bindOptionLabelToBrief`), so changing one could flip `from_brief` →
   * `ai_inferred` — re-badging the user's OWN option as something the AI made
   * up. That would be a worse defect than the one this lane fixes.
   *
   * It does not happen, and the reason is structural: every records-projected
   * node carries a typed record provenance, so `projectNodeProvenance` takes the
   * typed branch and `continue`s at `:1185`, BEFORE the label binding at `:1188`
   * is ever reached. But "I read the branch order" is not evidence (trap 16) —
   * this drives the real transform and reads the wire-shaped verdict.
   */
  it("shortening an option's label does NOT flip its provenance badge", () => {
    const quote = governedOverlongQuote();
    const ordinaryQuote = governedOrdinaryOptionQuote();
    const brief = `We must grow. We could ${quote}. Alternatively, ${ordinaryQuote}.`;
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow marketplace liquidity" },
        { kind: "option", source_quote: quote },
        { kind: "option", source_quote: ordinaryQuote },
      ],
      claims: [
        { claim_kind: "factor", label: "Match Quality", basis: [1] },
        {
          claim_kind: "causal_link",
          label: "matching moves match quality",
          from_stated: 1,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "match quality reaches the goal",
          from_claim: 0,
          to_stated: 0,
          effect: "positive",
        },
      ],
    };
    const { v3 } = driveTheRealChain(records, brief);
    const options = (v3.graph as { nodes: readonly Record<string, unknown>[] }).nodes.filter(
      (n) => n.kind === "option",
    );

    // ⭐ BOUND BY IDENTITY, never by a value predicate another option could
    // satisfy (trap 19). These used to be found by `label.endsWith("…")` and its
    // negation, which identifies an arm by the very property under test: any
    // change that shortened both, or neither, would have silently re-pointed
    // both `find`s at one node — or at none — rather than failing.
    const shortened = options.find((n) => String(n.source_quote) === quote);
    const ordinary = options.find((n) => String(n.source_quote) === ordinaryQuote);

    // PIN BOTH PRECONDITIONS, or the comparison below is between two nothings.
    expect(shortened, "the over-long option must reach the wire").toBeDefined();
    expect(ordinary, "the within-bound option must reach the wire").toBeDefined();
    expect(
      String(shortened!.label).endsWith("…"),
      "the over-long option must actually have been shortened",
    ).toBe(true);

    // ⭐⭐ AND THE PRECONDITION THE 31 Aug RED PROVED IS NOT OPTIONAL. The
    // ordinary arm only discriminates while something is genuinely leaving this
    // label alone — when #1206 began authoring the previous fixture, the arm
    // stopped being an arm. So the "untouched" half is now ASSERTED, at the
    // wire, before anything is concluded from it: the label that arrives IS the
    // user's verbatim, and it is within bound so the bound had no work to do.
    expect(ordinaryQuote.length).toBeLessThanOrEqual(NODE_LABEL_MAX_CHARS);
    expect(
      String(ordinary!.label),
      "nothing may author the ordinary option's label, or this pair stops discriminating",
    ).toBe(ordinaryQuote);

    // ⭐ THE DISCRIMINATION: the shortened option keeps the SAME badge as the
    // untouched one. A single-armed assertion could not tell "correct" from
    // "both are ai_inferred".
    expect(shortened!.provenance).toBe("from_brief");
    expect(ordinary!.provenance).toBe("from_brief");
    // …and the verbatim reached the wire in full, which is what the badge means.
    expect(String(shortened!.source_quote)).toBe(quote);
    expect(shortened!.label_authored).toBe(true);
    expect(ordinary!.label_authored).toBeUndefined();
  });

  it("the shortened label does not move the node's id — bounding runs AFTER every id is minted", () => {
    const { projection } = driveTheRealChain(records(), brief);
    const quote = governedOverlongQuote();
    const bounded = projection.graph.nodes.find((n) => n.provenance?.source_quote === quote);
    expect(bounded).toBeDefined();
    // A stated node's id is `sha8(kind, quote)`. Recomputing it from the
    // SHORTENED label must NOT be what produced this id, and the node must
    // still be reachable by every edge that referenced it.
    const referenced = projection.graph.edges.some(
      (e) => e.from === bounded!.id || e.to === bounded!.id,
    );
    expect(referenced, "the bounded node must keep its edges").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ⭐⭐ THE OVER-CORRECTION CONTROL — without this you cannot tell a fix from
//    a regression that mangles every label in the product.
// ─────────────────────────────────────────────────────────────────────────────
describe("an ordinary label is byte-identical to today's behaviour", () => {
  it("returns the SAME STRING REFERENCE for every label the corpus already ships within bound", () => {
    const within = corpusNodes().filter((n) => n.label.length <= NODE_LABEL_MAX_CHARS);
    // Contrast control: 237 of 238, so this is a real population, not an
    // empty loop agreeing with itself.
    expect(within).toHaveLength(237);
    for (const node of within) {
      const out = boundNodeLabel(node.label);
      // Referential identity, not equality: a normalising copy would pass an
      // equality check and still be a behaviour change.
      expect(out === node.label, `label mutated for ${node.id}`).toBe(true);
    }
  });

  it("is exact at the boundary — MAX passes through untouched, MAX+1 is shortened", () => {
    const atBound = "x".repeat(NODE_LABEL_MAX_CHARS);
    const overBound = "x".repeat(NODE_LABEL_MAX_CHARS + 1);
    expect(boundNodeLabel(atBound) === atBound).toBe(true);
    expect(boundNodeLabel(overBound)).not.toBe(overBound);
    expect(boundNodeLabel(overBound).length).toBeLessThanOrEqual(NODE_LABEL_MAX_CHARS);
    // …and the published validator agrees with both verdicts, which is the
    // point of deriving the bound from it.
    expect(NodeV3Schema.shape.label.safeParse(boundNodeLabel(overBound)).success).toBe(true);
    expect(NodeV3Schema.shape.label.safeParse(overBound).success).toBe(false);
  });

  it("leaves an ordinary draft's labels untouched end to end", () => {
    const brief =
      "We want to grow revenue. We could hire two engineers, or buy a platform.";
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "hire two engineers" },
        { kind: "option", source_quote: "buy a platform" },
      ],
      claims: [
        { claim_kind: "factor", label: "Engineering Capacity", basis: [1] },
        {
          claim_kind: "causal_link",
          label: "hiring moves capacity",
          from_stated: 1,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "capacity reaches the goal",
          from_claim: 0,
          to_stated: 0,
          effect: "positive",
        },
      ],
    };
    const { projection } = driveTheRealChain(records, brief);
    // No label is shortened, and no node acquires the "our display string" badge
    // it did not have before.
    for (const node of projection.graph.nodes) {
      expect(node.label.endsWith("…"), `${node.id} was shortened`).toBe(false);
    }
    const options = projection.graph.nodes.filter((n) => n.kind === "option");
    expect(options.length).toBeGreaterThan(0);
    for (const opt of options) {
      // Options are NOT authored (`projector.ts:2172` scopes authoring to goal),
      // so an ordinary option label is still exactly the user's own quote.
      expect(opt.label).toBe(opt.provenance?.source_quote);
      expect(opt.provenance?.label_authored).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE BOUND'S OWN PROPERTIES — spec-shaped, not failure-mode-shaped (13d).
// ─────────────────────────────────────────────────────────────────────────────
describe("boundNodeLabel satisfies the PUBLISHED contract, not just the case in hand", () => {
  it("never returns a label the published schema rejects, for any length around the bound", () => {
    for (let n = 1; n <= NODE_LABEL_MAX_CHARS + 40; n += 1) {
      // Word-shaped input, so the word-boundary branch is genuinely exercised.
      const label = "alpha beta gamma delta ".repeat(Math.ceil(n / 23)).slice(0, n);
      const out = boundNodeLabel(label);
      expect(
        NodeV3Schema.shape.label.safeParse(out).success,
        `length ${n} produced a rejected label of length ${out.length}`,
      ).toBe(true);
    }
  });

  it("honours the contract's FLOOR as well as its ceiling, even with no word boundary to find", () => {
    const unbroken = "x".repeat(NODE_LABEL_MAX_CHARS * 3);
    const out = boundNodeLabel(unbroken);
    expect(out.length).toBeGreaterThanOrEqual(NODE_LABEL_MIN_CHARS);
    expect(out.length).toBeLessThanOrEqual(NODE_LABEL_MAX_CHARS);
    expect(NodeV3Schema.shape.label.safeParse(out).success).toBe(true);
  });

  it("never ships half a code point", () => {
    // A run of astral characters forces a cut at an odd UTF-16 offset.
    const astral = "😀".repeat(NODE_LABEL_MAX_CHARS);
    const out = boundNodeLabel(astral);
    expect(out.length).toBeLessThanOrEqual(NODE_LABEL_MAX_CHARS);

    // ⚠ THE `u` FLAG MUST NOT APPEAR ON EITHER REGEX HERE, AND THE FIRST
    // VERSION OF THIS TEST HAD IT AND WAS THEREFORE BLIND. Under `/u` a regex
    // matches CODE POINTS, so `[\uD800-\uDBFF][\uDC00-\uDFFF]` matches nothing
    // at all (an emoji is one code point, not two surrogates) — the strip
    // silently no-opped and the test reported a lone-surrogate defect in code
    // that had none. Measured: `"😀".repeat(5).replace(/…/gu,"")` returns the
    // input unchanged; without `u` it returns "". Both regexes below work in
    // UTF-16 code units, which is the unit `String.length` and Zod's `.max()`
    // both count — the same measurement the bound is derived against.
    const pairsStripped = out.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
    // Positive control: the instrument can SEE a lone surrogate when one exists,
    // so a clean read below is absence rather than blindness (trap 13).
    expect(/[\uD800-\uDFFF]/.test(`x${astral.slice(0, 1)}`)).toBe(true);
    expect(/[\uD800-\uDFFF]/.test(pairsStripped)).toBe(false);
  });

  it("invents no token the user did not write", () => {
    const quote = governedOverlongQuote();
    const out = boundNodeLabel(quote);
    expect(quote.startsWith(out.replace(/…$/, ""))).toBe(true);
  });
});
