/**
 * Tests for the output sanitiser.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { sanitiseAssistantText } from "../../../../src/orchestrator/deterministic/sanitise-output.js";
import { log } from "../../../../src/utils/telemetry.js";

const warnSpy = vi.mocked(log.warn);

beforeEach(() => {
  warnSpy.mockClear();
});

describe("sanitiseAssistantText — em dash replacement", () => {
  it("replaces em dash with sentence break", () => {
    expect(sanitiseAssistantText("Updating salary cost — this affects both options")).toBe(
      "Updating salary cost. This affects both options",
    );
  });

  it("replaces en dash with sentence break", () => {
    expect(sanitiseAssistantText("Cost factor \u2013 important")).toBe(
      "Cost factor. Important",
    );
  });

  it("handles multiple dashes", () => {
    const result = sanitiseAssistantText("First — second — third");
    expect(result).toBe("First. Second. Third");
  });
});

describe("sanitiseAssistantText — observed state replacement", () => {
  it("replaces 'observed state' with 'value'", () => {
    expect(
      sanitiseAssistantText("Proposing to update Talent Market Availability: observed state"),
    ).toBe("Proposing to update Talent Market Availability: value");
  });

  it("replaces case-insensitively", () => {
    expect(sanitiseAssistantText("Updated Observed State to 5")).toBe("Updated value to 5");
  });
});

describe("sanitiseAssistantText — bold markdown strip", () => {
  it("strips **bold** markers", () => {
    expect(sanitiseAssistantText("Added **Team Dynamics Risk** as a factor")).toBe(
      "Added Team Dynamics Risk as a factor",
    );
  });

  it("strips multiple bold markers", () => {
    expect(sanitiseAssistantText("**Budget** and **Revenue**")).toBe("Budget and Revenue");
  });
});

describe("sanitiseAssistantText — article correction", () => {
  it("fixes 'a observable' to 'an observable'", () => {
    expect(sanitiseAssistantText("Added as a observable factor")).toBe(
      "Added as an observable factor",
    );
  });

  it("does NOT change 'a user' (correct as-is)", () => {
    expect(sanitiseAssistantText("a user request")).toBe("a user request");
  });
});

describe("sanitiseAssistantText — compound transforms", () => {
  it("applies all transforms from the brief spec", () => {
    expect(
      sanitiseAssistantText(
        "Proposing to update **Talent Market Availability**: observed state",
      ),
    ).toBe("Proposing to update Talent Market Availability: value");
  });

  it("handles the full brief example with bold + article", () => {
    expect(
      sanitiseAssistantText("Added **Team Dynamics Risk** as a observable factor"),
    ).toBe("Added Team Dynamics Risk as an observable factor");
  });

  it("handles dash + bold + observed state together", () => {
    expect(
      sanitiseAssistantText(
        "Updating **Salary Cost** — observed state changed to 50000",
      ),
    ).toBe("Updating Salary Cost. Value changed to 50000");
  });
});

describe("sanitiseAssistantText — banned term logging", () => {
  it("logs a warning for 'interventions' but does not rewrite", () => {
    const input = "The interventions array is populated";
    const result = sanitiseAssistantText(input);
    expect(result).toBe(input);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect((warnSpy.mock.calls[0][0] as { event: string }).event).toBe(
      "v4.banned_term_leak",
    );
    expect((warnSpy.mock.calls[0][0] as { term: string }).term).toBe(
      "interventions",
    );
  });

  it("logs a warning for 'graph_patch'", () => {
    sanitiseAssistantText("See the graph_patch for details");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("logs a warning for 'node' in non-technical context", () => {
    sanitiseAssistantText("Adding a new node to the model");
    expect(warnSpy).toHaveBeenCalled();
    expect((warnSpy.mock.calls[0][0] as { term: string }).term).toBe("node");
  });

  it("does NOT log 'node' when preceded by a technical qualifier like 'factor '", () => {
    sanitiseAssistantText("The factor node is connected");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not log when no banned terms present", () => {
    sanitiseAssistantText("Updated the cost to 5000");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("sanitiseAssistantText — preserveBold option", () => {
  it("strips bold by default", () => {
    expect(sanitiseAssistantText("Added **Budget** factor")).toBe(
      "Added Budget factor",
    );
  });

  it("preserves bold markers when preserveBold is true", () => {
    expect(
      sanitiseAssistantText("Proposing to add **Budget** as a factor", {
        preserveBold: true,
      }),
    ).toBe("Proposing to add **Budget** as a factor");
  });

  it("still applies other transforms when preserveBold is true", () => {
    expect(
      sanitiseAssistantText(
        "Updating **Salary** — observed state to 5000",
        { preserveBold: true },
      ),
    ).toBe("Updating **Salary**. Value to 5000");
  });
});

describe("sanitiseAssistantText — edge cases", () => {
  it("returns empty string as-is", () => {
    expect(sanitiseAssistantText("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    const plain = "This is a simple sentence with no issues.";
    expect(sanitiseAssistantText(plain)).toBe(plain);
  });
});
