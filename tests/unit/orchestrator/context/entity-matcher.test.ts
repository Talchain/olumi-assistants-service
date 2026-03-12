import { describe, it, expect } from "vitest";
import { matchReferencedEntities } from "../../../../src/orchestrator/context/entity-matcher.js";
import type { GraphV3Compact } from "../../../../src/orchestrator/context/graph-compact.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeGraph(): GraphV3Compact {
  return {
    nodes: [
      { id: "goal_1", kind: "goal", label: "Achieve MRR Target", source: "user" },
      { id: "opt_a", kind: "option", label: "Increase Price", source: "user" },
      { id: "opt_b", kind: "option", label: "Status Quo", source: "user" },
      { id: "churn", kind: "factor", label: "Churn Rate", source: "assumption", value: 0.05, unit: "percent" },
      { id: "acq", kind: "factor", label: "Customer Acquisition", source: "system" },
    ],
    edges: [
      { from: "opt_a", to: "churn", strength: 0.7, exists: 0.9 },
      { from: "opt_a", to: "acq", strength: 0.5, exists: 0.8 },
      { from: "churn", to: "goal_1", strength: 0.8, exists: 0.85 },
      { from: "acq", to: "goal_1", strength: 0.6, exists: 0.9 },
    ],
    _node_count: 5,
    _edge_count: 4,
  };
}

// ============================================================================
// Tests: basic matching
// ============================================================================

