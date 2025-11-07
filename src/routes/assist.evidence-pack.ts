import type { FastifyInstance } from "fastify";
import { buildEvidencePackRedacted } from "../utils/evidence-pack.js";
import { SERVICE_VERSION } from "../version.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { env } from "node:process";

/**
 * POST /assist/evidence-pack
 *
 * Flag-gated route (ENABLE_EVIDENCE_PACK=false by default) that generates
 * a redacted evidence pack from draft output.
 *
 * This is a hook for UI download functionality, not persistent storage.
 */
export default async function route(app: FastifyInstance) {
  app.post("/assist/evidence-pack", async (req, reply) => {
    // Feature flag guard: return 404 if evidence pack feature is disabled
    if (env.ENABLE_EVIDENCE_PACK !== 'true') {
      reply.code(404);
      return reply.send();
    }

    const requestId = getRequestId(req);

    try {
      // Extract rationales, citations, and CSV stats from request body
      const { rationales, citations, csv_stats } = req.body as any;

      // Build redacted evidence pack
      const pack = buildEvidencePackRedacted(
        { rationales, citations, csv_stats },
        SERVICE_VERSION
      );

      app.log.info({
        request_id: requestId,
        document_citations: pack.document_citations.length,
        csv_statistics: pack.csv_statistics.length,
        rationales_with_provenance: pack.rationales_with_provenance.length,
      }, "Evidence pack generated");

      return reply.send(pack);
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
