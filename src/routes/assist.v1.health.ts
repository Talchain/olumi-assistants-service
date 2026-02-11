import type { FastifyInstance } from "fastify";
import { env } from "node:process";
import { SERVICE_VERSION, GIT_COMMIT_SHORT, BUILD_TIMESTAMP } from "../version.js";
import { getAdapter } from "../adapters/llm/router.js";
import { getAllFeatureFlags } from "../utils/feature-flags.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRecentCeeErrors } from "../cee/logging.js";
import { DRAFT_REQUEST_BUDGET_MS, LLM_POST_PROCESSING_HEADROOM_MS, DRAFT_LLM_TIMEOUT_MS } from "../config/timeouts.js";

export default async function route(app: FastifyInstance) {
  app.get("/assist/v1/health", async (_req, reply) => {
    const adapter = getAdapter();

    const ceeConfig = {
      draft_graph: {
        feature_version: env.CEE_DRAFT_FEATURE_VERSION || "draft-model-1.0.0",
        rate_limit_rpm: resolveCeeRateLimit("CEE_DRAFT_RATE_LIMIT_RPM"),
      },
      options: {
        feature_version: env.CEE_OPTIONS_FEATURE_VERSION || "options-1.0.0",
        rate_limit_rpm: resolveCeeRateLimit("CEE_OPTIONS_RATE_LIMIT_RPM"),
      },
      bias_check: {
        feature_version: env.CEE_BIAS_CHECK_FEATURE_VERSION || "bias-check-1.0.0",
        rate_limit_rpm: resolveCeeRateLimit("CEE_BIAS_CHECK_RATE_LIMIT_RPM"),
      },
      evidence_helper: {
        feature_version:
          env.CEE_EVIDENCE_HELPER_FEATURE_VERSION || "evidence-helper-1.0.0",
        rate_limit_rpm: resolveCeeRateLimit("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM"),
      },
      sensitivity_coach: {
        feature_version:
          env.CEE_SENSITIVITY_COACH_FEATURE_VERSION || "sensitivity-coach-1.0.0",
        rate_limit_rpm: resolveCeeRateLimit("CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM"),
      },
      team_perspectives: {
        feature_version:
          env.CEE_TEAM_PERSPECTIVES_FEATURE_VERSION || "team-perspectives-1.0.0",
        rate_limit_rpm: resolveCeeRateLimit("CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM"),
      },
      explain_graph: {
        feature_version: env.CEE_EXPLAIN_FEATURE_VERSION || "explain-model-1.0.0",
        rate_limit_rpm: resolveCeeRateLimit("CEE_EXPLAIN_RATE_LIMIT_RPM"),
      },
    } as const;

    const recentErrors = getRecentCeeErrors(50);

    let recent_error_counts: {
      total: number;
      by_capability: Record<string, number>;
      by_status: Record<string, number>;
      by_error_code: Record<string, number>;
    } | undefined;

    if (recentErrors.length > 0) {
      const by_capability: Record<string, number> = {};
      const by_status: Record<string, number> = {};
      const by_error_code: Record<string, number> = {};

      for (const err of recentErrors) {
        if (!err || typeof err !== "object") continue;
        const capability = typeof (err as any).capability === "string" ? (err as any).capability : "unknown";
        const status = typeof (err as any).status === "string" ? (err as any).status : "unknown";
        const errorCode = typeof (err as any).error_code === "string" ? (err as any).error_code : "";

        by_capability[capability] = (by_capability[capability] ?? 0) + 1;
        by_status[status] = (by_status[status] ?? 0) + 1;
        if (errorCode) {
          by_error_code[errorCode] = (by_error_code[errorCode] ?? 0) + 1;
        }
      }

      recent_error_counts = {
        total: recentErrors.length,
        by_capability,
        by_status,
        by_error_code,
      };
    }

    const summary = {
      service: "assistants",
      version: SERVICE_VERSION,
      commit: GIT_COMMIT_SHORT,
      build_timestamp: BUILD_TIMESTAMP,
      provider: adapter.name,
      model: adapter.model,
      limits_source: env.ENGINE_BASE_URL ? "engine" : "config",
      diagnostics_enabled: env.CEE_DIAGNOSTICS_ENABLED === "true",
      feature_flags: getAllFeatureFlags(),
      timeout_config: {
        DRAFT_REQUEST_BUDGET_MS,
        LLM_POST_PROCESSING_HEADROOM_MS,
        DRAFT_LLM_TIMEOUT_MS,
      },
      cee_config: ceeConfig,
      recent_error_counts,
    };

    reply.code(200);
    return summary;
  });
}
