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
  assertHealthyJourney,
  assertPromptProvenance,
  extractDiagnostics,
  carriedDraftGraph,
  readyOptionCount,
  readinessDiagnosis,
  draftGraphCensus,
  assertNoUnrequestedAnalysisRefusal,
  READINESS_PRODUCING_EXIT_PATHS,
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

/**
 * The journey-level invariant (ROADMAP 2.1300).
 *
 * WHY THIS BLOCK EXISTS
 * ---------------------
 * The gate used to assert the model's arrival on TURN 2 by turn INDEX. #1002
 * ("draft-first") moved drafting to TURN 1 — deliberately, to Paul's ratified
 * target — and the gate reddened on a HEALTHY product with
 * `no draft_graph on the response — the user got no model back`, while the user
 * was in fact handed a 14-node model on turn 1.
 *
 * The deeper defect is the one these tests pin: with the only graph assertion
 * living on turn 2, the gate could no longer TELL APART
 *   (a) healthy — the model arrived a turn earlier, and
 *   (b) broken — no model arrived at all,
 * because both produce the same message. An alarm that reports the same thing
 * for a working product and an outage is not an alarm.
 *
 * The fixtures are REAL wire captures from a FRESH staging session
 * (scenario d1cd7a3e, deployed build 2ceb65f, 2026-08-17T15:32Z — 29 minutes
 * after the Render build-flap self-corrected, and both turns stamp
 * `build_sha=2ceb65f`, so they are single-build evidence). Turn 1 carries
 * 14 nodes / 4 option nodes; turn 2 routes to `turn_executor`, carries NO
 * `draft_graph`, and reports the SAME four `option_id`s. `graph_hash` is
 * identical on both turns (`f986ac90…`), which is what makes the continuity
 * assertion below a fact about one model rather than about two counts.
 */
const LIVE_DRAFTFIRST_TURN1 = readJson(
  resolve(REPO_ROOT, "tests/unit/ci/fixtures/live-journey-draftfirst-turn1-2ceb65f.json"),
);
const LIVE_DRAFTFIRST_TURN2 = readJson(
  resolve(REPO_ROOT, "tests/unit/ci/fixtures/live-journey-draftfirst-turn2-2ceb65f.json"),
);

