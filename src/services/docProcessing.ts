import { Buffer } from "node:buffer";
import pdf from "pdf-parse";
import Papa from "papaparse";

export type DocPreview = {
  source: string;
  type: "pdf" | "csv" | "txt" | "md";
  preview: string;
  locationHint?: string; // Human-readable hint for LLM (e.g., "page refs required")
  locationMetadata?: {
    // For structured citations
    totalPages?: number; // PDF: total pages
    totalRows?: number; // CSV: total rows
    totalLines?: number; // TXT/MD: total lines
  };
};

const CAP = 5000;

const cap = (text: string) => text.slice(0, CAP);

export async function toPreview(kind: string, name: string, buf: Buffer): Promise<DocPreview> {
  if (kind === "pdf") {
    const data = await pdf(buf);

    // Add page markers for deterministic citations
    // NOTE: pdf-parse concatenates all pages without boundaries
    // We estimate page breaks based on actual page count for better accuracy
    const text = data.text;
    const totalPages = data.numpages;
    const avgCharsPerPage = Math.ceil(text.length / totalPages);

    // Build page-marked preview up to cap
    let preview = "";
    let currentPage = 1;

    for (let i = 0; i < text.length && preview.length < CAP; i += avgCharsPerPage) {
      const chunk = text.slice(i, i + avgCharsPerPage);
      const pageText = `[PAGE ${currentPage}]\n${chunk}\n\n`;

      if (preview.length + pageText.length > CAP) {
        // Add partial page to reach cap
        const remaining = CAP - preview.length;
        preview += pageText.slice(0, remaining);
        break;
      }

      preview += pageText;
      currentPage++;
    }

    return {
      source: name,
      type: "pdf",
      preview: preview.slice(0, CAP), // Final safety cap
      locationHint: "cite with page numbers (NOTE: page breaks are estimated from character distribution)",
      locationMetadata: {
        totalPages: data.numpages,
      },
    };
  }
  if (kind === "csv") {
    const text = buf.toString("utf8");
    const parsed = Papa.parse(text, { header: true });
    const rows = (parsed.data as Record<string, string>[]).filter(Boolean);
    const cols = parsed.meta.fields || [];
    const numericCols = cols
      .filter((c: string) =>
        rows.some((r) => {
          const value = Number(r[c as keyof typeof r]);
          return !Number.isNaN(value) && r[c as keyof typeof r] !== "";
        })
      )
      .slice(0, 6);
    const headline = `CSV ${name}: rows=${rows.length}, cols=${cols.length}, numeric=${numericCols.join(", ")}`;

    // Add row numbers for deterministic citations (header is row 1, data starts at row 2)
    // Build preview incrementally until cap is reached - no arbitrary row limit
    let preview = `${headline}\n[ROW 1] ${JSON.stringify(cols)}\n`;
    let rowNum = 2;

    for (const row of rows) {
      const rowText = `[ROW ${rowNum}] ${JSON.stringify(row)}\n`;
      if (preview.length + rowText.length > CAP) break;
      preview += rowText;
      rowNum++;
    }

    return {
      source: name,
      type: "csv",
      preview: preview.slice(0, CAP), // Final safety cap
      locationHint: "cite with row numbers when referencing data",
      locationMetadata: {
        totalRows: rows.length,
      },
    };
  }
  const text = buf.toString("utf8");
  const lines = text.split("\n");

  // Add line numbers for deterministic citations
  // Build preview incrementally until cap is reached - no arbitrary line limit
  let preview = "";
  let lineNum = 1;

  for (const line of lines) {
    const lineText = `${lineNum}: ${line}\n`;
    if (preview.length + lineText.length > CAP) break;
    preview += lineText;
    lineNum++;
  }

  return {
    source: name,
    type: kind as DocPreview["type"],
    preview: preview.slice(0, CAP), // Final safety cap
    locationHint: "cite with line numbers if needed",
    locationMetadata: {
      totalLines: lines.length,
    },
  };
}
