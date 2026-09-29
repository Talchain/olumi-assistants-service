/**
 * ROADMAP 2.763 — the LLM graph-repair capability is RETIRED.
 *
 * Why it went, in evidence:
 *   - 2.731 (#846): 0 successes in 12 invocations over a full 7-day efficacy
 *     window; the draft path's originating caller was removed.
 *   - 2.740a (#851): 0 invocations across 398 executions while armed to run a
 *     60 s gpt-4.1 call on every turn if a dashboard flag flipped; substep 1b's
 *     originating caller and the legacy graph-orchestrator limbs were removed.
 *   - 2.763 (this change): with both originating callers gone, the only
 *     `.repairGraph(` sites left in `src/` were four decorators delegating to
 *     each other — a complete, working, unreachable LLM path that anyone could
 *     re-wire while assuming it was live. The capability itself is now gone.
 *
 * THE DISCRIMINATING PAIR. A removal is only honest if you can show you took
 * out the broken half and left the working one:
 *
 *   (a) THIS FILE — "removed the broken half". Every assertion here REDs if
 *       `repairGraph` is re-introduced on the adapter contract, on any concrete
 *       adapter, on any decorator, or if an originating caller is re-wired.
 *       These are RUNTIME and SOURCE assertions, not typecheck: a re-introduction
 *       in a file the build config excludes, or behind an `as any`, still REDs.
 *
 *   (b) tests/unit/simple-repair-connectivity.test.ts +
 *       tests/invariants/cee/{caps-consistency,protected-kinds}.test.ts +
 *       tests/unit/cee.unified-pipeline.stage-4.test.ts —
 *       "kept the working half". `simpleRepair` (src/services/repair.ts) is the
 *       DETERMINISTIC repair. It is LIVE — Stage 3 (`stages/enrich.ts`) and
 *       substep 2 (`stages/repair/plot-validation.ts`) both call it — and this
 *       change does not touch it. A mutant that disables `simpleRepair` REDs
 *       those files and NOT this one; a mutant that re-adds `repairGraph` REDs
 *       this one and NOT those. That is the pair.
 *
 * The two halves must fail on DIFFERENT assertions, or the removal has not been
 * shown to be the removal of the broken half (trap 13b).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

/**
 * Every tracked file under `src/`, derived from git — NOT a hand-maintained
 * list (trap 12). If a new adapter or decorator file appears, it is swept
 * automatically; a mirror would have to be remembered.
 *
 * `-a` because at least one CEE source file carries a deliberate NUL sentinel
 * and plain grep is silently blind to it (trap 17).
 */
function trackedSrcFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "src"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((p) => p.length > 0 && /\.(ts|mts|cts)$/.test(p));
}

