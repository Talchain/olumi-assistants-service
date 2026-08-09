/**
 * ROADMAP 2.996 — multi-document draft selection.
 *
 * `extractJsonFromResponse` takes the FIRST JSON document in a model response.
 * On the no-structured-outputs draft path the model frequently emits a
 * deliberately-partial first object, then prose, then a SECOND complete object
 * (7 of 15 samples in the 2026-08-09 arm-D captures). The first-document rule
 * discards the finished graph.
 *
 * The fix is an OPT-IN `acceptDocument` predicate. The core extraction
 * algorithm is unchanged and runs first; a later document is only ever
 * consulted when the core result is REJECTED by the caller's predicate.
 *
 * Corpus provenance: `tests/fixtures/multi-document-draft-2026-08-09/` — raw
 * response bodies captured from the wire on 2026-08-09 (arm D,
 * claude-sonnet-5, structured outputs OFF). ONE lane's session, n=15.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { extractJsonFromResponse } from "../../src/utils/json-extractor.js";

const FIXTURES = join(__dirname, "../fixtures/multi-document-draft-2026-08-09");
const capture = (n: number): string => readFileSync(join(FIXTURES, `armD-${n}.txt`), "utf8");

/** Identity of a parsed document — no OTHER document can satisfy this. */
const identity = (doc: unknown): string =>
  createHash("sha256").update(JSON.stringify(doc)).digest("hex").slice(0, 16);

/** Real captures that contain exactly ONE top-level document. */
const SINGLE_DOCUMENT_CAPTURES = [1, 3, 5, 7, 8, 9, 11, 14];
/** Real captures that contain a partial first document and a complete second. */
const MULTI_DOCUMENT_CAPTURES = [0, 2, 4, 6, 10, 12, 13];

/** Accepts any object carrying a non-empty `edges` array. Deliberately NOT the
 *  product predicate — these tests exercise the SELECTION MECHANISM only. */
const acceptsGraphWithEdges = (json: unknown): boolean => {
  const o = json as { edges?: unknown };
  return Array.isArray(o?.edges) && o.edges.length > 0;
};

