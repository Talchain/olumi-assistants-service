import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  GOVERNED_PACK_ROOT,
  REPO_ROOT,
  assertLegacyRubricIdentity,
  buildGovernedRunIdentity,
  loadGovernedBriefs,
  scoreGovernedRun,
  summariseGovernedScores,
  verifyGovernedPack,
  type GovernedCaseCapture,
} from "./governed-draft-graph.js";

const RESULT_PATH = join(
  GOVERNED_PACK_ROOT,
  "baseline",
  "run-b9389df-claude-sonnet-4-6.json",
);

interface DraftResult {
  readonly graph: unknown;
  readonly record_disclosures?: unknown;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
  readonly meta?: {
    readonly model?: string;
    readonly prompt_version?: string;
    readonly prompt_hash?: string;
    readonly prompt_store_version?: number | null;
    readonly structured_outputs_used?: boolean;
    readonly provider_latency_ms?: number;
    readonly finish_reason?: string;
    readonly streamed?: boolean;
    readonly salvaged_from_truncation?: boolean;
    readonly runaway_abort_count?: number;
    readonly runaway_abort_triggers?: readonly string[];
  };
}

type DraftFunction = (
  args: {
    brief: string;
    docs: readonly [];
    seed: number;
    model: string;
    currencyInstruction: string;
    thinking: { type: "disabled" };
  },
  opts: {
    timeoutMs: number;
    maxTokensCeiling: number;
    preloadedSystemPrompt: {
      operation: "draft_graph";
      content: string;
      meta: {
        taskId: "draft_graph";
        source: "store";
        promptId: string;
        version: number;
        prompt_version: string;
        prompt_hash: string;
        isStaging: false;
        cache_status: "fresh";
        use_staging_mode: true;
        modelConfig: { staging: string; production: string };
      };
    };
  },
) => Promise<DraftResult>;

function requireExactEnvironment(): void {
  const expected: Readonly<Record<string, string>> = {
    CEE_ANTHROPIC_STRUCTURED_OUTPUTS: "true",
    CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED: "true",
    CEE_BRIEF_SIGNALS_HEADER_ENABLED: "false",
    CEE_DRAFT_GRAPH_THINKING: "false",
    ANTHROPIC_PROMPT_CACHE_ENABLED: "true",
  };
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required; no provider call was made");
  }
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      throw new Error(`${name} must equal ${value}; no provider call was made`);
    }
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function classifyProviderFailure(error: unknown): string {
  const record = error && typeof error === "object"
    ? error as { status?: unknown; truncated_at_max_tokens?: unknown; message?: unknown; name?: unknown }
    : {};
  const status = finite(record.status);
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 429 || message.includes("rate limit")) return "RATE_LIMITED";
  if ((status ?? 0) >= 500) return "PROVIDER_5XX";
  if (record.truncated_at_max_tokens === true || message.includes("truncated at max_tokens")) {
    return "MAX_TOKENS_TRUNCATION";
  }
  if (name.includes("timeout") || name.includes("abort") || message.includes("timed out")) {
    return "TIMEOUT";
  }
  if (message.includes("structured output")) return "STRUCTURED_OUTPUTS_REJECTED";
  if (message.includes("draft_records_schema_invalid")) return "RECORD_SET_SCHEMA_INVALID";
  if (message.includes("draft_records_") || message.includes("records_projection")) {
    return "RECORD_PROJECTION_FAILED";
  }
  if (message.includes("non-json") || message.includes("non json")) return "NON_JSON";
  if (message.includes("invalid_schema") || message.includes("graph_invalid")) {
    return "GRAPH_SCHEMA_INVALID";
  }
  return "PROVIDER_FAILURE";
}

function errorClass(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) return name.slice(0, 100);
  }
  return "UnknownError";
}

