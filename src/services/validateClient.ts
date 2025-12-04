import { request } from "undici";
import type { GraphT } from "../schemas/graph.js";
import { config } from "../config/index.js";

/**
 * Get engine base URL from centralized config (deferred for testability)
 */
function getEngineBaseUrl(): string {
  return config.validation.engineBaseUrl || "http://localhost:3001";
}

type ValidateResponse = {
  ok: boolean;
  normalized?: GraphT;
  violations?: string[];
};

export async function validateGraph(
  g: GraphT
): Promise<{ ok: boolean; normalized?: GraphT; violations?: string[] }> {
  try {
    const res = await request(`${getEngineBaseUrl()}/v1/validate`, {
      method: "POST",
      body: JSON.stringify({ graph: g }),
      headers: { "content-type": "application/json" }
    });
    const json = (await res.body.json()) as ValidateResponse;
    if (json.ok && json.normalized) {
      return { ok: true, normalized: json.normalized };
    }
    return { ok: false, violations: json.violations || ["unknown"] };
  } catch {
    return { ok: false, violations: ["validate_unreachable"] };
  }
}
