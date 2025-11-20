import { describe, it, expect } from "vitest";
import type {
  CEEDraftGraphResponseV1,
  CEEOptionsResponseV1,
  CEETeamPerspectivesResponseV1,
} from "./ceeTypes.js";
import {
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayload,
} from "./ceeHelpers.js";
import {
  type PortfolioDecisionReviewItem,
  computePortfolioHealthSummary,
} from "./examples/ceePortfolioHealthExample.js";

describe("ceePortfolioHealthExample", () => {
  function makeReview(
    id: string,
    status: "ok" | "warning" | "risk",
    opts?: { truncated?: boolean; disagreement?: boolean; complete?: boolean },
  ): PortfolioDecisionReviewItem {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: `r-${id}`, correlation_id: `r-${id}`, engine: {} },
      quality: { overall: status === "risk" ? 3 : status === "warning" ? 6 : 8 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: `r-${id}`, correlation_id: `r-${id}`, engine: {} },
      quality: { overall: 7 } as any,
      options: [{ id: "opt-1" } as any],
      response_limits: opts?.truncated
        ? ({ options_max: 1, options_truncated: true } as any)
        : undefined,
    } as any;

    let team: CEETeamPerspectivesResponseV1 | undefined;
    if (opts?.disagreement) {
      team = {
        trace: { request_id: `r-${id}`, correlation_id: `r-${id}`, engine: {} },
        quality: { overall: 7 } as any,
        summary: {
          participant_count: 3,
          for_count: 1,
          against_count: 1,
          neutral_count: 1,
          weighted_for_fraction: 1 / 3,
          disagreement_score: 0.6,
          has_team_disagreement: true,
        } as any,
      } as any;
    }

    const envelopes: Parameters<typeof buildCeeDecisionReviewPayload>[0] =
      team
        ? { draft, options, team }
        : { draft, options };

    const cee: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload(envelopes);

    // Optionally override completeness for tests by dropping some envelopes.
    if (opts?.complete === false) {
      // Strip team/evidence/etc. by rebuilding with draft only.
      const incomplete: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({ draft });
      return {
        decisionId: id,
        createdAt: "2024-01-01T00:00:00.000Z",
        cee: incomplete,
      };
    }

    return {
      decisionId: id,
      createdAt: "2024-01-01T00:00:00.000Z",
      cee,
    };
  }

  it("aggregates health bands, truncation, disagreement, and completeness across a portfolio", () => {
    const items: PortfolioDecisionReviewItem[] = [
      makeReview("ok-1", "ok"),
      makeReview("warn-1", "warning", { truncated: true }),
      makeReview("risk-1", "risk", { disagreement: true }),
    ];

    const summary = computePortfolioHealthSummary(items);

    expect(summary.total_decisions).toBe(3);
    expect(summary.ok_count).toBe(1);
    expect(summary.warning_count).toBeGreaterThanOrEqual(1);
    expect(summary.risk_count).toBeGreaterThanOrEqual(1);
    expect(summary.has_truncation_count).toBeGreaterThanOrEqual(1);
    expect(summary.has_disagreement_count).toBeGreaterThanOrEqual(1);
    expect(summary.incomplete_journeys_count).toBeGreaterThanOrEqual(1);
  });

  it("never leaks raw graph labels into the portfolio summary", () => {
    const SECRET = "PORTFOLIO_DO_NOT_LEAK";

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-secret", correlation_id: "r-secret", engine: {} },
      quality: { overall: 7 } as any,
      graph: {
        // Intentionally include a secret marker; helpers and the portfolio
        // summary must not surface it.
        nodes: [{ id: "n1", kind: "goal", label: `Secret ${SECRET}` }],
        edges: [],
      } as any,
    } as any;

    const cee: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({ draft });

    const items: PortfolioDecisionReviewItem[] = [
      {
        decisionId: "secret",
        createdAt: "2024-01-01T00:00:00.000Z",
        cee,
      },
    ];

    const summary = computePortfolioHealthSummary(items);

    const serialized = JSON.stringify(summary).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
