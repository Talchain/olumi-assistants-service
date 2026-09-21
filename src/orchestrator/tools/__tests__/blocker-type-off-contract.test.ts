/**
 * THE READINESS AUTHORITY MAY NOT SILENTLY DISCARD A GAP IT CANNOT NAME.
 *
 * `blockerIssue` is the single mapper behind THREE live surfaces — the canonical
 * assessment's own `readiness_issues[]` (`analysis-ready-helper.ts`
 * `appendSemanticIssues`), the `analysis_state` wire composer
 * (`compose/analysis-state-v1.ts` `mapWireBlockers`) and the routing readiness
 * summary (`routing/readiness-summary.ts`).
 *
 * Before this spec it answered an unrecognised `blocker_type` with
 * `default: return null`, and every one of those three call sites drops a null.
 * So a blocker the PRODUCER emitted — a real gap it had detected — vanished from
 * every readiness surface with no error, no log and no test able to see it. The
 * drift read as green, which is the whole defect class this guard exists for.
 *
 * ⚠ THE DIRECTION IS DELIBERATE AND IT IS FAIL-SAFE. An off-contract
 * `blocker_type` means this build cannot CHARACTERISE the gap the producer is
 * reporting. Claiming readiness in that state would be a lie about the user's
 * own model, so the issue is raised in the `internal` category, which
 * `assessCanonicalAnalysisReadiness` treats as hard-blocking. Refusing loudly is
 * correct where silently proceeding is not — the same fail-safe direction
 * `analysis-ready-core.ts` states for its own unreachable-code removals.
 *
 * ⚠ SCOPE, STATED PRECISELY (trap 20). This path is UNREACHABLE from any
 * in-repo producer at this tip: the mapper's table is exhaustive over
 * `AnalysisBlockerType` by construction and `tsc` REDs if that stops being true
 * (see blocker-type-vocabulary-derived.test.ts). It exists for the case a
 * compile-time check cannot reach — a payload produced by a DIFFERENT build or
 * arriving through an untyped passthrough, which is exactly how `blockers[]`
 * reaches `mapWireBlockers(blockers: readonly unknown[])`.
 */

import { describe, it, expect } from 'vitest';
import { blockerIssue } from '../analysis-ready-helper.js';
import { AnalysisBlockerType } from '../../../schemas/analysis-ready.js';

function offContractBlocker(overrides: Record<string, unknown> = {}) {
  return {
    option_id: 'opt_hubspot',
    option_label: 'Switch to HubSpot',
    factor_id: 'fac_licence_cost',
    factor_label: 'CRM Annual Licence Cost',
    // A value the PUBLISHED contract does not define. A later CEE build adding a
    // fifth member, or an enrichment passthrough, produces exactly this shape.
    blocker_type: 'awaiting_external_evidence',
    message: 'The evidence this figure depends on has not come back yet.',
    ...overrides,
  };
}

describe('blockerIssue — an off-contract blocker_type is surfaced, never dropped', () => {
  it('PRECONDITION: the probe value really is outside the published vocabulary', () => {
    // Pinned in-test (trap 13b). If someone adds this token to the enum the
    // fixture stops exercising the discriminator, and this assertion REDs rather
    // than letting the rest of the file pass for the wrong reason.
    const published: readonly string[] = AnalysisBlockerType.options;
    expect(published).not.toContain('awaiting_external_evidence');
    // Contrast control in the same assertion block: the probe can SEE the
    // vocabulary it is claiming absence from.
    expect(published).toContain('missing_value');
  });

  it('returns an issue rather than null for a blocker_type it cannot name', () => {
    const issue = blockerIssue(offContractBlocker(), 0, 'needs_user_input');

    expect(issue).not.toBeNull();
    expect(issue?.code).toBe('INTERNAL_ERROR');
    expect(issue?.category).toBe('internal');
  });

  it('keeps the producer-authored sentence, because CEE owns user-facing language', () => {
    const issue = blockerIssue(offContractBlocker(), 0, 'needs_user_input');
    expect(issue?.message).toBe(
      'The evidence this figure depends on has not come back yet.',
    );
  });

  it('still says something useful when the producer authored no sentence', () => {
    const issue = blockerIssue(
      offContractBlocker({ message: '   ' }),
      0,
      'needs_user_input',
    );
    expect(issue).not.toBeNull();
    expect(issue?.message).toContain('Switch to HubSpot');
    expect(issue?.message).toContain('CRM Annual Licence Cost');
  });

  it('carries the option and factor scoping through, so the gap stays locatable', () => {
    const issue = blockerIssue(offContractBlocker(), 0, 'needs_user_input');
    expect(issue?.option_id).toBe('opt_hubspot');
    expect(issue?.factor_id).toBe('fac_licence_cost');
  });

  it('DOES still return null for input that is not a blocker at all', () => {
    // The repair is scoped to a PRESENT-but-unrecognised vocabulary token. A
    // malformed carrier is a different question and its handling is unchanged —
    // widening the repair to cover it would invent a blocker out of noise.
    expect(blockerIssue(null, 0, 'needs_user_input')).toBeNull();
    expect(blockerIssue('not an object', 0, 'needs_user_input')).toBeNull();
    expect(
      blockerIssue({ factor_id: 'fac_a', factor_label: 'A' }, 0, 'needs_user_input'),
    ).toBeNull();
    expect(
      blockerIssue(offContractBlocker({ blocker_type: '   ' }), 0, 'needs_user_input'),
    ).toBeNull();
  });

  it('does NOT reclassify any published blocker_type as internal', () => {
    // The complement of the case above (trap 22b: a corpus that watches one door).
    // Derived from the authority, so it cannot drift out of step with it.
    for (const published of AnalysisBlockerType.options) {
      const issue = blockerIssue(
        offContractBlocker({ blocker_type: published }),
        0,
        'needs_user_input',
      );
      expect(issue, `published blocker_type ${published} must map`).not.toBeNull();
      expect(issue?.code, `published blocker_type ${published}`).not.toBe('INTERNAL_ERROR');
      expect(issue?.category, `published blocker_type ${published}`).not.toBe('internal');
    }
  });
});
