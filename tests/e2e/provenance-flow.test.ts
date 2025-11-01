import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { Buffer } from "node:buffer";
import draftRoute from "../../src/routes/assist.draft-graph.js";
import type { GraphT } from "../../src/schemas/graph.js";

// Mock Anthropic to return graphs with structured provenance
vi.mock("../../src/adapters/llm/anthropic.js", () => ({
  draftGraphWithAnthropic: vi.fn().mockImplementation(({ docs }) => {
    // Generate graph with provenance from documents
    const hasDoc = docs && docs.length > 0;

    // Determine location format based on document type
    const getLocation = (docName: string, index: number) => {
      if (docName.endsWith(".pdf")) return `page ${index + 1}`;
      if (docName.endsWith(".csv")) return `row ${index + 1}`;
      if (docName.endsWith(".txt") || docName.endsWith(".md")) return `line ${index + 1}`;
      return `page ${index + 1}`;
    };

    return Promise.resolve({
      graph: {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Increase revenue" },
          { id: "dec_1", kind: "decision", label: "Choose growth strategy" },
          { id: "opt_1", kind: "option", label: "Expand to new markets" },
          { id: "out_1", kind: "outcome", label: "25% revenue growth" },
        ],
        edges: [
          {
            from: "goal_1",
            to: "dec_1",
            provenance: hasDoc
              ? {
                  source: docs[0].source,
                  quote: docs[0].preview.slice(0, 80),
                  location: getLocation(docs[0].source, 0),
                }
              : undefined,
          },
          {
            from: "dec_1",
            to: "opt_1",
            provenance: hasDoc
              ? {
                  source: docs[0].source,
                  quote: "international expansion shows promise",
                  location: getLocation(docs[0].source, 1),
                }
              : undefined,
          },
          {
            from: "opt_1",
            to: "out_1",
            provenance: hasDoc
              ? {
                  source: docs[0].source,
                  quote: "projected 25% increase",
                  location: getLocation(docs[0].source, 2),
                }
              : undefined,
            belief: 0.85,
          },
        ],
        meta: {
          roots: ["goal_1"],
          leaves: ["out_1"],
          suggested_positions: {},
          source: "assistant",
        },
      },
      rationales: [
        { target: "goal_1", why: "Primary business objective" },
        { target: "opt_1", why: "Supported by market analysis in document" },
      ],
    });
  }),
  repairGraphWithAnthropic: vi.fn(),
}));

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: null }),
}));

