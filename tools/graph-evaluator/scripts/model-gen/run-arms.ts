/**
 * run-arms — the repeatable, cost-recorded way to run every candidate
 * architecture over the same briefs.
 *
 * THE USER OUTCOME THIS SERVES: the winning architecture is chosen on evidence,
 * not on a memory of one good run. Every call records its own latency, tokens,
 * cost (or an honest null), the deterministic validation result and the
 * projection loss — per brief, per run, per arm, in one shape.
 *
 * ARMS
 *   builder      builder prompt on an OpenAI model with the strict v0 schema (Arm B)
 *   claude-rich  builder prompt on Claude via output_config                 (Arm A′)
 *   widener      builder → widener/critic, ± a DSK allowlist                (Arms C/D)
 *
 * THREE RULES IT ENFORCES ON ITSELF
 *  1. A skip is printed as a SKIP, never as a pass. (Idempotency that reads as a
 *     green run is how a re-run measures nothing.)
 *  2. `est_cost_usd` is null — never 0 — when pricing is unverified.
 *  3. A provider error is RECORDED VERBATIM and the run continues. The schema is
 *     never loosened to make a provider accept it; a rejection is a finding.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { config as loadDotenv } from "dotenv";
import { readBriefs, readModels } from "../../src/io.js";
import { getProvider } from "../../src/providers/index.js";
import type { LLMResult, ModelConfig as ProviderModelConfig } from "../../src/providers/types.js";
import type { Brief, ModelConfig } from "../../src/types.js";
import {
  loadRichSchema,
  assertSchemaMirrorsTypes,
  parseRichModel,
  RichModelParseError,
  type ProjectionReport,
  type RichDecisionModel,
  type ValidationResult,
} from "../../src/rich-model.js";
import { checkWidenerImmutability, validateSourceBinding } from "../../src/source-binding.js";
import { omissionCounts, richToParsedGraph } from "../../src/rich-to-graph.js";
import { selectDskForBrief, type DskSelection } from "./dsk-allowlist.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, "..", "..");
const REPO_ROOT = resolve(TOOL_ROOT, "..", "..");

const SCHEMA_NAME = "rich_decision_model";

type ArmName = "builder" | "widener" | "claude-rich";
type CallRole = "builder" | "widener" | "critic";

interface CallRecord {
  role: CallRole;
  model_id: string;
  model: string;
  provider: string;
  status: "success" | "provider_error" | "parse_failed";
  /** Provider error text, VERBATIM. null on success. */
  error: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  /** null whenever the model's pricing is unverified — NEVER 0. */
  est_cost_usd: number | null;
  pricing_source: string | null;
}

interface RunResult {
  arm: ArmName;
  models: { builder: string | null; widener: string | null; critic: string | null };
  brief: string;
  run: number;
  started_at: string;
  calls: CallRecord[];
  est_cost_usd_total: number | null;
  dsk: { mode: "on" | "off"; tags: string[]; allowlisted_ids: string[] };
  validation: {
    source_binding: ValidationResult | null;
    immutability: ValidationResult | null;
    dsk_grounding: ValidationResult | null;
  };
  projection_report: ProjectionReport | null;
  projection_omission_counts: Record<string, number> | null;
  rich_model: RichDecisionModel | null;
  graph: unknown;
  error: string | null;
}

// =============================================================================
// Pricing
// =============================================================================

interface PricedConfig extends ModelConfig {
  pricing_verified?: boolean;
}

/**
 * Cost for one call, or null when we do not actually know the rate.
 *
 * A 0 in a cost column reads as "free" and gets compared against real numbers.
 * Terra and Sol ship placeholder pricing precisely so nobody silently fills it.
 */
export function estimateCost(config: PricedConfig, result: LLMResult): number | null {
  const pricing = config.pricing;
  if (pricing == null) return null;
  if (config.pricing_verified === false) return null;
  if (pricing.source.trim().toLowerCase().startsWith("unknown")) return null;
  const input = result.input_tokens ?? 0;
  const output = result.output_tokens ?? 0;
  return (input / 1_000_000) * pricing.input_per_1m + (output / 1_000_000) * pricing.output_per_1m;
}

