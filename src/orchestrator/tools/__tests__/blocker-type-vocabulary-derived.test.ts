/**
 * THE READINESS AUTHORITY MAY NOT SILENTLY DISAGREE WITH THE CONTRACT IT MIRRORS.
 *
 * `assessCanonicalAnalysisReadiness` is this estate's single named readiness
 * authority, and it held a hand-maintained copy of the published blocker
 * vocabulary inside its own file: a four-case `switch (blockerType)` in
 * `blockerIssue`, with `default: return null`.
 *
 * Two properties made that drift invisible:
 *   1. `blockerType` arrives as a bare `string` (read off untyped wire bytes via
 *      `readNonEmptyString`), so TypeScript could not check the switch for
 *      exhaustiveness — a `switch` over a `string` has no exhaustiveness check
 *      to fail.
 *   2. All THREE consumers of the mapper drop a `null` — `appendSemanticIssues`
 *      in `analysis-ready-helper.ts`, `mapWireBlockers` in
 *      `compose/analysis-state-v1.ts`, and `readiness-summary.ts`.
 * So a member added to `AnalysisBlockerType` would have fallen through and the
 * blocker would have vanished from every readiness surface, with nothing red.
 *
 * The table is now keyed by the enum and closed with
 * `satisfies Record<AnalysisBlockerTypeT, …>`, so the drift is a COMPILE error.
 * This spec pins the same property at RUNTIME and in BOTH directions, because a
 * `satisfies` clause is easy to delete and a deleted one leaves no trace.
 *
 * ⚠ WHAT THIS SPEC CANNOT DO. It proves the two statements AGREE. It cannot
 * prove the enum is RIGHT — if the authority itself were short a member the
 * product really emits, every assertion here stays green, because they all
 * derive from that same short list. That is the other half, and it is in
 * `blocker-type-wire-corpus.test.ts`, which enumerates from recorded wire bytes
 * instead. Neither supersedes the other; drop either and a whole defect class
 * goes unobserved.
 */

import { describe, it, expect } from 'vitest';

import {
  blockerIssue,
  PUBLISHED_BLOCKER_TYPES,
  MAPPED_BLOCKER_TYPES,
} from '../analysis-ready-helper.js';
import { AnalysisBlockerType } from '../../../schemas/analysis-ready.js';

describe('the blocker vocabulary is DERIVED from the contract, not restated', () => {
  it('PRECONDITION: the probe is reading a real, non-empty vocabulary', () => {
    // Without this, every assertion below passes vacuously on two empty lists —
    // an instrument that extracted nothing agrees with every other instrument
    // that extracted nothing (trap 13).
    expect(AnalysisBlockerType.options.length).toBeGreaterThan(0);
    expect(PUBLISHED_BLOCKER_TYPES.length).toBe(AnalysisBlockerType.options.length);
    expect(MAPPED_BLOCKER_TYPES.length).toBeGreaterThan(0);
  });

  it('maps EVERY member the contract publishes — no member may fall through', () => {
    const published = [...PUBLISHED_BLOCKER_TYPES].sort();
    const mapped = [...MAPPED_BLOCKER_TYPES].sort();
    expect(mapped).toEqual(published);
  });

  it('maps NOTHING the contract does not publish — the other direction', () => {
    // A behavioural probe over the enum can only ever walk members that exist,
    // so it is structurally blind to an EXTRA key in the table. Only comparing
    // the key sets can see one.
    const published = new Set<string>(PUBLISHED_BLOCKER_TYPES);
    const extras = MAPPED_BLOCKER_TYPES.filter((key) => !published.has(key));
    expect(extras).toEqual([]);
  });

  it('every published member resolves to a usable, distinct readiness issue', () => {
    for (const member of AnalysisBlockerType.options) {
      const issue = blockerIssue(
        {
          option_id: 'opt_probe',
          option_label: 'Probe Option',
          factor_id: 'fac_probe',
          factor_label: 'Probe Factor',
          blocker_type: member,
        },
        0,
        'needs_user_input',
      );

      expect(issue, `no issue for published blocker_type "${member}"`).not.toBeNull();
      expect(issue?.code, `"${member}" must not fall through to the off-contract path`)
        .not.toBe('INTERNAL_ERROR');
      expect(issue?.message.length, `"${member}" produced an empty sentence`)
        .toBeGreaterThan(0);
      // Binding by identity, not by a value predicate another object could
      // satisfy (trap 19): the issue really is about the factor we asked about.
      expect(issue?.factor_id).toBe('fac_probe');
    }
  });

  it('gives each published member its OWN code — a table collapsed to one entry is not a mapping', () => {
    const codes = AnalysisBlockerType.options.map(
      (member) =>
        blockerIssue(
          { factor_id: 'fac_probe', factor_label: 'Probe Factor', blocker_type: member },
          0,
          'needs_user_input',
        )?.code,
    );
    expect(new Set(codes).size).toBe(AnalysisBlockerType.options.length);
  });
});