describe("staging journey smoke — the model must arrive, on whichever turn drafts", () => {
  it("the draft-first fixtures really are the shape this defect is about", () => {
    // If these ever stop being the draft-first shape, every test below is
    // asserting against something else and must fail loudly here first.
    expect(LIVE_DRAFTFIRST_TURN1._diagnostic_trace.exit_path).toBe("draft_graph");
    expect(LIVE_DRAFTFIRST_TURN1.draft_graph.nodes.length).toBeGreaterThanOrEqual(MIN_NODES);
    expect(LIVE_DRAFTFIRST_TURN2._diagnostic_trace.exit_path).toBe("turn_executor");
    expect(LIVE_DRAFTFIRST_TURN2.draft_graph).toBeUndefined();
    // Same model on both turns — the premise of the continuity assertion.
    expect(LIVE_DRAFTFIRST_TURN2.graph_hash).toBe(LIVE_DRAFTFIRST_TURN1.graph_hash);
  });

  it("DEFECT PIN: the turn-2-only assertion reds this healthy journey", () => {
    // This is the exact CI message from run 32039145332. It is correct about
    // turn 2 and wrong about the user, which is why the journey function exists.
    expect(assertHealthyDraft(LIVE_DRAFTFIRST_TURN2).join(" ")).toContain(
      "no draft_graph on the response",
    );
  });

  it("PASSES the real draft-first journey — model on turn 1, follow-up carries none", () => {
    expect(assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, LIVE_DRAFTFIRST_TURN2)).toEqual([]);
  });

  it("PASSES the legacy clarify-then-draft journey — model on turn 2", () => {
    // The pre-#1002 shape must keep passing: the gate asserts model DELIVERY,
    // not a turn index, so it is indifferent to which turn drafts.
    const clarifyTurn1 = { assistant_text: "Before I draft…", _diagnostic_trace: { exit_path: "clarify_v2" } };
    expect(assertHealthyJourney(clarifyTurn1, HEALTHY_DRAFT)).toEqual([]);
  });

  it("FAILS when NEITHER turn carries a model — the outage this alarm exists for", () => {
    const clarifyTurn1 = { assistant_text: "Before I draft…", _diagnostic_trace: { exit_path: "clarify_v2" } };
    const noModelTurn2 = {
      assistant_text: "Let me know more.",
      analysis_ready: { options: [] },
      _diagnostic_trace: { exit_path: "turn_executor" },
    };
    const failures = assertHealthyJourney(clarifyTurn1, noModelTurn2);
    expect(failures.join(" ")).toContain("neither turn carried a draft_graph");
    expect(failures.join(" ")).toContain("clarify_v2");
    expect(failures.join(" ")).toContain("turn_executor");
  });

  it("FAILS a trivial draft-first graph — the 2.1252 shape, now on the turn the old gate never checked", () => {
    // #1002 moved drafting to turn 1, where the only graph assertion did not
    // reach. An empty/trivial model on turn 1 must red, and the message must
    // name TURN 1 — an on-call engineer told "turn 2" would read the wrong log.
    const trivialTurn1 = {
      assistant_text: "I've built a first decision model from your brief.",
      draft_graph: { nodes: [{ id: "n1", kind: "goal" }], edges: [] },
      analysis_ready: { options: [] },
      _diagnostic_trace: { exit_path: "draft_graph" },
    };
    const failures = assertHealthyJourney(trivialTurn1, LIVE_DRAFTFIRST_TURN2);
    expect(failures.join(" ")).toContain(`expected >= ${MIN_NODES}`);
    expect(failures.join(" ")).toContain("turn 1:");
    expect(failures.join(" ")).not.toContain("turn 2: draft_graph.nodes");
  });

  it("FAILS when the follow-up loses the drafted option identities", () => {
    const lost = {
      ...LIVE_DRAFTFIRST_TURN2,
      analysis_ready: { ...LIVE_DRAFTFIRST_TURN2.analysis_ready, options: [] },
    };
    expect(assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, lost).join(" ")).toContain(
      "PUT NO COMPARABLE OPTIONS ON THE WIRE",
    );
  });

  it("IDENTITY, NOT COUNT: same number of DIFFERENT option_ids still FAILS", () => {
    // The discriminating case. Any count-based check (`options.length >= 2`,
    // or `=== 4`) passes this body: it has exactly as many options as the real
    // one. Only binding to the drafted option_ids can see that the product is
    // now talking about a different set of options than the model it built.
    const drafted = LIVE_DRAFTFIRST_TURN1.analysis_ready.options.map((o: any) => o.option_id);
    expect(drafted.length).toBe(4);
    const swapped = {
      ...LIVE_DRAFTFIRST_TURN2,
      analysis_ready: {
        ...LIVE_DRAFTFIRST_TURN2.analysis_ready,
        options: drafted.map((id: string, i: number) => ({ option_id: `other_${i}_${id.slice(0, 2)}` })),
      },
    };
    expect(swapped.analysis_ready.options.length).toBe(
      LIVE_DRAFTFIRST_TURN2.analysis_ready.options.length,
    );
    const failures = assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, swapped);
    expect(failures.join(" ")).toContain("no longer identifies the model");
    // The message must name the ids that went missing, or the on-call engineer
    // has to go and diff two payloads by hand.
    expect(failures.join(" ")).toContain(drafted[0]);
  });

  it("TOLERATES a follow-up that ADDS an option — a gain is not a loss", () => {
    // Deliberate asymmetry, stated: losing a drafted option means the model the
    // product describes is not the model it built (the harm). Gaining one does
    // not make anything the user was told less true, so it must not red — a
    // gate that fires on a state no less true than the one it replaced is a
    // false alarm, and false alarms are how this estate loses real ones.
    const added = {
      ...LIVE_DRAFTFIRST_TURN2,
      analysis_ready: {
        ...LIVE_DRAFTFIRST_TURN2.analysis_ready,
        options: [...LIVE_DRAFTFIRST_TURN2.analysis_ready.options, { option_id: "newly_added_opt" }],
      },
    };
    expect(assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, added)).toEqual([]);
  });

  it("CALL-SITE PIN: the CLI asserts the JOURNEY, never turn 2 alone", () => {
    // The pure functions above are fully covered, but the CLI that wires them is
    // by design un-unit-testable (there is deliberately no fixture mode — it
    // always drives real HTTP). Without this pin the whole fix could be reverted
    // at the call site with every test above still green: the functions would be
    // correct and nothing would call them. Honest about what it is — a bounded,
    // fail-loud source pin, the same technique this file already uses on the
    // workflow YAML.
    const src = readFileSync(resolve(REPO_ROOT, "scripts/ci/staging-journey-smoke.mjs"), "utf8");
    expect(src).toContain("assertHealthyJourney(t1.body, t2.body)");
    // …and the superseded turn-2-only call must not come back.
    expect(src).not.toContain("assertHealthyDraft(t2.body)");
    // Provenance is asserted across every turn's diagnostics AND its body —
    // the body is what carries graph DELIVERY, the predicate the check now
    // keys on. Passing diagnostics alone would silently drop back to
    // exit_path-only, which is the defect 2.1300 F2 removed.
    expect(src).toContain("assertPromptProvenance(turnDiagnostics, turnBodies)");
    expect(src).toContain("const turnBodies = turns.map((t) => t.body)");
    expect(src).not.toContain("assertPromptProvenance([d1, d2])");
  });

  it("a draft_graph exit on EITHER turn must carry prompt_identity", () => {
    // The reporter's provenance check was keyed on turn 2's exit_path, so
    // #1002 silently moved the drafting turn out from under it: we lost the
    // ability to prove WHICH prompt produced the graph the user was shown.
    const d1 = extractDiagnostics({ _diagnostic_trace: { exit_path: "draft_graph", prompt_identity: [] } });
    const d2 = extractDiagnostics({ _diagnostic_trace: { exit_path: "turn_executor", prompt_identity: [] } });
    expect(assertPromptProvenance([d1, d2]).join(" ")).toContain("prompt_identity was empty");
    // …and it must NOT fire on a non-drafting exit, where [] is legitimate.
    expect(assertPromptProvenance([d2, d2])).toEqual([]);
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

/* ══════════════════════════════════════════════════════════════════════════
 * THE ALARM MUST NOT BE ABLE TO TURN ITSELF OFF (ROADMAP 2.1300, round 2).
 *
 * An independent review MEASURED four ways the guarantees above disable
 * themselves rather than firing. Each case below reproduces one of them, and
 * each was RED before the corresponding fix. They are grouped by the harm,
 * and every case carries its OPPOSITE-DIRECTION TWIN (trap 22b): a silent
 * no-op and a false alarm are two different harms and cannot share a
 * parameter, so both directions are pinned.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Turn 1's four real option objects, stripped to a given `option_id` shape. */
function turn1WithOptionIds(idFor: (i: number) => unknown) {
  const b = structuredClone(LIVE_DRAFTFIRST_TURN1);
  b.analysis_ready.options = b.analysis_ready.options.map((o: any, i: number) => {
    const next = { ...o };
    const id = idFor(i);
    if (id === undefined) delete next.option_id;
    else next.option_id = id;
    return next;
  });
  return b;
}

/** A follow-up naming four ids that share nothing with the drafted model. */
const FOUR_FOREIGN_IDS = {
  ...LIVE_DRAFTFIRST_TURN2,
  analysis_ready: {
    ...LIVE_DRAFTFIRST_TURN2.analysis_ready,
    options: [0, 1, 2, 3].map((i) => ({ option_id: `foreign_option_${i}` })),
  },
};

describe("2.1300 F1 — an unbindable continuity check must FAIL, never silently pass", () => {
  // The contract admits every one of these: OptionForAnalysis.id is
  // `z.string()` with no `.min(1)` (src/schemas/analysis-ready.ts:85), the emit
  // is `option_id: opt.id` (analysis-ready-helper.ts:1123), and the wire
  // envelope validates analysis_ready as `z.unknown().optional()`
  // (src/orchestrator/validation/response-envelope-schema.ts:135) —
  // so NOTHING enforces a usable option_id on egress.
  const idShapes: Array<[string, (i: number) => unknown]> = [
    ["empty string", () => ""],
    ["null", () => null],
    ["absent", () => undefined],
  ];

  for (const [name, idFor] of idShapes) {
    it(`FAILS when drafted option_ids are unusable (${name}) and the follow-up names four different ids`, () => {
      const drafting = turn1WithOptionIds(idFor);
      // The precondition of the harm: the drafting turn still has four option
      // OBJECTS, so `assertHealthyDraft`'s count check is fully satisfied —
      // which is exactly why this was invisible. Pinned in-test (trap 13b) so
      // this case cannot decay into asserting something else.
      expect(readyOptionCount(drafting)).toBe(4);
      expect(assertHealthyDraft(drafting, "turn 1")).toEqual([]);

      const failures = assertHealthyJourney(drafting, FOUR_FOREIGN_IDS);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.join(" ")).toContain("carry no usable option_id");
      expect(failures.join(" ")).toContain("turn 1:");
    });
  }

  it("TWIN: option objects genuinely absent are reported by USABILITY, not as an unbindable check", () => {
    // Opposite direction. Zero option OBJECTS is already the count failure's
    // job; emitting the unbindable-check message there too would be a second
    // predicate for one concept — the defect this whole round is about.
    const noOptions = structuredClone(LIVE_DRAFTFIRST_TURN1);
    noOptions.analysis_ready.options = [];
    expect(readyOptionCount(noOptions)).toBe(0);
    const failures = assertHealthyJourney(noOptions, LIVE_DRAFTFIRST_TURN2);
    expect(failures.join(" ")).toContain(`analysis_ready.options=0, expected >= ${MIN_OPTIONS}`);
    expect(failures.join(" ")).not.toContain("carry no usable option_id");
  });

  it("FAILS when the follow-up names a DIFFERENT graph_hash — the strongest continuity signal", () => {
    // Both committed fixtures carry an IDENTICAL graph_hash and the suite
    // already asserts that equality as "the premise of the continuity
    // assertion" — while the gate never read it. A divergent hash is the
    // product describing a model it did not build, by the model's own identity.
    const forked = { ...LIVE_DRAFTFIRST_TURN2, graph_hash: "0000feed0000feed0000feed0000feed" };
    const failures = assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, forked);
    expect(failures.join(" ")).toContain("graph_hash");
    expect(failures.join(" ")).toContain(LIVE_DRAFTFIRST_TURN1.graph_hash);
  });

  it("TWIN: a follow-up carrying NO graph_hash is not a divergence", () => {
    // Absence is not disagreement. The legacy clarify-then-draft fixture
    // carries no graph_hash at all, and firing on absence would red a
    // healthy journey — the false-alarm shape this PR exists to remove.
    const noHash = { ...LIVE_DRAFTFIRST_TURN2 };
    delete (noHash as any).graph_hash;
    expect(assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, noHash)).toEqual([]);
  });
});

