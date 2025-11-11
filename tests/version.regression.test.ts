import { describe, it, expect } from "vitest";
import { SERVICE_VERSION } from "../src/version.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("Version SSOT", () => {
  it("exports package.json version from version SSOT", () => {
    // V04: Dynamic version checking - read from package.json
    const pkgPath = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgPath), "utf-8"));
    const expectedVersion = pkg.version;

    expect(SERVICE_VERSION).toBe(expectedVersion);
    expect(SERVICE_VERSION).toMatch(/^\d+\.\d+\.\d+$/); // Ensure valid semver format
  });
});

