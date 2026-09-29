/**
 * ROADMAP 2.1264 — FAIL-LOUD drift guard: a `sendFinalised200` exit that carries
 * a GRAPH must also carry a freshness derivation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LATENT FALSEHOOD THIS CLOSES (found by the PR #1004 review).
 *
 * `analysis_state.run_state` falls back to `unknown_degraded` with cause
 * `no_graph_this_turn` when the finaliser is handed no derivation. That cause is
 * a CLAIM — the contract's own words are "no graph was in scope, so there was
 * nothing to classify" — and it is FALSE on an exit that had a graph.
 *
 * Four exits make that combination reachable, because they spread their
 * freshness CONDITIONALLY rather than unconditionally:
 *
 *   `system_event`  ...(sysResult.freshness !== undefined ? { freshness: … } : {})
 *   `chip_click`    freshness: cc.freshness            (may be undefined)
 *   `draft_graph`   ...(dg.freshness ? { freshness: … } : {})
 *   `edit_graph`    ...(eg.freshness ? { freshness: … } : {})
 *
 * Whether any of them can actually produce a graph WITHOUT a derivation is not
 * established — the review found it unproven in both directions, and nothing
 * tested it. So this guard does not assert a claim about today's runtime; it
 * makes the combination a COMPILE-TIME-ADJACENT property of the source, so the
 * false cause is unreachable by construction and stays that way when the next
 * dispatch family is added.
 *
 * WHY NOT JUST PICK A BETTER CAUSE FOR THAT CASE: there isn't one. The
 * degraded-cause vocabulary is closed — `store_unreadable`, `legacy_fact`,
 * `no_graph_this_turn`, `refusal_unverified` — and none of them means "this exit
 * had a graph and threaded no derivation". That is a producer defect, not a state
 * of the world, and CI is the right place to reject it (the finaliser must never
 * throw at egress, so it cannot reject it itself).
 *
 * DERIVE-NOT-MIRROR (trap 12): this test hand-lists no exit path. It ENUMERATES
 * every `sendFinalised200(...)` call in route-v2.ts from source with the same
 * balanced-paren scan `route-egress-claim-safety-marking.drift.test.ts` uses,
 * and classifies each call's own ctx span. A new dispatch family appears here
 * immediately; there is no list to fall out of sync with.
 *
 * POSITIVE CONTROLS: the detector is fed a fixture with a graph and no
 * freshness (must be FLAGGED) and one with both (must NOT be) — so the guard
 * above cannot be vacuously green, in either direction.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_V2 = resolve(HERE, '../../orchestrator/route-v2.ts');

interface SendCall {
  readonly offset: number;
  readonly argSpan: string;
  /** ctx declares `graph: null` — no graph was in scope for this exit. */
  readonly graphIsNullLiteral: boolean;
  /** ctx mentions a freshness derivation at all (conditional spread included). */
  readonly threadsFreshness: boolean;
  /** ctx threads the turn's full canonical verdict (turn_executor). */
  readonly threadsCanonicalState: boolean;
}

/**
 * Balanced-paren scan over `sendFinalised200(` calls.
 *
 * Same technique as the claim-safety marking guard, deliberately: two guards
 * reading the same population with two different scanners is how they come to
 * disagree about which exits exist.
 */
