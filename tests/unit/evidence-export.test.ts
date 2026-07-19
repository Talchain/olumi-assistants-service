/**
 * Unit tests for the SALVAGED, INERT evidence-pack export formatters.
 *
 * Written fresh 2026-07-19. PR #20's own suite was
 * `tests/integration/evidence-pack.test.ts` — 520 lines driving the
 * `/assist/evidence-pack` HTTP route behind `ENABLE_EVIDENCE_PACK`. That suite
 * could not be salvaged because the route wiring was deliberately not
 * salvaged: it exercised the endpoint, not the formatters. These tests cover
 * the same formatting behaviour directly against the pure functions.
 */

import { describe, it, expect } from "vitest";
import {
  toCSV,
  toMarkdown,
  getDownloadHeaders,
} from "../../src/utils/evidence-export.js";

type Pack = Parameters<typeof toCSV>[0];

function makePack(overrides: Partial<Pack> = {}): Pack {
  return {
    schema: "evidence-pack/v1",
    generated_at: "2026-07-19T10:30:00.000Z",
    service_version: "1.4.0",
    document_citations: [],
    csv_statistics: [],
    rationales_with_provenance: [],
    privacy_notice: "No personal data retained.",
    ...overrides,
  } as Pack;
}

describe("evidence-export (salvaged, inert)", () => {
  describe("toCSV", () => {
    it("emits the three labelled sections plus the privacy notice", () => {
      const csv = toCSV(makePack());

      expect(csv).toContain("Evidence Pack Export");
      expect(csv).toContain("Generated: 2026-07-19T10:30:00.000Z");
      expect(csv).toContain("Service Version: 1.4.0");
      expect(csv).toContain("# Document Citations");
      expect(csv).toContain("# CSV Statistics");
      expect(csv).toContain("# Rationales with Provenance");
      expect(csv).toContain("# Privacy Notice");
    });

    it("writes a citation row under the citation header", () => {
      const csv = toCSV(
        makePack({
          document_citations: [
            {
              source: "report.pdf",
              location: "p.4",
              quote: "growth slowed",
              provenance_source: "upload",
            },
          ],
        })
      );

      expect(csv).toContain("Source,Location,Quote,Provenance Source");
      expect(csv).toContain("report.pdf,p.4,growth slowed,upload");
    });

    it("quotes fields containing a comma and doubles internal quotes", () => {
      const csv = toCSV(
        makePack({
          document_citations: [
            { source: 'a,b', location: 'say "hi"', quote: "", provenance_source: "" },
          ],
        })
      );

      expect(csv).toContain('"a,b"');
      expect(csv).toContain('"say ""hi"""');
    });

    it("quotes fields containing a newline so rows stay parseable", () => {
      const csv = toCSV(
        makePack({
          document_citations: [
            { source: "one\ntwo", location: "", quote: "", provenance_source: "" },
          ],
        })
      );

      expect(csv).toContain('"one\ntwo"');
    });

    it("defaults absent row/column counts to 0 and semicolon-joins statistics", () => {
      const csv = toCSV(
        makePack({
          csv_statistics: [
            { filename: "data.csv", statistics: { mean: 1, max: 2 } },
          ],
        })
      );

      expect(csv).toContain("data.csv,0,0,");
      // Commas inside the JSON blob are swapped for semicolons so the field
      // does not split the row.
      expect(csv).toContain("mean");
      expect(csv).not.toContain('{"mean":1,"max":2}');
    });

    it("renders rationale rows with their provenance columns", () => {
      const csv = toCSV(
        makePack({
          rationales_with_provenance: [
            {
              target: "option-a",
              why: "cheapest",
              provenance_source: "doc-1",
              quote: "£4k",
              location: "p.1",
            },
          ],
        })
      );

      expect(csv).toContain("Target,Why,Provenance Source,Quote,Location");
      expect(csv).toContain("option-a,cheapest,doc-1,£4k,p.1");
    });
  });

  describe("toMarkdown", () => {
    it("emits the header block with schema and version", () => {
      const md = toMarkdown(makePack());

      expect(md).toContain("# Evidence Pack Export");
      expect(md).toContain("**Generated:** 2026-07-19T10:30:00.000Z");
      expect(md).toContain("**Service Version:** 1.4.0");
      expect(md).toContain("**Schema:** evidence-pack/v1");
    });

    it("uses an italic placeholder rather than an empty table when there are no citations", () => {
      const md = toMarkdown(makePack());

      expect(md).toContain("## Document Citations");
      expect(md).toContain("_No document citations available._");
      expect(md).not.toContain("| Source | Location | Quote | Provenance |");
    });

    it("renders a citation table when citations exist", () => {
      const md = toMarkdown(
        makePack({
          document_citations: [
            {
              source: "report.pdf",
              location: "p.4",
              quote: "growth slowed",
              provenance_source: "upload",
            },
          ],
        })
      );

      expect(md).toContain("| Source | Location | Quote | Provenance |");
      expect(md).toContain("| report.pdf | p.4 | growth slowed | upload |");
    });

    it("substitutes a dash for absent optional citation fields", () => {
      const md = toMarkdown(
        makePack({ document_citations: [{ source: "report.pdf" }] })
      );

      expect(md).toContain("| report.pdf | - | - | - |");
    });

    it("escapes pipes so a value cannot forge an extra table column", () => {
      const md = toMarkdown(
        makePack({ document_citations: [{ source: "a|b" }] })
      );

      expect(md).not.toContain("| a|b |");
      expect(md).toContain("\\|");
    });

    it("escapes backticks so a value cannot open a code span", () => {
      const md = toMarkdown(
        makePack({ document_citations: [{ source: "use `rm`" }] })
      );

      expect(md).toContain("\\`");
    });
  });

  describe("getDownloadHeaders", () => {
    it("returns the csv mime type and a .csv attachment filename", () => {
      const h = getDownloadHeaders("csv", "2026-07-19T10:30:00.000Z");

      expect(h["Content-Type"]).toBe("text/csv");
      expect(h["Content-Disposition"]).toBe(
        'attachment; filename="evidence-pack-2026-07-19.csv"'
      );
    });

    it("maps the markdown format to text/markdown and a .md extension", () => {
      const h = getDownloadHeaders("markdown", "2026-07-19T10:30:00.000Z");

      expect(h["Content-Type"]).toBe("text/markdown");
      expect(h["Content-Disposition"]).toContain("evidence-pack-2026-07-19.md");
    });

    it("maps the json format to application/json and a .json extension", () => {
      const h = getDownloadHeaders("json", "2026-07-19T10:30:00.000Z");

      expect(h["Content-Type"]).toBe("application/json");
      expect(h["Content-Disposition"]).toContain(
        "evidence-pack-2026-07-19.json"
      );
    });

    it("dates the filename from the supplied timestamp, not from now", () => {
      const h = getDownloadHeaders("json", "2020-01-02T23:59:59.000Z");

      expect(h["Content-Disposition"]).toContain("evidence-pack-2020-01-02");
    });
  });
});
