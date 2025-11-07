import { describe, it, expect } from "vitest";
import { buildEvidencePackRedacted } from "../../src/utils/evidence-pack.js";

describe("buildEvidencePackRedacted", () => {
  describe("schema and metadata", () => {
    it("should include schema version", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.schema).toBe("evidence_pack.v1");
    });

    it("should include service version", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.service_version).toBe("1.1.1");
    });

    it("should include generated_at timestamp", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.generated_at).toBeDefined();
      expect(new Date(pack.generated_at).getTime()).toBeGreaterThan(0);
    });

    it("should use default version if not provided", () => {
      const pack = buildEvidencePackRedacted({});

      expect(pack.service_version).toBe("1.1.0");
    });

    it("should include privacy notice", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.privacy_notice).toContain("This evidence pack contains only:");
      expect(pack.privacy_notice).toContain("It does NOT contain:");
      expect(pack.privacy_notice).toContain("max 100 characters");
    });
  });

  describe("document citations", () => {
    it("should extract citations from output", () => {
      const output = {
        citations: [
          {
            source: "requirements.pdf",
            location: "page 3, paragraph 2",
            quote: "Scalability is a top priority for our platform",
            provenance_source: "doc_0",
          },
          {
            source: "architecture.md",
            location: "section 2.1",
            quote: "Microservices architecture enables independent scaling",
            provenance_source: "doc_1",
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.document_citations).toHaveLength(2);
      expect(pack.document_citations[0].source).toBe("requirements.pdf");
      expect(pack.document_citations[0].location).toBe("page 3, paragraph 2");
      expect(pack.document_citations[0].provenance_source).toBe("doc_0");
    });

    it("should truncate long quotes to 100 characters", () => {
      const longQuote = "a".repeat(150);
      const output = {
        citations: [
          {
            source: "document.txt",
            quote: longQuote,
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.document_citations[0].quote).toHaveLength(103); // 100 + "..."
      expect(pack.document_citations[0].quote).toMatch(/...$/);
    });

    it("should preserve short quotes", () => {
      const output = {
        citations: [
          {
            source: "doc.txt",
            quote: "Short quote",
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.document_citations[0].quote).toBe("Short quote");
    });

    it("should handle missing citations", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.document_citations).toEqual([]);
    });

    it("should handle citations without quotes", () => {
      const output = {
        citations: [
          {
            source: "document.pdf",
            location: "page 1",
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.document_citations[0].source).toBe("document.pdf");
      expect(pack.document_citations[0].quote).toBeUndefined();
    });
  });

  describe("CSV statistics", () => {
    it("should extract CSV statistics", () => {
      const output = {
        csv_stats: [
          {
            filename: "sales_data.csv",
            row_count: 1000,
            column_count: 5,
            statistics: {
              revenue: {
                count: 1000,
                mean: 45000,
                median: 42000,
                p50: 42000,
                p90: 78000,
                p95: 92000,
                min: 1000,
                max: 150000,
              },
            },
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.csv_statistics).toHaveLength(1);
      expect(pack.csv_statistics[0].filename).toBe("sales_data.csv");
      expect(pack.csv_statistics[0].row_count).toBe(1000);
      expect(pack.csv_statistics[0].column_count).toBe(5);
    });

    it("should include only safe statistical fields", () => {
      const output = {
        csv_stats: [
          {
            filename: "data.csv",
            statistics: {
              metric: {
                count: 100,
                mean: 50,
                median: 48,
                p50: 48,
                p90: 75,
                p95: 85,
                p99: 95,
                min: 10,
                max: 100,
              },
            },
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      const stats = pack.csv_statistics[0].statistics!.metric;
      expect(stats.count).toBe(100);
      expect(stats.mean).toBe(50);
      expect(stats.p95).toBe(85);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(100);
    });

    it("should exclude unsafe fields from statistics", () => {
      const output = {
        csv_stats: [
          {
            filename: "data.csv",
            statistics: {
              column: {
                count: 100,
                mean: 50,
                // Unsafe fields that should be excluded:
                rows: [1, 2, 3],
                raw_data: "sensitive",
                values: ["a", "b", "c"],
              } as any,
            },
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      const stats = pack.csv_statistics[0].statistics!.column;
      expect(stats.count).toBe(100);
      expect(stats.mean).toBe(50);
      expect(stats).not.toHaveProperty("rows");
      expect(stats).not.toHaveProperty("raw_data");
      expect(stats).not.toHaveProperty("values");
    });

    it("should handle missing CSV statistics", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.csv_statistics).toEqual([]);
    });

    it("should handle CSV stats without statistics field", () => {
      const output = {
        csv_stats: [
          {
            filename: "data.csv",
            row_count: 100,
            column_count: 3,
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.csv_statistics[0].filename).toBe("data.csv");
      expect(pack.csv_statistics[0].row_count).toBe(100);
      expect(pack.csv_statistics[0].statistics).toBeUndefined();
    });
  });

  describe("rationales with provenance", () => {
    it("should extract rationales with provenance", () => {
      const output = {
        rationales: [
          {
            target: "node_0",
            why: "Based on scalability requirements",
            provenance_source: "doc_0",
            quote: "Scalability is critical",
            location: "page 1",
          },
          {
            target: "node_1",
            why: "Cost considerations",
            provenance_source: "doc_1",
            quote: "Budget constraints apply",
            location: "page 2",
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.rationales_with_provenance).toHaveLength(2);
      expect(pack.rationales_with_provenance[0].target).toBe("node_0");
      expect(pack.rationales_with_provenance[0].why).toBe("Based on scalability requirements");
      expect(pack.rationales_with_provenance[0].provenance_source).toBe("doc_0");
    });

    it("should exclude rationales without provenance", () => {
      const output = {
        rationales: [
          {
            target: "node_0",
            why: "Has provenance",
            provenance_source: "doc_0",
          },
          {
            target: "node_1",
            why: "No provenance",
          },
          {
            target: "node_2",
            why: "Also has provenance",
            provenance_source: "doc_1",
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      // Should only include node_0 and node_2
      expect(pack.rationales_with_provenance).toHaveLength(2);
      expect(pack.rationales_with_provenance[0].target).toBe("node_0");
      expect(pack.rationales_with_provenance[1].target).toBe("node_2");
    });

    it("should truncate long quotes in rationales", () => {
      const output = {
        rationales: [
          {
            target: "node_0",
            why: "Reasoning",
            provenance_source: "doc_0",
            quote: "a".repeat(150),
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.rationales_with_provenance[0].quote).toHaveLength(103);
      expect(pack.rationales_with_provenance[0].quote).toMatch(/...$/);
    });

    it("should handle missing rationales", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.rationales_with_provenance).toEqual([]);
    });

    it("should handle rationales without quotes or location", () => {
      const output = {
        rationales: [
          {
            target: "node_0",
            why: "Reasoning",
            provenance_source: "doc_0",
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.rationales_with_provenance[0].target).toBe("node_0");
      expect(pack.rationales_with_provenance[0].quote).toBeUndefined();
      expect(pack.rationales_with_provenance[0].location).toBeUndefined();
    });
  });

  describe("privacy guarantees", () => {
    it("should never include raw file contents", () => {
      const output = {
        citations: [
          {
            source: "document.pdf",
            raw_content: "This should not appear in evidence pack",
            quote: "Safe excerpt",
          } as any,
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      const packJson = JSON.stringify(pack);
      expect(packJson).not.toContain("raw_content");
      expect(packJson).not.toContain("This should not appear");
    });

    it("should never include CSV row data", () => {
      const output = {
        csv_stats: [
          {
            filename: "data.csv",
            rows: [
              { name: "Alice", revenue: 10000 },
              { name: "Bob", revenue: 15000 },
            ],
            statistics: {
              revenue: { count: 2, mean: 12500 },
            },
          } as any,
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      const packJson = JSON.stringify(pack);
      expect(packJson).not.toContain("Alice");
      expect(packJson).not.toContain("Bob");
      expect(packJson).toContain("12500"); // Statistics OK
    });

    it("should always truncate quotes to max 100 chars", () => {
      const output = {
        citations: Array.from({ length: 10 }, (_, i) => ({
          source: `doc${i}.pdf`,
          quote: "x".repeat(200), // All quotes are 200 chars
        })),
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      pack.document_citations.forEach((citation) => {
        expect(citation.quote!.length).toBeLessThanOrEqual(103); // 100 + "..."
      });
    });
  });

  describe("empty and edge cases", () => {
    it("should handle completely empty output", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.document_citations).toEqual([]);
      expect(pack.csv_statistics).toEqual([]);
      expect(pack.rationales_with_provenance).toEqual([]);
    });

    it("should handle null values gracefully", () => {
      const output = {
        citations: null,
        csv_stats: null,
        rationales: null,
      } as any;

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.document_citations).toEqual([]);
      expect(pack.csv_statistics).toEqual([]);
      expect(pack.rationales_with_provenance).toEqual([]);
    });

    it("should handle non-array values gracefully", () => {
      const output = {
        citations: "not an array",
        csv_stats: 123,
        rationales: { not: "array" },
      } as any;

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      expect(pack.document_citations).toEqual([]);
      expect(pack.csv_statistics).toEqual([]);
      expect(pack.rationales_with_provenance).toEqual([]);
    });
  });
});
