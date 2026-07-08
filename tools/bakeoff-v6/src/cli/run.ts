/**
 * Press-run entry point.
 *
 *   npm run smoke                     # deterministic mock run, no network
 *   npm run preflight                 # key + model-access gate only
 *   npm run press -- --run-id r1 \
 *     --attestations attestations.json   # live run (watermarked unless ALL
 *                                        # evidence attestations pass)
 *
 * See README.md for the full gate list (labels, judge clearance, R, real
 * prompts, keys).
 */
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RUN_SEED, DEFAULT_SEEDS } from "../config.ts";
import { runPipeline } from "./pipeline.ts";
import type { ArmId } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      mock: { type: "boolean", default: false },
      "run-id": { type: "string" },
      arms: { type: "string", default: "A,B,C,D" },
      briefs: { type: "string" },
      seeds: { type: "string" },
      "results-dir": { type: "string" },
      attestations: { type: "string" },
      "run-seed": { type: "string" },
      "holistic-llm": { type: "boolean", default: false },
      stage: { type: "string", default: "full" },
      "prompt-set": { type: "string" },
      "frozen-m1-dir": { type: "string" },
    },
  });

  const arms = (values.arms as string)
    .split(",")
    .map((a) => a.trim().toUpperCase())
    .filter((a): a is ArmId => ["A", "B", "C", "D"].includes(a));
  if (arms.length === 0) throw new Error("no valid arms selected");

  const seeds = values.seeds
    ? (values.seeds as string).split(",").map((s) => {
        const n = Number(s.trim());
        if (!Number.isInteger(n)) throw new Error(`invalid seed: ${s}`);
        return n;
      })
    : DEFAULT_SEEDS;

  const runId = (values["run-id"] as string | undefined) ?? `run-${Date.now()}`;

  const summary = await runPipeline({
    runId,
    mock: Boolean(values.mock),
    arms,
    briefFilter: values.briefs ? (values.briefs as string).split(",").map((b) => b.trim()) : null,
    seeds,
    resultsDir: (values["results-dir"] as string | undefined) ?? resolve(HERE, "../../results"),
    attestationsPath: (values.attestations as string | undefined) ?? null,
    runSeed: values["run-seed"] ? Number(values["run-seed"]) : DEFAULT_RUN_SEED,
    holisticLlm: Boolean(values["holistic-llm"]),
    preflightOnly: values.stage === "preflight",
    promptSet: (values["prompt-set"] as string | undefined) ?? null,
    frozenM1Dir: (values["frozen-m1-dir"] as string | undefined) ?? null,
  });

  console.log(`run dir: ${summary.runDir}`);
  if (summary.reportPath) console.log(`report: ${summary.reportPath}`);
  console.log(`candidates: ${summary.rows} (${summary.invalid} invalid, counted per arm)`);
  if (summary.blockedArms.length > 0) {
    for (const blocked of summary.blockedArms) console.log(`BLOCKED arm ${blocked.arm}: ${blocked.reason}`);
  }
  console.log(
    summary.watermark
      ? "watermark: ON — PIPELINE SMOKE TEST, NOT EVIDENCE"
      : "watermark: off (all evidence attestations passed)"
  );
}

main().catch((err) => {
  console.error(`bakeoff-v6 failed: ${(err as Error).message}`);
  process.exit(1);
});
