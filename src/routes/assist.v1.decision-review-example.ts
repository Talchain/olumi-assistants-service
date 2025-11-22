import type { FastifyInstance } from "fastify";

import { getCeeDecisionReviewExampleV1 } from "../cee/decision-review-example.js";

export default async function route(app: FastifyInstance) {
  app.get("/assist/v1/decision-review/example", async (_req, reply) => {
    reply.code(200);
    return getCeeDecisionReviewExampleV1();
  });
}
