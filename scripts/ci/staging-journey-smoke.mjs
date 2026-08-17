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
 * Assert turn 1 (frame) produced a coherent response.
 * @returns {string[]} failure messages; empty means healthy.
 */
export function assertHealthyFrame(body) {
  const f = [];
  if (!body || typeof body !== "object") return ["turn 1: response body was not a JSON object"];
  if (typeof body.assistant_text !== "string" || body.assistant_text.trim().length === 0) {
    f.push("turn 1: assistant_text was empty — the user would see a blank reply");
  }
  const exit = body?._diagnostic_trace?.exit_path;
  if (typeof exit !== "string" || exit.length === 0) {
    f.push("turn 1: _diagnostic_trace.exit_path missing — cannot tell which path served this turn");
  }
  if (exit === "draft_graph_error") {
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
      const laterExit = later.body?._diagnostic_trace?.exit_path;
      if (typeof laterExit !== "string" || laterExit.length === 0) {
        f.push(
          `${later.label}: analysis_ready.options is empty AND _diagnostic_trace.exit_path is ` +
            `absent — the gate cannot tell a real loss from a legitimate non-readiness exit. ` +
            `Fix the trace: an unclassifiable turn is not a pass.`,
        );
      } else if (READINESS_PRODUCING_EXIT_PATHS.has(laterExit)) {
        f.push(
          `${later.label}: analysis_ready.options was empty on exit_path=${laterExit}, which ` +
            `DOES produce readiness, after the model was drafted on ${drafting.label} — ` +
            `the model did not survive the turn`,
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
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(20000) });
      const body = await res.json();
      served = body?.build ?? null;
      if (served && served.slice(0, 7) === want) {
        return { ok: true, served, waitedMs: timeoutMs - (deadline - Date.now()), attempt };
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
  return { ok: false, served, waitedMs: timeoutMs, attempt };
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

  const failures = [];

  // ---- PHASE 1: did the build ship? ----
  if (expectSha) {
    log(`\n## Phase 1 — deploy freshness (want ${expectSha.slice(0, 7)})`);
    const fresh = await waitForBuild(base, expectSha, freshnessTimeout);
    if (!fresh.ok) {
      failures.push(
        `DEPLOY DID NOT SHIP: after ${Math.round(fresh.waitedMs / 1000)}s, ${base} is still serving ` +
          `build "${fresh.served ?? "unreachable"}" but this commit is ${expectSha.slice(0, 7)}. ` +
          `The deploy failed or never fired — staging is running older code than the branch tip.`,
      );
      // Do NOT run the journey: it would test the wrong build and a pass would be a lie.
      // No turns were driven, so there are no diagnostics and no bodies.
      report(failures, []);
      return;
    }
    log(`  OK — serving ${fresh.served} after ${Math.round(fresh.waitedMs / 1000)}s`);
  } else {
    log(`\n## Phase 1 — SKIPPED (no SMOKE_EXPECT_SHA); journey will run against whatever is deployed`);
  }

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
  if (t1.status !== 200) failures.push(`turn 1: HTTP ${t1.status} (expected 200)`);
  failures.push(...assertHealthyFrame(t1.body));

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
  if (t2.status !== 200) failures.push(`turn 2: HTTP ${t2.status} (expected 200)`);

  // Assert over the JOURNEY, not over turn 2. See assertHealthyJourney.
  failures.push(...assertHealthyJourney(t1.body, t2.body));

  report(failures, [
    { label: "turn 1", d: d1, body: t1.body },
    { label: "turn 2", d: d2, body: t2.body },
  ]);
}

function report(failures, turns) {
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
  failures.push(...assertPromptProvenance(turnDiagnostics, turnBodies));

  log(`\n## Result`);
  if (failures.length === 0) {
    log(`PASS — a user can frame a decision and get a usable graph.`);
    process.exit(0);
  }
  log(`FAIL — ${failures.length} problem(s):`);
  for (const m of failures) log(`  ✗ ${m}`);
  log(`\nThe live user journey is broken on the deployed staging build. Do not merge over this.`);
  process.exit(1);
}

if (isMain) {
  main().catch((e) => {
    log(`\nFAIL — smoke gate threw: ${e?.stack ?? e}`);
    process.exit(1);
  });
}
