#!/usr/bin/env node
/**
 * SDL STATE-SPINE WITNESS — is the append_turn_atomic_v5 replay-before-CAS
 * defect REACHABLE FROM THE WIRE on the deployed staging service?
 *
 * ── THE DEFECT UNDER TEST ───────────────────────────────────────────────────
 * `append_turn_atomic_v5` (supabase/migrations/20260824200000_c8_atomic_model_
 * version_restore.sql) raises OLGC1 at :693 and only looks the turn up at :710.
 * So a replay of an ALREADY-COMMITTED turn is refused as stale whenever the
 * head has moved on since that commit. The fix migration
 * (20260920210000_v5_append_v5_replay_precedes_cas.sql) is in the repo and, per
 * its own header, NOT EXECUTED.
 *
 * ── WHAT THIS SCRIPT IS FOR, AND WHAT IT IS NOT ─────────────────────────────
 * Lane A owns the SQL-level proof. This script owns exactly one question:
 * can a WIRE CLIENT drive the deployed service into that raise? It therefore
 * NEVER calls the RPC directly and NEVER writes to the database. Every write it
 * makes is an ordinary `POST /orchestrate/v2/turn`, and every read is a
 * read-only PostgREST SELECT.
 *
 * ── THE ASSERTION RULE ──────────────────────────────────────────────────────
 * Every assertion reads a DB row or a wire JSON field. NOTHING asserts on
 * assistant prose. The semantic quality of the drafted model is irrelevant
 * here: the witness only needs A graph to exist and its identity hash to move.
 *
 * ── FLAGS (each capability runs independently) ──────────────────────────────
 *   --seed      create a fresh GUEST scenario from the FIXED brief constant
 *               below and record identity hash A. Asserts a graph persisted and
 *               `scenarios.graph_identity_hash` is non-null. Writes state.
 *   --read      read-only Supabase reads for the state file's scenario:
 *               scenarios / model_versions / v5_conversation_turns /
 *               v5_handler_facts / v5_turn_fence. Writes nothing.
 *   --mutate    send a graph-changing turn; record the wire
 *               `model_version_receipt` if any, and the new identity hash.
 *   --replay    re-POST a BYTE-IDENTICAL turn body (same turn_id) that already
 *               committed. The request bytes are replayed from the state file
 *               exactly as they were first sent.
 *   --move-head deterministic no-LLM head mover: a structural_delete
 *               system_event. Used as W3-A step 2 (a `message` turn cannot be
 *               relied on to change the graph — measured 2026-09-21).
 *   --stale     send a turn whose CLIENT-SUPPLIED base hash is the OLD hash
 *               after the head moved (the system_event consent guard). This is
 *               the CONTRAST CONTROL for "the wire cannot supply a stale base".
 *   --sysevent-w3a  the W3-A sequence run on system_event turns, the only
 *               family that commits under the INGRESS turn_id. No LLM spend.
 *   --race      the only wire-reachable trigger the code path allows: start the
 *               slow replay, then land a fast no-LLM head-moving system_event
 *               inside its LLM window, so the replay's server-read base goes
 *               stale between its read and its RPC.
 *   --w3a       seed -> mutate -> replay -> read, the full W3-A sequence.
 *   --report    write the markdown transcript.
 *   --scenario <uuid>   operate on an existing scenario id (skips --seed).
 *   --base-url <url>    default https://cee-staging.onrender.com
 *   --state <path>      default <evidence>/sdl-state-spine-state.json
 *   --out <path>        default <evidence>/W3A-live-witness.md
 *
 * ── ENV ─────────────────────────────────────────────────────────────────────
 *   SDL_API_KEY       value for the `x-olumi-assist-key` header (ASSIST_API_KEY
 *                     service-side / OLUMI_REPLAY_API_KEY harness-side).
 *   SDL_SUPABASE_URL  project URL for the read-only PostgREST reads.
 *   SDL_SUPABASE_KEY  service-role key (use the _NEW one).
 *   SDL_EXPECT_SHA    optional; when set, the served `build` must prefix-match
 *                     it or the run halts. The served build is RECORDED either
 *                     way, on every step.
 *
 * COST: each `message` turn spends a real LLM call on staging. A full --w3a is
 * three to four turns. `--stale` and the `--race` head-mover are system_events
 * and spend none.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/* ───────────────────────── constants ───────────────────────── */

