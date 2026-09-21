/**
 * ⭐ THE COMPLETENESS HALF of the template-suffix disclosure registry.
 *
 * `TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS` removed a hand-maintained mirror: the
 * egress allowlist's template branch and the run_analysis confirmation salvage
 * are now compiled from ONE ordered array, so they cannot drift apart.
 *
 * ⚠ THAT DERIVATION CANNOT PROVE THE ARRAY IS COMPLETE (CLAUDE.md trap 12d).
 * Deriving a guard from a list moves the risk; it does not remove it. A new
 * disclosure family that never joins the array is still silently missed — the
 * identical failure one level up, and the failure that cost three families.
 *
 * So the check below is deliberately NOT derived from the same source. It scans
 * the coaching directory ON DISK for every exported `*_RE_SRC` and asserts each
 * one is either REGISTERED or EXPLICITLY EXCLUDED WITH A REASON. Adding a family
 * and forgetting to register it REDs here.
 *
 * The two guards are not redundant and neither supersedes the other: the
 * derivation stops consumers drifting from the list; this is what notices the
 * list is short.
 *
 * ⚠ STATE THE SCAN'S DOMAIN, SO NOBODY INHERITS IT AS BROADER THAN IT IS.
 * It matches `^export const *_RE_SRC` in TOP-LEVEL `.ts` files of
 * `src/orchestrator-v5/coaching/` — and nothing else. Specifically it is blind
 * to:
 *   - NON-EXPORTED `const *_RE_SRC`. Ten exist at the time of writing (six in
 *     `analysis-result-headline.ts`, four in `constraint-gap-disclosure.ts`),
 *     all of them legitimate sub-components composed into an exported grammar or
 *     into TAIL_PATTERN, never standalone families. A new family declared
 *     without `export` would be missed.
 *   - SUBDIRECTORIES of `coaching/` (there are none today, so this limit is
 *     currently vacuous — it will not stay that way by itself).
 *   - other naming conventions: a grammar not suffixed `_RE_SRC` is invisible.
 * As measured, the union is EXACTLY complete: 10 exported = 4 registered +
 * 6 reasoned-exclusions.
 *
 * ⚠ AND WHAT THIS GUARD CANNOT SEE AT ALL: a family accounted for WRONGLY.
 * Moving a registered entry onto the exclusion list with a plausible reason
 * keeps every assertion here green while the withheld egress branch stops
 * admitting it and the salvage stops rescuing it. That is behaviour, not
 * bookkeeping, and it is pinned per-family — see
 * `routing/__tests__/unset-option-effect-salvage-registration.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS,
  TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS,
} from '../analysis-result-headline.js';

const COACHING_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** name → the file that exports it. Scanned, never hand-listed. */
function scanExportedReSrcs(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(COACHING_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    const source = readFileSync(resolve(COACHING_DIR, entry.name), 'utf8');
    for (const m of source.matchAll(/^export const ([A-Z0-9_]+_RE_SRC)\b/gm)) {
      found.set(m[1] as string, entry.name);
    }
  }
  return found;
}

const SCANNED = scanExportedReSrcs();

describe('the scan itself can see (positive + contrast controls)', () => {
  /**
   * An absence/coverage assertion is worthless if the instrument is blind
   * (trap 13). These controls fail loudly if the scan silently stops matching —
   * a rename, a formatting change, or a wrong directory would otherwise make
   * every assertion below pass by testing nothing.
   */
  it('finds a known-present grammar (positive control)', () => {
    expect(SCANNED.get('SCAFFOLD_ANY_DISCLOSURE_RE_SRC')).toBe('scaffold-disclosure.ts');
  });

  it('finds a known-present EXCLUDED grammar too (contrast control — both classes visible)', () => {
    expect(SCANNED.get('OBJECTIVE_CONTRADICTION_RE_SRC')).toBe('objective-contradiction.ts');
  });

  it('does not invent a grammar that does not exist (negative control)', () => {
    expect(SCANNED.has('DEFINITELY_NOT_A_REAL_DISCLOSURE_RE_SRC')).toBe(false);
  });

  it('the scan magnitude is plausible — at least one per registered family plus the exclusions', () => {
    expect(SCANNED.size).toBeGreaterThanOrEqual(
      TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.length + TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS.length,
    );
  });
});

describe('⭐ union assertion — every disclosure grammar is registered or reasoned-excluded', () => {
  const registered = new Set(TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.map((g) => g.name));
  const excluded = new Set(TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS.map((e) => e.name));

  it('REDs when a family is in neither list', () => {
    const unaccounted = [...SCANNED.keys()].filter((n) => !registered.has(n) && !excluded.has(n));
    expect(
      unaccounted,
      `These disclosure grammars are exported from src/orchestrator-v5/coaching/ but are ` +
        `neither registered in TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS nor on the reasoned ` +
        `exclusion list. A family in neither is SILENTLY DROPPED from the run_analysis ` +
        `confirmation salvage — the exact defect this guard exists to stop. Register it, ` +
        `or exclude it with a reason: ${unaccounted.join(', ')}`,
    ).toEqual([]);
  });

  it('no grammar is both registered and excluded', () => {
    expect([...registered].filter((n) => excluded.has(n))).toEqual([]);
  });

  it('every registered name really is exported from the coaching directory', () => {
    for (const { name } of TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS) {
      expect(SCANNED.has(name), `${name} is registered but not exported anywhere`).toBe(true);
    }
  });

  it('every excluded name really is exported from the coaching directory (no stale exclusions)', () => {
    for (const { name } of TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS) {
      expect(SCANNED.has(name), `${name} is excluded but no longer exists`).toBe(true);
    }
  });

  it('every exclusion carries a substantive reason', () => {
    for (const { name, reason } of TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS) {
      expect(reason.trim().length, `${name} is excluded with no reason`).toBeGreaterThan(30);
    }
  });
});

describe('registered entries are bound to the real export BY IDENTITY, not by label', () => {
  /**
   * `name` is a hand-written string, so it could drift from the symbol it
   * claims to describe. This resolves each name through the SCAN to its own
   * module, imports that module, and asserts the registered `source` IS that
   * module's export — so a mislabelled entry cannot register the wrong grammar
   * under a plausible-looking name (trap 19).
   */
  it('each registered source === the module export its name points at', async () => {
    expect(TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.length).toBeGreaterThan(0);
    for (const { name, source } of TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS) {
      const file = SCANNED.get(name);
      expect(file, `${name} not found by the scan`).toBeDefined();
      const mod = (await import(`../${(file as string).replace(/\.ts$/, '.js')}`)) as Record<
        string,
        unknown
      >;
      expect(mod[name], `${name} is not exported by ${file as string}`).toBeTypeOf('string');
      expect(mod[name]).toBe(source);
    }
  });
});
