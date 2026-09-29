/**
 * NO-DEFAULT PIN for the `run_delta` fact basis (`priorFacts`) across its three
 * seams: the executor exit, the route hand-off, and the finaliser read.
 *
 * ⚠⚠ WHY A SOURCE GUARD AND NOT A BEHAVIOURAL TEST — the honest reason, because
 * "we could not test it behaviourally" is usually an excuse and here it is a
 * measurement. Substituting `run.priorFacts ?? []` at the route hop was run as
 * a mutant against BOTH behavioural specs for this seam and it SURVIVED, 6/6
 * green. It survives for a real reason: `[]` reaches `attachRunDelta`, clears
 * its `undefined` check, and is then refused by the producer anyway
 * (`selectTwoNewestRunAnalysisFacts([])` → null → `insufficient_runs`), so the
 * wire bytes are identical. **The prohibition has no observable consequence
 * today.** It is a claim-safety invariant about what the code is ENTITLED to
 * assert, held one refusal away from mattering — the day `buildRunDelta` gains
 * any behaviour on an empty window, `?? []` becomes the product asserting
 * "there were no prior runs" when the truth is "this turn completed no run".
 * A guard is the only instrument that can hold that line, so it is written as
 * a guard and labelled as one, rather than dressed up as a behavioural test
 * that would be pinning nothing.
 *
 * ⚠ IT SCANS THE COMMENT-STRIPPED VIEW. Every file below documents this exact
 * prohibition in prose, and a raw-text scan would fire on the design note
 * explaining why the anti-pattern is banned — the source-scanning-guard
 * footgun `strip-source-comments.mjs` exists to remove.
 *
 * ⚠ CONTROLS, because an absence assertion with no positive control is
 * vacuous (CLAUDE.md trap 13):
 *   - a CONTRAST control asserts each scanned file really does mention
 *     `priorFacts` (a scan that silently read nothing returns the same clean
 *     zero as a scan that looked);
 *   - a POSITIVE control asserts the detector FIRES on a synthetic violation;
 *   - a DISCRIMINATION control asserts the same text inside a COMMENT does NOT
 *     fire, so the two results differ and the stripper is provably doing work.
 *
 * Auto-enrols in the required CI gate by living under tests/contract/.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { stripComments, stripCommentsFile } from '../../scripts/ci/strip-source-comments.mjs';

/**
 * A nullish/logical default applied to anything named `priorFacts`, on one
 * statement. Deliberately narrow: `run.priorFacts ? { … } : {}` is the
 * SANCTIONED conditional shape and carries no `??`/`||`, so it does not match.
 */
const PROHIBITED = /priorFacts[^;\n]*(\?\?|\|\|)/;

/** The three seams the basis crosses, from producer of the value to consumer. */
const SEAMS = [
  'src/orchestrator-v5/turn-executor.ts',
  'src/orchestrator/route-v2.ts',
  'src/orchestrator-v5/response-finaliser.ts',
] as const;

function abs(rel: string): string {
  return fileURLToPath(new URL(`../../${rel}`, import.meta.url));
}

function offendingLines(source: string): string[] {
  return source
    .split('\n')
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => PROHIBITED.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

describe('run_delta basis — `priorFacts` is never defaulted', () => {
  it.each(SEAMS)('CONTRAST CONTROL: %s genuinely mentions priorFacts', (rel) => {
    // Without this, a renamed/moved file would make the pin below pass by
    // scanning something that has nothing to do with this seam.
    const stripped = stripCommentsFile(abs(rel));
    const mentions = stripped.split('\n').filter((l) => l.includes('priorFacts')).length;
    expect(mentions).toBeGreaterThan(0);
  });

  it.each(SEAMS)('THE PIN: %s applies no `??` / `||` default to priorFacts', (rel) => {
    expect(offendingLines(stripCommentsFile(abs(rel)))).toEqual([]);
  });

  it('POSITIVE CONTROL: the detector fires on the prohibited shape', () => {
    const violation = `const ctx = {\n  priorFacts: run.priorFacts ?? [],\n};\n`;
    expect(offendingLines(stripComments(violation))).toHaveLength(1);
    // …and on the logical-or spelling of the same mistake.
    const violationOr = `const ctx = { priorFacts: run.priorFacts || [] };\n`;
    expect(offendingLines(stripComments(violationOr))).toHaveLength(1);
  });

  it('DISCRIMINATION CONTROL: the SAME text inside a comment does NOT fire', () => {
    // The pair is the proof. Identical bytes, one as code and one as prose:
    // if both were clean the stripper could be doing nothing, and if both
    // fired the guard would punish honest documentation.
    const asProse = `// never write priorFacts: run.priorFacts ?? [] here\nconst ok = 1;\n`;
    expect(offendingLines(asProse)).toHaveLength(1); // raw text WOULD fire…
    expect(offendingLines(stripComments(asProse))).toEqual([]); // …stripped does not.
  });

  it('SANCTIONED SHAPE CONTROL: the conditional hand-off is not a false positive', () => {
    const sanctioned = `const x = { ...(run.priorFacts ? { priorFacts: run.priorFacts } : {}) };\n`;
    expect(offendingLines(stripComments(sanctioned))).toEqual([]);
  });

  it('the scanned files exist and are readable (no vacuous pass on a moved file)', () => {
    for (const rel of SEAMS) expect(readFileSync(abs(rel), 'utf8').length).toBeGreaterThan(0);
  });
});
