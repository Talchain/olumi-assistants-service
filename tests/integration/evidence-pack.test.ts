/**
 * Evidence Pack Integration Tests (v1.4.0 - PR H)
 *
 * Tests /assist/evidence-pack endpoint with:
 * - Feature flag gating (404 when disabled)
 * - Multiple export formats (JSON, CSV, Markdown)
 * - Download headers for browser downloads
 * - Input validation
 * - Complete integration flow
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import evidencePackRoute from "../../src/routes/assist.evidence-pack.js";

describe("Evidence Pack Integration (v1.4.0)", () => {
  describe("Feature flag gating", () => {
    it("returns 404 when ENABLE_EVIDENCE_PACK is not set", async () => {
      vi.stubEnv("ENABLE_EVIDENCE_PACK", "");

      const app = Fastify();
      await evidencePackRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when ENABLE_EVIDENCE_PACK is false", async () => {
      vi.stubEnv("ENABLE_EVIDENCE_PACK", "false");

      const app = Fastify();
      await evidencePackRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it("processes request when ENABLE_EVIDENCE_PACK is true", async () => {
      vi.stubEnv("ENABLE_EVIDENCE_PACK", "true");

      const app = Fastify();
      await evidencePackRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload: {
          citations: [],
          rationales: [],
          csv_stats: [],
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("JSON format (default)", () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      vi.stubEnv("ENABLE_EVIDENCE_PACK", "true");
      app = Fastify();
      await evidencePackRoute(app);
    });

    it("returns JSON evidence pack by default", async () => {
      const payload = {
        citations: [
          {
            source: "requirements.pdf",
            location: "page 1",
            quote: "System must scale to 1M users",
            provenance_source: "doc_0",
          },
        ],
        rationales: [
          {
            target: "decision_1",
            why: "Based on scalability requirements",
            provenance_source: "doc_0",
            quote: "System must scale",
            location: "page 1",
          },
        ],
        csv_stats: [
          {
            filename: "metrics.csv",
            row_count: 100,
            column_count: 5,
            statistics: {
              response_time: { mean: 150, p50: 120, p90: 250 },
            },
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="evidence-pack-.*\.json"/);

      const body = JSON.parse(res.body);
      expect(body.schema).toBe("evidence_pack.v1");
      expect(body.document_citations).toHaveLength(1);
      expect(body.document_citations[0].source).toBe("requirements.pdf");
      expect(body.rationales_with_provenance).toHaveLength(1);
      expect(body.csv_statistics).toHaveLength(1);
      expect(body.privacy_notice).toContain("This evidence pack contains only:");
    });

    it("handles empty input gracefully", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload: {},
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.document_citations).toHaveLength(0);
      expect(body.rationales_with_provenance).toHaveLength(0);
      expect(body.csv_statistics).toHaveLength(0);
    });
  });

  describe("CSV format", () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      vi.stubEnv("ENABLE_EVIDENCE_PACK", "true");
      app = Fastify();
      await evidencePackRoute(app);
    });

    it("exports as CSV when format=csv", async () => {
      const payload = {
        citations: [
          {
            source: "doc.pdf",
            location: "page 2",
            quote: "Important quote here",
            provenance_source: "doc_0",
          },
        ],
        rationales: [
          {
            target: "option_1",
            why: "Cost effective solution",
            provenance_source: "doc_0",
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack?format=csv",
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/csv");
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="evidence-pack-.*\.csv"/);

      const body = res.body;
      expect(body).toContain("Evidence Pack Export");
      expect(body).toContain("# Document Citations");
      expect(body).toContain("Source,Location,Quote,Provenance Source");
      expect(body).toContain("doc.pdf");
      expect(body).toContain("# Rationales with Provenance");
      expect(body).toContain("Target,Why,Provenance Source,Quote,Location");
      expect(body).toContain("option_1");
      expect(body).toContain("# Privacy Notice");
    });

    it("escapes CSV special characters", async () => {
      const payload = {
        citations: [
          {
            source: 'file, with, commas.pdf',
            quote: 'Quote with "quotes" inside',
            location: "Line with\nnewline",
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack?format=csv",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = res.body;
      // CSV should wrap fields with special chars in quotes
      expect(body).toContain('"file, with, commas.pdf"');
      expect(body).toContain('"Quote with ""quotes"" inside"');
      expect(body).toContain('"Line with\nnewline"');
    });
  });

  describe("Markdown format", () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      vi.stubEnv("ENABLE_EVIDENCE_PACK", "true");
      app = Fastify();
      await evidencePackRoute(app);
    });

    it("exports as Markdown when format=markdown", async () => {
      const payload = {
        citations: [
          {
            source: "spec.md",
            location: "section 3",
            quote: "Feature requirements",
            provenance_source: "doc_0",
          },
        ],
        rationales: [
          {
            target: "decision_1",
            why: "Aligns with specifications",
            provenance_source: "doc_0",
            quote: "Feature requirements",
            location: "section 3",
          },
        ],
        csv_stats: [
          {
            filename: "data.csv",
            row_count: 50,
            column_count: 3,
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack?format=markdown",
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/markdown");
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="evidence-pack-.*\.md"/);

      const body = res.body;
      expect(body).toContain("# Evidence Pack Export");
      expect(body).toContain("## Document Citations");
      expect(body).toContain("| Source | Location | Quote | Provenance |");
      expect(body).toContain("spec.md");
      expect(body).toContain("## CSV Statistics");
      expect(body).toContain("### data.csv");
      expect(body).toContain("- **Rows:** 50");
      expect(body).toContain("- **Columns:** 3");
      expect(body).toContain("## Rationales with Provenance");
      expect(body).toContain("### 1. decision\\_1"); // Escaped underscore
      expect(body).toContain("**Reasoning:** Aligns with specifications");
      expect(body).toContain("## Privacy Notice");
    });

    it("escapes markdown special characters", async () => {
      const payload = {
        citations: [
          {
            source: "file|with|pipes.md",
            quote: "Quote with *asterisks* and [brackets]",
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack?format=markdown",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = res.body;
      // Markdown should escape special characters
      expect(body).toContain("file\\|with\\|pipes.md");
      expect(body).toContain("Quote with \\*asterisks\\* and \\[brackets\\]");
    });
  });

  describe("Input validation", () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      vi.stubEnv("ENABLE_EVIDENCE_PACK", "true");
      app = Fastify();
      await evidencePackRoute(app);
    });

    it("rejects invalid format parameter", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack?format=invalid",
        payload: {},
      });

      expect(res.statusCode).toBe(400);

      const body = JSON.parse(res.body);
      expect(body.schema).toBe("error.v1");
      expect(body.code).toBe("BAD_INPUT");
    });

    it("accepts missing format parameter (defaults to json)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
    });

    it("validates payload structure", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload: {
          citations: "not an array", // Invalid type
        },
      });

      expect(res.statusCode).toBe(400);

      const body = JSON.parse(res.body);
      expect(body.schema).toBe("error.v1");
      expect(body.code).toBe("BAD_INPUT");
    });
  });

  describe("Complete integration flow", () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      vi.stubEnv("ENABLE_EVIDENCE_PACK", "true");
      app = Fastify();
      await evidencePackRoute(app);
    });

    it("generates complete evidence pack with all data types", async () => {
      const payload = {
        citations: [
          {
            source: "requirements.pdf",
            location: "page 1, section 2.1",
            quote: "System must handle 10K concurrent users with <100ms latency",
            provenance_source: "doc_0",
          },
          {
            source: "architecture.md",
            location: "diagram 3",
            quote: "Load balancer distributes traffic across 5 regions",
            provenance_source: "doc_1",
          },
        ],
        rationales: [
          {
            target: "decision_regional_deployment",
            why: "Multi-region deployment ensures low latency globally",
            provenance_source: "doc_0",
            quote: "System must handle 10K concurrent users",
            location: "page 1",
          },
          {
            target: "option_load_balancer",
            why: "Load balancing is critical for distributing traffic evenly",
            provenance_source: "doc_1",
            quote: "Load balancer distributes traffic",
            location: "diagram 3",
          },
        ],
        csv_stats: [
          {
            filename: "performance_metrics.csv",
            row_count: 1000,
            column_count: 8,
            statistics: {
              response_time_ms: {
                count: 1000,
                mean: 87.5,
                median: 75,
                p50: 75,
                p90: 150,
                p95: 200,
                p99: 350,
                min: 12,
                max: 890,
              },
              throughput_rps: {
                count: 1000,
                mean: 450,
                p90: 550,
              },
            },
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);

      // Verify structure
      expect(body.schema).toBe("evidence_pack.v1");
      expect(body.service_version).toBeDefined();
      expect(body.generated_at).toBeDefined();

      // Verify citations
      expect(body.document_citations).toHaveLength(2);
      expect(body.document_citations[0].source).toBe("requirements.pdf");
      expect(body.document_citations[0].quote).toBe("System must handle 10K concurrent users with <100ms latency");
      expect(body.document_citations[1].source).toBe("architecture.md");

      // Verify rationales
      expect(body.rationales_with_provenance).toHaveLength(2);
      expect(body.rationales_with_provenance[0].target).toBe("decision_regional_deployment");
      expect(body.rationales_with_provenance[0].why).toContain("Multi-region");

      // Verify CSV stats
      expect(body.csv_statistics).toHaveLength(1);
      expect(body.csv_statistics[0].filename).toBe("performance_metrics.csv");
      expect(body.csv_statistics[0].row_count).toBe(1000);
      expect(body.csv_statistics[0].statistics?.response_time_ms).toBeDefined();
      expect(body.csv_statistics[0].statistics?.response_time_ms?.mean).toBe(87.5);

      // Verify privacy notice
      expect(body.privacy_notice).toContain("This evidence pack contains only:");
      expect(body.privacy_notice).toContain("It does NOT contain:");
    });

    it("filters rationales without provenance", async () => {
      const payload = {
        rationales: [
          {
            target: "with_provenance",
            why: "Has provenance",
            provenance_source: "doc_0",
          },
          {
            target: "without_provenance",
            why: "No provenance field",
            // Missing provenance_source
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);

      // Only rationale with provenance should be included
      expect(body.rationales_with_provenance).toHaveLength(1);
      expect(body.rationales_with_provenance[0].target).toBe("with_provenance");
    });

    it("truncates long quotes to 100 characters", async () => {
      const longQuote = "a".repeat(200);

      const payload = {
        citations: [
          {
            source: "doc.txt",
            quote: longQuote,
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/evidence-pack",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);

      expect(body.document_citations[0].quote).toHaveLength(103); // 100 + "..."
      expect(body.document_citations[0].quote).toMatch(/\.\.\.$/);
    });
  });
});
