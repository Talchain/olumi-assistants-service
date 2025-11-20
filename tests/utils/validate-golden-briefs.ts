import { DraftGraphOutput } from "../../src/schemas/assist.js";
import { GOLDEN_BRIEFS, loadGoldenBrief } from "./fixtures.js";
import { ZodError } from "zod";

async function main() {
  const names = Object.values(GOLDEN_BRIEFS);
  let hadError = false;

  for (const name of names) {
    try {
      const fixture = await loadGoldenBrief(name);

      // Validate expected_response against current DraftGraphOutput schema
      DraftGraphOutput.parse(fixture.expected_response);

      // Basic sanity checks on metadata
      if (!fixture.metadata || !fixture.metadata.archetype || !fixture.metadata.llm_model) {
        throw new Error("metadata.archetype and metadata.llm_model must be non-empty");
      }

      if (!fixture.brief || fixture.brief.length < 30) {
        throw new Error("brief must be at least 30 characters to match DraftGraphInput constraints");
      }

      const recordedAt = Date.parse(fixture.metadata.recorded_at);
      if (Number.isNaN(recordedAt)) {
        throw new Error("metadata.recorded_at must be a valid ISO-8601 timestamp");
      }

      // eslint-disable-next-line no-console
      console.log(`✓ ${name}: OK`);
    } catch (err) {
      hadError = true;

      if (err instanceof ZodError) {
        // eslint-disable-next-line no-console
        console.error(`✗ ${name}: DraftGraphOutput validation failed`);
        for (const issue of err.issues) {
          const path = issue.path.join(".") || "<root>";
          // eslint-disable-next-line no-console
          console.error(`  - ${path}: ${issue.message}`);
        }
      } else if (err instanceof Error) {
        // eslint-disable-next-line no-console
        console.error(`✗ ${name}: ${err.message}`);
      } else {
        // eslint-disable-next-line no-console
        console.error(`✗ ${name}: Unexpected error`, err);
      }
    }
  }

  if (hadError) {
    // eslint-disable-next-line no-console
    console.error("Golden brief fixture validation failed");
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log("All golden brief fixtures are valid.");
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected error during golden brief fixture validation", err);
  process.exitCode = 1;
});
