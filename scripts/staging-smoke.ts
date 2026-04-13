/**
 * Phase 3: Staging Verification Smoke Test
 *
 * Primary path: SSE stream endpoint (/orchestrate/v1/turn/stream)
 * Secondary path: sync endpoint (/orchestrate/v1/turn)
 *
 * Parses the SSE event stream, extracts the turn_complete envelope,
 * and validates it against Phase 3 acceptance criteria.
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

interface TurnResult {
  turn: number;
  endpoint: "stream" | "sync";
  checks: Check[];
  raw_response: Record<string, unknown>;
  sse_meta?: { event_count: number; event_types: string[]; time_ms: number };
  error?: string;
}

interface JourneyResult {
  journey: string;
  turns: TurnResult[];
}

interface SseEvent {
  type: string;
  data: any;
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
      if (line.startsWith("event: ")) {
        eventType = line.substring(7).trim();
      } else if (line.startsWith("data: ")) {
        dataLines.push(line.substring(6));
      } else if (line.startsWith(": ")) {
        eventType = "heartbeat";
      }
    }

    if (!eventType) continue;

    if (eventType === "heartbeat" || dataLines.length === 0) {
      events.push({ type: "heartbeat", data: null });
    } else {
      try {
        const data = JSON.parse(dataLines.join("\n"));
        events.push({ type: eventType, data });
      } catch {
        // skip malformed
      }
    }
  }
  return events;
}

/**
 * Send a turn via the SSE stream endpoint. Reads the full stream,
 * parses all events, and returns the turn_complete envelope.
 */
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

    // Check if we got SSE or a JSON response (idempotency cache hit)
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      return { envelope: json, events: [], time_ms: Date.now() - t0 };
    }

    // Read the full SSE stream
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const allEvents: SseEvent[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse complete events from buffer
      const parts = buffer.split("\n\n");
      // Keep last (possibly incomplete) part in buffer
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;
        const parsed = parseSseChunk(part + "\n\n");
        allEvents.push(...parsed);
      }
    }

    // Parse any remaining buffer
    if (buffer.trim()) {
      allEvents.push(...parseSseChunk(buffer + "\n\n"));
    }

    const time_ms = Date.now() - t0;

    // Find the turn_complete event
    const turnComplete = allEvents.find((e) => e.type === "turn_complete");
    if (!turnComplete) {
      // Check for error event
      const errorEvent = allEvents.find((e) => e.type === "error");
      if (errorEvent) {
        throw new Error(
          `SSE error event: ${errorEvent.data?.error?.code}: ${errorEvent.data?.error?.message}`,
        );
      }
      throw new Error(
        `No turn_complete event in SSE stream (${allEvents.length} events: ${allEvents.map((e) => e.type).join(", ")})`,
      );
    }

    return { envelope: turnComplete.data.envelope, events: allEvents, time_ms };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a turn via the sync endpoint.
 */
async function sendTurnSync(body: Record<string, unknown>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Sync HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function truncate(s: string, max = 2000): string {
  return s.length > max ? s.slice(0, max) + "...[truncated]" : s;
}

/**
 * Extract the stage string from stage_indicator.
 * stage_indicator can be a string or an object {stage, confidence, source}.
 */
function getStage(env: any): string {
  const si = env.stage_indicator;
  if (!si) return "";
  if (typeof si === "string") return si;
  if (typeof si === "object" && si.stage) return si.stage;
  return "";
}

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const BANNED_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "factor IDs (fac_*)", re: /\bfac_\w+/ },
  { label: "option IDs (opt_*)", re: /\bopt_\w+/ },
  { label: "risk IDs (risk_*)", re: /\brisk_\w+/ },
  { label: "outcome IDs (out_*)", re: /\bout_\w+/ },
  { label: "goal IDs (goal_*)", re: /\bgoal_\w+/ },
  { label: "decision IDs (dec_*)", re: /\bdec_\w+/ },
  { label: "em dash", re: /\u2014/ },
  { label: "en dash", re: /\u2013/ },
  { label: '"recommended"', re: /\brecommended\b/i },
  { label: '"winner"', re: /\bwinner\b/i },
];

function bannedChecks(text: string): Check[] {
  return BANNED_PATTERNS.map(({ label, re }) => {
    const match = text.match(re);
    return {
      name: `No banned: ${label}`,
      pass: !match,
      detail: match
        ? `Found "${match[0]}" near: "...${text.slice(
            Math.max(0, text.indexOf(match[0]) - 20),
            text.indexOf(match[0]) + 30,
          )}..."`
        : "clean",
    };
  });
}

