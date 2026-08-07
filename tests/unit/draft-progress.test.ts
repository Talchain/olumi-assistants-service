/**
 * ROADMAP 1.204 M1 — the mid-draft label scanner.
 *
 * This exists as a UNIT test on purpose. The scanner is fed from the draft
 * adapter's streaming loop, which also carries the runaway detector and the
 * #682 per-string ceiling — the most consequential loop in the service. Pulling
 * every parsing decision out into a pure function means the loop change is a
 * guarded call, and the behaviour that could actually misfire (partial strings,
 * escapes, delta boundaries, unbounded growth) is provable without an LLM.
 *
 * Note the fixtures adapter does not stream tokens, so the integration test for
 * the staged route cannot exercise this path at all — which is precisely why
 * these cases have to be pinned here.
 */

import { describe, it, expect } from "vitest";
import {
  createDraftLabelScanner,
  DRAFT_PROGRESS_MAX_LABELS,
  DRAFT_PROGRESS_MAX_LABEL_CHARS,
  DRAFT_PROGRESS_CARRY_CAP_CHARS,
} from "../../src/adapters/llm/draft-progress.js";

describe("draft label scanner", () => {
  it("extracts completed labels from a single chunk, in stream order", () => {
    const s = createDraftLabelScanner();
    const out = s.push('{"nodes":[{"id":"g1","label":"Grow revenue"},{"id":"o1","label":"Launch in Q3"}]');
    expect(out).toEqual(["Grow revenue", "Launch in Q3"]);
  });

  it("does NOT emit a label that is still being streamed", () => {
    const s = createDraftLabelScanner();
    // The closing quote has not arrived — emitting here would show the user a
    // truncated word as though it were the model's output.
    expect(s.push('{"nodes":[{"label":"Launch in Q')).toEqual([]);
    // ...and it emits once, whole, when the value closes.
    expect(s.push('3"}')).toEqual(["Launch in Q3"]);
  });

  it("completes a label that straddles a delta boundary", () => {
    const s = createDraftLabelScanner();
    expect(s.push('{"lab')).toEqual([]);
    expect(s.push('el": "Cut ')).toEqual([]);
    expect(s.push('churn"}')).toEqual(["Cut churn"]);
  });

  it("never re-emits a label already reported", () => {
    const s = createDraftLabelScanner();
    expect(s.push('{"label":"Alpha"}')).toEqual(["Alpha"]);
    expect(s.push(',{"label":"Beta"}')).toEqual(["Beta"]);
    expect(s.count()).toBe(2);
  });

  it("decodes escaped characters inside a label", () => {
    const s = createDraftLabelScanner();
    expect(s.push('{"label":"Ship \\"v2\\" now"}')).toEqual(['Ship "v2" now']);
  });

  it("is not fooled by an escaped quote into closing a label early", () => {
    const s = createDraftLabelScanner();
    // The first `\"` must NOT terminate the value.
    const out = s.push('{"label":"A \\" B"}');
    expect(out).toEqual(['A " B']);
  });

  it("tolerates whitespace between key, colon and value", () => {
    const s = createDraftLabelScanner();
    expect(s.push('{"label"   :   "Spaced out"}')).toEqual(["Spaced out"]);
  });

  it("drops empty labels", () => {
    const s = createDraftLabelScanner();
    expect(s.push('{"label":""}')).toEqual([]);
    expect(s.count()).toBe(0);
  });

  it("drops an over-long label whole rather than truncating it", () => {
    const s = createDraftLabelScanner();
    const tooLong = "x".repeat(DRAFT_PROGRESS_MAX_LABEL_CHARS + 1);
    expect(s.push(`{"label":"${tooLong}"}`)).toEqual([]);
    // A cut label would misrepresent the model's output, so nothing is emitted.
    expect(s.count()).toBe(0);
  });

  it("stops emitting once the per-draft label cap is reached", () => {
    const s = createDraftLabelScanner();
    const many = Array.from({ length: DRAFT_PROGRESS_MAX_LABELS + 10 }, (_, i) => `{"label":"n${i}"}`).join(",");
    s.push(many);
    expect(s.count()).toBe(DRAFT_PROGRESS_MAX_LABELS);
    // Further input after the cap is ignored entirely.
    expect(s.push('{"label":"overflow"}')).toEqual([]);
    expect(s.count()).toBe(DRAFT_PROGRESS_MAX_LABELS);
  });

  it("keeps its carry buffer bounded when no label ever completes", () => {
    const s = createDraftLabelScanner();
    // A pathological unterminated string — the runaway detector owns this
    // failure; the scanner must simply not grow without bound.
    for (let i = 0; i < 40; i++) {
      expect(s.push("y".repeat(1000))).toEqual([]);
    }
    // Still functional afterwards: a fresh, complete label is found.
    expect(s.push('","label":"Recovered"}')).toEqual(["Recovered"]);
    expect(DRAFT_PROGRESS_CARRY_CAP_CHARS).toBeGreaterThan(1900); // above the #682 per-string ceiling
  });

  it("ignores keys that merely end in label", () => {
    const s = createDraftLabelScanner();
    // `"sublabel"` must not match — the key is anchored by its opening quote.
    expect(s.push('{"sublabel":"nope"}')).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    const s = createDraftLabelScanner();
    expect(s.push("")).toEqual([]);
  });
});
