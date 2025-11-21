import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { CeeDecisionReviewPayloadV1 } from "../../src/contracts/cee/decision-review.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let CACHE: CeeDecisionReviewPayloadV1 | null = null;

function clonePayload(payload: CeeDecisionReviewPayloadV1): CeeDecisionReviewPayloadV1 {
  // Fixtures are plain JSON; a JSON round-trip is sufficient for a deep copy
  // and avoids tests accidentally mutating shared cached state.
  return JSON.parse(JSON.stringify(payload)) as CeeDecisionReviewPayloadV1;
}

export async function loadCeeDecisionReviewFixture(): Promise<CeeDecisionReviewPayloadV1> {
  if (CACHE) return clonePayload(CACHE);

  const fixturePath = join(__dirname, "../fixtures/cee/cee-decision-review.v1.json");
  const content = await readFile(fixturePath, "utf-8");
  const parsed = JSON.parse(content) as CeeDecisionReviewPayloadV1;

  CACHE = parsed;
  return clonePayload(parsed);
}
