/**
 * Phase 3: Staging Verification Smoke Test (v2)
 *
 * Behaves like the real UI client:
 *  - Round-trips graph_state (from graph_patch block's applied_graph)
 *  - Round-trips analysis_state (from analysis response)
 *  - Round-trips session_state (from updated_session_state)
 *
 * Runs all journeys against both endpoints:
 *  - /orchestrate/v1/turn/stream (SSE — real user path)
 *  - /orchestrate/v1/turn (sync — non-streaming V4 path)
 *
 * Run with: npx tsx scripts/staging-smoke.ts
 *
 * Environment:
 *   CEE_STAGING_URL  — staging base URL (default: https://cee-staging.onrender.com)
 *   CEE_API_KEY      — X-Olumi-Assist-Key value
 *   ASSIST_API_KEY   — fallback for CEE_API_KEY
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CEE_URL =
  process.env.CEE_STAGING_URL ||
  process.env.CEE_BASE_URL ||
  "https://cee-staging.onrender.com";

const API_KEY =
  process.env.CEE_API_KEY ||
  process.env.ASSIST_API_KEY ||
  "";

if (!API_KEY) {
  console.error("ERROR: No API key. Set CEE_API_KEY or ASSIST_API_KEY.");
  process.exit(1);
}

const STREAM_URL = `${CEE_URL}/orchestrate/v1/turn/stream`;
const SYNC_URL = `${CEE_URL}/orchestrate/v1/turn`;
const TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

interface Investigation {
  failure: string;
  root_cause: string;
  evidence: string;
  recommended_fix: string;
  fix_complexity: "trivial" | "moderate" | "complex";
}

interface TurnResult {
  turn: number;
  message: string;
  endpoint: "stream" | "sync";
  request_payload_keys: string[];
  response_envelope_keys: string[];
  assistant_text_preview: string;
  stage: string;
  chips_count: number;
  blocks_count: number;
  session_state_present: boolean;
  graph_state_sent: boolean;
  analysis_state_sent: boolean;
  latency_ms: number;
  latency_warning: boolean;
  checks: Check[];
  investigation: Investigation | null;
  sse_meta?: { event_count: number; event_types: string[]; time_ms: number };
  raw_response: Record<string, unknown>;
  error?: string;
}

interface JourneyResult {
  journey: string;
  endpoint: "stream" | "sync";
  turns: TurnResult[];
}

interface SseEvent {
  type: string;
  data: any;
}

// ---------------------------------------------------------------------------
// State bag — round-tripped between turns like the real UI
// ---------------------------------------------------------------------------

interface ClientState {
  graph_state: any | null;
  analysis_state: any | null;
  analysis_inputs: any | null;
  session_state: any | null;
  history: Array<{ role: string; content: string }>;
}

function freshState(): ClientState {
  return { graph_state: null, analysis_state: null, analysis_inputs: null, session_state: null, history: [] };
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

function parseSseChunk(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = text.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let eventType: string | null = null;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event: ")) eventType = line.substring(7).trim();
      else if (line.startsWith("data: ")) dataLines.push(line.substring(6));
      else if (line.startsWith(": ")) eventType = "heartbeat";
    }
    if (!eventType) continue;
    if (eventType === "heartbeat" || dataLines.length === 0) {
      events.push({ type: "heartbeat", data: null });
    } else {
      try {
        events.push({ type: eventType, data: JSON.parse(dataLines.join("\n")) });
      } catch { /* skip malformed */ }
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Transport: SSE
// ---------------------------------------------------------------------------

