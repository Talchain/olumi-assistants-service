import { describe, it, expect } from "vitest";
import type { components } from "../../src/generated/openapi.d.ts";
import { scoreEvidenceItems } from "../../src/cee/evidence/index.js";

type CEEEvidenceItemRequestV1 = components["schemas"]["CEEEvidenceItemRequestV1"];

describe("CEE evidence helper - scoreEvidenceItems", () => {
  it("maps known evidence types to expected strengths and relevance", () => {
    const input: CEEEvidenceItemRequestV1[] = [
      { id: "e1", type: "experiment" },
      { id: "e2", type: "market_data" },
      { id: "e3", type: "expert_opinion" },
      { id: "e4", type: "user_research" },
      { id: "e5", type: "other" },
    ] as any;

    const { items, unsupportedTypeIds } = scoreEvidenceItems(input);

    expect(unsupportedTypeIds).toEqual([]);
    expect(items).toHaveLength(5);

    const byId = new Map(items.map((i) => [(i as any).id as string, i]));

    expect((byId.get("e1") as any).strength).toBe("strong");
    expect((byId.get("e1") as any).relevance).toBe("high");

    expect((byId.get("e2") as any).strength).toBe("strong");
    expect((byId.get("e2") as any).relevance).toBe("high");

    expect((byId.get("e3") as any).strength).toBe("medium");
    expect((byId.get("e3") as any).relevance).toBe("medium");

    expect((byId.get("e4") as any).strength).toBe("medium");
    expect((byId.get("e4") as any).relevance).toBe("medium");

    expect((byId.get("e5") as any).strength).toBe("weak");
    expect((byId.get("e5") as any).relevance).toBe("low");
  });

  it("handles unsupported evidence types with deterministic fallback and unsupportedTypeIds", () => {
    const input = [{ id: "e-unknown", type: "custom_type" } as any];

    const { items, unsupportedTypeIds } = scoreEvidenceItems(input as any);

    expect(unsupportedTypeIds).toEqual(["e-unknown"]);
    expect(items).toHaveLength(1);

    const item = items[0] as any;
    expect(item.id).toBe("e-unknown");
    expect(item.type).toBe("other");
    expect(item.strength).toBe("none");
    expect(item.relevance).toBe("low");
  });
});