describe("2.1300 F2 — one concept, ONE predicate: a delivered graph needs provenance", () => {
  /** A turn that DELIVERS a graph under a non-drafting exit_path. */
  const deliveredUnderEditExit = {
    assistant_text: "Applied your edit.",
    draft_graph: structuredClone(LIVE_DRAFTFIRST_TURN1.draft_graph),
    analysis_ready: structuredClone(LIVE_DRAFTFIRST_TURN1.analysis_ready),
    _diagnostic_trace: { exit_path: "edit_graph", prompt_identity: [] },
  };

  it("the refuting fixture fact: turn_executor DOES carry prompt_identity", () => {
    // The comment justifying the exit_path-only scope claimed prompt_identity
    // is EXPECTED to be [] on the minimal-trace exits including turn_executor.
    // This PR's own turn-2 fixture is `turn_executor` with a prompt_identity of
    // 1 — so keying provenance on graph DELIVERY costs no false alarm here.
    expect(LIVE_DRAFTFIRST_TURN2._diagnostic_trace.exit_path).toBe("turn_executor");
    expect(extractDiagnostics(LIVE_DRAFTFIRST_TURN2).prompt_identity_count).toBe(1);
  });

  it("FAILS a graph delivered under exit_path=edit_graph with an empty prompt_identity", () => {
    // `draft_graph` is genuinely emitted under other exits: applied-graph-emit's
    // `n()` is called from four turn-executor sites, edit-graph-dispatch and
    // system-events/dispatch. Keying provenance on exit_path alone means the
    // guarantee silently lapses the next time the drafting event is relabelled
    // — which is precisely the change #1002 made.
    expect(carriedDraftGraph(deliveredUnderEditExit)).toBe(true);
    const d = extractDiagnostics(deliveredUnderEditExit);
    const failures = assertPromptProvenance([d], [deliveredUnderEditExit]);
    expect(failures.join(" ")).toContain("prompt_identity was empty");
    expect(failures.join(" ")).toContain("turn 1:");
  });

  it("TWIN: a turn that delivers NO graph on a non-draft exit stays legitimate", () => {
    // Opposite direction: the minimal-trace exits really do omit prompt_identity
    // and must not red. Same predicate, other side.
    const clarify = { assistant_text: "Which site?", _diagnostic_trace: { exit_path: "clarify_v2", prompt_identity: [] } };
    expect(carriedDraftGraph(clarify)).toBe(false);
    expect(assertPromptProvenance([extractDiagnostics(clarify)], [clarify])).toEqual([]);
  });
});

