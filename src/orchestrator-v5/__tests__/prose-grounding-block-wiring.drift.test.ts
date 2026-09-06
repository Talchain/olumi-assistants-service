/**
 * THE WIRING GUARD — the rule is worthless if the substantive branches do not
 * call it.
 *
 * `buildProseGroundingBlocks` is a pure rule and its own suite proves the rule
 * is right. Neither of those facts puts a block on the wire. The defect being
 * closed here was ENTIRELY a wiring defect: the composer, the schema slot and
 * the UI consumers all existed, and the two substantive compose branches passed
 * no `blocks` — so an otherwise-complete chain shipped nothing.
 *
 * This is the same failure mode the parent CLAUDE.md records as the estate's
 * chronic one ("we build more than we plug in"), and the same reason
 * `answer-kind-compose-classification.drift.test.ts` exists beside it: a rule
 * whose call site can be deleted without a red is a rule that will be deleted.
 *
 * ⚠ SOURCE-LEVEL BY NECESSITY, AND ITS LIMIT IS STATED RATHER THAN IMPLIED.
 * Driving the real coach / converse branches needs a routed LLM turn with a
 * persisted scenario fact set; this suite cannot do that, and a test that
 * claimed to would be asserting less than it appears to. What this DOES prove
 * is that both substantive `composeAnswer` calls pass a `blocks` argument
 * derived from the helper — i.e. that the rule is REACHED. Whether the runtime
 * value is right is the other suite's job. Two claims, two instruments; neither
 * is evidence for the other.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

const MARKER_LEN = 'composeAnswer('.length;

const TURN_EXECUTOR = readFileSync(
  new URL('../turn-executor.ts', import.meta.url),
  'utf-8',
);

/**
 * A `composeAnswer({...})` call and its argument object, one entry per call
 * site. Brace-matched rather than regex-scanned so a nested object literal in
 * the argument cannot truncate the match.
 */
function composeAnswerCalls(source: string): string[] {
  const calls: string[] = [];
  const marker = 'composeAnswer({';
  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start, i + 1));
    from = i + 1;
  }
  return calls;
}

