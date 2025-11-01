import { request } from "undici";
import type { GraphT } from "../schemas/graph.js";

const base = process.env.ENGINE_BASE_URL || "http://localhost:3001";

type ValidateResponse = {
  ok: boolean;
  normalized?: GraphT;
  violations?: string[];
};

export async function validateGraph(
  g: GraphT
): Promise<{ ok: boolean; normalized?: GraphT; violations?: string[] }> {
  try {
    const res = await request(`${base}/v1/validate`, {
      method: "POST",
      body: JSON.stringify({ graph: g }),
      headers: { "content-type": "application/json" }
    });
    const json = (await res.body.json()) as ValidateResponse;
    if (json.ok && json.normalized) {
      return { ok: true, normalized: json.normalized };
    }
    return { ok: false, violations: json.violations || ["unknown"] };
  } catch (error) {
    return { ok: false, violations: ["validate_unreachable"] };
  }
}
