import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SAME-NAMED SYMBOL TWINS IN `src/schemas/` — a DERIVED guard over an EXPLICIT
 * known set.
 *
 * ⚠ WHY A KNOWN SET AND NOT "ZERO". Measured at 3ab35d34, `src/schemas/*.ts`
 * carried SIX duplicate exported names, not one. A "zero twins" assertion would
 * therefore RED for five reasons this lane never examined — which is a guard
 * claiming credit for work nobody did. The honest shape is the one this estate
 * already uses for known gaps: pin the EXACT set, and RED if it GROWS **or**
 * SHRINKS. A gap recorded in the suite is honest; a gap invisible to it is how
 * the class reopens.
 *
 * ⚠ THE FIVE REMAINING ENTRIES ARE RECORDED, NOT BLESSED. Nobody has derived
 * whether each pair is one concept split in two (fix: converge) or two concepts
 * sharing a name (fix: rename apart). Do not "tidy" one away without that
 * derivation — and when you do fix one, DELETE ITS LINE HERE in the same commit,
 * which is what makes the shrink-side assertion bite.
 *
 * `ProvenanceSource` was removed from this set by the C4 lane. The two
 * declarations answered DIFFERENT QUESTIONS — `graph.ts` "how was this graph
 * datum obtained?" (evidence kind on a node/edge) vs `working-set.ts` "which
 * subsystem contributed to this response?" (attribution on an ask response).
 * Zero files referenced both. They were therefore RENAMED APART, never merged:
 * merging two answers to different questions is the defect, not the fix.
 */
const KNOWN_SCHEMA_SYMBOL_TWINS: Readonly<Record<string, readonly string[]>> = {
  ConstraintOperator: ["graph.ts", "llmExtraction.ts"],
  RawInterventionValue: ["analysis-ready.ts", "cee-v3.ts"],
  RawInterventionValueT: ["analysis-ready.ts", "cee-v3.ts"],
  ReadinessFactors: ["assist.ts", "review.ts"],
  SafeRequestId: ["review.ts", "working-set.ts"],
};

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every exported declaration name in a file, DERIVED from its bytes. */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  const re = /^export\s+(?:declare\s+)?(?:const|let|type|interface|enum|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of source.matchAll(re)) names.push(m[1]);
  return names;
}

function deriveTwins(): Record<string, string[]> {
  const byName = new Map<string, Set<string>>();
  for (const file of readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join(SCHEMAS_DIR, file), "utf8");
    for (const name of exportedNames(source)) {
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(file);
    }
  }
  const twins: Record<string, string[]> = {};
  for (const [name, files] of byName) {
    if (files.size > 1) twins[name] = [...files].sort();
  }
  return twins;
}

describe("src/schemas symbol twins — pinned to an exact known set", () => {
  it("the scanner can SEE exported declarations (positive control)", () => {
    // An absence/equality assertion is vacuous unless the instrument is shown
    // to detect a presence. `graph.ts` is known to export many symbols.
    const graph = readFileSync(join(SCHEMAS_DIR, "graph.ts"), "utf8");
    const found = exportedNames(graph);
    expect(found.length).toBeGreaterThan(20);
    expect(found).toContain("NodeKind");
  });

  it("the scanner DISCRIMINATES between files (contrast control)", () => {
    // If the scanner silently returned the same answer for every file, the
    // equality assertion below would agree with itself. Two different files
    // must yield different export sets.
    const graph = new Set(exportedNames(readFileSync(join(SCHEMAS_DIR, "graph.ts"), "utf8")));
    const workingSet = new Set(exportedNames(readFileSync(join(SCHEMAS_DIR, "working-set.ts"), "utf8")));
    expect(graph).not.toEqual(workingSet);
    expect([...graph].some((n) => !workingSet.has(n))).toBe(true);
  });

  it("carries EXACTLY the known twins — REDs if the set grows OR shrinks", () => {
    expect(deriveTwins()).toEqual(KNOWN_SCHEMA_SYMBOL_TWINS);
  });

  it("no longer declares ProvenanceSource in two files (the C4 deletion)", () => {
    expect(Object.keys(deriveTwins())).not.toContain("ProvenanceSource");
  });

  it("declares the two renamed concepts exactly once each", () => {
    const graph = exportedNames(readFileSync(join(SCHEMAS_DIR, "graph.ts"), "utf8"));
    const workingSet = exportedNames(readFileSync(join(SCHEMAS_DIR, "working-set.ts"), "utf8"));
    expect(graph.filter((n) => n === "GraphEvidenceSource")).toHaveLength(1);
    expect(workingSet.filter((n) => n === "ResponseAttributionSource")).toHaveLength(1);
    // opposite-direction twin: the old name must be gone from BOTH, not moved.
    expect(graph).not.toContain("ProvenanceSource");
    expect(workingSet).not.toContain("ProvenanceSource");
  });
});
