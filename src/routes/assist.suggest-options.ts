import type { FastifyInstance } from "fastify";
import { SuggestOptionsInput, SuggestOptionsOutput, ErrorV1 } from "../schemas/assist.js";

export default async function route(app: FastifyInstance) {
  app.post("/assist/suggest-options", async (req, reply) => {
    const parsed = SuggestOptionsInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "invalid input",
        details: parsed.error.flatten()
      }));
    }

    const output = SuggestOptionsOutput.parse({
      options: [
        {
          id: "opt_a",
          title: "Extend free trial",
          pros: ["Experiential value", "Low dev"],
          cons: ["Cost exposure", "Expiry dip"],
          evidence_to_gather: ["Trial→upgrade funnel", "Usage lift"]
        },
        {
          id: "opt_b",
          title: "In-app nudges",
          pros: ["Low friction", "Scalable"],
          cons: ["Banner blindness", "Copy risk"],
          evidence_to_gather: ["CTR→upgrade", "A/B of copy"]
        },
        {
          id: "opt_c",
          title: "Customer emails",
          pros: ["Segment control", "Rapid"],
          cons: ["Deliverability", "Fatigue"],
          evidence_to_gather: ["Open→upgrade", "Unsubscribe rate"]
        }
      ]
    });

    return reply.send(output);
  });
}