describe("2.1300 F3 — an absent analysis_ready is only a LOSS where readiness is produced", () => {
  it("does NOT assert a loss when the follow-up is a deterministic non-readiness exit", () => {
    // MEASURED false red: a follow-up with NO analysis_ready block produced
    // "the model did not survive the turn". `clarify_v2` and
    // `frame_no_brief_guard` call sendFinalised200 with NO analysisReady
    // (route-v2.ts:3848 / :5366 / :5400) and the finaliser omits the block
    // unless a payload is supplied (response-finaliser.ts:261-269). Asserting
    // a loss there is false, and a false alarm is how this estate loses real ones.
    for (const exit of ["clarify_v2", "frame_no_brief_guard", "process_meta_intake"]) {
      const followUp = { assistant_text: "Before I go on…", _diagnostic_trace: { exit_path: exit } };
      expect(READINESS_PRODUCING_EXIT_PATHS.has(exit)).toBe(false);
      expect(assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, followUp), `exit_path=${exit}`).toEqual([]);
    }
  });

  it("TWIN: the freshness-only synthesis shape MUST still fail — options:[] on a readiness exit", () => {
    // Opposite direction, and the case that must not be traded away: the
    // finaliser synthesises `{status:'blocked', goal_node_id:'', options:[],
    // bias_findings:[]}` for genuinely unparseable graphs
    // (compose/analysis-ready-emit.ts:59-61). That IS a loss and must stay red.
    const freshnessOnly = {
      assistant_text: "Here's what I can tell you.",
      analysis_ready: { status: "blocked", goal_node_id: "", options: [], bias_findings: [] },
      _diagnostic_trace: { exit_path: "turn_executor" },
    };
    expect(READINESS_PRODUCING_EXIT_PATHS.has("turn_executor")).toBe(true);
    const failures = assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, freshnessOnly);
    expect(failures.join(" ")).toContain("PUT NO COMPARABLE OPTIONS ON THE WIRE");
    // The message must NAME the exit_path, or the on-call engineer cannot tell
    // a real loss from a mis-classified exit without opening the payload.
    expect(failures.join(" ")).toContain("turn_executor");
  });

  it("an ABSENT exit_path is reported as unclassifiable, not silently passed", () => {
    // The gate cannot tell a loss from a legitimate omission without the exit
    // path. Silently passing is the same silent-disable this round is fixing;
    // asserting a loss would be a fabrication. Say what is actually true.
    const noExit = { assistant_text: "…", analysis_ready: { options: [] } };
    const failures = assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, noExit);
    expect(failures.join(" ")).toContain("exit_path");
    expect(failures.join(" ")).not.toContain("PUT NO COMPARABLE OPTIONS ON THE WIRE");
  });

  it("DERIVED, NOT MIRRORED: the readiness-producing set matches route-v2's call sites", () => {
    // trap 12: a hand-listed set of exit paths WILL drift from the producer.
    // Derive it from the sendFinalised200 call sites — the sole sanctioned
    // 200-OK send site — and fail loud when the two disagree.
    const routeSrc = readFileSync(resolve(REPO_ROOT, "src/orchestrator/route-v2.ts"), "utf8");
    const lines = routeSrc.split("\n");
    const found = new Set<string>();
    const supplying = new Set<string>();
    let sites = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/sendFinalised200\s*\(/.test(lines[i])) continue;
      if (/function sendFinalised200/.test(lines[i])) continue;
      let depth = 0;
      let started = false;
      const buf: string[] = [];
      for (let j = i; j < Math.min(i + 120, lines.length); j++) {
        buf.push(lines[j]);
        for (const ch of lines[j]) {
          if (ch === "(") {
            depth++;
            started = true;
          } else if (ch === ")") depth--;
        }
        if (started && depth <= 0) break;
      }
      const text = buf.join("\n");
      const m = text.match(/sendFinalised200\s*\(\s*[^,]+,\s*[^,]+,\s*'([a-z_0-9]+)'\s*,/);
      if (!m) continue;
      sites++;
      found.add(m[1]);
      if (/(^|[^.\w])analysisReady\s*:/.test(text)) supplying.add(m[1]);
    }
    // POSITIVE CONTROL: an empty or single-bucket parse must not pass vacuously,
    // and identical answers for every site would be evidence about the parser
    // rather than about the route (trap 20).
    expect(sites, "the sendFinalised200 parse found no call sites — the probe is blind").toBeGreaterThan(14);
    expect(found.size, "the parse returned too few distinct exit paths to be discriminating").toBeGreaterThan(9);
    expect([...supplying].sort()).toEqual([...READINESS_PRODUCING_EXIT_PATHS].sort());
  });
});

