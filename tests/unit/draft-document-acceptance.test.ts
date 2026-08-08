/**
 * ROADMAP 2.996 — the draft acceptance predicate + the arm-D corpus measure.
 *
 * `isUsableDraftDocument` composes the SAME authorities the draft path already
 * runs immediately after extraction (anthropic.ts):
 *   stripModelAuthoredGoalThreshold → normaliseDraftResponse →
 *   ensureControllableFactorBaselines → LLMDraftResponse.safeParse →
 *   validateGraph(...).valid
 * It invents no second definition of "a good graph" (trap 21).
 *
 * Corpus: `tests/fixtures/multi-document-draft-2026-08-09/` — raw response
 * bodies from the wire, 2026-08-09, arm D (claude-sonnet-5, structured outputs
 * OFF), n=15. ONE lane's session; the numbers below are that corpus's, not a
 * population estimate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { extractJsonFromResponse } from "../../src/utils/json-extractor.js";
import { isUsableDraftDocument } from "../../src/adapters/llm/draft-document-acceptance.js";

const FIXTURES = join(__dirname, "../fixtures/multi-document-draft-2026-08-09");
const capture = (n: number): string => readFileSync(join(FIXTURES, `armD-${n}.txt`), "utf8");
const identity = (doc: unknown): string =>
  createHash("sha256").update(JSON.stringify(doc)).digest("hex").slice(0, 16);

/**
 * DERIVED from the corpus on 2026-08-09 and pinned here BY IDENTITY.
 * `sha256_16` is the hash of the document the fixed extractor must choose —
 * no other document in that response can satisfy it (trap 19).
 */
const EXPECTED = {
  0: { firstUsable: false, documentIndex: 1, nodes: 17, edges: 29, sha256_16: "33de626485c81bb4" },
  1: { firstUsable: false, documentIndex: undefined, nodes: 5, edges: -1, sha256_16: "dc7843376e16f195" },
  2: { firstUsable: false, documentIndex: 1, nodes: 17, edges: 29, sha256_16: "309cf2864f508e36" },
  3: { firstUsable: true, documentIndex: undefined, nodes: 15, edges: 27, sha256_16: "97982736722b77c0" },
  4: { firstUsable: false, documentIndex: 1, nodes: 17, edges: 31, sha256_16: "4cb65ab00bc310ab" },
  5: { firstUsable: true, documentIndex: undefined, nodes: 17, edges: 30, sha256_16: "ed199d95d0f199e8" },
  6: { firstUsable: false, documentIndex: 1, nodes: 17, edges: 27, sha256_16: "184fc8b221a5e3b5" },
  7: { firstUsable: true, documentIndex: undefined, nodes: 16, edges: 30, sha256_16: "da9873010a2a51b2" },
  8: { firstUsable: true, documentIndex: undefined, nodes: 17, edges: 29, sha256_16: "cf820ef6aa7d01a5" },
  9: { firstUsable: true, documentIndex: undefined, nodes: 16, edges: 26, sha256_16: "d785f26cf30be2fb" },
  10: { firstUsable: false, documentIndex: 1, nodes: 17, edges: 29, sha256_16: "0c6b44868982d180" },
  11: { firstUsable: true, documentIndex: undefined, nodes: 16, edges: 29, sha256_16: "02f3613849684127" },
  12: { firstUsable: false, documentIndex: 1, nodes: 17, edges: 31, sha256_16: "c682c966739bb1d8" },
  13: { firstUsable: false, documentIndex: 1, nodes: 17, edges: 27, sha256_16: "d5174e1f9770df66" },
  14: { firstUsable: true, documentIndex: undefined, nodes: 16, edges: 28, sha256_16: "21e3f5f5422a77c3" },
} as const;

const SAMPLES = Object.keys(EXPECTED).map(Number);

