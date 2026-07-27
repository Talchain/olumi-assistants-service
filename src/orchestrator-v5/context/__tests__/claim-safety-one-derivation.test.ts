/**
 * ONE SELECTION, NOT FOUR — the pin for the second-derivation class.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS. `context/claim-safety-read.ts` was written to stop a
 * second READ POINT becoming a second DERIVATION, and its header says so. It
 * did not succeed, and the reason is worth stating precisely because it is the
 * generalisable part: EXTRACTING A READER IS NOT THE SAME AS HAVING ONE
 * DERIVATION. At the tip before this change there were FOUR selections of the
 * claim-safety answer, every one of them a faithful copy of the same ceremony:
 *
 *   1. `claim-safety-read.ts` — the verdict function's `selectRunAnalysisFact`
 *   2. `claim-safety-read.ts` — `readConstraintVerdictStateForFacts`'s OWN
 *      `selectRunAnalysisFact`, inside the module that forbids exactly this
 *   3. `turn-executor.ts` — the entry state read, on `context.prior_facts`
 *   4. `turn-executor.ts` — the explanation gate, rebuilding the unified fact
 *      array literal and re-selecting ~180 lines after the post-dispatch read
 *
 * They agreed only while every caller remembered to hand them identical
 * arrays. That is a hand-maintained mirror (CLAUDE.md trap #12) and it drifted
 * on schedule: #726 gave the PERMISSION a scenario scope and left the STATE
 * that explains the permission on the bare 20-turn window. The failure is
 * silent by construction — both answers are individually correct about the
 * array each was handed.
 *
 * The tests below are in two families:
 *   - SEMANTIC: the two answers come from ONE fact even when that fact is
 *     reachable only through the scenario scope. This is the property that was
 *     FALSE before the collapse, and the first test proves it was false rather
 *     than asserting it is now true.
 *   - STRUCTURAL: derived counts over the source, so re-pasting the ceremony
 *     fails loudly instead of reading as green. Each carries a positive
 *     control, because an absence assertion that cannot see a presence is
 *     vacuous (CLAUDE.md trap #13).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  readConstraintVerdictStateForFacts,
  readMayNameLeadingOptionForFacts,
  readMayNameLeadingOptionVerdict,
  type ClaimSafetyScenarioScope,
} from '../claim-safety-read.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAIM_SAFETY_READ = resolve(HERE, '../claim-safety-read.ts');
const TURN_EXECUTOR = resolve(HERE, '../../turn-executor.ts');

const base = {
  scenario_id: 's',
  summary: 'x',
  leading_option_id: 'opt_a',
  graph_hash_at_run: 'h',
  enrichment: { analysis_status: 'completed' },
};

const runFact = (
  computed_at: string,
  verdict: { may_name_leading_option: boolean; constraint_verdict_state: string } | null,
): HandlerFact =>
  ({
    fact_type: 'run_analysis',
    noop: false,
    result: {
      ...base,
      computed_at,
      ...(verdict === null ? {} : { constraint_verdict: verdict }),
    },
  }) as unknown as HandlerFact;

/** The scope shape the turn path builds when the scenario read SUCCEEDED. */
const scopeWith = (fact: HandlerFact | null, windowTruncated = true): ClaimSafetyScenarioScope => ({
  newestAnalysisFact: fact,
  readOk: true,
  windowTruncated,
});