describe("2.1300 F4 — the invariant is the model the user LEAVES HOLDING", () => {
  it("FAILS a later-turn re-draft that collapses to an empty graph", () => {
    // MEASURED: turn 1 healthy, turn 2 re-drafts an EMPTY graph → PASS. The
    // usability check bound to the FIRST drafting turn, so a re-draft collapse
    // was invisible — and a redraft on a later turn is a real product path
    // (exit_path=explicit_generate_graph_present commits a draft_graph redraft).
    const collapsedRedraft = {
      assistant_text: "I've redrafted the model.",
      draft_graph: { nodes: [], edges: [] },
      analysis_ready: structuredClone(LIVE_DRAFTFIRST_TURN1.analysis_ready),
      graph_hash: LIVE_DRAFTFIRST_TURN1.graph_hash,
      _diagnostic_trace: { exit_path: "draft_graph", prompt_identity: [{ task_id: "t", version: "v", hash: "h" }] },
    };
    const failures = assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, collapsedRedraft);
    expect(failures.join(" ")).toContain(`expected >= ${MIN_NODES}`);
    // …named on TURN 2, where the collapse happened.
    expect(failures.join(" ")).toContain("turn 2: draft_graph.nodes=0");
  });

  it("PASSES a provisional first draft followed by a full one — the user does leave holding a model", () => {
    // MEASURED false red ×4: a 2-node provisional draft on turn 1 followed by a
    // full healthy draft on turn 2 failed, though the user leaves holding a
    // usable model. Same false-alarm shape as the P0 this PR removes, narrower.
    const provisional = {
      assistant_text: "Here's a first sketch — I'll fill it in.",
      draft_graph: { nodes: [{ id: "g", kind: "goal" }, { id: "o1", kind: "option" }], edges: [] },
      analysis_ready: { options: [] },
      _diagnostic_trace: { exit_path: "draft_graph", prompt_identity: [{ task_id: "t", version: "v", hash: "h" }] },
    };
    expect(assertHealthyJourney(provisional, LIVE_DRAFTFIRST_TURN1)).toEqual([]);
  });

  it("TWIN: a trivial draft that is the LAST word still fails, on its own label", () => {
    // Opposite direction — the 2.1252 shape must stay red. This is the case the
    // "last drafting turn" reading must not weaken.
    const trivialTurn1 = {
      assistant_text: "I've built a first decision model from your brief.",
      draft_graph: { nodes: [{ id: "n1", kind: "goal" }], edges: [] },
      analysis_ready: { options: [] },
      _diagnostic_trace: { exit_path: "draft_graph" },
    };
    const failures = assertHealthyJourney(trivialTurn1, LIVE_DRAFTFIRST_TURN2);
    expect(failures.join(" ")).toContain("turn 1:");
    expect(failures.join(" ")).toContain(`expected >= ${MIN_NODES}`);
  });
});

/**
 * ROADMAP — the 18 Aug 2026 turn-2 readiness intermittent.
 *
 * WHAT THESE PIN, AND WHY THEY ARE NOT "tests for a log line".
 *
 * The gate fired on 2 of 10 identical runs and every field it printed was
 * BYTE-IDENTICAL across the failing and the passing runs. The response bodies
 * were not: they carried `goal_node_id`, `readiness_issues`, `blocked_reason`,
 * `freshness_reason` and `graph_hash`, and those five fields separate four
 * different producers of the same `{status:'blocked', options:[]}` shape. A
 * diagnostic that omits the only discriminating fields is the same defect class
 * as an assertion that cannot fail — it agrees with every hypothesis.
 *
 * So each case below is stated as a DISCRIMINATION: two bodies that the gate
 * previously described identically must now describe differently, and the twin
 * proves the reporter is not simply printing the same string for everything
 * (CLAUDE.md trap 20 — when a per-item probe returns the same answer for every
 * item, suspect the probe).
 */