// =============================================================================
// Schema injection
// =============================================================================

/**
 * Attach the strict v0 grammar to a COPY of the model config.
 *
 * The two providers are NOT symmetric and the difference is a 400:
 *   OpenAI    params.text.format = {type, name, strict, schema}   (Responses API)
 *   Anthropic output_config.format = {type, schema}               (no name, no strict)
 */
export function withRichSchema(
  config: ModelConfig,
  schema: Record<string, unknown>,
): ProviderModelConfig {
  const copy = JSON.parse(JSON.stringify(config)) as ProviderModelConfig;
  if (config.provider === "anthropic") {
    copy.output_config = { format: { type: "json_schema", schema } };
    return copy;
  }
  copy.params = {
    ...(copy.params ?? {}),
    text: { format: { type: "json_schema", name: SCHEMA_NAME, strict: true, schema } },
  };
  return copy;
}

// =============================================================================
// DSK grounding
// =============================================================================

/** Any dsk_ref outside the allowlist is a grounding failure and counts against the arm. */
export function checkDskGrounding(
  model: RichDecisionModel,
  allowlist: readonly string[],
): ValidationResult {
  const allowed = new Set(allowlist);
  const failures = [];
  const sources: Array<[string, string[]]> = [
    ...model.factors.map((f): [string, string[]] => [f.id, f.dsk_refs]),
    ...model.outcomes.map((o): [string, string[]] => [o.id, o.dsk_refs]),
    ...model.causal_links.map((l): [string, string[]] => [l.id, l.dsk_refs]),
    ...model.notes.map((n, i): [string, string[]] => [n.about_id ?? `note[${i}]`, n.dsk_refs]),
  ];
  for (const [itemId, refs] of sources) {
    for (const ref of refs) {
      if (!allowed.has(ref)) {
        failures.push({
          gate: "DSK1_ref_not_in_allowlist",
          item_id: itemId,
          detail: `cites '${ref}', which was not in the ${allowlist.length}-id allowlist supplied to the prompt`,
        });
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

// =============================================================================
// One call
// =============================================================================

interface CallOutcome {
  record: CallRecord;
  raw: LLMResult;
  model: RichDecisionModel | null;
  parseIssues: string[] | null;
}

async function makeCall(
  role: CallRole,
  config: PricedConfig,
  schema: Record<string, unknown>,
  system: string,
  user: string,
): Promise<CallOutcome> {
  const wired = withRichSchema(config, schema);
  const provider = getProvider(wired);
  const result = await provider.chat(system, user, wired);

  const base: CallRecord = {
    role,
    model_id: config.id,
    model: config.model,
    provider: config.provider,
    status: result.ok ? "success" : "provider_error",
    error: result.error,
    latency_ms: result.latency_ms,
    input_tokens: result.input_tokens ?? null,
    output_tokens: result.output_tokens ?? null,
    reasoning_tokens: result.reasoning_tokens ?? null,
    est_cost_usd: estimateCost(config, result),
    pricing_source: config.pricing?.source ?? null,
  };

  if (!result.ok || result.text == null) {
    return { record: base, raw: result, model: null, parseIssues: null };
  }

  try {
    return { record: base, raw: result, model: parseRichModel(result.text), parseIssues: null };
  } catch (err) {
    const issues = err instanceof RichModelParseError ? err.issues : [String(err)];
    return {
      record: { ...base, status: "parse_failed", error: err instanceof Error ? err.message : String(err) },
      raw: result,
      model: null,
      parseIssues: issues,
    };
  }
}

// =============================================================================
// One (arm, brief, run)
// =============================================================================

interface ArmContext {
  arm: ArmName;
  builderConfig: PricedConfig | null;
  widenerConfig: PricedConfig | null;
  criticConfig: PricedConfig | null;
  builderPrompt: string;
  widenerPrompt: string;
  schema: Record<string, unknown>;
  dskMode: "on" | "off";
  outDir: string;
}

async function runOne(ctx: ArmContext, brief: Brief, run: number): Promise<RunResult> {
  const runDir = join(ctx.outDir, ctx.arm, brief.id, `run-${run}`);
  await mkdir(runDir, { recursive: true });

  const result: RunResult = {
    arm: ctx.arm,
    models: {
      builder: ctx.builderConfig?.id ?? null,
      widener: ctx.widenerConfig?.id ?? null,
      critic: ctx.criticConfig?.id ?? null,
    },
    brief: brief.id,
    run,
    started_at: new Date().toISOString(),
    calls: [],
    est_cost_usd_total: null,
    dsk: { mode: ctx.dskMode, tags: [], allowlisted_ids: [] },
    validation: { source_binding: null, immutability: null, dsk_grounding: null },
    projection_report: null,
    projection_omission_counts: null,
    rich_model: null,
    graph: null,
    error: null,
  };

  if (ctx.builderConfig == null) {
    result.error = "no builder model configured";
    return result;
  }

  // --- builder call ---------------------------------------------------------
  const builder = await makeCall(
    "builder",
    ctx.builderConfig,
    ctx.schema,
    ctx.builderPrompt,
    brief.body,
  );
  result.calls.push(builder.record);
  await writeFile(join(runDir, "builder-raw.json"), JSON.stringify(builder.raw, null, 2));
  if (builder.parseIssues != null) {
    await writeFile(
      join(runDir, "builder-parse-issues.json"),
      JSON.stringify(builder.parseIssues, null, 2),
    );
  }
  if (builder.model == null) {
    result.error = `builder call did not yield a rich model: ${builder.record.error ?? "unknown"}`;
    await finalise(result, runDir);
    return result;
  }
  await writeFile(join(runDir, "builder-model.json"), JSON.stringify(builder.model, null, 2));

  let finalModel = builder.model;

  // --- widener call ---------------------------------------------------------
  if (ctx.arm === "widener") {
    if (ctx.widenerConfig == null) {
      result.error = "arm 'widener' requires --widener-model";
      await finalise(result, runDir);
      return result;
    }
    let dsk: DskSelection = { tags: [], ids: [], block: "" };
    if (ctx.dskMode === "on") {
      dsk = selectDskForBrief(
        brief.body,
        join(REPO_ROOT, "data", "dsk", "v1.json"),
        join(REPO_ROOT, "data", "dsk", "context-tags.json"),
      );
      result.dsk = { mode: "on", tags: dsk.tags, allowlisted_ids: dsk.ids };
    }

    const widenerUser = `${brief.body}\n\n<builder_model>\n${JSON.stringify(
      builder.model,
      null,
      2,
    )}\n</builder_model>`;
    const widener = await makeCall(
      "widener",
      ctx.widenerConfig,
      ctx.schema,
      ctx.widenerPrompt + dsk.block,
      widenerUser,
    );
    result.calls.push(widener.record);
    await writeFile(join(runDir, "widener-raw.json"), JSON.stringify(widener.raw, null, 2));
    if (widener.parseIssues != null) {
      await writeFile(
        join(runDir, "widener-parse-issues.json"),
        JSON.stringify(widener.parseIssues, null, 2),
      );
    }
    if (widener.model == null) {
      result.error = `widener call did not yield a rich model: ${widener.record.error ?? "unknown"}`;
      // The builder model is still validated below — a dead widener must not
      // erase the evidence the builder produced.
    } else {
      await writeFile(join(runDir, "widener-model.json"), JSON.stringify(widener.model, null, 2));
      result.validation.immutability = checkWidenerImmutability(builder.model, widener.model);
      result.validation.dsk_grounding = checkDskGrounding(widener.model, dsk.ids);
      finalModel = widener.model;
    }

    // --- optional critic pass (UNEXERCISED in the WP3 smoke) ----------------
    if (ctx.criticConfig != null && widener.model != null) {
      const criticUser = `${brief.body}\n\n<builder_model>\n${JSON.stringify(
        widener.model,
        null,
        2,
      )}\n</builder_model>`;
      const critic = await makeCall(
        "critic",
        ctx.criticConfig,
        ctx.schema,
        ctx.widenerPrompt + dsk.block,
        criticUser,
      );
      result.calls.push(critic.record);
      await writeFile(join(runDir, "critic-raw.json"), JSON.stringify(critic.raw, null, 2));
      if (critic.model != null) {
        await writeFile(join(runDir, "critic-model.json"), JSON.stringify(critic.model, null, 2));
        finalModel = critic.model;
      }
    }
  }

  // --- deterministic validation + projection --------------------------------
  result.rich_model = finalModel;
  result.validation.source_binding = validateSourceBinding(brief.body, finalModel);
  try {
    const projected = richToParsedGraph(finalModel);
    result.graph = projected.graph;
    result.projection_report = projected.report;
    result.projection_omission_counts = omissionCounts(projected.report);
    await writeFile(join(runDir, "graph.json"), JSON.stringify(projected.graph, null, 2));
  } catch (err) {
    // A projection THROW is a result, not a crash: it means the model carried an
    // item whose provenance could not be established, which is exactly what the
    // trust gate exists to refuse.
    result.error = `projection refused: ${err instanceof Error ? err.message : String(err)}`;
  }

  await finalise(result, runDir);
  return result;
}

async function finalise(result: RunResult, runDir: string): Promise<void> {
  const costs = result.calls.map((c) => c.est_cost_usd);
  result.est_cost_usd_total = costs.some((c) => c == null)
    ? null
    : costs.reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
  await writeFile(join(runDir, "result.json"), JSON.stringify(result, null, 2));
}

// =============================================================================
// Summary table
// =============================================================================

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function printSummary(rows: Array<RunResult | { skipped: RunResult }>): void {
  const header = [
    pad("ARM", 12),
    pad("BRIEF", 22),
    pad("RUN", 4),
    pad("STATUS", 14),
    pad("LAT(ms)", 9),
    pad("TOK i/o", 13),
    pad("COST$", 10),
    pad("SB", 6),
    pad("IMM", 6),
    "OMITTED",
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const row of rows) {
    const skipped = "skipped" in row;
    const r = skipped ? row.skipped : row;
    const latency = r.calls.reduce((a, c) => a + c.latency_ms, 0);
    const input = r.calls.reduce((a, c) => a + (c.input_tokens ?? 0), 0);
    const output = r.calls.reduce((a, c) => a + (c.output_tokens ?? 0), 0);
    const status = skipped
      ? "SKIP(cached)"
      : r.error != null
        ? "ERROR"
        : r.calls.every((c) => c.status === "success")
          ? "ok"
          : (r.calls.find((c) => c.status !== "success")?.status ?? "ok");
    const counts = r.projection_omission_counts;
    console.log(
      [
        pad(r.arm, 12),
        pad(r.brief, 22),
        pad(String(r.run), 4),
        pad(status, 14),
        pad(String(latency), 9),
        pad(`${input}/${output}`, 13),
        pad(r.est_cost_usd_total == null ? "null" : r.est_cost_usd_total.toFixed(5), 10),
        pad(
          r.validation.source_binding == null
            ? "-"
            : r.validation.source_binding.ok
              ? "ok"
              : `${r.validation.source_binding.failures.length}F`,
          6,
        ),
        pad(
          r.validation.immutability == null
            ? "-"
            : r.validation.immutability.ok
              ? "ok"
              : `${r.validation.immutability.failures.length}F`,
          6,
        ),
        counts == null
          ? "-"
          : Object.entries(counts)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${k}=${v}`)
              .join(" ") || "none",
      ].join(" "),
    );
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  loadDotenv({ path: join(TOOL_ROOT, ".env") });
  loadDotenv({ path: join(REPO_ROOT, ".env") });

  const program = new Command()
    .name("run-arms")
    .description("Run builder / widener / claude-rich arms over briefs with the rich v0 contract")
    .requiredOption("--arm <arm>", "builder | widener | claude-rich")
    .option("--builder-model <id>", "model config id for the builder call", "gpt-4.1-strict")
    .option("--widener-model <id>", "model config id for the widener call")
    .option("--critic-model <id>", "optional third pass with the widener prompt")
    .requiredOption("--briefs <ids>", "comma-separated brief ids")
    .option("--runs <n>", "runs per brief", "1")
    .option("--out <dir>", "output directory", join(REPO_ROOT, "..", "output", "model-gen-20260921", "wp3", "runs"))
    .option("--dsk <mode>", "on | off", "off")
    .option("--env-file <path>", "extra dotenv file to load (never printed)")
    .option("--force", "re-run and overwrite an existing result.json", false)
    .option("--dry-run", "plan the calls and print them; spend nothing", false)
    .parse();

  const opts = program.opts();
  if (opts["envFile"] != null) loadDotenv({ path: resolve(String(opts["envFile"])) });

  const arm = String(opts["arm"]) as ArmName;
  if (!["builder", "widener", "claude-rich"].includes(arm)) {
    throw new Error(`Unknown --arm '${arm}'. Expected builder | widener | claude-rich.`);
  }
  const dskMode = String(opts["dsk"]) === "on" ? "on" : "off";
  const runs = Number(opts["runs"]);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer`);

  // Drift check BEFORE spending anything.
  assertSchemaMirrorsTypes();
  const schema = loadRichSchema();

  const briefIds = String(opts["briefs"])
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const briefs = await readBriefs(join(TOOL_ROOT, "briefs"), briefIds);
  if (briefs.length !== briefIds.length) {
    const found = briefs.map((b) => b.id);
    throw new Error(
      `Briefs not found: [${briefIds.filter((id) => !found.includes(id)).join(", ")}] — zero-collection is a hard error, never an empty pass.`,
    );
  }

  const allModels = (await readModels(join(TOOL_ROOT, "models"))) as PricedConfig[];
  const byId = new Map(allModels.map((m) => [m.id, m]));
  const pick = (id: string | undefined, label: string): PricedConfig | null => {
    if (id == null) return null;
    const found = byId.get(id);
    if (found == null) {
      throw new Error(`${label} model '${id}' not found in models/ (have: ${[...byId.keys()].join(", ")})`);
    }
    return found;
  };

  const builderId = arm === "claude-rich" ? "claude-sonnet-4-6-rich" : String(opts["builderModel"]);
  const ctx: ArmContext = {
    arm,
    builderConfig: pick(builderId, "builder"),
    widenerConfig: pick(opts["widenerModel"] as string | undefined, "widener"),
    criticConfig: pick(opts["criticModel"] as string | undefined, "critic"),
    builderPrompt: await readFile(join(TOOL_ROOT, "contracts", "builder.v0.txt"), "utf-8"),
    widenerPrompt: await readFile(join(TOOL_ROOT, "contracts", "widener.v0.txt"), "utf-8"),
    schema,
    dskMode,
    outDir: resolve(String(opts["out"])),
  };

  if (arm === "widener" && ctx.widenerConfig == null) {
    throw new Error("--arm widener requires --widener-model");
  }

  const rows: Array<RunResult | { skipped: RunResult }> = [];
  let calls = 0;

  for (const brief of briefs) {
    for (let run = 1; run <= runs; run += 1) {
      const runDir = join(ctx.outDir, arm, brief.id, `run-${run}`);
      const resultPath = join(runDir, "result.json");
      if (existsSync(resultPath) && opts["force"] !== true) {
        const cached = JSON.parse(await readFile(resultPath, "utf-8")) as RunResult;
        rows.push({ skipped: cached });
        continue;
      }
      if (opts["dryRun"] === true) {
        console.log(
          `[dry-run] would call ${ctx.builderConfig?.id}${
            arm === "widener" ? ` → ${ctx.widenerConfig?.id}` : ""
          } on ${brief.id} run ${run} (dsk=${dskMode})`,
        );
        continue;
      }
      const result = await runOne(ctx, brief, run);
      calls += result.calls.length;
      rows.push(result);
    }
  }

  if (opts["dryRun"] === true) return;

  if (rows.length === 0) {
    throw new Error("Zero rows produced — that is a hard error, not an empty pass.");
  }
  printSummary(rows);
  console.log(`\nmodel calls spent this invocation: ${calls}`);
  console.log(`results: ${ctx.outDir}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