async function sendTurnSSE(
  body: Record<string, unknown>,
): Promise<{ envelope: any; events: SseEvent[]; time_ms: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(STREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": API_KEY,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`SSE HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return { envelope: await res.json(), events: [], time_ms: Date.now() - t0 };
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const allEvents: SseEvent[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        if (!part.trim()) continue;
        allEvents.push(...parseSseChunk(part + "\n\n"));
      }
    }
    if (buffer.trim()) allEvents.push(...parseSseChunk(buffer + "\n\n"));
    const time_ms = Date.now() - t0;
    const turnComplete = allEvents.find((e) => e.type === "turn_complete");
    if (!turnComplete) {
      const errorEvent = allEvents.find((e) => e.type === "error");
      if (errorEvent) throw new Error(`SSE error: ${errorEvent.data?.error?.code}: ${errorEvent.data?.error?.message}`);
      throw new Error(`No turn_complete in stream (${allEvents.length} events: ${allEvents.map((e) => e.type).join(", ")})`);
    }
    return { envelope: turnComplete.data.envelope, events: allEvents, time_ms };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Transport: Sync
// ---------------------------------------------------------------------------

async function sendTurnSync(
  body: Record<string, unknown>,
): Promise<{ envelope: any; time_ms: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Olumi-Assist-Key": API_KEY },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Sync HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return { envelope: await res.json(), time_ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Unified turn sender
// ---------------------------------------------------------------------------

interface SendResult {
  envelope: any;
  events: SseEvent[];
  time_ms: number;
}

async function sendTurn(
  endpoint: "stream" | "sync",
  body: Record<string, unknown>,
): Promise<SendResult> {
  if (endpoint === "stream") return sendTurnSSE(body);
  const { envelope, time_ms } = await sendTurnSync(body);
  return { envelope, events: [], time_ms };
}

// ---------------------------------------------------------------------------
// State extraction helpers
// ---------------------------------------------------------------------------

function extractGraph(envelope: any): any | null {
  const blocks: any[] = envelope.blocks || [];
  for (const block of blocks) {
    if ((block.type === "graph_patch" || block.block_type === "graph_patch") && block.data?.applied_graph) {
      return block.data.applied_graph;
    }
  }
  return envelope.full_graph || envelope.graph || null;
}

function extractAnalysis(envelope: any): any | null {
  return envelope.analysis_state || envelope.analysis_response || null;
}

/**
 * Extract analysis_inputs from the graph_patch block's analysis_ready data.
 * The UI must send this as context.analysis_inputs for run_analysis to work.
 */
function extractAnalysisInputs(envelope: any): any | null {
  const blocks: any[] = envelope.blocks || [];
  for (const block of blocks) {
    if ((block.type === "graph_patch" || block.block_type === "graph_patch") && block.data?.analysis_ready) {
      const ar = block.data.analysis_ready;
      if (ar.options && Array.isArray(ar.options) && ar.options.length > 0) {
        return {
          options: ar.options.map((opt: any) => ({
            option_id: opt.option_id || opt.id,
            label: opt.label,
            interventions: opt.interventions || {},
          })),
        };
      }
    }
  }
  // Also check applied_graph.analysis_ready
  const graph = extractGraph(envelope);
  if (graph?.analysis_ready?.options) {
    return {
      options: graph.analysis_ready.options.map((opt: any) => ({
        option_id: opt.option_id || opt.id,
        label: opt.label,
        interventions: opt.interventions || {},
      })),
    };
  }
  return null;
}

function getStage(env: any): string {
  const si = env.stage_indicator;
  if (!si) return "";
  if (typeof si === "string") return si;
  if (typeof si === "object" && si.stage) return si.stage;
  return "";
}

function truncate(s: string, max = 2000): string {
  return s.length > max ? s.slice(0, max) + "...[truncated]" : s;
}

// ---------------------------------------------------------------------------
// Build turn request body like the real UI
// ---------------------------------------------------------------------------

function buildRequestBody(
  scenarioId: string,
  message: string,
  state: ClientState,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    scenario_id: scenarioId,
    client_turn_id: randomUUID(),
    message,
    conversation_history: state.history,
  };
  if (state.graph_state) body.graph_state = state.graph_state;
  if (state.analysis_state) body.analysis_state = state.analysis_state;
  if (state.session_state) body.session_state = state.session_state;
  // Send analysis_inputs in context — required for run_analysis to fire.
  // The real UI extracts this from the graph_patch block's analysis_ready data.
  if (state.analysis_inputs) {
    const ctx = (body.context || {}) as Record<string, unknown>;
    ctx.analysis_inputs = state.analysis_inputs;
    body.context = ctx;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

function chk(name: string, pass: boolean, detail: unknown): Check {
  return { name, pass, detail: String(detail ?? "") };
}

function logChecks(checks: Check[]) {
  for (const c of checks) {
    console.log(`  ${c.pass ? "\u2705" : "\u274C"} ${c.name}: ${c.detail.slice(0, 140)}`);
  }
}

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const BANNED_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "fac_ IDs", re: /\bfac_\w+/ },
  { label: "opt_ IDs", re: /\bopt_\w+/ },
  { label: "risk_ IDs", re: /\brisk_\w+/ },
  { label: "out_ IDs", re: /\bout_\w+/ },
  { label: "goal_ IDs", re: /\bgoal_\w+/ },
  { label: "dec_ IDs", re: /\bdec_\w+/ },
  { label: "em dash", re: /\u2014/ },
  { label: "en dash", re: /\u2013/ },
  { label: '"recommended"', re: /\brecommended\b/i },
  { label: '"winner"', re: /\bwinner\b/i },
  { label: '"Confirm to apply"', re: /confirm to apply|please confirm/i },
  { label: "raw JSON/XML", re: /<\/?[a-z_]+>|\{"\w+":/i },
];

function bannedChecks(text: string): Check[] {
  return BANNED_PATTERNS.map(({ label, re }) => {
    const match = text.match(re);
    return {
      name: `No banned: ${label}`,
      pass: !match,
      detail: match
        ? `Found "${match[0]}" near: "...${text.slice(Math.max(0, text.indexOf(match[0]) - 20), text.indexOf(match[0]) + 30)}..."`
        : "clean",
    };
  });
}

function chipChecks(chips: any[]): Check[] {
  const checks: Check[] = [
    chk("Chips count 0-3", chips.length <= 3, `${chips.length} chips`),
  ];
  for (const chip of chips) {
    checks.push(
      chk(`Chip "${String(chip.label || "?").slice(0, 30)}" has action_type`, !!chip.action_type, chip.action_type || "missing"),
      chk(`Chip "${String(chip.label || "?").slice(0, 30)}" has label`, !!chip.label, chip.label || "missing"),
    );
  }
  const types = chips.map((c: any) => c.action_type).filter(Boolean);
  if (types.length > 1) {
    const unique = new Set(types);
    checks.push(chk("No duplicate action_types", unique.size === types.length, types.join(", ")));
  }
  return checks;
}

function sseChecks(events: SseEvent[], time_ms: number): Check[] {
  if (events.length === 0) return []; // sync path
  const types = events.map((e) => e.type);
  return [
    chk("SSE has turn_start", types.includes("turn_start"), types.slice(0, 5).join(", ")),
    chk("SSE has turn_complete", types.includes("turn_complete"), `${types.length} events`),
    chk("SSE no error event", !types.includes("error"),
      types.includes("error")
        ? events.find((e) => e.type === "error")?.data?.error?.message || "error"
        : "clean"),
    chk("SSE has text_delta events", events.filter((e) => e.type === "text_delta").length > 0,
      `${events.filter((e) => e.type === "text_delta").length} deltas`),
  ];
}

// ---------------------------------------------------------------------------
// Investigation builder
// ---------------------------------------------------------------------------

function investigate(
  failure: string,
  root_cause: string,
  evidence: string,
  recommended_fix: string,
  fix_complexity: Investigation["fix_complexity"],
): Investigation {
  return { failure, root_cause, evidence, recommended_fix, fix_complexity };
}

// ---------------------------------------------------------------------------
// Build TurnResult from envelope
// ---------------------------------------------------------------------------

function buildTurnResult(
  turn: number,
  message: string,
  endpoint: "stream" | "sync",
  requestBody: Record<string, unknown>,
  envelope: any,
  events: SseEvent[],
  time_ms: number,
  checks: Check[],
  investigation: Investigation | null,
): TurnResult {
  const text = envelope.assistant_text || "";
  return {
    turn,
    message,
    endpoint,
    request_payload_keys: Object.keys(requestBody).sort(),
    response_envelope_keys: Object.keys(envelope).sort(),
    assistant_text_preview: text.slice(0, 300),
    stage: getStage(envelope),
    chips_count: (envelope.suggested_actions || []).length,
    blocks_count: (envelope.blocks || []).length,
    session_state_present: envelope.updated_session_state != null,
    graph_state_sent: !!requestBody.graph_state,
    analysis_state_sent: !!requestBody.analysis_state || !!(requestBody.context as any)?.analysis_inputs,
    latency_ms: time_ms,
    latency_warning: time_ms > 30_000,
    checks,
    investigation,
    ...(events.length > 0
      ? {
          sse_meta: {
            event_count: events.length,
            event_types: [...new Set(events.map((e) => e.type))],
            time_ms,
          },
        }
      : {}),
    raw_response: { ...envelope, assistant_text: truncate(text) },
  };
}

// ---------------------------------------------------------------------------
// After-turn: update client state from response
// ---------------------------------------------------------------------------

function updateState(state: ClientState, userMessage: string, envelope: any) {
  // Graph
  const graph = extractGraph(envelope);
  if (graph) state.graph_state = graph;

  // Analysis inputs (from graph_patch block's analysis_ready)
  const inputs = extractAnalysisInputs(envelope);
  if (inputs) state.analysis_inputs = inputs;

  // Analysis
  const analysis = extractAnalysis(envelope);
  if (analysis) state.analysis_state = analysis;

  // Session
  if (envelope.updated_session_state) state.session_state = envelope.updated_session_state;

  // History
  state.history.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: envelope.assistant_text || "" },
  );
}

