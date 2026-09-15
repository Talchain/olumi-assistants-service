/**
 * THE PASS-1 OPTION EFFECTS ARE DEFENDED ONLY WHEN THEY ARE CREDIBLE.
 *
 * Every fixture here is a REAL pass-1 record set captured on 15 Sep 2026 from a
 * fresh draft at the served staging prompt (draft_graph_default v201,
 * `fab9aa27…`) and the store-resolved model (`claude-sonnet-4-6`), with the
 * fidelity asserted in-process before the draw. They are EVIDENCE, not
 * fixtures to keep current: append to them, never edit them (CLAUDE.md 14b).
 *
 * The defect they pin: on one compound brief all six `sets_to`-bearing
 * option→factor links were off by exactly +1 while every label named its
 * intended source correctly. Two landed on a `causal_link` and were refused;
 * FOUR landed on `option_refinement` — a legal kind — and were KEPT WRONG, so
 * the product showed the person "hold at £49" priced at £59.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { completionRegressesProtectedContent } from "../completion.js";
import {
  countInvalidOptionEffectSources,
  optionEffectReferencesUnreliable,
} from "../option-effect-reference-trust.js";
import type { DraftRecordSet } from "../grammar.js";

const FIXTURES = join(process.cwd(), "src/cee/draft/records/__tests__/fixtures/2026-09-15-option-effect-references");
const load = (name: string): DraftRecordSet =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}-2026-09-15.json`), "utf8")) as DraftRecordSet;

/**
 * ⭐ THE CONTRAST SET IS THE POINT. A detector that fired on everything would
 * unprotect every draft's option effects; one that fired on nothing would leave
 * the defect shipped. Both arms are asserted, and the four negative arms include
 * `compound-option-price-only`, on which a REFUTED earlier version of this rule
 * (contest a link whose source option label carries a stated figure other than
 * `sets_to`) fired FALSELY — that option's own label reads "increase the Pro
 * plan price from £49 to £59", so it carries £49 while £59 is correct.
 */
describe("A — the detector discriminates, measured on five live captures", () => {
  it("A1: flags the emission with provably-invalid option effect sources", () => {
    const records = load("live-option-effect-refs-off-by-one");
    expect(countInvalidOptionEffectSources(records)).toBe(2);
    expect(optionEffectReferencesUnreliable(records)).toBe(true);
  });

  it.each([
    ["live-compound-option-unwired"],
    ["live-compound-option-price-only"],
    ["live-price-only-healthy"],
    ["live-hiring-stated-options-healthy"],
  ])("A2: does NOT flag %s — no false positive on a healthy reference set", (name) => {
    const records = load(name);
    expect(countInvalidOptionEffectSources(records)).toBe(0);
    expect(optionEffectReferencesUnreliable(records)).toBe(false);
  });

  it("A3: an emission with NO option effects at all is reliable, not suspect", () => {
    expect(optionEffectReferencesUnreliable({ stated_items: [], claims: [] } as unknown as DraftRecordSet)).toBe(false);
  });
});

const optionNode = (interventions: Record<string, number>, kind = "option") =>
  ({
    graph: {
      version: "1",
      nodes: [{ id: "opt1", kind, label: "hold at £49", data: { interventions } }],
      edges: [],
      meta: { roots: [], leaves: [], source: "assistant", suggested_positions: {} },
    },
    provenance: { opt1: { provenance_class: "stated" } },
    dropped: [],
  }) as any;

/**
 * ⭐⭐ THE DISCRIMINATING PAIR. One arm alone proves nothing: the permissive arm
 * shows the repair is no longer blocked, and the strict arm shows the guard was
 * not simply weakened. They must disagree, on the same inputs, on the flag alone.
 */
describe("B — the guard exempts a suspect option effect and nothing else", () => {
  const before = optionNode({ price: 0.59 });
  const after = optionNode({ price: 0.49 });

  it("B1: with the references PROVEN unreliable, the repair is permitted", () => {
    expect(
      completionRegressesProtectedContent(before, after, { optionEffectsUnreliable: true }),
    ).toEqual([]);
  });

  it("B2: with the references credible, the same overwrite is STILL a violation", () => {
    expect(
      completionRegressesProtectedContent(before, after, { optionEffectsUnreliable: false }),
    ).toContain("intervention_overwritten:opt1:price:0.59->0.49");
  });

  it("B3: the default is unchanged — absent option is byte-identical to before", () => {
    expect(completionRegressesProtectedContent(before, after)).toContain(
      "intervention_overwritten:opt1:price:0.59->0.49",
    );
  });

  it("B4: a NON-option node stays fully protected even when option refs are suspect", () => {
    expect(
      completionRegressesProtectedContent(
        optionNode({ price: 0.59 }, "factor"),
        optionNode({ price: 0.49 }, "factor"),
        { optionEffectsUnreliable: true },
      ),
    ).toContain("intervention_overwritten:opt1:price:0.59->0.49");
  });

  it("B5: REMOVAL is never exempted — the exemption is for restatement only", () => {
    expect(
      completionRegressesProtectedContent(optionNode({ price: 0.59 }), optionNode({}), {
        optionEffectsUnreliable: true,
      }),
    ).toContain("intervention_removed:opt1:price");
  });
});

/**
 * ⚠ THE RESIDUE, PINNED SO IT IS VISIBLE IN THE SUITE RATHER THAN IN A COMMENT.
 *
 * This detector establishes an emission's reference set is unreliable from its
 * PROVABLE members. An off-by-one that happens to leave every source on a legal
 * kind leaves no provable member and is NOT detected.
 *
 * ⛔ ASSERTED AS A CEILING, NOT AN EQUALITY, ON PAUL'S RULING: a future repair
 * that detects more of this class must NOT fail this test. Growth fails; a
 * shrink is progress and passes.
 */
describe("C — the undetectable residue is bounded, and shrinking it is allowed", () => {
  it("C1: an all-legal-kind off-by-one is undetected — ceiling, not equality", () => {
    const records = {
      stated_items: [{ kind: "option", source_quote: "raise to £59" }],
      claims: [
        { claim_kind: "option_refinement", label: "Raise to £59", basis: [0] },
        { claim_kind: "option_refinement", label: "Hold at £49", basis: [0] },
        { claim_kind: "factor", label: "Price" },
        { claim_kind: "causal_link", label: "Raise to £59 sets Price", from_claim: 1, to_claim: 2, sets_to: 59 },
      ],
    } as unknown as DraftRecordSet;
    // Every source is a legal `option_refinement`, so nothing is provable here.
    expect(countInvalidOptionEffectSources(records)).toBeLessThanOrEqual(0);
  });
});
