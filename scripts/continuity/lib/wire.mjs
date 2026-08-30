/**
 * The deployed-wire client for the continuity harness.
 *
 * This drives the REAL product at the REAL surface the browser uses:
 * `POST /proxy/v5/turn` with the UI's Origin. It never imports application
 * code, never stubs a handler, and never asserts against a fixture it wrote
 * itself. A source read proves presence-in-repo; only this proves
 * presence-on-the-live-wire.
 *
 * INGRESS CONTRACT — derived from the deployed validator at caceba1a, not
 * inherited from a document. Sending `{}` and then a series of deliberately
 * invalid values made the B1 validator (`OrchestratorTurnPayload`) enumerate
 * its own requirements:
 *   kind        : 'message' | 'system_event'
 *   turn_id     : uuid
 *   scenario_id : uuid
 *   stage       : 'frame' | 'analyse' | 'decide' | 'review'
 *   turn_class  : 'frame' | 'clarify' | 'propose' | 'decide' | 'review'
 *   source      : 'composer' | 'chip' | 'chip_click' | 'retry'
 *   message     : string
 * If a future tip changes these, this client's requests will 422 and the
 * harness will report COULD_NOT_MEASURE rather than quietly testing nothing.
 *
 * NOTE ON WHAT IS *NOT* SENT: no graph. CEE reloads its own persisted graph
 * for the scenario. Sending one here would fabricate a continuity the product
 * does not actually have, which is the precise failure this harness exists to
 * detect.
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact.mjs';

export const DEFAULT_BASE = process.env.CEE_BASE_URL || 'https://cee-staging.onrender.com';
export const UI_ORIGIN = process.env.CONTINUITY_ORIGIN || 'https://staging--olumi.netlify.app';

const TURN_TIMEOUT_MS = Number(process.env.CONTINUITY_TURN_TIMEOUT_MS || 200_000);

/** Transport-only retry budget. Never applied to a response the product actually gave. */
const TRANSPORT_ATTEMPTS = Number(process.env.CONTINUITY_TRANSPORT_ATTEMPTS || 3);
const TRANSPORT_BACKOFF_MS = Number(process.env.CONTINUITY_TRANSPORT_BACKOFF_MS || 1500);

export const STAGES = ['frame', 'analyse', 'decide', 'review'];
export const TURN_CLASSES = ['frame', 'clarify', 'propose', 'decide', 'review'];
export const SOURCES = ['composer', 'chip', 'chip_click', 'retry'];

/**
 * Derive the deployed build. NEVER inherit it from a brief or a document.
 *
 * The harness refuses to run against an unexpected build: a green battery
 * against the wrong SHA is worse than no battery, because it will be quoted.
 */
export async function deriveBuild(base = DEFAULT_BASE) {
  const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`healthz returned HTTP ${res.status}`);
  const body = await res.json();
  return { build: body.build, version: body.version, degraded: body.degraded, raw: body };
}

export class TurnClient {
  constructor({ base = DEFAULT_BASE, evidenceDir = null } = {}) {
    this.base = base;
    this.evidenceDir = evidenceDir;
    this.captureIndex = 0;
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  }

  newScenario() {
    return randomUUID();
  }

  /**
   * Send one turn. Returns { ok, status, body, text, latencyMs, captureFile }.
   *
   * Redaction happens HERE, at capture time — before the body is written to
   * disk and before it is returned to any caller. Nothing downstream is
   * trusted to remember to redact.
   */
  async turn({
    scenarioId,
    message,
    stage = 'analyse',
    turnClass = 'clarify',
    source = 'composer',
    label = 'turn',
  }) {
    if (!STAGES.includes(stage)) throw new Error(`invalid stage: ${stage}`);
    if (!TURN_CLASSES.includes(turnClass)) throw new Error(`invalid turn_class: ${turnClass}`);
    if (!SOURCES.includes(source)) throw new Error(`invalid source: ${source}`);

    const payload = {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: scenarioId,
      stage,
      message,
      turn_class: turnClass,
      source,
    };

    const started = Date.now();
    let status = 0;
    let body = null;
    let networkError = null;
    let transportAttempts = 0;

    /**
     * BOUNDED TRANSPORT RETRY — and note carefully what it does NOT do.
     *
     * Running several cases against a hosted service produces occasional
     * connection-level failures (`fetch failed` in ~100ms, well before any
     * server work). Those are facts about the network, not about continuity,
     * and letting them void cases would make the battery unusable while
     * teaching readers to ignore COULD_NOT_MEASURE — the worst outcome, since
     * that verdict is the harness's whole honesty mechanism.
     *
     * So a TRANSPORT failure is retried. A 200 carrying a wrong answer is
     * never retried, and neither is a 4xx: those are results. The retry is
     * strictly about reaching the product, never about liking what it said.
     * If the budget is exhausted the turn still fails and the case still
     * reports COULD_NOT_MEASURE.
     */
    for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt += 1) {
      transportAttempts = attempt;
      networkError = null;
      try {
        const res = await fetch(`${this.base}/proxy/v5/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: UI_ORIGIN },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
        });
        status = res.status;
        const raw = await res.text();
        try {
          body = JSON.parse(raw);
        } catch {
          body = { __unparsed: raw.slice(0, 4000) };
        }
        // A 5xx is the server failing to reach its own work — retryable.
        // Anything else, including a 422 contract violation, is a RESULT.
        if (status < 500) break;
      } catch (err) {
        networkError = String(err && err.message ? err.message : err);
      }
      if (attempt < TRANSPORT_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, TRANSPORT_BACKOFF_MS * attempt));
      }
    }

    const latencyMs = Date.now() - started;

    // ---- CAPTURE-TIME REDACTION -----------------------------------------
    const { value: safeBody, hits } = redact(body);
    const { value: safePayload } = redact(payload);

    let captureFile = null;
    if (this.evidenceDir) {
      this.captureIndex += 1;
      const name = `${String(this.captureIndex).padStart(3, '0')}-${label.replace(/[^a-z0-9_-]/gi, '_')}.json`;
      captureFile = join(this.evidenceDir, name);
      writeFileSync(
        captureFile,
        JSON.stringify(
          {
            label,
            request: safePayload,
            http_status: status,
            network_error: networkError,
            latency_ms: latencyMs,
            transport_attempts: transportAttempts,
            redaction_hits: hits,
            response: safeBody,
          },
          null,
          2,
        ),
      );
    }

    return {
      ok: status === 200 && !networkError,
      status,
      networkError,
      body: safeBody,
      text: assistantText(safeBody),
      latencyMs,
      transportAttempts,
      captureFile,
      redactionHits: hits,
    };
  }
}

/** The user-visible prose of a turn. This is what a person actually reads. */
export function assistantText(body) {
  if (!body || typeof body !== 'object') return '';
  return typeof body.assistant_text === 'string' ? body.assistant_text : '';
}

/** `analysis_ready` is a TOP-LEVEL response key. `analysis_result` is a BLOCK type. */
export function analysisReady(body) {
  return (body && body.analysis_ready) || null;
}

export function suggestedActions(body) {
  return (body && Array.isArray(body.suggested_actions) ? body.suggested_actions : []);
}

export function graphHash(body) {
  return body ? body.graph_hash : undefined;
}

export function draftGraph(body) {
  return (body && body.draft_graph) || null;
}

/** Case-insensitive containment, used only where a label is bound by identity elsewhere. */
export function mentions(text, needle) {
  if (!text || !needle) return false;
  return String(text).toLowerCase().includes(String(needle).toLowerCase());
}
