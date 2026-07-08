/**
 * Golden-brief fixture loader — reads the repo's tests/fixtures/golden-briefs
 * strictly read-only; R (warranted reference set) is absent today and must
 * surface as undefined, never as a fabricated set.
 */
import { describe, expect, it } from "vitest";
import { loadGoldenBriefs } from "../src/fixtures/loader.ts";

describe("golden-brief fixtures", () => {
  it("loads the golden briefs with text, source path and content hash", async () => {
    const briefs = await loadGoldenBriefs(null);
    expect(briefs.length).toBeGreaterThanOrEqual(5);
    for (const brief of briefs) {
      expect(brief.brief.length).toBeGreaterThan(20);
      expect(brief.sourcePath).toContain("tests/fixtures/golden-briefs");
      expect(brief.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(brief.warrantedSet).toBeUndefined(); // R is a hard input, not yet built
    }
    const ids = briefs.map((b) => b.id);
    expect(ids).toContain("buy-vs-build");
  });

  it("filters by brief id", async () => {
    const briefs = await loadGoldenBriefs(["buy-vs-build"]);
    expect(briefs).toHaveLength(1);
    expect(briefs[0].id).toBe("buy-vs-build");
  });

  it("throws when the filter matches nothing (never a silent empty run)", async () => {
    await expect(loadGoldenBriefs(["nonexistent-brief"])).rejects.toThrow(/no golden briefs/);
  });
});
