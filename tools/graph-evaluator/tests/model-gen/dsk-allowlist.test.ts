/**
 * DSK allowlist selection — deterministic, capped, and never silently empty.
 *
 * The DSK on/off sub-comparison (PLAN-v2 WP5) only means something if the
 * selector is a pure function of the brief bytes. If selection drifted between
 * the "on" and "off" arms, the comparison would measure the selector.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import matter from "gray-matter";
import {
  DEFAULT_MAX_DSK_OBJECTS,
  oneLineClaim,
  selectDskForBrief,
  tagsForBrief,
} from "../../scripts/model-gen/dsk-allowlist.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = join(HERE, "..", "..");
const REPO_ROOT = join(TOOL_ROOT, "..", "..");
const DSK = join(REPO_ROOT, "data", "dsk", "v1.json");
const TAGS = join(REPO_ROOT, "data", "dsk", "context-tags.json");

function body(id: string): string {
  return matter(readFileSync(join(TOOL_ROOT, "briefs", `${id}.md`), "utf-8")).content.trim();
}

describe("tagsForBrief", () => {
  const vocabulary = JSON.parse(readFileSync(TAGS, "utf-8")) as string[];

  it("always includes 'general' so the allowlist is never empty", () => {
    expect(tagsForBrief("a brief about nothing in particular", vocabulary)).toContain("general");
  });

  it("derives pricing from the pricing brief and hiring from the hiring brief", () => {
    expect(tagsForBrief(body("pricing-staging"), vocabulary)).toContain("pricing");
    expect(tagsForBrief(body("hiring-staging"), vocabulary)).toContain("hiring");
  });

  it("emits only tags that exist in the shipped vocabulary", () => {
    for (const brief of ["pricing-staging", "hiring-staging", "12-similar-options"]) {
      for (const tag of tagsForBrief(body(brief), vocabulary)) {
        expect(vocabulary).toContain(tag);
      }
    }
  });
});

describe("selectDskForBrief", () => {
  it("is deterministic — same bytes, same ids, same order", () => {
    const a = selectDskForBrief(body("pricing-staging"), DSK, TAGS);
    const b = selectDskForBrief(body("pricing-staging"), DSK, TAGS);
    expect(a.ids).toEqual(b.ids);
    expect(a.block).toBe(b.block);
  });

  it("caps at 8 objects and never returns an empty list for a real brief", () => {
    const sel = selectDskForBrief(body("pricing-staging"), DSK, TAGS);
    expect(sel.ids.length).toBeGreaterThan(0);
    expect(sel.ids.length).toBeLessThanOrEqual(DEFAULT_MAX_DSK_OBJECTS);
  });

  it("puts the pricing-tagged claim ahead of the general-only ones", () => {
    const sel = selectDskForBrief(body("pricing-staging"), DSK, TAGS);
    // DSK-B-001 is the only object tagged 'pricing' in v1.json.
    expect(sel.ids[0]).toBe("DSK-B-001");
  });

  it("emits one line per id: id | title | claim", () => {
    const sel = selectDskForBrief(body("pricing-staging"), DSK, TAGS);
    for (const id of sel.ids) {
      const line = sel.block.split("\n").find((l) => l.startsWith(`${id} |`));
      expect(line).toBeDefined();
      expect(line!.split(" | ")).toHaveLength(3);
    }
    expect(sel.block).toContain("Cite ONLY these ids");
  });

  it("truncates a long claim rather than letting it crowd the brief", () => {
    const long = { id: "x", type: "claim", title: "T", evidence_pack: { key_findings: "a".repeat(500) } };
    expect(oneLineClaim(long).length).toBeLessThanOrEqual(200);
  });

  it("different briefs get different allowlists (the selector is not a constant)", () => {
    const pricing = selectDskForBrief(body("pricing-staging"), DSK, TAGS);
    const hiring = selectDskForBrief(body("hiring-staging"), DSK, TAGS);
    expect(pricing.ids).not.toEqual(hiring.ids);
  });
});
