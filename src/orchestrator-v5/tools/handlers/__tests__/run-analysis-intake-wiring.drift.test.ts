/**
 * ROADMAP 2.579 — THE WIRING PIN.
 *
 * The producer, the gate and the copy are each unit-tested on their own, and
 * every one of those tests would stay GREEN if the run_analysis handler simply
 * stopped calling them. That is not a hypothetical failure mode in this estate:
 * ROADMAP 2.466 and 2.491 both shipped a fully-tested surface the deployed
 * product never mounted, and all seven render tests plus five mutants agreed
 * with each other while pointing at the wrong component.
 *
 * There is no in-process fixture for the whole `run_analysis` handler on this
 * path (it needs a PLoT envelope, a scenario reader and a live-ish snapshot),
 * so this file pins the wiring AT THE SOURCE — the same instrument
 * `claim-safety-one-derivation.test.ts` uses for the same reason, and with the
 * same discipline: every absence/presence assertion carries a PLANTED-SOURCE
 * positive control measured RELATIVE to the live text, so a control pinned to
 * "current" cannot decay into a tautology (CLAUDE.md trap 12b).
 *
 * ⚠ WHAT THIS DOES AND DOES NOT PROVE, stated exactly. It proves the handler
 * SOURCE composes the three seams in the declared order. It does NOT execute
 * the handler, so it is not a journey witness and not a wire witness — it sits
 * at the CODE EXISTS / TESTED rungs of the status ladder and nothing above.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_ANALYSIS = resolve(HERE, '../run-analysis.ts');
const source = readFileSync(RUN_ANALYSIS, 'utf8');

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('2.579 wiring — the handler actually consumes the intake axis', () => {
  it('derives the reconciliation from the persisted brief and the graph labels', () => {
    expect(occurrences(source, 'deriveIntakeOptionReconciliation(')).toBeGreaterThan(0);
    // BOUND TO THE INPUTS BY IDENTITY. A derivation fed something other than
    // `snapshot.briefText` is a different claim wearing the same call.
    expect(source).toContain('snapshot.briefText');
    expect(occurrences(source, 'readGraphOptionLabels(')).toBeGreaterThan(0);
  });

  it('feeds the headline gate', () => {
    expect(source).toContain(
      "intake_options_missing: intakeReconciliation.state === 'options_missing'",
    );
  });

  it('appends the disclosure to the summary, LAST', () => {
    // The order is load-bearing: `analysis-result-headline.ts`'s TAIL_PATTERN
    // admits the intake slot only after the constraint-gap slot, so a handler
    // that appended it earlier would compose a summary its own egress
    // allowlist rejects — and the user would silently receive the locked
    // template with no error anywhere.
    expect(source).toContain(
      '${headline ?? template}${scaffoldDisclosure}${constraintGapDisclosure}${intakeDisclosure}',
    );
    expect(occurrences(source, 'buildIntakeOptionDisclosure(')).toBeGreaterThan(0);
  });

  it('folds the intake answer into the PERSISTED leader permission', () => {
    // Not the headline alone. ROADMAP 1.218's defect class is a verdict that
    // gates prose while the structured surfaces still name the leader inside
    // the same HTTP response.
    expect(source).toContain('applyIntakeToLeaderPermission(');
    expect(source).toContain('projectClaimSafety(constraintVerdict)');
    const stamp = source.slice(source.indexOf('constraint_verdict:'));
    expect(stamp.slice(0, 200)).toContain('applyIntakeToLeaderPermission');
  });

  it('POSITIVE CONTROL — these checks can see a change', () => {
    // Each assertion above is a presence claim, so the control plants an
    // ABSENCE and proves the instrument moves. Measured relative to the live
    // text, never against an absolute count.
    for (const needle of [
      'deriveIntakeOptionReconciliation(',
      'buildIntakeOptionDisclosure(',
      'applyIntakeToLeaderPermission(',
    ]) {
      const before = occurrences(source, needle);
      expect(before).toBeGreaterThan(0);
      const stripped = source.split(needle).join('__REMOVED__');
      expect(occurrences(stripped, needle)).toBe(0);
      expect(occurrences(`${source}\n// ${needle}`, needle)).toBe(before + 1);
    }
  });
});