function chk(name: string, pass: boolean, detail: unknown): Check {
  return { name, pass, detail: String(detail ?? "") };
}

function logChecks(checks: Check[]) {
  for (const c of checks) {
    console.log(
      `  ${c.pass ? "\u2705" : "\u274C"} ${c.name}: ${c.detail.slice(0, 120)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Envelope validators (shared between SSE and sync)
// ---------------------------------------------------------------------------

function draftChecks(env: any, label: string): Check[] {
  const text: string = env.assistant_text || "";
  const chips: any[] = env.suggested_actions || [];
  const blocks: any[] = env.blocks || [];

  return [
    chk(
      "No component counts",
      !/\d+\s*(factors?|nodes?|edges?|connections?)/i.test(text),
      text.slice(0, 200),
    ),
    chk(
      "No confirmation prose",
      !/confirm to apply/i.test(text),
      text.slice(0, 100),
    ),
    chk(
      "Decision-first language",
      /trade|leadership|capacity|delivery|hire|developer|lead|junior|runway|marketing|tool|launch|campaign|budget/i.test(
        text,
      ),
      text.slice(0, 200),
    ),
    chk(
      "Has 1-3 chips",
      chips.length >= 1 && chips.length <= 3,
      `${chips.length} chips: ${chips.map((c: any) => c.label || c.text || "?").join(", ")}`,
    ),
    chk(
      "All chips have action_type",
      chips.length === 0 || chips.every((c: any) => c.action_type),
      chips.map((c: any) => `${c.label}:${c.action_type}`).join(", ") ||
        "(empty)",
    ),
    chk(
      "Has graph_patch block",
      blocks.some(
        (b: any) =>
          b.type === "graph_patch" || b.block_type === "graph_patch",
      ),
      `${blocks.length} blocks: ${blocks.map((b: any) => b.type || b.block_type).join(", ")}`,
    ),
    chk(
      "Session state present",
      env.updated_session_state != null,
      env.updated_session_state
        ? JSON.stringify(env.updated_session_state).slice(0, 100)
        : "null",
    ),
    chk(
      "Stage indicator present",
      !!getStage(env),
      getStage(env) || "missing",
    ),
    ...bannedChecks(text),
  ];
}

function evidenceChecks(env: any): Check[] {
  const text: string = env.assistant_text || "";
  const firstSentence = text.split(/[.!?]/)[0] || "";
  return [
    chk(
      "Decision impact in first sentence",
      /salary|budget|cost|expensive|affordable|impact|constrain|limit/i.test(
        firstSentence,
      ),
      `First sentence: "${firstSentence.slice(0, 150)}"`,
    ),
    chk(
      "No operation-first language",
      !/^(updating|setting|changing|modifying)\s/i.test(text.trim()),
      text.slice(0, 100),
    ),
    chk("No confirmation prose", !/confirm to apply/i.test(text), text.slice(0, 100)),
    ...bannedChecks(text),
  ];
}

function proposalChecks(env: any): Check[] {
  const text: string = env.assistant_text || "";
  const blocks: any[] = env.blocks || [];
  const hasPatch = blocks.some(
    (b: any) => b.type === "graph_patch" || b.block_type === "graph_patch",
  );
  const sentences = text
    .split(/[.!?]+/)
    .filter((s: string) => s.trim().length > 0);

  const checks: Check[] = [
    chk("No confirmation prose", !/confirm to apply/i.test(text), text.slice(0, 200)),
  ];
  if (hasPatch) {
    checks.push(
      chk(
        "Orientation only (<=2 sentences with patch)",
        sentences.length <= 2,
        `${sentences.length} sentences`,
      ),
    );
  }
  for (const block of blocks) {
    const summary = (block as any).summary || "";
    if (summary) {
      checks.push(
        chk(
          "No count-based summary",
          !/\d+\s*(factors?|nodes?|edges?|connections?)/i.test(summary),
          summary.slice(0, 100),
        ),
      );
    }
  }
  checks.push(...bannedChecks(text));
  return checks;
}

function analysisChecks(env: any): Check[] {
  const text: string = env.assistant_text || "";
  return [
    chk("Has assistant_text", text.length > 0, `${text.length} chars`),
    chk("Stage is evaluate", getStage(env) === "evaluate", getStage(env) || "missing"),
    ...bannedChecks(text),
  ];
}

function explainChecks(env: any): Check[] {
  const text: string = env.assistant_text || "";
  const chips: any[] = env.suggested_actions || [];
  return [
    chk(
      'No "action unavailable"',
      !/action.*not available|isn't available/i.test(text),
      text.slice(0, 200),
    ),
    chk(
      "Contains analytical content",
      /%|leads|probability|driver|sensitive|factor|likely|outcome/i.test(text),
      text.slice(0, 200),
    ),
    chk(
      "All chips have action_type",
      chips.length === 0 || chips.every((c: any) => c.action_type),
      chips.map((c: any) => `${c.label}:${c.action_type}`).join(", ") || "no chips",
    ),
    chk("Stage is evaluate", getStage(env) === "evaluate", getStage(env) || "missing"),
    ...bannedChecks(text),
  ];
}

function flipChecks(env: any): Check[] {
  const text: string = env.assistant_text || "";
  const chips: any[] = env.suggested_actions || [];
  return [
    chk(
      'No "action unavailable"',
      !/action.*not available|isn't available/i.test(text),
      text.slice(0, 200),
    ),
    chk(
      "Contains flip/change language",
      /flip|change|threshold|swing|reversal|shift|sensitive|adjust/i.test(text),
      text.slice(0, 200),
    ),
    chk(
      "All chips have action_type",
      chips.length === 0 || chips.every((c: any) => c.action_type),
      chips.map((c: any) => `${c.label}:${c.action_type}`).join(", ") || "no chips",
    ),
    ...bannedChecks(text),
  ];
}

// ---------------------------------------------------------------------------
// SSE-specific checks
// ---------------------------------------------------------------------------

function sseStreamChecks(events: SseEvent[], time_ms: number): Check[] {
  const types = events.map((e) => e.type);
  const hasStart = types.includes("turn_start");
  const hasComplete = types.includes("turn_complete");
  const hasError = types.includes("error");
  const textDeltas = events.filter((e) => e.type === "text_delta");

  return [
    chk("SSE has turn_start event", hasStart, types.slice(0, 5).join(", ")),
    chk("SSE has turn_complete event", hasComplete, `${types.length} events total`),
    chk("SSE no error event", !hasError,
      hasError
        ? events.find((e) => e.type === "error")?.data?.error?.message || "error"
        : "clean",
    ),
    chk(
      "SSE has text_delta events",
      textDeltas.length > 0,
      `${textDeltas.length} text deltas`,
    ),
    chk(
      "SSE completed within timeout",
      time_ms < TIMEOUT_MS,
      `${(time_ms / 1000).toFixed(1)}s`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Journey 1 (SSE): Draft + edit + evidence absorption
// ---------------------------------------------------------------------------

async function journey1SSE(): Promise<JourneyResult> {
  const sid = randomUUID();
  const turns: TurnResult[] = [];
  let history: Array<{ role: string; content: string }> = [];

  // ---- Turn 1: Draft ----
  console.log("\n--- J1-SSE / Turn 1: Draft ---");
  let envelope: any;
  let events: SseEvent[] = [];
  let time_ms = 0;
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message:
        "Should I hire a tech lead or two junior developers for my startup? We have 18 months of runway and need to ship a product rewrite.",
      conversation_history: [],
    }));
  } catch (err: any) {
    turns.push({
      turn: 1, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "1-sse", turns };
  }

  const checks1 = [
    ...sseStreamChecks(events, time_ms),
    ...draftChecks(envelope, "hire-draft"),
  ];
  logChecks(checks1);
  turns.push({
    turn: 1,
    endpoint: "stream",
    checks: checks1,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  const text1 = envelope.assistant_text || "";
  history = [
    {
      role: "user",
      content:
        "Should I hire a tech lead or two junior developers for my startup? We have 18 months of runway and need to ship a product rewrite.",
    },
    { role: "assistant", content: text1 },
  ];

  // ---- Turn 2: Evidence absorption ----
  console.log("\n--- J1-SSE / Turn 2: Evidence absorption ---");
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message: "The salary budget is \u00a385,000 per year for this role.",
      conversation_history: history,
    }));
  } catch (err: any) {
    turns.push({
      turn: 2, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "1-sse", turns };
  }

  const checks2 = [
    ...sseStreamChecks(events, time_ms),
    ...evidenceChecks(envelope),
  ];
  logChecks(checks2);
  turns.push({
    turn: 2,
    endpoint: "stream",
    checks: checks2,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  history.push(
    { role: "user", content: "The salary budget is \u00a385,000 per year for this role." },
    { role: "assistant", content: envelope.assistant_text || "" },
  );

  // ---- Turn 3: Add factor (proposal card) ----
  console.log("\n--- J1-SSE / Turn 3: Add factor (proposal card) ---");
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message: "Add a factor for onboarding time",
      conversation_history: history,
    }));
  } catch (err: any) {
    turns.push({
      turn: 3, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "1-sse", turns };
  }

  const checks3 = [
    ...sseStreamChecks(events, time_ms),
    ...proposalChecks(envelope),
  ];
  logChecks(checks3);
  turns.push({
    turn: 3,
    endpoint: "stream",
    checks: checks3,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  return { journey: "1-sse", turns };
}

// ---------------------------------------------------------------------------
// Journey 2 (SSE): Analysis + explain + flip
// ---------------------------------------------------------------------------

async function journey2SSE(): Promise<JourneyResult> {
  const sid = randomUUID();
  const turns: TurnResult[] = [];
  let history: Array<{ role: string; content: string }> = [];

  // ---- Turn 1: Draft ----
  console.log("\n--- J2-SSE / Turn 1: Draft ---");
  let envelope: any;
  let events: SseEvent[] = [];
  let time_ms = 0;
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message:
        "Should I hire a marketing manager or use an AI marketing tool for our product launch campaign? Budget is around \u00a350,000.",
      conversation_history: [],
    }));
  } catch (err: any) {
    turns.push({
      turn: 1, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "2-sse", turns };
  }

  const checks1 = [
    ...sseStreamChecks(events, time_ms),
    ...draftChecks(envelope, "marketing-draft"),
  ];
  logChecks(checks1);
  turns.push({
    turn: 1,
    endpoint: "stream",
    checks: checks1,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  const text1 = envelope.assistant_text || "";
  history = [
    {
      role: "user",
      content:
        "Should I hire a marketing manager or use an AI marketing tool for our product launch campaign? Budget is around \u00a350,000.",
    },
    { role: "assistant", content: text1 },
  ];

  // ---- Turn 2: Run analysis ----
  console.log("\n--- J2-SSE / Turn 2: Run analysis ---");
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message: "Run the analysis",
      conversation_history: history,
    }));
  } catch (err: any) {
    turns.push({
      turn: 2, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "2-sse", turns };
  }

  const checks2 = [
    ...sseStreamChecks(events, time_ms),
    ...analysisChecks(envelope),
  ];
  logChecks(checks2);
  turns.push({
    turn: 2,
    endpoint: "stream",
    checks: checks2,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  history.push(
    { role: "user", content: "Run the analysis" },
    { role: "assistant", content: envelope.assistant_text || "" },
  );

  // ---- Turn 3: Explain results ----
  console.log("\n--- J2-SSE / Turn 3: Explain results ---");
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message: "Can you explain the analysis results to me?",
      conversation_history: history,
    }));
  } catch (err: any) {
    turns.push({
      turn: 3, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "2-sse", turns };
  }

  const checks3 = [
    ...sseStreamChecks(events, time_ms),
    ...explainChecks(envelope),
  ];
  logChecks(checks3);
  turns.push({
    turn: 3,
    endpoint: "stream",
    checks: checks3,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  history.push(
    { role: "user", content: "Can you explain the analysis results to me?" },
    { role: "assistant", content: envelope.assistant_text || "" },
  );

  // ---- Turn 4: Flip ----
  console.log("\n--- J2-SSE / Turn 4: What would flip the result? ---");
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message: "What would need to change to flip this result?",
      conversation_history: history,
    }));
  } catch (err: any) {
    turns.push({
      turn: 4, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "2-sse", turns };
  }

  const checks4 = [
    ...sseStreamChecks(events, time_ms),
    ...flipChecks(envelope),
  ];
  logChecks(checks4);
  turns.push({
    turn: 4,
    endpoint: "stream",
    checks: checks4,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  return { journey: "2-sse", turns };
}

// ---------------------------------------------------------------------------
// Journey 3 (SSE): Session state round-trip
// ---------------------------------------------------------------------------

async function journey3SSE(): Promise<JourneyResult> {
  const sid = randomUUID();
  const turns: TurnResult[] = [];

  // ---- Turn 1: Draft ----
  console.log("\n--- J3-SSE / Turn 1: Draft (session state test) ---");
  let envelope: any;
  let events: SseEvent[] = [];
  let time_ms = 0;
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message:
        "Should I hire a tech lead or two junior developers for my startup? We have 18 months of runway and need to ship a product rewrite.",
      conversation_history: [],
    }));
  } catch (err: any) {
    turns.push({
      turn: 1, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "3-sse", turns };
  }

  const checks1: Check[] = [
    ...sseStreamChecks(events, time_ms),
    chk(
      "Session state present",
      envelope.updated_session_state != null,
      envelope.updated_session_state
        ? JSON.stringify(envelope.updated_session_state).slice(0, 150)
        : "null",
    ),
  ];
  logChecks(checks1);
  turns.push({
    turn: 1,
    endpoint: "stream",
    checks: checks1,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  // ---- Turn 2: Round-trip session state ----
  console.log("\n--- J3-SSE / Turn 2: Session state round-trip ---");
  try {
    ({ envelope, events, time_ms } = await sendTurnSSE({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message: "Tell me more about the key assumptions in this model.",
      conversation_history: [
        {
          role: "user",
          content:
            "Should I hire a tech lead or two junior developers for my startup?",
        },
        { role: "assistant", content: envelope.assistant_text || "" },
      ],
      session_state: envelope.updated_session_state,
    }));
  } catch (err: any) {
    turns.push({
      turn: 2, endpoint: "stream", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "3-sse", turns };
  }

  const checks2: Check[] = [
    ...sseStreamChecks(events, time_ms),
    chk(
      "Returns session state",
      envelope.updated_session_state != null,
      envelope.updated_session_state
        ? JSON.stringify(envelope.updated_session_state).slice(0, 200)
        : "null",
    ),
  ];
  if (envelope.updated_session_state) {
    const ss = envelope.updated_session_state;
    checks2.push(
      chk(
        "Has expected fields",
        "plays_fired" in ss || "predictions" in ss || "calibrations_provided" in ss,
        Object.keys(ss).join(", "),
      ),
    );
  }
  logChecks(checks2);
  turns.push({
    turn: 2,
    endpoint: "stream",
    checks: checks2,
    raw_response: { ...envelope, assistant_text: truncate(envelope.assistant_text || "") },
    sse_meta: {
      event_count: events.length,
      event_types: [...new Set(events.map((e) => e.type))],
      time_ms,
    },
  });

  return { journey: "3-sse", turns };
}

// ---------------------------------------------------------------------------
// Journey 4 (Sync): Confirm /orchestrate/v1/turn works the same
// ---------------------------------------------------------------------------

async function journey4Sync(): Promise<JourneyResult> {
  const sid = randomUUID();
  const turns: TurnResult[] = [];
  let history: Array<{ role: string; content: string }> = [];

  // ---- Turn 1: Draft via sync ----
  console.log("\n--- J4-Sync / Turn 1: Draft (sync confirmation) ---");
  let env: any;
  try {
    env = await sendTurnSync({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message:
        "Should I hire a tech lead or two junior developers for my startup? We have 18 months of runway and need to ship a product rewrite.",
      conversation_history: [],
    });
  } catch (err: any) {
    turns.push({
      turn: 1, endpoint: "sync", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "4-sync", turns };
  }

  const checks1 = draftChecks(env, "hire-draft-sync");
  logChecks(checks1);
  turns.push({
    turn: 1,
    endpoint: "sync",
    checks: checks1,
    raw_response: { ...env, assistant_text: truncate(env.assistant_text || "") },
  });

  const text1 = env.assistant_text || "";
  history = [
    {
      role: "user",
      content:
        "Should I hire a tech lead or two junior developers for my startup? We have 18 months of runway and need to ship a product rewrite.",
    },
    { role: "assistant", content: text1 },
  ];

  // ---- Turn 2: Evidence absorption via sync ----
  console.log("\n--- J4-Sync / Turn 2: Evidence absorption (sync confirmation) ---");
  try {
    env = await sendTurnSync({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message: "The salary budget is \u00a385,000 per year for this role.",
      conversation_history: history,
    });
  } catch (err: any) {
    turns.push({
      turn: 2, endpoint: "sync", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "4-sync", turns };
  }

  const checks2 = evidenceChecks(env);
  logChecks(checks2);
  turns.push({
    turn: 2,
    endpoint: "sync",
    checks: checks2,
    raw_response: { ...env, assistant_text: truncate(env.assistant_text || "") },
  });

  history.push(
    { role: "user", content: "The salary budget is \u00a385,000 per year for this role." },
    { role: "assistant", content: env.assistant_text || "" },
  );

  // ---- Turn 3: Run analysis via sync ----
  console.log("\n--- J4-Sync / Turn 3: Run analysis (sync confirmation) ---");
  try {
    env = await sendTurnSync({
      scenario_id: sid,
      client_turn_id: randomUUID(),
      message: "Run the analysis",
      conversation_history: history,
    });
  } catch (err: any) {
    turns.push({
      turn: 3, endpoint: "sync", checks: [], raw_response: {}, error: err.message,
    });
    console.error("  FATAL:", err.message);
    return { journey: "4-sync", turns };
  }

  const checks3 = analysisChecks(env);
  logChecks(checks3);
  turns.push({
    turn: 3,
    endpoint: "sync",
    checks: checks3,
    raw_response: { ...env, assistant_text: truncate(env.assistant_text || "") },
  });

  return { journey: "4-sync", turns };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Phase 3 Staging Verification ===");
  console.log(`Stream: ${STREAM_URL}`);
  console.log(`Sync:   ${SYNC_URL}`);
  console.log(`Key:    ${API_KEY.slice(0, 8)}...`);
  console.log(`Time:   ${new Date().toISOString()}\n`);

  const journeys: JourneyResult[] = [];

  // Primary: SSE journeys
  journeys.push(await journey1SSE());
  journeys.push(await journey2SSE());
  journeys.push(await journey3SSE());

  // Secondary: Sync confirmation
  journeys.push(await journey4Sync());

  // Aggregate
  const allChecks = journeys.flatMap((j) => j.turns.flatMap((t) => t.checks));
  const passed = allChecks.filter((c) => c.pass).length;
  const failed = allChecks.filter((c) => !c.pass).length;
  const errors = journeys.flatMap((j) => j.turns).filter((t) => t.error).length;

  const sseChecks = journeys
    .filter((j) => j.journey.includes("sse"))
    .flatMap((j) => j.turns.flatMap((t) => t.checks));
  const ssePassed = sseChecks.filter((c) => c.pass).length;
  const sseFailed = sseChecks.filter((c) => !c.pass).length;

  const syncChecks = journeys
    .filter((j) => j.journey.includes("sync"))
    .flatMap((j) => j.turns.flatMap((t) => t.checks));
  const syncPassed = syncChecks.filter((c) => c.pass).length;
  const syncFailed = syncChecks.filter((c) => !c.pass).length;

  console.log("\n=== RESULTS ===");
  console.log(
    `TOTAL:  ${passed} passed, ${failed} failed, ${errors} errors out of ${allChecks.length} checks`,
  );
  console.log(
    `SSE:    ${ssePassed} passed, ${sseFailed} failed out of ${sseChecks.length}`,
  );
  console.log(
    `Sync:   ${syncPassed} passed, ${syncFailed} failed out of ${syncChecks.length}\n`,
  );

  if (failed > 0) {
    console.log("FAILURES:");
    for (const j of journeys) {
      for (const t of j.turns) {
        for (const c of t.checks.filter((c) => !c.pass)) {
          console.log(
            `  \u274C [${j.journey}/T${t.turn}] ${c.name}: ${c.detail.slice(0, 200)}`,
          );
        }
      }
    }
  }

  if (errors > 0) {
    console.log("\nERRORS:");
    for (const j of journeys) {
      for (const t of j.turns.filter((t) => t.error)) {
        console.log(`  \u26A0\uFE0F [${j.journey}/T${t.turn}] ${t.error}`);
      }
    }
  }

  // Write results
  const output = {
    timestamp: new Date().toISOString(),
    staging_url: CEE_URL,
    endpoints: { stream: STREAM_URL, sync: SYNC_URL },
    summary: {
      total: { passed, failed, errors, count: allChecks.length },
      sse: { passed: ssePassed, failed: sseFailed, count: sseChecks.length },
      sync: { passed: syncPassed, failed: syncFailed, count: syncChecks.length },
    },
    journeys,
  };

  writeFileSync(
    "staging-verification-results.json",
    JSON.stringify(output, null, 2),
  );
  console.log("\nResults written to staging-verification-results.json");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
