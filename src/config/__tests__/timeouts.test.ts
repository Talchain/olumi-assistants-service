/**
 * ROADMAP 2.73 Fix B — decision_review timeout code default.
 *
 * The 15-Jul Paul-session RCA (RC5) observed the decision_review call
 * aborting at 15,002ms against a 15,000ms budget — a coin flip at observed
 * gpt-4.1 latencies (~9.7-11.6s). Staging survives via an env override
 * (DECISION_REVIEW_TIMEOUT_MS=22000); this pin makes the CODE default
 * carry the mitigation so an environment without the override (e.g. prod)
 * does not silently re-inherit the coin flip.
 *
 * Value-pinned deliberately: a drift back toward 15s must be a conscious,
 * reviewed decision, not a refactor casualty.
 */

import { describe, it, expect } from 'vitest';

import { DECISION_REVIEW_TIMEOUT_MS } from '../timeouts.js';

describe('DECISION_REVIEW_TIMEOUT_MS', () => {
  it('code default is 22 seconds (env-override mitigation promoted into code — ROADMAP 2.73 Fix B)', () => {
    // Guard: if CI ever exports DECISION_REVIEW_TIMEOUT_MS this pin would
    // measure the env, not the default. Fail loud on that instead of
    // silently pinning the wrong thing.
    expect(process.env.DECISION_REVIEW_TIMEOUT_MS).toBeUndefined();
    expect(DECISION_REVIEW_TIMEOUT_MS).toBe(22_000);
  });
});
