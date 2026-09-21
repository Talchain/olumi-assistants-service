/**
 * Source-binding + widener-immutability tests.
 *
 * FIXTURE PROVENANCE — this matters more than the assertions.
 * `fixtures/pricing-builder-wp0.json` is a byte copy of
 * `output/model-gen-20260921/CONTRACT-v0/example-pricing-builder-output.json`,
 * which is the REAL `gpt-4.1` builder response captured in WP0 (8.7 s, 2359 in /
 * 1656 out, `text.format json_schema strict:true`). It is NOT authored here.
 * A self-authored fixture would confirm the validator's model of the world
 * instead of testing it, which is the failure this whole lane is measuring.
 * `fixtures/pricing-staging.md` pins the brief BYTES the builder was given.
 *
 * Every mutant below asserts a NAMED gate fires, and the unmutated fixture is
 * kept as the contrast control in the same file: target non-empty + control
 * empty, or the failure means nothing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import matter from "gray-matter";
import {
  checkWidenerImmutability,
  matchQuote,
  readNumbersFromSpan,
  transformationExplains,
  validateSourceBinding,
} from "../../src/source-binding.js";
import { parseRichModel, type RichDecisionModel } from "../../src/rich-model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "pricing-builder-wp0.json");
const FIXTURE_CURRENT = join(HERE, "fixtures", "pricing-builder-20260922.json");
const BRIEF_FIXTURE = join(HERE, "fixtures", "pricing-staging.md");
const LIVE_BRIEF = join(HERE, "..", "..", "briefs", "pricing-staging.md");

function briefBody(path: string): string {
  return matter(readFileSync(path, "utf-8")).content.trim();
}

/**
 * The WP0 capture PREDATES `decision.goal_measured_by`, which the bake-off lane
 * added to the contract on 2026-09-22. It is therefore loaded WITHOUT the strict
 * parser — deliberately, so the binding gates can still be tested against a
 * capture that exercises a qualitative factor. That the strict parser REJECTS
 * it is itself asserted below.
 */
function loadFixture(): RichDecisionModel {
  return JSON.parse(readFileSync(FIXTURE, "utf-8")) as RichDecisionModel;
}

/** A real gpt-4.1 capture under the CURRENT contract (2026-09-22, run-2). */
function loadCurrentFixture(): RichDecisionModel {
  return parseRichModel(readFileSync(FIXTURE_CURRENT, "utf-8"));
}

/** Deep clone so a mutant can never leak into another test. */
function clone(model: RichDecisionModel): RichDecisionModel {
  return JSON.parse(JSON.stringify(model)) as RichDecisionModel;
}

const BRIEF = briefBody(BRIEF_FIXTURE);

describe("fixture integrity", () => {
  it("the pinned brief still matches the live brief body", () => {
    // If this REDs, briefs/pricing-staging.md changed after WP0 captured the
    // builder output. The fixture's source_quotes were bound to the OLD bytes,
    // so re-capture the builder output rather than editing the fixture.
    expect(briefBody(LIVE_BRIEF)).toBe(BRIEF);
  });

  it("the current-contract capture parses under the strict parser", () => {
    const model = loadCurrentFixture();
    expect(model.user_facts).toHaveLength(6);
    expect(model.constraints[0].operator).toBe("<");
    expect(model.decision.goal_measured_by).toBe("out1");
  });

  it("the strict parser REJECTS the pre-2026-09-22 capture, naming the added field", () => {
    // Fails loud, as designed: a contract change must not pass silently.
    expect(() => parseRichModel(readFileSync(FIXTURE, "utf-8"))).toThrow(/goal_measured_by/);
  });

  it("the pre-2026-09-22 capture still binds cleanly (the gates do not read that field)", () => {
    const result = validateSourceBinding(BRIEF, loadFixture());
    expect(result.failures).toEqual([]);
  });
});

describe("number reading", () => {
  it("expands k/m suffixes to native magnitude and keeps the literal", () => {
    expect(readNumbersFromSpan("goal of reaching £20k MRR")).toContain(20000);
    expect(readNumbersFromSpan("goal of reaching £20k MRR")).toContain(20);
    expect(readNumbersFromSpan("a £1.5m round")).toContain(1_500_000);
  });

  it("reads a percent at NATIVE magnitude, never as a fraction", () => {
    const found = readNumbersFromSpan("monthly churn under 4%");
    expect(found).toContain(4);
    expect(found).not.toContain(0.04);
  });

  it("reads thousands separators and number words one–twenty", () => {
    expect(readNumbersFromSpan("20,000 customers")).toContain(20000);
    expect(readNumbersFromSpan("hire two developers")).toContain(2);
    expect(readNumbersFromSpan("twenty seats")).toContain(20);
  });

  it("accepts a declared transformation only when its source is in the quote", () => {
    expect(transformationExplains("reaching £20k MRR", "£20k → 20000", 20000)).toBe(true);
    // Discriminating mutant: the transformation names a span the quote does not contain.
    expect(transformationExplains("reaching £20k MRR", "£25k → 25000", 25000)).toBe(false);
  });

  it("matches quotes exactly, then whitespace-normalised, and reports neither as equal", () => {
    expect(matchQuote(BRIEF, "within 12 months")).toBe("exact");
    expect(matchQuote(BRIEF, "within  12\nmonths")).toBe("normalised");
    expect(matchQuote(BRIEF, "within 13 months")).toBe("none");
  });
});

