import { describe, it, expect } from "vitest";
import { StructuredProvenance, Edge } from "../../src/schemas/graph.js";

describe("StructuredProvenance Schema", () => {
  it("accepts valid structured provenance", () => {
    const valid = {
      source: "report.pdf",
      quote: "Revenue grew 23% YoY",
      location: "page 3",
    };

    const result = StructuredProvenance.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(valid);
    }
  });

  it("accepts provenance without location", () => {
    const valid = {
      source: "hypothesis",
      quote: "Trial users convert at higher rates",
    };

    const result = StructuredProvenance.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBeUndefined();
    }
  });

  it("rejects provenance with missing source", () => {
    const invalid = {
      quote: "Revenue grew 23% YoY",
      location: "page 3",
    };

    const result = StructuredProvenance.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects provenance with missing quote", () => {
    const invalid = {
      source: "report.pdf",
      location: "page 3",
    };

    const result = StructuredProvenance.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects provenance with empty source", () => {
    const invalid = {
      source: "",
      quote: "Revenue grew 23% YoY",
    };

    const result = StructuredProvenance.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects provenance with quote exceeding 100 chars", () => {
    const invalid = {
      source: "report.pdf",
      quote: "a".repeat(101), // 101 characters
    };

    const result = StructuredProvenance.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("accepts provenance with quote exactly 100 chars", () => {
    const valid = {
      source: "report.pdf",
      quote: "a".repeat(100), // Exactly 100 characters
    };

    const result = StructuredProvenance.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe("StructuredProvenance .passthrough()", () => {
  it("preserves unknown fields through parse", () => {
    const input = {
      source: "report.pdf",
      quote: "Revenue grew 23% YoY",
      location: "page 3",
      confidence: 0.95,
      page_number: 3,
    };

    const result = StructuredProvenance.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).confidence).toBe(0.95);
      expect((result.data as any).page_number).toBe(3);
    }
  });
});

describe("Edge Provenance Union Type", () => {
  it("accepts edge with structured provenance", () => {
    const edge = {
      from: "goal_1",
      to: "dec_1",
      provenance: {
        source: "report.pdf",
        quote: "Revenue grew 23% YoY",
        location: "page 3",
      },
      provenance_source: "document" as const,
    };

    const result = Edge.safeParse(edge);
    expect(result.success).toBe(true);
  });

  it("accepts edge with legacy string provenance (migration compatibility)", () => {
    const edge = {
      from: "goal_1",
      to: "dec_1",
      provenance: "Trial users convert at higher rates",
      provenance_source: "hypothesis" as const,
    };

    const result = Edge.safeParse(edge);
    expect(result.success).toBe(true);
  });

  it("accepts edge without provenance", () => {
    const edge = {
      from: "goal_1",
      to: "dec_1",
    };

    const result = Edge.safeParse(edge);
    expect(result.success).toBe(true);
  });

  it("rejects edge with invalid provenance type (number)", () => {
    const edge = {
      from: "goal_1",
      to: "dec_1",
      provenance: 123,
    };

    const result = Edge.safeParse(edge);
    expect(result.success).toBe(false);
  });

  it("rejects edge with invalid provenance type (array)", () => {
    const edge = {
      from: "goal_1",
      to: "dec_1",
      provenance: ["source", "quote"],
    };

    const result = Edge.safeParse(edge);
    expect(result.success).toBe(false);
  });

  it("rejects edge with empty string provenance", () => {
    const edge = {
      from: "goal_1",
      to: "dec_1",
      provenance: "",
    };

    const result = Edge.safeParse(edge);
    expect(result.success).toBe(false);
  });

  it("accepts edge with belief and structured provenance", () => {
    const edge = {
      from: "opt_1",
      to: "out_1",
      belief: 0.7,
      provenance: {
        source: "metrics.csv",
        quote: "14-day trial users convert at 23%",
        location: "row 42",
      },
      provenance_source: "document" as const,
    };

    const result = Edge.safeParse(edge);
    expect(result.success).toBe(true);
  });

  it("accepts edge with weight and structured provenance", () => {
    const edge = {
      from: "opt_1",
      to: "out_1",
      weight: 0.2,
      provenance: {
        source: "hypothesis",
        quote: "Impact estimated at 20%",
      },
      provenance_source: "hypothesis" as const,
    };

    const result = Edge.safeParse(edge);
    expect(result.success).toBe(true);
  });
});