function readSrc(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

describe("ROADMAP 2.763 — LLM graph-repair capability is retired", () => {
  // ── The contract ─────────────────────────────────────────────────────────

  it("the LLMAdapter interface declares no repairGraph member", () => {
    const types = readSrc("src/adapters/llm/types.ts");

    // Bind by identity to the interface BLOCK, not to the whole file — a
    // comment mentioning `repairGraph` (there is one, deliberately) must not
    // be able to satisfy or break this. The block is located by its own
    // declaration, so a rename of the interface fails loud rather than
    // silently matching nothing.
    const start = types.indexOf("export interface LLMAdapter");
    expect(start, "LLMAdapter interface not found in types.ts").toBeGreaterThan(-1);
    const body = types.slice(start);
    const end = body.indexOf("\n}");
    expect(end, "LLMAdapter interface has no closing brace").toBeGreaterThan(-1);
    const iface = body.slice(0, end);

    expect(
      /^\s*repairGraph\s*(\?|\()/m.test(iface),
      "LLMAdapter must not declare a repairGraph member (ROADMAP 2.763)",
    ).toBe(false);
  });

  it("the repair arg/result types are gone from the adapter contract", () => {
    const types = readSrc("src/adapters/llm/types.ts");
    for (const name of ["RepairGraphArgs", "RepairGraphResult", "RepairRationale"]) {
      expect(
        new RegExp(`export\\s+interface\\s+${name}\\b`).test(types),
        `${name} must not be re-declared (ROADMAP 2.763)`,
      ).toBe(false);
    }
  });

  // ── The implementations and decorators ───────────────────────────────────

  it("no file under src/ defines or calls a repairGraph adapter method", () => {
    const offenders: string[] = [];

    for (const rel of trackedSrcFiles()) {
      const text = readSrc(rel);
      text.split("\n").forEach((line, i) => {
        // Comments are data, not code: this file, types.ts and defaults.ts all
        // deliberately NAME the retired method so the next reader knows why it
        // is absent. Skip comment lines, then match the two shapes that would
        // constitute a re-introduction: a method DEFINITION or a CALL.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;

        const isDefinition = /(^|\s)(async\s+)?repairGraph\s*\(/.test(line);
        const isCall = /\.\s*repairGraph\s*\(/.test(line);
        // `repairGraphForPersistence` is a DIFFERENT, LIVE, deterministic
        // function in orchestrator-v5 (persist-time intercept repair). Bind by
        // identity so it can never be swept up by this guard.
        const isPersistenceTwin = /repairGraphForPersistence/.test(line);

        if ((isDefinition || isCall) && !isPersistenceTwin) {
          offenders.push(`${rel}:${i + 1}: ${trimmed}`);
        }
      });
    }

    expect(
      offenders,
      "ROADMAP 2.763 retired LLMAdapter.repairGraph. A definition or call under " +
        "src/ means the LLM graph-repair capability has been re-introduced or " +
        "re-wired. If that is deliberate, retire this guard in the same change " +
        "and say why — do not delete the assertion quietly.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the sweep it depends on actually reads files (positive control)", () => {
    // Trap 13: an absence assertion is vacuous unless it can see a presence.
    // Prove the manifest is non-trivial AND that the same matcher DOES fire on
    // a known-shaped line — otherwise "zero offenders" could mean "zero files".
    const files = trackedSrcFiles();
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/adapters/llm/types.ts");
    expect(files).toContain("src/adapters/llm/anthropic.ts");
    expect(files).toContain("src/adapters/llm/openai.ts");
    expect(files).toContain("src/adapters/llm/failover.ts");
    expect(files).toContain("src/adapters/llm/caching.ts");
    expect(files).toContain("src/adapters/llm/usage-tracking.ts");
    expect(files).toContain("src/adapters/llm/router.ts");

    const sample = "    const result = await this.adapter.repairGraph(args, opts);";
    expect(/\.\s*repairGraph\s*\(/.test(sample)).toBe(true);
    const decl = "  async repairGraph(args: RepairGraphArgs, opts: CallOpts) {";
    expect(/(^|\s)(async\s+)?repairGraph\s*\(/.test(decl)).toBe(true);
    // …and that the persistence twin is NOT matched by the twin-exclusion path.
    const twin = "  const repaired = repairGraphForPersistence(graph, ctx);";
    expect(/repairGraphForPersistence/.test(twin)).toBe(true);
  });

  // ── The provider entry points ────────────────────────────────────────────

  it("neither provider module exports a repair entry point", async () => {
    const anthropic = await import("../../src/adapters/llm/anthropic.js");
    const openai = await import("../../src/adapters/llm/openai.js");

    expect(
      (anthropic as Record<string, unknown>).repairGraphWithAnthropic,
      "repairGraphWithAnthropic must stay retired (ROADMAP 2.763)",
    ).toBeUndefined();
    expect(
      (anthropic as Record<string, unknown>).RepairArgs,
      "the Anthropic RepairArgs type must stay retired (ROADMAP 2.763)",
    ).toBeUndefined();
    expect(
      ((anthropic as any).__test_only ?? {}).buildRepairPrompt,
      "the Anthropic repair prompt builder must stay retired (ROADMAP 2.763)",
    ).toBeUndefined();
    expect(
      (openai as Record<string, unknown>).repairGraphWithOpenAI,
      "no OpenAI repair entry point may be introduced (ROADMAP 2.763)",
    ).toBeUndefined();

    // Positive control: these modules DO export their surviving entry points,
    // so the four `toBeUndefined()` above are not passing on an empty import.
    expect(typeof (anthropic as any).draftGraphWithAnthropic).toBe("function");
    expect(typeof (anthropic as any).__test_only?.buildDraftPrompt).toBe("function");
    expect(typeof (openai as any).OpenAIAdapter).toBe("function");
  });

  it("the repair response schema is gone from shared-schemas", async () => {
    const schemas = await import("../../src/adapters/llm/shared-schemas.js");
    expect(
      (schemas as Record<string, unknown>).LLMRepairResponse,
      "LLMRepairResponse parsed the retired repair call's output (ROADMAP 2.763)",
    ).toBeUndefined();
    // Positive control — the draft schema, which is live, is still exported.
    expect((schemas as Record<string, unknown>).LLMDraftResponse).toBeDefined();
  });

  // ── The telemetry key ────────────────────────────────────────────────────

  it("the repair-truncation telemetry key has no emitter and no key", async () => {
    const { TelemetryEvents } = await import("../../src/utils/telemetry.js");
    expect(
      (TelemetryEvents as Record<string, unknown>).RepairPromptTruncated,
      "an event key with no live emitter is a broken alarm (ROADMAP 2.763)",
    ).toBeUndefined();
    // Positive control — the map is populated, so the assertion above is not
    // passing against an empty object.
    expect(Object.keys(TelemetryEvents).length).toBeGreaterThan(50);
  });

  // ── The half that SURVIVES (the other side of the pair) ──────────────────

  it("simpleRepair — the DETERMINISTIC repair — is untouched and still wired", async () => {
    const { simpleRepair } = await import("../../src/services/repair.js");
    expect(
      typeof simpleRepair,
      "2.763 removes the LLM repair, NOT the deterministic one",
    ).toBe("function");

    // Bind to the LIVE call sites by identity, not by a value predicate: these
    // are the two places the pipeline actually invokes deterministic repair.
    // Stage 3 = post-enrichment connectivity repair; substep 2 = the PLoT
    // validation fallback that 2.731 explicitly kept when it removed the LLM call.
    const enrich = readSrc("src/cee/unified-pipeline/stages/enrich.ts");
    expect(
      /simpleRepair\s*\(/.test(enrich),
      "Stage 3 (enrich.ts) must still call simpleRepair",
    ).toBe(true);

    const plotValidation = readSrc(
      "src/cee/unified-pipeline/stages/repair/plot-validation.ts",
    );
    expect(
      /simpleRepair\s*\(/.test(plotValidation),
      "substep 2 (plot-validation.ts) must still call simpleRepair",
    ).toBe(true);
  });
});
