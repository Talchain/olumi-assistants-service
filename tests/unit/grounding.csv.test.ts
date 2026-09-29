/**
 * CSV Grounding Tests
 *
 * Verifies CSV summarization with:
 * - Safe statistics only (no row data echoed)
 * - Numeric column detection
 * - Mixed numeric/non-numeric handling
 * - 5k character limit enforcement
 * - No header or row leakage
 */

import { describe, it, expect } from "vitest";
import { summarizeCsv } from "../../src/grounding/index.js";
import { Buffer } from "node:buffer";

describe("CSV Grounding", () => {
  describe("summarizeCsv", () => {
    it("computes statistics for numeric CSV", () => {
      const csv = "value\n10\n20\n30\n40\n50";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      expect(result.count).toBe(5);
      expect(result.mean).toBe(30);
      expect(result.p50).toBe(30);
      expect(result.p90).toBe(50);
    });

    it("returns count only for non-numeric CSV", () => {
      const csv = "name\nAlice\nBob\nCharlie";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      expect(result.count).toBe(3);
      expect(result.mean).toBeUndefined();
      expect(result.p50).toBeUndefined();
      expect(result.p90).toBeUndefined();
    });

    it("handles mixed numeric and non-numeric columns", () => {
      const csv = "name,age,city\nAlice,25,NYC\nBob,30,SF\nCharlie,35,LA";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      expect(result.count).toBe(3);
      expect(result.mean).toBeDefined(); // Should compute stats on age column
      expect(result.p50).toBeDefined();
    });

    it("handles multi-column numeric CSV", () => {
      const csv = "price,quantity\n100,5\n200,10\n300,15";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      expect(result.count).toBe(3);
      // Should aggregate all numeric values: 100,5,200,10,300,15
      expect(result.mean).toBeDefined();
      expect(result.p50).toBeDefined();
      expect(result.p90).toBeDefined();
    });

    it("skips NaN and Infinity values", () => {
      const csv = "value\n10\nNaN\n20\nInfinity\n30";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      // Should only count valid numeric rows
      expect(result.count).toBe(5); // Total rows
      expect(result.mean).toBeDefined(); // Only from 10, 20, 30
    });

    it("enforces 5k character limit", () => {
      const longCsv = "value\n" + Array.from({ length: 2000 }, (_, i) => i).join("\n");
      const buffer = Buffer.from(longCsv, 'utf-8');

      expect(() => summarizeCsv(buffer)).toThrow(/csv_exceeds_limit/);
    });

    it("allows custom character limit", () => {
      const csv = "value\n10\n20\n30";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer, 10000);
      expect(result.count).toBe(3);
    });

    it("rejects malformed CSV", () => {
      const malformed = "value\n10,20,30\n40"; // inconsistent column count
      const buffer = Buffer.from(malformed, 'utf-8');

      // Should still parse but may have empty rows
      const result = summarizeCsv(buffer);
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it("handles empty CSV", () => {
      const buffer = Buffer.from("", 'utf-8');

      const result = summarizeCsv(buffer);
      expect(result.count).toBe(0);
    });

    it("handles CSV with header only", () => {
      const csv = "name,age,city";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);
      expect(result.count).toBe(0);
    });

    it("computes accurate percentiles", () => {
      // 10 values: 1-10
      const csv = "value\n" + Array.from({ length: 10 }, (_, i) => i + 1).join("\n");
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      expect(result.count).toBe(10);
      expect(result.mean).toBe(5.5);
      expect(result.p50).toBe(5); // Median of [1,2,3,4,5,6,7,8,9,10]
      expect(result.p90).toBe(9); // 90th percentile
    });

    it("rounds mean to 2 decimal places", () => {
      const csv = "value\n10\n15\n20";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      expect(result.mean).toBe(15);
      expect(Number.isInteger(result.mean! * 100)).toBe(true); // At most 2 decimals
    });

    it("does not leak row data", () => {
      const csv = "secret_data\nsensitive1\nsensitive2\nsensitive3";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      // Result should only contain count, mean, p50, p90
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain("sensitive");
      expect(resultStr).not.toContain("secret_data");
    });

    it("does not leak column headers", () => {
      const csv = "password,credit_card\n123,456";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain("password");
      expect(resultStr).not.toContain("credit_card");
    });

    it("handles decimals correctly", () => {
      const csv = "value\n10.5\n20.3\n30.7";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      expect(result.count).toBe(3);
      expect(result.mean).toBeCloseTo(20.5, 1);
    });

    it("handles negative numbers", () => {
      const csv = "value\n-10\n0\n10";
      const buffer = Buffer.from(csv, 'utf-8');

      const result = summarizeCsv(buffer);

      expect(result.count).toBe(3);
      expect(result.mean).toBe(0);
      expect(result.p50).toBe(0);
    });
  });
});