describe("isUsableDraftDocument", () => {
  it("accepts a complete draft document from a real capture", () => {
    const doc = extractJsonFromResponse(capture(3), { logWarnings: false }).json;
    expect(isUsableDraftDocument(doc)).toBe(true);
  });

  it("rejects the deliberately-partial FIRST document of a real capture", () => {
    const doc = extractJsonFromResponse(capture(0), { logWarnings: false }).json;
    expect((doc as { nodes: unknown[] }).nodes).toHaveLength(5);
    expect(isUsableDraftDocument(doc)).toBe(false);
  });

  it("returns false (never throws) for a document with no `edges` key at all", () => {
    // armD-1: the model invented `edges_placeholder` / `nodes_continued_note`
    // instead of emitting a second document. `validateGraph` alone THROWS on
    // this shape ("Cannot read properties of undefined") — the schema parse in
    // front of it is what makes the predicate total.
    const doc = extractJsonFromResponse(capture(1), { logWarnings: false }).json as Record<string, unknown>;
    expect(doc.edges).toBeUndefined();
    expect(doc.edges_placeholder).toBeDefined();
    expect(isUsableDraftDocument(doc)).toBe(false);
  });

  it("returns false for non-objects and for junk", () => {
    expect(isUsableDraftDocument(null)).toBe(false);
    expect(isUsableDraftDocument(42)).toBe(false);
    expect(isUsableDraftDocument([])).toBe(false);
    expect(isUsableDraftDocument({ nodes: "not an array" })).toBe(false);
  });

  it("does NOT mutate the document it inspects", () => {
    // The pipeline re-runs normalisation on the chosen document. Normalisation
    // mutates in place, so the predicate must score a CLONE.
    const doc = extractJsonFromResponse(capture(3), { logWarnings: false }).json;
    const before = JSON.stringify(doc);
    isUsableDraftDocument(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("arm-D corpus — acceptance measure (2.996)", () => {
  const extractToday = (n: number) => extractJsonFromResponse(capture(n), { logWarnings: false });
  const extractFixed = (n: number) =>
    extractJsonFromResponse(capture(n), { logWarnings: false, acceptDocument: isUsableDraftDocument });

  it("BEFORE: 7 of 15 captures yield a usable draft (first-document rule)", () => {
    const usable = SAMPLES.filter((n) => isUsableDraftDocument(extractToday(n).json));
    expect(usable).toEqual([3, 5, 7, 8, 9, 11, 14]);
    expect(usable).toHaveLength(7);
  });

  it("AFTER: 14 of 15 captures yield a usable draft (first-usable-document rule)", () => {
    const usable = SAMPLES.filter((n) => isUsableDraftDocument(extractFixed(n).json));
    expect(usable).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(usable).toHaveLength(14);
  });

  it("the one capture that stays unusable is the placeholder-key drift (armD-1), OUT OF SCOPE", () => {
    expect(isUsableDraftDocument(extractFixed(1).json)).toBe(false);
    // Not a multi-document response: nothing to select between.
    expect(extractFixed(1)).toEqual(extractToday(1));
  });

  it.each(SAMPLES)("armD-%i selects the expected document BY IDENTITY", (n) => {
    const e = EXPECTED[n as keyof typeof EXPECTED];
    const today = extractToday(n);
    const fixed = extractFixed(n);

    expect(isUsableDraftDocument(today.json)).toBe(e.firstUsable);
    expect(fixed.documentIndex).toBe(e.documentIndex);
    expect(identity(fixed.json)).toBe(e.sha256_16);

    const chosen = fixed.json as { nodes?: unknown[]; edges?: unknown[] };
    expect(chosen.nodes).toHaveLength(e.nodes);
    if (e.edges >= 0) expect(chosen.edges).toHaveLength(e.edges);
    else expect(chosen.edges).toBeUndefined();
  });

  it("every capture whose first document is already usable is returned UNCHANGED", () => {
    for (const n of SAMPLES) {
      if (!EXPECTED[n as keyof typeof EXPECTED].firstUsable) continue;
      expect(extractFixed(n)).toEqual(extractToday(n));
    }
  });
});