function estimatedConfiguredRateCost(
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  inputPerMillion: number,
  outputPerMillion: number,
): number {
  return (
    ((inputTokens + cacheCreationTokens + cacheReadTokens) / 1_000_000) * inputPerMillion +
    (outputTokens / 1_000_000) * outputPerMillion
  );
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, path);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--confirm-14-primary") {
    throw new Error(
      "live baseline requires the single explicit flag --confirm-14-primary; no provider call was made",
    );
  }
  const verification = await verifyGovernedPack();
  assertLegacyRubricIdentity(verification.manifest);
  if (!verification.ok) {
    throw new Error(
      `governed pack is not exact: ${verification.problems.map((item) => item.code).join(", ")}`,
    );
  }
  requireExactEnvironment();

  const manifest = verification.manifest;
  const promptText = await readFile(join(GOVERNED_PACK_ROOT, manifest.prompt.path), "utf8");
  const briefs = await loadGovernedBriefs(manifest);
  const modelConfig = JSON.parse(
    await readFile(join(REPO_ROOT, "tools", "graph-evaluator", manifest.model.model_config_path), "utf8"),
  ) as { pricing: { input_per_1m: number; output_per_1m: number } };

  const anthropicSpecifier = pathToFileURL(join(REPO_ROOT, "src/adapters/llm/anthropic.ts")).href;
  const currencySpecifier = pathToFileURL(join(REPO_ROOT, "src/cee/signals/currency-signal.ts")).href;
  const timeoutSpecifier = pathToFileURL(join(REPO_ROOT, "src/config/timeouts.ts")).href;
  const completionSpecifier = pathToFileURL(
    join(REPO_ROOT, "src/cee/draft/records/completion.ts"),
  ).href;
  const [anthropicModule, currencyModule, timeoutModule, completionModule] = await Promise.all([
    import(anthropicSpecifier),
    import(currencySpecifier),
    import(timeoutSpecifier),
    import(completionSpecifier),
  ]);
  const draftGraph = anthropicModule.draftGraphWithAnthropic as DraftFunction;
  const detectCurrency = currencyModule.detectCurrency as (brief: string) => unknown;
  const buildCurrencyInstruction = currencyModule.buildCurrencyInstruction as (signal: unknown) => string;
  if (
    timeoutModule.DRAFT_LLM_TIMEOUT_MS !== manifest.invocation.timeout_ms ||
    timeoutModule.DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL !== manifest.invocation.max_tokens_ceiling ||
    completionModule.RECORDS_COMPLETION_MAX_TOKENS !== manifest.invocation.completion_max_tokens ||
    completionModule.RECORDS_COMPLETION_WALL_MS !== manifest.invocation.completion_wall_ms
  ) {
    throw new Error("runtime budget constants differ from the pinned invocation; no provider call was made");
  }

  const promptVersion = `${manifest.prompt.prompt_id}@v${manifest.prompt.store_version} (production)`;
  const captures: GovernedCaseCapture[] = [];
  for (const [index, brief] of briefs.entries()) {
    const startedAt = Date.now();
    try {
      const result = await draftGraph(
        {
          brief: brief.body,
          docs: [],
          seed: manifest.invocation.seed,
          model: manifest.model.model_id,
          currencyInstruction: buildCurrencyInstruction(detectCurrency(brief.body)),
          thinking: { type: "disabled" },
        },
        {
          timeoutMs: manifest.invocation.timeout_ms,
          maxTokensCeiling: manifest.invocation.max_tokens_ceiling,
          preloadedSystemPrompt: {
            operation: "draft_graph",
            content: promptText,
            meta: {
              taskId: "draft_graph",
              source: "store",
              promptId: manifest.prompt.prompt_id,
              version: manifest.prompt.store_version,
              prompt_version: promptVersion,
              prompt_hash: manifest.prompt.sha256,
              isStaging: false,
              cache_status: "fresh",
              use_staging_mode: true,
              modelConfig: {
                staging: manifest.model.staging,
                production: manifest.model.production,
              },
            },
          },
        },
      );
      const elapsed = Date.now() - startedAt;
      const usage = result.usage ?? {};
      const inputTokens = finite(usage.input_tokens) ?? 0;
      const outputTokens = finite(usage.output_tokens) ?? 0;
      const cacheCreationTokens = finite(usage.cache_creation_input_tokens) ?? 0;
      const cacheReadTokens = finite(usage.cache_read_input_tokens) ?? 0;
      const identityExact =
        result.meta?.model === manifest.model.model_id &&
        result.meta?.prompt_version === promptVersion &&
        result.meta?.prompt_hash === manifest.prompt.sha256 &&
        result.meta?.prompt_store_version === manifest.prompt.store_version &&
        result.meta?.structured_outputs_used === true;
      const safeCommon = {
        brief_id: brief.id,
        model_id: manifest.model.model_id,
        prompt_sha256: manifest.prompt.sha256,
        serving_record_disclosures_count: 0,
        structured_outputs_used: result.meta?.structured_outputs_used,
        prompt_version: result.meta?.prompt_version,
        prompt_store_version: result.meta?.prompt_store_version,
        latency_ms: elapsed,
        provider_latency_ms: finite(result.meta?.provider_latency_ms),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreationTokens,
        cache_read_input_tokens: cacheReadTokens,
        finish_reason: result.meta?.finish_reason,
        streamed: result.meta?.streamed,
        salvaged_from_truncation: result.meta?.salvaged_from_truncation,
        runaway_abort_count: finite(result.meta?.runaway_abort_count),
        runaway_abort_triggers: result.meta?.runaway_abort_triggers,
        estimated_cost_usd: estimatedConfiguredRateCost(
          inputTokens,
          outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          modelConfig.pricing.input_per_1m,
          modelConfig.pricing.output_per_1m,
        ),
      } as const;
      if (!identityExact) {
        captures.push({
          ...safeCommon,
          status: "failed",
          failure_code: "PROMPT_IDENTITY_MISMATCH",
          error_class: "IdentityMismatch",
        });
      } else {
        const disclosures = Array.isArray(result.record_disclosures)
          ? result.record_disclosures
          : [];
        captures.push({
          ...safeCommon,
          status: "success",
          graph: result.graph,
          record_disclosures: disclosures,
          // The serving AnthropicAdapter currently projects graph/rationales/
          // usage/coaching/debug/meta only. The evaluator retains the raw
          // direct-function sidecar, then models the live wrapper loss here.
          serving_record_disclosures_count: 0,
        });
      }
    } catch (error) {
      captures.push({
        brief_id: brief.id,
        status: "failed",
        failure_code: classifyProviderFailure(error),
        error_class: errorClass(error),
        model_id: manifest.model.model_id,
        prompt_sha256: manifest.prompt.sha256,
        serving_record_disclosures_count: 0,
        latency_ms: Date.now() - startedAt,
      });
    }
    const capture = captures.at(-1)!;
    process.stdout.write(
      `case ${index + 1}/14 ${brief.id}: ${capture.status}` +
      `${capture.failure_code ? ` (${capture.failure_code})` : ""}\n`,
    );
  }

  const identity = buildGovernedRunIdentity(manifest);
  const run = await scoreGovernedRun("baseline", identity, captures, manifest);
  const summary = summariseGovernedScores(run.scores);
  const totalLatencyMs = captures.reduce((sum, item) => sum + (item.latency_ms ?? 0), 0);
  const totalInputTokens = captures.reduce((sum, item) => sum + (item.input_tokens ?? 0), 0);
  const totalOutputTokens = captures.reduce((sum, item) => sum + (item.output_tokens ?? 0), 0);
  const totalCacheCreationTokens = captures.reduce(
    (sum, item) => sum + (item.cache_creation_input_tokens ?? 0),
    0,
  );
  const totalCacheReadTokens = captures.reduce(
    (sum, item) => sum + (item.cache_read_input_tokens ?? 0),
    0,
  );
  const measuredConfiguredRateCost = captures.reduce(
    (sum, item) => sum + (item.estimated_cost_usd ?? 0),
    0,
  );
  const baselineComplete = summary.adapter_success_count === manifest.corpus.cardinality &&
    summary.structured_outputs_count === manifest.corpus.cardinality;
  const artifact = {
    schema_version: "olumi.draft_graph.governed_baseline_artifact.v1",
    generated_at: new Date().toISOString(),
    baseline_status: baselineComplete ? "COMPLETE" : "INCOMPLETE",
    candidate_status: "HOLD_WITH_EVIDENCE",
    run,
    summary,
    execution: {
      logical_primary_calls: manifest.corpus.cardinality,
      manual_retries: 0,
      completion_calls_max: manifest.model.completion_calls_per_arm_max,
      completion_call_count_observed: null,
      completion_usage_observability: "not_exposed_by_adapter_result",
      total_latency_ms: totalLatencyMs,
      mean_latency_ms: totalLatencyMs / manifest.corpus.cardinality,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cache_creation_input_tokens: totalCacheCreationTokens,
      cache_read_input_tokens: totalCacheReadTokens,
      configured_rate_estimate_usd: measuredConfiguredRateCost,
      configured_rate_estimate_note:
        "Uses the model file's base input/output rates for all reported input categories; exact cache-tier and additive completion costs are not surfaced by this adapter result.",
      authorised_external_spend_cap_usd: manifest.invocation.external_spend_cap_usd,
    },
    serving_equivalence: {
      first_primary_prompt_composition_and_model:
        "exact_under_pinned_direct_adapter_configuration",
      scope_limit: "not_whole_route_or_request_bytes",
      prompt_source: "pinned_pms_snapshot",
      route_dynamic_suffixes: "currency_derived_per_brief; other optional suffixes explicitly absent",
      output_wrapper: "audited_separately",
      record_disclosure_wrapper_status: "live_anthropic_adapter_drops_sidecar",
    },
    hold_reasons: [
      "No candidate arm was authorised or executed.",
      "Deployed exact-SHA evidence contains both draft_graph_cee_graph_invalid and a successful rerun, demonstrating stochastic reliability risk.",
      "The live AnthropicAdapter field projection drops record_disclosures; raw projector disclosures are scored here and their serving loss is reported, not hidden.",
    ],
  };
  await writeJsonAtomically(RESULT_PATH, artifact);
  process.stdout.write(
    `baseline ${artifact.baseline_status}; candidate ${artifact.candidate_status}; result ${RESULT_PATH}\n`,
  );
}

await main();
