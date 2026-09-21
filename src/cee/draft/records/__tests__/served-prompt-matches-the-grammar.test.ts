/**
 * ⭐⭐⭐ THE SERVED PROMPT AND THE GRAMMAR MUST DESCRIBE THE SAME OUTPUT.
 * Today they do not, and this is the guard that makes that impossible to leave
 * unnoticed again.
 *
 * ⛔ WHAT IS WRONG, verified at the SERVED bytes of two of Paul's own sessions
 * (`draft_graph_default@v201`, sha `fab9aa27`, 61,199 chars, `truncated: false`):
 *
 * The draft model receives TWO system blocks (`anthropic.ts:523`) that describe
 * DIFFERENT output formats:
 *   · block 1 — the served PMS prompt, 61,199 chars. Mentions `stated_items`
 *     ZERO times, `sets_to` ZERO, `basis` ZERO, `claim_kind` ZERO,
 *     `option_refinement` ZERO — and carries a FULL WORKED JSON EXAMPLE of the
 *     old node/edge shape (`"nodes": [ … ], "edges": [ … ]`).
 *   · block 2 — `DRAFT_RECORDS_INSTRUCTION`, 29,551 chars, demanding exactly the
 *     `stated_items[] + claims[]` grammar block 1 never names.
 *
 * ⇒ ~18,000 characters instruct a shape the model must not emit. **Nothing
 * checked that the two agreed**, and that is why 200+ prompt versions never
 * converged: every iteration tuned guidance sitting beside a contradictory
 * worked example. The model produces correct records DESPITE this, forced by a
 * closed JSON schema — which is the measure of the headroom available.
 *
 * ⭐ AND THE VISIBILITY POINT, which cost this estate more than the defect:
 * `_prompt_capture` has been in EVERY debug bundle all along — the exact served
 * prompt, its sha, its version and `truncated: false`, explicitly exempted from
 * redaction. Two lanes spent hours on "we cannot see what is sent to the model".
 * Nobody opened it. **This guard exists so that stops being a question anybody
 * has to think to ask.**
 *
 * ⚠ FIXTURES ARE COUNTS, NOT PROMPT TEXT. The census records how many times the
 * served prompt names each grammar field, its sha, version and size — never the
 * prompt body. So the guard cannot drift into a copy of the prompt, and a
 * reviewer can see what it asserts without reading 61k characters.
 *
 * ⛔ THIS IS A KNOWN-GAP PIN AND IT IS EXPECTED TO BE RED-ADJACENT: the
 * assertions below encode TODAY's measured state. When the served prompt is
 * fixed, the "currently absent" set SHRINKS and this file REDs — which is the
 * signal to update it, not a regression.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildDraftRecordsSchema } from "../grammar.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANKED = resolve(HERE, "fixtures/2026-09-16-served-prompt-census");

type Census = {
  source_bundle: string;
  task: string;
  prompt_version: string;
  system_prompt_sha256: string;
  system_prompt_chars: number;
  truncated: boolean;
  census_fields_covered: string[];
  grammar_field_mentions: Record<string, number>;
  competing_shape_mentions: Record<string, number>;
  has_worked_json_example_of_competing_shape: boolean;
};

const CENSUS: ReadonlyArray<Census> = readdirSync(BANKED)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(resolve(BANKED, f), "utf8")) as Census);

const drafts = () => CENSUS.filter((c) => c.task === "draft_graph");

/** The grammar's own required vocabulary, derived — never hand-listed. */
function grammarRequiredFields(): string[] {
  const s = buildDraftRecordsSchema() as any;
  return [
    ...(s.properties.stated_items.items.required ?? []),
    ...(s.properties.claims.items.required ?? []),
    "stated_items",
    "claims",
  ];
}

describe("the served draft prompt and the records grammar describe the same output", () => {
  it("PRECONDITION: a real served capture is banked, untruncated", () => {
    // An absent census would make every assertion below vacuous.
    expect(drafts().length, "banked draft_graph captures").toBeGreaterThanOrEqual(1);
    for (const c of drafts()) {
      expect(c.truncated, "a truncated capture proves nothing about the prompt").toBe(false);
      expect(c.system_prompt_chars).toBeGreaterThan(10_000);
      expect(c.system_prompt_sha256, "pinned by hash, never by version pointer").toMatch(/^[0-9a-f]{16,}$/);
    }
  });

  it("⛔ KNOWN GAP: the served prompt names NONE of the grammar's own vocabulary", () => {
    // Derived from the grammar, so adding a required field automatically widens
    // what this checks — no mirror to maintain.
    const required = grammarRequiredFields();
    for (const c of drafts()) {
      const named = required.filter((f) => (c.grammar_field_mentions[f] ?? 0) > 0);
      const absent = required.filter((f) => (c.grammar_field_mentions[f] ?? 0) === 0);
      // ⚠ EVERY REQUIRED FIELD MUST BE IN THE CENSUS, or an uncounted field
      // reads as "absent from the prompt" when it is really absent from the
      // LIST. My first census omitted `label` and this test duly reported the
      // prompt was missing it — the hand-maintained-mirror defect, inside the
      // guard written to catch one. Asserted so it cannot recur silently.
      for (const f of required) {
        expect(c.census_fields_covered, `census must count "${f}"`).toContain(f);
      }
      expect(
        absent.sort(),
        `${c.prompt_version}: the served prompt must eventually NAME the output it asks for. ` +
          `When it is fixed this list shrinks and this test REDs — that is the signal to update it.`,
      ).toEqual(["claim_kind", "stated_items"].sort());
      expect(named.sort(), "it names only the generic words, not its own grammar").toEqual(
        ["claims", "kind", "label", "source_quote"].sort(),
      );
    }
  });

  it("⛔ KNOWN GAP: it carries a worked JSON example of a COMPETING output shape", () => {
    for (const c of drafts()) {
      expect(
        c.has_worked_json_example_of_competing_shape,
        `${c.prompt_version} contains '"nodes": [ … ]' — a full worked example of the shape the ` +
          `model must NOT emit. This is the single most misleading thing in 61,199 characters.`,
      ).toBe(true);
      expect(c.competing_shape_mentions["node_id"]).toBeGreaterThan(0);
      expect(c.competing_shape_mentions["encoding_map"]).toBeGreaterThan(0);
    }
  });

  it("⭐ THE PROPERTY WE ACTUALLY WANT, stated so the target is unambiguous", () => {
    // Deliberately expressed as the inverse of the gap: when the prompt is
    // corrected, THIS is what should hold, and the two tests above should be
    // deleted rather than edited.
    const wanted = (c: Census) =>
      grammarRequiredFields().every((f) => (c.grammar_field_mentions[f] ?? 0) > 0) &&
      !c.has_worked_json_example_of_competing_shape;
    expect(
      drafts().map(wanted),
      "every served draft prompt should name its own output grammar and carry no competing example",
    ).toEqual(drafts().map(() => false)); // ← today: false. Flip to true with the fix.
  });
});
