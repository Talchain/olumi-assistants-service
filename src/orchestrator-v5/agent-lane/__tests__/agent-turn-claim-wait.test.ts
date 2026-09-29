/**
 * ⛔ A same-id loser must answer before the browser proxy gives up (Panel, #1720
 * APPROVE 5792014826, non-blocking #1): otherwise it gets a proxy timeout instead of
 * the replay or the 409 the claim was designed to return.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { config } from '../../../config/index.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../../../config/timeouts.js';

describe('the claim wait fits inside the browser proxy timeout', () => {
  let AGENT_TURN_CLAIM_WAIT: { totalMs: number; everyMs: number };
  // The route module is heavy to import; do it once, with the same allowance the
  // sibling route suites give it, so a slow import can never pass for a RED.
  beforeAll(async () => {
    ({ AGENT_TURN_CLAIM_WAIT } = await import('../../../routes/agent-v1-turn.js'));
  }, 60_000);

  it('RED: the loser stops waiting at least the response headroom before the proxy times out', () => {
    // Vacuity guard: the proxy timeout is the served default, not a test override.
    expect(config.proxy.browserProxyTimeoutMs).toBeGreaterThan(TURN_RESPONSE_HEADROOM_MS);
    expect(AGENT_TURN_CLAIM_WAIT.totalMs).toBeLessThanOrEqual(config.proxy.browserProxyTimeoutMs - TURN_RESPONSE_HEADROOM_MS);
    // And it still waits long enough for an ordinary Agent turn (~80–95 s served) to finish.
    expect(AGENT_TURN_CLAIM_WAIT.totalMs).toBeGreaterThanOrEqual(100_000);
  });
});
