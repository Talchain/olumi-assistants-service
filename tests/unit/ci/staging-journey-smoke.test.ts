/**
 * Guards for the staging live-journey smoke alarm.
 *
 * Two independent jobs:
 *
 * 1. THE ASSERTIONS DISCRIMINATE. An absence assertion that cannot see a
 *    presence is vacuous, so every "healthy" check is paired with a POSITIVE
 *    CONTROL: a REAL captured staging response that must make it fail. Both
 *    fixtures are genuine wire captures, not hand-written mocks — a mock would
 *    only prove the assertions agree with my idea of the shape.
 *
 * 2. THE ALARM CANNOT BE SILENCED QUIETLY. These tests parse the workflow YAML
 *    and assert the properties that made the two pre-existing smoke workflows
 *    dead (`continue-on-error`, a `vars.` enable-gate, schedule-only triggers,
 *    a production target). The facts are DERIVED from the file — there is no
 *    second hand-maintained copy to drift. Re-introducing any of them, or
 *    deleting the workflow, turns this suite red.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

import {
  assertHealthyFrame,
  assertHealthyDraft,
  extractDiagnostics,
  MIN_NODES,
  MIN_OPTIONS,
} from "../../../scripts/ci/staging-journey-smoke.mjs";

const REPO_ROOT = resolve(__dirname, "../../..");
const WORKFLOW_PATH = resolve(REPO_ROOT, ".github/workflows/staging-journey-smoke.yml");

/**
 * A real, committed capture of a SUCCESSFUL draft turn against staging
 * (build 60bd72b). This is the "healthy journey" the alarm must let through.
 */
const HEALTHY_DRAFT_PATH = resolve(
  REPO_ROOT,
  "acceptance-evidence/artefact-appendix-casing/live-turn2-draft-graph.json",
);

/**
 * A real, committed capture of the OUTAGE this alarm was built for: turn 2
 * against staging build e22f8a6 returned HTTP 500 / OPTIONS_IDENTICAL.
 */
const BROKEN_DRAFT_PATH = resolve(REPO_ROOT, "tests/unit/ci/fixtures/live-turn2-draft-500-e22f8a6.json");

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}

/**
 * The fixtures are large (~20KB) and immutable. Read and parse ONCE at module
 * scope; the two tests that vary them already spread-copy, so a shared frozen
 * object is safe and `structuredClone` covers any deeper mutation.
 */
const HEALTHY_DRAFT = readJson(HEALTHY_DRAFT_PATH);
const BROKEN_DRAFT = readJson(BROKEN_DRAFT_PATH);

/**
 * Collect every `if:` in a parsed workflow that reads a repository variable.
 * Walks the PARSED tree rather than the raw text so a file's own explanatory
 * comments about the anti-pattern are not mistaken for a real gate.
 */
function findVarGatedConditions(node: unknown, path: string, offenders: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((v, i) => findVarGatedConditions(v, `${path}[${i}]`, offenders));
    return offenders;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "if" && typeof v === "string" && v.includes("vars.")) {
        offenders.push(`${path}.if = ${v}`);
      }
      findVarGatedConditions(v, `${path}.${k}`, offenders);
    }
  }
  return offenders;
}