describe('the permission and the state come from ONE selection (B2)', () => {
  // The scenario's newest analysis, aged OUT of the 20-turn window — #726's
  // live case (`f63ccb45-…`, 31 turns). It withheld, and it recorded WHY.
  const scenarioFact = runFact('2026-07-02T00:00:00.000Z', {
    may_name_leading_option: false,
    constraint_verdict_state: 'unevaluated',
  });

  it('RED-FIRST: the window-scoped state reader DISAGREES with the scenario-scoped permission', () => {
    // This is the defect, expressed as the disagreement it actually was. The
    // turn path fed `context.prior_facts` to the state reader and
    // `(prior_facts, scope)` to the permission. On this input those are two
    // different questions, and they gave two different answers about one
    // scenario.
    const windowFacts: readonly HandlerFact[] = []; // the analysis aged out

    // What the permission said, post-#726: WITHHELD, on the evidence of the
    // scenario fact.
    const verdict = readMayNameLeadingOptionVerdict(windowFacts, scopeWith(scenarioFact));
    expect(verdict.may_name_leading_option).toBe(false);
    expect(verdict.provenance).toBe('scenario_fact');

    // What the OLD state read said, on the same turn, for the same scenario:
    // nothing was recorded. `readConstraintVerdictStateForFacts` is array-only
    // by contract, so this line reproduces the old call EXACTLY — it is the
    // window-scoped question the turn path used to ask.
    expect(readConstraintVerdictStateForFacts(windowFacts)).toBeNull();

    // ⇒ Same turn, same scenario: permission "withheld because of a real
    // analysis", explanation "nothing was recorded". `null` routes the
    // disclosure to the CAUSE-FREE tail, so the user was told a claim was
    // withheld and given no reason that the very same read had in hand.
    // The collapse is what makes these two the same answer:
    expect(verdict.constraint_verdict_state).toBe('unevaluated');
    expect(verdict.constraint_verdict_state).not.toBe(
      readConstraintVerdictStateForFacts(windowFacts),
    );
  });

  it('the state rides the SAME fact the boolean was read from, not merely the same array', () => {
    // Two facts, both selectable, disagreeing. One selection cannot split them.
    const older = runFact('2026-07-01T00:00:00.000Z', {
      may_name_leading_option: true,
      constraint_verdict_state: 'evaluated_feasible',
    });
    const newer = runFact('2026-07-02T00:00:00.000Z', {
      may_name_leading_option: false,
      constraint_verdict_state: 'identity_unresolved',
    });
    for (const facts of [
      [older, newer],
      [newer, older],
    ]) {
      const v = readMayNameLeadingOptionVerdict(facts, scopeWith(null, false));
      expect(v.may_name_leading_option).toBe(false);
      expect(v.constraint_verdict_state).toBe('identity_unresolved');
    }
  });

  it('a fact selected THROUGH the scenario scope carries its state out too', () => {
    const v = readMayNameLeadingOptionVerdict([], scopeWith(scenarioFact));
    expect(v).toEqual({
      may_name_leading_option: false,
      constraint_verdict_state: 'unevaluated',
      provenance: 'scenario_fact',
    });
  });

  it('both no-selection branches report a NULL state — nothing is invented', () => {
    // No analysis anywhere: the honest `true`, and no cause to name.
    expect(readMayNameLeadingOptionVerdict([], scopeWith(null, false))).toEqual({
      may_name_leading_option: true,
      constraint_verdict_state: null,
      provenance: 'no_analysis_exists',
    });
    // The degraded fail-closed branch: we withhold precisely BECAUSE we could
    // not look, so a named cause here would be a fabricated one.
    expect(
      readMayNameLeadingOptionVerdict([], {
        newestAnalysisFact: null,
        readOk: false,
        windowTruncated: true,
      }),
    ).toEqual({
      may_name_leading_option: false,
      constraint_verdict_state: null,
      provenance: 'fail_closed_truncated',
    });
  });

  it('the two array-only delegates stay byte-equivalent to the verdict they now share', () => {
    // `readMayNameLeadingOptionForFacts` and `readConstraintVerdictStateForFacts`
    // are now projections of one call. Pinned so a future edit cannot give
    // either of them a selection of its own again without this going red.
    const cases: ReadonlyArray<readonly HandlerFact[]> = [
      [],
      [runFact('2026-07-01T00:00:00.000Z', null)],
      [
        runFact('2026-07-01T00:00:00.000Z', {
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        }),
      ],
      [
        runFact('2026-07-01T00:00:00.000Z', {
          may_name_leading_option: false,
          constraint_verdict_state: 'unevaluated',
        }),
        runFact('2026-07-03T00:00:00.000Z', {
          may_name_leading_option: false,
          constraint_verdict_state: 'identity_unresolved',
        }),
      ],
    ];
    for (const facts of cases) {
      const v = readMayNameLeadingOptionVerdict(facts, scopeWith(null, false));
      expect(readMayNameLeadingOptionForFacts(facts)).toBe(v.may_name_leading_option);
      expect(readConstraintVerdictStateForFacts(facts)).toBe(v.constraint_verdict_state);
    }
  });
});

