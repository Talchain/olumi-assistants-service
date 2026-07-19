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
import { readFileSync, existsSync } from "node:fs";
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

describe("staging journey smoke — assertions discriminate", () => {
  it("the healthy fixture is present and really is a successful draft", () => {
    // If this file moves, the positive control below is testing nothing, so
    // fail loudly here rather than silently losing the healthy-path proof.
    expect(existsSync(HEALTHY_DRAFT_PATH), `missing healthy capture at ${HEALTHY_DRAFT_PATH}`).toBe(true);
    const body = readJson(HEALTHY_DRAFT_PATH);
    expect(body._diagnostic_trace.exit_path).toBe("draft_graph");
  });

  it("PASSES a real successful draft (not always-red)", () => {
    const body = readJson(HEALTHY_DRAFT_PATH);
    expect(assertHealthyDraft(body)).toEqual([]);
  });

  it("POSITIVE CONTROL: FAILS the real e22f8a6 outage response", () => {
    const body = readJson(BROKEN_DRAFT_PATH);
    const failures = assertHealthyDraft(body);
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
    const healthy = readJson(HEALTHY_DRAFT_PATH);
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
    const healthy = readJson(HEALTHY_DRAFT_PATH);
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
    const d = extractDiagnostics(readJson(BROKEN_DRAFT_PATH));
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
    const smokeStep = job.steps.find((s: any) => typeof s.run === "string" && s.run.includes("staging-journey-smoke.mjs"));
    expect(smokeStep, "the smoke step is gone").toBeDefined();
    expect(smokeStep.if).toBeUndefined();
  });

  it("no `if:` anywhere in the workflow reads a repo variable", () => {
    // Walk the PARSED tree, not the raw text: the file's own comments explain
    // the `if: vars.X == 'true'` anti-pattern, and a raw regex would match the
    // explanation rather than a real gate. Structure is the source of truth.
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === "if" && typeof v === "string" && v.includes("vars.")) {
            offenders.push(`${path}.if = ${v}`);
          }
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(wf, "workflow");
    expect(offenders, `variable-gated conditions found: ${offenders.join("; ")}`).toEqual([]);
  });

  it("runs on push to staging, not only on a schedule", () => {
    expect(wf.on.push.branches).toContain("staging");
    expect(wf.on.schedule, "a scheduled-only alarm does not gate a deploy").toBeUndefined();
  });

  it("targets staging and never production", () => {
    const smokeStep = job.steps.find((s: any) => typeof s.run === "string" && s.run.includes("staging-journey-smoke.mjs"));
    const baseUrl = String(smokeStep.env.SMOKE_BASE_URL);
    expect(baseUrl).toContain("cee-staging");
    // The production hostname must not appear anywhere in the workflow.
    expect(raw).not.toMatch(/https:\/\/olumi-assistants-service\.onrender\.com/);
  });

  it("pipes through a pipefail shell so a failing gate cannot exit 0", () => {
    // GitHub's default Linux shell is `bash -e {0}` WITHOUT pipefail. With a
    // `| tee`, a failing node process would yield exit 0 and this alarm would
    // pass while the product was broken. Verified empirically: `bash -e -c
    // 'false | tee x'` exits 0; `bash -eo pipefail -c ...` exits 1.
    const smokeStep = job.steps.find((s: any) => typeof s.run === "string" && s.run.includes("staging-journey-smoke.mjs"));
    if (/\|/.test(smokeStep.run)) {
      expect(smokeStep.shell, "step pipes output but does not set `shell: bash` (no pipefail)").toBe("bash");
    }
  });

  it("asserts deploy freshness by passing the expected commit", () => {
    // The "deploy did not ship" half. Without SMOKE_EXPECT_SHA the gate would
    // happily test whatever stale build is deployed and call it green.
    const smokeStep = job.steps.find((s: any) => typeof s.run === "string" && s.run.includes("staging-journey-smoke.mjs"));
    expect(String(smokeStep.env.SMOKE_EXPECT_SHA)).toContain("github.sha");
  });
});
