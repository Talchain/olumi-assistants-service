/**
 * HARNESS VISIBILITY — served-prompt capture.
 *
 * The gap this closes: runtime recorded `prompt_hash` / `prompt_version`
 * everywhere and the prompt BYTES nowhere, so nobody could answer "what did
 * we actually send to the model?" without shell access to a prompt store.
 *
 * ── WHY THE LOG-SAFETY TEST IS THE LOAD-BEARING ONE ───────────────────────
 * Capturing prompt bytes is only safe while they stay in the flag-gated,
 * in-memory, TTL-bounded store. `utils/logger-config.ts` states the channel
 * doctrine and its own residual: "a decision value logged under a NAME
 * nobody listed passes through". `system_prompt` is such a name. So the
 * suite does not merely assert the bytes are captured — it asserts they do
 * NOT reach the logger, and it PROVES THE PROBE CAN SEE A LEAK first.
 *
 * Every absence assertion here is paired with a presence proof, per the
 * doctrine in `logger-decision-content-redaction.test.ts`: an absence
 * assertion whose harness cannot see a presence is vacuous, and this estate
 * has already shipped exactly that (the 0-byte pino/sonic-boom capture).
 */

import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../../config/index.js';
import * as envResolver from '../../../config/env-resolver.js';
import { log } from '../../../utils/telemetry.js';
import {
  PROMPT_CAPTURE_MAX_CHARS,
  clearTurnDebugStore,
  getTurnDebug,
  getTurnDebugPromptCaptures,
  promptCaptureMayRideTheWire,
  recordPromptCapture,
  storeTurnDebug,
  type PromptCaptureInput,
} from '../turn-debug-store.js';

/**
 * High-entropy sentinel standing in for served prompt bytes. Cannot collide
 * with service vocabulary, so a hit is always a real leak.
 */
const PROMPT_SENTINEL =
  'SENTINEL-PROMPT-4b1d9e02 You are Olumi. Never invent a probability.';

/** Distinct sentinel for the user's half of the turn. */
const USER_SENTINEL = 'SENTINEL-USER-77c0aa31 should we acquire FintechCo for 50m';

const TURN = 'turn-harness-1';
const SESSION = 'session-harness-1';

function baseInput(overrides: Partial<PromptCaptureInput> = {}): PromptCaptureInput {
  return {
    task: 'draft_graph',
    systemPrompt: PROMPT_SENTINEL,
    meta: {
      prompt_hash: 'a'.repeat(64),
      prompt_version: 'draft_graph_default@v6 (staging)',
      promptId: 'prompt_abc',
      version: 6,
      source: 'store',
      isStaging: true,
      cache_status: 'fresh',
      instance_id: 'inst-1234',
    },
    resolution: {
      resolved_model: 'claude-sonnet-4-5',
      resolution_source: 'store_model_config',
      provider: 'anthropic',
    },
    ...overrides,
  };
}

