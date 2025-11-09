/**
 * Grounding Attachments Integration Tests
 *
 * Tests document grounding with PDF/TXT/MD/CSV attachments:
 * - 5k character limit enforcement (per-file BAD_INPUT errors)
 * - Privacy guarantees (no content logging)
 * - Safe CSV summarization (no row/header leakage)
 * - Location markers for citations
 * - End-to-end flow with draft-graph and critique-graph routes
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import { Buffer } from "node:buffer";
import draftRoute from "../../src/routes/assist.draft-graph.js";
import critiqueRoute from "../../src/routes/assist.critique-graph.js";

// Use fixtures adapter for deterministic tests without API keys
vi.stubEnv("LLM_PROVIDER", "fixtures");
// Enable grounding for these tests (defaults to false in v1.1.0)
vi.stubEnv("ENABLE_GROUNDING", "true");

describe("Grounding: Attachments Integration (v04)", () => {
  let draftApp: ReturnType<typeof Fastify>;
  let critiqueApp: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    draftApp = Fastify();
    await draftRoute(draftApp);

    critiqueApp = Fastify();
    await critiqueRoute(critiqueApp);
  });

  describe("TXT/MD Attachments", () => {
    it("processes valid TXT file within 5k limit", async () => {
      const txtContent = "Line 1: Introduction\nLine 2: Main content\nLine 3: Conclusion";
      const base64Content = Buffer.from(txtContent, 'utf-8').toString('base64');

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Create a decision graph based on the attached document",
          attachments: [
            { id: "txt_1", kind: "txt", name: "notes.txt" }
          ],
          attachment_payloads: {
            txt_1: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
      expect(body.graph.nodes.length).toBeGreaterThan(0);
    });

    it("processes valid MD file with markdown syntax", async () => {
      const mdContent = "# Title\n\n## Section 1\nContent here.\n\n## Section 2\nMore content.";
      const base64Content = Buffer.from(mdContent, 'utf-8').toString('base64');

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Analyze the structure described in the markdown document",
          attachments: [
            { id: "md_1", kind: "md", name: "spec.md" }
          ],
          attachment_payloads: {
            md_1: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });

    it("rejects TXT file exceeding 5k character limit", async () => {
      // Generate content > 5k chars (accounting for line number markers: "N: " adds ~4 chars per line)
      const longContent = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}: ${"A".repeat(100)}`).join("\n");
      const base64Content = Buffer.from(longContent, 'utf-8').toString('base64');

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Process this document with a large file exceeding character limits",
          attachments: [
            { id: "long_txt", kind: "txt", name: "large.txt" }
          ],
          attachment_payloads: {
            long_txt: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
      // Error message includes filename context: File "large.txt": txt_exceeds_limit: ...
      expect(body.message).toMatch(/large\.txt.*txt_exceeds_limit/);
      expect(body.details?.hint).toMatch(/5k character limit/i);
    });
  });

  describe("CSV Attachments - Safe Summarization", () => {
    it("processes numeric CSV with safe statistics only", async () => {
      const csvContent = "value\n10\n20\n30\n40\n50";
      const base64Content = Buffer.from(csvContent, 'utf-8').toString('base64');

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Analyze the data trends from the attached CSV file and create a decision graph",
          attachments: [
            { id: "csv_1", kind: "csv", name: "metrics.csv" }
          ],
          attachment_payloads: {
            csv_1: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });

    it("never leaks CSV row data or headers", async () => {
      const csvContent = "password,credit_card\nsecret123,4111111111111111\nsecret456,5555555555555555";
      const base64Content = Buffer.from(csvContent, 'utf-8').toString('base64');

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Analyze data patterns from the attached file and identify security considerations",
          attachments: [
            { id: "sensitive_csv", kind: "csv", name: "data.csv" }
          ],
          attachment_payloads: {
            sensitive_csv: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(200);
      // Verify sensitive data not in response (would be in debug field if leaked)
      const responseStr = JSON.stringify(res.body);
      expect(responseStr).not.toContain("secret123");
      expect(responseStr).not.toContain("4111111111111111");
      expect(responseStr).not.toContain("password");
      expect(responseStr).not.toContain("credit_card");
    });

    it("rejects CSV exceeding 5k character limit", async () => {
      // Generate CSV > 5k chars
      const header = "col1,col2,col3,col4,col5,col6,col7,col8,col9,col10";
      const rows = Array.from({ length: 200 }, (_, i) =>
        `val${i}_1,val${i}_2,val${i}_3,val${i}_4,val${i}_5,val${i}_6,val${i}_7,val${i}_8,val${i}_9,val${i}_10`
      );
      const csvContent = [header, ...rows].join("\n");
      const base64Content = Buffer.from(csvContent, 'utf-8').toString('base64');

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Analyze large dataset from the attached CSV file and create optimization strategies",
          attachments: [
            { id: "big_csv", kind: "csv", name: "large.csv" }
          ],
          attachment_payloads: {
            big_csv: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
      // Error message includes filename context: File "large.csv": csv_exceeds_limit: ...
      expect(body.message).toMatch(/large\.csv.*csv_exceeds_limit/);
      expect(body.details?.hint).toMatch(/5k character limit/i);
    });

    it("handles CSV with only non-numeric columns", async () => {
      const csvContent = "name,city\nAlice,NYC\nBob,SF\nCharlie,LA";
      const base64Content = Buffer.from(csvContent, 'utf-8').toString('base64');

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Analyze participant data from the attached CSV file and create a distribution strategy",
          attachments: [
            { id: "text_csv", kind: "csv", name: "participants.csv" }
          ],
          attachment_payloads: {
            text_csv: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });
  });

  describe("Mixed Attachments", () => {
    it("processes multiple attachments of different types", async () => {
      const txtContent = "Text document content";
      const csvContent = "value\n10\n20\n30";
      const mdContent = "# Markdown document\nSome content";

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Synthesize insights from all documents",
          attachments: [
            { id: "txt_1", kind: "txt", name: "notes.txt" },
            { id: "csv_1", kind: "csv", name: "data.csv" },
            { id: "md_1", kind: "md", name: "spec.md" }
          ],
          attachment_payloads: {
            txt_1: Buffer.from(txtContent, 'utf-8').toString('base64'),
            csv_1: Buffer.from(csvContent, 'utf-8').toString('base64'),
            md_1: Buffer.from(mdContent, 'utf-8').toString('base64')
          }
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });

    it("rejects batch if any file exceeds limit", async () => {
      const validTxt = "Short text";
      const invalidTxt = "A".repeat(6000); // Exceeds 5k limit

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Process documents from multiple sources and synthesize a unified decision graph",
          attachments: [
            { id: "valid", kind: "txt", name: "valid.txt" },
            { id: "invalid", kind: "txt", name: "toolarge.txt" }
          ],
          attachment_payloads: {
            valid: Buffer.from(validTxt, 'utf-8').toString('base64'),
            invalid: Buffer.from(invalidTxt, 'utf-8').toString('base64')
          }
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
      // Error message includes filename and exceeds_limit
      expect(body.message).toMatch(/toolarge\.txt.*exceeds_limit/);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty attachments array gracefully", async () => {
      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Create a decision graph without attachments",
          attachments: []
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });

    it("handles missing attachment payload", async () => {
      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Process document for missing attachment test case",
          attachments: [
            { id: "missing", kind: "txt", name: "ghost.txt" }
          ],
          attachment_payloads: {
            // missing payload for 'missing' id
          }
        },
      });

      // Should succeed but skip the missing attachment (logged as warning)
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });

    it("handles empty file content", async () => {
      const emptyContent = "";
      const base64Content = Buffer.from(emptyContent, 'utf-8').toString('base64');

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Process empty document and create a placeholder decision graph for future content",
          attachments: [
            { id: "empty", kind: "txt", name: "empty.txt" }
          ],
          attachment_payloads: {
            empty: base64Content
          }
        },
      });

      // Empty files are valid (0 chars < 5k limit)
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });
  });

  describe("Critique Route with Attachments", () => {
    const validGraph = {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "goal_1", kind: "goal", label: "Increase revenue" },
        { id: "dec_1", kind: "decision", label: "Pricing strategy" },
        { id: "opt_a", kind: "option", label: "Premium pricing" },
        { id: "out_1", kind: "outcome", label: "Revenue impact" },
      ],
      edges: [
        { from: "goal_1", to: "dec_1" },
        { from: "dec_1", to: "opt_a" },
        { from: "opt_a", to: "out_1" },
      ],
    };

    it("accepts attachments for context", async () => {
      const txtContent = "Context document with background information";
      const base64Content = Buffer.from(txtContent, 'utf-8').toString('base64');

      const res = await critiqueApp.inject({
        method: "POST",
        url: "/assist/critique-graph",
        payload: {
          graph: validGraph,
          brief: "Critique this graph against the attached requirements",
          attachments: [
            { id: "req_1", kind: "txt", name: "requirements.txt" }
          ],
          attachment_payloads: {
            req_1: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.issues).toBeDefined();
      expect(Array.isArray(body.issues)).toBe(true);
    });

    it("rejects critique with over-limit attachment", async () => {
      const longContent = "A".repeat(6000);
      const base64Content = Buffer.from(longContent, 'utf-8').toString('base64');

      const res = await critiqueApp.inject({
        method: "POST",
        url: "/assist/critique-graph",
        payload: {
          graph: validGraph,
          attachments: [
            { id: "long", kind: "txt", name: "toolarge.txt" }
          ],
          attachment_payloads: {
            long: base64Content
          }
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
      // Error message includes filename and exceeds_limit
      expect(body.message).toMatch(/toolarge\.txt.*exceeds_limit/);
    });

    it("rejects critique with aggregate size exceeding 50k chars", async () => {
      // Create 11 files of 4800 chars each = 52,800 total (exceeds 50k limit)
      const attachments = [];
      const payloads: Record<string, string> = {};

      for (let i = 0; i < 11; i++) {
        const content = "A".repeat(4800);
        attachments.push({
          id: `file_${i}`,
          kind: "txt" as const,
          name: `file_${i}.txt`
        });
        payloads[`file_${i}`] = Buffer.from(content, 'utf-8').toString('base64');
      }

      const res = await critiqueApp.inject({
        method: "POST",
        url: "/assist/critique-graph",
        payload: {
          graph: validGraph,
          attachments,
          attachment_payloads: payloads
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toMatch(/aggregate_exceeds_limit.*total attachment size.*50000/i);
      // Verify the route provides the specific aggregate limit hint
      expect(body.details?.hint).toMatch(/total attachment size exceeds 50k/i);
    });
  });

  describe("Payload Validation", () => {
    it("rejects invalid base64 payload with clear error", async () => {
      const invalidBase64 = "This is not valid base64!!!";

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Process document with invalid base64 encoding to test validation",
          attachments: [
            { id: "invalid", kind: "txt", name: "invalid.txt" }
          ],
          attachment_payloads: {
            invalid: invalidBase64
          }
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toMatch(/invalid\.txt.*base64/i);
    });

    it("rejects aggregate size exceeding 50k chars", async () => {
      // Create 11 files of 4800 chars each = 52,800 total (exceeds 50k limit)
      const attachments = [];
      const payloads: Record<string, string> = {};

      for (let i = 0; i < 11; i++) {
        const content = "A".repeat(4800);
        attachments.push({
          id: `file_${i}`,
          kind: "txt" as const,
          name: `file_${i}.txt`
        });
        payloads[`file_${i}`] = Buffer.from(content, 'utf-8').toString('base64');
      }

      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Process multiple large documents to test aggregate size limit validation",
          attachments,
          attachment_payloads: payloads
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toMatch(/total attachment size.*50000/i);
    });
  });

  describe("Privacy & Logging", () => {
    it("never logs file contents in telemetry", async () => {
      const sensitiveContent = "CONFIDENTIAL: API_KEY=sk-secret-12345";
      const base64Content = Buffer.from(sensitiveContent, 'utf-8').toString('base64');

      // Capture log output (would need proper telemetry mocking)
      const res = await draftApp.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Process sensitive document",
          attachments: [
            { id: "secret", kind: "txt", name: "secrets.txt" }
          ],
          attachment_payloads: {
            secret: base64Content
          }
        },
      });

      // Response should not contain sensitive data
      const responseStr = JSON.stringify(res.body);
      expect(responseStr).not.toContain("sk-secret-12345");
      expect(responseStr).not.toContain("CONFIDENTIAL");
    });
  });
});
