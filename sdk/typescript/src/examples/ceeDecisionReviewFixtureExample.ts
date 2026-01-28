/**
 * CEE Decision Review Golden Fixture Example (TypeScript)
 *
 * This example shows how a backend or integration test might consume the
 * golden CEE decision review fixture as a stable, metadata-only exemplar.
 *
 * Notes:
 * - This file is not executed automatically in CI; it is intended as
 *   copy-pastable example code for integrators.
 * - When consuming the published SDK, replace relative imports such as
 *   "../index.js" with "@olumi/assistants-sdk" and copy the JSON fixture
 *   into your own repo.
 */

import type {
  CeeDecisionReviewPayloadLegacy as CeeDecisionReviewPayload,
  CeeEngineStatus,
  CeeTraceSummary,
  CeeErrorView,
} from "../index.js";
 
import golden from "./cee-decision-review.v1.example.json";

export interface GoldenDecisionReviewFixture {
  review: CeeDecisionReviewPayload;
  trace: CeeTraceSummary | null;
  engineStatus: CeeEngineStatus;
  error: CeeErrorView | null;
}

const fixture = golden as GoldenDecisionReviewFixture;

/**
 * Build a simple, CLI-style summary of the golden decision review fixture.
 *
 * This helper remains metadata-only: it uses only the structured story,
 * health, journey, UI flags, trace summary, and engine status.
 */
export function formatGoldenDecisionReviewSummary(
  input: GoldenDecisionReviewFixture = fixture,
): string {
  const { review, trace, engineStatus } = input;
  const { story, journey, uiFlags } = review;

  const lines: string[] = [];

  lines.push("CEE Decision Review (golden fixture)");
  lines.push("");
  lines.push(`Headline: ${story.headline}`);
  lines.push("");

  const keyDrivers = story.key_drivers.slice(0, 3);
  if (keyDrivers.length > 0) {
    lines.push("Key drivers:");
    for (const driver of keyDrivers) {
      lines.push(`  - ${driver}`);
    }
    lines.push("");
  }

  const nextActions = story.next_actions.slice(0, 3);
  if (nextActions.length > 0) {
    lines.push("Next actions:");
    for (const action of nextActions) {
      lines.push(`  - ${action}`);
    }
    lines.push("");
  }

  lines.push(
    `Health: ${journey.health.overallStatus} (tone: ${journey.health.overallTone}, any_truncated: ${journey.health.any_truncated}, has_validation_issues: ${journey.health.has_validation_issues})`,
  );
  lines.push(
    `Journey: is_complete=${journey.is_complete}, missing_envelopes=[${journey.missing_envelopes.join(", ")}], has_team_disagreement=${journey.has_team_disagreement}`,
  );
  lines.push(
    `Flags: has_high_risk_envelopes=${uiFlags.has_high_risk_envelopes}, has_truncation_somewhere=${uiFlags.has_truncation_somewhere}, has_team_disagreement=${uiFlags.has_team_disagreement}`,
  );

  if (trace) {
    lines.push(
      `Trace: requestId=${trace.requestId}, degraded=${trace.degraded}, provider=${trace.provider ?? "-"}, model=${trace.model ?? "-"}`,
    );
  }

  lines.push(
    `Engine: provider=${engineStatus.provider ?? "-"}, model=${engineStatus.model ?? "-"}, degraded=${engineStatus.degraded}`,
  );

  return lines.join("\n");
}
