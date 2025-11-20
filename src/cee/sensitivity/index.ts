import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";

type CEESensitivityCoachRequestV1 = components["schemas"]["CEESensitivityCoachRequestV1"];
type CEESensitivitySuggestionV1 = components["schemas"]["CEESensitivitySuggestionV1"];

type DriverRecord = {
  node_id: string;
  contribution: number;
};

/**
 * Deterministic sensitivity suggestions builder for CEE v1.
 *
 * Uses only inference.explain.top_drivers (IDs and numeric contributions)
 * and does not inspect labels or free-text.
 */
export function buildSensitivitySuggestions(
  graph: GraphV1,
  inference: CEESensitivityCoachRequestV1["inference"],
): CEESensitivitySuggestionV1[] {
  const rawDrivers = inference?.explain?.top_drivers ?? [];

  const drivers: DriverRecord[] = rawDrivers
    .filter((d: any) => d && typeof d.node_id === "string")
    .map((d: any): DriverRecord => ({
      node_id: d.node_id as string,
      contribution: typeof d.contribution === "number" ? d.contribution : 0,
    }));

  if (!drivers.length) {
    return [];
  }

  // Sort by absolute contribution (desc), then by node_id (asc) for stability
  drivers.sort((a: DriverRecord, b: DriverRecord) => {
    const absDiff = Math.abs(b.contribution) - Math.abs(a.contribution);
    if (absDiff !== 0) return absDiff;
    return a.node_id.localeCompare(b.node_id);
  });

  return drivers.map((driver: DriverRecord, index: number) => {
    const suggestion: CEESensitivitySuggestionV1 = {
      driver_id: driver.node_id,
      rank: index + 1,
    } as CEESensitivitySuggestionV1;

    if (driver.contribution > 0) {
      (suggestion as any).direction = "increase";
    } else if (driver.contribution < 0) {
      (suggestion as any).direction = "decrease";
    }

    // target_id is intentionally omitted in v1 (reserved for future structure-aware heuristics)

    return suggestion;
  });
}