describe("validateSourceBinding — contrast control", () => {
  it("PASSES on the real current-contract builder output", () => {
    const result = validateSourceBinding(BRIEF, loadCurrentFixture());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("does NOT need the declared transformation for £20k — the reader expands the suffix itself", () => {
    // MEASURED, not assumed: readNumbersFromSpan("…£20k…") yields 20000, so SB2
    // is satisfied by the quote alone and no observation is emitted. The
    // declared transformation is still checked by the IMM/immutability path and
    // is still the model's own disclosure — it is simply not load-bearing here.
    const result = validateSourceBinding(BRIEF, loadFixture());
    expect(readNumbersFromSpan("goal of reaching £20k MRR")).toContain(20000);
    expect(result.observations ?? []).toEqual([]);
  });

  it("DOES record an observation when only the declared transformation explains the value", () => {
    // A DERIVED figure: the price delta is not a literal in the brief, so SB2 can
    // only pass via the declared transformation — and only when every number the
    // transformation leans on is actually in the quote.
    const model = clone(loadFixture());
    model.user_facts.push({
      id: "uf9",
      kind: "quantity",
      source_quote: "from £49 to £59 per month",
      value: 10,
      unit: "£/month",
      role: "proposed",
      transformation: "£59 - £49 → 10",
    });
    const result = validateSourceBinding(BRIEF, model);
    expect(result.failures.filter((f) => f.item_id === "uf9")).toEqual([]);
    expect(result.observations?.some((o) => o.includes("£59 - £49 → 10"))).toBe(true);
  });

  it("CONTRAST: a transformation leaning on a number that is NOT in the quote fires SB2", () => {
    const model = clone(loadFixture());
    model.user_facts.push({
      id: "uf9",
      kind: "quantity",
      source_quote: "from £49 to £59 per month",
      value: 56.35,
      unit: "£/month",
      role: "proposed",
      // "15%" appears nowhere in the quote — a fabricated derivation.
      transformation: "15% of £49 → £56.35",
    });
    const result = validateSourceBinding(BRIEF, model);
    expect(
      result.failures.filter((f) => f.item_id === "uf9").map((f) => f.gate),
    ).toContain("SB2_value_disagrees_with_quote");
  });
});

describe("validateSourceBinding — mutants", () => {
  it("MUTANT A (altered quote): a quote that is not in the brief fires SB1", () => {
    const model = clone(loadFixture());
    model.user_facts[0].source_quote = "goal of reaching £25k MRR";
    const result = validateSourceBinding(BRIEF, model);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain("SB1_quote_not_in_brief");
    expect(result.failures.find((f) => f.gate === "SB1_quote_not_in_brief")?.item_id).toBe("uf1");
  });

  it("MUTANT B (altered value): a value that disagrees with its quote fires SB2", () => {
    const model = clone(loadFixture());
    const uf6 = model.user_facts.find((f) => f.id === "uf6");
    expect(uf6).toBeDefined();
    uf6!.value = 65;
    const result = validateSourceBinding(BRIEF, model);
    expect(result.ok).toBe(false);
    const gates = result.failures.map((f) => f.gate);
    expect(gates).toContain("SB2_value_disagrees_with_quote");
    // …and the option lever that cites uf6 now disagrees with it too.
    expect(gates).toContain("SB5_value_disagrees_with_cited_fact");
  });

  it("MUTANT B2 (percent normalised to a fraction) fires SB2", () => {
    const model = clone(loadFixture());
    const uf3 = model.user_facts.find((f) => f.id === "uf3");
    uf3!.value = 0.04;
    const result = validateSourceBinding(BRIEF, model);
    expect(result.failures.map((f) => f.gate)).toContain("SB2_value_disagrees_with_quote");
  });

  it("MUTANT C (dropped fact): a dangling source_fact_id fires SB3", () => {
    const model = clone(loadFixture());
    model.user_facts = model.user_facts.filter((f) => f.id !== "uf5");
    const result = validateSourceBinding(BRIEF, model);
    expect(result.ok).toBe(false);
    const dangling = result.failures.filter((f) => f.gate === "SB3_dangling_source_fact_id");
    expect(dangling.length).toBeGreaterThan(0);
    expect(dangling.map((f) => f.item_id)).toContain("f1");
  });

  it("MUTANT F (AI item re-badged as user, unanchored) fires SB3", () => {
    const model = clone(loadFixture());
    const opt2 = model.options.find((o) => o.id === "opt2");
    opt2!.provenance = "user";
    opt2!.source_fact_id = null;
    const result = validateSourceBinding(BRIEF, model);
    expect(result.failures.map((f) => f.gate)).toContain("SB3_user_item_without_anchor");
  });

  it("MUTANT G (AI laundering): an AI item citing a fact that does not carry its value fires SB6", () => {
    const model = clone(loadFixture());
    const opt2 = model.options.find((o) => o.id === "opt2");
    // The status-quo lever keeps its uf5 (£49) anchor but claims a different number.
    opt2!.lever_settings[0].value = 39;
    opt2!.lever_settings[0].epistemic_state = "ai_hypothesis";
    const result = validateSourceBinding(BRIEF, model);
    expect(result.failures.map((f) => f.gate)).toContain("SB6_ai_value_not_in_cited_fact");
  });

  it("MUTANT H (invented baseline): an AI factor with a value and no source fires SB6", () => {
    const model = clone(loadFixture());
    model.factors.push({
      id: "f9",
      label: "Current monthly churn",
      control: "observable",
      measurability: "quantitative",
      epistemic_state: "ai_hypothesis",
      current_value: 5,
      unit: "%",
      provenance: "ai_proposed",
      source_fact_id: null,
      dsk_refs: [],
    });
    const result = validateSourceBinding(BRIEF, model);
    expect(result.failures.map((f) => f.gate)).toContain("SB6_ai_value_without_source");
  });

  it("MUTANT I (option citing the wrong kind of fact) fires SB4", () => {
    const model = clone(loadFixture());
    model.options[0].source_fact_id = "uf3"; // a limit, not an option
    const result = validateSourceBinding(BRIEF, model);
    expect(result.failures.map((f) => f.gate)).toContain("SB4_kind_incompatible");
  });

  it("SB4 does NOT fire on a factor citing an option-kind fact (measured decision, see source-binding.ts)", () => {
    // f2 cites uf4 (kind 'option') in the REAL builder output and is correct.
    const result = validateSourceBinding(BRIEF, loadFixture());
    expect(result.failures.filter((f) => f.item_id === "f2")).toEqual([]);
  });
});

describe("checkWidenerImmutability", () => {
  function widenedGreen(): RichDecisionModel {
    const w = clone(loadFixture());
    w.options.push({
      id: "opt3",
      label: "Run a 60-day price test on new signups only",
      provenance: "ai_proposed",
      source_fact_id: null,
      is_status_quo: false,
      lever_settings: [],
      rationale: "A reversible way to learn price elasticity before committing.",
    });
    w.notes.push({
      about_id: "opt1",
      kind: "challenge",
      text: "No current churn baseline is stated, so the constraint cannot be evaluated.",
      dsk_refs: [],
    });
    return w;
  }

  it("CONTRAST CONTROL: adding ai_proposed items is allowed", () => {
    const result = checkWidenerImmutability(loadFixture(), widenedGreen());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("MUTANT D (changed operator): a silent < → <= fires IMM3", () => {
    const w = widenedGreen();
    w.constraints[0].operator = "<=";
    const result = checkWidenerImmutability(loadFixture(), w);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain("IMM3_constraint_operator_changed");
  });

  it("MUTANT E (renumbered fact): renaming uf1 fires IMM1", () => {
    const w = widenedGreen();
    w.user_facts[0].id = "uf0";
    const result = checkWidenerImmutability(loadFixture(), w);
    expect(result.failures.map((f) => f.gate)).toContain("IMM1_user_facts_reordered_or_renumbered");
  });

  it("MUTANT E2 (reordered facts) fires IMM1 even though every id survives", () => {
    const w = widenedGreen();
    w.user_facts = [...w.user_facts].reverse();
    const result = checkWidenerImmutability(loadFixture(), w);
    expect(result.failures.map((f) => f.gate)).toContain("IMM1_user_facts_reordered_or_renumbered");
  });

  it("MUTANT E3 (rephrased quote) fires IMM1 for the specific fact", () => {
    const w = widenedGreen();
    w.user_facts[2].source_quote = "monthly churn under 4%";
    const result = checkWidenerImmutability(loadFixture(), w);
    const modified = result.failures.filter((f) => f.gate === "IMM1_user_fact_modified");
    expect(modified.map((f) => f.item_id)).toContain("uf3");
  });

  it("MUTANT J (dropped user option) fires IMM2", () => {
    const w = widenedGreen();
    w.options = w.options.filter((o) => o.id !== "opt1");
    const result = checkWidenerImmutability(loadFixture(), w);
    expect(result.failures.map((f) => f.gate)).toContain("IMM2_user_item_dropped");
  });
});
