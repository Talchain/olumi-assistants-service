/**
 * ROADMAP 2.725 — the doctrine guard: the `strongest` closure and the
 * `assist.v1.*` coverage extension.
 *
 * Two properties are pinned here, and they fail for DIFFERENT reasons on
 * purpose:
 *
 *  A. The DOCTRINE_FATAL superlative alternation now catches `strongest` (and
 *     `most promising`) — the measured evasion at
 *     `services/review/blockBuilders.ts:459`, which shipped
 *     `"{label}" appears to be the strongest option.` past a guard that already
 *     banned `best|better|optimal|right|obvious|clear|clearest|smartest|safest|
 *     sensible|superior|preferable`. Two sibling layers in this estate already
 *     treat `strongest` as a crowning word; the WIRE guard was the one that did
 *     not.
 *
 *  B. The route-egress scanner shares ONE definition with the turn-path guard.
 *     Set membership is asserted by regex-object IDENTITY, not by source string,
 *     so a future pattern added to either named set is provably carried by both
 *     surfaces — the drift a second hand-maintained copy would have had
 *     (CLAUDE.md trap 12).
 *
 * What would have to be true for these to pass while the property fails?
 *  - (A) could pass vacuously if the exemplar sentence matched some OTHER
 *    pattern in the set. Guarded by a DISCRIMINATING assertion: the exemplar is
 *    checked against DOCTRINE_FATAL_PATTERNS[0] SPECIFICALLY, and a control
 *    sentence proves that pattern still rejects the shapes it always rejected.
 *  - (B) could pass vacuously if either named set were empty. Both lengths are
 *    asserted non-zero before any membership claim.
 */

import { describe, expect, it } from "vitest";

import {
  DOCTRINE_FATAL_PATTERNS,
  DOCTRINE_VERDICT_PATTERNS,
  FORBIDDEN_USER_FACING_PHRASES,
  findForbiddenPhraseHit,
  applyEgressForbiddenPhraseGuard,
} from "../../../orchestrator-v5/compose/forbidden-user-facing-phrases.js";
import {
  ROUTE_EGRESS_DOCTRINE_PATTERNS,
  findDoctrineHit,
  scanPayloadForDoctrineHits,
} from "../route-egress-doctrine-scan.js";

/** The exact sentence `blockBuilders.ts` shipped, with the exact label shape. */
const MEASURED_EVASION = '"Hire Locally" appears to be the strongest option.';

describe("A — the `strongest` evasion is closed in DOCTRINE_FATAL", () => {
  it("the superlative-crowning pattern (index 0) itself catches the measured evasion", () => {
    expect(DOCTRINE_FATAL_PATTERNS.length).toBeGreaterThan(0);
    // Bound to the SPECIFIC pattern, so a hit from some other member of the set
    // cannot make this pass (trap 19: bind by identity, not by any-match).
    expect(DOCTRINE_FATAL_PATTERNS[0].test(MEASURED_EVASION)).toBe(true);
  });

  it("`most promising` is closed in the same alternation", () => {
    expect(
      DOCTRINE_FATAL_PATTERNS[0].test("Option B is the most promising choice."),
    ).toBe(true);
  });

  it("the whole turn-path guard now fires on it, with the FATAL remedy", () => {
    expect(findForbiddenPhraseHit(MEASURED_EVASION)).not.toBeNull();
    const guarded = applyEgressForbiddenPhraseGuard(MEASURED_EVASION);
    expect(guarded.rewritten).toBe(true);
    // Fatal, not rewritable: there is no TERMINOLOGY_RULES entry for a choice
    // crowning, so substituting a noun would leave the product still crowning.
    expect(guarded.remedy).toBe("fallback_replacement");
  });

  it("CONTROL — the additions do not widen the pattern beyond its copula anchor", () => {
    // These must all still be SAYABLE. If adding `strongest` had loosened the
    // shape, one of these would start matching and this control would red.
    const mustStaySayable = [
      // No copula — coaching question form.
      "What would make Option B the strongest choice?",
      // Negation lookahead — the product must be able to DE-recommend.
      "The status quo is not always the safest choice.",
      // `become` deliberately absent from the copula set — conditional flips.
      "Option B could become the better choice if margins hold.",
      // Superlative without a choice-noun — sensitivity description, analysis.
      "Customer Lifetime Value has the strongest positive effect on revenue.",
      // Choice-noun without a superlative.
      "This is a difficult choice.",
    ];
    for (const s of mustStaySayable) {
      expect(DOCTRINE_FATAL_PATTERNS[0].test(s), `wrongly banned: ${s}`).toBe(false);
    }
  });
});

