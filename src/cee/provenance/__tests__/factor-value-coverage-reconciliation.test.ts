/**
 * ROADMAP 2.972(b) — THE COUNTER AND THE BADGE MUST NOT BE ABLE TO DISAGREE.
 *
 * THE MEASURED DEFECT, in one payload from deployed staging 2026-08-08:
 *
 *   trace.pipeline.factor_value_coverage  →  { total: 11, explicit: 0, … }
 *   graph.nodes[fac_nrr]                  →  { extractionType: "explicit",
 *                                              provenance: "from_brief" }
 *
 * Both were reading "did this factor's value come from the brief?", and they
 * answered differently about the same node in the same response. The
 * mechanism was a hand-maintained mirror (CLAUDE.md trap 12): the counter read
 * `node.data.extractionType` only, the badge read
 * `observed_state.extractionType ?? node.extractionType ?? data.extractionType`,
 * and the `unreachable-factors` repair moves the field from the first location
 * to the second while deleting the value.
 *
 * This suite pins the MECHANISM, not just the outcome — the three field
 * locations must classify identically, and the value conjunct must bite.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  classifyFactorValueTier,
  factorHasExtractedValue,
  mayClaimFromBrief,
  readFactorValueView,
} from "../factor-value-provenance.js";
import { MEASURED_FACTOR_NODES } from "./fixtures/trace-captures.js";

describe("2.972(b) one derivation, three field locations", () => {
  it("classifies the same fact identically wherever the pipeline has moved the field", () => {
    // The exact drift the repair stage produces: `data.extractionType` before
    // it runs, node-level `extractionType` after. A counter that reads only
    // one of these is blind on the other side of a repair.
    const inData = { kind: "factor", data: { value: 0.3, extractionType: "explicit" } };
    const promotedToNode = { kind: "factor", extractionType: "explicit", observed_state: { value: 0.3 } };
    const inObservedState = { kind: "factor", observed_state: { value: 0.3, extractionType: "explicit" } };

    expect(classifyFactorValueTier(inData)).toBe("explicit");
    expect(classifyFactorValueTier(promotedToNode)).toBe("explicit");
    expect(classifyFactorValueTier(inObservedState)).toBe("explicit");
  });

  it("refuses `explicit` once the repair has stripped the value — fac_nrr's exact shape", () => {
    // `unreachable-factors` reclassifies to external, DELETES data.value and
    // PROMOTES data.extractionType. What is left claims explicit extraction
    // while carrying a maximum-ignorance prior and no value.
    const afterRepair = {
      id: "fac_nrr",
      kind: "factor",
      category: "external",
      extractionType: "explicit",
      prior: { distribution: "uniform", range_min: 0, range_max: 1 },
    };
    expect(factorHasExtractedValue(afterRepair)).toBe(false);
    expect(classifyFactorValueTier(afterRepair)).toBe("fallback_default");
    expect(mayClaimFromBrief(afterRepair)).toBe(false);
  });

  it("KEEPS `explicit` for the same label WHEN a value is present (the discriminating pair)", () => {
    const withValue = {
      id: "fac_nrr",
      kind: "factor",
      extractionType: "explicit",
      observed_state: { value: 1.12, unit: "%" },
    };
    expect(classifyFactorValueTier(withValue)).toBe("explicit");
    expect(mayClaimFromBrief(withValue)).toBe(true);
  });

  it("preserves the two non-explicit rungs exactly as the pipeline declared them", () => {
    // Transcribed from `factor_value_coverage`'s own comment, not from this
    // author's reading of what the field ought to mean (trap 13c).
    expect(classifyFactorValueTier({ data: { value: 0.2, extractionType: "inferred" } })).toBe(
      "inferred_with_evidence",
    );
    expect(classifyFactorValueTier({ data: { value: 0.5, extractionType: "inferred" } })).toBe(
      "fallback_default",
    );
    expect(classifyFactorValueTier({ data: { value: 0.2 } })).toBe("fallback_default");
    expect(classifyFactorValueTier({})).toBe("fallback_default");
    expect(classifyFactorValueTier(null)).toBe("fallback_default");
    expect(classifyFactorValueTier({ data: { value: 0.3, extractionType: "observed" } })).toBe("explicit");
  });

  it("no captured factor that shipped `from_brief` without a value may still claim it", () => {
    // Bound to the wire, by node identity. B1's fac_nrr is the named instance;
    // the loop is here so a second one cannot appear unnoticed.
    const offenders = MEASURED_FACTOR_NODES.filter(
      (f) => f.observedProvenance === "from_brief" && f.observedValue === undefined,
    );
    expect(offenders.map((f) => `${f.brief}:${f.id}`)).toContain("B1:fac_nrr");
    for (const f of offenders) {
      const node = {
        id: f.id,
        kind: "factor",
        ...(f.category !== undefined && { category: f.category }),
        ...(f.observedExtractionType !== undefined && { extractionType: f.observedExtractionType }),
        ...(f.prior !== undefined && { prior: f.prior }),
      };
      expect(mayClaimFromBrief(node), `${f.brief}:${f.id} still claims from_brief`).toBe(false);
    }
  });

  it("the pipeline counter has no INDEPENDENT extractionType read left in it", () => {
    // The derived half (CLAUDE.md trap 12d). The behavioural cases above pin
    // the shared function; NOTHING behavioural can see the counter quietly
    // re-inlining its own `f.data?.extractionType` read, because that is the
    // exact shape it had when it disagreed with the badge. This guard reads
    // the production file and REDs when it does.
    const source = readFileSync(
      resolve(process.cwd(), "src/cee/unified-pipeline/index.ts"),
      "utf8",
    );
    expect(source).toContain("classifyFactorValueTier");

    const start = source.indexOf("ctx.pipelineOutcome.factor_value_coverage");
    expect(start, "the factor_value_coverage assignment moved or was renamed").toBeGreaterThan(-1);
    // The 40 lines above the assignment are the counting loop.
    const block = source.slice(Math.max(0, source.lastIndexOf("const factors =", start)), start);
    expect(block).toContain("classifyFactorValueTier(");
    const codeOnly = block
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    expect(
      /extractionType/.test(codeOnly),
      "the coverage loop reads extractionType directly again — that is the mirror this row removed",
    ).toBe(false);
  });

  it("reads the value view without throwing on any shape", () => {
    expect(readFactorValueView(undefined)).toEqual({});
    expect(readFactorValueView("not a node")).toEqual({});
    expect(readFactorValueView({ observed_state: { value: Number.NaN } })).toEqual({});
    expect(readFactorValueView({ data: { value: 7, extractionType: "explicit" } })).toEqual({
      value: 7,
      extractionType: "explicit",
    });
  });
});
