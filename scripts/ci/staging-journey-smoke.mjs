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
 * Assert turn 2 (draft) returned a USABLE graph, not merely a 200.
 * @returns {string[]} failure messages; empty means healthy.
 */
export function assertHealthyDraft(body) {
  const f = [];
  if (!body || typeof body !== "object") return ["turn 2: response body was not a JSON object"];

  const exit = body?._diagnostic_trace?.exit_path;
  if (exit === "draft_graph_error") {
    // Surface the real reason — this is the message an on-call engineer reads first.
    const d = body.details ?? {};
    f.push(
      `turn 2: exit_path=draft_graph_error` +
        (d.violation_code ? ` violation_code=${d.violation_code}` : "") +
        (d.reason ? ` reason=${d.reason}` : ""),
    );
  }

  const g = body.draft_graph;
  if (!g || typeof g !== "object") {
    f.push("turn 2: no draft_graph on the response — the user got no model back");
    return f;
  }

  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  if (nodes.length < MIN_NODES) {
    f.push(`turn 2: draft_graph.nodes=${nodes.length}, expected >= ${MIN_NODES} (graph too trivial to be usable)`);
  }

  // Options live in two places; require BOTH to be coherent. The graph needs
  // option NODES for connectivity, and analysis_ready.options carries the
  // intervention metadata the analysis actually compares.
  const optionNodes = nodes.filter((n) => n && n.kind === OPTION_KIND);
  if (optionNodes.length < MIN_OPTIONS) {
    f.push(
      `turn 2: option nodes=${optionNodes.length}, expected >= ${MIN_OPTIONS} ` +
        `(nothing to compare — a decision needs alternatives)`,
    );
  }

  const readyOptions = Array.isArray(body?.analysis_ready?.options) ? body.analysis_ready.options : [];
  if (readyOptions.length < MIN_OPTIONS) {
    f.push(`turn 2: analysis_ready.options=${readyOptions.length}, expected >= ${MIN_OPTIONS}`);
  }

  // OPTIONS_IDENTICAL was the live defect: distinct ids, but nothing to tell
  // the options apart. Assert the ids are actually distinct.
  const ids = readyOptions.map((o) => o?.option_id).filter(Boolean);
  if (ids.length > 0 && new Set(ids).size !== ids.length) {
    f.push(`turn 2: analysis_ready.options contained duplicate option_id values: ${ids.join(",")}`);
  }

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
    await new Promise((r) => setTimeout(r, 15000));
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
      report(failures, null, null);
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
  log(`  HTTP ${t1.status} in ${(t1.ms / 1000).toFixed(1)}s | exit_path=${d1.exit_path} | build_sha=${d1.build_sha}`);
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
  const nodeCount = t2.body?.draft_graph?.nodes?.length ?? 0;
  const optCount = (t2.body?.analysis_ready?.options ?? []).length;
  log(
    `  HTTP ${t2.status} in ${(t2.ms / 1000).toFixed(1)}s | exit_path=${d2.exit_path} | ` +
      `nodes=${nodeCount} options=${optCount}`,
  );
  if (t2.status !== 200) failures.push(`turn 2: HTTP ${t2.status} (expected 200)`);
  failures.push(...assertHealthyDraft(t2.body));

  report(failures, d1, d2);
}

function report(failures, d1, d2) {
  log(`\n## Diagnostics`);
  for (const [label, d] of [
    ["turn 1", d1],
    ["turn 2", d2],
  ]) {
    if (!d) continue;
    log(`  ${label}: build_sha=${d.build_sha} exit_path=${d.exit_path} prompt_identity=${d.prompt_identity_count}`);
    if (d.prompt_identity.length) log(`    prompt_identity: ${d.prompt_identity.join(", ")}`);
  }
  // prompt_identity is EXPECTED to be [] on the minimal-trace exits (clarify_v2,
  // turn_executor, chip_click) — no prompt hash is captured there, and the trace
  // builder deliberately does not fabricate one. It is only a defect on a
  // SUCCESSFUL draft_graph exit, which is why this is asserted narrowly.
  if (d2 && d2.exit_path === "draft_graph" && d2.prompt_identity_count === 0) {
    failures.push(
      "turn 2: exit_path=draft_graph but prompt_identity was empty — the served prompt " +
        "version/hash did not reach the trace, so we cannot prove WHICH prompt produced this graph.",
    );
  }

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
