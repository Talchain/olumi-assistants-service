/**
 * ROADMAP 2.996 follow-up — THE DOCUMENT PROBE LOOP IS BOUNDED, AND THE
 * REDUNDANT BUDGET IS GONE.
 *
 * ── THE COST ───────────────────────────────────────────────────────────────
 * `enumerateTopLevelJsonDocuments` advances one character at a time and, at
 * every `{` or `[`, runs the full bracket matcher. On a run of consecutive
 * UNMATCHED `{` that is quadratic. Measured on this tip, in isolation:
 *
 *     4,000 `{`  ->  25.5 ms
 *     8,000 `{`  -> 101.7 ms      (x4.0 for x2 input)
 *    16,000 `{`  -> 436.1 ms      (x4.3 for x2 input)
 *
 * A response is model output on a request path, so its length is not ours to
 * choose. The bound below caps the pathological case.
 *
 * ⚠ AND IT CAPS THE REGRESSION, NOT THE HAZARD — stated plainly because the
 * honest number is the less flattering one. The PRE-EXISTING core scan
 * (`extractJson`'s own candidate walk) is the larger half of the cost at that
 * input size; bounding this loop stops the SELECTOR adding to it and does not
 * make the core cheap. That is a separate, rowed piece of work.
 *
 * ── THE BOUND IS INERT ON REAL DATA ────────────────────────────────────────
 * A "failed probe" is a `{`/`[` whose bracket match does not parse — i.e.
 * brace-bearing prose. Real multi-document responses need ZERO of them before
 * each document, which is what makes 64 a bound nobody reaches rather than a
 * behaviour change. The arms below pin both edges of the cliff.
 */

import { describe, it, expect } from "vitest";

import {
  enumerateTopLevelJsonDocuments,
  extractJsonFromResponse,
  MAX_SELECTABLE_DOCUMENTS,
} from "../json-extractor.js";

/** The declared bound. Imported nowhere else — asserted, not assumed. */
const FAILED_PROBE_LIMIT = 64;

describe("the probe loop is bounded on consecutive unmatched brackets", () => {
  it("PRECONDITION — an unmatched `{` really is a FAILED probe, not a parsed document", () => {
    // Trap 13: prove the instrument can see a presence before asserting an
    // absence. If `{{{…` somehow parsed, every arm below would be vacuous.
    expect(enumerateTopLevelJsonDocuments("{".repeat(10))).toEqual([]);
    expect(enumerateTopLevelJsonDocuments('{"a":1}')).toHaveLength(1);
  });

  it("a document behind FEWER than the limit of failed probes is still found", () => {
    // The GREEN half of the discriminating pair: the bound must not fire early.
    const text = "{".repeat(FAILED_PROBE_LIMIT - 1) + '{"a":1}';
    const docs = enumerateTopLevelJsonDocuments(text);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.json).toEqual({ a: 1 });
  });

  it("a document behind MORE than the limit of failed probes is given up on", () => {
    // The RED half. This is the deliberate cost of the bound, and it is
    // asserted rather than left implicit so the trade is visible in the record.
    const text = "{".repeat(FAILED_PROBE_LIMIT + 5) + '{"a":1}';
    expect(enumerateTopLevelJsonDocuments(text)).toEqual([]);
  });

  it("the counter is of FAILED probes, not of characters — long prose does not exhaust it", () => {
    // A response can be long without being pathological. Only unmatched
    // brackets consume the budget, so ordinary prose of any length is inert.
    const prose = "Here is a long preamble without any braces at all. ".repeat(400);
    const docs = enumerateTopLevelJsonDocuments(prose + '{"a":1}');
    expect(docs).toHaveLength(1);
    expect(docs[0]!.json).toEqual({ a: 1 });
  });

  it("the counter RESETS on a successful document — many documents each with probes", () => {
    // Otherwise a long, healthy multi-document response would be truncated by
    // an accumulating counter: the bound must bite on a RUN, not on a total.
    //
    // ⚠ THE ARITHMETIC IS THE WHOLE TEST, and the first version of it proved
    // nothing: at 10 probes x 5 documents the TOTAL (50) was already under the
    // limit, so a counter that never reset would have passed too — a mutant
    // caught that. Each document must sit comfortably UNDER the limit while the
    // running total goes well OVER it.
    const perDocument = 20;
    const documents = 5;
    expect(perDocument, "each run must be under the bound").toBeLessThan(FAILED_PROBE_LIMIT);
    expect(
      perDocument * documents,
      "the TOTAL must exceed the bound, or a non-resetting counter survives",
    ).toBeGreaterThan(FAILED_PROBE_LIMIT);

    const unit = "{".repeat(perDocument) + '{"a":1}';
    const docs = enumerateTopLevelJsonDocuments(unit.repeat(documents), documents);
    expect(docs).toHaveLength(documents);
  });
});

