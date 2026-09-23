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

  /**
   * ⛔ CORRECTED — this asserted the opposite, and was pinning the defect shut.
   *
   * The old comment read "a value the run stated is better evidence than one
   * stamped by a reader". That reasoning is right about `graph_hash_at_run` and
   * WRONG about `current_graph_hash`: the producer's value is the hash as at the
   * RUN, and the route's is the hash as at THIS TURN, after every write. Keeping
   * the producer's made `graph_hash_at_run === current_graph_hash` on a turn that
   * moved the model, so the UI's own comparison reported FRESH over changed state.
   *
   * See the module docblock. The route is the authority on "current".
   */
  it('⭐ OVERWRITES a producer value that is no longer this turn\u2019s current', () => {
    const given = { status: 'ready', current_graph_hash: 'from-the-run' };
    const out = withCurrentGraphHash(given, 'from-this-read') as Record<string, unknown>;
    expect(out.current_graph_hash).toBe('from-this-read');
  });

  it('returns BY IDENTITY when the producer already agrees, so an unmoved model allocates nothing', () => {
    const given = { status: 'ready', current_graph_hash: 'same-hash' };
    expect(withCurrentGraphHash(given, 'same-hash')).toBe(given);
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

  it('⭐ EVERY analysis_ready the route emits comes from the stamped readback', () => {
    // ⚠ THIS REPLACES A "BOTH BRANCHES ARE STAMPED" ASSERTION. Staging converged
    // on the final readback — "Readiness of the graph this response returns —
    // the final readback's only" — so the tool branch no longer exists and the
    // single stamp inside `readBackState` covers every emitter.
    //
    // There are TWO emitters, and binding to both is the point: the replay path
    // (`state.analysisReady`) is the one an inner-branch fix would have missed.
    const emitters = [...ROUTE.matchAll(/analysis_ready:\s*([A-Za-z.?]+)/g)].map((m) => m[1]);
    expect(emitters.sort()).toEqual(['analysisReady', 'state.analysisReady']);
    // Both names are `readBackState`'s own output, which is stamped before it
    // returns. Nothing is sourced from the tool result.
    expect(ROUTE).not.toContain('analysisFromTool?.analysis_ready');
  });

  it('⛔ readBackState stamps BEFORE it returns, and the stamp is inside that function', () => {
    // Bounded by the function's own return statement, found by prefix rather
    // than by an exact key list — the previous version sliced to a literal
    // `return { graphHash, analysisReady, draftGraph };` that staging had since
    // widened, so `indexOf` returned -1 and the assertion read the WHOLE FILE.
    // It passed for the wrong reason.
    const start = ROUTE.indexOf('async function readBackState');
    expect(start).toBeGreaterThan(-1);
    const rest = ROUTE.slice(start);
    const end = rest.indexOf('return { graphHash, analysisReady,');
    expect(end).toBeGreaterThan(-1);
    const body = rest.slice(0, end);
    expect(body).toContain('withCurrentGraphHash(analysisReady, graphHash)');
  });
});

/**
 * ⛔⛔⛔ THE NEVER-OVERWRITE GUARD MADE THIS WORSE THAN THE GAP IT REPLACED.
 *
 * `analysisFromTool` has exactly one producer: `agent-capabilities.ts:1470`
 * `onAnalysis?.({ analysis_ready: r.json.analysis_ready, ... })`, where `r` is the
 * response of `dispatch('/orchestrate/v2/turn', ...)` at `:1454` — the CONVENTIONAL
 * route. That finaliser ALREADY stamps the field: `compose/analysis-ready-emit.ts:202-203`
 * sets `out.current_graph_hash` whenever the freshness derivation supplies one.
 *
 * So on every real tool-branch turn the guard fired and returned the payload
 * untouched — and the value it preserved is the hash AT THE TIME THE ANALYSIS RAN.
 * If the Agent then writes in the same turn (run the analysis, then apply the
 * change — an ordinary Agent flow), the response carries:
 *
 *     graph_hash: H2                      (post-write, from readBackState)
 *     analysis_ready.graph_hash_at_run: H1
 *     analysis_ready.current_graph_hash: H1   <- stale, guard preserved it
 *
 * The UI performs the comparison `schemas/analysis-ready.ts:567-571` instructs —
 * H1 === H1 — and reports the analysis FRESH over a model that moved in that very
 * turn. `analysis-ready-emit.ts` documents that harm itself: "`fresh` -> clears the
 * local-edits dirty overlay, so the strip claims 'Analysis reflects the current
 * model' over edits CEE has never seen."
 *
 * ⭐ THE CONTRACT, CORRECTED. `graph_hash_at_run` is "when the run happened" and
 * only the run can say it — still never written here. `current_graph_hash` is "on
 * THIS turn", and at response time the ROUTE is the authority on that: it read the
 * graph after every write. The tool's value is a `graph_hash_at_run` wearing the
 * other field's name, so preserving it was preserving the wrong thing.
 */
describe('the route is the authority on what CURRENT means', () => {
  it('⛔ overwrites a stale current_graph_hash from the tool payload', () => {
    const fromTool = { status: 'ready', graph_hash_at_run: 'H1', current_graph_hash: 'H1' };
    const out = withCurrentGraphHash(fromTool, 'H2') as Record<string, unknown>;
    expect(out.current_graph_hash, 'the route read the graph AFTER the write — that is this turn’s current').toBe('H2');
    expect(out.graph_hash_at_run, 'only the run can say when it ran — never rewritten here').toBe('H1');
  });

  it('⭐ so a moved model is now DETECTABLE by the comparison the schema instructs', () => {
    const out = withCurrentGraphHash(
      { status: 'ready', graph_hash_at_run: 'H1', current_graph_hash: 'H1' },
      'H2',
    ) as Record<string, unknown>;
    expect(out.graph_hash_at_run).not.toBe(out.current_graph_hash);
  });

  it('CONTRAST: an UNMOVED model still compares equal, so this does not fake staleness', () => {
    const out = withCurrentGraphHash(
      { status: 'ready', graph_hash_at_run: 'H1', current_graph_hash: 'H1' },
      'H1',
    ) as Record<string, unknown>;
    expect(out.graph_hash_at_run).toBe(out.current_graph_hash);
  });

  it('still fails open by identity when there is no hash to stamp', () => {
    const given = { status: 'ready', current_graph_hash: 'H1' };
    expect(withCurrentGraphHash(given, undefined)).toBe(given);
    expect(withCurrentGraphHash(given, '')).toBe(given);
  });
})
