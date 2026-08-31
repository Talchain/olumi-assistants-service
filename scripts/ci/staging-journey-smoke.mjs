#!/usr/bin/env node
/**
 * Staging live-journey smoke gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * Drafting — step one of the product — was broken on staging for hours while
 * seven merges shipped over it. Nothing caught it, because the only smoke
 * workflow was `continue-on-error`, weekly, gated behind an unset repo variable
 * (`skipped` on 8 of its last 8 runs), and pointed at PRODUCTION.
 *
 * This script replaces that prose-level guarantee with a mechanism. It drives
 * the REAL user journey over HTTP against the DEPLOYED staging service and
 * exits non-zero when it breaks.
 *
 * It checks two independent failure modes, in order:
 *
 *   PHASE 1 — DID THE BUILD EVEN SHIP?
 *     Polls /healthz until the served `build` matches the commit we expect.
 *     A service still serving an older build than the tip is itself an outage:
 *     it means the deploy failed, and every downstream "verified on staging"
 *     claim is measuring the wrong code. This half is arguably more valuable
 *     than the journey itself — it is the failure mode that was live when this
 *     gate was written (staging served e22f8a6 while the tip was 26638e7a).
 *
 *   PHASE 2 — CAN A USER ACTUALLY GET A GRAPH?
 *     Turn 1 (frame) then Turn 2 (draft), reusing the scenario_id.
 *     Turn 2 asserts a USABLE graph — non-trivial node and option counts —
 *     NOT merely "no 500". "No 500" is what let the outage through: the
 *     product can return 200 and still hand the user nothing.
 *
 * DESIGN NOTE — why the assertions are exported pure functions
 * ------------------------------------------------------------
 * `assertHealthyDraft` / `assertHealthyFrame` take a parsed body and return
 * findings. They do no I/O. That lets tests feed them a committed REAL staging
 * capture (must PASS) and a committed REAL failure body (must FAIL) — a
 * positive control, so an absence assertion can never pass vacuously.
 * There is deliberately NO fixture mode on the CLI: CI always drives real HTTP.
 * A smoke test against mocks proves nothing about a deployed service.
 *
 * USAGE
 *   node scripts/ci/staging-journey-smoke.mjs
 * ENV
 *   SMOKE_BASE_URL   (required) e.g. https://cee-staging.onrender.com
 *   SMOKE_API_KEY    (required) value for the X-Olumi-Assist-Key header
 *   SMOKE_EXPECT_SHA (optional) commit expected to be serving; enables Phase 1
 *   SMOKE_FRESHNESS_TIMEOUT_MS (default 900000 = 15 min)
 *   SMOKE_TURN_TIMEOUT_MS      (default 180000 = 3 min)
 */

export const MIN_NODES = 4;
export const MIN_OPTIONS = 2;

/**
 * ⭐⭐ THE TWO FAILURE CLASSES, AND WHY THEY EXIST.
 *
 * This gate failed 101 CONSECUTIVE RUNS across 5 days 3 hours (last green run
 * 32983522511 @ 76e86bb8, 2026-08-26T14:58Z; first red 32992061388 @ 45cf25e1,
 * 2026-08-26T17:04Z). The script blob is byte-identical across that boundary —
 * the INSTRUMENT never changed. Every one of the 101 failures was the same
 * single fact: `_diagnostic_trace` was absent from the envelope, because
 * `CEE_DIAGNOSTIC_TRACE_ENABLED` had been set to "false" on the Render staging
 * service (measured at the Render API, 2026-08-31).
 *
 * The PRODUCT assertions passed on every one of those runs. A fresh guest got a
 * 10-node model with two comparable options and readiness `ready`, in 33
 * seconds. And this script printed:
 *
 *     The live user journey is broken on the deployed staging build.
 *
 * ⭐ THE ALARM WAS RIGHT TO FIRE. The trace absence is a real regression, and
 * separating the classes does NOT soften it — both classes still fail the run.
 * The defect is that a TRUE alarm printed a FALSE HEADLINE. Every reader who
 * checked the product found it working, concluded the alarm was broken, and
 * stopped looking. A red that says the wrong thing is how a real regression
 * survives five days under a gate built specifically to make regressions
 * unmissable — it is the broken-alarm defect (CLAUDE.md trap 7/14) reached
 * through a MESSAGE rather than through a config.
 *
 * So a finding's class is a property of THE CHECK THAT PRODUCED IT. It is never
 * a string match on the message: a message→class table would be exactly the
 * hand-maintained mirror this estate keeps paying for (trap 12), and it would
 * misclassify the first message anybody reworded.
 *
 *   JOURNEY BROKEN   — the product did not do what the user is promised.
 *                      `assertHealthyFrame`, `assertHealthyJourney`
 *                      (which owns `assertHealthyDraft`),
 *                      `assertNoUnrequestedAnalysisRefusal`, HTTP status.
 *   PROVENANCE DARK  — the product may be fine; the run cannot PROVE what ran.
 *                      `assertTraceObservability`, `assertContinuityJudgeable`,
 *                      `assertPromptProvenance`.
 */
export const VERDICT_JOURNEY_BROKEN = "JOURNEY BROKEN";
export const VERDICT_PROVENANCE_DARK = "PROVENANCE DARK";

/**
 * The flag that gates `_diagnostic_trace`, named in the alarm because finding
 * it cost five days.
 *
 * DASHBOARD-ONLY, measured at this tip: `rg -a CEE_DIAGNOSTIC_TRACE_ENABLED
 * render.yaml render-staging.yaml` returns ZERO hits, with the contrast control
 * `NODE_ENV|CEE_` returning 2 and 1 in the same run — so the probe is not
 * blind. Nothing in the repository records its value, and nothing in the
 * repository can set it. That is why it went dark unobserved.
 */
export const TRACE_FLAG = "CEE_DIAGNOSTIC_TRACE_ENABLED";

/** Node kinds that represent a comparable alternative. See src/schemas/cee-v3.ts. */
const OPTION_KIND = "option";

/** The `exit_path` that DECLARES a drafting turn. See v5-diagnostic-trace.ts. */
const DRAFT_EXIT_PATH = "draft_graph";

/**
 * Exit paths whose `sendFinalised200` call site supplies an `analysisReady`
 * payload — i.e. the ONLY paths on which an absent/empty `analysis_ready` means
 * something was LOST rather than simply never produced.
 *
 * WHY THIS SET EXISTS
 * -------------------
 * The continuity check used to read an empty `analysis_ready.options` on ANY
 * later turn as "the model did not survive the turn". Measured: a follow-up
 * with no `analysis_ready` block at all produced exactly that message — and for
 * a deterministic non-graph exit it is FALSE, an alarm asserting a loss that did
 * not happen. `clarify_v2` and `frame_no_brief_guard` call `sendFinalised200`
 * with no `analysisReady` (route-v2.ts:3848 / :5366 / :5400), and the finaliser
 * omits the block unless a payload is supplied (response-finaliser.ts:261-269).
 * A false alarm is how this estate loses real ones.
 *
 * DERIVED, NOT REMEMBERED (trap 12). This list is a mirror of the producer, so
 * the spec re-derives it from `route-v2.ts`'s `sendFinalised200` call sites and
 * fails loud when the two disagree — with a positive control proving the parse
 * can see call sites at all. Do not hand-edit it: change the route, re-run the
 * spec, and let the derivation tell you the new set.
 *
 * Derived at fd148826 from 21 call sites: `readiness_intake` and `system_event`
 * are in this set and were NOT in the four (`turn_executor`, `chip_click`,
 * `draft_graph`, `edit_graph`) that the finaliser's own prose names — the prose
 * is a summary of the primary paths, not the complete producer.
 */
export const READINESS_PRODUCING_EXIT_PATHS = new Set([
  "chip_click",
  "draft_graph",
  "edit_graph",
  "readiness_intake",
  "system_event",
  "turn_executor",
]);