describe("18 Aug intermittent — the readiness diagnosis discriminates the producers", () => {
  /** The shape measured on staging: blocked, no goal, no options. */
  const NO_GOAL_BODY = {
    analysis_ready: {
      status: "blocked",
      goal_node_id: "",
      options: [],
      blocked_reason: "NO_GOAL",
      readiness_issues: [{ code: "NO_GOAL" }, { code: "OPTIONS_NOT_CONFIGURED" }],
      freshness: "none",
      freshness_reason: "no_successful_run_analysis_fact",
    },
    graph_hash: "f986ac90c77eafbd",
  };

  /**
   * THE TWIN THAT MATTERS. Same `status`, same empty `options`, same
   * `graph_hash` — and a REAL goal_node_id. Under the old log line these two
   * bodies printed the identical `analysis_ready.options=0`, so the first
   * diagnosis of this defect asserted "the graph had no goal node" on evidence
   * that could not tell these two apart. They are different defects with
   * different owners: no goal is a structural loss, a real goal with no options
   * is an option-projection loss.
   */
  const GOAL_BUT_NO_OPTIONS_BODY = {
    analysis_ready: {
      status: "blocked",
      goal_node_id: "378f195a",
      options: [],
      readiness_issues: [{ code: "OPTIONS_NOT_CONFIGURED" }],
      freshness: "none",
      freshness_reason: "no_successful_run_analysis_fact",
    },
    graph_hash: "f986ac90c77eafbd",
  };

  it("PREMISE: the old counter really cannot tell the two apart", () => {
    // If this ever stops being true the discrimination tests below are
    // asserting against a distinction the gate already made.
    expect(readyOptionCount(NO_GOAL_BODY)).toBe(0);
    expect(readyOptionCount(GOAL_BUT_NO_OPTIONS_BODY)).toBe(0);
    expect(NO_GOAL_BODY.analysis_ready.status).toBe(
      GOAL_BUT_NO_OPTIONS_BODY.analysis_ready.status,
    );
  });

  it("DISCRIMINATES no-goal from goal-with-no-options — the distinction the first diagnosis guessed at", () => {
    const noGoal = readinessDiagnosis(NO_GOAL_BODY);
    const withGoal = readinessDiagnosis(GOAL_BUT_NO_OPTIONS_BODY);
    expect(noGoal).not.toBe(withGoal);
    // Bound by IDENTITY of the field, not by "the strings differ": a reporter
    // that differed on some incidental field would pass a mere inequality.
    expect(noGoal).toContain('goal_node_id=""');
    expect(withGoal).toContain('goal_node_id="378f195a"');
  });

  it("NEVER collapses an absent readiness block into an empty one", () => {
    // `goal_node_id=""` (the projection ran and found no goal) and no block at
    // all (nothing produced readiness) are different facts. `graphLine`'s own
    // header records what collapsing two facts into one symbol cost once.
    expect(readinessDiagnosis({ assistant_text: "…" })).toBe("analysis_ready=absent(no-block)");
    expect(readinessDiagnosis(NO_GOAL_BODY)).not.toContain("absent(no-block)");
  });

  it("surfaces the projection's OWN reason codes, which were already on the wire and never printed", () => {
    expect(readinessDiagnosis(NO_GOAL_BODY)).toContain("readiness_issues=NO_GOAL|OPTIONS_NOT_CONFIGURED");
    // TWIN: a payload with NO readiness_issues key must say `absent`, not
    // `none` — the refusal builder omits the key entirely and the helper
    // fallback always sets it, so absent-vs-empty is itself a producer tell.
    expect(readinessDiagnosis({ analysis_ready: { status: "blocked", options: [] } })).toContain(
      "readiness_issues=absent",
    );
    expect(
      readinessDiagnosis({ analysis_ready: { status: "blocked", options: [], readiness_issues: [] } }),
    ).toContain("readiness_issues=none");
  });

  it("reports the freshness verdict that decides whether the synthesis carrier was even reachable", () => {
    // `synthesiseFreshnessOnlyAnalysisReady` emits the identical shape, but only
    // for FRESHNESS_ONLY_SYNTHESIS_REASONS, both of which require a selected
    // run_analysis fact. A fresh journey has none, so this reason RULES THAT
    // PRODUCER OUT — and the gate never printed it.
    expect(readinessDiagnosis(NO_GOAL_BODY)).toContain(
      'freshness="none"/"no_successful_run_analysis_fact"',
    );
    const synth = {
      analysis_ready: {
        status: "blocked",
        goal_node_id: "",
        options: [],
        bias_findings: [],
        freshness: "unknown",
        freshness_reason: "current_graph_hash_unavailable",
      },
    };
    expect(readinessDiagnosis(synth)).toContain('freshness="unknown"/"current_graph_hash_unavailable"');
    // The synthesis carrier is the ONLY producer that ships bias_findings with
    // no readiness_issues — print both so the pair is legible.
    expect(readinessDiagnosis(synth)).toContain("bias_findings=0");
    expect(readinessDiagnosis(synth)).toContain("readiness_issues=absent");
  });

  it("reports graph_hash, so read-of-the-wrong-model can be ruled in or out rather than inferred from silence", () => {
    // The continuity check compares hashes but speaks ONLY on disagreement, so
    // on a failure the log never revealed whether it had agreed or simply been
    // absent. An absence probe with no positive control (trap 13).
    expect(readinessDiagnosis(NO_GOAL_BODY)).toContain('graph_hash="f986ac90c77eafbd"');
    expect(readinessDiagnosis({ analysis_ready: { options: [] } })).toContain("graph_hash=absent");
  });

  it("the real captured healthy turn 2 reports a REAL goal and its true issue codes", () => {
    // Positive control against a committed live capture, not a hand-built
    // object: the reporter must produce the right answer on the shape the
    // product actually emits.
    const line = readinessDiagnosis(LIVE_DRAFTFIRST_TURN2);
    expect(line).toContain(`goal_node_id="${LIVE_DRAFTFIRST_TURN2.analysis_ready.goal_node_id}"`);
    expect(LIVE_DRAFTFIRST_TURN2.analysis_ready.goal_node_id).not.toBe("");
    expect(line).toContain("MISSING_OPTION_VALUE");
    expect(line).toContain(`graph_hash="${LIVE_DRAFTFIRST_TURN2.graph_hash}"`);
  });
});