describe('the prose-grounding rule is wired into both substantive branches', () => {
  it('SELF-CHECK — the scanner found the call sites it is about to reason over', () => {
    // An extraction that silently returned nothing would make every assertion
    // below vacuous (parent CLAUDE.md trap 13: assert your inputs are non-empty
    // before believing agreement).
    const calls = composeAnswerCalls(TURN_EXECUTOR);
    expect(TURN_EXECUTOR.length).toBeGreaterThan(10_000);
    expect(calls.length).toBeGreaterThan(20);
    // The brace matcher must actually be closing the objects, not running to
    // end-of-file: no extracted call may contain a later call's marker.
    for (const call of calls) {
      expect(call.slice(MARKER_LEN).includes('composeAnswer({')).toBe(false);
    }
  });

  /**
   * ⭐ THE SCOPE OF THIS CHANGE, PINNED RATHER THAN FENCED.
   *
   * There are FOUR substantive `composeAnswer` sites, not two — this guard
   * caught the author assuming two. Two are the LLM prose branches (coach,
   * converse) whose figures come from `display_analysis`; those are wired.
   *
   * TWO ARE DELIBERATELY NOT WIRED, and they are named here so the exclusion is
   * REVIEWABLE instead of invisible:
   *
   *   `runComparisonResponse` — the deterministic run-comparison gate
   *   `adviceResponse`        — the deterministic post-analysis advice gate
   *
   * Both compose their own copy from the analysis projection, both carry their
   * own fail-closed freshness handling inside their gate outcome, and the
   * advice gate additionally maintains an N=1 directive invariant on the very
   * `blocks` field this change would write. Grounding them is very likely
   * right, but it is a judgement about THEIR gates' semantics, which this lane
   * has not derived. Shipping a fresh-looking result block beside copy those
   * gates may already have qualified for staleness would recreate, one turn
   * class over, exactly the contradiction this change closes.
   *
   * So the exclusion is an admission of un-derived scope, not a ruling that
   * they should stay unwired. Asserting their CURRENT state means a later lane
   * that wires them must delete a line here and state why — which is the
   * conversation that should happen.
   */
  it('the FOUR substantive sites are wired exactly as this change scopes them', () => {
    const substantive = composeAnswerCalls(TURN_EXECUTOR).filter((call) =>
      call.includes("answerKind: 'substantive'"),
    );
    // A FIFTH substantive prose branch REDs here, and its author must decide
    // whether that turn grounds its own figures — the question, not a chore.
    expect(substantive).toHaveLength(4);

    const wired = substantive.filter((call) =>
      call.includes('blocks: buildProseGroundingBlocks({'),
    );
    expect(wired).toHaveLength(2);

    for (const call of wired) {
      // Bound to the PROMPT-side derivation specifically. The routing and
      // post-dispatch derivations are verdicts about DIFFERENT arrays, and
      // pairing the prose's fact with another array's freshness is the
      // two-derivations defect the helper's header rules out.
      expect(call).toContain('sourceFact: promptAnalysisSourceFact');
      expect(call).toContain('freshness: promptAnalysisFreshness');
    }
  });

  it('the two wired sites are the LLM prose branches, bound by identity', () => {
    // Binds to WHICH sites are wired, not to how many. A change that wired a
    // deterministic gate and unwired a prose branch would keep the count at two
    // and must not pass (parent CLAUDE.md trap 19: bind by identity, never by a
    // predicate another object could satisfy).
    for (const marker of ['coachGuarded.assistant_text', 'converseGuarded.assistant_text']) {
      const call = composeAnswerCalls(TURN_EXECUTOR).find((c) => c.includes(marker));
      expect(call, `no composeAnswer call found for ${marker}`).toBeDefined();
      expect(call!).toContain("answerKind: 'substantive'");
      expect(call!).toContain('blocks: buildProseGroundingBlocks({');
    }
  });

  it('the two deterministic gates remain UNWIRED — the recorded scope boundary', () => {
    for (const marker of [
      'runComparisonOutcome.assistant_text',
      'adviceOutcome.assistant_text',
    ]) {
      const call = composeAnswerCalls(TURN_EXECUTOR).find((c) => c.includes(marker));
      expect(call, `no composeAnswer call found for ${marker}`).toBeDefined();
      expect(call!).toContain("answerKind: 'substantive'");
      expect(call!).not.toContain('buildProseGroundingBlocks');
    }
  });

  it('the source fact is co-assigned with the projection, over ONE array', () => {
    // The load-bearing same-fact claim. `promptAnalysisSourceFact` must be
    // assigned exactly once, inside the block that assigns the projection, and
    // must select over `scenarioAnalysisFacts` — the array
    // `buildAnalysisFromPriorFacts` was handed on the line above it.
    const assignments = TURN_EXECUTOR.match(/promptAnalysisSourceFact\s*=/g) ?? [];
    expect(assignments).toHaveLength(1);

    const guardStart = TURN_EXECUTOR.indexOf('if (durableFallback) {');
    expect(guardStart).toBeGreaterThan(-1);
    const guardEnd = TURN_EXECUTOR.indexOf('\n    }', guardStart);
    const guardBody = TURN_EXECUTOR.slice(guardStart, guardEnd);

    expect(guardBody).toContain('promptAnalysisSummary = durableFallback;');
    expect(guardBody).toContain('promptAnalysisSourceFact = asRunAnalysisFact(');
    expect(guardBody).toContain('selectRunAnalysisFact(scenarioAnalysisFacts)');
    // NEGATIVE: never the bounded hot window, which is a different array.
    expect(guardBody).not.toContain('context.prior_facts');
  });
});
