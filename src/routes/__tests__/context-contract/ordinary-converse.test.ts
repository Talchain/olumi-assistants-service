/**
 * REAL /agent/v1/turn route: ordinary-converse.
 * Doubles: getSessionStore (in-memory storage reads/append), internal POST
 * /assist/v1/scenarios/:scenario/graph snapshot read. Provider fetch intercepted;
 * exact sentBody bytes + sha256 written under out/provider/ordinary-converse/. No network.
 * Fixture run1/run2 come verbatim from prior seed manifests. All mutations and
 * synthetic revision probes are documented in fixtures/README.md.
 */
import { installContract } from './contract-rows.js';
import { it, expect } from 'vitest';
import { capture, findState } from './provider-harness.js';
installContract('ordinary-converse');

it('default ordinary-converse run2 canonical_state has no run_explanation key', async () => {
  const w = await capture('ordinary-converse', 'run2');
  for (const call of w.calls) {
    const canonicalState = findState(call.payloads);
    expect(canonicalState.graph_revision).toBe(w.seed.revision);
    expect(canonicalState).not.toHaveProperty('run_explanation');
  }
  // #2900 positive control: run-explanation-turn-parity.test.ts checks the original
  // provider SHAs in fixtures/staging-turn-sha256.json; one-assembly checks opt-in presence.
}, 60_000);