describe("18 Aug intermittent — the draft census makes the goal node an observation", () => {
  it("counts the drafted node KINDS on the real capture, including the goal", () => {
    const census = draftGraphCensus(LIVE_DRAFTFIRST_TURN1);
    const kinds: Record<string, number> = {};
    for (const n of LIVE_DRAFTFIRST_TURN1.draft_graph.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
    // Derived from the fixture, not hand-copied: a hand-written expectation
    // here would be a mirror of the capture and would drift from it silently.
    expect(kinds.goal).toBeGreaterThan(0);
    expect(census).toContain(`goal:${kinds.goal}`);
    expect(census).toContain(`option:${kinds.option}`);
  });

  it("DISCRIMINATES a graph with a goal from one without, at the SAME node total", () => {
    // The whole point: `nodes=2` is identical for both, and the census is not.
    const withGoal = { draft_graph: { nodes: [{ id: "a", kind: "goal" }, { id: "b", kind: "option" }] } };
    const withoutGoal = { draft_graph: { nodes: [{ id: "a", kind: "factor" }, { id: "b", kind: "option" }] } };
    expect(withGoal.draft_graph.nodes.length).toBe(withoutGoal.draft_graph.nodes.length);
    expect(draftGraphCensus(withGoal)).toContain("goal:1");
    expect(draftGraphCensus(withoutGoal)).not.toContain("goal:");
  });

  it("says absent(no-block) for a turn with no graph, never a zero", () => {
    expect(draftGraphCensus(LIVE_DRAFTFIRST_TURN2)).toBe("draft_graph=absent(no-block)");
    expect(draftGraphCensus({ draft_graph: { nodes: [] } })).toBe("draft_graph.kinds=(empty)");
  });
});

describe("18 Aug intermittent — the failure message must not misattribute the seam", () => {
  const lostOptions = {
    ...LIVE_DRAFTFIRST_TURN2,
    analysis_ready: { ...LIVE_DRAFTFIRST_TURN2.analysis_ready, options: [], goal_node_id: "" },
  };

  it("ENUMERATES the candidate seams and asserts NO cause — both retired wordings stay retired", () => {
    const msg = assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, lostOptions).join(" ");
    // ⚠ THIS MESSAGE HAS BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS, and both
    // wrong versions are pinned out here rather than only the first.
    //   v1 "the model did not survive the turn"  → pointed at PERSISTENCE.
    //   v2 "the failure is in that READ or that PROJECTION" → pointed at the
    //      read/projection, while the message's OWN printed fields showed the
    //      read returned the committed model and the projection had succeeded.
    // The measured cause was a THIRD seam — the analyse-refusal arm overwriting
    // a good projection — which neither version named.
    expect(msg).not.toContain("did not survive the turn");
    expect(msg).not.toContain("the failure is in that READ or that PROJECTION");

    // What it must do instead: report the OBSERVATION, then enumerate every
    // seam consistent with the evidence, each with the field that identifies
    // it. An alarm may state what it saw; it may not state a cause it cannot
    // observe, because a confident wrong seam is acted on.
    expect(msg).toContain("That is an OBSERVATION about the payload, not yet a cause");
    for (const candidate of [
      "OVERWRITTEN AFTER A GOOD PROJECTION",
      "THE PROJECTION FOUND NOTHING",
      "THE READ RETURNED SOMETHING ELSE",
    ]) {
      expect(msg, candidate).toContain(candidate);
    }
    // Each candidate must ship the field that discriminates it, or the list is
    // three guesses rather than a decision procedure.
    expect(msg).toContain("TELL: blocked_reason present with readiness_issues ABSENT");
    expect(msg).toContain("TELL: readiness_issues PRESENT");
    expect(msg).toContain("TELL: graph_hash DIFFERS");
  });

  it("carries the discriminating fields INTO the alarm, not only into the log", () => {
    // CI surfaces the failure list; a log line above it can be scrolled past or
    // truncated. The message and the log must also never disagree, so both are
    // rendered by the SAME function — one concept, one predicate.
    const msg = assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, lostOptions).join(" ");
    expect(msg).toContain(readinessDiagnosis(lostOptions));
    expect(msg).toContain(readinessDiagnosis(LIVE_DRAFTFIRST_TURN1));
  });

  it("TWIN: a healthy journey still emits NO message at all", () => {
    // Opposite direction — none of the above may be bought with a new false
    // alarm on the shape the gate must let through.
    expect(assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, LIVE_DRAFTFIRST_TURN2)).toEqual([]);
  });
});

/**
 * C-2 — THE INSTRUMENT MUST NOT BE BLINDED BY THE FIX IT MEASURED.
 *
 * The 18 Aug P0 stacked TWO defects on one turn: the product ROUTED a
 * conversational turn ("draft the model now") to the analyse handler, and the
 * resulting refusal ERASED the model's identity from `analysis_ready`.
 *
 * Only the second is being fixed. That fix repopulates `options`, which turns
 * the continuity check — the ONLY assertion that has ever caught this turn —
 * fully GREEN. Proven by execution below. So without this block, closing the
 * payload defect makes the routing defect UNOBSERVABLE: a real, unfixed defect
 * with no alarm over it, on a build where CI is entirely green.
 *
 * That is the sharpest form of "a fix validated against the symptom's metric
 * kills the symptom and leaves the defect alive" — here the fix also removes
 * the instrument measuring the residual.
 *
 * The assertion is therefore keyed on `blocked_reason`, which the fix
 * PRESERVES, not on `options`, which the fix repopulates. Orthogonal by
 * construction. Both halves are pinned: the fixed payload must still trip this
 * alarm, and a genuinely conversational reply must not.
 */