/** The flag is DEFAULT-FALSE; every capture test must opt in explicitly. */
function withDebugFlag(enabled: boolean): void {
  (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = enabled;
}

let originalFlag: boolean;

beforeEach(() => {
  originalFlag = config.cee.turnDebugEnabled;
  clearTurnDebugStore();
});

afterEach(() => {
  withDebugFlag(originalFlag);
  clearTurnDebugStore();
  vi.restoreAllMocks();
});

describe('recordPromptCapture — the bytes and the identity', () => {
  it('captures the served prompt VERBATIM, not a hash or a preview', () => {
    withDebugFlag(true);
    recordPromptCapture(TURN, SESSION, baseInput());

    const captures = getTurnDebugPromptCaptures(TURN);
    expect(captures).toHaveLength(1);
    // The whole point of the change: bytes, identical, not truncated to a
    // 200-char preview the way CEE_PROMPT_DEBUG_ENABLED logs one today.
    expect(captures[0]!.system_prompt).toBe(PROMPT_SENTINEL);
    expect(captures[0]!.truncated).toBe(false);
    expect(captures[0]!.system_prompt_chars).toBe(PROMPT_SENTINEL.length);
  });

  it('carries the provenance that says WHICH prompt and WHICH model — bytes alone answer half the question', () => {
    withDebugFlag(true);
    recordPromptCapture(TURN, SESSION, baseInput());

    const c = getTurnDebugPromptCaptures(TURN)[0]!;
    expect(c.task).toBe('draft_graph');
    expect(c.prompt_version).toBe('draft_graph_default@v6 (staging)');
    expect(c.prompt_id).toBe('prompt_abc');
    expect(c.prompt_store_version).toBe(6);
    expect(c.prompt_source).toBe('store');
    expect(c.is_staging).toBe(true);
    expect(c.cache_status).toBe('fresh');
    expect(c.instance_id).toBe('inst-1234');
    expect(c.resolved_model).toBe('claude-sonnet-4-5');
    // The case the CEE_MODEL_* env vars do not explain, and the reason this
    // field is captured rather than inferred from configuration.
    expect(c.resolution_source).toBe('store_model_config');
    expect(c.provider).toBe('anthropic');
  });

  it('records the user half as a COUNT and a DIGEST, never as text', () => {
    withDebugFlag(true);
    recordPromptCapture(TURN, SESSION, baseInput({ userContent: USER_SENTINEL }));

    const c = getTurnDebugPromptCaptures(TURN)[0]!;
    expect(c.user_content_chars).toBe(USER_SENTINEL.length);
    expect(c.user_content_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The user's words must not be anywhere in the record, under ANY key.
    expect(JSON.stringify(c)).not.toContain(USER_SENTINEL);
  });

  it('hashes the ORIGINAL bytes when truncating, so the digest describes what was SENT', () => {
    withDebugFlag(true);
    const huge = 'X'.repeat(PROMPT_CAPTURE_MAX_CHARS + 500);
    recordPromptCapture(TURN, SESSION, baseInput({ systemPrompt: huge }));

    const c = getTurnDebugPromptCaptures(TURN)[0]!;
    expect(c.truncated).toBe(true);
    expect(c.system_prompt).toHaveLength(PROMPT_CAPTURE_MAX_CHARS);
    // Full length is reported even though the stored bytes are shorter …
    expect(c.system_prompt_chars).toBe(huge.length);
    // … and the digest is of the ORIGINAL. A digest over the truncated copy
    // would match nothing the model ever received: provenance-shaped, and
    // false.
    expect(c.system_prompt_sha256).toBe(
      createHash('sha256').update(huge).digest('hex'),
    );
  });

  it('is a NO-OP when CEE_TURN_DEBUG_ENABLED is false (the default posture)', () => {
    withDebugFlag(false);
    recordPromptCapture(TURN, SESSION, baseInput());
    expect(getTurnDebugPromptCaptures(TURN)).toEqual([]);
    expect(getTurnDebug(TURN)).toBeUndefined();
  });

  it('appends in call-order, so a multi-call turn shows every prompt it sent', () => {
    withDebugFlag(true);
    recordPromptCapture(TURN, SESSION, baseInput({ task: 'draft_graph' }));
    recordPromptCapture(TURN, SESSION, baseInput({ task: 'decision_review' }));

    expect(getTurnDebugPromptCaptures(TURN).map((c) => c.task)).toEqual([
      'draft_graph',
      'decision_review',
    ]);
  });

  it('survives a later storeTurnDebug overwrite — the CQE writer runs AFTER the prompt seam', () => {
    withDebugFlag(true);
    recordPromptCapture(TURN, SESSION, baseInput());
    // turn-executor's CQE write lands second on a real turn; if it clobbered
    // the captures, the capture would be invisible on every live draft.
    storeTurnDebug({
      turn_id: TURN,
      session_id: SESSION,
      stored_at: Date.now(),
      cqe: {
        parsed_quantities: [],
        patterns_matched: [],
        timeout: false,
        degraded: false,
        compromise_match_count: 0,
        duration_ms: 0,
        message_too_long: false,
        word_range_missed: false,
      },
    });
    expect(getTurnDebugPromptCaptures(TURN)).toHaveLength(1);
    expect(getTurnDebugPromptCaptures(TURN)[0]!.system_prompt).toBe(PROMPT_SENTINEL);
  });

  it('returns an empty array for an unknown turn rather than throwing', () => {
    withDebugFlag(true);
    expect(getTurnDebugPromptCaptures('never-stored')).toEqual([]);
  });
});

describe('⛔ CHANNEL SAFETY — captured prompt bytes must not reach the logger', () => {
  /** Spy every pino level and return the serialised arguments seen. */
  function spyLogger(): () => string {
    const seen: unknown[][] = [];
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      vi.spyOn(log, level).mockImplementation(((...args: unknown[]) => {
        seen.push(args);
        return undefined;
      }) as never);
    }
    return () =>
      seen
        .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
        .join('\n');
  }

  it('POSITIVE CONTROL: the probe DOES see prompt text when something logs it', () => {
    const readLog = spyLogger();
    // Deliberately leak, through the same logger the capture path could use.
    log.info({ some_field: PROMPT_SENTINEL }, 'deliberate control leak');
    // If this assertion ever fails, every absence assertion below is vacuous
    // and must not be believed.
    expect(readLog()).toContain(PROMPT_SENTINEL);
  });

  it('recording a capture emits NO log line containing the prompt bytes', () => {
    withDebugFlag(true);
    const readLog = spyLogger();

    recordPromptCapture(TURN, SESSION, baseInput({ userContent: USER_SENTINEL }));

    const logged = readLog();
    expect(logged).not.toContain(PROMPT_SENTINEL);
    expect(logged).not.toContain(USER_SENTINEL);
    // …and the bytes really were captured, so the absence above is about a
    // silent channel, not about a capture that never happened.
    expect(getTurnDebugPromptCaptures(TURN)[0]!.system_prompt).toBe(PROMPT_SENTINEL);
  });

  it('reading captures back emits NO log line containing the prompt bytes', () => {
    withDebugFlag(true);
    recordPromptCapture(TURN, SESSION, baseInput());
    const readLog = spyLogger();

    const captures = getTurnDebugPromptCaptures(TURN);

    expect(captures[0]!.system_prompt).toBe(PROMPT_SENTINEL);
    expect(readLog()).not.toContain(PROMPT_SENTINEL);
  });
});

describe('promptCaptureMayRideTheWire — the UNAUTHENTICATED surface is narrower than the admin one', () => {
  function pinEnv(env: 'local' | 'test' | 'staging' | 'prod'): void {
    vi.spyOn(envResolver, 'getRuntimeEnv').mockReturnValue(env);
  }

  it('permits the wire sidecar on staging when the flag is on', () => {
    withDebugFlag(true);
    pinEnv('staging');
    expect(promptCaptureMayRideTheWire()).toBe(true);
  });

  it('⛔ REFUSES in production even when the flag is on', () => {
    withDebugFlag(true);
    pinEnv('prod');
    // `CEE_TURN_DEBUG_ENABLED` is a plain booleanString with no prod
    // enforcement (unlike CEE_OBSERVABILITY_RAW_IO). If this conjunct is
    // dropped, a prod env value alone puts prompt bytes on the open wire.
    expect(promptCaptureMayRideTheWire()).toBe(false);
  });

  it('refuses on staging when the flag is off — both conjuncts are required', () => {
    withDebugFlag(false);
    pinEnv('staging');
    expect(promptCaptureMayRideTheWire()).toBe(false);
  });
});
