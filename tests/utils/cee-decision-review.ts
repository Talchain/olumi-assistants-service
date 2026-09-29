import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { CeeDecisionReviewBundle } from "../../src/contracts/cee/decision-review.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let CACHE: CeeDecisionReviewBundle | null = null;

function clonePayload(payload: CeeDecisionReviewBundle): CeeDecisionReviewBundle {
  // Fixtures are plain JSON; a JSON round-trip is sufficient for a deep copy
  // and avoids tests accidentally mutating shared cached state.
  return JSON.parse(JSON.stringify(payload)) as CeeDecisionReviewBundle;
}

/**
 * Load the CEE Decision Review Bundle fixture (story/journey/uiFlags).
 * This is the UI-friendly summary, not the v1 wire contract.
 */
export async function loadCeeDecisionReviewFixture(): Promise<CeeDecisionReviewBundle> {
  if (CACHE) return clonePayload(CACHE);

  const fixturePath = join(__dirname, "../fixtures/cee/cee-decision-review.v1.json");
  const content = await readFile(fixturePath, "utf-8");
  const parsed = JSON.parse(content) as CeeDecisionReviewBundle;

  CACHE = parsed;
  return clonePayload(parsed);
}