describe("C-2 — a conversational turn answered with an ANALYSIS REFUSAL is its own defect", () => {
  /** The wire shape measured on staging, 18 Aug 2026 (pre-fix). */
  const REFUSAL_PRE_FIX = {
    assistant_text: "I could not complete the analysis.",
    analysis_ready: {
      status: "blocked",
      goal_node_id: "",
      options: [],
      blocked_reason: "MISSING_OPTION_VALUE",
    },
    graph_hash: "cfded3af0aa14ebd",
    _diagnostic_trace: { exit_path: "turn_executor" },
  };

  /**
   * THE SAME TURN AFTER THE PAYLOAD FIX: identity restored, refusal intact.
   * This is what staging will emit once the sibling fix deploys.
   */
  const REFUSAL_POST_FIX = {
    ...REFUSAL_PRE_FIX,
    analysis_ready: {
      status: "blocked",
      goal_node_id: "378f195a",
      options: LIVE_DRAFTFIRST_TURN1.analysis_ready.options,
      blocked_reason: "MISSING_OPTION_VALUE",
    },
    graph_hash: LIVE_DRAFTFIRST_TURN1.graph_hash,
  };

  it("PREMISE, PROVEN BY EXECUTION: the payload fix turns the continuity check GREEN on this turn", () => {
    // The whole justification for this block. If this ever stops being true,
    // the reasoning above is stale and must be re-derived before trusting it.
    expect(assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, REFUSAL_PRE_FIX).join(" ")).toContain(
      "PUT NO COMPARABLE OPTIONS ON THE WIRE",
    );
    expect(assertHealthyJourney(LIVE_DRAFTFIRST_TURN1, REFUSAL_POST_FIX)).toEqual([]);
  });

  it("FIRES on the post-fix payload — the routing defect stays visible after the payload defect is closed", () => {
    const f = assertNoUnrequestedAnalysisRefusal([
      { label: "turn 2", body: REFUSAL_POST_FIX, requestedAnalysis: false },
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("CONVERSATIONAL turn with an ANALYSIS REFUSAL");
    // Bound by IDENTITY of the reason, not merely "something was reported".
    expect(f[0]).toContain('blocked_reason="MISSING_OPTION_VALUE"');
  });

  it("FIRES on the pre-fix payload too — one alarm spans both sides of the fix", () => {
    // If it only fired on one shape it would be a fixture-shaped guard rather
    // than a statement about routing.
    expect(
      assertNoUnrequestedAnalysisRefusal([
        { label: "turn 2", body: REFUSAL_PRE_FIX, requestedAnalysis: false },
      ]),
    ).toHaveLength(1);
  });

  it("OPPOSITE-DIRECTION TWIN: the real healthy journey is SILENT", () => {
    // No false alarm may be bought with the above. Both real captures.
    expect(
      assertNoUnrequestedAnalysisRefusal([
        { label: "turn 1", body: LIVE_DRAFTFIRST_TURN1, requestedAnalysis: false },
        { label: "turn 2", body: LIVE_DRAFTFIRST_TURN2, requestedAnalysis: false },
      ]),
    ).toEqual([]);
    // And the premise that makes that meaningful: the healthy capture really
    // has no blocked_reason, so the silence is the predicate's doing and not
    // the fixture's (trap 13b).
    expect(LIVE_DRAFTFIRST_TURN2.analysis_ready.blocked_reason).toBeUndefined();
  });

  it("OPPOSITE-DIRECTION TWIN: a turn that DID request an analysis is not judged", () => {
    // A refusal is a legitimate answer to a request to analyse. Firing there
    // would make the alarm a complaint about the handler doing its job.
    expect(
      assertNoUnrequestedAnalysisRefusal([
        { label: "turn 2", body: REFUSAL_POST_FIX, requestedAnalysis: true },
      ]),
    ).toEqual([]);
  });

  it("an empty or whitespace blocked_reason is NOT a refusal declaration", () => {
    // The legacy freshness-only carrier is `blocked` with NO reason, and CEE's
    // own consumer (`deriveAnalysisRefusalNoticeUpdate`) treats that as "not a
    // refusal statement". Agreeing with the producer's own reader, rather than
    // inventing a second rule, is the point.
    for (const reason of [undefined, null, "", "   "]) {
      const body = { analysis_ready: { status: "blocked", options: [], blocked_reason: reason } };
      expect(
        assertNoUnrequestedAnalysisRefusal([{ label: "turn 2", body, requestedAnalysis: false }]),
        `blocked_reason=${JSON.stringify(reason)}`,
      ).toEqual([]);
    }
  });

  it("CALL-SITE PIN: the CLI declares BOTH turns as not requesting an analysis", () => {
    // The intent must be declared where it is known, never inferred from the
    // reply under test. A future turn that legitimately asks for an analysis
    // declares `true` — but until then, a call site that silently stopped
    // judging turn 2 would disable this alarm with no test going red.
    const src = readFileSync(resolve(REPO_ROOT, "scripts/ci/staging-journey-smoke.mjs"), "utf8");
    const call = src.slice(src.indexOf("assertNoUnrequestedAnalysisRefusal(["));
    const block = call.slice(0, call.indexOf("]),"));
    expect(block).toContain('label: "turn 1", body: t1.body, requestedAnalysis: false');
    expect(block).toContain('label: "turn 2", body: t2.body, requestedAnalysis: false');
    // And the result must actually reach `failures`, or the call is decorative.
    expect(src).toContain("failures.push(\n    ...assertNoUnrequestedAnalysisRefusal(");
  });
});