/** The FIXED brief. Obviously synthetic; its semantic quality is irrelevant. */
const FIXED_BRIEF =
  "SDL state-spine witness, synthetic fixture. Should the Widget Depot test facility " +
  "switch its overnight packing line from Supplier Alpha to Supplier Beta next quarter, " +
  "or keep Supplier Alpha? Use your best guess for anything unstated.";

const FIXED_DRAFT_NUDGE = "Use your best guess for the rest and draft the model now.";

const FIXED_MUTATION =
  "Add a third option: keep Supplier Alpha but add a second packing shift.";

const DEFAULT_BASE = "https://cee-staging.onrender.com";
const TURN_TIMEOUT_MS = 300_000;

const uuid = () => globalThis.crypto.randomUUID();
const nowUtc = () => new Date().toISOString();

/* ───────────────────────── arg / state plumbing ───────────────────────── */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};

const EVIDENCE_DEFAULT =
  process.env.SDL_EVIDENCE_DIR ??
  "/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/evidence";
const STATE_PATH = val("--state", `${EVIDENCE_DEFAULT}/sdl-state-spine-state.json`);
const OUT_PATH = val("--out", `${EVIDENCE_DEFAULT}/W3A-live-witness.md`);
const BASE = (val("--base-url", DEFAULT_BASE)).replace(/\/$/, "");

const API_KEY = process.env.SDL_API_KEY ?? "";
const DB_URL = (process.env.SDL_SUPABASE_URL ?? "").replace(/\/$/, "");
const DB_KEY = process.env.SDL_SUPABASE_KEY ?? "";
const EXPECT_SHA = process.env.SDL_EXPECT_SHA ?? "";

function loadState() {
  if (!existsSync(STATE_PATH)) return { steps: [], scenarioId: null, turns: {} };
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}
function saveState(s) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
const log = (m) => process.stdout.write(`${m}\n`);

/** Append a step record. Every step carries its own UTC timestamp. */
function step(state, name, data) {
  const rec = { step: name, at_utc: nowUtc(), ...data };
  state.steps.push(rec);
  saveState(state);
  return rec;
}

/* ───────────────────────── HTTP ───────────────────────── */

/**
 * Post a turn. `rawBody` (a string) is sent VERBATIM when supplied — that is
 * what makes --replay byte-identical rather than merely field-identical. The
 * bytes actually sent are returned so the transcript can prove they matched.
 */