// ============================================================================
// Journey 1: Draft -> calibrate -> add factor
// ============================================================================

async function journey1(endpoint: "stream" | "sync"): Promise<JourneyResult> {
  const sid = randomUUID();
  const state = freshState();
  const turns: TurnResult[] = [];
  const label = `J1-${endpoint}`;

  // ---- Turn 1: Draft ----
  const msg1 = "Should I hire a tech lead or two junior developers for my startup? We have 18 months of runway and need to ship a product rewrite.";
  console.log(`\n--- ${label} / Turn 1: Draft ---`);
  let envelope: any, events: SseEvent[], time_ms: number;
  const body1 = buildRequestBody(sid, msg1, state);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body1));
  } catch (err: any) {
    turns.push({ turn: 1, message: msg1, endpoint, request_payload_keys: Object.keys(body1), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: false, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "1", endpoint, turns };
  }

  const text1 = envelope.assistant_text || "";
  const chips1 = envelope.suggested_actions || [];
  const blocks1 = envelope.blocks || [];
  const hasCountText = /\d+\s*(factors?|nodes?|edges?|connections?)/i.test(text1);

  let inv1: Investigation | null = null;
  const checks1: Check[] = [
    ...sseChecks(events, time_ms),
    chk("No component counts", !hasCountText, text1.slice(0, 200)),
    chk("Decision-first language",
      /trade|leadership|capacity|delivery|hire|developer|lead|junior|runway/i.test(text1),
      text1.slice(0, 200)),
    chk("Has 1-3 chips", chips1.length >= 1 && chips1.length <= 3,
      `${chips1.length} chips: ${chips1.map((c: any) => c.label || "?").join(", ")}`),
    ...chipChecks(chips1),
    chk("Has graph_patch block",
      blocks1.some((b: any) => b.type === "graph_patch" || b.block_type === "graph_patch"),
      `${blocks1.length} blocks: ${blocks1.map((b: any) => b.type || b.block_type).join(", ")}`),
    chk("Session state present", envelope.updated_session_state != null,
      envelope.updated_session_state ? "present" : "null"),
    chk("Stage is frame or ideate", ["frame", "ideate"].includes(getStage(envelope)), getStage(envelope) || "missing"),
    chk("Graph extractable from response", !!extractGraph(envelope), extractGraph(envelope) ? "found in applied_graph" : "NOT FOUND"),
    ...bannedChecks(text1),
  ];

  if (hasCountText) {
    const tp = envelope.turn_plan;
    const routing = tp?.routing || "unknown";
    const selectedTool = tp?.selected_tool || "none";
    inv1 = investigate(
      "assistant_text contains component counts instead of coaching",
      `Response text starts with "${text1.slice(0, 80)}". The response composer likely fell back to patch summary text. routing=${routing}, selected_tool=${selectedTool}.`,
      `turn_plan: ${JSON.stringify(tp)?.slice(0, 300)}. blocks: ${blocks1.map((b: any) => b.block_type).join(",")}. stage=${getStage(envelope)}.`,
      "Ensure response-composer.ts uses coachingContext to generate decision-first text and does not fall back to the graph_patch block summary.",
      "moderate",
    );
  }

  logChecks(checks1);
  turns.push(buildTurnResult(1, msg1, endpoint, body1, envelope, events, time_ms, checks1, inv1));
  updateState(state, msg1, envelope);
  console.log(`  [state] graph_state: ${state.graph_state ? "YES" : "no"}, session_state: ${state.session_state ? "YES" : "no"}`);

  // ---- Turn 2: Calibrate ----
  const msg2 = "The salary budget is \u00a385,000 per year for this role.";
  console.log(`\n--- ${label} / Turn 2: Calibrate ---`);
  const body2 = buildRequestBody(sid, msg2, state);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body2));
  } catch (err: any) {
    turns.push({ turn: 2, message: msg2, endpoint, request_payload_keys: Object.keys(body2), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: !!state.graph_state, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "1", endpoint, turns };
  }

  const text2 = envelope.assistant_text || "";
  const firstSentence2 = text2.split(/[.!?]/)[0] || "";
  const stage2 = getStage(envelope);

  let inv2: Investigation | null = null;
  const checks2: Check[] = [
    ...sseChecks(events, time_ms),
    chk("Decision impact in first sentence",
      /salary|budget|cost|expensive|affordable|impact|constrain|limit|\u00a3/i.test(firstSentence2),
      `First sentence: "${firstSentence2.slice(0, 150)}"`),
    chk("No operation-first language",
      !/^(updating|setting|changing|modifying|added)\s/i.test(text2.trim()),
      text2.slice(0, 100)),
    chk("Stage advanced from frame", stage2 !== "frame", `stage=${stage2}`),
    chk("Chips present", (envelope.suggested_actions || []).length > 0,
      `${(envelope.suggested_actions || []).length} chips`),
    ...chipChecks(envelope.suggested_actions || []),
    chk("Session state present", envelope.updated_session_state != null, ""),
    ...bannedChecks(text2),
  ];

  if (stage2 === "frame") {
    inv2 = investigate(
      "Stage still 'frame' after calibration with graph_state sent",
      `graph_state was ${state.graph_state ? "sent" : "NOT sent"}. inferStage requires context.graph to have nodes array with length > 0.`,
      `graph_state sent: ${!!state.graph_state}, graph nodes count: ${state.graph_state?.nodes?.length ?? "N/A"}, response stage: ${stage2}`,
      "Verify pipeline-v4 normalisation is deployed. Check that graph_state is being merged into context.graph before computeTurnContext().",
      "trivial",
    );
  }

  logChecks(checks2);
  turns.push(buildTurnResult(2, msg2, endpoint, body2, envelope, events, time_ms, checks2, inv2));
  updateState(state, msg2, envelope);
  console.log(`  [state] graph_state: ${state.graph_state ? "YES" : "no"}, session_state: ${state.session_state ? "YES" : "no"}, stage: ${stage2}`);

  // ---- Turn 3: Add factor ----
  const msg3 = "Add a factor for onboarding time";
  console.log(`\n--- ${label} / Turn 3: Add factor ---`);
  const body3 = buildRequestBody(sid, msg3, state);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body3));
  } catch (err: any) {
    turns.push({ turn: 3, message: msg3, endpoint, request_payload_keys: Object.keys(body3), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: !!state.graph_state, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "1", endpoint, turns };
  }

  const text3 = envelope.assistant_text || "";
  const blocks3 = envelope.blocks || [];
  const hasPatch3 = blocks3.some((b: any) => b.type === "graph_patch" || b.block_type === "graph_patch");
  const sentences3 = text3.split(/[.!?]+/).filter((s: string) => s.trim().length > 0);

  const checks3: Check[] = [
    ...sseChecks(events, time_ms),
    chk("No confirmation prose", !/confirm to apply/i.test(text3), text3.slice(0, 200)),
  ];
  if (hasPatch3) {
    checks3.push(chk("Orientation only (<=2 sentences)", sentences3.length <= 2, `${sentences3.length} sentences`));
  }
  for (const block of blocks3) {
    const summary = block.summary || block.data?.summary || "";
    if (summary) {
      checks3.push(chk("No count-based summary", !/\d+\s*(factors?|nodes?|edges?|connections?)/i.test(summary), summary.slice(0, 100)));
    }
  }
  checks3.push(
    ...chipChecks(envelope.suggested_actions || []),
    ...bannedChecks(text3),
  );

  logChecks(checks3);
  turns.push(buildTurnResult(3, msg3, endpoint, body3, envelope, events, time_ms, checks3, null));
  updateState(state, msg3, envelope);

  return { journey: "1", endpoint, turns };
}