describe("staging journey smoke — assertions discriminate", () => {
  it("the healthy fixture is present and really is a successful draft", () => {
    // If this file moves, the positive control below is testing nothing, so
    // fail loudly here rather than silently losing the healthy-path proof.
    expect(existsSync(HEALTHY_DRAFT_PATH), `missing healthy capture at ${HEALTHY_DRAFT_PATH}`).toBe(true);
    expect(HEALTHY_DRAFT._diagnostic_trace.exit_path).toBe("draft_graph");
  });

  it("PASSES a real successful draft (not always-red)", () => {
    expect(assertHealthyDraft(HEALTHY_DRAFT)).toEqual([]);
  });

  it("POSITIVE CONTROL: FAILS the real e22f8a6 outage response", () => {
    const failures = assertHealthyDraft(BROKEN_DRAFT);
    expect(failures.length).toBeGreaterThan(0);
    // The message must name the actual cause — an alarm that just says
    // "failed" costs the on-call engineer the whole diagnosis.
    expect(failures.join(" ")).toContain("OPTIONS_IDENTICAL");
    expect(failures.join(" ")).toContain("draft_graph_error");
  });

  it("FAILS a 200 response carrying a trivial graph (the 'no 500' blind spot)", () => {
    // This is the case that let the outage through conceptually: HTTP 200 is
    // not evidence the user got anything usable.
    const body = {
      draft_graph: { nodes: [{ id: "n1", kind: "goal" }], edges: [] },
      analysis_ready: { options: [] },
      _diagnostic_trace: { exit_path: "draft_graph" },
    };
    const failures = assertHealthyDraft(body);
    expect(failures.join(" ")).toContain(`expected >= ${MIN_NODES}`);
    expect(failures.join(" ")).toContain(`expected >= ${MIN_OPTIONS}`);
  });

  it("FAILS a graph with only one option (nothing to compare)", () => {
    const healthy = structuredClone(HEALTHY_DRAFT);
    const oneOption = {
      ...healthy,
      draft_graph: {
        ...healthy.draft_graph,
        nodes: healthy.draft_graph.nodes.filter((n: any) => n.kind !== "option").concat([
          { id: "opt_only", kind: "option", label: "Only one" },
        ]),
      },
      analysis_ready: { ...healthy.analysis_ready, options: [healthy.analysis_ready.options[0]] },
    };
    expect(assertHealthyDraft(oneOption).length).toBeGreaterThan(0);
  });

  it("FAILS duplicate option_ids", () => {
    const healthy = structuredClone(HEALTHY_DRAFT);
    const dup = healthy.analysis_ready.options[0];
    const body = { ...healthy, analysis_ready: { ...healthy.analysis_ready, options: [dup, dup] } };
    expect(assertHealthyDraft(body).join(" ")).toContain("duplicate option_id");
  });

  it("frame assertion passes a real clarify turn and fails an empty reply", () => {
    expect(assertHealthyFrame({ assistant_text: "Before I draft…", _diagnostic_trace: { exit_path: "clarify_v2" } })).toEqual(
      [],
    );
    expect(assertHealthyFrame({ assistant_text: "  ", _diagnostic_trace: { exit_path: "clarify_v2" } }).join(" ")).toContain(
      "assistant_text was empty",
    );
  });

  it("extracts the diagnostics that prove WHICH build was tested", () => {
    const d = extractDiagnostics(BROKEN_DRAFT);
    expect(d.build_sha).toBe("e22f8a6");
    expect(d.exit_path).toBe("draft_graph_error");
    // prompt_identity is legitimately [] on non-draft/error exits — the trace
    // builder deliberately does not fabricate one. It is only treated as a
    // defect on a SUCCESSFUL draft_graph exit (enforced in the CLI reporter).
    expect(d.prompt_identity_count).toBe(0);
  });
});

