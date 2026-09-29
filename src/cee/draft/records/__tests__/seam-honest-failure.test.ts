/**
 * HONEST FAILURE, NEVER A PHANTOM GRAPH.
 *
 * The anti-goal is a MEASURED product defect: a streamed `GRAPH_READY` frame the
 * user watched arrive, then a 504 with empty text and nothing committed. The user
 * saw a graph that never existed. Every assertion in this file exists to keep the
 * records seam from being able to reproduce that.
 *
 * The invariants are written against the SPEC — "a response that is not a record
 * set produces a refusal, and never a graph" — and NOT against the failure mode
 * in hand. Note in particular the graph-shaped case: it is not hypothetical. The
 * structured-outputs→prompt-only degradation rebuild drops the grammar and keeps
 * only the instruction, so a model that ignores the instruction and returns a
 * graph IS reachable in production. Silently accepting it would re-admit the
 * retired draft path as an undeclared fallback, and every provenance claim this
 * mechanism makes would then hold only on the paths nobody looked at.
 */
import { describe, expect, it } from "vitest";
import {
  projectDraftRecords,
  isGraphShapedResponse,
  isSalvageableRecordSet,
} from "../seam.js";
import type { DraftRecordSet } from "../grammar.js";

const VALID: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "cut customer churn", role: "target" },
    { kind: "option", source_quote: "buy a new CRM" },
    { kind: "figure", source_quote: "churn is 12%", value: 12, unit: "%", role: "baseline" },
  ],
  claims: [
    { claim_kind: "causal_link", label: "CRM reduces churn", basis: [1], from_stated: 1, to_stated: 2, effect: "negative" },
  ],
};

/** The exact shape the retired draft path produced. */
const GRAPH_SHAPED = {
  version: "1",
  nodes: [{ id: "n1", kind: "goal", label: "cut churn" }],
  edges: [{ id: "e1", from: "n1", to: "n1" }],
};

describe("the seam accepts a record set and produces a projection", () => {
  it("projects a conformant record set", () => {
    const r = projectDraftRecords(VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projection.graph.nodes.length).toBeGreaterThan(0);
    // The record set is returned VERBATIM alongside the projection — a consumer
    // must never have to reconstruct what the model said from what the projector
    // built, because the projector is lossy by design (`dropped[]` exists).
    expect(r.records.stated_items).toHaveLength(3);
  });

  it("accepts zero claims — the honest answer for a brief that supports no inference", () => {
    const r = projectDraftRecords({ ...VALID, claims: [] });
    expect(r.ok).toBe(true);
  });
});

describe("the seam REFUSES anything that is not a record set", () => {
  /**
   * ⭐ THE UNDECLARED-FALLBACK GUARD. Bound to the reason CODE, not merely to
   * "it failed": a graph-shaped response and a malformed response are different
   * events, and collapsing them would hide the one that means the old path came
   * back.
   */
  it("refuses a GRAPH with the graph_shaped_response reason, naming the counts", () => {
    const r = projectDraftRecords(GRAPH_SHAPED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("graph_shaped_response");
    expect(r.detail).toContain("nodes=1");
    expect(r.detail).toContain("edges=1");
  });

  it("refuses a graph even when it also carries record-shaped keys", () => {
    // Both-shaped is still a violation: the instruction says "Do not emit a
    // graph", and a response that hedges is one a downstream reader could take
    // either way.
    const r = projectDraftRecords({ ...GRAPH_SHAPED, stated_items: VALID.stated_items, claims: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("graph_shaped_response");
  });

  it("refuses an EMPTY stated_items list — a brief always states something", () => {
    const r = projectDraftRecords({ stated_items: [], claims: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_a_record_set");
    expect(r.detail).toContain("stated_items");
  });

  it("refuses a record set whose discriminator is not in the vocabulary", () => {
    const r = projectDraftRecords({
      stated_items: [{ kind: "vibe", source_quote: "something" }],
      claims: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_a_record_set");
  });

  it.each([
    ["null", null],
    ["a string", "some prose the model wrote instead"],
    ["an empty object", {}],
    ["an array", []],
  ])("refuses %s without throwing", (_label, value) => {
    const r = projectDraftRecords(value);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_a_record_set");
  });

  /**
   * The whole point of returning a RESULT rather than throwing: the caller owns
   * the one typed failure surface. A refusal that produced a graph — empty or
   * otherwise — would be the phantom this file exists to forbid, so assert the
   * failure carries NO graph at all rather than an empty one.
   */
  it("never returns a projection alongside a refusal", () => {
    const r = projectDraftRecords(GRAPH_SHAPED) as Record<string, unknown>;
    expect(r.projection).toBeUndefined();
    expect(r.records).toBeUndefined();
  });
});

describe("isGraphShapedResponse binds to the graph's own discriminators", () => {
  it("is true for nodes or edges, and false for a record set", () => {
    expect(isGraphShapedResponse({ nodes: [] })).toBe(true);
    expect(isGraphShapedResponse({ edges: [] })).toBe(true);
    expect(isGraphShapedResponse(VALID)).toBe(false);
  });

  /**
   * Deliberately NOT "absence of record keys": an empty or truncated response has
   * no record keys either, and reporting that as "the model returned a graph"
   * would send a reader hunting a fallback that never happened.
   */
  it("is false for an empty object, which is a different failure", () => {
    expect(isGraphShapedResponse({})).toBe(false);
    expect(isGraphShapedResponse(null)).toBe(false);
  });
});

describe("the truncation-salvage predicate is records-shaped", () => {
  /**
   * ⭐ THE SILENT-STOP GUARD. This predicate used to read
   * `Array.isArray(json.nodes)` — the graph's discriminator. On the records path
   * that is permanently false, so salvage would have quietly never fired again
   * and every truncated draft would have become a hard failure with nothing
   * anywhere saying why. An instrument that stops firing looks exactly like an
   * instrument with nothing to report.
   */
  it("accepts a truncated record-set prefix and rejects a graph prefix", () => {
    expect(isSalvageableRecordSet({ stated_items: [{ kind: "goal", source_quote: "x" }] })).toBe(true);
    expect(isSalvageableRecordSet(GRAPH_SHAPED)).toBe(false);
  });

  it("rejects an empty or absent stated_items — there is nothing to salvage", () => {
    expect(isSalvageableRecordSet({ stated_items: [] })).toBe(false);
    expect(isSalvageableRecordSet({ claims: [] })).toBe(false);
    expect(isSalvageableRecordSet(null)).toBe(false);
  });

  /**
   * Salvage only ever OFFERS a candidate. Proven, not asserted: a prefix this
   * predicate accepts can still be refused by the projection gate behind it.
   */
  it("only offers a candidate — the projection gate can still refuse it", () => {
    const truncated = { stated_items: [{ kind: "goal" }] }; // no source_quote
    expect(isSalvageableRecordSet(truncated)).toBe(true);
    expect(projectDraftRecords(truncated).ok).toBe(false);
  });
});
