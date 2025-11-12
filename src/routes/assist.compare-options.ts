import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Graph } from "../schemas/graph.js";
import { compareOptions, comparePair, compareMatrix } from "../utils/option-compare.js";
import { buildErrorV1, zodErrorToErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";

/**
 * POST /assist/compare-options
 *
 * v1.5 PR K: Option Compare API
 *
 * Engine-friendly side-by-side comparison of decision options.
 * Returns structured deltas showing field-level differences for
 * downstream tooling and UX.
 *
 * Input:
 * - graph: The decision graph containing options
 * - option_ids: Array of 2+ option node IDs to compare
 * - mode: "multi" (default), "pair", or "matrix"
 *
 * Output:
 * - Multi mode: Field-level comparison across all options
 * - Pair mode: Detailed pairwise comparison with similarity scores
 * - Matrix mode: Similarity matrix for all option pairs
 */

const CompareOptionsInputSchema = z.object({
  graph: Graph,
  option_ids: z.array(z.string().min(1)).min(2).max(12),
  mode: z.enum(["multi", "pair", "matrix"]).optional().default("multi"),
});

export default async function route(app: FastifyInstance) {
  app.post("/assist/compare-options", async (req, reply) => {
    const requestId = getRequestId(req);

    try {
      // Validate input
      const validationResult = CompareOptionsInputSchema.safeParse(req.body);

      if (!validationResult.success) {
        const errorV1 = zodErrorToErrorV1(validationResult.error, requestId);
        return reply.status(400).send(errorV1);
      }

      const { graph, option_ids, mode } = validationResult.data;

      // Route to appropriate comparison function based on mode
      let result: unknown;

      if (mode === "pair") {
        // Pair mode: requires exactly 2 option IDs
        if (option_ids.length !== 2) {
          const errorV1 = buildErrorV1(
            "BAD_INPUT",
            "Pair mode requires exactly 2 option IDs",
            undefined,
            requestId
          );
          return reply.status(400).send(errorV1);
        }
        result = comparePair(graph, option_ids[0], option_ids[1]);
      } else if (mode === "matrix") {
        // Matrix mode: generates similarity matrix
        result = compareMatrix(graph, option_ids);
      } else {
        // Multi mode (default): field-level comparison
        result = compareOptions(graph, option_ids);
      }

      app.log.info(
        {
          request_id: requestId,
          mode,
          option_count: option_ids.length,
        },
        "Option comparison completed"
      );

      return reply.send(result);
    } catch (error) {
      // Handle validation errors from compare functions
      if (error instanceof Error && error.message.startsWith("compare_")) {
        app.log.warn({ error, request_id: requestId }, "Option comparison validation failed");

        const errorV1 = buildErrorV1(
          "BAD_INPUT",
          error.message,
          undefined,
          requestId
        );
        return reply.status(400).send(errorV1);
      }

      // Handle unexpected errors
      app.log.error({ error, request_id: requestId }, "Option comparison failed");

      const errorV1 = buildErrorV1(
        "INTERNAL",
        "Failed to compare options",
        undefined,
        requestId
      );
      return reply.status(500).send(errorV1);
    }
  });
}
