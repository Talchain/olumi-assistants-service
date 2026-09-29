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

import { completionRegressesProtectedContent, shouldKeepCompletion } from "../completion.js";
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

const optionNode = (
  interventions: Record<string, number>,
  kind = "option",
  source: string = "cee_hypothesis",
) =>
  ({
    graph: {
      version: "1",
      nodes: [{
        id: "opt1",
        kind,
        label: "hold at £49",
        data: {
          interventions,
          intervention_details: Object.fromEntries(
            Object.entries(interventions).map(([f, v]) => [f, { raw_value: v, source }]),
          ),
        },
      }],
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

/**
 * ⭐⭐ THE REVIEW FINDING (Codex, 15 Sep), PINNED.
 *
 * The suspicion signal is EMISSION-level: one provably invalid reference makes
 * the whole option→factor set suspect. Left there, it would let a single bad
 * reference license overwriting an UNRELATED, USER-GROUNDED magnitude somewhere
 * else on the graph. A `brief_extraction` value is one the projector VERIFIED
 * against the brief bytes, so it stays protected regardless.
 */
describe("D — a user-grounded magnitude is never exempted", () => {
  it("D1: `brief_extraction` stays protected even when the references are suspect", () => {
    expect(
      completionRegressesProtectedContent(
        optionNode({ price: 0.49 }, "option", "brief_extraction"),
        optionNode({ price: 0.59 }, "option", "brief_extraction"),
        { optionEffectsUnreliable: true },
      ),
    ).toContain("intervention_overwritten:opt1:price:0.49->0.59");
  });

  it("D2: the AI-authored twin of the same case IS exempted — the pair discriminates", () => {
    expect(
      completionRegressesProtectedContent(
        optionNode({ price: 0.49 }, "option", "cee_hypothesis"),
        optionNode({ price: 0.59 }, "option", "cee_hypothesis"),
        { optionEffectsUnreliable: true },
      ),
    ).toEqual([]);
  });

  it("D3: an UNSTAMPED magnitude is protected — the exemption is opt-in, fail-closed", () => {
    const before = { graph: { version: "1", nodes: [{ id: "opt1", kind: "option", label: "x", data: { interventions: { price: 0.49 } } }], edges: [], meta: { roots: [], leaves: [], source: "assistant", suggested_positions: {} } }, provenance: { opt1: { provenance_class: "stated" } }, dropped: [] } as any;
    const after = { graph: { version: "1", nodes: [{ id: "opt1", kind: "option", label: "x", data: { interventions: { price: 0.59 } } }], edges: [], meta: { roots: [], leaves: [], source: "assistant", suggested_positions: {} } }, provenance: { opt1: { provenance_class: "stated" } }, dropped: [] } as any;
    expect(
      completionRegressesProtectedContent(before, after, { optionEffectsUnreliable: true }),
    ).toContain("intervention_overwritten:opt1:price:0.49->0.59");
  });

  it("C2: the residue is recorded — the two suspect magnitudes in the live capture are BOTH cee_hypothesis, so this bound does not reopen the defect", () => {
    const capture = JSON.parse(
      readFileSync(join(FIXTURES, "live-option-effect-refs-off-by-one-2026-09-15.json"), "utf8"),
    );
    expect(optionEffectReferencesUnreliable(capture)).toBe(true);
  });
});

/**
 * ⭐⭐⭐ THE PRODUCTION KEEP DECISION — the test this kit was MISSING, and its
 * absence made the whole repair inert.
 *
 * P1 from independent review (Codex, 15 Sep). `anthropic.ts` passed the trust
 * exemption into `completionRegressesProtectedContent` for TELEMETRY, and
 * `shouldKeepCompletion` — the function that actually decides — re-ran the same
 * guard WITHOUT it. `violationsWithExemption` read `[]` while the production
 * decision stayed `false`, so the completion carrying the correct magnitudes was
 * discarded exactly as before the fix.
 *
 * ⛔ WHY FOUR MUTANTS DID NOT CATCH IT. Every one targeted the GUARD. A guard
 * can be perfectly sensitive and still be wired to nothing — the kit measured
 * the component and never the decision. So this block asserts through
 * `shouldKeepCompletion` itself, and nothing else in this file does.
 */
describe("E — the exemption reaches the decision, not just the telemetry", () => {
  const ask = { items: [], baseClaimIndex: 0 };
  const before = optionNode({ price: 0.59 });
  const after = optionNode({ price: 0.49 });

  it("E1: the production keep decision KEEPS the repair when references are suspect", () => {
    expect(
      shouldKeepCompletion(ask, ask, { before, after }, { optionEffectsUnreliable: true }),
    ).toBe(true);
  });

  it("E2: control — with credible references the same completion is still discarded", () => {
    expect(
      shouldKeepCompletion(ask, ask, { before, after }, { optionEffectsUnreliable: false }),
    ).toBe(false);
  });

  it("E3: default (no opts) is unchanged — discarded, fail-closed", () => {
    expect(shouldKeepCompletion(ask, ask, { before, after })).toBe(false);
  });

  it("E4: caller-supplied violations are REUSED, not re-derived — the two cannot drift", () => {
    // A caller that already derived `[]` gets `true` even with the flag absent,
    // because the single derivation is the authority. This is what pins the
    // "derive once and reuse" property rather than re-threading a flag twice.
    expect(
      shouldKeepCompletion(ask, ask, { before, after }, { preservationViolations: [] }),
    ).toBe(true);
    expect(
      shouldKeepCompletion(ask, ask, { before, after }, { preservationViolations: ["x"] }),
    ).toBe(false);
  });

  it("E5: a user-grounded magnitude still blocks the keep, even when suspect", () => {
    expect(
      shouldKeepCompletion(
        ask,
        ask,
        {
          before: optionNode({ price: 0.49 }, "option", "brief_extraction"),
          after: optionNode({ price: 0.59 }, "option", "brief_extraction"),
        },
        { optionEffectsUnreliable: true },
      ),
    ).toBe(false);
  });
});