// ============================================================================
// Journey 2: Draft -> analysis -> explain -> flip
// ============================================================================

async function journey2(endpoint: "stream" | "sync"): Promise<JourneyResult> {
  const sid = randomUUID();
  const state = freshState();
  const turns: TurnResult[] = [];
  const label = `J2-${endpoint}`;

  // ---- Turn 1: Draft ----
  const msg1 = "Should I hire a marketing manager or use an AI marketing tool for our product launch? Budget is about \u00a350,000.";
  console.log(`\n--- ${label} / Turn 1: Draft ---`);
  const body1 = buildRequestBody(sid, msg1, state);
  let envelope: any, events: SseEvent[], time_ms: number;
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body1));
  } catch (err: any) {
    turns.push({ turn: 1, message: msg1, endpoint, request_payload_keys: Object.keys(body1), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: false, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "2", endpoint, turns };
  }

  const text1 = envelope.assistant_text || "";
  const chips1 = envelope.suggested_actions || [];
  const blocks1 = envelope.blocks || [];
  const hasCountText1 = /\d+\s*(factors?|nodes?|edges?|connections?)/i.test(text1);

  const checks1: Check[] = [
    ...sseChecks(events, time_ms),
    chk("No component counts", !hasCountText1, text1.slice(0, 200)),
    chk("Decision-first language", /marketing|hire|tool|launch|campaign|budget/i.test(text1), text1.slice(0, 200)),
    chk("Has 1-3 chips", chips1.length >= 1 && chips1.length <= 3, `${chips1.length} chips`),
    ...chipChecks(chips1),
    chk("Has graph_patch block", blocks1.some((b: any) => b.type === "graph_patch" || b.block_type === "graph_patch"), `${blocks1.length} blocks`),
    chk("Session state present", envelope.updated_session_state != null, ""),
    chk("Graph extractable", !!extractGraph(envelope), extractGraph(envelope) ? "found" : "NOT FOUND"),
    ...bannedChecks(text1),
  ];

  logChecks(checks1);
  turns.push(buildTurnResult(1, msg1, endpoint, body1, envelope, events, time_ms, checks1,
    hasCountText1 ? investigate("Draft contains counts", "Response composer fallback", `text: "${text1.slice(0, 100)}"`, "Fix response-composer.ts", "moderate") : null));
  updateState(state, msg1, envelope);
  console.log(`  [state] graph: ${state.graph_state ? "YES" : "no"}, analysis_inputs: ${state.analysis_inputs ? "YES" : "no"}, session: ${state.session_state ? "YES" : "no"}`);

  // ---- Turn 2: Run analysis ----
  const msg2 = "Run the analysis";
  console.log(`\n--- ${label} / Turn 2: Run analysis ---`);
  const body2 = buildRequestBody(sid, msg2, state);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body2));
  } catch (err: any) {
    turns.push({ turn: 2, message: msg2, endpoint, request_payload_keys: Object.keys(body2), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: !!state.graph_state, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "2", endpoint, turns };
  }

  const text2 = envelope.assistant_text || "";
  const stage2 = getStage(envelope);
  let inv2: Investigation | null = null;

  const checks2: Check[] = [
    ...sseChecks(events, time_ms),
    chk("Has assistant_text", text2.length > 0, `${text2.length} chars`),
    chk("Stage is evaluate", stage2 === "evaluate", `stage=${stage2}`),
    ...bannedChecks(text2),
  ];

  if (stage2 !== "evaluate") {
    const hasAnalysis = !!extractAnalysis(envelope);
    inv2 = investigate(
      `Stage is '${stage2}' instead of 'evaluate' after analysis`,
      `analysis extractable: ${hasAnalysis}, graph_state sent: ${!!state.graph_state}, graph nodes: ${state.graph_state?.nodes?.length ?? "N/A"}`,
      `response keys: ${Object.keys(envelope).join(",")}. stage_indicator: ${JSON.stringify(envelope.stage_indicator)}`,
      "Check that run_analysis action populates analysis_response in context, and that inferStage sees it.",
      "moderate",
    );
  }

  logChecks(checks2);
  turns.push(buildTurnResult(2, msg2, endpoint, body2, envelope, events, time_ms, checks2, inv2));
  updateState(state, msg2, envelope);
  console.log(`  [state] graph: ${state.graph_state ? "YES" : "no"}, analysis: ${state.analysis_state ? "YES" : "no"}, analysis_inputs: ${state.analysis_inputs ? "YES" : "no"}, session: ${state.session_state ? "YES" : "no"}, stage: ${stage2}`);

  // ---- Turn 3: Explain results ----
  const msg3 = "Can you explain the analysis results to me?";
  console.log(`\n--- ${label} / Turn 3: Explain results ---`);
  const body3 = buildRequestBody(sid, msg3, state);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body3));
  } catch (err: any) {
    turns.push({ turn: 3, message: msg3, endpoint, request_payload_keys: Object.keys(body3), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: !!state.graph_state, analysis_state_sent: !!state.analysis_state, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "2", endpoint, turns };
  }

  const text3 = envelope.assistant_text || "";
  const chips3 = envelope.suggested_actions || [];
  const hasUnavailable3 = /action.*not available|isn't available/i.test(text3);

  const checks3: Check[] = [
    ...sseChecks(events, time_ms),
    chk('No "action unavailable"', !hasUnavailable3, text3.slice(0, 200)),
    chk("Contains analytical content", /%|leads|probability|driver|sensitive|factor|likely|outcome/i.test(text3), text3.slice(0, 200)),
    ...chipChecks(chips3),
    chk("Stage is evaluate", getStage(envelope) === "evaluate", getStage(envelope) || "missing"),
    ...bannedChecks(text3),
  ];

  logChecks(checks3);
  turns.push(buildTurnResult(3, msg3, endpoint, body3, envelope, events, time_ms, checks3,
    hasUnavailable3 ? investigate("'action not available' in explain response", "Tool filtering may exclude explain_result in evaluate stage", `text: "${text3.slice(0, 200)}"`, "Check stage-policy.ts EVALUATE tool set includes explain_result", "moderate") : null));
  updateState(state, msg3, envelope);

  // ---- Turn 4: Flip ----
  const msg4 = "What would need to change to flip this result?";
  console.log(`\n--- ${label} / Turn 4: Flip ---`);
  const body4 = buildRequestBody(sid, msg4, state);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body4));
  } catch (err: any) {
    turns.push({ turn: 4, message: msg4, endpoint, request_payload_keys: Object.keys(body4), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: !!state.graph_state, analysis_state_sent: !!state.analysis_state, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "2", endpoint, turns };
  }

  const text4 = envelope.assistant_text || "";
  const checks4: Check[] = [
    ...sseChecks(events, time_ms),
    chk('No "action unavailable"', !/action.*not available|isn't available/i.test(text4), text4.slice(0, 200)),
    chk("Contains flip/change language", /flip|change|threshold|swing|reversal|shift|sensitive|adjust/i.test(text4), text4.slice(0, 200)),
    ...chipChecks(envelope.suggested_actions || []),
    ...bannedChecks(text4),
  ];

  logChecks(checks4);
  turns.push(buildTurnResult(4, msg4, endpoint, body4, envelope, events, time_ms, checks4, null));

  return { journey: "2", endpoint, turns };
}

// ============================================================================
// Journey 3: Session state + stage continuity
// ============================================================================

async function journey3(endpoint: "stream" | "sync"): Promise<JourneyResult> {
  const sid = randomUUID();
  const state = freshState();
  const turns: TurnResult[] = [];
  const label = `J3-${endpoint}`;

  // ---- Turn 1: Draft ----
  const msg1 = "Should I hire a tech lead or two junior developers for my startup? We have 18 months of runway and need to ship a product rewrite.";
  console.log(`\n--- ${label} / Turn 1: Draft ---`);
  const body1 = buildRequestBody(sid, msg1, state);
  let envelope: any, events: SseEvent[], time_ms: number;
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body1));
  } catch (err: any) {
    turns.push({ turn: 1, message: msg1, endpoint, request_payload_keys: Object.keys(body1), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: false, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "3", endpoint, turns };
  }

  const checks1: Check[] = [
    ...sseChecks(events, time_ms),
    chk("Session state present", envelope.updated_session_state != null, ""),
    chk("Graph extractable", !!extractGraph(envelope), ""),
  ];
  logChecks(checks1);
  turns.push(buildTurnResult(1, msg1, endpoint, body1, envelope, events, time_ms, checks1, null));
  updateState(state, msg1, envelope);

  // ---- Turn 2: Follow-up with session state ----
  const msg2 = "Tell me more about the key assumptions in this model.";
  console.log(`\n--- ${label} / Turn 2: Session round-trip ---`);
  const body2 = buildRequestBody(sid, msg2, state);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body2));
  } catch (err: any) {
    turns.push({ turn: 2, message: msg2, endpoint, request_payload_keys: Object.keys(body2), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: !!state.graph_state, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "3", endpoint, turns };
  }

  const stage2 = getStage(envelope);
  const checks2: Check[] = [
    ...sseChecks(events, time_ms),
    chk("Session state returned", envelope.updated_session_state != null, ""),
  ];
  if (envelope.updated_session_state) {
    const ss = envelope.updated_session_state;
    checks2.push(chk("Has expected fields", "plays_fired" in ss || "predictions" in ss || "calibrations_provided" in ss, Object.keys(ss).join(", ")));
  }
  checks2.push(
    chk("Stage not frame (graph in context)", stage2 !== "frame", `stage=${stage2}`),
    ...bannedChecks(envelope.assistant_text || ""),
  );

  logChecks(checks2);
  turns.push(buildTurnResult(2, msg2, endpoint, body2, envelope, events, time_ms, checks2, null));
  updateState(state, msg2, envelope);

  // ---- Turn 3: Continuation ----
  const msg3 = "Which assumption matters most?";
  console.log(`\n--- ${label} / Turn 3: Continuation ---`);
  const body3 = buildRequestBody(sid, msg3, state);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body3));
  } catch (err: any) {
    turns.push({ turn: 3, message: msg3, endpoint, request_payload_keys: Object.keys(body3), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: !!state.graph_state, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "3", endpoint, turns };
  }

  const stage3 = getStage(envelope);
  const checks3: Check[] = [
    ...sseChecks(events, time_ms),
    chk("Session state returned", envelope.updated_session_state != null, ""),
    chk("Stage not regressed to frame", stage3 !== "frame", `stage=${stage3}`),
    chk("Contextually relevant", (envelope.assistant_text || "").length > 30, `${(envelope.assistant_text || "").length} chars`),
    ...bannedChecks(envelope.assistant_text || ""),
  ];

  logChecks(checks3);
  turns.push(buildTurnResult(3, msg3, endpoint, body3, envelope, events, time_ms, checks3, null));

  return { journey: "3", endpoint, turns };
}