/**
 * THE ONE PREDICATE for "this turn handed the user a model".
 *
 * It exists as a named export because the same concept was previously expressed
 * TWO ways: delivery/usability keyed on `draft_graph` PRESENCE while provenance
 * keyed on `exit_path === "draft_graph"`. That divergence IS the P0 this gate
 * was rewritten for — #1002 relabelled the drafting event and the provenance
 * half silently stopped applying. Two predicates for one concept is a
 * guarantee waiting to lapse; both callers now share this function.
 */
export function carriedDraftGraph(body) {
  const g = body?.draft_graph;
  return Boolean(g) && typeof g === "object";
}

/** The option OBJECTS a response says the model is comparing (shape only). */
function readyOptions(body) {
  return Array.isArray(body?.analysis_ready?.options) ? body.analysis_ready.options : [];
}

/**
 * How many option OBJECTS a response carries, regardless of whether they are
 * identifiable. The single counter — `assertHealthyDraft`'s minimum-count check
 * and the continuity check's precondition both read it, so they cannot disagree
 * about how many options a turn has.
 */
export function readyOptionCount(body) {
  return readyOptions(body).length;
}

/**
 * THE READINESS DIAGNOSIS LINE — why this exists, and what it is for.
 *
 * On 18 Aug 2026 this gate fired `analysis_ready.options was empty … the model
 * did not survive the turn` on 2 of 10 identical runs. Every diagnostic the log
 * carried was IDENTICAL on the failing and the passing runs — same build_sha,
 * same exit_path, same prompt_identity, same turn-1 node and option counts. The
 * only thing the log said about the failure was that it happened.
 *
 * A whole diagnosis session then went into a SOURCE TRACE to answer a question
 * the response body answers directly. Worse, the trace had to GUESS which of
 * four producers of `{status:'blocked', goal_node_id:'', options:[]}` had
 * emitted it — `assessCanonicalAnalysisReadiness`'s no-semantic fallback
 * (analysis-ready-helper.ts:1122), its SCHEMA_INVALID exit (:976, which emits
 * NO block at all), `buildAnalysisRefusalReadiness` (:1366) and
 * `synthesiseFreshnessOnlyAnalysisReady` (analysis-ready-emit.ts:59) — and
 * those four are told apart by exactly the fields below:
 *
 *   · `goal_node_id` empty vs real     → "the projection found no goal node"
 *                                        vs "it found the goal and lost the
 *                                        OPTIONS". Two different defects; the
 *                                        old log could not distinguish them,
 *                                        and the first diagnosis asserted the
 *                                        first without evidence for it.
 *   · `readiness_issues[].code`        → the projection's OWN reason, already
 *                                        on the wire and never printed.
 *   · `blocked_reason`                 → present on the refusal builder, absent
 *                                        on the freshness-only carrier.
 *   · `bias_findings` present with no
 *     `readiness_issues`               → the freshness-only synthesis carrier.
 *   · `freshness` / `freshness_reason` → whether the synthesis path was even
 *                                        reachable (it needs a selected
 *                                        run_analysis fact; a fresh journey has
 *                                        none, so `none/no_successful_run_
 *                                        analysis_fact` RULES IT OUT).
 *   · `graph_hash`                     → whether this turn read the SAME model
 *                                        the drafting turn committed. This is
 *                                        the read-vs-write discriminator and
 *                                        the gate already compares it — but it
 *                                        only speaks when the two DISAGREE, so
 *                                        on a failure the log never showed
 *                                        whether it had agreed or simply been
 *                                        absent. Silence from a check that
 *                                        turns itself off on absence is not
 *                                        evidence (CLAUDE.md trap 13).
 *
 * NOTHING HERE IS AN ASSERTION. This function only reports; it cannot pass or
 * fail a run. It is deliberately shared by the per-turn log line AND the
 * failure message, so the alarm and the diagnostic can never describe the same
 * turn differently — the same one-concept-one-predicate rule the rest of this
 * file is built on.
 *
 * ABSENT IS NEVER PRINTED AS EMPTY. `goal_node_id=""` (the projection ran and
 * found no goal) and `goal_node_id=absent` (no readiness block at all) are
 * different facts, and `graphLine`'s own header records what collapsing two
 * facts into one symbol already cost this estate once.
 */
export function readinessDiagnosis(body) {
  const a = body?.analysis_ready;
  if (!a || typeof a !== "object") return "analysis_ready=absent(no-block)";
  const q = (v) => (typeof v === "string" ? JSON.stringify(v) : v === undefined ? "absent" : String(v));
  const issues = Array.isArray(a.readiness_issues)
    ? a.readiness_issues.map((i) => i?.code ?? "?").join("|") || "none"
    : "absent";
  const bias = Array.isArray(a.bias_findings) ? String(a.bias_findings.length) : "absent";
  return (
    `status=${q(a.status)} goal_node_id=${q(a.goal_node_id)} ` +
    `blocked_reason=${q(a.blocked_reason)} readiness_issues=${issues} bias_findings=${bias} ` +
    `freshness=${q(a.freshness)}/${q(a.freshness_reason)} graph_hash=${q(body?.graph_hash)}`
  );
}

/**
 * The node-kind census of a turn's `draft_graph`.
 *
 * The counterpart to `readinessDiagnosis` on the WRITE side. `nodes=14` says
 * nothing about whether the drafted model contained the one node the readiness
 * projection requires — a node with `kind: "goal"`; without it
 * `projectSemanticAnalysisReadyFromGraph` returns `undefined` and the whole
 * payload collapses to `{status:'blocked', goal_node_id:'', options:[]}`
 * (analysis-ready-helper.ts:788 → :1122). So the census makes "the drafted
 * model had a goal / had N options" an OBSERVATION rather than an inference
 * from a total.
 *
 * Returns `draft_graph=absent(no-block)` — never a zero — when the turn carried
 * no graph, for the same reason `graphLine` does.
 */
