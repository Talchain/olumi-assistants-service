/**
 * ⛔⛔ THE EGRESS GRAMMAR'S FAMILY ORDER MUST MATCH THE ORDER THE SUMMARY IS
 * COMPOSED IN — AND NOTHING PINNED IT.
 *
 * `TAIL_PATTERN` (`analysis-result-headline.ts`) concatenates each disclosure
 * family's grammar IN ORDER, and `TEMPLATE_SUFFIX_ONLY_REGEX` matches the
 * composed text against it. `run-analysis.ts` concatenates the corresponding
 * suffix VARIABLES in its own order. If those two orders disagree, the
 * composed summary stops matching the allowlist and collapses to the locked
 * template — every disclosure in it disappears at once, silently.
 *
 * Independent review DROVE that consequence rather than asserting it:
 * reordering the families flips a realistic 336-character summary from
 * admitted to rejected. A control mutant on a PRE-EXISTING pair survived too,
 * so the gap covers all the families, not one PR's addition.
 *
 * ⚠ THE OBVIOUS FORMULATION IS WRONG, AND IT IS WORTH SAYING WHY.
 * "Assert TAIL_PATTERN order equals TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS order"
 * does NOT hold: that registry is the WITHHELD/locked-template branch's list
 * and carries its own exclusions — `OBJECTIVE_CONTRADICTION_RE_SRC` is
 * deliberately excluded from it, and `SEPARABILITY` is registered there and
 * deliberately absent from `TAIL_PATTERN`. Asserting that equality would be
 * false and would have to be weakened until it stopped biting. The invariant
 * that IS true is the one below: TAIL order vs COMPOSITION order.
 *
 * ⚠ BOTH SIDES ARE DERIVED FROM SOURCE. Neither is a hand-maintained list, so
 * this cannot drift into the mirror it exists to prevent. A family that cannot
 * be paired is REPORTED BY NAME and fails, rather than being skipped — which
 * is what makes a forgotten wiring loud instead of silent.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEADLINE_SRC = readFileSync(resolve(HERE, '../analysis-result-headline.ts'), 'utf8');
const RUN_ANALYSIS_SRC = readFileSync(
  resolve(HERE, '../../tools/handlers/run-analysis.ts'),
  'utf8',
);

/**
 * The SUFFIX families, in `TAIL_PATTERN` order.
 *
 * Split at `STATUS_SUFFIX_PATTERN`: everything before it is a headline PREFIX
 * family (not-robust, eliminated, reduced-samples) and is not a suffix
 * disclosure at all. Splitting mechanically avoids hand-listing exclusions.
 */
function tailSuffixFamilies(): string[] {
  const line = HEADLINE_SRC.split('\n').find((l) => l.startsWith('const TAIL_PATTERN'));
  if (line === undefined) return [];
  const after = line.slice(line.indexOf('STATUS_SUFFIX_PATTERN'));
  return [...after.matchAll(/\$\{([A-Z_]+_RE_SRC)\}/g)].map((m) => m[1] as string);
}

/** The suffix variables, in the order `run-analysis.ts` concatenates them. */
function compositionOrder(): string[] {
  const line = RUN_ANALYSIS_SRC.split('\n').find((l) => l.includes('const summary = `${headline'));
  if (line === undefined) return [];
  return [...line.matchAll(/\$\{([a-zA-Z]+Disclosure)\}/g)].map((m) => m[1] as string);
}

const normalise = (s: string): string =>
  s.replace(/_DISCLOSURE_RE_SRC$/, '').replace(/_RE_SRC$/, '').replace(/Disclosure$/, '')
    .replace(/_/g, '').toLowerCase();

describe('TAIL_PATTERN family order matches the summary composition order', () => {
  const tail = tailSuffixFamilies();
  const comp = compositionOrder();

  it('POSITIVE CONTROL — both orders were actually extracted', () => {
    expect(tail.length, 'TAIL_PATTERN suffix families').toBeGreaterThan(2);
    expect(comp.length, 'composed suffix variables').toBeGreaterThan(2);
  });

  it('NEGATIVE CONTROL — the extraction does not invent entries', () => {
    expect(tail).not.toContain('DEFINITELY_NOT_A_FAMILY_RE_SRC');
    expect(comp).not.toContain('definitelyNotADisclosure');
  });

  /**
   * A family in the grammar with no counterpart in the composition is either a
   * wiring someone forgot or a rename that half-landed. Either way it must be
   * loud.
   */
  it('⭐ every TAIL_PATTERN suffix family pairs with a composed variable', () => {
    const unpaired = tail.filter((t) => {
      const nt = normalise(t);
      return !comp.some((c) => {
        const nc = normalise(c);
        return nt.includes(nc) || nc.includes(nt);
      });
    });
    expect(unpaired, `unpaired grammar families — wire them or rename consistently`).toEqual([]);
  });

  it('⭐ and they appear in the SAME RELATIVE ORDER', () => {
    const positions = tail.map((t) => {
      const nt = normalise(t);
      return comp.findIndex((c) => {
        const nc = normalise(c);
        return nt.includes(nc) || nc.includes(nt);
      });
    });
    const ascending = positions.every((p, i) => i === 0 || positions[i - 1]! < p);
    expect(
      ascending,
      `TAIL_PATTERN order ${tail.join(' > ')} does not match composition order ${comp.join(' > ')} — the composed summary will fail the egress allowlist and collapse to the locked template`,
    ).toBe(true);
  });
});
