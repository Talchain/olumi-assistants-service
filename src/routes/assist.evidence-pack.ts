import type { FastifyInstance } from "fastify";
import { z } from "zod";
import archiver from "archiver";
import { buildEvidencePackRedacted } from "../utils/evidence-pack.js";
import { SERVICE_VERSION } from "../version.js";
import { buildErrorV1, zodErrorToErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { redactObject, type RedactionMode, detectPII } from "../utils/pii-guard.js";
import { signShareToken, type ShareTokenPayload } from "../utils/share-token.js";
import { storeShare } from "../utils/share-storage.js";
import { env } from "node:process";
import { randomBytes } from "node:crypto";
import { log } from "../utils/telemetry.js";

/**
 * POST /assist/evidence-pack (v2)
 *
 * Flag-gated route (ENABLE_EVIDENCE_PACK=false by default) that generates
 * a redacted evidence pack from draft output.
 *
 * v2 enhancements:
 * - Returns ZIP file (not JSON)
 * - PII redaction with modes: standard|strict|off
 * - Optional 7-day share URL when SHARE_REVIEW_ENABLED=true
 * - Includes redaction_summary.json in ZIP
 */

// Input validation schema
const EvidencePackInputSchema = z.object({
  rationales: z.array(z.record(z.any())).optional(),
  citations: z.array(z.record(z.any())).optional(),
  csv_stats: z.array(z.record(z.any())).optional(),
  graph: z.record(z.any()).optional(), // For share URL
  brief: z.string().optional(), // For share URL
  pii_guard_mode: z.enum(["standard", "strict", "off"]).optional().default("standard"),
  include_share_url: z.boolean().optional().default(false),
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
      // Validate input schema
      const validationResult = EvidencePackInputSchema.safeParse(req.body);

      if (!validationResult.success) {
        const errorV1 = zodErrorToErrorV1(validationResult.error, requestId);
        return reply.status(400).send(errorV1);
      }

      const {
        rationales,
        citations,
        csv_stats,
        graph,
        brief,
        pii_guard_mode,
        include_share_url
      } = validationResult.data;

      // Build base evidence pack
      let pack = buildEvidencePackRedacted(
        { rationales, citations, csv_stats } as any,
        SERVICE_VERSION
      );

      // Apply PII redaction
      let redactionSummary: {
        mode: RedactionMode;
        fields_redacted: number;
        patterns_detected: string[];
      } | null = null;

      if (pii_guard_mode !== "off") {
        // Redact pack content
        const redactedPack = redactObject(pack, { mode: pii_guard_mode });

        // Detect PII to generate summary
        const packString = JSON.stringify(pack);
        const detectedPII = detectPII(packString, { mode: pii_guard_mode });
        const patterns = [...new Set(detectedPII.map(p => p.type))];

        pack = redactedPack;
        redactionSummary = {
          mode: pii_guard_mode,
          fields_redacted: detectedPII.length,
          patterns_detected: patterns,
        };
      }

      // Generate optional share URL (7-day expiry)
      let shareUrl: string | null = null;

      if (include_share_url && env.SHARE_REVIEW_ENABLED === "true" && graph) {
        try {
          const shareId = randomBytes(16).toString("hex");
          const createdAt = Date.now();
          const expiresAt = createdAt + 7 * 24 * 60 * 60 * 1000; // 7 days

          // Store share
          await storeShare({
            share_id: shareId,
            graph: graph as any,
            brief: brief || "",
            created_at: createdAt,
            expires_at: expiresAt,
            revoked: false,
            access_count: 0,
          });

          // Generate token
          const payload: ShareTokenPayload = {
            share_id: shareId,
            created_at: createdAt,
            expires_at: expiresAt,
          };

          const token = signShareToken(payload);
          const baseUrl = env.SHARE_BASE_URL || `${req.protocol}://${req.hostname}`;
          shareUrl = `${baseUrl}/assist/share/${token}`;

          log.info({
            request_id: requestId,
            share_id: shareId,
            expires_at: new Date(expiresAt).toISOString(),
          }, "Share URL generated for evidence pack");
        } catch (error) {
          log.warn({ error, request_id: requestId }, "Failed to generate share URL for evidence pack");
        }
      }

      // Create ZIP archive
      const archive = archiver("zip", {
        zlib: { level: 9 } // Maximum compression
      });

      // Set response headers for ZIP download
      reply.raw.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="evidence-pack-${Date.now()}.zip"`,
        "cache-control": "no-cache",
      });

      // Pipe archive to response
      archive.pipe(reply.raw);

      // Add evidence pack JSON
      archive.append(JSON.stringify(pack, null, 2), { name: "evidence-pack.json" });

      // Add redaction summary if PII guard was applied
      if (redactionSummary) {
        archive.append(JSON.stringify(redactionSummary, null, 2), { name: "redaction-summary.json" });
      }

      // Add share URL if generated
      if (shareUrl) {
        archive.append(JSON.stringify({
          share_url: shareUrl,
          expires_in_days: 7,
          note: "This share link expires in 7 days and allows read-only access to the graph."
        }, null, 2), { name: "share-url.json" });
      }

      // Add README
      const readme = `# Evidence Pack v2

This archive contains:
- evidence-pack.json: Redacted provenance data
${redactionSummary ? "- redaction-summary.json: PII redaction details\n" : ""}${shareUrl ? "- share-url.json: 7-day share link\n" : ""}
Generated: ${new Date().toISOString()}
Service Version: ${SERVICE_VERSION}
PII Guard Mode: ${pii_guard_mode}
`;
      archive.append(readme, { name: "README.md" });

      // Finalize archive
      await archive.finalize();

      app.log.info({
        request_id: requestId,
        document_citations: pack.document_citations.length,
        csv_statistics: pack.csv_statistics.length,
        rationales_with_provenance: pack.rationales_with_provenance.length,
        pii_guard_mode,
        has_share_url: !!shareUrl,
        redaction_applied: !!redactionSummary,
      }, "Evidence pack v2 generated");

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