function enumerateSendCalls(source: string): SendCall[] {
  const calls: SendCall[] = [];
  for (const m of source.matchAll(/sendFinalised200\(/g)) {
    const matchStart = m.index!;
    // Skip the DEFINITION (`function sendFinalised200(`).
    if (/function\s+$/.test(source.slice(Math.max(0, matchStart - 20), matchStart))) continue;

    const openParen = matchStart + m[0].length - 1;
    let depth = 0;
    let j = openParen;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const argSpan = source.slice(openParen, j + 1);
    calls.push({
      offset: matchStart,
      argSpan,
      graphIsNullLiteral: /\bgraph:\s*null\b/.test(argSpan),
      // Matches `freshness: x`, `{ freshness: x }` in a conditional spread, and
      // `exitFreshness` is deliberately NOT accepted — it is the persisted-graph
      // derivation and the finaliser refuses it when a graph is in scope.
      threadsFreshness: /(?<!exit)\bfreshness:\s*\S/i.test(argSpan),
      threadsCanonicalState: /\bcanonicalState:\s*\S/.test(argSpan),
    });
  }
  return calls;
}

describe('2.1264 — a graph-bearing exit must thread a freshness derivation', () => {
  const source = readFileSync(ROUTE_V2, 'utf8');
  const calls = enumerateSendCalls(source);

  it('the enumerator SEES the route exits (or every assertion below is vacuous)', () => {
    // Trap 13: an absence claim over an empty population is not a finding.
    // Floor, not an exact count — a count would be the mirror this guard exists
    // to avoid, and the number moves whenever a dispatch family is added.
    expect(calls.length).toBeGreaterThanOrEqual(15);
  });

  it('the enumerator sees BOTH classes — graph-less and graph-bearing exits exist', () => {
    // A discriminating precondition (trap 13b): if the scanner classified every
    // call the same way, the guard below would pass by not discriminating.
    expect(calls.some((c) => c.graphIsNullLiteral)).toBe(true);
    expect(calls.some((c) => !c.graphIsNullLiteral)).toBe(true);
  });

  it('every exit with a graph in scope threads freshness or the canonical state', () => {
    const offenders = calls.filter(
      (c) => !c.graphIsNullLiteral && !c.threadsFreshness && !c.threadsCanonicalState,
    );
    expect(
      offenders.map((c) => `sendFinalised200@${c.offset}`),
      'route-v2 has a sendFinalised200 call that declares a NON-NULL graph and threads no ' +
        'freshness derivation. Its `analysis_state.run_state` will fall back to ' +
        'unknown_degraded/no_graph_this_turn — a cause whose contract text asserts "no graph ' +
        'was in scope", which is FALSE for this exit, and a degraded verdict that outranks the ' +
        "UI's retained state. Thread the dispatch result's own freshness derivation at this " +
        'call site. Do NOT reach for `exitFreshness`: that one describes the PERSISTED graph ' +
        'and would claim currency for a graph this turn may have mutated. See ' +
        '`exitDerivationFor` in response-finaliser.ts.',
    ).toEqual([]);
  });

  it('POSITIVE CONTROL — the detector FLAGS a graph without freshness', () => {
    const fixture = `
      sendFinalised200(reply, requestId, 'invented_family', response, {
        graph: someGraph,
        answerKind: 'functional',
      });
    `;
    const found = enumerateSendCalls(fixture);
    expect(found).toHaveLength(1);
    expect(found[0]!.graphIsNullLiteral).toBe(false);
    expect(found[0]!.threadsFreshness).toBe(false);
  });

  it('POSITIVE CONTROL — and does NOT flag a graph WITH freshness', () => {
    const fixture = `
      sendFinalised200(reply, requestId, 'invented_family', response, {
        graph: someGraph,
        freshness: dispatchResult.freshness,
      });
    `;
    const found = enumerateSendCalls(fixture);
    expect(found).toHaveLength(1);
    expect(found[0]!.threadsFreshness).toBe(true);
  });

  it('POSITIVE CONTROL — `exitFreshness` alone does NOT satisfy the guard', () => {
    // The sharp case. `exitFreshness` arrives on every non-execute exit via the
    // claim-safety spread, so a detector that accepted it would report every
    // graph-bearing exit as covered and this whole guard would be a tautology.
    const fixture = `
      sendFinalised200(reply, requestId, 'invented_family', response, {
        graph: someGraph,
        exitFreshness: stamp.exitFreshness,
      });
    `;
    const found = enumerateSendCalls(fixture);
    expect(found).toHaveLength(1);
    expect(found[0]!.threadsFreshness).toBe(false);
  });

  it('POSITIVE CONTROL — a graph-less exit is classified as such', () => {
    const fixture = `
      sendFinalised200(reply, requestId, 'clarify_v2', response, {
        graph: null,
        answerKind: 'functional',
      });
    `;
    const found = enumerateSendCalls(fixture);
    expect(found).toHaveLength(1);
    expect(found[0]!.graphIsNullLiteral).toBe(true);
  });
});
