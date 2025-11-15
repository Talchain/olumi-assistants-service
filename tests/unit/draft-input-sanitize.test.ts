import { describe, it, expect } from "vitest";
import { DraftGraphInput, type DraftGraphInputT } from "../../src/schemas/assist.js";
import { sanitizeDraftGraphInput } from "../../src/routes/assist.draft-graph.js";

function makeBaseInput(overrides: Record<string, unknown> = {}): DraftGraphInputT & Record<string, unknown> {
  const base = {
    brief: "a".repeat(30),
  } satisfies Record<string, unknown>;

  const parsed = DraftGraphInput.parse({ ...base, ...overrides });
  return { ...(parsed as DraftGraphInputT & Record<string, unknown>), ...overrides };
}

describe("sanitizeDraftGraphInput", () => {
  it("keeps core fields and drops unknown properties", () => {
    const input = makeBaseInput({
      include_debug: true,
      constraints: { foo: "bar" },
      extra_field: "should-be-dropped",
    });

    const sanitized = sanitizeDraftGraphInput(input);

    expect(sanitized.brief).toBe(input.brief);
    expect(sanitized.include_debug).toBe(true);
    expect(sanitized.constraints).toEqual({ foo: "bar" });
    expect((sanitized as Record<string, unknown>).extra_field).toBeUndefined();
  });

  it("preserves fixtures flag when present as boolean", () => {
    const input = makeBaseInput({ fixtures: true });

    const sanitized = sanitizeDraftGraphInput(input);

    expect((sanitized as Record<string, unknown>).fixtures).toBe(true);
  });

  it("preserves primitive sim_* fields and drops non-primitive ones", () => {
    const input = makeBaseInput({
      sim_position: 0.5,
      sim_label: "test",
      sim_enabled: true,
      sim_object: { nested: true },
    });

    const sanitized = sanitizeDraftGraphInput(input) as DraftGraphInputT & Record<string, unknown>;

    expect(sanitized.sim_position).toBe(0.5);
    expect(sanitized.sim_label).toBe("test");
    expect(sanitized.sim_enabled).toBe(true);
    expect(sanitized.sim_object).toBeUndefined();
  });
});