describe("the selector evaluates every document MAX_SELECTABLE_DOCUMENTS names", () => {
  /**
   * `selectAcceptedDocument` carried its own `budget`, seeded to
   * `MAX_SELECTABLE_DOCUMENTS` and decremented by the FIRST predicate call —
   * the one against the core extractor's own result, made before the scan
   * begins. The loop it guarded was already bounded by
   * `enumerateTopLevelJsonDocuments(trimmed, MAX_SELECTABLE_DOCUMENTS)`, so the
   * budget added nothing except an off-by-one AGAINST THE CONSTANT'S OWN NAME:
   * with 8 documents, the 8th could never be evaluated.
   *
   * The user-visible consequence: a response whose only acceptable draft is the
   * last of eight is rejected wholesale.
   */
  it("PRECONDITION — the constant is 8, so this fixture sits exactly on the boundary", () => {
    expect(MAX_SELECTABLE_DOCUMENTS).toBe(8);
  });

  it("accepts the LAST of MAX_SELECTABLE_DOCUMENTS documents", () => {
    const docs = Array.from({ length: MAX_SELECTABLE_DOCUMENTS }, (_, i) =>
      JSON.stringify({ n: i }),
    );
    const content = `Some preamble.\n${docs.join("\n")}`;
    const wanted = MAX_SELECTABLE_DOCUMENTS - 1;

    const result = extractJsonFromResponse(content, {
      task: "test",
      model: "test",
      logWarnings: false,
      // Bind by IDENTITY: accept exactly the last document, never "any object"
      // (trap 19 — a value predicate another document could satisfy).
      acceptDocument: (json) =>
        typeof json === "object" && json !== null && (json as { n?: number }).n === wanted,
    });

    expect(result.json).toEqual({ n: wanted });
    expect(result.extractionMethod).toBe("document_selection");
  });

  it("CONTROL — an EARLIER document is still selected, so the fix did not just widen everything", () => {
    const docs = Array.from({ length: MAX_SELECTABLE_DOCUMENTS }, (_, i) =>
      JSON.stringify({ n: i }),
    );
    const content = `Some preamble.\n${docs.join("\n")}`;
    const result = extractJsonFromResponse(content, {
      task: "test",
      model: "test",
      logWarnings: false,
      acceptDocument: (json) =>
        typeof json === "object" && json !== null && (json as { n?: number }).n === 2,
    });
    expect(result.json).toEqual({ n: 2 });
  });

  it("CONTROL — when NOTHING is acceptable the core result stands, and nothing throws", () => {
    const docs = Array.from({ length: MAX_SELECTABLE_DOCUMENTS }, (_, i) =>
      JSON.stringify({ n: i }),
    );
    const content = `Some preamble.\n${docs.join("\n")}`;
    const result = extractJsonFromResponse(content, {
      task: "test",
      model: "test",
      logWarnings: false,
      acceptDocument: () => false,
    });
    expect(result.json).toEqual({ n: 0 });
  });
});