describe('STRUCTURAL: the duplicated selection cannot come back quietly', () => {
  const claimSafetySource = readFileSync(CLAIM_SAFETY_READ, 'utf8');
  const turnExecutorSource = readFileSync(TURN_EXECUTOR, 'utf8');

  /** Count real CALLS, not the mentions in prose. Derived, never listed. */
  const countCalls = (source: string, symbol: string): number =>
    source.split('\n').filter((line) => {
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      return code.includes(`${symbol}(`);
    }).length;

  it('the mechanism file performs EXACTLY ONE selection', () => {
    // The number is the whole claim. Two was the state of this file before the
    // collapse — a sibling reader with its own `selectRunAnalysisFact`, inside
    // the module whose header forbids a second derivation.
    // NOTE the symbol: `selectClaimBearingRunAnalysisFact`, the ENTITLEMENT
    // selector introduced by the P0 fix. Counting `selectRunAnalysisFact` here
    // would now be a pin on a symbol this file no longer calls — and would pass
    // at zero, i.e. vacuously (CLAUDE.md trap #13).
    expect(
      countCalls(claimSafetySource, 'selectClaimBearingRunAnalysisFact'),
      'claim-safety-read.ts must select the analysis fact ONCE. A second selection here is a ' +
        'second DERIVATION of the same answer — the exact class this module exists to close, ' +
        'and the class it was itself carrying until 2026-07-27. If you need another projection ' +
        'of the verdict, add a MEMBER to MayNameLeadingOptionVerdict and read it off the one ' +
        'selection; do not call the selector again.',
    ).toBe(1);
  });

  it('POSITIVE CONTROL: the one-selection count can FAIL', () => {
    // Rule 2 — an instrument that returns the same answer for "one selection"
    // and "could not look" is not an instrument. Re-introduce the removed
    // sibling derivation and prove the count moves.
    const reverted = claimSafetySource.replace(
      'return readMayNameLeadingOptionVerdict(facts, ARRAY_ONLY_SCOPE)\n    .constraint_verdict_state;',
      'const selected = selectClaimBearingRunAnalysisFact(facts);\n  if (selected === null) return null;\n  return null;',
    );
    expect(reverted, 'the anchor for the mutation no longer exists — re-derive it').not.toBe(
      claimSafetySource,
    );
    expect(countCalls(reverted, 'selectClaimBearingRunAnalysisFact')).toBe(2);
  });

  it('turn-executor NEVER re-reads the verdict state locally', () => {
    // Both of these were live call sites before the collapse: the entry read
    // (`…ForFacts(context.prior_facts)`) and the explanation gate
    // (`…FromResult(selectedForDisclosure.fact.result)`). The state arrives on
    // the threaded verdict now, so a call to either from this file means the
    // ceremony has been pasted back.
    for (const symbol of [
      'readConstraintVerdictStateFromResult',
      'readConstraintVerdictStateForFacts',
    ]) {
      expect(
        countCalls(turnExecutorSource, symbol),
        `turn-executor.ts calls ${symbol} — the constraint verdict STATE must arrive on ` +
          '`mayNameLeadingOptionVerdictForRun`, read off the same selected fact as the boolean. ' +
          'A local re-read is a second derivation and it will agree with the permission only ' +
          'until someone changes the array or the scope of one of them (which is what happened ' +
          'in #726).',
      ).toBe(0);
    }
  });

  it('POSITIVE CONTROL: the turn-executor absence check can FAIL', () => {
    // Prove the absence assertion can see a presence — plant the exact
    // expression the explanation gate used to carry. Measured RELATIVE to the
    // live count so this control reports the instrument's discrimination and
    // not the pin's verdict a second time (a control pinned to an absolute
    // "current" decays into a tautology or a duplicate alarm the first time
    // "current" moves — CLAUDE.md trap 12b).
    const before = countCalls(turnExecutorSource, 'readConstraintVerdictStateFromResult');
    const planted = `${turnExecutorSource}\n const s = readConstraintVerdictStateFromResult(sel.fact.result);`;
    expect(countCalls(planted, 'readConstraintVerdictStateFromResult')).toBe(before + 1);
  });

  /**
   * Occurrences of the unified-array LITERAL in code, ignoring the comments
   * that legitimately quote it while explaining the history. Derived per line
   * the same way {@link countCalls} is, so prose can discuss the literal
   * without arming the pin.
   */
  const countLiteralInCode = (source: string): number =>
    source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => line.includes('[...handlerFactsForCommit, ...context.prior_facts]')).length;

  it('the unified fact array is BOUND once on the execute path, not retyped', () => {
    // FOUR code sites retyped this literal in one block — the freshness
    // derivation, the claim-safety re-read, the explanation gate's selection,
    // and the composer's `lifecycle.priorFacts` — and the comments at three of
    // them each asserted that the readers used "the SAME fact array". They did,
    // by the literals matching. The `priorFacts` one is the sharpest: its
    // comment explains that `freshness.selected_fact_index` is an index INTO
    // this array, so a divergence there is an off-by-N into someone else's
    // array, not a type error. One binding makes all four sentences true by
    // construction.
    expect(turnExecutorSource).toContain('const unifiedFactsForPostHandler = [');
    expect(
      countLiteralInCode(turnExecutorSource),
      'the unified fact-array literal is retyped in turn-executor.ts. Bind it once ' +
        '(`unifiedFactsForPostHandler`) and pass the binding: a retyped literal is a ' +
        'hand-maintained mirror of its copies, and editing one of them is a silent divergence ' +
        'between freshness, the permission, the prose explaining the permission, and the ' +
        'index basis the composer resolves blocks against.',
    ).toBe(0);
  });

  it('POSITIVE CONTROL: the retyped-literal check can FAIL, and ignores comments', () => {
    const before = countLiteralInCode(turnExecutorSource);
    const planted = `${turnExecutorSource}\n const again = [...handlerFactsForCommit, ...context.prior_facts];`;
    expect(countLiteralInCode(planted)).toBe(before + 1);
    // …and the discriminator really is code-vs-comment: the same text in a
    // comment must NOT arm it, or the pin would forbid explaining itself.
    const commented = `${turnExecutorSource}\n // [...handlerFactsForCommit, ...context.prior_facts]`;
    expect(countLiteralInCode(commented)).toBe(0);
  });
});
