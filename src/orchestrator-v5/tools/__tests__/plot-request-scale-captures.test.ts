/**
 * ACCEPTANCE over the 13 real staging draft captures, RE-EXECUTABLE IN CI.
 *
 * The captures were taken on the pinned deployed quartet CEE `cab59b7` / PLoT
 * `b9f6b5a` / ISL `28fe0c9` (identical at pin-start and pin-end of every run), and
 * the fixture beside this file carries exactly what the projection reads: each
 * factor's `observed_state` and each option's interventions. It is committed so a
 * reviewer can re-execute these numbers instead of taking them from prose.
 *
 * WHAT IS AND IS NOT REPRODUCED HERE. The PAYLOAD-level acceptance below runs in
 * CI and is fully reproducible. The WIN-PROBABILITY numbers it is anchored to
 * (0.7360333333333333 for the self-consistent payload vs 0.9584333333333334 for
 * the mixed one) came from live calls to deployed PLoT `b9f6b5a` and are NOT
 * re-executed here — CI has no PLoT. `ceeReportedWinProbabilities` is carried in
 * the fixture as the observed live value for context, not as an assertion.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import {
  buildFactorScaleMap,
  projectInterventionsToRawScale,
  projectRequestInterventionsToWireScale,
} from '../plot-intervention-scale.js';

// Read the fixture from disk rather than importing it: an import attribute
// (`with { type: 'json' }`) needs `--module esnext|node18|node20|nodenext|preserve`,
// which this repo's typecheck config does not set, and the drift ratchet sees test
// files even though `tsconfig.build.json` excludes them.
const captures: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/staging-draft-captures-2026-08-10.json', import.meta.url), 'utf8'),
);

interface Capture {
  capture: string;
  divergentOnStaging: boolean;
  factorNodes: Array<Record<string, unknown>>;
  optionInterventions: Array<{ option_id: string; interventions: Record<string, unknown> }>;
}
const CAPTURES = captures as unknown as Capture[];

/** The faithful all-unit-scale replay payload — proven on deployed PLoT to give the honest answer. */
const faithfulReplay = (c: Capture) =>
  c.optionInterventions.map((o) =>
    Object.fromEntries(
      Object.entries(o.interventions).map(([k, v]) => [
        k,
        typeof v === 'object' && v !== null ? (v as { value: number }).value : (v as number),
      ]),
    ),
  );

describe('staging draft captures — payload acceptance (re-executable)', () => {
  it('the fixture is the corpus it claims to be', () => {
    // Assert inputs before believing any agreement (trap 13).
    expect(CAPTURES).toHaveLength(13);
    expect(CAPTURES.filter((c) => c.divergentOnStaging)).toHaveLength(4);
    for (const c of CAPTURES) {
      expect(c.optionInterventions.length, `${c.capture}: no options`).toBeGreaterThan(0);
      const n = c.optionInterventions.reduce((a, o) => a + Object.keys(o.interventions).length, 0);
      expect(n, `${c.capture}: no interventions`).toBeGreaterThan(0);
    }
  });

  it('the 4 divergent captures are repaired — emitted payload equals the faithful replay, and CHANGED from pre-fix', () => {
    const divergent = CAPTURES.filter((c) => c.divergentOnStaging);
    expect(divergent).toHaveLength(4);
    for (const c of divergent) {
      const map = buildFactorScaleMap(c.factorNodes);
      const raws = c.optionInterventions.map((o) => o.interventions);
      const before = raws.map((r) => projectInterventionsToRawScale(r, map).interventions);
      const after = projectRequestInterventionsToWireScale(raws, map).perOption;
      expect(after, `${c.capture}: must equal the faithful all-unit replay`).toEqual(faithfulReplay(c));
      expect(after, `${c.capture}: must differ from the pre-fix projection`).not.toEqual(before);
    }
  });

  it('the 9 reproducing captures are byte-identical to the pre-fix projection (the regression guard)', () => {
    const reproducing = CAPTURES.filter((c) => !c.divergentOnStaging);
    expect(reproducing).toHaveLength(9);
    for (const c of reproducing) {
      const map = buildFactorScaleMap(c.factorNodes);
      const raws = c.optionInterventions.map((o) => o.interventions);
      const before = raws.map((r) => projectInterventionsToRawScale(r, map).interventions);
      const after = projectRequestInterventionsToWireScale(raws, map).perOption;
      expect(after, `${c.capture}: must be byte-identical to the pre-fix projection`).toEqual(before);
    }
  });

  it('no capture violates the postcondition, and every demoted capture ends within [0,1]', () => {
    let demoted = 0;
    for (const c of CAPTURES) {
      const map = buildFactorScaleMap(c.factorNodes);
      const out = projectRequestInterventionsToWireScale(
        c.optionInterventions.map((o) => o.interventions),
        map,
      );
      expect(out.postconditionViolated, `${c.capture}: postcondition violated`).toBe(false);
      if (out.demoted) {
        demoted++;
        expect(out.allWithinUnitInterval, `${c.capture}: demoted but still mixed`).toBe(true);
      }
    }
    expect(demoted, 'exactly the 4 divergent captures must demote').toBe(4);
  });
});