// ============================================================================
// Journey 4: Edge cases
// ============================================================================

async function journey4(endpoint: "stream" | "sync"): Promise<JourneyResult> {
  const sid = randomUUID();
  const state = freshState();
  const turns: TurnResult[] = [];
  const label = `J4-${endpoint}`;

  // ---- Turn 1: Thin brief ----
  const msg1 = "I need to make a hiring decision.";
  console.log(`\n--- ${label} / Turn 1: Thin brief ---`);
  const body1 = buildRequestBody(sid, msg1, state);
  let envelope: any, events: SseEvent[], time_ms: number;
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body1));
  } catch (err: any) {
    turns.push({ turn: 1, message: msg1, endpoint, request_payload_keys: Object.keys(body1), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: false, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "4", endpoint, turns };
  }

  const text1 = envelope.assistant_text || "";
  const checks1: Check[] = [
    ...sseChecks(events, time_ms),
    chk("Non-empty response", text1.length > 0, `${text1.length} chars`),
    chk("No crash (has assistant_text)", typeof text1 === "string", typeof text1),
    ...bannedChecks(text1),
  ];
  logChecks(checks1);
  turns.push(buildTurnResult(1, msg1, endpoint, body1, envelope, events, time_ms, checks1, null));
  updateState(state, msg1, envelope);

  // ---- Turn 2: Very long message ----
  const longBrief = "We are a mid-size e-commerce company considering whether to implement dynamic pricing using AI or stick with our current manual pricing strategy. " +
    "Our product catalogue has about 15,000 SKUs across electronics, home goods, and fashion. Revenue last year was around twelve million pounds. " +
    "The AI pricing vendor quoted us one hundred and twenty thousand pounds per year for their platform, plus integration costs estimated at fifty thousand pounds. " +
    "Our current pricing team of three people costs about two hundred thousand pounds per year in total compensation. " +
    "Key concerns include: customer perception of dynamic pricing, competitor response, technical integration with our Shopify Plus store, " +
    "staff retraining or redeployment, regulatory compliance with UK consumer protection laws, and the accuracy of the AI model during seasonal peaks. " +
    "We need to decide within the next quarter as our annual pricing review cycle starts in July. " +
    "The board wants a recommendation that considers both the financial ROI and the strategic positioning implications. " +
    "Our CEO is leaning towards AI but our head of customer experience has raised concerns about trust and brand perception. " +
    "Additionally we should consider the fallback plan if the AI system underperforms in its first six months of operation.";

  const msg2 = longBrief;
  console.log(`\n--- ${label} / Turn 2: Long brief (${msg2.length} chars) ---`);
  const sid2 = randomUUID();
  const state2 = freshState();
  const body2 = buildRequestBody(sid2, msg2, state2);
  try {
    ({ envelope, events, time_ms } = await sendTurn(endpoint, body2));
  } catch (err: any) {
    turns.push({ turn: 2, message: msg2.slice(0, 100) + "...", endpoint, request_payload_keys: Object.keys(body2), response_envelope_keys: [], assistant_text_preview: "", stage: "", chips_count: 0, blocks_count: 0, session_state_present: false, graph_state_sent: false, analysis_state_sent: false, latency_ms: 0, latency_warning: false, checks: [], investigation: null, raw_response: {}, error: err.message });
    console.error("  FATAL:", err.message);
    return { journey: "4", endpoint, turns };
  }

  const text2 = envelope.assistant_text || "";
  const checks2: Check[] = [
    ...sseChecks(events, time_ms),
    chk("Non-empty response", text2.length > 0, `${text2.length} chars`),
    chk("Completed within 60s", time_ms < 60_000, `${(time_ms / 1000).toFixed(1)}s`),
    chk("Has graph_patch", (envelope.blocks || []).some((b: any) => b.type === "graph_patch" || b.block_type === "graph_patch"), ""),
    ...bannedChecks(text2),
  ];
  logChecks(checks2);
  turns.push(buildTurnResult(2, msg2.slice(0, 100) + "...", endpoint, body2, envelope, events, time_ms, checks2, null));

  return { journey: "4", endpoint, turns };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=== Phase 3 Staging Verification (v2 — state round-trip) ===");
  console.log(`Stream: ${STREAM_URL}`);
  console.log(`Sync:   ${SYNC_URL}`);
  console.log(`Key:    ${API_KEY.slice(0, 8)}...`);
  console.log(`Time:   ${new Date().toISOString()}\n`);

  const journeys: JourneyResult[] = [];

  // Run all journeys on SSE first, then sync
  for (const ep of ["stream", "sync"] as const) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ENDPOINT: ${ep.toUpperCase()}`);
    console.log(`${"=".repeat(60)}`);

    journeys.push(await journey1(ep));
    journeys.push(await journey2(ep));
    journeys.push(await journey3(ep));
    journeys.push(await journey4(ep));
  }

  // Aggregate
  const allChecks = journeys.flatMap((j) => j.turns.flatMap((t) => t.checks));
  const passed = allChecks.filter((c) => c.pass).length;
  const failed = allChecks.filter((c) => !c.pass).length;
  const investigated = journeys.flatMap((j) => j.turns).filter((t) => t.investigation).length;
  const errors = journeys.flatMap((j) => j.turns).filter((t) => t.error).length;

  const byEndpoint = (ep: string) => {
    const checks = journeys.filter((j) => j.endpoint === ep).flatMap((j) => j.turns.flatMap((t) => t.checks));
    return { passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length, count: checks.length };
  };

  console.log(`\n${"=".repeat(60)}`);
  console.log("  RESULTS");
  console.log(`${"=".repeat(60)}`);
  console.log(`TOTAL:   ${passed} passed, ${failed} failed, ${errors} errors, ${investigated} investigated out of ${allChecks.length} checks`);
  const sse = byEndpoint("stream");
  const sync = byEndpoint("sync");
  console.log(`SSE:     ${sse.passed} passed, ${sse.failed} failed out of ${sse.count}`);
  console.log(`Sync:    ${sync.passed} passed, ${sync.failed} failed out of ${sync.count}\n`);

  // Latency report
  const allTurns = journeys.flatMap((j) => j.turns).filter((t) => !t.error);
  const latencies = allTurns.map((t) => t.latency_ms);
  if (latencies.length > 0) {
    console.log(`Latency: min=${(Math.min(...latencies) / 1000).toFixed(1)}s, max=${(Math.max(...latencies) / 1000).toFixed(1)}s, avg=${(latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(1)}s`);
    const slow = allTurns.filter((t) => t.latency_warning);
    if (slow.length > 0) {
      console.log(`  \u26A0 ${slow.length} turns over 30s:`);
      for (const t of slow) console.log(`    J${journeys.find((j) => j.turns.includes(t))?.journey}/T${t.turn} (${t.endpoint}): ${(t.latency_ms / 1000).toFixed(1)}s`);
    }
  }

  if (failed > 0) {
    console.log("\nFAILURES:");
    for (const j of journeys) {
      for (const t of j.turns) {
        for (const c of t.checks.filter((c) => !c.pass)) {
          console.log(`  \u274C [J${j.journey}-${j.endpoint}/T${t.turn}] ${c.name}: ${c.detail.slice(0, 180)}`);
        }
      }
    }
  }

  if (investigated > 0) {
    console.log("\nINVESTIGATIONS:");
    for (const j of journeys) {
      for (const t of j.turns.filter((t) => t.investigation)) {
        console.log(`  \uD83D\uDD0D [J${j.journey}-${j.endpoint}/T${t.turn}] ${t.investigation!.failure}`);
        console.log(`     Root cause: ${t.investigation!.root_cause.slice(0, 200)}`);
        console.log(`     Fix: ${t.investigation!.recommended_fix} (${t.investigation!.fix_complexity})`);
      }
    }
  }

  if (errors > 0) {
    console.log("\nERRORS:");
    for (const j of journeys) {
      for (const t of j.turns.filter((t) => t.error)) {
        console.log(`  \u26A0\uFE0F [J${j.journey}-${j.endpoint}/T${t.turn}] ${t.error}`);
      }
    }
  }

  // Write results
  writeFileSync(
    "staging-verification-results.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        staging_url: CEE_URL,
        endpoints_tested: ["stream", "sync"],
        summary: {
          passed,
          failed,
          investigated,
          errors,
          total: allChecks.length,
          sse: byEndpoint("stream"),
          sync: byEndpoint("sync"),
        },
        journeys,
      },
      null,
      2,
    ),
  );
  console.log("\nResults written to staging-verification-results.json");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
