import type { components } from "../../generated/openapi.d.ts";

type CEEEvidenceItemRequestV1 = components["schemas"]["CEEEvidenceItemRequestV1"];
type CEEEvidenceItemResponseV1 = components["schemas"]["CEEEvidenceItemResponseV1"];

export interface ScoredEvidenceResult {
  items: CEEEvidenceItemResponseV1[];
  unsupportedTypeIds: string[];
}

const KNOWN_TYPES = new Set([
  "experiment",
  "user_research",
  "market_data",
  "expert_opinion",
  "other",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

export function scoreEvidenceItems(evidence: CEEEvidenceItemRequestV1[]): ScoredEvidenceResult {
  const unsupportedTypeIds: string[] = [];

  const items = evidence.map((item) => {
    const type = (item as any).type as string;
    const isKnown = KNOWN_TYPES.has(type);
    if (!isKnown) {
      unsupportedTypeIds.push((item as any).id as string);
    }

    const effectiveType = isKnown ? type : "other";

    let strength: "none" | "weak" | "medium" | "strong";
    let relevance: "low" | "medium" | "high";

    switch (effectiveType) {
      case "experiment":
      case "market_data": {
        strength = "strong";
        relevance = "high";
        break;
      }
      case "expert_opinion":
      case "user_research": {
        strength = "medium";
        relevance = "medium";
        break;
      }
      case "other":
      default: {
        strength = isKnown ? "weak" : "none";
        relevance = "low";
        break;
      }
    }

    const observedRaw = (item as any).observed_at as string | undefined;
    let freshness: "low" | "medium" | "high" | undefined;
    let ageDays: number | undefined;

    if (observedRaw) {
      const ts = Date.parse(observedRaw);
      if (!Number.isNaN(ts)) {
        const now = Date.now();
        const ageMs = Math.max(0, now - ts);
        const days = ageMs / DAY_MS;
        ageDays = Math.round(days * 10) / 10;

        if (days <= 30) {
          freshness = "high";
        } else if (days <= 180) {
          freshness = "medium";
        } else {
          freshness = "low";
        }
      }
    }

    const response: CEEEvidenceItemResponseV1 = {
      id: (item as any).id as string,
      type: effectiveType,
      strength,
      relevance,
      ...(freshness ? { freshness } : {}),
      ...(ageDays !== undefined ? { age_days: ageDays } : {}),
    } as CEEEvidenceItemResponseV1;

    return response;
  });

  return { items, unsupportedTypeIds };
}