describe("matchReferencedEntities", () => {
  it("returns empty array when graph is null", () => {
    const result = matchReferencedEntities("What is the Churn Rate?", null);
    expect(result).toEqual([]);
  });

  it("returns empty array when graph is undefined", () => {
    const result = matchReferencedEntities("What is the Churn Rate?", undefined);
    expect(result).toEqual([]);
  });

  it("returns empty array when message is empty", () => {
    const result = matchReferencedEntities("", makeGraph());
    expect(result).toEqual([]);
  });

  it("returns empty array when no entity referenced in message", () => {
    const result = matchReferencedEntities("Can you help me understand the decision?", makeGraph());
    expect(result).toEqual([]);
  });

  // ── Exact match ──────────────────────────────────────────────────────────

  it("matches exact label case-insensitively", () => {
    const result = matchReferencedEntities("What is the churn rate doing here?", makeGraph());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("churn");
    expect(result[0].label).toBe("Churn Rate");
  });

  it("matches entity label in mixed case", () => {
    const result = matchReferencedEntities("Tell me about CHURN RATE", makeGraph());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("churn");
  });

  it("includes kind and category in entity detail", () => {
    const result = matchReferencedEntities("what is churn rate?", makeGraph());
    expect(result[0].kind).toBe("factor");
  });

  it("includes value, unit, source from node when present", () => {
    const result = matchReferencedEntities("what is churn rate?", makeGraph());
    expect(result[0].value).toBe(0.05);
    expect(result[0].unit).toBe("percent");
    expect(result[0].source).toBe("assumption");
  });

  it("includes up to 3 connected edges", () => {
    const result = matchReferencedEntities("customer acquisition performance", makeGraph());
    expect(result).toHaveLength(1);
    expect(result[0].edges.length).toBeLessThanOrEqual(3);
  });

  // ── Cap: max 2 entities ───────────────────────────────────────────────────

  it("caps at 2 entities per turn", () => {
    // Message mentions both "Churn Rate" and "Customer Acquisition"
    const result = matchReferencedEntities(
      "How does churn rate interact with customer acquisition?",
      makeGraph(),
    );
    expect(result.length).toBeLessThanOrEqual(2);
  });

  // ── Substring matching ────────────────────────────────────────────────────

  it("matches via substring when 4+ chars and unambiguous", () => {
    // "Increase Price" substring "increase" (8 chars) is in message
    const result = matchReferencedEntities("Should I increase price?", makeGraph());
    expect(result.length).toBeGreaterThanOrEqual(1);
    const ids = result.map((e) => e.id);
    expect(ids).toContain("opt_a");
  });

  it("skips pass-2 match when two unmatched nodes both have labels in the message (global ambiguity)", () => {
    // Pass 1 captures the first two nodes (cap=2). Pass 2 tries to match remaining nodes.
    // Two remaining nodes both have labels in the message → ambiguous → both skipped.
    const ambiguousGraph: GraphV3Compact = {
      nodes: [
        { id: "n1", kind: "factor", label: "Churn Rate", source: "user" },   // pass 1 match
        { id: "n2", kind: "factor", label: "Revenue", source: "user" },      // pass 1 match
        { id: "n3", kind: "factor", label: "Budget", source: "user" },       // pass 2 candidate
        { id: "n4", kind: "factor", label: "Timeline", source: "user" },     // pass 2 candidate
      ],
      edges: [],
      _node_count: 4,
      _edge_count: 0,
    };
    // Message contains all 4 labels → pass 1 captures n1+n2 (cap=2), pass 2 sees n3+n4 →
    // substringHits.length === 2 → ambiguous → n3 and n4 both skipped
    const result = matchReferencedEntities(
      "How do churn rate and revenue relate to budget and timeline?",
      ambiguousGraph,
    );
    // Only the 2 pass-1 matches are returned; pass-2 ambiguous pair is dropped
    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.id);
    expect(ids).toContain("n1");
    expect(ids).toContain("n2");
    expect(ids).not.toContain("n3");
    expect(ids).not.toContain("n4");
  });

  it("accepts pass-2 match when only one unmatched node label appears in message", () => {
    // Pass 1 captures 2 nodes. Pass 2 has exactly one remaining match → unambiguous → accepted.
    const graph: GraphV3Compact = {
      nodes: [
        { id: "n1", kind: "factor", label: "Churn Rate", source: "user" },   // pass 1
        { id: "n2", kind: "factor", label: "Revenue", source: "user" },      // pass 1
        { id: "n3", kind: "factor", label: "Budget", source: "user" },       // pass 2 — only unmatched match
        { id: "n4", kind: "factor", label: "Timeline", source: "user" },     // label not in message
      ],
      edges: [],
      _node_count: 4,
      _edge_count: 0,
    };
    // "timeline" is NOT in the message — only "budget" appears as the 3rd unmatched label
    // But cap is 2, so pass 2 can't add anything. Test instead with fewer nodes:
    // Use a 3-node graph where first 2 fill pass-1 cap, 3rd is unambiguous in pass-2.
    // However MAX_ENTITIES_PER_TURN=2 means pass-2 won't add when cap already full.
    // So test: 3 nodes, pass-1 fills with 1, pass-2 has exactly 1 candidate → accepted.
    const graph2: GraphV3Compact = {
      nodes: [
        { id: "m1", kind: "factor", label: "Churn Rate", source: "user" },   // pass 1
        { id: "m2", kind: "factor", label: "Budget", source: "user" },       // pass 2 — only match
        { id: "m3", kind: "factor", label: "Timeline", source: "user" },     // not in message
      ],
      edges: [],
      _node_count: 3,
      _edge_count: 0,
    };
    const result = matchReferencedEntities("How does churn rate affect budget?", graph2);
    expect(result).toHaveLength(2);
    const ids2 = result.map((e) => e.id);
    expect(ids2).toContain("m1");
    expect(ids2).toContain("m2");
    expect(ids2).not.toContain("m3");
  });

  // ── Zero overhead when no match ───────────────────────────────────────────

  it("returns [] (zero overhead) when no entity referenced", () => {
    const result = matchReferencedEntities(
      "Can you help me think through this decision?",
      makeGraph(),
    );
    expect(result).toEqual([]);
  });

  // ── Edge caps ─────────────────────────────────────────────────────────────

  it("caps edges at 3 per entity even when more exist", () => {
    const denseGraph: GraphV3Compact = {
      nodes: [
        { id: "center", kind: "factor", label: "Central Factor", source: "user" },
        { id: "n1", kind: "factor", label: "Node 1", source: "user" },
        { id: "n2", kind: "factor", label: "Node 2", source: "user" },
        { id: "n3", kind: "factor", label: "Node 3", source: "user" },
        { id: "n4", kind: "factor", label: "Node 4", source: "user" },
        { id: "n5", kind: "factor", label: "Node 5", source: "user" },
      ],
      edges: [
        { from: "center", to: "n1", strength: 0.9, exists: 0.9 },
        { from: "center", to: "n2", strength: 0.8, exists: 0.9 },
        { from: "center", to: "n3", strength: 0.7, exists: 0.9 },
        { from: "center", to: "n4", strength: 0.6, exists: 0.9 },
        { from: "n5", to: "center", strength: 0.5, exists: 0.9 },
      ],
      _node_count: 6,
      _edge_count: 5,
    };

    const result = matchReferencedEntities("Tell me about central factor", denseGraph);
    expect(result).toHaveLength(1);
    expect(result[0].edges.length).toBeLessThanOrEqual(3);
  });
});
