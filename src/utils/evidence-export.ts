/**
 * Evidence Pack Export Formats (v1.4.0 - PR H)
 *
 * Converts evidence packs to various export formats:
 * - JSON (default, machine-readable)
 * - CSV (spreadsheet-friendly)
 * - Markdown (human-readable documentation)
 *
 * Supports download headers for browser downloads.
 */

interface Citation {
  source: string;
  location?: string;
  quote?: string;
  provenance_source?: string;
}

interface Rationale {
  target: string;
  why: string;
  provenance_source?: string;
  quote?: string;
  location?: string;
}

interface CsvStatistic {
  filename: string;
  row_count?: number;
  column_count?: number;
  statistics?: Record<string, unknown>;
}

interface EvidencePack {
  schema: string;
  generated_at: string;
  service_version: string;
  document_citations: Citation[];
  csv_statistics: CsvStatistic[];
  rationales_with_provenance: Rationale[];
  privacy_notice: string;
}

export type ExportFormat = "json" | "csv" | "markdown";

/**
 * Convert evidence pack to CSV format
 *
 * Creates three sections:
 * 1. Document Citations
 * 2. CSV Statistics
 * 3. Rationales with Provenance
 */
export function toCSV(pack: EvidencePack): string {
  const lines: string[] = [];

  // Header
  lines.push("Evidence Pack Export");
  lines.push(`Generated: ${pack.generated_at}`);
  lines.push(`Service Version: ${pack.service_version}`);
  lines.push("");

  // Document Citations section
  lines.push("# Document Citations");
  lines.push("Source,Location,Quote,Provenance Source");

  for (const citation of pack.document_citations) {
    const row = [
      escapeCSV(citation.source),
      escapeCSV(citation.location || ""),
      escapeCSV(citation.quote || ""),
      escapeCSV(citation.provenance_source || ""),
    ];
    lines.push(row.join(","));
  }

  lines.push("");

  // CSV Statistics section
  lines.push("# CSV Statistics");
  lines.push("Filename,Row Count,Column Count,Statistics");

  for (const stat of pack.csv_statistics) {
    const statsStr = stat.statistics
      ? JSON.stringify(stat.statistics).replace(/,/g, ";")
      : "";
    const row = [
      escapeCSV(stat.filename),
      String(stat.row_count || 0),
      String(stat.column_count || 0),
      escapeCSV(statsStr),
    ];
    lines.push(row.join(","));
  }

  lines.push("");

  // Rationales section
  lines.push("# Rationales with Provenance");
  lines.push("Target,Why,Provenance Source,Quote,Location");

  for (const rationale of pack.rationales_with_provenance) {
    const row = [
      escapeCSV(rationale.target),
      escapeCSV(rationale.why),
      escapeCSV(rationale.provenance_source || ""),
      escapeCSV(rationale.quote || ""),
      escapeCSV(rationale.location || ""),
    ];
    lines.push(row.join(","));
  }

  lines.push("");
  lines.push("# Privacy Notice");
  lines.push(escapeCSV(pack.privacy_notice));

  return lines.join("\n");
}

/**
 * Convert evidence pack to Markdown format
 *
 * Creates a human-readable document with sections and tables.
 */
