/**
 * ROADMAP 2.1264 — the resolver's PRODUCTION of `exitFreshness`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS: TWO MUTANTS SURVIVED, AND THEY SHARED ONE CAUSE.
 *
 * The blocker fix has two halves — this resolver CARRIES the turn context's
 * persisted-graph freshness derivation to the exit, and the finaliser CONSUMES
 * it. The emission tests covered the consumption thoroughly and covered the
 * production not at all, because they hand `exitFreshness` straight to
 * `finaliseV5Response` as a fixture. So two mutations of this module survived a
 * fully green suite:
 *
 *   N5  `freshness: context.persisted_analysis_freshness` → `freshness: undefined`
 *       — the carrying simply stops, every graph-less exit silently returns to
 *       the degraded verdict the review blocked, and nothing goes red.
 *   N6  the failed-read derivation's `unknown` / `derivation_failed` → `none` /
 *       `no_successful_run_analysis_fact` — a store failure starts claiming the
 *       scenario has never been analysed, which is the exact positive claim
 *       `prior_facts_read_ok` exists to prevent.
 *
 * ⚠ THE LESSON IS THE ONE THIS PR WAS BLOCKED FOR, ONE SEAM LOWER. The review
 * caught the emission being tested against producer bytes instead of the mounted
 * consumer (preamble P2); these survivors are the mirror — the consumer tested
 * against a fixture THIS LANE WROTE instead of against what the producer actually
 * emits. A fixture you authored is not evidence about the wire (trap 16). Before
 * this file, `createTurnClaimSafetyResolver` had NO direct spec anywhere in the
 * repo (derived: two non-test references, both call sites).
 *
 * The three states are asserted APART, because collapsing any two of them is how
 * the degradation got shipped in the first place:
 *   a real read      → the context's own derivation, verbatim;
 *   a THROWN read    → `unknown` / `derivation_failed` ("we looked and could
 *                      not"), never `none` ("there is nothing");
 *   no payload       → NO key at all ("nothing was looked at").
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { FreshnessDerivation } from '../freshness.js';

const buildTurnContext = vi.fn();

// ⚠ `importOriginal` SPREAD, not a bare factory (trap 12): a `vi.mock` factory
// REPLACES the module, so a hand-listed mock silently drops every other export
// and the next import added to this graph fails at collection.
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  buildTurnContext: (...args: unknown[]) => buildTurnContext(...args),
}));

const { createTurnClaimSafetyResolver } = await import('../turn-claim-safety.js');

const PAYLOAD = {
  kind: 'message',
  scenario_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  message: 'what does the discount rate mean here?',
} as never;

function derivation(over: Partial<FreshnessDerivation> = {}): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: 'hash_persisted',
    current_graph_hash: 'hash_persisted',
    computed_at: '2026-08-17T09:00:00.000Z',
    ...over,
  };
}

/** The minimum shape `claimSafetyScopeFromContext` + the resolver read. */
function contextWith(freshness: FreshnessDerivation): unknown {
  return {
    prior_facts: [],
    prior_turns: [],
    prior_turns_total: 0,
    newest_analysis_fact: null,
    newest_analysis_fact_read_ok: true,
    persisted_analysis_freshness: freshness,
  };
}

describe('createTurnClaimSafetyResolver — exitFreshness production', () => {
  beforeEach(() => {
    buildTurnContext.mockReset();
  });

  it('carries the CONTEXT\'S OWN derivation, verbatim — never a fresh one', () => {
    // Bound by IDENTITY, not by shape: the object the exit receives must be the
    // one the context computed, so a future "helpful" recomputation here shows
    // up as a different object rather than passing on a lookalike.
    const own = derivation();
    buildTurnContext.mockResolvedValue(contextWith(own));
    const resolver = createTurnClaimSafetyResolver(PAYLOAD, 'req-ef-1');
    return resolver.forExit().then((stamp) => {
      expect(stamp.exitFreshness).toBe(own);
    });
  });

  it('carries a STALE derivation just as faithfully (it does not normalise)', async () => {
    // The discriminating twin. Without it, an implementation that hardcoded a
    // fresh derivation would pass the test above.
    const own = derivation({
      freshness: 'stale',
      reason: 'graph_hash_diverged',
      current_graph_hash: 'hash_moved',
    });
    buildTurnContext.mockResolvedValue(contextWith(own));
    const stamp = await createTurnClaimSafetyResolver(PAYLOAD, 'req-ef-2').forExit();
    expect(stamp.exitFreshness).toBe(own);
    expect(stamp.exitFreshness?.freshness).toBe('stale');
  });

  it('a THROWN context read reports derivation_failed — and NEVER "none"', async () => {
    buildTurnContext.mockRejectedValue(new SessionBoom('store unreachable'));
    const stamp = await createTurnClaimSafetyResolver(PAYLOAD, 'req-ef-3').forExit();
    expect(stamp.exitFreshness).toBeDefined();
    expect(stamp.exitFreshness!.freshness).toBe('unknown');
    expect(stamp.exitFreshness!.reason).toBe('derivation_failed');
    // ⭐ THE ASSERTION THAT MATTERS. `none` /
    // `no_successful_run_analysis_fact` is the POSITIVE claim "this scenario has
    // never been analysed" — unsupportable from a failed read, and it clears
    // state downstream. Asserted as its own line so the failure names the harm.
    expect(stamp.exitFreshness!.freshness).not.toBe('none');
    expect(stamp.exitFreshness!.reason).not.toBe('no_successful_run_analysis_fact');
    // It carries no fact and no hashes — there is nothing to report.
    expect(stamp.exitFreshness!.selected_fact_index).toBeNull();
    expect(stamp.exitFreshness!.computed_at).toBeNull();
  });

  it('the claim-safety half still FAILS CLOSED on a thrown read', async () => {
    // The freshness half must not have loosened the verdict half; both answers
    // come from the same catch branch and both are asserted here.
    buildTurnContext.mockRejectedValue(new SessionBoom('store unreachable'));
    const stamp = await createTurnClaimSafetyResolver(PAYLOAD, 'req-ef-4').forExit();
    expect(stamp.mayNameLeadingOption).toBe(false);
    expect(stamp.mayNameLeadingOptionProvenance).toBe('fail_closed_no_turn_context');
  });

  it('NO PAYLOAD carries NO exitFreshness key — "nothing was looked at"', async () => {
    // The third state, and it must stay distinguishable from the other two: the
    // finaliser's fallback chain reads an absent key as "no derivation", which
    // is what licenses the no-analysis-context verdict.
    const stamp = await createTurnClaimSafetyResolver(null, 'req-ef-5').forExit();
    expect('exitFreshness' in stamp).toBe(false);
    expect(buildTurnContext).not.toHaveBeenCalled();
  });

  it('ONE read serves many exits — the memo is not defeated', async () => {
    // The freshness rides here precisely because this read is memoised. If the
    // addition had cost a read per exit it would be a different change.
    buildTurnContext.mockResolvedValue(contextWith(derivation()));
    const resolver = createTurnClaimSafetyResolver(PAYLOAD, 'req-ef-6');
    const [a, b, c] = await Promise.all([
      resolver.forExit(),
      resolver.forExit(),
      resolver.forExit(),
    ]);
    expect(buildTurnContext).toHaveBeenCalledTimes(1);
    expect(a.exitFreshness).toBe(b.exitFreshness);
    expect(b.exitFreshness).toBe(c.exitFreshness);
  });
});

/** A distinct error type, so a mis-wired mock cannot pass as a store failure. */
class SessionBoom extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionBoom';
  }
}