export function draftGraphCensus(body) {
  const g = body?.draft_graph;
  if (!g || typeof g !== "object") return "draft_graph=absent(no-block)";
  if (!Array.isArray(g.nodes)) return "draft_graph.nodes=absent(not-an-array)";
  const counts = new Map();
  for (const n of g.nodes) {
    const k = n && typeof n === "object" && typeof n.kind === "string" ? n.kind : "(no-kind)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const census = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k}:${n}`)
    .join(",");
  return `draft_graph.kinds=${census || "(empty)"}`;
}

/**
 * Assert turn 1 (frame) produced a coherent response.
 * @returns {string[]} failure messages; empty means healthy.
 */
export function assertHealthyFrame(body) {
  const f = [];
  if (!body || typeof body !== "object") return ["turn 1: response body was not a JSON object"];
  if (typeof body.assistant_text !== "string" || body.assistant_text.trim().length === 0) {
    f.push("turn 1: assistant_text was empty — the user would see a blank reply");
  }
  // NOTE WHAT IS NOT HERE. This function used to also push
  // `_diagnostic_trace.exit_path missing` into the same flat list as
  // `assistant_text was empty` — one check answering two questions, and the
  // reason the verdict could not tell a broken product from a dark trace. An
  // absent exit_path is a PROVENANCE finding and is now raised by
  // `assertTraceObservability`, uniformly across every turn rather than only
  // this one. Same harm, correct class, wider scope.
  if (body?._diagnostic_trace?.exit_path === "draft_graph_error") {
    f.push("turn 1: exit_path was draft_graph_error");
  }
  return f;
}

/**
 * Assert the turn that DRAFTED returned a USABLE graph, not merely a 200.
 *
 * `label` names the turn in every message. It is a parameter, not the hardcoded
 * "turn 2" it used to be, because #1002 (draft-first) moved drafting to turn 1:
 * an alarm that says "turn 2" about a turn-1 failure sends the on-call engineer
 * to the wrong log line.
 *
 * @returns {string[]} failure messages; empty means healthy.
 */
export function assertHealthyDraft(body, label = "turn 2") {
  const f = [];
  if (!body || typeof body !== "object") return [`${label}: response body was not a JSON object`];

  const exit = body?._diagnostic_trace?.exit_path;
  if (exit === "draft_graph_error") {
    // Surface the real reason — this is the message an on-call engineer reads first.
    const d = body.details ?? {};
    f.push(
      `${label}: exit_path=draft_graph_error` +
        (d.violation_code ? ` violation_code=${d.violation_code}` : "") +
        (d.reason ? ` reason=${d.reason}` : ""),
    );
  }

  const g = body.draft_graph;
  if (!g || typeof g !== "object") {
    f.push(`${label}: no draft_graph on the response — the user got no model back`);
    return f;
  }

  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  if (nodes.length < MIN_NODES) {
    f.push(`${label}: draft_graph.nodes=${nodes.length}, expected >= ${MIN_NODES} (graph too trivial to be usable)`);
  }

  // Options live in two places; require BOTH to be coherent. The graph needs
  // option NODES for connectivity, and analysis_ready.options carries the
  // intervention metadata the analysis actually compares.
  const optionNodes = nodes.filter((n) => n && n.kind === OPTION_KIND);
  if (optionNodes.length < MIN_OPTIONS) {
    f.push(
      `${label}: option nodes=${optionNodes.length}, expected >= ${MIN_OPTIONS} ` +
        `(nothing to compare — a decision needs alternatives)`,
    );
  }

  const optionsForAnalysis = readyOptions(body);
  if (optionsForAnalysis.length < MIN_OPTIONS) {
    f.push(`${label}: analysis_ready.options=${optionsForAnalysis.length}, expected >= ${MIN_OPTIONS}`);
  }

  // OPTIONS_IDENTICAL was the live defect: distinct ids, but nothing to tell
  // the options apart. Assert the ids are actually distinct.
  const ids = optionsForAnalysis.map((o) => o?.option_id).filter(Boolean);
  if (ids.length > 0 && new Set(ids).size !== ids.length) {
    f.push(`${label}: analysis_ready.options contained duplicate option_id values: ${ids.join(",")}`);
  }

  return f;
}

/**
 * The USABLE `option_id`s a response says the model is comparing.
 *
 * Note what this drops, and read the precondition pin in `assertHealthyJourney`
 * before relying on it: an option object whose `option_id` is `""`, `null` or
 * absent is NOT identifiable, so it cannot participate in an identity check.
 * The contract admits all three — `OptionForAnalysis.id` is `z.string()` with no
 * `.min(1)` (src/schemas/analysis-ready.ts:85), the emit is `option_id: opt.id`
 * (analysis-ready-helper.ts:1123), and the wire envelope validates
 * `analysis_ready` as `z.unknown().optional()`
 * (src/orchestrator/validation/response-envelope-schema.ts:135) — so nothing
 * enforces a usable `option_id` on egress.
 */
function readyOptionIds(body) {
  return readyOptions(body)
    .map((o) => o?.option_id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * THE JOURNEY INVARIANT (ROADMAP 2.1300).
 *
 * WHAT THIS ASSERTS, AND WHY IT IS NOT "assert turn 2"
 * ---------------------------------------------------
 * The product's promise is not "turn 2 returns a graph" — it is that a user who
 * brings a decision LEAVES HOLDING A USABLE MODEL, and that the model the
 * product then talks about is the model it actually built. Which turn drafts is
 * a product decision that has now changed twice: pre-#1002 turn 1 asked a
 * clarifying question and turn 2 drafted; post-#1002 turn 1 drafts immediately
 * and clarification rides alongside. Binding the alarm to a turn INDEX made a
 * deliberate, ratified product improvement read as an outage — and, far worse,
 * left the gate unable to tell that case apart from a real outage, because both
 * emit `no draft_graph on the response`.
 *
 * So the assertion is stated over the JOURNEY:
 *
 *   1. DELIVERY — at least one turn carried a `draft_graph`. If none did, the
 *      user got no model and that is the outage this alarm was built for. The
 *      message names both exit_paths, because "which path served this" is the
 *      first thing an on-call engineer needs and the old message omitted it.
 *
 *   2. USABILITY — the LAST drafting turn's graph clears MIN_NODES /
 *      MIN_OPTIONS and has distinct option ids, via `assertHealthyDraft` under
 *      that turn's own label. This is the assertion that #1002 moved out from
 *      under: the only graph check lived on turn 2, so a trivial or empty
 *      turn-1 draft (the ROADMAP 2.1252 shape) had NO gate above it here.
 *
 *      WHY THE **LAST** DRAFTING TURN, not the first and not every one. The
 *      invariant is what the user LEAVES HOLDING, and `findIndex` implemented
 *      "the FIRST drafting turn must be usable" — a different claim, wrong in
 *      both directions, both measured at fd148826:
 *        · turn 1 healthy, turn 2 re-drafts an EMPTY graph → PASSED. A re-draft
 *          collapse was invisible, and a later-turn redraft is a real product
 *          path (`explicit_generate_graph_present` commits a draft_graph
 *          redraft). The last-turn reading catches it.
 *        · turn 1 a provisional 2-node draft, turn 2 a full healthy draft →
 *          3 FAILURES, though the user does leave holding a usable model. That
 *          is the same false-alarm shape as the P0 this gate exists to remove,
 *          one turn narrower. Asserting EVERY drafting turn would keep it.
 *      A mid-journey provisional sketch is not an outage; an unusable final
 *      model is. Note the 2.1252 shape still fails when the trivial draft is
 *      the LAST word — pinned by a test, because that is what this reading
 *      must not weaken.
 *
 *   3. CONTINUITY, BOUND BY IDENTITY — every turn after the drafting turn must
 *      still name the same `option_id`s. This is deliberately an identity check
 *      and not a count: `analysis_ready.options.length >= 2` is satisfied by ANY
 *      two-item list, so a count cannot see the product describing a different
 *      set of options than the one it built. That divergence is the P5
 *      fabrication class — a claim about the user's model not grounded in the
 *      model — and the old gate was blind to it entirely.
 *
 * ASYMMETRY, STATED DELIBERATELY (trap 22b): LOSS of a drafted option_id fails;
 * ADDITION does not. Losing one means the product is talking about a model it
 * did not build. Gaining one makes nothing the user was told less true, so
 * failing on it would be a false alarm — and false alarms are precisely how this
 * estate has lost real ones. One harm, one direction, one parameter.
 *
 * @param {unknown} frameBody   turn 1 body
 * @param {unknown} followUpBody turn 2 body
 * @returns {string[]} failure messages; empty means healthy.
 */
export function assertHealthyJourney(frameBody, followUpBody) {
  const f = [];
  const turns = [
    { label: "turn 1", body: frameBody },
    { label: "turn 2", body: followUpBody },
  ];

  // The LAST turn that handed the user a model — the one they leave holding.
  // Shares `carriedDraftGraph` with the provenance check: one concept, one
  // predicate. `findLastIndex` is Node 18+; CI runs Node 20.
  const draftIdx = turns.findLastIndex((t) => carriedDraftGraph(t.body));

  // 1. DELIVERY.
  if (draftIdx === -1) {
    f.push(
      "journey: neither turn carried a draft_graph — the user got no model back " +
        `(exit_paths: ${turns
          .map((t) => `${t.label}=${t.body?._diagnostic_trace?.exit_path ?? "?"}`)
          .join(", ")})`,
    );
    return f;
  }

  // 2. USABILITY, on the turn that actually drafted.
  const drafting = turns[draftIdx];
  f.push(...assertHealthyDraft(drafting.body, drafting.label));

  // 3. CONTINUITY, by identity.
  //
  // THE PRECONDITION IS PINNED IN CODE, NOT IN A COMMENT. This loop used to
  // `continue` on an empty `draftedIds` under the note "nothing to lose; (2)
  // already judged it". That note was FALSE and is what made the hole
  // invisible: (2) counts option OBJECTS, and its duplicate check is itself
  // gated on `ids.length > 0`, so FOUR id-less option objects satisfy it
  // completely — two predicates for one concept again. Measured at fd148826 on
  // the real turn-1 capture with `option_id: ""` (also `null`, also absent) and
  // a follow-up naming four COMPLETELY DIFFERENT ids: `assertHealthyJourney`
  // returned `[]`. A PASS. The identity guarantee turned ITSELF OFF rather than
  // turning red, which is the worst behaviour available to an alarm.
  const draftedIds = readyOptionIds(drafting.body);
  const bindable = draftedIds.length > 0;
  if (!bindable && readyOptionCount(drafting.body) > 0) {
    f.push(
      `${drafting.label}: analysis_ready.options carry no usable option_id — ` +
        `the continuity check cannot bind, so it was not performed`,
    );
  }
  // When there are no option objects AT ALL, (2) really has judged it —
  // `analysis_ready.options=0, expected >= ${MIN_OPTIONS}` is already in `f`.
  // Adding a second message there would be the duplicate-predicate defect.

  for (const later of turns.slice(draftIdx + 1)) {
    // GRAPH_HASH — the strongest continuity signal available, and it was unused.
    // Both committed fixtures carry an identical `graph_hash` and the spec
    // already asserts that equality as "the premise of the continuity
    // assertion", while the gate never read it. Only compare when BOTH turns
    // carry one: absence is not disagreement, and firing on absence would red
    // the legacy clarify-then-draft journey, which carries no hash at all.
    const draftedHash = drafting.body?.graph_hash;
    const laterHash = later.body?.graph_hash;
    if (
      typeof draftedHash === "string" &&
      draftedHash.length > 0 &&
      typeof laterHash === "string" &&
      laterHash.length > 0 &&
      draftedHash !== laterHash
    ) {
      f.push(
        `${later.label}: graph_hash ${laterHash} does not match the model drafted on ` +
          `${drafting.label} (${draftedHash}) — the product is describing a different model ` +
          `than the one it built.`,
      );
    }

    if (!bindable) continue; // already reported above; do not judge silently

    const laterIds = readyOptionIds(later.body);
    if (laterIds.length === 0) {
      // An empty/absent `analysis_ready` is a LOSS only where readiness is
      // PRODUCED. On a deterministic non-graph exit the block is legitimately
      // absent, and the old unconditional message asserted a loss that did not
      // happen. Name the exit_path either way — "which path served this" is the
      // first thing an on-call engineer needs.
      //
      // ⚠ AN ABSENT exit_path IS NO LONGER JUDGED HERE. It used to push
      // "the gate cannot tell a real loss from a legitimate non-readiness exit"
      // into this JOURNEY list — a finding whose cause is a DARK TRACE, not a
      // broken journey, and one of the messages that made the 101-run headline
      // false. `assertContinuityJudgeable` raises it into the PROVENANCE class
      // instead. The hole it closed stays closed: the turn is still never
      // silently passed, and BOTH halves are pinned by a test (the provenance
      // function must SPEAK and this function must stay SILENT), so deleting
      // the new check cannot quietly reopen it.
      const laterExit = later.body?._diagnostic_trace?.exit_path;
      if (typeof laterExit === "string" && READINESS_PRODUCING_EXIT_PATHS.has(laterExit)) {
        // ⚠⚠ THIS MESSAGE HAS NOW BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS, AND
        // THAT IS WHY IT NOW NAMES CANDIDATES INSTEAD OF A CAUSE.
        //
        // v1 said "the model did not survive the turn" — pointing at
        // DRAFTING/PERSISTENCE. A diagnosis lane went there; that seam was
        // healthy.
        // v2 said the failure is "in that READ or that PROJECTION". Also wrong,
        // and wrong while the message's own printed fields disproved it: on the
        // measured failures the read returned the committed model (identical
        // `graph_hash`) and the projection SUCCEEDED, finding a goal and four
        // options. It was overwritten AFTERWARDS, by the analyse-refusal arm —
        // a THIRD seam neither version named.
        //
        // ⭐ THE RULE THIS ENCODES: an alarm may state what it OBSERVED with
        // confidence and must not state a CAUSE it cannot observe. A confident
        // wrong seam is worse than no seam, because it is acted on. Enumerate
        // every seam consistent with the evidence, in the order the payload
        // itself discriminates them, and let the printed fields decide — the
        // one thing an alarm must never do is disagree with its own data on its
        // own line.
        f.push(
          `${later.label}: analysis_ready.options was empty on exit_path=${laterExit}, which ` +
            `DOES produce readiness, after the model was drafted on ${drafting.label} — ` +
            `this turn PUT NO COMPARABLE OPTIONS ON THE WIRE. That is an OBSERVATION about ` +
            `the payload, not yet a cause: a follow-up turn re-reads the persisted graph and ` +
            `re-projects readiness from it, so at least three seams can produce it and the ` +
            `fields below tell them apart. ` +
            `(a) OVERWRITTEN AFTER A GOOD PROJECTION — the analyse-refusal arm replaces the ` +
            `structural payload it just built (turn-executor.ts, the ANALYSE_HANDLER_ID branch ` +
            `→ buildAnalysisRefusalReadiness). TELL: blocked_reason present with ` +
            `readiness_issues ABSENT, and freshness "unknown". This was the measured cause on ` +
            `18 Aug 2026 and the read and the projection were both healthy. ` +
            `(b) THE PROJECTION FOUND NOTHING — analysis-ready-helper's no-semantic fallback. ` +
            `TELL: readiness_issues PRESENT (it always sets them). ` +
            `(c) THE READ RETURNED SOMETHING ELSE — stale, empty or foreign persisted state. ` +
            `TELL: graph_hash DIFFERS between the two turns; equal hashes RULE THIS OUT. ` +
            `Read these first: [${drafting.label}] ${readinessDiagnosis(drafting.body)} | ` +
            `[${later.label}] ${readinessDiagnosis(later.body)}. ` +
            `Do not conclude past what these fields support.`,
        );
      }
      continue;
    }
    const missing = draftedIds.filter((id) => !laterIds.includes(id));
    if (missing.length > 0) {
      f.push(
        `${later.label}: analysis_ready.options no longer identifies the model drafted on ` +
          `${drafting.label} — missing option_id(s): ${missing.join(",")}. The product is ` +
          `describing a different set of options than the one it built.`,
      );
    }
  }

  return f;
}

/**
 * PROVENANCE — every turn must be able to say WHICH BUILD and WHICH PATH
 * served it.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT WHERE IT USED TO BE.
 * ------------------------------------------------------
 * `exit_path` was asserted in `assertHealthyFrame` — on TURN 1 ONLY, and in the
 * same flat list as `assistant_text was empty`. So the check answered two
 * different questions ("is the product working?" and "can we prove what ran?")
 * under one name, which is precisely the two-concepts-one-predicate defect the
 * rest of this file was rewritten to remove (see `carriedDraftGraph`). It is
 * also why the 101-run verdict was false: a provenance finding printed under a
 * product headline.
 *
 * `build_sha` was NEVER asserted at all — only printed. That gap had already
 * been argued against IN THIS FILE and then not closed: the turn-2 log comment
 * records that Render made a rolled-back parent build live mid-window on
 * 17 Aug 2026 (two merges 14s apart, the parent's deploy finishing last), so
 * "Phase 1 confirmed the build at the start of the run" is NOT evidence about
 * which build answered a given turn. A per-turn stamp that is printed and never
 * checked cannot fail; a null one produced no finding across all 101 runs.
 *
 * @param {Array<{label: string, d: {build_sha: string|null, exit_path: string|null}|null}>} turns
 * @returns {string[]} failure messages; empty means the trace is observable.
 */
export function assertTraceObservability(turns) {
  const f = [];
  for (const t of turns) {
    const d = t?.d;
    if (!d) continue;
    if (typeof d.exit_path !== "string" || d.exit_path.length === 0) {
      f.push(
        `${t.label}: _diagnostic_trace.exit_path is absent — this turn cannot say WHICH PATH served it, ` +
          `so no finding about it can be attributed to a seam, and the draft_graph_error check cannot fire ` +
          `at all.`,
      );
    }
    if (typeof d.build_sha !== "string" || d.build_sha.length === 0) {
      f.push(
        `${t.label}: _diagnostic_trace.environment.build_sha is absent — this turn cannot say WHICH BUILD ` +
          `answered it. Phase 1 confirms the served build at the START of the run, and Render has made a ` +
          `rolled-back parent build live mid-window before (17 Aug 2026), so that is not evidence about ` +
          `the build that served THIS turn.`,
      );
    }
  }
  return f;
}

/**
 * PROVENANCE — the continuity check could not be PERFORMED, because the trace
 * is dark.
 *
 * A post-drafting turn carrying no usable `option_id`s is a LOSS only where
 * readiness is produced, and `exit_path` is the only thing that tells those
 * apart. Without it the gate can neither assert the loss (that would be a
 * fabrication) nor pass the turn (that is the silent-disable this whole file
 * exists to prevent). So it says what is actually true: the check did not run.
 *
 * This is not a journey failure. The product may have behaved perfectly; the
 * gate simply cannot see well enough to judge. Reporting it as a broken journey
 * is the false headline that printed 101 times.
 *
 * @returns {string[]} failure messages; empty means every later turn was
 *   classifiable (or there was nothing to bind, which `assertHealthyJourney`
 *   already judges).
 */
export function assertContinuityJudgeable(frameBody, followUpBody) {
  const f = [];
  const turns = [
    { label: "turn 1", body: frameBody },
    { label: "turn 2", body: followUpBody },
  ];
  const draftIdx = turns.findLastIndex((t) => carriedDraftGraph(t.body));
  // No model at all is a DELIVERY failure — a journey finding, judged there.
  if (draftIdx === -1) return f;
  const drafting = turns[draftIdx];
  // Nothing to bind to is an unbindable-continuity finding, judged there too.
  // Adding a second message here would be the duplicate-predicate defect.
  if (readyOptionIds(drafting.body).length === 0) return f;

  for (const later of turns.slice(draftIdx + 1)) {
    if (readyOptionIds(later.body).length > 0) continue;
    const laterExit = later.body?._diagnostic_trace?.exit_path;
    if (typeof laterExit === "string" && laterExit.length > 0) continue;
    f.push(
      `${later.label}: analysis_ready.options is empty AND _diagnostic_trace.exit_path is absent — the ` +
        `gate cannot tell a real loss of the drafted model from a legitimate non-readiness exit, so THE ` +
        `CONTINUITY CHECK WAS NOT PERFORMED on this turn. An unclassifiable turn is not a pass.`,
    );
  }
  return f;
}

/**
 * The deployed service's OWN report of whether the trace is switched on.
 *
 * Phase 1 already polls `/healthz` on every run. Reading the posture there is
 * what turns "the trace is absent" from an INFERENCE into an OBSERVATION, and
 * it is what lets this alarm discriminate the two seams that produce an
 * identical payload:
 *   · the flag is OFF   → a DEPLOY-CONFIG regression (dashboard-only; nothing
 *                         in this repo changed, and nothing in it can);
 *   · the flag is ON    → a CODE regression in the trace itself.
 * Naming one of them without evidence would be the confident-wrong-cause defect
 * the continuity message above was rewritten to remove.
 *
 * ABSENT IS NEVER REPORTED AS OFF. A build that predates the `/healthz` field
 * cannot speak to the posture, and collapsing "this build does not say" into
 * "it is off" is the same two-facts-one-symbol defect `graphLine` and
 * `readinessDiagnosis` carry headers about. A non-boolean is equally
 * unreportable — the field is a boolean by contract, asserted at the endpoint.
 *
 * @returns {"on"|"off"|"not-reported"}
 */
export function readTracePosture(healthBody) {
  const v = healthBody?.diagnostic_trace_enabled;
  if (v === true) return "on";
  if (v === false) return "off";
  return "not-reported";
}

/**
 * ⭐⭐ WHAT THIS ALARM'S RED ACTUALLY MEANS — and the claim it must stop making.
 *
 * The verdict used to close with "Do not merge over this." That sentence reads
 * as a merge gate. IT IS NOT ONE, and it never was:
 *
 *   · `staging` branch protection requires exactly one context —
 *     "Lint, TypeCheck, Unit Tests". This check is NOT in that list.
 *   · This workflow triggers on `push: branches: [staging]` and
 *     `workflow_dispatch` ONLY. There is no `pull_request` trigger, so it never
 *     reports on a PR head — which is what a required status check is matched
 *     against. Requiring it as written would not tighten anything; it would
 *     block every merge forever on a status that never arrives.
 *   · And it CANNOT simply be moved to `pull_request`: Phase 1 polls /healthz
 *     until the DEPLOYED build matches this commit, and a PR head is never
 *     deployed to staging. It would time out on every PR.
 *
 * So this is a POST-MERGE DEPLOY VERIFICATION, structurally incapable of
 * gating a merge — by construction, not by neglect. The code is already live
 * when it speaks.
 *
 * ⭐ WHY THAT MATTERS MORE THAN IT LOOKS. An alarm that claims an authority it
 * does not have teaches readers to discount it. When "Do not merge over this"
 * is visibly not enforced — and it cannot be — the reasonable inference is that
 * the whole message is theatre, and the next true thing it says is discounted
 * too. That is the mechanism, alongside the false headline, by which 125
 * commits landed over 101 consecutive red runs across 5 days 3 hours
 * (26–31 Aug 2026) with nobody treating a single one as a violation.
 *
 * The fix is not to make it required (impossible as written) and not to soften
 * it (the regression is real). It is to say what is TRUE: this blocks nothing,
 * the build is already deployed, and responding to it is a PERSON's job.
 *
 * The dated figures above are a RECORD of one measured episode, not a live
 * counter — a hand-maintained number here would drift the moment it was
 * written (trap 12). The structural claims are pinned by a test that derives
 * the workflow's triggers from the YAML, so if this ever DOES become a
 * pre-merge gate, that test reds and this text must change with it.
 */
const AUTHORITY_LINE =
  "⚠ THIS ALARM BLOCKS NOTHING, AND SAYING OTHERWISE IS HOW IT GOT IGNORED. It is not a required " +
  'status check (staging requires only "Lint, TypeCheck, Unit Tests") and it runs on PUSH TO STAGING — ' +
  "after the merge, against a build that is ALREADY DEPLOYED. There is no merge to withhold. The next " +
  "merge will ship over this red exactly as the last one did, because nothing here stops it. Responding " +
  "to this is a PERSON's job: fix it, or say out loud that it is being accepted and why. (Measured once: " +
  "125 commits landed over a 101-run red streak, 26–31 Aug 2026.)";

/** What the alarm says about WHY the trace is dark, per observed posture. */
const POSTURE_LINES = {
  off:
    `The deployed service reports diagnostic_trace_enabled=false on /healthz, so ${TRACE_FLAG} is OFF on ` +
    `this deploy. That makes this a DEPLOY-CONFIG regression, not a code one: the trace works and was ` +
    `switched off. The flag is DASHBOARD-ONLY — it appears in neither render.yaml nor render-staging.yaml ` +
    `— so it can be turned off with nothing in this repository changing, and nothing in this repository ` +
    `can turn it back on. Fix it on the Render dashboard for the staging service.`,
  on:
    `The deployed service reports diagnostic_trace_enabled=true on /healthz, so ${TRACE_FLAG} is ON and the ` +
    `trace is missing anyway. That makes this a CODE regression in the trace itself — look at the trace ` +
    `builder and the response-envelope egress seam, not at the Render dashboard.`,
  "not-reported":
    `This build's /healthz does not report diagnostic_trace_enabled, so the gate cannot tell a switched-off ` +
    `${TRACE_FLAG} (dashboard-only: it appears in neither render.yaml nor render-staging.yaml) apart from a ` +
    `code regression in the trace. Check the flag on the Render dashboard for the staging service FIRST, ` +
    `then the trace builder.`,
};

/**
 * THE VERDICT. Pure, so the one thing this gate is READ FOR is unit-testable —
 * the CLI around it deliberately is not (there is no fixture mode; it always
 * drives real HTTP).
 *
 * The headline must describe what actually failed. For 101 runs it did not, and
 * that is the entire defect this function exists to close. Both classes still
 * exit non-zero: this separates the message, never the severity.
 *
 * @param {{journeyFailures?: string[], provenanceFailures?: string[],
 *          tracePosture?: "on"|"off"|"not-reported"}} input
 * @returns {{exitCode: number, lines: string[]}}
 */
export function buildVerdict({ journeyFailures = [], provenanceFailures = [], tracePosture = "not-reported" } = {}) {
  const lines = [];
  const journeyBroken = journeyFailures.length > 0;
  const provenanceDark = provenanceFailures.length > 0;

  if (!journeyBroken && !provenanceDark) {
    lines.push(
      "PASS — a user can frame a decision and get a usable graph, and the trace proves which build, which " +
        "path and which prompt served it.",
    );
    return { exitCode: 0, lines };
  }

  if (journeyBroken) {
    // ⚠ WORDED FOR EVERY FINDING ROUTED HERE, NOT JUST THE JOURNEY ONES. The
    // `DEPLOY DID NOT SHIP` failure also lands in this bucket, and on that path
    // NO TURN WAS DRIVEN — so a headline asserting "a user did not get what
    // they were promised" would be the same class of false statement this whole
    // change exists to remove, one case narrower. The headline names the HALF
    // that is red; the ✗ lines name what.
    lines.push(
      `${VERDICT_JOURNEY_BROKEN} — ${journeyFailures.length} problem(s). The PRODUCT half of this gate is ` +
        `red: either the journey assertions failed, or the deploy-freshness precondition they rest on did.`,
    );
    for (const m of journeyFailures) lines.push(`  ✗ ${m}`);
  }

  if (provenanceDark) {
    if (journeyBroken) lines.push("");
    lines.push(
      `${VERDICT_PROVENANCE_DARK} — ${provenanceFailures.length} problem(s). The run cannot prove WHAT ran.`,
    );
    for (const m of provenanceFailures) lines.push(`  ✗ ${m}`);
    lines.push(
      journeyBroken
        ? `  → The product half ALSO failed and is reported above as ${VERDICT_JOURNEY_BROKEN}. The two ` +
            `classes are independent: neither explains the other, and fixing one will not clear the other.`
        : `  → The journey's PRODUCT assertions PASSED. A user framed a decision and left holding a usable ` +
            `model — this is not a product outage. What is dark is the PROVENANCE of it: this run cannot ` +
            `say which build answered, which path served the turn, or which prompt produced the graph.`,
    );
    lines.push(`  → ${POSTURE_LINES[tracePosture] ?? POSTURE_LINES["not-reported"]}`);
    lines.push(
      `  → CONSEQUENCE FOR EVERY DOWNSTREAM CLAIM: any "witnessed on staging" claim resting on this run is ` +
        `UNSUPPORTED ON PROVENANCE GROUNDS. The journey may have run perfectly; the run cannot prove what ` +
        `ran, so it is not a witness of anything. Do not record it as one.`,
    );
  }

  lines.push("");
  if (journeyBroken) {
    lines.push("The PRODUCT half of this gate is RED against the deployed staging build.");
  } else {
    lines.push(
      "The live user journey RAN and its product assertions PASSED. What is broken is the ability to PROVE " +
        "what ran — a real regression, not a softer one, and this build is not witnessed on staging.",
    );
  }
  lines.push(AUTHORITY_LINE);
  return { exitCode: 1, lines };
}

/**
 * THE PRODUCT MUST NOT ANSWER A CONVERSATIONAL TURN WITH AN ANALYSIS REFUSAL.
 *
 * ⭐⭐ WHY THIS EXISTS, AND WHY IT IS DELIBERATELY NOT KEYED ON `options`.
 *
 * The 18 Aug 2026 P0 had TWO defects stacked on one turn, and only one of them
 * is being fixed:
 *
 *   1. the turn ROUTED TO THE ANALYSE HANDLER although the user asked it to
 *      "draft the model now" — nobody requested an analysis; and
 *   2. the resulting refusal ERASED the model's identity from `analysis_ready`.
 *
 * The fix for (2) makes `options` non-empty again, so the continuity check
 * above — the only thing that has ever caught this turn — goes GREEN. **The
 * mis-routing then becomes unobservable**: a real, unfixed defect with no alarm
 * over it, on a build where CI is entirely green. That is the sharpest form of
 * the "a fix validated against the symptom's metric kills the symptom and
 * leaves the defect alive" trap, because here the fix also removes the
 * instrument that was measuring the residual.
 *
 * So this assertion keys on `blocked_reason`, which the fix PRESERVES, rather
 * than on `options`, which the fix repopulates. It is orthogonal to the fix by
 * construction and survives it.
 *
 * ⭐ THE PREDICATE IS DERIVED FROM THE PRODUCER, not from the observed payloads
 * (P7). `src/orchestrator/types.ts:595` declares `blocked_reason` is *"written
 * ONLY by `buildAnalysisRefusalReadiness`"*, and that function is called from
 * exactly two sites, both of them the analyse-refusal arm. So a non-empty
 * `blocked_reason` IS the turn declaring "I declined to analyse" — it is not a
 * proxy for it, and no other producer can set it.
 *
 * ⭐ "THE USER DID NOT ASK TO ANALYSE" IS DECLARED BY THE CALLER, NEVER INFERRED
 * FROM THE RESPONSE. This gate is the user: it composes every message it sends,
 * so it KNOWS which turns requested an analysis. Deriving that intent back out
 * of the reply would be circular — the reply is the thing under test. Each turn
 * therefore carries an explicit `requestedAnalysis` flag, and only turns
 * declared `false` are judged.
 *
 * NOTE WHAT THIS IS SILENT ABOUT, deliberately. A turn that runs an unrequested
 * analysis and SUCCEEDS emits no `blocked_reason` and is not flagged here.
 * Measured on the same sampling batch: 2 of 6 passing runs had turn 2 report
 * `freshness="fresh"/"graph_hash_match"`, which on a two-turn journey with no
 * prior analysis can only mean a run_analysis fact was produced ON THAT TURN.
 * So the mis-routing is materially more common than the refusals alone reveal.
 * That is recorded in the diagnosis line (freshness is printed on every turn)
 * rather than asserted, because an analysis on a follow-up turn is legitimate
 * in other journeys and firing on it here would be a false alarm — and false
 * alarms are how this estate loses real ones.
 *
 * @param {Array<{label: string, body: unknown, requestedAnalysis: boolean}>} turns
 * @returns {string[]} failure messages; empty means healthy.
 */
export function assertNoUnrequestedAnalysisRefusal(turns) {
  const f = [];
  for (const t of turns) {
    if (t.requestedAnalysis) continue;
    const reason = t.body?.analysis_ready?.blocked_reason;
    if (typeof reason !== "string" || reason.trim().length === 0) continue;
    f.push(
      `${t.label}: the product answered a CONVERSATIONAL turn with an ANALYSIS REFUSAL ` +
        `(analysis_ready.blocked_reason="${reason}") — this turn never asked for an analysis. ` +
        `Only the analyse-refusal arm writes blocked_reason, so the turn routed to the analyse ` +
        `handler, ran the readiness gate, and declined. The user asked for something else and ` +
        `got a refusal to do a thing they did not request. ` +
        `This is a ROUTING defect and it is NOT fixed by making the refusal payload honest: ` +
        `that fix restores analysis_ready.options, which turns the continuity check above ` +
        `green while leaving this turn just as wrong. ` +
        `Readiness on this turn: ${readinessDiagnosis(t.body)}`,
    );
  }
  return f;
}

/**
 * A turn that produced a graph must prove WHICH prompt produced it.
 *
 * THE ROOT CAUSE OF THE P0 SURVIVED INSIDE ITS OWN FIX. The original check was
 * inline in `report()` and keyed on TURN 2's exit_path, so #1002 moved the
 * drafting turn out from under it. The fix removed the TURN half and kept the
 * EXIT_PATH half — leaving the gate with TWO predicates for the single concept
 * "this turn drafted": delivery/usability read `draft_graph` PRESENCE while
 * provenance read `exit_path === "draft_graph"`. So the identical silent loss
 * recurs the next time the drafting event is relabelled, which is exactly the
 * change #1002 made.
 *
 * It is reachable today, not hypothetically: `draft_graph` is genuinely emitted
 * under other exits by `applied-graph-emit.ts`'s `n()`, called from four
 * turn-executor sites, `edit-graph-dispatch.ts` and `system-events/dispatch.ts`.
 * Measured at fd148826: a turn carrying a `draft_graph` with
 * `exit_path: "edit_graph"` and an EMPTY `prompt_identity` produced NO failure.
 *
 * So the trigger is now DELIVERY — `carriedDraftGraph`, the same predicate
 * `assertHealthyJourney` uses — union the declared drafting exit, which stays
 * because a turn that says it drafted is making the same claim even if the
 * graph never reached the wire. An empty identity on a turn that neither
 * delivered nor declared a graph stays legitimate: the trace builder
 * deliberately does not fabricate one there.
 *
 * NO FALSE ALARM IS BOUGHT BY THIS, and the claim is checked rather than
 * asserted: the comment that justified the narrow scope said `prompt_identity`
 * is EXPECTED to be `[]` on the minimal-trace exits including `turn_executor` —
 * and this PR's own turn-2 fixture is `turn_executor` carrying
 * `prompt_identity_count = 1`. Pinned by a test.
 *
 * @param {Array<{exit_path: string|null, prompt_identity_count: number}|null>} diagnostics
 * @param {unknown[]} [bodies] the same turns' response bodies, index-aligned with
 *   `diagnostics`. Omitted only by callers that have no bodies (the deploy-
 *   freshness early exit drove no turns), in which case delivery cannot be
 *   observed and only the declared-exit arm applies.
 * @returns {string[]} failure messages; empty means healthy.
 */
export function assertPromptProvenance(diagnostics, bodies = []) {
  const f = [];
  diagnostics.forEach((d, i) => {
    if (!d) return;
    const delivered = carriedDraftGraph(bodies[i]);
    const declared = d.exit_path === DRAFT_EXIT_PATH;
    if (!delivered && !declared) return;
    if (d.prompt_identity_count !== 0) return;
    const how = delivered
      ? `carried a draft_graph (exit_path=${d.exit_path ?? "?"})`
      : `exit_path=${DRAFT_EXIT_PATH}`;
    f.push(
      `turn ${i + 1}: this turn produced a graph — it ${how} — but prompt_identity was empty: ` +
        "the served prompt version/hash did not reach the trace, so we cannot prove WHICH " +
        "prompt produced this graph.",
    );
  });
  return f;
}

/** Extract the diagnostics we report on every run, healthy or not. */
export function extractDiagnostics(body) {
  const t = body?._diagnostic_trace ?? {};
  const identity = Array.isArray(t.prompt_identity) ? t.prompt_identity : [];
  return {
    build_sha: t?.environment?.build_sha ?? null,
    exit_path: t?.exit_path ?? null,
    prompt_identity_count: identity.length,
    prompt_identity: identity.map((p) => `${p?.task_id}=${p?.version}#${String(p?.hash ?? "").slice(0, 8)}`),
  };
}

/* ------------------------------------------------------------------ */
/* CLI — real HTTP only.                                               */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

function uuid() {
  return globalThis.crypto.randomUUID();
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

/**
 * Describe the model on a turn, UNAMBIGUOUSLY.
 *
 * The old line printed `nodes=${body?.draft_graph?.nodes?.length ?? 0}` beside
 * `options=${body?.analysis_ready?.options.length}`. Those read two DIFFERENT
 * top-level blocks with different lifecycles, and the `?? 0` collapsed "there is
 * no draft_graph block on this turn" into the same "0" as "the graph is empty".
 * On the 17 Aug failure that printed `nodes=0 options=4`, which reads as an
 * incoherent payload — four options with no nodes — and cost real diagnosis time
 * chasing a graph corruption that never existed. An alarm must never make its
 * own observation ambiguous.
 */
function graphLine(body) {
  const g = body?.draft_graph;
  const opts = Array.isArray(body?.analysis_ready?.options) ? body.analysis_ready.options.length : "absent";
  const graph =
    g && typeof g === "object"
      ? `draft_graph=present nodes=${Array.isArray(g.nodes) ? g.nodes.length : "?"}`
      : "draft_graph=absent(no-block)";
  return `${graph} analysis_ready.options=${opts}`;
}

async function postTurn(base, key, payload, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${base}/orchestrate/v2/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Olumi-Assist-Key": key },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { __unparseable: text.slice(0, 500) };
    }
    return { status: res.status, body, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PHASE 1. Poll /healthz until the served build matches `expectSha`.
 * Returns {ok, served, waitedMs}. Never throws on a bad build — the caller
 * decides, so the failure message stays in one place.
 */
async function waitForBuild(base, expectSha, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const want = expectSha.slice(0, 7);
  let served = null;
  let health = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(20000) });
      const body = await res.json();
      // Carry the WHOLE body out, not just `build`. The trace posture the
      // failure message needs is on this same response, and re-fetching it
      // later would be a second observation of a service that can change
      // between them.
      health = body ?? null;
      served = body?.build ?? null;
      if (served && served.slice(0, 7) === want) {
        return { ok: true, served, health, waitedMs: timeoutMs - (deadline - Date.now()), attempt };
      }
      log(`  [freshness] attempt ${attempt}: serving ${served ?? "?"}, want ${want} — waiting…`);
    } catch (e) {
      log(`  [freshness] attempt ${attempt}: /healthz unreachable (${e.name}) — waiting…`);
    }
    // Never sleep PAST the deadline. A fixed 15s wait on the final iteration
    // burns up to 15s of job time after the poll has already given up. The
    // 15s interval itself is deliberately kept — ~60 healthz GETs over 15
    // minutes is negligible load and needs no backoff.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(15000, remaining)));
  }
  return { ok: false, served, health, waitedMs: timeoutMs, attempt };
}

/**
 * One /healthz read, for the path where Phase 1 is skipped (no SMOKE_EXPECT_SHA
 * — never the case in CI, where the workflow always passes `github.sha`).
 * Returns null rather than throwing: an unreachable /healthz here means the
 * posture is UNOBSERVED, which `readTracePosture` reports as "not-reported"
 * rather than inventing an "off".
 */
async function fetchHealth(base) {
  try {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(20000) });
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const base = (process.env.SMOKE_BASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SMOKE_API_KEY ?? "";
  const expectSha = process.env.SMOKE_EXPECT_SHA ?? "";
  const freshnessTimeout = Number(process.env.SMOKE_FRESHNESS_TIMEOUT_MS ?? 900000);
  const turnTimeout = Number(process.env.SMOKE_TURN_TIMEOUT_MS ?? 180000);

  if (!base || !key) {
    log("FATAL: SMOKE_BASE_URL and SMOKE_API_KEY are required.");
    // Fail closed. A missing secret must never read as a pass.
    process.exit(2);
  }
  if (/olumi-assistants-service\.onrender\.com/.test(base)) {
    log(`FATAL: refusing to run against production (${base}). This gate targets staging.`);
    process.exit(2);
  }

  log(`# CEE staging live-journey smoke`);
  log(`target: ${base}`);

  // TWO BUCKETS, NOT ONE LIST. A finding's class is decided by the CHECK that
  // produced it, at the call site, where the class is known. There is no
  // message→class table anywhere in this file: that would be a hand-maintained
  // mirror (trap 12) and would misclassify the first message anyone reworded.
  const journeyFailures = [];
  const provenanceFailures = [];
  let health = null;

  // ---- PHASE 1: did the build ship? ----
  if (expectSha) {
    log(`\n## Phase 1 — deploy freshness (want ${expectSha.slice(0, 7)})`);
    const fresh = await waitForBuild(base, expectSha, freshnessTimeout);
    health = fresh.health;
    if (!fresh.ok) {
      journeyFailures.push(
        `DEPLOY DID NOT SHIP: after ${Math.round(fresh.waitedMs / 1000)}s, ${base} is still serving ` +
          `build "${fresh.served ?? "unreachable"}" but this commit is ${expectSha.slice(0, 7)}. ` +
          `The deploy failed or never fired — staging is running older code than the branch tip.`,
      );
      // Do NOT run the journey: it would test the wrong build and a pass would be a lie.
      // No turns were driven, so there are no diagnostics and no bodies.
      report(journeyFailures, provenanceFailures, [], health);
      return;
    }
    log(`  OK — serving ${fresh.served} after ${Math.round(fresh.waitedMs / 1000)}s`);
  } else {
    log(`\n## Phase 1 — SKIPPED (no SMOKE_EXPECT_SHA); journey will run against whatever is deployed`);
    health = await fetchHealth(base);
  }
  // Print the posture on EVERY run, healthy or not. A diagnostic emitted only
  // on failure gives you nothing to compare a failure against — the lesson the
  // 18 Aug intermittent taught this file, applied to the flag that then went
  // dark for five days.
  log(`  [posture] ${TRACE_FLAG} per /healthz: ${readTracePosture(health)}`);

  // ---- PHASE 2: the journey ----
  const scenarioId = uuid();
  log(`\n## Phase 2 — journey (scenario_id ${scenarioId})`);

  log(`\n### Turn 1 — frame`);
  const t1 = await postTurn(
    base,
    key,
    {
      kind: "message",
      turn_id: uuid(),
      scenario_id: scenarioId,
      stage: "frame",
      turn_class: "frame",
      source: "composer",
      message: "Should we open a second bakery location in Leeds next quarter?",
    },
    turnTimeout,
  );
  const d1 = extractDiagnostics(t1.body);
  log(
    `  HTTP ${t1.status} in ${(t1.ms / 1000).toFixed(1)}s | exit_path=${d1.exit_path} | ` +
      `build_sha=${d1.build_sha} | ${graphLine(t1.body)}`,
  );
  // Printed on EVERY run, healthy or not — a diagnostic only emitted on failure
  // gives you nothing to compare the failure against, which is precisely why
  // the 18 Aug intermittent had no discriminator: the passing runs, of which
  // there were eight, carried the answer and never printed it.
  log(`    ${draftGraphCensus(t1.body)}`);
  log(`    readiness: ${readinessDiagnosis(t1.body)}`);
  if (t1.status !== 200) journeyFailures.push(`turn 1: HTTP ${t1.status} (expected 200)`);
  journeyFailures.push(...assertHealthyFrame(t1.body));

  log(`\n### Turn 2 — draft (accept defaults)`);
  const t2 = await postTurn(
    base,
    key,
    {
      kind: "message",
      turn_id: uuid(),
      scenario_id: scenarioId,
      stage: "frame",
      turn_class: "propose",
      source: "composer",
      message: "Use your best guess for the rest and draft the model now.",
    },
    turnTimeout,
  );
  const d2 = extractDiagnostics(t2.body);
  // build_sha is stamped PER TURN, not once per run. Render made a rolled-back
  // parent build live mid-window on 17 Aug 2026 (two merges 14s apart, the
  // parent's deploy finishing last), so "the run confirmed the build at the
  // start" is not evidence about which build answered a given turn.
  log(
    `  HTTP ${t2.status} in ${(t2.ms / 1000).toFixed(1)}s | exit_path=${d2.exit_path} | ` +
      `build_sha=${d2.build_sha} | ${graphLine(t2.body)}`,
  );
  log(`    ${draftGraphCensus(t2.body)}`);
  log(`    readiness: ${readinessDiagnosis(t2.body)}`);
  if (t2.status !== 200) journeyFailures.push(`turn 2: HTTP ${t2.status} (expected 200)`);

  // Assert over the JOURNEY, not over turn 2. See assertHealthyJourney.
  journeyFailures.push(...assertHealthyJourney(t1.body, t2.body));

  // PROVENANCE, kept apart at the call site. `assertContinuityJudgeable` covers
  // the one finding `assertHealthyJourney` used to raise whose cause is a dark
  // trace rather than a broken product; `assertTraceObservability` covers the
  // per-turn exit_path/build_sha stamps for BOTH turns (it used to be turn 1's
  // exit_path only, inside a product check).
  provenanceFailures.push(...assertContinuityJudgeable(t1.body, t2.body));

  // NEITHER TURN ASKED FOR AN ANALYSIS, and both messages are literals a few
  // lines above — turn 1 frames a decision, turn 2 says "draft the model now".
  // The intent is DECLARED here, at the only place that knows it, rather than
  // inferred from the reply under test. If a future turn is added that DOES
  // request one, it declares `requestedAnalysis: true` and is skipped; there is
  // no heuristic to get wrong.
  journeyFailures.push(
    ...assertNoUnrequestedAnalysisRefusal([
      { label: "turn 1", body: t1.body, requestedAnalysis: false },
      { label: "turn 2", body: t2.body, requestedAnalysis: false },
    ]),
  );

  report(
    journeyFailures,
    provenanceFailures,
    [
      { label: "turn 1", d: d1, body: t1.body },
      { label: "turn 2", d: d2, body: t2.body },
    ],
    health,
  );
}

function report(journeyFailures, provenanceFailures, turns, health) {
  log(`\n## Diagnostics`);
  for (const t of turns) {
    if (!t.d) continue;
    log(
      `  ${t.label}: build_sha=${t.d.build_sha} exit_path=${t.d.exit_path} ` +
        `prompt_identity=${t.d.prompt_identity_count}`,
    );
    if (t.d.prompt_identity.length) log(`    prompt_identity: ${t.d.prompt_identity.join(", ")}`);
  }
  // Provenance is keyed on graph DELIVERY, so the bodies travel with the
  // diagnostics. The comment that used to sit here claimed prompt_identity is
  // EXPECTED to be [] on the minimal-trace exits "(clarify_v2, turn_executor,
  // chip_click)" and used that to justify keying only on `exit_path`. This PR's
  // OWN turn-2 fixture refutes it: `turn_executor` with prompt_identity_count=1.
  // What is actually true: a turn that neither delivered nor declared a graph
  // makes no claim about a prompt, so an empty identity there is legitimate;
  // every turn that DID produce a graph must prove which prompt produced it,
  // on whichever exit path served it.
  const turnDiagnostics = turns.map((t) => t.d);
  const turnBodies = turns.map((t) => t.body);
  provenanceFailures.push(...assertPromptProvenance(turnDiagnostics, turnBodies));
  provenanceFailures.push(...assertTraceObservability(turns));

  // The verdict is BUILT, not composed here, so the headline cannot drift from
  // the buckets it is describing — the drift that made 101 red runs say the
  // opposite of what they had measured.
  const verdict = buildVerdict({
    journeyFailures,
    provenanceFailures,
    tracePosture: readTracePosture(health),
  });
  log(`\n## Result`);
  for (const line of verdict.lines) log(line);
  process.exit(verdict.exitCode);
}

if (isMain) {
  main().catch((e) => {
    log(`\nFAIL — smoke gate threw: ${e?.stack ?? e}`);
    process.exit(1);
  });
}