export function toMarkdown(pack: EvidencePack): string {
  const lines: string[] = [];

  // Header
  lines.push("# Evidence Pack Export");
  lines.push("");
  lines.push(`**Generated:** ${pack.generated_at}`);
  lines.push(`**Service Version:** ${pack.service_version}`);
  lines.push(`**Schema:** ${pack.schema}`);
  lines.push("");

  // Document Citations
  lines.push("## Document Citations");
  lines.push("");

  if (pack.document_citations.length === 0) {
    lines.push("_No document citations available._");
  } else {
    lines.push("| Source | Location | Quote | Provenance |");
    lines.push("|--------|----------|-------|------------|");

    for (const citation of pack.document_citations) {
      const row = [
        escapeMarkdown(citation.source),
        escapeMarkdown(citation.location || "-"),
        escapeMarkdown(citation.quote || "-"),
        escapeMarkdown(citation.provenance_source || "-"),
      ];
      lines.push(`| ${row.join(" | ")} |`);
    }
  }

  lines.push("");

  // CSV Statistics
  lines.push("## CSV Statistics");
  lines.push("");

  if (pack.csv_statistics.length === 0) {
    lines.push("_No CSV statistics available._");
  } else {
    for (const stat of pack.csv_statistics) {
      lines.push(`### ${escapeMarkdown(stat.filename)}`);
      lines.push("");
      lines.push(`- **Rows:** ${stat.row_count || 0}`);
      lines.push(`- **Columns:** ${stat.column_count || 0}`);

      if (stat.statistics && Object.keys(stat.statistics).length > 0) {
        lines.push("- **Statistics:**");
        for (const [key, value] of Object.entries(stat.statistics)) {
          lines.push(`  - \`${escapeMarkdown(key)}\`: ${JSON.stringify(value)}`);
        }
      }

      lines.push("");
    }
  }

  // Rationales
  lines.push("## Rationales with Provenance");
  lines.push("");

  if (pack.rationales_with_provenance.length === 0) {
    lines.push("_No rationales with provenance available._");
  } else {
    for (let i = 0; i < pack.rationales_with_provenance.length; i++) {
      const rationale = pack.rationales_with_provenance[i];
      lines.push(`### ${i + 1}. ${escapeMarkdown(rationale.target)}`);
      lines.push("");
      lines.push(`**Reasoning:** ${escapeMarkdown(rationale.why)}`);
      lines.push("");

      if (rationale.provenance_source) {
        lines.push(`**Provenance:** \`${escapeMarkdown(rationale.provenance_source)}\``);
      }

      if (rationale.quote) {
        lines.push(`**Quote:** "${escapeMarkdown(rationale.quote)}"`);
      }

      if (rationale.location) {
        lines.push(`**Location:** ${escapeMarkdown(rationale.location)}`);
      }

      lines.push("");
    }
  }

  // Privacy Notice
  lines.push("## Privacy Notice");
  lines.push("");
  lines.push(pack.privacy_notice);
  lines.push("");

  return lines.join("\n");
}

/**
 * Escape CSV field value
 *
 * Wraps in quotes if contains comma, quote, or newline.
 * Doubles internal quotes.
 */
function escapeCSV(value: string): string {
  if (!value) return "";

  // If contains comma, quote, or newline, wrap in quotes
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    // Double any internal quotes
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return value;
}

/**
 * Escape markdown special characters
 *
 * Prevents markdown rendering issues with pipes, backticks, etc.
 */
function escapeMarkdown(value: string): string {
  if (!value) return "";

  return value
    .replace(/\|/g, "\\|")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`");
}

/**
 * Generate Content-Disposition header for download
 *
 * @param format Export format (json, csv, markdown)
 * @param timestamp ISO timestamp for filename
 */
export function getDownloadHeaders(
  format: ExportFormat,
  timestamp: string
): Record<string, string> {
  const date = new Date(timestamp).toISOString().split("T")[0]; // YYYY-MM-DD
  const extensions: Record<ExportFormat, string> = {
    json: "json",
    csv: "csv",
    markdown: "md",
  };

  const mimeTypes: Record<ExportFormat, string> = {
    json: "application/json",
    csv: "text/csv",
    markdown: "text/markdown",
  };

  const filename = `evidence-pack-${date}.${extensions[format]}`;

  return {
    "Content-Type": mimeTypes[format],
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}

/**
 * Export evidence pack in requested format
 *
 * @param pack Evidence pack to export
 * @param format Desired export format
 * @returns Formatted content string
 */
export function exportEvidencePack(
  pack: EvidencePack,
  format: ExportFormat = "json"
): string {
  switch (format) {
    case "csv":
      return toCSV(pack);
    case "markdown":
      return toMarkdown(pack);
    case "json":
    default:
      return JSON.stringify(pack, null, 2);
  }
}
