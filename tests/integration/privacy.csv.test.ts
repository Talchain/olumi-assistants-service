import { describe, it, expect } from "vitest";
import { redactCsvData, safeLog } from "../../src/utils/redaction.js";
import { buildEvidencePackRedacted } from "../../src/utils/evidence-pack.js";

describe("CSV privacy guarantees (integration)", () => {
  describe("redaction of PII in CSV data", () => {
    it("should remove all row data containing PII", () => {
      const csvOutput = {
        grounding_results: {
          csv_data: [
            {
              filename: "employees.csv",
              rows: [
                { name: "Alice Johnson", salary: 75000, department: "Engineering" },
                { name: "Bob Smith", salary: 82000, department: "Sales" },
                { name: "Charlie Davis", salary: 68000, department: "Marketing" },
              ],
              statistics: {
                salary: {
                  count: 3,
                  mean: 75000,
                  median: 75000,
                  p50: 75000,
                  p90: 82000,
                  p95: 82000,
                  min: 68000,
                  max: 82000,
                },
              },
            },
          ],
        },
      };

      const redacted = redactCsvData(csvOutput);

      // PII should be removed
      const json = JSON.stringify(redacted);
      expect(json).not.toContain("Alice");
      expect(json).not.toContain("Bob");
      expect(json).not.toContain("Charlie");
      expect(json).not.toContain("Johnson");
      expect(json).not.toContain("Smith");
      expect(json).not.toContain("Davis");

      // Statistics should be preserved
      expect(json).toContain("75000"); // mean
      expect(json).toContain("82000"); // max
      expect(json).toContain("68000"); // min
    });

    it("should remove rows field entirely", () => {
      const data = {
        csv: {
          rows: [
            { ssn: "123-45-6789", name: "Alice" },
            { ssn: "987-65-4321", name: "Bob" },
          ],
          count: 2,
        },
      };

      const redacted = redactCsvData(data);

      expect(redacted.csv.rows).toBeUndefined();
      expect(redacted.csv.count).toBe(2);
    });

    it("should preserve safe aggregate statistics", () => {
      const data = {
        csv_stats: {
          revenue: {
            count: 1000,
            mean: 50000,
            median: 48000,
            p50: 48000,
            p90: 75000,
            p95: 85000,
            p99: 95000,
            min: 1000,
            max: 150000,
            std: 20000,
            variance: 400000000,
          },
        },
      };

      const redacted = redactCsvData(data);

      expect(redacted.csv_stats.revenue.count).toBe(1000);
      expect(redacted.csv_stats.revenue.mean).toBe(50000);
      expect(redacted.csv_stats.revenue.p95).toBe(85000);
      expect(redacted.csv_stats.revenue.std).toBe(20000);
    });

    it("should remove 'data', 'values', 'raw_data' fields", () => {
      const input = {
        analysis: {
          data: [1, 2, 3, 4, 5],
          values: ["sensitive", "info"],
          raw_data: "confidential",
          count: 5,
          mean: 3,
        },
      };

      const redacted = redactCsvData(input);

      expect(redacted.analysis.data).toBeUndefined();
      expect(redacted.analysis.values).toBeUndefined();
      expect(redacted.analysis.raw_data).toBeUndefined();
      expect(redacted.analysis.count).toBe(5);
      expect(redacted.analysis.mean).toBe(3);
    });
  });

  describe("safeLog integration with CSV data", () => {
    it("should apply CSV redaction when logging", () => {
      const logPayload = {
        request_id: "req-123",
        body: {
          brief: "Analyze sales data",
          attachments: [
            {
              filename: "sales.csv",
              content: "bmFtZSxyZXZlbnVlCkFsaWNlLDEwMDAwCkJvYiwxNTAwMA==", // base64
            },
          ],
        },
        grounding: {
          csv_data: [
            {
              rows: [
                { name: "Alice", revenue: 10000 },
                { name: "Bob", revenue: 15000 },
              ],
              statistics: {
                revenue: { count: 2, mean: 12500 },
              },
            },
          ],
        },
      };

      const safe = safeLog(logPayload);

      // Check CSV rows removed
      expect(safe.grounding.csv_data[0].rows).toBeUndefined();

      // Check attachment content redacted
      expect(safe.body.attachments[0].content).toMatch(/^\[REDACTED\]:/);

      // Check statistics preserved
      expect(safe.grounding.csv_data[0].statistics.revenue.mean).toBe(12500);

      // Ensure redacted flag is set
      expect(safe.redacted).toBe(true);
    });

    it("should ensure no PII leakage in nested structures", () => {
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              csv_data: {
                rows: [{ email: "alice@example.com", phone: "555-1234" }],
                stats: { count: 1 },
              },
            },
          },
        },
      };

      const safe = safeLog(deeplyNested);
      const json = JSON.stringify(safe);

      expect(json).not.toContain("alice@example.com");
      expect(json).not.toContain("555-1234");
      expect(safe.level1.level2.level3.csv_data.rows).toBeUndefined();
      expect(safe.level1.level2.level3.csv_data.stats.count).toBe(1);
    });
  });

  describe("evidence pack CSV privacy", () => {
    it("should never include CSV rows in evidence pack", () => {
      const output = {
        csv_stats: [
          {
            filename: "customers.csv",
            rows: [
              { name: "Alice", email: "alice@example.com", revenue: 50000 },
              { name: "Bob", email: "bob@example.com", revenue: 75000 },
            ],
            row_count: 2,
            column_count: 3,
            statistics: {
              revenue: {
                count: 2,
                mean: 62500,
                min: 50000,
                max: 75000,
              },
            },
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");
      const json = JSON.stringify(pack);

      // PII should not be in evidence pack
      expect(json).not.toContain("Alice");
      expect(json).not.toContain("Bob");
      expect(json).not.toContain("alice@example.com");
      expect(json).not.toContain("bob@example.com");

      // Statistics should be present
      expect(pack.csv_statistics[0].row_count).toBe(2);
      expect(pack.csv_statistics[0].statistics!.revenue.mean).toBe(62500);
    });

    it("should include privacy notice in evidence pack", () => {
      const pack = buildEvidencePackRedacted({}, "1.1.1");

      expect(pack.privacy_notice).toContain("Individual CSV row values");
      expect(pack.privacy_notice).toContain("Personally identifiable information");
      expect(pack.privacy_notice).toContain("Aggregated CSV statistics");
    });

    it("should only include whitelisted statistical fields", () => {
      const output = {
        csv_stats: [
          {
            filename: "data.csv",
            statistics: {
              metric: {
                count: 100,
                mean: 50,
                // Safe fields:
                median: 48,
                p50: 48,
                p90: 75,
                p95: 85,
                p99: 95,
                min: 10,
                max: 100,
                // Unsafe fields that should be filtered:
                raw_values: [1, 2, 3],
                individual_data: "sensitive",
              } as any,
            },
          },
        ],
      };

      const pack = buildEvidencePackRedacted(output, "1.1.1");

      const stats = pack.csv_statistics[0].statistics!.metric;
      expect(stats.count).toBe(100);
      expect(stats.mean).toBe(50);
      expect(stats.p95).toBe(85);

      // Unsafe fields should be excluded
      expect(stats).not.toHaveProperty("raw_values");
      expect(stats).not.toHaveProperty("individual_data");
    });
  });

  describe("compliance verification", () => {
    it("should pass GDPR-style privacy check (no personal data in logs)", () => {
      const personalData = {
        user_upload: {
          csv_file: {
            filename: "employees.csv",
            rows: [
              {
                first_name: "Alice",
                last_name: "Johnson",
                email: "alice.johnson@company.com",
                phone: "+1-555-0123",
                ssn: "123-45-6789",
                address: "123 Main St, Springfield",
                salary: 85000,
              },
            ],
            statistics: {
              salary: { mean: 85000, count: 1 },
            },
          },
        },
      };

      const safe = safeLog(personalData);
      const json = JSON.stringify(safe);

      // Verify NO personal identifiers are present
      const piiTerms = [
        "Alice",
        "Johnson",
        "alice.johnson@company.com",
        "555-0123",
        "123-45-6789",
        "123 Main St",
        "Springfield",
      ];

      for (const term of piiTerms) {
        expect(json).not.toContain(term);
      }

      // Statistics should still be present
      expect(json).toContain("85000");
      expect(json).toContain("mean");
    });

    it("should handle edge case: CSV with only PII columns", () => {
      const piiOnlyData = {
        csv: {
          rows: [
            { name: "Alice", email: "alice@example.com" },
            { name: "Bob", email: "bob@example.com" },
          ],
          row_count: 2,
        },
      };

      const redacted = redactCsvData(piiOnlyData);
      const json = JSON.stringify(redacted);

      expect(json).not.toContain("Alice");
      expect(json).not.toContain("Bob");
      expect(json).not.toContain("alice@example.com");
      expect(json).not.toContain("bob@example.com");

      // Only row_count should remain
      expect(redacted.csv.row_count).toBe(2);
      expect(redacted.csv.rows).toBeUndefined();
    });

    it("should handle CSV with numeric IDs (borderline PII)", () => {
      const data = {
        csv: {
          rows: [
            { customer_id: 12345, revenue: 50000 },
            { customer_id: 67890, revenue: 75000 },
          ],
          statistics: {
            revenue: { count: 2, mean: 62500 },
          },
        },
      };

      const redacted = redactCsvData(data);

      // Rows should be removed (even with numeric IDs)
      expect(redacted.csv.rows).toBeUndefined();

      // Statistics preserved
      expect(redacted.csv.statistics.revenue.mean).toBe(62500);
    });
  });

  describe("multi-file CSV privacy", () => {
    it("should redact all CSV files in a multi-attachment request", () => {
      const multiFileData = {
        grounding: {
          csv_data: [
            {
              filename: "file1.csv",
              rows: [{ name: "Alice", value: 100 }],
              statistics: { value: { mean: 100 } },
            },
            {
              filename: "file2.csv",
              rows: [{ name: "Bob", value: 200 }],
              statistics: { value: { mean: 200 } },
            },
            {
              filename: "file3.csv",
              rows: [{ name: "Charlie", value: 300 }],
              statistics: { value: { mean: 300 } },
            },
          ],
        },
      };

      const safe = safeLog(multiFileData);
      const json = JSON.stringify(safe);

      // No names should appear
      expect(json).not.toContain("Alice");
      expect(json).not.toContain("Bob");
      expect(json).not.toContain("Charlie");

      // All statistics should be preserved
      expect(safe.grounding.csv_data[0].statistics.value.mean).toBe(100);
      expect(safe.grounding.csv_data[1].statistics.value.mean).toBe(200);
      expect(safe.grounding.csv_data[2].statistics.value.mean).toBe(300);
    });
  });
});
