import { describe, it, expect } from "vitest";
import { SERVICE_VERSION } from "../src/version.js";

describe("Version SSOT", () => {
  it("exports 1.2.0 from version SSOT", () => {
    expect(SERVICE_VERSION).toBe("1.2.0");
  });
});

