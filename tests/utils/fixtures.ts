import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { DraftGraphOutput } from "../../src/schemas/assist.js";

export interface GoldenBriefFixture {
  brief: string;
  expected_response: z.infer<typeof DraftGraphOutput>;
  metadata: {
    archetype: string;
    description: string;
    recorded_at: string;
    llm_model: string;
  };
}

/**
 * Load a golden brief fixture from the fixtures directory
 * @param name - Fixture name (without .json extension)
 * @returns Parsed fixture data
 */
export async function loadGoldenBrief(name: string): Promise<GoldenBriefFixture> {
  const fixturePath = join(__dirname, "../fixtures/golden-briefs", `${name}.json`);
  const content = await readFile(fixturePath, "utf-8");
  return JSON.parse(content) as GoldenBriefFixture;
}

/**
 * Available golden brief fixtures
 */
export const GOLDEN_BRIEFS = {
  BUY_VS_BUILD: "buy-vs-build",
  HIRE_VS_CONTRACT: "hire-vs-contract",
  MIGRATE_VS_STAY: "migrate-vs-stay",
  EXPAND_VS_FOCUS: "expand-vs-focus",
  TECHNICAL_DEBT: "technical-debt",
} as const;
