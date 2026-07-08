import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../util/stable.ts";
import type { BriefFixture, RItemInput } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo golden-brief fixtures, read strictly read-only. */
export const GOLDEN_BRIEFS_DIR = resolve(HERE, "../../../../tests/fixtures/golden-briefs");

/**
 * Optional per-brief warranted reference set R files live in the tool's own
 * fixtures dir (NOT the repo test fixtures): fixtures/r-sets/{brief_id}.json.
 * R is a HARD benchmark input: absent R ⇒ FGQ recall is "pending R" and no
 * warranted-coverage claim can be made.
 */
export const R_SETS_DIR = resolve(HERE, "../../fixtures/r-sets");

interface GoldenBriefFile {
  brief?: unknown;
  metadata?: Record<string, unknown>;
}

export async function loadGoldenBriefs(filter?: string[] | null): Promise<BriefFixture[]> {
  const files = (await readdir(GOLDEN_BRIEFS_DIR)).filter((f) => f.endsWith(".json")).sort();
  const fixtures: BriefFixture[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    if (filter && filter.length > 0 && !filter.includes(id)) continue;
    const sourcePath = join(GOLDEN_BRIEFS_DIR, file);
    const raw = await readFile(sourcePath, "utf-8");
    const parsed = JSON.parse(raw) as GoldenBriefFile;
    if (typeof parsed.brief !== "string" || parsed.brief.length === 0) {
      throw new Error(`golden brief ${file} has no usable "brief" string`);
    }
    fixtures.push({
      id,
      brief: parsed.brief,
      sourcePath,
      sha256: sha256Hex(raw),
      warrantedSet: await loadRSet(id),
    });
  }
  if (fixtures.length === 0) {
    throw new Error(`no golden briefs loaded from ${GOLDEN_BRIEFS_DIR} (filter: ${filter?.join(",") ?? "none"})`);
  }
  return fixtures;
}

async function loadRSet(briefId: string): Promise<RItemInput[] | undefined> {
  try {
    const raw = await readFile(join(R_SETS_DIR, `${briefId}.json`), "utf-8");
    const parsed = JSON.parse(raw) as { items?: RItemInput[] };
    if (!Array.isArray(parsed.items)) return undefined;
    return parsed.items;
  } catch {
    return undefined; // R not built yet — recall stays "pending R"
  }
}