describe("extractJsonFromResponse — multi-document selection (2.996)", () => {
  describe("rescue: a later document is selected when the first is rejected", () => {
    it.each(MULTI_DOCUMENT_CAPTURES)(
      "armD-%i: selects the second document, bound by content identity",
      (n) => {
        const raw = capture(n);
        const withoutSelector = extractJsonFromResponse(raw, { logWarnings: false });
        const withSelector = extractJsonFromResponse(raw, {
          logWarnings: false,
          acceptDocument: acceptsGraphWithEdges,
        });

        // The current (first-document) result is the one we are displacing.
        expect(acceptsGraphWithEdges(withoutSelector.json)).toBe(false);

        // The selected document is a DIFFERENT document, identified by hash.
        expect(identity(withSelector.json)).not.toBe(identity(withoutSelector.json));
        expect(acceptsGraphWithEdges(withSelector.json)).toBe(true);
        expect(withSelector.documentIndex).toBe(1);
        expect(withSelector.extractionMethod).toBe("document_selection");
      },
    );
  });

  describe("the chooser never displaces an accepted first document", () => {
    it("returns the FIRST document when BOTH it and a later document are acceptable", () => {
      // NB the name: both documents here are COMPLETE and both are acceptable.
      // This pins the short-circuit — an accepted first document is not even
      // compared against later candidates. The genuinely-truncated case is the
      // test below; keeping them apart matters, because only ONE of them can
      // see a reversed scan order (see the mutant kit's M1 vs M1b).
      const first = { nodes: [{ id: "a" }], edges: [{ from: "a", to: "b" }], marker: "FIRST" };
      const second = { nodes: [{ id: "a" }], edges: [{ from: "a", to: "b" }], marker: "SECOND" };
      const raw = `${JSON.stringify(first)}\n\nActually, let me redo that.\n\n${JSON.stringify(second)}`;

      const result = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: acceptsGraphWithEdges,
      });
      expect(identity(result.json)).toBe(identity(first));
      expect((result.json as { marker: string }).marker).toBe("FIRST");
      expect(result.documentIndex).toBeUndefined();
    });

    it("NEVER selects a TRUNCATED later document, even when the first is rejected", () => {
      // This is the truncation case that can actually go wrong, and it is the
      // direction that matters: the first document is REJECTED, so the selector
      // does look further — and the only thing after it is a cut-off tail.
      // Today the tail is not a document at all and the core result stands.
      //
      // The hazard is concrete, not hypothetical: `closeTruncatedJson` lives in
      // this same module and already salvages cut-off drafts elsewhere. Wiring
      // it into enumeration would make this tail "acceptable" and silently
      // promote PARTIAL data over the model's stated first answer.
      const first = { nodes: [], edges: [], marker: "FIRST" };
      // Cut AFTER a complete edge, so a salvage would yield an acceptable graph.
      const truncatedTail = `{"nodes":[{"id":"a"}],"edges":[{"from":"a","to":"b"},{"from":"a","to`;
      const raw = `${JSON.stringify(first)}\n\nLet me expand that:\n\n${truncatedTail}`;

      // PRECONDITIONS pinned in-test, so this cannot quietly stop discriminating:
      // the tail is genuinely unparseable, and the first document is genuinely
      // rejected (otherwise the short-circuit would make the test vacuous).
      expect(() => JSON.parse(truncatedTail)).toThrow();
      expect(acceptsGraphWithEdges(first)).toBe(false);

      const result = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: acceptsGraphWithEdges,
      });
      expect(identity(result.json)).toBe(identity(first));
      expect((result.json as { marker: string }).marker).toBe("FIRST");
      expect(result.documentIndex).toBeUndefined();
    });

    it("does not call the predicate on any later document once the first is accepted", () => {
      const doc = { nodes: [], edges: [{ from: "a", to: "b" }] };
      const raw = `${JSON.stringify(doc)}\n{"nodes":[],"edges":[{"from":"x","to":"y"}]}`;
      const seen: unknown[] = [];
      extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: (j) => {
          seen.push(j);
          return acceptsGraphWithEdges(j);
        },
      });
      expect(seen).toHaveLength(1);
    });
  });

  describe("fallback: when NO document is accepted, today's result is returned", () => {
    it("returns the first document verbatim when every document is rejected", () => {
      const raw = capture(0);
      const withoutSelector = extractJsonFromResponse(raw, { logWarnings: false });
      const withSelector = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: () => false,
      });
      expect(withSelector).toEqual(withoutSelector);
    });

    it("selects the first ACCEPTED document, not the last, across three documents", () => {
      const bad1 = { nodes: [], edges: [], marker: "BAD1" };
      const good = { nodes: [], edges: [{ from: "a", to: "b" }], marker: "GOOD" };
      const bad2 = { nodes: [], edges: [], marker: "BAD2" };
      const raw = [bad1, good, bad2].map((d) => JSON.stringify(d)).join("\n---\n");
      const result = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: acceptsGraphWithEdges,
      });
      expect(identity(result.json)).toBe(identity(good));
      expect(result.documentIndex).toBe(1);
    });

    it("when SEVERAL later documents are acceptable, the EARLIEST wins", () => {
      // Without this, a "last acceptable document wins" chooser is
      // indistinguishable from this one on every other test in the file:
      // reversing the scan order still lands on the same document whenever
      // exactly one candidate is acceptable.
      const rejected = { nodes: [], edges: [], marker: "REJECTED" };
      const earliest = { nodes: [], edges: [{ from: "a", to: "b" }], marker: "EARLIEST" };
      const latest = { nodes: [], edges: [{ from: "c", to: "d" }], marker: "LATEST" };
      const raw = [rejected, earliest, latest].map((d) => JSON.stringify(d)).join("\nprose\n");
      const result = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: acceptsGraphWithEdges,
      });
      expect(identity(result.json)).toBe(identity(earliest));
      expect((result.json as { marker: string }).marker).toBe("EARLIEST");
      expect(result.documentIndex).toBe(1);
    });
  });

  describe("single-document responses are unchanged (absence claim)", () => {
    // The claim: supplying a selector cannot alter the result for a response
    // that contains exactly one top-level document. Asserted on the WHOLE
    // result object, over real captures AND over each extraction method.
    const SYNTHETIC_SINGLE_DOCUMENTS: Array<[string, string]> = [
      ["fast_path", `{"nodes":[],"edges":[]}`],
      ["code_block", "Here you go:\n```json\n{\"nodes\":[],\"edges\":[]}\n```"],
      ["boundary_with_suffix", `{"nodes":[],"edges":[]}\n\nHope that helps!`],
      ["bracket_matching_preamble", `Use {foo} carefully. {"nodes":[],"edges":[]}`],
      ["array_document", `[1,2,3]`],
    ];

    it.each(SINGLE_DOCUMENT_CAPTURES)("real capture armD-%i is byte-identical", (n) => {
      const raw = capture(n);
      const withSelector = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: acceptsGraphWithEdges,
      });
      expect(withSelector).toEqual(extractJsonFromResponse(raw, { logWarnings: false }));
    });

    it.each(SYNTHETIC_SINGLE_DOCUMENTS)("%s extraction is byte-identical", (_name, raw) => {
      const withSelector = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: acceptsGraphWithEdges,
      });
      expect(withSelector).toEqual(extractJsonFromResponse(raw, { logWarnings: false }));
    });

    it("POSITIVE CONTROL: the comparison above CAN see a difference", () => {
      // If the comparison were vacuous — e.g. the selector silently ignored —
      // this assertion would fail, and every "byte-identical" claim above
      // would be worthless (trap 13).
      const raw = capture(0);
      const withSelector = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: acceptsGraphWithEdges,
      });
      expect(withSelector).not.toEqual(extractJsonFromResponse(raw, { logWarnings: false }));
    });
  });

  describe("bounded cost", () => {
    it("evaluates at most MAX_SELECTABLE_DOCUMENTS candidates", () => {
      const doc = `{"nodes":[],"edges":[]}`;
      const raw = Array.from({ length: 40 }, () => doc).join("\nprose\n");
      let calls = 0;
      extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: () => {
          calls++;
          return false;
        },
      });
      expect(calls).toBeGreaterThan(1);
      expect(calls).toBeLessThanOrEqual(8);
    });

    it("a predicate that throws is treated as a rejection, never propagated", () => {
      const raw = capture(0);
      const result = extractJsonFromResponse(raw, {
        logWarnings: false,
        acceptDocument: () => {
          throw new Error("predicate exploded");
        },
      });
      expect(result).toEqual(extractJsonFromResponse(raw, { logWarnings: false }));
    });
  });
});
