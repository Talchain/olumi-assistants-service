import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectTurnReceipts } from '../turn-receipts.js';

/**
 * ⛔⛔ THE AGENT RESPONSE SAID THE MODEL CHANGED AND NEVER SAID WHAT IT BECAME.
 *
 * `_agent` carried `session_id`, `mode`, `tool_calls`, `mutated`, `hops`,
 * `stopped_reason`, `turn_id`, `durability` — and no version, no receipt. A
 * surface could learn that a write happened but not which committed version it
 * now holds, so it could not reconcile what it is showing against what was
 * saved.
 *
 * Contrast control for that absence: `ReceiptSummary` already carries exactly
 * the four fields needed, and the agent lane builds them on ten sites. They
 * were simply never hoisted out of the tool result.
 */
const R1 = { version: 7, version_id: 'v-7', mutation_id: 'm-1', source_turn_id: 't-1' };
const R2 = { version: 8, version_id: 'v-8', mutation_id: 'm-2', source_turn_id: 't-1' };

describe('collecting what this turn actually saved', () => {
  it('⭐ hoists receipts out of the tool results', () => {
    const out = collectTurnReceipts([{ ok: true, mutated: true, receipts: [R1, R2] }]);
    expect(out).toEqual([R1, R2]);
  });

  it('⭐ orders by version, so the last entry is what the model now IS', () => {
    const out = collectTurnReceipts([{ receipts: [R2] }, { receipts: [R1] }]);
    expect(out.map((r) => r.version)).toEqual([7, 8]);
  });

  it('⛔ de-duplicates by version_id — one saved version is not two', () => {
    // One authorisation writes through several hops, and a RETRY recovers the
    // original receipts rather than minting new ones, so the same version
    // legitimately arrives more than once. Reporting it twice would make a
    // single saved version look like two.
    const out = collectTurnReceipts([{ receipts: [R1] }, { receipts: [R1, R2] }, { receipts: [R1] }]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.version_id)).toEqual(['v-7', 'v-8']);
  });

  it('⛔ MINTS NOTHING — a turn that saved nothing reports an empty list', () => {
    expect(collectTurnReceipts([{ ok: true, mutated: false }])).toEqual([]);
    expect(collectTurnReceipts([])).toEqual([]);
    expect(collectTurnReceipts(undefined)).toEqual([]);
  });

  it('⛔ refuses a half-receipt that cannot identify a version', () => {
    // Shipping one would put a half-answer where the UI expects a version to
    // reconcile against — worse than reporting nothing.
    const out = collectTurnReceipts([{
      receipts: [
        { version: 9 },                                   // no version_id
        { version_id: 'v-9' },                            // no version
        { version: '10', version_id: 'v-10' },            // wrong type
        null, 'nope', 42,
        R1,                                               // the only real one
      ],
    }]);
    expect(out).toEqual([R1]);
  });

  it('survives malformed tool results without throwing', () => {
    expect(collectTurnReceipts([null, 'x', 42, { receipts: 'not-an-array' }, { receipts: [R1] }]))
      .toEqual([R1]);
  });

  it('⚠ carries identifiers only — no user content reaches the sidecar', () => {
    // What makes it safe to put on a field the client reads.
    const out = collectTurnReceipts([{ receipts: [R1] }]);
    expect(Object.keys(out[0]!).sort()).toEqual(['mutation_id', 'source_turn_id', 'version', 'version_id']);
  });
});

describe('the agent route actually surfaces them', () => {
  /**
   * ⚠ A SOURCE PIN FOR THE MOUNT ONLY — the behaviour above runs against the
   * real function. This asserts the route reaches it, which no unit test of the
   * collector can see: a helper that is never called is green everywhere. That
   * is the exact failure independent review caught on my redraw mount.
   */
  const ROUTE = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');

  it('the probe can see the route (not vacuous)', () => {
    expect(ROUTE).toContain('_agent: {');
  });

  it('⛔ the _agent sidecar reports the receipts', () => {
    // ⚠ THE LAST `_agent: {` is the live response. An earlier one belongs to the
    // REPLAY path, and slicing from the first match asserted about the wrong
    // object — which is how this pin first failed against correct code.
    const at = ROUTE.lastIndexOf('_agent: {');
    expect(at, 'no _agent sidecar found — vacuous').toBeGreaterThan(-1);
    const sidecar = ROUTE.slice(at);
    expect(sidecar).toContain('collectTurnReceipts(result.tool_results)');
    // And it is INSIDE the sidecar, not merely later in the file.
    expect(sidecar.indexOf('collectTurnReceipts')).toBeLessThan(sidecar.indexOf('\n    });'));
  });
});
