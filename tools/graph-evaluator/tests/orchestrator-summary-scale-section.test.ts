/**
 * The run summary must SHOW unattested scale renders.
 *
 * A diagnostic the scorer computes but the report never prints is a diagnostic
 * nobody will act on. These tests render the real summary and assert on its
 * markdown, so the reporting surface is witnessed rather than assumed.
 *
 * ⛔ Reported, NOT enforced — see `orchestrator-scale-attestation.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  generateOrchestratorSummary,
  type OrchestratorScoredResult,
} from "../src/orchestrator-summary.js";
import type { RunConfig, ScaleConversionRecord } from "../src/types.js";

const config = {
  run_id: "test-run",
  prompt_file: "prompts/orchestrator_v30.5.txt",
  prompt_type: "orchestrator",
} as unknown as RunConfig;

function makeResult(
  fixtureId: string,
  scale_conversions: ScaleConversionRecord[] | undefined
): OrchestratorScoredResult {
  return {
    fixture_id: fixtureId,
    model: { id: "gpt-4o" },
    prompt_type: "orchestrator",
    response: { latency_ms: 1200 },
    score: {
      overall: 1,
      dimensions: {
        valid_json: true,
        text_quality: true,
        insight_compliance: true,
        action_eligibility: true,
        fabrication_check: true,
        banned_terms: true,
        scenario_specific: true,
      },
      scale_conversions,
    },
  } as unknown as OrchestratorScoredResult;
}

const UNATTESTED: ScaleConversionRecord = {
  rendered: "50%",
  rendered_value: 50,
  source_value: 0.5,
  source_ref: "factor:fac_retention",
  attestation: "unattested",
};

/**
 * Pull the DATA ROWS out of the section's markdown table.
 *
 * ⚠ Why this exists, and it is the point of the whole file: the section's own
 * explanatory prose contains "A unitless `0.5` shown as `50%`". A bare
 * `expect(md).toContain("`0.5`")` therefore passes off the PROSE and says
 * nothing about the table — proven by a mutant that deleted the source-value
 * column and left the suite green. Assertions here bind to the row.
 */
function scaleTableRows(md: string): string[] {
  const section = md.split("## Unattested Scale Renders")[1] ?? "";
  return section
    .split("\n")
    .filter((l) => l.trimStart().startsWith("|"))
    .filter((l) => !/^\|\s*-{2,}/.test(l.trim()))       // separator
    .filter((l) => !l.includes("Source value"));         // header
}

describe("run summary — unattested scale renders section", () => {
  it("prints a row naming the render, the source value and the factor behind it", () => {
    const md = generateOrchestratorSummary(
      [makeResult("03-explain-results", [UNATTESTED])],
      config,
      "hash123",
      false
    );

    expect(md).toContain("## Unattested Scale Renders (diagnostic — not scored)");

    const rows = scaleTableRows(md);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // The facts a reader needs in order to act, asserted ON THE ROW: what was
    // shown, what it came from, which entity supplied it, and why it counts.
    expect(row).toContain("`50%`");
    expect(row).toContain("`0.5`");
    expect(row).toContain("`factor:fac_retention`");
    expect(row).toContain("unattested");
    expect(row).toContain("03-explain-results");

    expect(md).toContain("**1** unattested render(s) across **1** of **1** scored response(s)");
  });

  it("gives every record its own row", () => {
    const md = generateOrchestratorSummary(
      [
        makeResult("case-a", [
          UNATTESTED,
          {
            rendered: "35%",
            rendered_value: 35,
            source_value: 0.35,
            source_ref: "top_driver:fac_cost.sensitivity",
            attestation: "unattested",
          },
        ]),
      ],
      config,
      "hash123",
      false
    );

    const rows = scaleTableRows(md);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("`35%`");
    expect(rows[1]).toContain("`0.35`");
    expect(rows[1]).toContain("`top_driver:fac_cost.sensitivity`");
  });

  it("distinguishes MEASURED-AND-CLEAN from NOT-MEASURED", () => {
    // Measured, none found: the diagnostic ran and reported an empty array.
    const clean = generateOrchestratorSummary(
      [makeResult("03-explain-results", [])],
      config,
      "hash123",
      false
    );
    expect(clean).toContain("None detected across this run.");
    expect(clean).not.toContain("NOT MEASURED");

    // Not measured: no result carried the field at all. This must NOT be
    // reported as a clean run — the whole point of printing the zero case.
    const unmeasured = generateOrchestratorSummary(
      [makeResult("03-explain-results", undefined)],
      config,
      "hash123",
      false
    );
    expect(unmeasured).toContain("NOT MEASURED");
    expect(unmeasured).not.toContain("None detected across this run.");
  });

  it("counts affected responses, not just records", () => {
    const md = generateOrchestratorSummary(
      [
        makeResult("case-a", [UNATTESTED, { ...UNATTESTED, rendered: "60%", rendered_value: 60, source_value: 0.6 }]),
        makeResult("case-b", []),
        makeResult("case-c", []),
      ],
      config,
      "hash123",
      false
    );
    // 2 records, but only 1 of 3 responses affected — a reader needs both.
    expect(md).toContain("**2** unattested render(s) across **1** of **3** scored response(s)");
  });

  it("leaves the structural scores table free of the diagnostic", () => {
    // The diagnostic must never read as a scored dimension.
    const md = generateOrchestratorSummary(
      [makeResult("03-explain-results", [UNATTESTED])],
      config,
      "hash123",
      false
    );
    const structural = md.split("## Unattested Scale Renders")[0];
    expect(structural).toContain("## Structural Scores");
    expect(structural).not.toContain("scale_conversions");
  });
});
