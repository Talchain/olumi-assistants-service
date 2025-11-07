/**
 * Evidence Pack Builder (Redacted)
 *
 * Creates a downloadable JSON evidence pack containing:
 * - Document citations with locations and truncated quotes (≤100 chars)
 * - Aggregated CSV statistics only (never row values)
 * - No base64 contents or raw file text
 *
 * This provides auditable provenance without exposing PII.
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

interface CsvStatistics {
  filename: string;
  row_count?: number;
  column_count?: number;
  statistics?: Record<string, {
    count?: number;
    mean?: number;
    median?: number;
    p50?: number;
    p90?: number;
    p95?: number;
    p99?: number;
    min?: number;
    max?: number;
  }>;
}

interface EvidencePack {
  schema: 'evidence_pack.v1';
  generated_at: string;
  service_version: string;
  document_citations: Citation[];
  csv_statistics: CsvStatistics[];
  rationales_with_provenance: Rationale[];
  privacy_notice: string;
}

const MAX_QUOTE_LENGTH = 100;

const PRIVACY_NOTICE = `
This evidence pack contains only:
- Document citations with truncated quotes (max 100 characters)
- Aggregated CSV statistics (count, mean, percentiles)
- Rationales with provenance references

It does NOT contain:
- Raw file contents or base64 data
- Individual CSV row values
- Full text extracts
- Personally identifiable information (PII)
`.trim();

/**
 * Truncate quote to maximum length
 */
function truncateQuote(quote: string | undefined): string | undefined {
  if (!quote) return undefined;
  if (quote.length <= MAX_QUOTE_LENGTH) return quote;
  return quote.substring(0, MAX_QUOTE_LENGTH) + '...';
}

/**
 * Build a redacted evidence pack from draft output
 *
 * @param output Draft graph output with rationales and citations
 * @param serviceVersion Current service version
 * @returns Redacted evidence pack
 */
export function buildEvidencePackRedacted(
  output: {
    rationales?: Rationale[];
    citations?: Citation[];
    csv_stats?: CsvStatistics[];
  },
  serviceVersion: string = '1.1.0'
): EvidencePack {
  const pack: EvidencePack = {
    schema: 'evidence_pack.v1',
    generated_at: new Date().toISOString(),
    service_version: serviceVersion,
    document_citations: [],
    csv_statistics: [],
    rationales_with_provenance: [],
    privacy_notice: PRIVACY_NOTICE,
  };

  // Extract document citations
  if (output.citations && Array.isArray(output.citations)) {
    pack.document_citations = output.citations.map((cit: Citation) => ({
      source: cit.source,
      location: cit.location,
      quote: truncateQuote(cit.quote),
      provenance_source: cit.provenance_source,
    }));
  }

  // Extract CSV statistics (never row data)
  if (output.csv_stats && Array.isArray(output.csv_stats)) {
    pack.csv_statistics = output.csv_stats.map((stats: CsvStatistics) => {
      const redacted: CsvStatistics = {
        filename: stats.filename,
        row_count: stats.row_count,
        column_count: stats.column_count,
      };

      // Only include safe statistical aggregates
      if (stats.statistics) {
        redacted.statistics = {};
        for (const [key, value] of Object.entries(stats.statistics)) {
          // Whitelist safe fields
          const safeValue: Record<string, unknown> = {};
          if (typeof value === 'object' && value !== null) {
            const allowedKeys = ['count', 'mean', 'median', 'p50', 'p90', 'p95', 'p99', 'min', 'max'];
            for (const k of allowedKeys) {
              if (k in value) {
                safeValue[k] = (value as any)[k];
              }
            }
          }
          redacted.statistics[key] = safeValue;
        }
      }

      return redacted;
    });
  }

  // Extract rationales with provenance (truncate quotes)
  if (output.rationales && Array.isArray(output.rationales)) {
    pack.rationales_with_provenance = output.rationales
      .filter((rat: Rationale) => rat.provenance_source) // Only include those with provenance
      .map((rat: Rationale) => ({
        target: rat.target,
        why: rat.why,
        provenance_source: rat.provenance_source,
        quote: truncateQuote(rat.quote),
        location: rat.location,
      }));
  }

  return pack;
}
