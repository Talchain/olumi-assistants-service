import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * ⛔⛔ A FAIL-OPEN WITH A USER-VISIBLE CONSEQUENCE, AND IT WAS SILENT.
 *
 * `readBackState`'s catch is RIGHT to return the turn — a readback failure must
 * not lose the user's answer. What was missing is that anyone could know it
 * happened.
 *
 * The consequence is not abstract. `DecisionGuideAI/src/canvas/store.ts` says
 * `lastServerGraphHash`'s *"only wire emitters are this top-level `graph_hash`
 * and `analysis_ready.current_graph_hash`"*, and BOTH are omitted on this path.
 * Null means *"CEE has not stamped one this session"*, in which case **a delete
 * stands down from the wire** rather than asserting a base it does not hold.
 *
 * ⇒ The user's delete gesture silently stops applying, and there was no log
 * line, no event and no way to count it. The estate's own draft-quality doctrine
 * names this shape: *"a repair pass whose fail-open is silent converts a
 * measurable problem into an unmeasurable one."*
 *
 * ⚠ A SOURCE PIN, and honest about why: exercising this branch needs a dispatch
 * that throws inside a route that wants a Fastify request, a session store and a
 * scenario. The branch is one `catch` and what is asserted is that it SPEAKS —
 * which is exactly what a source pin can establish. What it cannot establish is
 * that the branch is reached; that is argued from the code, not measured here.
 */
const ROUTE = readFileSync(new URL('../agent-v1-turn.ts', import.meta.url), 'utf8');

/** The `readBackState` body only — not the rest of a 900-line route. */
const READBACK = ROUTE.slice(
  ROUTE.indexOf('async function readBackState'),
  ROUTE.indexOf('const UUID_PATTERN'),
);

describe('a failed state readback is observable', () => {
  it('the probe found the function (this suite is not vacuous)', () => {
    expect(READBACK.length).toBeGreaterThan(500);
    expect(READBACK).toContain('catch');
  });

  it('⛔ the catch is no longer silent', () => {
    // The whole finding: it swallowed with a comment and nothing else.
    expect(READBACK).toContain('agent_lane.state_readback_failed');
  });

  it('⭐ it names the CONSEQUENCE, not just the error', () => {
    // "readback failed" is a fact about us. "a delete gesture stands down" is
    // the thing someone reading the log needs to act on.
    expect(READBACK).toContain('delete gesture stands down');
  });

  it('⭐ it states which emitters the client will be missing', () => {
    // So the consequence is legible without reading the canvas store.
    expect(READBACK).toContain('graph_hash_emitted');
    expect(READBACK).toContain('analysis_ready_emitted');
  });

  it('⛔ the error itself is carried — a warn with no cause cannot be diagnosed', () => {
    expect(READBACK).toMatch(/err: String\(err\)/);
  });

  it('⛔ BEHAVIOUR IS UNCHANGED — it still returns the turn, and asserts no revision', () => {
    // The dangerous direction. A readback failure that started refusing the turn,
    // retrying, or synthesising a hash would be far worse than the silence: a
    // hash this code could not read is one it must not assert.
    // The same three emitters are still returned; #1760 adds the readback's own
    // bound analysis_state / analysis_result beside them (additive, never a
    // synthesised value — see the two assertions below).
    expect(READBACK).toMatch(/return \{ graphHash, analysisReady, draftGraph(, [A-Za-z]+)* \};/);
    expect(READBACK).not.toMatch(/throw |reply\.code\(5/);
    // No fabricated fallback for either emitter.
    expect(READBACK).not.toMatch(/graphHash\s*=\s*['"`]/);
  });
});
