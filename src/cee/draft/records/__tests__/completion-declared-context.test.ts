import { describe, expect, it } from "vitest";
import { buildRecordsCompletionPrompt } from "../completion.js";
import type { DraftRecordSet, DraftStatedItem } from "../grammar.js";

function renderedItem(item: DraftStatedItem): string {
  const records: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "Keep the company operating" },
      { kind: "figure", source_quote: "Current funding is £20,000", value: 20_000, unit: "£", role: "baseline" },
      item,
    ],
    claims: [
      { claim_kind: "factor", label: "Funding secured" },
      { claim_kind: "factor", label: "Funding required" },
    ],
  };
  const prompt = buildRecordsCompletionPrompt({
    brief: records.stated_items.map((s) => s.source_quote).join(". "),
    records,
    ask: { items: [], baseClaimIndex: records.claims.length },
  });
  const lines = prompt.split("\n").filter((line) => line.startsWith("  stated_items[2] "));
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

describe("completion retains declared meaning in its existing-record context", () => {
  const figure: DraftStatedItem = {
    kind: "figure", source_quote: "Funding amount: £1.3m", value: 1_300_000, unit: "£",
  };

  it.each(["target", "constraint", "context"] as const)("distinguishes a declared %s from the same figure's baseline role", (role) => {
    const baseline = renderedItem({ ...figure, role: "baseline" });
    const other = renderedItem({ ...figure, role });
    expect(baseline).toContain('[role=baseline]');
    expect(other).toContain(`[role=${role}]`);
    expect(other).not.toBe(baseline);
    for (const line of [baseline, other]) {
      expect(line).toContain('stated_items[2] figure: "Funding amount: £1.3m" (value 1300000 £)');
    }
  });

  it("distinguishes a floor from a ceiling without changing the quote or threshold", () => {
    const limit: DraftStatedItem = { ...figure, kind: "constraint", role: "constraint", applies_to_claim: 0 };
    const floor = renderedItem({ ...limit, direction: "floor" });
    const ceiling = renderedItem({ ...limit, direction: "ceiling" });
    expect(floor).toContain("direction=floor");
    expect(ceiling).toContain("direction=ceiling");
    expect(floor.replace("direction=floor", "direction=ceiling")).toBe(ceiling);
  });

  it("preserves target namespace and zero index, and distinguishes a different target", () => {
    const limit: DraftStatedItem = { ...figure, kind: "constraint", direction: "floor" };
    const stated = renderedItem({ ...limit, applies_to_stated: 0 });
    const claim = renderedItem({ ...limit, applies_to_claim: 0 });
    const otherClaim = renderedItem({ ...limit, applies_to_claim: 1 });
    expect(stated).toContain("applies_to_stated=stated_items[0]");
    expect(claim).toContain("applies_to_claim=claims[0]");
    expect(otherClaim).toContain("applies_to_claim=claims[1]");
    expect(new Set([stated, claim, otherClaim]).size).toBe(3);
  });

  it("does not choose a target when both namespaces were declared", () => {
    const line = renderedItem({ ...figure, kind: "constraint", applies_to_stated: 1, applies_to_claim: 0 });
    expect(line).toContain("applies_to_stated=stated_items[1]");
    expect(line).toContain("applies_to_claim=claims[0]");
  });

  it("retains a qualitative quote and its declared role without inventing a quantity", () => {
    const quote = 'Extra capital would be "nice to have".\nIt is optional upside.';
    const line = renderedItem({ kind: "cause", source_quote: quote, role: "context" });
    expect(line).toBe(`  stated_items[2] cause: ${JSON.stringify(quote)} [role=context]`);
  });

  it("keeps absent declarations absent for numeric and qualitative records", () => {
    expect(renderedItem(figure)).toBe('  stated_items[2] figure: "Funding amount: £1.3m" (value 1300000 £)');
    expect(renderedItem({ kind: "constraint", source_quote: "Legal has not confirmed this" }))
      .toBe('  stated_items[2] constraint: "Legal has not confirmed this"');
  });
});
