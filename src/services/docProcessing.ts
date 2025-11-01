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
    // Estimate ~2000 chars per page (rough heuristic)
    const CHARS_PER_PAGE = 2000;
    const text = data.text;
    const estimatedPages: string[] = [];

    for (let i = 0; i < text.length; i += CHARS_PER_PAGE) {
      const pageNum = Math.floor(i / CHARS_PER_PAGE) + 1;
      const chunk = text.slice(i, i + CHARS_PER_PAGE);
      estimatedPages.push(`[PAGE ${pageNum}]\n${chunk}`);
    }

    const previewWithMarkers = estimatedPages.slice(0, 3).join("\n\n"); // First ~3 pages

    return {
      source: name,
      type: "pdf",
      preview: cap(previewWithMarkers),
      locationHint: "cite with page numbers (e.g., page 3)",
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
    const rowsWithNumbers = rows
      .slice(0, 50) // First 50 rows
      .map((row, idx) => `[ROW ${idx + 2}] ${JSON.stringify(row)}`)
      .join("\n");

    const previewWithRows = `${headline}\n[ROW 1] ${JSON.stringify(cols)}\n${rowsWithNumbers}`;

    return {
      source: name,
      type: "csv",
      preview: cap(previewWithRows),
      locationHint: "cite with row numbers when referencing data",
      locationMetadata: {
        totalRows: rows.length,
      },
    };
  }
  const text = buf.toString("utf8");
  const lines = text.split("\n");

  // Add line numbers for deterministic citations
  const linesWithNumbers = lines
    .slice(0, 200) // First 200 lines
    .map((line, idx) => `${idx + 1}: ${line}`)
    .join("\n");

  return {
    source: name,
    type: kind as DocPreview["type"],
    preview: cap(linesWithNumbers),
    locationHint: "cite with line numbers if needed",
    locationMetadata: {
      totalLines: lines.length,
    },
  };
}