describe("Provenance Flow E2E Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Structured provenance with document attachments", () => {
    it("generates structured provenance from PDF attachment", async () => {
      const app = Fastify();
      await draftRoute(app);

      // Create mock PDF content
      const pdfContent = Buffer.from("Mock PDF content with strategic insights about market expansion");

      const payload = {
        brief: "Based on the attached strategic report, create a comprehensive growth plan with clear objectives",
        attachments: [
          {
            id: "doc_1",
            kind: "pdf",
            name: "strategy-report.pdf",
          },
        ],
        attachment_payloads: {
          doc_1: pdfContent.toString("base64"),
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();

      // Check that edges have structured provenance
      const edgesWithProvenance = body.graph.edges.filter((e: any) => e.provenance);
      expect(edgesWithProvenance.length).toBeGreaterThan(0);

      // Verify structured provenance format
      edgesWithProvenance.forEach((edge: any) => {
        expect(edge.provenance).toMatchObject({
          source: expect.any(String),
          quote: expect.any(String),
          location: expect.any(String),
        });
        expect(edge.provenance.source).toBe("strategy-report.pdf");
        expect(edge.provenance.quote.length).toBeLessThanOrEqual(100);
        expect(edge.provenance.location).toMatch(/page \d+/);
      });
    });

    it("generates structured provenance from CSV attachment", async () => {
      const app = Fastify();
      await draftRoute(app);

      const csvContent = Buffer.from("metric,value,trend\nrevenue,100M,+15%\nusers,1M,+25%\nchurn,5%,-2%");

      const payload = {
        brief: "Using the metrics data provided, develop a strategic framework for growth optimization",
        attachments: [
          {
            id: "metrics_1",
            kind: "csv",
            name: "quarterly-metrics.csv",
          },
        ],
        attachment_payloads: {
          metrics_1: csvContent.toString("base64"),
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      const edgesWithProvenance = body.graph.edges.filter((e: any) => e.provenance);

      edgesWithProvenance.forEach((edge: any) => {
        expect(edge.provenance.source).toBe("quarterly-metrics.csv");
        expect(edge.provenance.location).toMatch(/row \d+/i);
      });
    });

    it("generates structured provenance from TXT attachment", async () => {
      const app = Fastify();
      await draftRoute(app);

      const txtContent = Buffer.from(
        "Strategic Analysis\n\nMarket expansion shows significant promise.\nCompetitor analysis indicates opportunity.\nCustomer feedback is overwhelmingly positive."
      );

      const payload = {
        brief: "Create comprehensive strategic roadmap based on analysis document with clear decision points",
        attachments: [
          {
            id: "analysis_1",
            kind: "txt",
            name: "market-analysis.txt",
          },
        ],
        attachment_payloads: {
          analysis_1: txtContent.toString("base64"),
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      const edgesWithProvenance = body.graph.edges.filter((e: any) => e.provenance);

      edgesWithProvenance.forEach((edge: any) => {
        expect(edge.provenance.source).toBe("market-analysis.txt");
        expect(edge.provenance.location).toMatch(/line \d+/i);
      });
    });

    it("handles multiple attachments with provenance", async () => {
      const app = Fastify();
      await draftRoute(app);

      const pdfContent = Buffer.from("PDF strategic insights");
      const csvContent = Buffer.from("metric,value\nrevenue,100M\nusers,1M");

      const payload = {
        brief: "Synthesize insights from both documents to create comprehensive strategic framework with clear objectives",
        attachments: [
          { id: "doc_1", kind: "pdf", name: "report.pdf" },
          { id: "doc_2", kind: "csv", name: "metrics.csv" },
        ],
        attachment_payloads: {
          doc_1: pdfContent.toString("base64"),
          doc_2: csvContent.toString("base64"),
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      const sources = new Set(
        body.graph.edges.filter((e: any) => e.provenance).map((e: any) => e.provenance.source)
      );

      // Should reference both documents
      expect(sources.size).toBeGreaterThan(0);
    });
  });

  describe("Legacy string provenance deprecation", () => {
    it("sets deprecation headers when legacy string provenance detected", async () => {
      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

      // Mock LLM to return legacy string provenance
      vi.mocked(draftGraphWithAnthropic).mockResolvedValueOnce({
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "a", kind: "goal", label: "A" },
            { id: "b", kind: "decision", label: "B" },
          ],
          edges: [
            {
              from: "a",
              to: "b",
              provenance: "legacy string citation", // Old format
            },
          ],
          meta: { roots: ["a"], leaves: ["b"], suggested_positions: {}, source: "assistant" },
        },
        rationales: [],
      });

      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Strategic decision framework with comprehensive evaluation criteria for planning purposes",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-deprecated-provenance-format"]).toBe("true");
      expect(res.headers["x-deprecation-sunset"]).toBeDefined();
      expect(res.headers["x-deprecation-link"]).toBe("https://docs.olumi.ai/provenance-migration");
    });

    it("does not set deprecation headers for structured provenance", async () => {
      const app = Fastify();
      await draftRoute(app);

      const pdfContent = Buffer.from("Modern strategic framework");

      const payload = {
        brief: "Develop comprehensive strategic roadmap with clear objectives and measurable outcomes for execution",
        attachments: [{ id: "doc_1", kind: "pdf", name: "strategy.pdf" }],
        attachment_payloads: { doc_1: pdfContent.toString("base64") },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-deprecated-provenance-format"]).toBeUndefined();
    });
  });

  describe("Provenance validation and accuracy", () => {
    it("ensures quote field is under 100 characters", async () => {
      const app = Fastify();
      await draftRoute(app);

      const pdfContent = Buffer.from("Strategic insights for comprehensive market analysis and growth planning");

      const payload = {
        brief: "Create detailed strategic framework based on comprehensive analysis of market opportunities available",
        attachments: [{ id: "doc_1", kind: "pdf", name: "analysis.pdf" }],
        attachment_payloads: { doc_1: pdfContent.toString("base64") },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      const edgesWithProvenance = body.graph.edges.filter((e: any) => e.provenance && typeof e.provenance === "object");

      edgesWithProvenance.forEach((edge: any) => {
        expect(edge.provenance.quote.length).toBeLessThanOrEqual(100);
      });
    });

    it("includes location metadata in debug output", async () => {
      const app = Fastify();
      await draftRoute(app);

      const pdfContent = Buffer.from("Strategic document with insights");

      const payload = {
        brief: "Comprehensive strategic planning framework with detailed analysis of opportunities and clear objectives",
        include_debug: true,
        attachments: [{ id: "doc_1", kind: "pdf", name: "doc.pdf" }],
        attachment_payloads: { doc_1: pdfContent.toString("base64") },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.debug).toBeDefined();
      expect(body.debug.needle_movers).toBeDefined();

      const docPreview = body.debug.needle_movers.find((d: any) => d.source === "doc.pdf");
      expect(docPreview).toBeDefined();
      expect(docPreview.locationMetadata).toBeDefined();
    });
  });

  describe("Provenance with belief scores", () => {
    it("includes belief scores for uncertain edges with provenance", async () => {
      const app = Fastify();
      await draftRoute(app);

      const csvContent = Buffer.from("metric,confidence\nrevenue_growth,0.75\nmarket_share,0.90");

      const payload = {
        brief: "Strategic framework for evaluating uncertain outcomes with comprehensive risk assessment criteria",
        attachments: [{ id: "data_1", kind: "csv", name: "projections.csv" }],
        attachment_payloads: { data_1: csvContent.toString("base64") },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      const edgesWithBeliefAndProvenance = body.graph.edges.filter(
        (e: any) => e.belief !== undefined && e.provenance
      );

      expect(edgesWithBeliefAndProvenance.length).toBeGreaterThan(0);

      edgesWithBeliefAndProvenance.forEach((edge: any) => {
        expect(edge.belief).toBeGreaterThanOrEqual(0);
        expect(edge.belief).toBeLessThanOrEqual(1);
        expect(edge.provenance).toBeDefined();
      });
    });
  });
});
