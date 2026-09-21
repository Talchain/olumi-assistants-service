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
 * As measured 21 Sep 2026, the union is EXACTLY complete: 12 exported =
 * 6 registered + 6 reasoned-exclusions. (This sentence is a MEASUREMENT, not an
 * authority — it read "10 = 4 + 6" until the participation family landed and
 * again until the separability family did, and nothing REDs when it drifts. The
 * assertions below are derived; re-derive this line rather than trusting it.)
 *
 * ⚠ AND WHAT THIS GUARD CANNOT SEE AT ALL: a family accounted for WRONGLY.
 * Moving a registered entry onto the exclusion list with a plausible reason
 * keeps every assertion here green while the withheld egress branch stops
 * admitting it and the salvage stops rescuing it. That is behaviour, not
 * bookkeeping, and it is pinned per-family — see
 * `routing/__tests__/unset-option-effect-salvage-registration.test.ts`.
 *
 * ⭐⭐ AND THE THIRD THING NEITHER HALF COULD SEE, ADDED 21 Sep 2026: A FAMILY
 * ACCOUNTED FOR CORRECTLY AND REGISTERED IN THE WRONG POSITION.
 *
 * `TEMPLATE_SUFFIX_ONLY_REGEX` compiles this array IN ORDER, so the registry
 * order is not cosmetic — it must equal the `run_analysis` handler's own append
 * order or a composed summary is a shape the allowlist does not recognise, and
 * the user silently receives the bare template. Until now that correspondence
 * was pinned only by two per-family proxies that never mention the handler at
 * all: one relative (`unset-option-effect-salvage-registration.test.ts`: "after
 * the intake family") and one ABSOLUTE (`analysis-participation-disclosure.test.ts`:
 * "rides LAST"). The absolute one is a hand-maintained mirror by construction —
 * it can only hold while its family is the newest — and it RED on the very next
 * family to arrive (the withheld-separability disclosure, #1650) although
 * NOTHING WAS IN THE WRONG POSITION: the handler appended it last and the
 * registry registered it last, in agreement.
 *
 * So the last describe block below derives the append order from
 * `tools/handlers/run-analysis.ts` ON DISK and asserts the registry equals it.
 * That is strictly stronger than either proxy: it constrains EVERY family's
 * position, and it is the only guard here that binds the registry to the
 * handler rather than to itself.
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

// ---------------------------------------------------------------------------
// ⭐⭐ ORDER — the registry must MIRROR the handler's append order.
// ---------------------------------------------------------------------------

const HANDLER_PATH = resolve(COACHING_DIR, '..', 'tools', 'handlers', 'run-analysis.ts');
const HANDLER_SRC = readFileSync(HANDLER_PATH, 'utf8');

/**
 * The ordered `${…}` slot names the handler composes the summary from, read
 * from its source. DERIVED, so a slot added, removed or reordered in
 * `run-analysis.ts` changes this array without anyone remembering to.
 *
 * Scoped deliberately to the suffix run AFTER `${headline ?? template}` — that
 * head is the verdict, not a disclosure, and `compose-site-verdict-consumption.
 * drift.test.ts` already pins the whole line verbatim.
 */
function extractHandlerAppendOrder(): readonly string[] {
  const line = /const summary = `\$\{headline \?\? template\}((?:\$\{\w+\})*)`;/.exec(HANDLER_SRC);
  if (line === null) return [];
  return [...(line[1] as string).matchAll(/\$\{(\w+)\}/g)].map((m) => m[1] as string);
}

const HANDLER_APPEND_ORDER = extractHandlerAppendOrder();

/**
 * slot name in `run-analysis.ts` → the disclosure family it emits, and how that
 * family is accounted for.
 *
 * ⚠ THIS IS A HAND-WRITTEN MAP, AND IT IS ALLOWED TO BE ONE ONLY BECAUSE IT
 * CANNOT DRIFT SILENTLY (trap 12): the first assertion below asserts its slot
 * list is EXACTLY what the handler source composes, so a new suffix slot REDs
 * here by name before it can be mis-registered. What a derivation cannot supply
 * is the slot→family binding — the handler names a local `const`, not a
 * grammar — so it is stated, and then bounded on both sides.
 */
const SLOT_FAMILY: ReadonlyArray<readonly [string, string, 'registered' | 'excluded']> = [
  ['scaffoldDisclosure', 'SCAFFOLD_ANY_DISCLOSURE_RE_SRC', 'registered'],
  ['constraintGapDisclosure', 'CONSTRAINT_GAP_DISCLOSURE_RE_SRC', 'registered'],
  ['intakeDisclosure', 'INTAKE_OPTION_DISCLOSURE_RE_SRC', 'registered'],
  // The one slot the handler appends that the template branch must NOT admit:
  // the tail asserts a LEADER and only ships when `headline !== null`, so
  // `template + tail` is a composition the handler can never emit. Its reason
  // is recorded on TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS and asserted below.
  ['objectiveContradictionDisclosure', 'OBJECTIVE_CONTRADICTION_RE_SRC', 'excluded'],
  ['unsetOptionEffectDisclosure', 'UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC', 'registered'],
  ['participationDisclosure', 'ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC', 'registered'],
  ['separabilityDisclosure', 'SEPARABILITY_DISCLOSURE_RE_SRC', 'registered'],
];

describe('the handler-source extractor can see (controls first — trap 13)', () => {
  /**
   * An order assertion built on an extractor that returned NOTHING agrees with
   * everything: `[] === []` is the shape of two instruments that both read
   * zero. These controls make that impossible to ship silently.
   */
  it('extracts a NON-EMPTY append order (the assertion below is not vacuous)', () => {
    expect(
      HANDLER_APPEND_ORDER.length,
      `Extracted no summary slots from ${HANDLER_PATH}. Either the composition ` +
        `line moved or its shape changed — do NOT read the order assertions below ` +
        `as green until this is non-zero.`,
    ).toBeGreaterThan(0);
  });

  it('positive control — a slot known to be composed is found', () => {
    expect(HANDLER_APPEND_ORDER).toContain('scaffoldDisclosure');
  });

  it('negative control — it does not invent a slot the handler does not compose', () => {
    expect(HANDLER_APPEND_ORDER).not.toContain('definitelyNotARealDisclosure');
  });

  it('contrast control — the extractor is bound to the SUFFIX run, not the whole file', () => {
    // `headline` and `template` are composed on the same line and are NOT
    // suffixes. If either appears here the scope has silently widened.
    expect(HANDLER_APPEND_ORDER).not.toContain('headline');
    expect(HANDLER_APPEND_ORDER).not.toContain('template');
  });
});

describe('⭐⭐ ORDER — the registry mirrors the run_analysis handler append order', () => {
  it('every suffix slot the handler composes is accounted for, in the handler’s own order', () => {
    expect(
      HANDLER_APPEND_ORDER,
      `The summary composition in ${HANDLER_PATH} does not match SLOT_FAMILY. A new ` +
        `disclosure suffix must be added to SLOT_FAMILY at the SAME POSITION the handler ` +
        `appends it, and then registered (or reasoned-excluded) in that position too — ` +
        `TEMPLATE_SUFFIX_ONLY_REGEX compiles the registry IN ORDER, so a family registered ` +
        `out of position makes the egress reject the composed summary and the user ` +
        `silently receives the bare template.`,
    ).toEqual(SLOT_FAMILY.map(([slot]) => slot));
  });

  it('⭐ the registry order EQUALS the handler order, with the reasoned exclusions removed', () => {
    const expected = SLOT_FAMILY.filter(([, , d]) => d === 'registered').map(([, name]) => name);
    expect(
      TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.map((g) => g.name),
      `TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS is not in the handler's append order. This is ` +
        `the property the per-family pins were proxies for, and the only one that is ` +
        `actually load-bearing.`,
    ).toEqual(expected);
  });

  it('a slot mapped as `excluded` really is on the reasoned-exclusion list', () => {
    const excludedNames = new Set(TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS.map((e) => e.name));
    const mappedExcluded = SLOT_FAMILY.filter(([, , d]) => d === 'excluded').map(([, n]) => n);
    // Pin the precondition: a map with no `excluded` rows would satisfy the
    // loop below by iterating nothing (trap 13b).
    expect(mappedExcluded.length).toBeGreaterThan(0);
    for (const name of mappedExcluded) {
      expect(
        excludedNames.has(name),
        `${name} is composed by the handler and mapped 'excluded' here, but carries no ` +
          `reasoned exclusion. 'excluded' may not be used to park an unaccounted family.`,
      ).toBe(true);
    }
  });

  it('every family named in the map really is an exported grammar (no invented names)', () => {
    for (const [slot, name] of SLOT_FAMILY) {
      expect(SCANNED.has(name), `${slot} → ${name}, which nothing exports`).toBe(true);
    }
  });
});
