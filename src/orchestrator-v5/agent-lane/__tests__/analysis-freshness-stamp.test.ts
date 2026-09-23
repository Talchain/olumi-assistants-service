import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { withCurrentGraphHash } from '../analysis-freshness-stamp.js';
import { AnalysisReadyPayload } from '../../../schemas/analysis-ready.js';

/**
 * ⛔⛔ THE OPENAI PATH RETURNED AN ANALYSIS WITH NO FRESHNESS VERDICT.
 *
 * The contract tells the client what to do — *"UI compares
 * [current_graph_hash] against graph_hash_at_run to confirm freshness
 * independently"* — and the agent route supplied neither side.
 */
describe('stamping which model the readiness describes', () => {
  it('⭐ adds current_graph_hash from the same read', () => {
    const out = withCurrentGraphHash({ status: 'ready' }, 'hash-abc') as Record<string, unknown>;
    expect(out.current_graph_hash).toBe('hash-abc');
    expect(out.status).toBe('ready');   // nothing else disturbed
  });

  it('⛔ NEVER overwrites one the producer already set', () => {
    // A value the run stated is better evidence than one stamped by a reader.
    const given = { status: 'ready', current_graph_hash: 'from-the-run' };
    const out = withCurrentGraphHash(given, 'from-this-read') as Record<string, unknown>;
    expect(out.current_graph_hash).toBe('from-the-run');
  });

  it('⛔ NEVER invents graph_hash_at_run — only the run can state that', () => {
    // Deriving it from a read would manufacture a provenance this code does not
    // have, and a wrong freshness verdict is worse than an absent one.
    const out = withCurrentGraphHash({ status: 'ready' }, 'hash-abc') as Record<string, unknown>;
    expect(out.graph_hash_at_run).toBeUndefined();
    expect(Object.keys(out)).not.toContain('graph_hash_at_run');
  });

  it('⛔ a graph_hash_at_run the RUN supplied survives untouched, beside the new field', () => {
    // The two-sided comparison the UI is told to make must be possible.
    const given = { status: 'ready', graph_hash_at_run: 'when-it-ran' };
    const out = withCurrentGraphHash(given, 'now') as Record<string, unknown>;
    expect(out.graph_hash_at_run).toBe('when-it-ran');
    expect(out.current_graph_hash).toBe('now');
  });

  it('does not mutate the payload it was given', () => {
    const given = { status: 'ready' };
    withCurrentGraphHash(given, 'hash-abc');
    expect(Object.keys(given)).toEqual(['status']);
  });

  it('⛔ fails open on anything it cannot stamp', () => {
    // A readback that could break a turn would be worse than the missing field.
    for (const bad of [null, undefined, 'a string', 42, [1, 2]]) {
      expect(withCurrentGraphHash(bad, 'h')).toBe(bad);
    }
    const ok = { status: 'ready' };
    expect(withCurrentGraphHash(ok, undefined)).toBe(ok);
    expect(withCurrentGraphHash(ok, '')).toBe(ok);   // the route coerces a missing hash to ''
  });

  it('⭐ the stamped payload still satisfies the published contract', () => {
    // `.passthrough()` means an additive field survives — but only if the field
    // is one the schema admits. This proves the stamp cannot be rejected at
    // egress, which would lose the whole readiness rather than one field.
    const base = { status: 'ready', goal_node_id: 'goal_1', options: [], blockers: [] };
    const out = withCurrentGraphHash(base, 'hash-abc');
    const parsed = AnalysisReadyPayload.safeParse(out);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
    if (parsed.success) expect(parsed.data.current_graph_hash).toBe('hash-abc');
  });
});

describe('the agent route actually uses it', () => {
  /**
   * ⚠ A SOURCE PIN, and only for the MOUNT. The behaviour is tested above
   * against the real function; this asserts the route reaches it, which no unit
   * test of the helper can see. It is the same gap the review found on the
   * redraw mount: a pass that is never called is green everywhere.
   */
  const ROUTE = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');

  it('the probe can see the route (not vacuous)', () => {
    expect(ROUTE).toContain('readBackState');
  });

  it('⛔⛔ BOTH sources of analysis_ready are stamped — the tool one WINS', () => {
    // The composition defect this pins: `analysisFromTool` takes precedence over
    // the readback, so stamping only inside `readBackState` lands the field on
    // the LOSING branch. On exactly the turns where the Agent ran an analysis —
    // where staleness matters most — the UI would still have had one side of
    // the comparison. An inner branch under an outer gate.
    const send = ROUTE.slice(ROUTE.indexOf('analysisFromTool?.analysis_ready !== undefined'));
    const branch = send.slice(0, send.indexOf('draft_graph'));
    expect(branch).toContain('withCurrentGraphHash(analysisFromTool.analysis_ready, graphHash)');
  });

  it('⛔ readBackState stamps before it returns', () => {
    const body = ROUTE.slice(ROUTE.indexOf('async function readBackState'), ROUTE.indexOf('return { graphHash, analysisReady, draftGraph };'));
    expect(body).toContain('withCurrentGraphHash(analysisReady, graphHash)');
  });
});
