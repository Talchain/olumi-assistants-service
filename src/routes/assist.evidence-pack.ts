import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildEvidencePackRedacted } from "../utils/evidence-pack.js";
import { exportEvidencePack, getDownloadHeaders, type ExportFormat } from "../utils/evidence-export.js";
import { SERVICE_VERSION } from "../version.js";
import { buildErrorV1, zodErrorToErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { env } from "node:process";

/**
 * POST /assist/evidence-pack (v1.4.0 - PR H)
 *
 * Flag-gated route (ENABLE_EVIDENCE_PACK=false by default) that generates
 * a redacted evidence pack from draft output.
 *
 * Supports multiple export formats via query parameter:
 * - ?format=json (default, machine-readable)
 * - ?format=csv (spreadsheet-friendly)
 * - ?format=markdown (human-readable documentation)
 *
 * Returns appropriate Content-Disposition headers for browser downloads.
 */

// Input validation schema - permissive to handle varied input shapes
// The buildEvidencePackRedacted function handles missing/malformed data gracefully
const EvidencePackInputSchema = z.object({
  rationales: z.array(z.record(z.any())).optional(),
  citations: z.array(z.record(z.any())).optional(),
  csv_stats: z.array(z.record(z.any())).optional(),
});

// Query string validation for export format
const QuerySchema = z.object({
  format: z.enum(["json", "csv", "markdown"]).optional().default("json"),
});

export default async function route(app: FastifyInstance) {
  app.post("/assist/evidence-pack", async (req, reply) => {
    // Feature flag guard: return 404 if evidence pack feature is disabled
    if (env.ENABLE_EVIDENCE_PACK !== 'true') {
      reply.code(404);
      return reply.send();
    }

    const requestId = getRequestId(req);

    try {
      // Validate query parameters
      const queryResult = QuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        const errorV1 = zodErrorToErrorV1(queryResult.error, requestId);
        return reply.status(400).send(errorV1);
      }

      const { format } = queryResult.data;

      // Validate input schema
      const validationResult = EvidencePackInputSchema.safeParse(req.body);

      if (!validationResult.success) {
        const errorV1 = zodErrorToErrorV1(validationResult.error, requestId);
        return reply.status(400).send(errorV1);
      }

      // Extract rationales, citations, and CSV stats from validated input
      const { rationales, citations, csv_stats } = validationResult.data;

      // Build redacted evidence pack
      // Type cast is safe because buildEvidencePackRedacted handles any input shape
      const pack = buildEvidencePackRedacted(
        { rationales, citations, csv_stats } as any,
        SERVICE_VERSION
      );

      // V1.4.0: Export in requested format
      const content = exportEvidencePack(pack, format as ExportFormat);

      // V1.4.0: Add download headers
      const headers = getDownloadHeaders(format as ExportFormat, pack.generated_at);

      app.log.info({
        request_id: requestId,
        format,
        document_citations: pack.document_citations.length,
        csv_statistics: pack.csv_statistics.length,
        rationales_with_provenance: pack.rationales_with_provenance.length,
      }, "Evidence pack generated");

      // Set headers and return content
      reply.headers(headers);
      return reply.send(content);
    } catch (error) {
      app.log.error({ error, request_id: requestId }, "Evidence pack generation failed");

      const errorV1 = buildErrorV1(
        'INTERNAL',
        'Failed to generate evidence pack',
        undefined,
        requestId
      );
      return reply.status(500).send(errorV1);
    }
  });
}
