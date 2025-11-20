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

    const response: CEEEvidenceItemResponseV1 = {
      id: (item as any).id as string,
      type: effectiveType,
      strength,
      relevance,
    } as CEEEvidenceItemResponseV1;

    return response;
  });

  return { items, unsupportedTypeIds };
}