async function postTurn(payloadOrRaw, timeoutMs = TURN_TIMEOUT_MS) {
  const bytes =
    typeof payloadOrRaw === "string" ? payloadOrRaw : JSON.stringify(payloadOrRaw);
  const started = Date.now();
  let res, text;
  try {
    res = await fetch(`${BASE}/orchestrate/v2/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-olumi-assist-key": API_KEY },
      body: bytes,
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (e) {
    return { status: 0, body: { __threw: String(e?.name ?? e) }, ms: Date.now() - started, bytes };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { __unparseable: text.slice(0, 800), __length: text.length };
  }
  return { status: res.status, body, ms: Date.now() - started, bytes };
}

async function servedBuild() {
  try {
    const r = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(25_000) });
    const j = await r.json();
    return { build: j?.build ?? null, graph_cas: j?.graph_cas ?? null, version: j?.version ?? null };
  } catch (e) {
    return { build: null, graph_cas: null, error: String(e?.name ?? e) };
  }
}

/** Read-only PostgREST SELECT. Never writes. Returns rows or {__error}. */
async function db(table, query) {
  if (!DB_URL || !DB_KEY) return { __error: "SDL_SUPABASE_URL/KEY not configured" };
  try {
    const r = await fetch(`${DB_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: DB_KEY, Authorization: `Bearer ${DB_KEY}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) return { __error: `HTTP ${r.status}`, __detail: (await r.text()).slice(0, 300) };
    return await r.json();
  } catch (e) {
    return { __error: `threw ${String(e?.name ?? e)}` };
  }
}

/* ───────────────────────── wire readers (no prose) ───────────────────────── */

const buildShaOf = (b) =>
  b?._diagnostic_trace?.build_sha ?? b?.build_sha ?? b?.meta?.build_sha ?? null;

/** Nodes on the applied graph the response carries, if any. */
function graphNodes(b) {
  // CEE emits the applied/drafted graph under `draft_graph`
  // (scripts/ci/staging-structural-delete-witness.mjs:315-328). The other
  // spellings are kept as a fallback, never as the primary.
  const g = b?.draft_graph ?? b?.graph_state ?? b?.applied_graph ?? b?.graph ?? null;
  const n = g?.nodes;
  return Array.isArray(n) ? n : [];
}
const carriedGraph = (b) => graphNodes(b).length > 0;

function receiptOf(b) {
  return (
    b?.model_version_receipt ??
    b?.details?.model_version_receipt ??
    b?.meta?.model_version_receipt ??
    null
  );
}

/* ───────────────────────── DB readers ───────────────────────── */

async function readSpine(scenarioId) {
  const [scenarios, versions, turns, facts, fence] = await Promise.all([
    db(
      "scenarios",
      `id=eq.${scenarioId}&select=id,user_id,graph_identity_hash,current_model_version_id,updated_at,event_seq`,
    ),
    db(
      "model_versions",
      `scenario_id=eq.${scenarioId}&select=id,mutation_id,source_turn_id,created_at,graph_identity_hash&order=created_at.asc`,
    ),
    db(
      "v5_conversation_turns",
      `scenario_id=eq.${scenarioId}&select=id,turn_id,turn_class,handler_id,model_version_mutation_id,model_version_created,created_at&order=created_at.asc`,
    ),
    db("v5_handler_facts", `scenario_id=eq.${scenarioId}&select=id,turn_id,kind,created_at&order=created_at.asc`),
    db("v5_turn_fence", `scenario_id=eq.${scenarioId}&select=turn_id,generation,stopped_at,created_at&order=generation.asc`),
  ]);
  return { at_utc: nowUtc(), scenarios, model_versions: versions, v5_conversation_turns: turns, v5_handler_facts: facts, v5_turn_fence: fence };
}

/**
 * Option node ids from the PERSISTED row, with CEE out of the path. Read-only.
 * Sorted, so the head-mover target is deterministic across runs.
 */
async function persistedOptionNodeIds(scenarioId) {
  const rows = await db("scenarios", `id=eq.${scenarioId}&select=graph`);
  const nodes = Array.isArray(rows) ? (rows[0]?.graph?.nodes ?? []) : [];
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n) => n && typeof n.id === "string" && n.id.length > 0 && String(n.kind ?? "").toLowerCase().includes("option"))
    .map((n) => n.id)
    .sort();
}

const headHash = (spine) =>
  Array.isArray(spine?.scenarios) ? (spine.scenarios[0]?.graph_identity_hash ?? null) : null;

/* ───────────────────────── capabilities ───────────────────────── */

async function capSeed(state) {
  state.scenarioId = state.scenarioId ?? uuid();
  const sid = state.scenarioId;
  log(`\n[seed] scenario_id=${sid}`);

  const t1Id = uuid();
  const t1Payload = {
    kind: "message",
    turn_id: t1Id,
    scenario_id: sid,
    stage: "frame",
    turn_class: "frame",
    source: "composer",
    message: FIXED_BRIEF,
  };
  const t1 = await postTurn(t1Payload);
  log(`[seed] turn1 HTTP ${t1.status} ${(t1.ms / 1000).toFixed(1)}s graph=${carriedGraph(t1.body)} build=${buildShaOf(t1.body)}`);
  state.turns[t1Id] = { role: "seed-1", bytes: t1.bytes, status: t1.status, carriedGraph: carriedGraph(t1.body), receipt: receiptOf(t1.body) };
  step(state, "seed.turn1", { turn_id: t1Id, status: t1.status, ms: t1.ms, carried_graph: carriedGraph(t1.body), build_sha: buildShaOf(t1.body), receipt: receiptOf(t1.body) });

  let committingTurnId = carriedGraph(t1.body) ? t1Id : null;
  let lastGraphBody = carriedGraph(t1.body) ? t1.body : null;

  if (committingTurnId === null) {
    const t2Id = uuid();
    const t2Payload = { ...t1Payload, turn_id: t2Id, turn_class: "propose", message: FIXED_DRAFT_NUDGE };
    const t2 = await postTurn(t2Payload);
    log(`[seed] turn2 HTTP ${t2.status} ${(t2.ms / 1000).toFixed(1)}s graph=${carriedGraph(t2.body)} build=${buildShaOf(t2.body)}`);
    state.turns[t2Id] = { role: "seed-2", bytes: t2.bytes, status: t2.status, carriedGraph: carriedGraph(t2.body), receipt: receiptOf(t2.body) };
    step(state, "seed.turn2", { turn_id: t2Id, status: t2.status, ms: t2.ms, carried_graph: carriedGraph(t2.body), build_sha: buildShaOf(t2.body), receipt: receiptOf(t2.body) });
    if (carriedGraph(t2.body)) { committingTurnId = t2Id; lastGraphBody = t2.body; }
  }

  // Record a deterministic OPTION node id for the no-LLM head-mover. Bound by
  // IDENTITY (lexicographically first option node), never by index into a list
  // whose order the server may change.
  const opts = await persistedOptionNodeIds(sid);
  state.someNodeId = opts[0] ?? null;
  state.optionNodeIds = opts;
  void lastGraphBody;

  const spine = await readSpine(sid);
  const hashA = headHash(spine);
  state.hashA = hashA;
  // THE COMMITTING TURN IS DECIDED BY THE DB ROW, NOT BY THE WIRE ECHO.
  // A turn row carrying a non-null `model_version_mutation_id` is one that went
  // through append_turn_atomic_v5 (the versioned RPC); that is the turn whose
  // replay this witness is about. Bound by IDENTITY (the turn_id we sent),
  // never by position.
  const ourTurnIds = Object.keys(state.turns);
  const versioned = (Array.isArray(spine.v5_conversation_turns) ? spine.v5_conversation_turns : [])
    .filter((t) => t.model_version_mutation_id !== null && ourTurnIds.includes(t.turn_id));
  state.committingTurnId = versioned[0]?.turn_id ?? committingTurnId;
  state.committingTurnRow = versioned[0] ?? null;
  committingTurnId = state.committingTurnId;
  // ASSERTION (DB row, not prose): a graph persisted and the hash is non-null.
  const ok = typeof hashA === "string" && hashA.length > 0;
  log(`[seed] graph_identity_hash A = ${hashA} (non-null: ${ok}); committing turn = ${committingTurnId}`);
  step(state, "seed.assert", {
    scenario_id: sid,
    graph_identity_hash_A: hashA,
    graph_identity_hash_non_null: ok,
    user_id: Array.isArray(spine.scenarios) ? (spine.scenarios[0]?.user_id ?? null) : "READ_FAILED",
    committing_turn_id: committingTurnId,
    option_node_ids: state.optionNodeIds ?? null,
    head_mover_node_id: state.someNodeId ?? null,
    spine,
  });
  return ok;
}

async function capRead(state) {
  const spine = await readSpine(state.scenarioId);
  log(`\n[read] ${JSON.stringify(spine, null, 2)}`);
  step(state, "read", { scenario_id: state.scenarioId, spine });
  return spine;
}

async function capMutate(state) {
  const sid = state.scenarioId;
  const before = await readSpine(sid);
  const tId = uuid();
  const payload = {
    kind: "message",
    turn_id: tId,
    scenario_id: sid,
    stage: "frame",
    turn_class: "propose",
    source: "composer",
    message: FIXED_MUTATION,
  };
  const r = await postTurn(payload);
  const after = await readSpine(sid);
  state.turns[tId] = { role: "mutate", bytes: r.bytes, status: r.status, carriedGraph: carriedGraph(r.body), receipt: receiptOf(r.body) };
  state.hashB = headHash(after);
  log(`\n[mutate] turn ${tId} HTTP ${r.status} ${(r.ms / 1000).toFixed(1)}s`);
  log(`[mutate] head ${headHash(before)} -> ${headHash(after)} (moved: ${headHash(before) !== headHash(after)})`);
  step(state, "mutate", {
    turn_id: tId,
    status: r.status,
    ms: r.ms,
    build_sha: buildShaOf(r.body),
    model_version_receipt: receiptOf(r.body),
    head_before: headHash(before),
    head_after: headHash(after),
    head_moved: headHash(before) !== headHash(after),
    error: r.body?.error ?? null,
    spine_after: after,
  });
  return headHash(before) !== headHash(after);
}

async function capReplay(state, turnId) {
  const sid = state.scenarioId;
  const tid = turnId ?? state.committingTurnId;
  const saved = state.turns[tid];
  if (!saved) {
    log(`[replay] no saved request bytes for turn ${tid}`);
    return null;
  }
  const before = await readSpine(sid);
  const beforeRow = (before.v5_conversation_turns ?? []).find?.((t) => t.turn_id === tid) ?? null;
  const r = await postTurn(saved.bytes);
  const after = await readSpine(sid);
  const afterRow = (after.v5_conversation_turns ?? []).find?.((t) => t.turn_id === tid) ?? null;
  const identical = r.bytes === saved.bytes;
  log(`\n[replay] turn ${tid} byte-identical=${identical} HTTP ${r.status} ${(r.ms / 1000).toFixed(1)}s`);
  log(`[replay] wire error=${JSON.stringify(r.body?.error ?? null)} category=${JSON.stringify(r.body?.details?.conflict_category ?? null)}`);
  log(`[replay] head ${headHash(before)} -> ${headHash(after)}`);
  log(`[replay] original turn row before=${JSON.stringify(beforeRow)}`);
  log(`[replay] original turn row after =${JSON.stringify(afterRow)}`);
  step(state, "replay", {
    replayed_turn_id: tid,
    byte_identical: identical,
    request_sha_note: "bytes replayed verbatim from the state file",
    status: r.status,
    ms: r.ms,
    build_sha: buildShaOf(r.body),
    wire_error: r.body?.error ?? null,
    wire_error_code: r.body?.code ?? r.body?.details?.code ?? null,
    conflict_category: r.body?.details?.conflict_category ?? null,
    expected_base_graph_hash: r.body?.details?.expected_base_graph_hash ?? null,
    model_version_receipt: receiptOf(r.body),
    carried_graph: carriedGraph(r.body),
    head_before: headHash(before),
    head_after: headHash(after),
    original_turn_row_before: beforeRow,
    original_turn_row_after: afterRow,
    body_keys: Object.keys(r.body ?? {}),
    body_excerpt: JSON.stringify(r.body).slice(0, 1200),
  });
  return r;
}

/**
 * DETERMINISTIC HEAD-MOVER — a `structural_delete` system_event. No LLM call,
 * so it is free and its effect on `scenarios.graph_identity_hash` is certain,
 * unlike a `message` turn whose routing the model decides. Used for W3-A step 2
 * and as the racer in --race.
 */
async function capMoveHead(state, nodeId) {
  const sid = state.scenarioId;
  const target = nodeId ?? (state.optionNodeIds ?? [])[0];
  if (!target) { log("[move-head] no option node id recorded"); return null; }
  const before = await readSpine(sid);
  const baseHash = await currentAnalysisBaseHash(sid);
  const r = await postTurn({
    kind: "system_event",
    turn_id: uuid(),
    scenario_id: sid,
    stage: "analyse",
    event: { kind: "structural_delete", removed_node_ids: [target], removed_edges: [], base_graph_hash: baseHash },
  });
  const after = await readSpine(sid);
  const moved = headHash(before) !== headHash(after);
  state.hashB = headHash(after);
  log(`\n[move-head] delete ${target} HTTP ${r.status} error=${JSON.stringify(r.body?.error ?? null)}`);
  log(`[move-head] head ${headHash(before)} -> ${headHash(after)} (moved: ${moved})`);
  step(state, "move_head", {
    deleted_node_id: target,
    base_graph_hash_sent: baseHash,
    status: r.status,
    wire_error: r.body?.error ?? null,
    head_before: headHash(before),
    head_after: headHash(after),
    head_moved: moved,
    spine_after: after,
  });
  return moved;
}

/**
 * CONTRAST CONTROL for "the wire cannot supply a stale expected base".
 * A system_event DOES carry a client-supplied `base_graph_hash`. If that value
 * fed the RPC's `p_expected_graph_identity_hash`, this call would produce the
 * OLGC1 CAS refusal. What it actually produces names which guard owns it.
 */
async function capStale(state) {
  const sid = state.scenarioId;
  const before = await readSpine(sid);
  const nodes = state.someNodeId ?? "sdl-witness-nonexistent-node";
  const r = await postTurn({
    kind: "system_event",
    turn_id: uuid(),
    scenario_id: sid,
    stage: "analyse",
    event: { kind: "structural_delete", removed_node_ids: [nodes], removed_edges: [], base_graph_hash: "1111111111111111" },
  });
  const after = await readSpine(sid);
  log(`\n[stale] HTTP ${r.status} error=${JSON.stringify(r.body?.error ?? null)} category=${JSON.stringify(r.body?.details?.conflict_category ?? null)}`);
  log(`[stale] head ${headHash(before)} -> ${headHash(after)}`);
  step(state, "stale_control", {
    status: r.status,
    wire_error: r.body?.error ?? null,
    conflict_category: r.body?.details?.conflict_category ?? null,
    expected_base_graph_hash: r.body?.details?.expected_base_graph_hash ?? null,
    head_before: headHash(before),
    head_after: headHash(after),
    head_unchanged: headHash(before) === headHash(after),
    body_excerpt: JSON.stringify(r.body).slice(0, 900),
  });
  return r;
}

/**
 * W3-A ON THE TURN FAMILY THAT ACTUALLY CARRIES THE INGRESS turn_id.
 *
 * MEASURED 2026-09-21: a `message` turn does NOT commit under the body's
 * `turn_id` — `runPreFlight` mints a request id (utils/request-id.ts:39-69,
 * `getOrGenerateRequestId`) and the turn-executor commit sites use
 * `turn_id: context.request_id`. A `system_event` DOES commit under the
 * ingress turn_id (proven: fence row, turn row and
 * `v5.graph_cas.evaluated turn_id` all equal the id sent).
 *
 * So the ONLY wire family on which a replay can present an already-committed
 * `p_turn_id` to `append_turn_atomic_v5` is the system_event. This runs the
 * W3-A sequence there, deterministically and with NO LLM spend:
 *   D1 delete -> commits under T_D1, head moves
 *   D2 delete -> head moves again (T_D1's commit is now behind the head)
 *   REPLAY D1 byte-identically (same turn_id T_D1)
 * and records whichever guard answers.
 */
async function capSysEventW3A(state) {
  const sid = state.scenarioId;
  const opts = await persistedOptionNodeIds(sid);
  if (opts.length < 2) { log(`[sysevent] need 2 option nodes, have ${opts.length}`); return null; }
  const [n1, n2] = opts;

  const h0 = await readSpine(sid);
  const base1 = await currentAnalysisBaseHash(sid);
  const d1Id = uuid();
  const d1Body = JSON.stringify({
    kind: "system_event", turn_id: d1Id, scenario_id: sid, stage: "analyse",
    event: { kind: "structural_delete", removed_node_ids: [n1], removed_edges: [], base_graph_hash: base1 },
  });
  const d1 = await postTurn(d1Body);
  const h1 = await readSpine(sid);
  log(`\n[sysevent] D1 delete ${n1} turn=${d1Id} HTTP ${d1.status} err=${JSON.stringify(d1.body?.error ?? null)}`);
  log(`[sysevent] head ${headHash(h0)} -> ${headHash(h1)}`);

  const base2 = await currentAnalysisBaseHash(sid);
  const d2Id = uuid();
  const d2 = await postTurn({
    kind: "system_event", turn_id: d2Id, scenario_id: sid, stage: "analyse",
    event: { kind: "structural_delete", removed_node_ids: [n2], removed_edges: [], base_graph_hash: base2 },
  });
  const h2 = await readSpine(sid);
  log(`[sysevent] D2 delete ${n2} turn=${d2Id} HTTP ${d2.status} err=${JSON.stringify(d2.body?.error ?? null)}`);
  log(`[sysevent] head ${headHash(h1)} -> ${headHash(h2)}`);

  const rowBefore = (h2.v5_conversation_turns ?? []).find?.((t) => t.turn_id === d1Id) ?? null;
  const rp = await postTurn(d1Body); // BYTE-IDENTICAL
  const h3 = await readSpine(sid);
  const rowAfter = (h3.v5_conversation_turns ?? []).find?.((t) => t.turn_id === d1Id) ?? null;
  log(`[sysevent] REPLAY D1 byte-identical=${rp.bytes === d1Body} HTTP ${rp.status} err=${JSON.stringify(rp.body?.error ?? null)} cat=${JSON.stringify(rp.body?.details?.conflict_category ?? null)}`);
  log(`[sysevent] head ${headHash(h2)} -> ${headHash(h3)}`);
  log(`[sysevent] D1 row before: ${JSON.stringify(rowBefore)}`);
  log(`[sysevent] D1 row after : ${JSON.stringify(rowAfter)}`);

  step(state, "sysevent_w3a", {
    d1_turn_id: d1Id, d1_node: n1, d1_status: d1.status, d1_error: d1.body?.error ?? null,
    d1_base_hash_sent: base1,
    d2_turn_id: d2Id, d2_node: n2, d2_status: d2.status, d2_error: d2.body?.error ?? null,
    d2_base_hash_sent: base2,
    head_h0: headHash(h0), head_h1: headHash(h1), head_h2: headHash(h2), head_h3: headHash(h3),
    replay_byte_identical: rp.bytes === d1Body,
    replay_status: rp.status,
    replay_error: rp.body?.error ?? null,
    replay_conflict_category: rp.body?.details?.conflict_category ?? null,
    replay_expected_base_graph_hash: rp.body?.details?.expected_base_graph_hash ?? null,
    replay_body_excerpt: JSON.stringify(rp.body).slice(0, 1500),
    d1_row_before: rowBefore, d1_row_after: rowAfter,
    d1_row_unchanged: JSON.stringify(rowBefore) === JSON.stringify(rowAfter),
  });
  return rp;
}

/**
 * THE RACE — the only wire-reachable route to OLGC1 on a committed turn that
 * the code path allows, because `expectedGraphIdentityHash` is always a
 * SERVER-side read (turn-executor.ts:1690) and the client cannot set it.
 *
 * Start the slow replay (it re-reads the head as its expected base, then spends
 * ~15-60s in the LLM), then land a fast no-LLM head-moving system_event inside
 * that window. At the replay's RPC: expected = the pre-delete head, current =
 * the post-delete head, and the turn ALREADY EXISTS.
 */
async function capRace(state, turnId, delayMs) {
  const sid = state.scenarioId;
  const tid = turnId ?? state.committingTurnId;
  const saved = state.turns[tid];
  if (!saved) { log(`[race] no saved bytes for ${tid}`); return null; }
  const target = state.someNodeId;
  if (!target) { log(`[race] no head-mover node id recorded — run --seed first`); return null; }

  const before = await readSpine(sid);
  log(`\n[race] head before = ${headHash(before)}; replaying ${tid}; head-mover fires in ${delayMs}ms`);

  const replayP = postTurn(saved.bytes).then((r) => ({ who: "replay", r }));
  const moverP = new Promise((res) => setTimeout(res, delayMs)).then(async () => {
    const hash = await currentAnalysisBaseHash(sid);
    const r = await postTurn({
      kind: "system_event",
      turn_id: uuid(),
      scenario_id: sid,
      stage: "analyse",
      event: { kind: "structural_delete", removed_node_ids: [target], removed_edges: [], base_graph_hash: hash },
    });
    log(`[race] head-mover HTTP ${r.status} error=${JSON.stringify(r.body?.error ?? null)} (base_graph_hash used: ${hash})`);
    return { who: "mover", r, baseHashUsed: hash };
  });

  const [a, b] = await Promise.all([replayP, moverP]);
  const replay = a.who === "replay" ? a.r : b.r;
  const mover = a.who === "mover" ? a : b;
  const after = await readSpine(sid);
  const row = (after.v5_conversation_turns ?? []).find?.((t) => t.turn_id === tid) ?? null;

  log(`[race] replay HTTP ${replay.status} error=${JSON.stringify(replay.body?.error ?? null)} category=${JSON.stringify(replay.body?.details?.conflict_category ?? null)}`);
  log(`[race] head after = ${headHash(after)}`);
  step(state, "race", {
    replayed_turn_id: tid,
    mover_status: mover.r.status,
    mover_error: mover.r.body?.error ?? null,
    mover_base_hash_used: mover.baseHashUsed ?? null,
    mover_moved_head: headHash(before) !== headHash(after),
    replay_status: replay.status,
    replay_ms: replay.ms,
    replay_wire_error: replay.body?.error ?? null,
    replay_conflict_category: replay.body?.details?.conflict_category ?? null,
    replay_model_version_receipt: receiptOf(replay.body),
    replay_body_excerpt: JSON.stringify(replay.body).slice(0, 1200),
    head_before: headHash(before),
    head_after: headHash(after),
    original_turn_row_after: row,
  });
  return { replay, mover };
}

/** Read the canonical 16-hex analysis base hash via the sentinel 409 probe. */
async function currentAnalysisBaseHash(sid) {
  const r = await postTurn({
    kind: "system_event",
    turn_id: uuid(),
    scenario_id: sid,
    stage: "analyse",
    event: { kind: "structural_delete", removed_node_ids: ["sdl-witness-probe-node"], removed_edges: [], base_graph_hash: "0000000000000000" },
  });
  return r.body?.details?.expected_base_graph_hash ?? null;
}

/* ───────────────────────── report ───────────────────────── */

function capReport(state) {
  const L = [];
  L.push(`# W3-A live witness — SDL state spine`, ``);
  L.push(`- generated (UTC): ${nowUtc()}`);
  L.push(`- base URL: ${BASE}`);
  L.push(`- served build (recorded per step): ${state.servedBuild ?? "?"}`);
  L.push(`- served graph_cas: \`${JSON.stringify(state.servedGraphCas ?? null)}\``);
  L.push(`- repo HEAD asserted: ${state.repoHead ?? "?"}`);
  L.push(`- scenario_id: \`${state.scenarioId}\``);
  L.push(`- identity hash A: \`${state.hashA ?? "?"}\``);
  L.push(`- identity hash B: \`${state.hashB ?? "?"}\``);
  L.push(``, `## Steps`, ``);
  for (const s of state.steps) {
    L.push(`### ${s.step} — ${s.at_utc}`, ``, "```json", JSON.stringify(s, null, 2).slice(0, 6000), "```", ``);
  }
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, L.join("\n"));
  log(`\n[report] wrote ${OUT_PATH}`);
}

/* ───────────────────────── main ───────────────────────── */

async function main() {
  const state = loadState();
  if (val("--scenario", null)) state.scenarioId = val("--scenario", null);
  state.turns = state.turns ?? {};
  state.steps = state.steps ?? [];

  const sb = await servedBuild();
  state.servedBuild = sb.build;
  state.servedGraphCas = sb.graph_cas;
  log(`[build] served=${sb.build} graph_cas=${JSON.stringify(sb.graph_cas)}`);
  if (EXPECT_SHA) {
    const want = EXPECT_SHA.slice(0, 7);
    if (!sb.build || sb.build.slice(0, 7) !== want) {
      log(`[build] HALT: serving ${sb.build}, expected prefix ${want}`);
      process.exit(3);
    }
    log(`[build] bound: served prefix matches SDL_EXPECT_SHA (${want})`);
  }
  saveState(state);

  if (has("--w3a")) {
    const ok = await capSeed(state);
    if (!ok) { log("[w3a] seed did not persist a graph — halting"); capReport(state); process.exit(1); }
    const moved = await capMoveHead(state);
    if (!moved) log("[w3a] head did not move — the replay step below is NOT the defect condition");
    await capReplay(state);
    await capRead(state);
    capReport(state);
    return;
  }

  if (has("--seed")) await capSeed(state);
  if (has("--mutate")) await capMutate(state);
  if (has("--move-head")) await capMoveHead(state, val("--node", null));
  if (has("--replay")) await capReplay(state, val("--turn", null));
  if (has("--sysevent-w3a")) await capSysEventW3A(state);
  if (has("--stale")) await capStale(state);
  if (has("--race")) await capRace(state, val("--turn", null), Number(val("--delay-ms", "4000")));
  if (has("--read")) await capRead(state);
  if (has("--report")) capReport(state);
  saveState(state);
}

main().catch((e) => {
  log(`FATAL: ${e?.stack ?? e}`);
  process.exit(2);
});