describe("B — route-egress coverage shares ONE definition with the turn-path guard", () => {
  it("both named sets are non-empty (no vacuous membership claims below)", () => {
    expect(DOCTRINE_VERDICT_PATTERNS.length).toBeGreaterThan(0);
    expect(DOCTRINE_FATAL_PATTERNS.length).toBeGreaterThan(0);
  });

  it("every named doctrine pattern is carried by the turn-path guard, by IDENTITY", () => {
    // `toContain` on a RegExp array compares by object identity — so this can
    // only pass if the same object was spread in, never if a copy was made.
    for (const p of DOCTRINE_VERDICT_PATTERNS) {
      expect(FORBIDDEN_USER_FACING_PHRASES).toContain(p);
    }
    for (const p of DOCTRINE_FATAL_PATTERNS) {
      expect(FORBIDDEN_USER_FACING_PHRASES).toContain(p);
    }
  });

  it("every named doctrine pattern is carried by the route scanner, by IDENTITY", () => {
    for (const p of DOCTRINE_VERDICT_PATTERNS) {
      expect(ROUTE_EGRESS_DOCTRINE_PATTERNS).toContain(p);
    }
    for (const p of DOCTRINE_FATAL_PATTERNS) {
      expect(ROUTE_EGRESS_DOCTRINE_PATTERNS).toContain(p);
    }
  });

  it("the route scanner deliberately does NOT carry the internal-jargon patterns", () => {
    // Negative half of the coverage claim, and the reason the extension is a
    // subset rather than the whole list: a graph-STRUCTURE review route
    // legitimately says "Add a goal node…" and "Review graph structure for
    // disconnected or orphan nodes." Wiring the full set here would fire on
    // copy that is correct.
    expect(findForbiddenPhraseHit("The orchestrator rejected the node ops.")).not.toBeNull();
    expect(findDoctrineHit("The orchestrator rejected the node ops.")).toBeNull();
    expect(
      findDoctrineHit("Add a goal node to define what you're trying to achieve."),
    ).toBeNull();
  });
});

describe("B2 — the scanner sees string leaves at any depth, with their path", () => {
  it("POSITIVE CONTROL — it can see a PRESENCE before any absence is claimed", () => {
    // Trap 13: an absence assertion is vacuous until the instrument is shown to
    // detect a presence through the same code path.
    const hits = scanPayloadForDoctrineHits({
      rationale: { summary: "Premium Plan is recommended because price leads." },
    });
    expect(hits).toEqual([{ path: "rationale.summary", term: "recommended" }]);
  });

  it("indexes array members so a hit names the exact leaf", () => {
    const hits = scanPayloadForDoctrineHits({
      improvement_guidance: [
        { reason: "Structural improvement suggested" },
        { reason: "Structural improvement recommended" },
      ],
    });
    expect(hits).toEqual([
      { path: "improvement_guidance.1.reason", term: "recommended" },
    ]);
  });

  it("reports nothing on a clean payload, and survives cycles / non-strings", () => {
    const cyclic: Record<string, unknown> = { headline: "Premium Pricing stays in front in 87% of tested scenarios" };
    cyclic.self = cyclic;
    expect(
      scanPayloadForDoctrineHits({ ...cyclic, score: 0.87, flag: true, missing: null }),
    ).toEqual([]);
  });
});
