/**
 * CEE v1 Golden Journey Telemetry Sanity Test
 *
 * Runs a healthy golden journey through /assist/v1/* endpoints with the fixtures
 * provider and asserts that expected telemetry events are emitted without any
 * free-text or banned substrings.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

import { build } from "../../src/server.js";
import { TelemetrySink } from "../utils/telemetry-sink.js";
import { TelemetryEvents } from "../../src/utils/telemetry.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import {
  loadCeeGoldenJourney,
  CEE_GOLDEN_JOURNEYS,
} from "../utils/cee-golden-journeys.js";

function serializeAllTelemetry(sink: TelemetrySink): string {
  return JSON.stringify(sink.getEvents().map((e) => e.data)).toLowerCase();
}

interface JourneyStepParams {
  app: FastifyInstance;
  telemetrySink: TelemetrySink;
  method: "POST";
  url: string;
  headers: Record<string, any>;
  payload: any;
  requestedEvent: string;
  succeededEvent: string;
  failedEvent?: string;
}

async function runJourneyStep({
  app,
  telemetrySink,
  method,
  url,
  headers,
  payload,
  requestedEvent,
  succeededEvent,
  failedEvent,
}: JourneyStepParams) {
  const res = await app.inject({ method, url, headers, payload });

  expect(res.statusCode).toBe(200);
  const requestId = res.headers["x-cee-request-id"] as string;

  const requested = telemetrySink
    .getEventsByName(requestedEvent)
    .filter((e) => e.data.request_id === requestId);
  const succeeded = telemetrySink
    .getEventsByName(succeededEvent)
    .filter((e) => e.data.request_id === requestId);

  expect(requested.length).toBe(1);
  expect(succeeded.length).toBe(1);
  expectNoBannedSubstrings(requested[0].data);
  expectNoBannedSubstrings(succeeded[0].data);

  let failed: any[] = [];
  if (failedEvent) {
    failed = telemetrySink
      .getEventsByName(failedEvent)
      .filter((e) => e.data.request_id === requestId);
    expect(failed.length).toBe(0);
  }

  return { res, requestId, requested, succeeded, failed } as const;
}

describe("CEE golden journey telemetry sanity (fixtures provider)", () => {
  let app: FastifyInstance;
  let telemetrySink: TelemetrySink;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-telemetry-golden-journey");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-golden-telemetry-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "10");
    vi.stubEnv("CEE_OPTIONS_FEATURE_VERSION", "options-golden-telemetry-test");
    vi.stubEnv("CEE_OPTIONS_RATE_LIMIT_RPM", "10");
    vi.stubEnv("CEE_EVIDENCE_HELPER_FEATURE_VERSION", "evidence-golden-telemetry-test");
    vi.stubEnv("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM", "10");
    vi.stubEnv("CEE_BIAS_CHECK_FEATURE_VERSION", "bias-golden-telemetry-test");
    vi.stubEnv("CEE_BIAS_CHECK_RATE_LIMIT_RPM", "10");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_FEATURE_VERSION", "team-golden-telemetry-test");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM", "10");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    telemetrySink = new TelemetrySink();
    await telemetrySink.install();
    telemetrySink.clear();
  });

  afterEach(() => {
    telemetrySink.uninstall();
  });

  it("emits requested + succeeded events with no free-text leakage for a healthy golden journey", async () => {
    const SECRET = "GOLDEN_TELEMETRY_SECRET_DO_NOT_LEAK";

    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.HEALTHY_PRODUCT_DECISION);

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-golden-journey" } as const;
    const draftStep = await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers,
      payload: {
        brief: `${fixture.inputs.draft?.brief ?? "Synthetic golden journey"} ${SECRET}`,
        ...(fixture.inputs.draft?.archetype_hint
          ? { archetype_hint: fixture.inputs.draft.archetype_hint }
          : {}),
      },
      requestedEvent: TelemetryEvents.CeeDraftGraphRequested,
      succeededEvent: TelemetryEvents.CeeDraftGraphSucceeded,
      failedEvent: TelemetryEvents.CeeDraftGraphFailed,
    });

    const draftBody = draftStep.res.json();

    await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/options",
      headers,
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
      requestedEvent: TelemetryEvents.CeeOptionsRequested,
      succeededEvent: TelemetryEvents.CeeOptionsSucceeded,
    });

    await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers,
      payload: {
        evidence: fixture.inputs.evidence?.items ?? [],
      },
      requestedEvent: TelemetryEvents.CeeEvidenceHelperRequested,
      succeededEvent: TelemetryEvents.CeeEvidenceHelperSucceeded,
    });

    await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/bias-check",
      headers,
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
      requestedEvent: TelemetryEvents.CeeBiasCheckRequested,
      succeededEvent: TelemetryEvents.CeeBiasCheckSucceeded,
    });

    await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers,
      payload: {
        perspectives: fixture.inputs.team?.perspectives ?? [],
      },
      requestedEvent: TelemetryEvents.CeeTeamPerspectivesRequested,
      succeededEvent: TelemetryEvents.CeeTeamPerspectivesSucceeded,
    });

    const all = serializeAllTelemetry(telemetrySink);
    expect(all.includes(SECRET.toLowerCase())).toBe(false);
  });

  it("emits truncation telemetry for an evidence-heavy golden journey", async () => {
    const fixture = await loadCeeGoldenJourney(
      CEE_GOLDEN_JOURNEYS.EVIDENCE_HEAVY_WITH_TRUNCATION,
    );

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-golden-journey" } as const;
    const draftStep = await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers,
      payload: {
        brief: fixture.inputs.draft?.brief ?? "Synthetic golden journey",
        ...(fixture.inputs.draft?.archetype_hint
          ? { archetype_hint: fixture.inputs.draft.archetype_hint }
          : {}),
      },
      requestedEvent: TelemetryEvents.CeeDraftGraphRequested,
      succeededEvent: TelemetryEvents.CeeDraftGraphSucceeded,
    });

    const draftBody = draftStep.res.json();

    await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/options",
      headers,
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
      requestedEvent: TelemetryEvents.CeeOptionsRequested,
      succeededEvent: TelemetryEvents.CeeOptionsSucceeded,
    });

    const evidenceStep = await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers,
      payload: {
        evidence: fixture.inputs.evidence?.items ?? [],
      },
      requestedEvent: TelemetryEvents.CeeEvidenceHelperRequested,
      succeededEvent: TelemetryEvents.CeeEvidenceHelperSucceeded,
    });

    const evidenceSucceededData = evidenceStep.succeeded[0].data as Record<string, any>;
    expect(typeof evidenceSucceededData.any_truncated).toBe("boolean");
    expect(evidenceSucceededData.any_truncated).toBe(true);

    await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/bias-check",
      headers,
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
      requestedEvent: TelemetryEvents.CeeBiasCheckRequested,
      succeededEvent: TelemetryEvents.CeeBiasCheckSucceeded,
    });
  });

  it("emits disagreement telemetry for a team-disagreement golden journey", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.TEAM_DISAGREEMENT);

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-golden-journey" } as const;
    const draftStep = await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers,
      payload: {
        brief: fixture.inputs.draft?.brief ?? "Synthetic golden journey",
        ...(fixture.inputs.draft?.archetype_hint
          ? { archetype_hint: fixture.inputs.draft.archetype_hint }
          : {}),
      },
      requestedEvent: TelemetryEvents.CeeDraftGraphRequested,
      succeededEvent: TelemetryEvents.CeeDraftGraphSucceeded,
    });

    const draftBody = draftStep.res.json();

    await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/options",
      headers,
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
      requestedEvent: TelemetryEvents.CeeOptionsRequested,
      succeededEvent: TelemetryEvents.CeeOptionsSucceeded,
    });

    await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/bias-check",
      headers,
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
      requestedEvent: TelemetryEvents.CeeBiasCheckRequested,
      succeededEvent: TelemetryEvents.CeeBiasCheckSucceeded,
    });

    const teamStep = await runJourneyStep({
      app,
      telemetrySink,
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers,
      payload: {
        perspectives: fixture.inputs.team?.perspectives ?? [],
      },
      requestedEvent: TelemetryEvents.CeeTeamPerspectivesRequested,
      succeededEvent: TelemetryEvents.CeeTeamPerspectivesSucceeded,
    });

    const succeededData = teamStep.succeeded[0].data as Record<string, any>;
    expect(typeof succeededData.participant_count).toBe("number");
    expect(succeededData.participant_count).toBeGreaterThan(0);
    expect(typeof succeededData.disagreement_score).toBe("number");
  });
});