describe("staging journey smoke — the alarm cannot be silenced quietly", () => {
  const raw = readFileSync(WORKFLOW_PATH, "utf8");
  const wf = parse(raw);
  const job = wf.jobs.journey;

  /**
   * The one place that locates the smoke step. Throws a NAMED error if it is
   * absent, so "the step was deleted" can never present as an unrelated
   * `Cannot read properties of undefined`.
   */
  const requireSmokeStep = (): any => {
    const step = job.steps.find((s: any) => typeof s.run === "string" && s.run.includes("staging-journey-smoke.mjs"));
    if (!step) throw new Error("the smoke step (running staging-journey-smoke.mjs) is gone from the workflow");
    return step;
  };

  it("the workflow file exists (deleting it fails this suite)", () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  it("has NO continue-on-error anywhere — a red step must fail the run", () => {
    // Derived by walking the parsed YAML, not by grepping a remembered list.
    expect(job["continue-on-error"]).toBeUndefined();
    for (const step of job.steps) {
      expect(step["continue-on-error"], `step "${step.name ?? step.uses}" is continue-on-error`).toBeUndefined();
    }
  });

  it("has NO conditional gate on the job or the smoke step", () => {
    // `if: vars.SMOKE_SCHEDULE_ENABLED == 'true'` is precisely what made
    // nightly-smoke skip 8 of its last 8 runs while looking healthy.
    expect(job.if, "job is conditionally gated — it can be disabled by leaving a variable unset").toBeUndefined();
    expect(requireSmokeStep().if).toBeUndefined();
  });

  it("no `if:` anywhere in the workflow reads a repo variable", () => {
    // Walk the PARSED tree, not the raw text: the file's own comments explain
    // the `if: vars.X == 'true'` anti-pattern, and a raw regex would match the
    // explanation rather than a real gate. Structure is the source of truth.
    expect(findVarGatedConditions(wf, "workflow")).toEqual([]);
  });

  it("runs on push to staging, not only on a schedule", () => {
    expect(wf.on.push.branches).toContain("staging");
    expect(wf.on.schedule, "a scheduled-only alarm does not gate a deploy").toBeUndefined();
  });

  it("targets staging and never production", () => {
    const baseUrl = String(requireSmokeStep().env.SMOKE_BASE_URL);
    expect(baseUrl).toContain("cee-staging");
    // The production hostname must not appear anywhere in the workflow.
    expect(raw).not.toMatch(/https:\/\/olumi-assistants-service\.onrender\.com/);
  });

  it("pipes through a pipefail shell so a failing gate cannot exit 0", () => {
    // GitHub's default Linux shell is `bash -e {0}` WITHOUT pipefail. With a
    // `| tee`, a failing node process would yield exit 0 and this alarm would
    // pass while the product was broken. Verified empirically: `bash -e -c
    // 'false | tee x'` exits 0; `bash -eo pipefail -c ...` exits 1.
    //
    // UNCONDITIONAL, both halves. The previous `if (/\|/.test(run))` guard made
    // this silently vacuous the moment the pipe was removed — and the tee'd log
    // is not incidental, it is a DESIGN DEPENDENCY of the upload step below.
    // So assert the pipe exists AND that pipefail is enabled.
    const smokeStep = requireSmokeStep();
    expect(
      smokeStep.run,
      "the smoke step no longer tees its output — the upload-artifact step has nothing to attach",
    ).toContain("| tee");
    expect(smokeStep.shell, "step pipes output but does not set `shell: bash` (no pipefail)").toBe("bash");
  });

  it("asserts deploy freshness by passing the expected commit", () => {
    // The "deploy did not ship" half. Without SMOKE_EXPECT_SHA the gate would
    // happily test whatever stale build is deployed and call it green.
    expect(String(requireSmokeStep().env.SMOKE_EXPECT_SHA)).toContain("github.sha");
  });
});

/**
 * THE ANTI-PATTERN SWEEP, WIDENED TO EVERY WORKFLOW.
 *
 * Asserting the dead-alarm pattern against only the file that introduced it
 * is the narrowest possible scope — it leaves every LIVE instance green. The
 * pattern was found in THREE workflows, and `gh api .../actions/variables`
 * returns `total_count: 0` (positive control: the same API form returns
 * `total_count: 1` for secrets), so every `if: vars.* == 'true'` in this repo
 * is PERMANENTLY FALSE. Those jobs never run and report as healthy.
 *
 * THE LIST IS NOW EMPTY, and that is the point. All three instances have been
 * resolved by the owner's decision rather than tolerated:
 *   - `nightly-smoke.yml`     DELETED. Targeted PRODUCTION (out of scope) and
 *                             exercised `/assist/draft-graph`, a dead endpoint
 *                             (v1 is 410-gone; the live path is
 *                             `/orchestrate/v2/turn`). Fully wired it would
 *                             have proven nothing. This file's own workflow
 *                             supersedes it.
 *   - `nightly-stability.yml` DELETED. `gh run list` returned NO runs at all —
 *                             never triggered, not merely skipped. A benchmark
 *                             that never produced a baseline has no trend to
 *                             protect. (The underlying benchmark script is
 *                             retained; only the dead workflow went.)
 *   - `cee-diagnostics.yml`   UN-GATED. Now manual-dispatch only, no schedule,
 *                             no `continue-on-error`, base URL defaulted in
 *                             code. It fails loudly or not at all.
 *
 * An empty list is a materially stronger end state than a justified one: any
 * NEWLY-ADDED `vars.*` gate now fails this suite immediately, with no
 * precedent to point at. Re-populating this object should require the same
 * argument the three entries above could not survive.
 */
const VAR_GATE_OPT_OUTS: Record<string, string> = {};

describe("no NEW workflow may gate itself on an unset repo variable", () => {
  const WORKFLOW_DIR = resolve(REPO_ROOT, ".github/workflows");
  const workflowFiles = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  it("finds workflows to check (guards against an empty glob passing vacuously)", () => {
    // An absence assertion over an empty set proves nothing. Prove the sweep
    // can SEE files before trusting what it says about them.
    expect(workflowFiles.length).toBeGreaterThan(3);
  });

  it("every var-gated workflow is on the explicit opt-out list, and every opt-out is still real", () => {
    const found = new Map<string, string[]>();
    for (const file of workflowFiles) {
      const parsed = parse(readFileSync(resolve(WORKFLOW_DIR, file), "utf8"));
      const offenders = findVarGatedConditions(parsed, file);
      if (offenders.length > 0) found.set(file, offenders);
    }

    // (a) Nothing new may appear.
    const unlisted = [...found.keys()].filter((f) => !(f in VAR_GATE_OPT_OUTS));
    expect(
      unlisted,
      `NEW variable-gated workflow(s): ${unlisted.map((f) => found.get(f)!.join("; ")).join(" | ")}. ` +
        `A repo variable that is never set makes the job permanently skipped while reporting healthy. ` +
        `Remove the gate, or add the file to VAR_GATE_OPT_OUTS with a reason.`,
    ).toEqual([]);

    // (b) And the list may not rot. An opt-out whose workflow no longer has
    // the pattern (or no longer exists) is a stale exemption — exactly the
    // drift that lets a tolerated red outlive the thing it tolerated.
    const stale = Object.keys(VAR_GATE_OPT_OUTS).filter((f) => !found.has(f));
    expect(
      stale,
      `stale VAR_GATE_OPT_OUTS entries (workflow fixed or deleted — remove the exemption): ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
