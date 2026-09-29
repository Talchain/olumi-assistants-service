#!/usr/bin/env node
/**
 * Assert that no TRACKED file is a shadow copy of a sibling.
 *
 * ── WHAT ACTUALLY HAPPENED HERE (derived, not remembered) ───────────────────
 * Every duplication artefact this repo has ever carried was the macOS/Finder
 * SPACE-BEARING shape `<name> 2.<ext>`. Measured over all 2306 commits reachable
 * from `staging` at 0ecf5c67 (`git log --name-status`, node_modules excluded):
 *
 *   - 228 path-events matching `<name> <N>.<ext>`; the numeric suffix was `2`
 *     in 100% of them. ZERO paths ever matched ` copy`, `-copy` or `_copy`.
 *   - Two mass ADD events: 2463f653 (#5, 48 files) and 5ffac8db (#28, 63 files).
 *   - Two mass DELETE events: 5cd92476 (#36, 75 files) and 20a331ec (#51, 34
 *     files). 20a331ec's own message: "Remove 100+ duplicate files (` 2.ts`,
 *     ` 3.ts`, ` 2.md`)".
 *   - The artefacts spanned .ts .js .mjs .cjs .md .json .yml .yaml .sh .html
 *     .example — NOT just .ts/.js.
 *
 * The guard was born in 5cd92476, the same commit as the second cleanup, and it
 * checked exactly the shape that had occurred: `git ls-files '* 2.ts'`. It was
 * later BROADENED (ea886bef) to eight globs — `* 2.ts`, `* 2.js`, `* copy.ts`,
 * `* copy.js`, `*_copy.ts`, `*_copy.js`, `*-copy.ts`, `*-copy.js` — under a
 * comment claiming "Only match delimited patterns to avoid false positives".
 *
 * ── WHY THAT BROADENING WAS WRONG ───────────────────────────────────────────
 * A hyphen is not a delimiter inside a kebab-case filename, and kebab-case is
 * this repo's dominant convention. `*-copy.ts` therefore matches any module
 * whose SUBJECT is user-facing copy. It fired on PR #835's
 * `structural-edit-decline-copy.ts` and hard-failed the job; the PR renamed the
 * module (63bdd0f4) to route around a guard that was simply wrong about it.
 * `*_copy.*` carries the identical defect for snake_case.
 *
 * ── THE MECHANISM (ROADMAP 2.660) ───────────────────────────────────────────
 * A shadow copy has a DERIVABLE property, so stop guessing from names alone:
 *
 *   its basename minus a duplication suffix names an EXISTING TRACKED SIBLING
 *   in the SAME DIRECTORY.
 *
 * That property is what makes a broad suffix list safe. It is applied per
 * family, because the two families carry different false-positive risk:
 *
 *   FINDER family — a SPACE then `2`/`copy`/`copy 2` before the extension
 *     (`x 2.ts`, `x copy.ts`, `x copy 2.ts`, `.gitignore 2`).
 *     → ALWAYS a finding, sibling or not.
 *     A space is not part of any legitimate source-file naming convention here,
 *     and the measurement backs that: of 119 distinct paths that have EVER had a
 *     space in the basename, 115 carried a Finder duplication suffix (all
 *     artefacts, all deleted) and the 4 that did not carry no such suffix
 *     (`use SseStream.tsx`, `CEE improvements.md`, `Olumi UI Integration
 *     Contract v1.md`, `.gitignore 2`'s stem). So there is no FP class to
 *     narrow, and failing orphans keeps EXACTLY the strength the old guard had
 *     (see ORPHAN DECISION below).
 *
 *   DELIMITED family — `-copy` or `_copy` before the extension.
 *     → a finding ONLY when the stripped name is tracked beside it.
 *     Here the "delimiter" is ordinary kebab/snake word separation, so the name
 *     alone proves nothing. `structural-edit-decline-copy.ts` with no
 *     `structural-edit-decline.ts` beside it is a module about decline COPY;
 *     `y-copy.ts` next to `y.ts` is a shadow of `y.ts`.
 *
 * ── ORPHAN DECISION (asked for explicitly; stated with its trade-off) ────────
 * An orphaned duplicate-suffix file — `foo 2.ts` whose `foo.ts` was later
 * deleted — is the one case the sibling property alone would miss.
 *   · FINDER orphans FAIL. Rationale: this is precisely what the old guard did,
 *     and narrowing it would be a weakening shipped under the banner of a fix.
 *     Cost of a false positive here is ~zero (measured above).
 *   · DELIMITED orphans PASS SILENTLY — not even a warning. Rationale, measured
 *     at this tip: a warning tier would fire on TWO legitimate tracked files
 *     today (`gm-held-consent-copy.test.ts`,
 *     `edit-graph-f3-applied-turn-copy.test.ts`, both orphans, both legitimate).
 *     A guard that fires on legitimate names on every run is a guard people
 *     learn to ignore, and then disable — the broken-alarm failure mode this
 *     estate has paid for repeatedly.
 *   · ACCEPTED RESIDUAL RISK, stated plainly: copy `foo.ts` to `foo-copy.ts`,
 *     then delete `foo.ts`, and this guard says nothing. That is a deliberate
 *     trade against the alarm-fatigue cost above, and it is narrower than the
 *     hole the old guard left, which missed EVERY non-.ts/.js artefact — the
 *     ` 2.md`/` 2.json`/` 2.yml` files that made up most of both real cleanups.
 *
 * ── WHAT ELSE CHANGED, AND WHAT DELIBERATELY DID NOT ────────────────────────
 * STRONGER than the old guard, on measured grounds:
 *   · every tracked file, not only `.ts`/`.js` — the historical artefacts were
 *     mostly neither, and an extension allowlist is a hand-maintained mirror;
 *   · extensionless names (`.gitignore 2` really happened);
 *   · ` copy 2` and `<name> <any N>`, not just ` 2`;
 *   · the sibling must be in the SAME directory (`a/foo.ts` does not convict
 *     `b/foo-copy.ts`).
 * NOT added, deliberately: `-2`/`_2` (`foo-2.ts`). Numbered series are ordinary
 * naming (`canonical-1.md`…`canonical-5.md`, `Adobe-Japan1-6.bcmap`), the old
 * guard never matched them, and no such artefact has ever occurred here. The
 * sibling requirement would not make them safe enough to be worth the noise.
 *
 * Exit codes: 0 = clean · 1 = shadow copies found · 2 = self-test or harness
 * failure (including "read zero tracked files", which must never pass quietly).
 *
 * Run:  node scripts/ci/assert-no-shadow-copies.mjs
 *       node scripts/ci/assert-no-shadow-copies.mjs --self-test
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from THIS FILE, never the caller's cwd. A checker that silently reads
// the wrong tree — or reads nothing and reports success — is the failure mode it
// exists to catch.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The historical guard, frozen verbatim as it stood at ea886bef..d2cdd99b.
 * Kept ONLY so the tests can prove the narrowing with an old-vs-new pair: the
 * #835 false positive must fire on this list and pass on the new mechanism,
 * and every genuine shadow pair must fire on BOTH. Nothing in the live scan
 * path reads it.
 */
export const LEGACY_GUARD_GLOBS = Object.freeze([
  '* 2.ts',
  '* 2.js',
  '* copy.ts',
  '* copy.js',
  '*_copy.ts',
  '*_copy.js',
  '*-copy.ts',
  '*-copy.js',
]);

/**
 * FINDER family: a SPACE, then `<N>` or `copy` or `copy <N>`, then an optional
 * extension. The extension may itself contain dots (`cache.test 2.ts`) but never
 * a space, so it can never swallow a second space-bearing segment.
 */
const FINDER_RE = /^(.+?)( \d+| [Cc]opy(?: \d+)?)(\.[^/ ]*)?$/;

/** DELIMITED family: `-copy` or `_copy`, then an optional extension. */
const DELIMITED_RE = /^(.+?)([-_][Cc]opy)(\.[^/ ]*)?$/;

/** @typedef {'finder'|'delimited'} ShadowFamily */

/**
 * Classify a BASENAME. Returns null when it carries no duplication suffix.
 * @param {string} basename
 * @returns {{family: ShadowFamily, suffix: string, original: string} | null}
 */
export function classifyBasename(basename) {
  const finder = FINDER_RE.exec(basename);
  if (finder) {
    return { family: 'finder', suffix: finder[2], original: finder[1] + (finder[3] ?? '') };
  }
  const delimited = DELIMITED_RE.exec(basename);
  if (delimited) {
    return {
      family: 'delimited',
      suffix: delimited[2],
      original: delimited[1] + (delimited[3] ?? ''),
    };
  }
  return null;
}

/** Split a POSIX repo path into [dir, basename]. Never uses path.dirname: git
 * always emits '/' and we must not depend on the host separator. */
function splitPath(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? ['', p] : [p.slice(0, i), p.slice(i + 1)];
}

/**
 * The whole rule, as a pure function over a tracked-path list, so the controls
 * can drive it with synthetic input and the CI scan can drive it with
 * `git ls-files -z`.
 *
 * @param {readonly string[]} trackedPaths repo-relative POSIX paths
 * @returns {{path: string, family: ShadowFamily, suffix: string, original: string, siblingTracked: boolean}[]}
 */
export function findShadowCopies(trackedPaths) {
  /** @type {Map<string, Set<string>>} dir -> basenames */
  const byDir = new Map();
  for (const p of trackedPaths) {
    const [dir, base] = splitPath(p);
    let names = byDir.get(dir);
    if (names === undefined) {
      names = new Set();
      byDir.set(dir, names);
    }
    names.add(base);
  }

  const findings = [];
  for (const p of trackedPaths) {
    const [dir, base] = splitPath(p);
    const hit = classifyBasename(base);
    if (hit === null) continue;
    const siblingTracked = byDir.get(dir)?.has(hit.original) ?? false;
    // FINDER: a space is never legitimate here, so the name alone convicts.
    // DELIMITED: the name proves nothing; only a tracked sibling does.
    if (hit.family === 'finder' || siblingTracked) {
      findings.push({ path: p, family: hit.family, suffix: hit.suffix, original: hit.original, siblingTracked });
    }
  }
  return findings;
}

// ── live scan ───────────────────────────────────────────────────────────────

/**
 * NUL-safe tracked-file list. `-z` is not optional: this repo carries source
 * files with embedded NUL sentinels (trap 17), and newline-delimited output
 * from a path list is a footgun regardless.
 * @param {string} cwd
 * @returns {string[]}
 */
export function listTrackedFiles(cwd) {
  const raw = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw.split('\0').filter((s) => s.length > 0);
}

function runScan() {
  let tracked;
  try {
    tracked = listTrackedFiles(REPO_ROOT);
  } catch (err) {
    console.error(`::error::assert-no-shadow-copies: could not list tracked files: ${err?.message ?? err}`);
    process.exit(2);
  }

  // Fail loud rather than pass by finding nothing. A guard that reads an empty
  // tree and reports success is the guarantee-theatre this repo hunts.
  if (tracked.length === 0) {
    console.error('::error::assert-no-shadow-copies: git ls-files returned ZERO tracked files — the scan was blinded, not clean.');
    process.exit(2);
  }

  const findings = findShadowCopies(tracked);
  if (findings.length === 0) {
    console.log(`assert-no-shadow-copies: OK — ${tracked.length} tracked files, no shadow copies.`);
    process.exit(0);
  }

  console.error('::error::Shadow copies detected (duplicate files drift silently from their originals):');
  for (const f of findings) {
    const why =
      f.family === 'finder'
        ? `duplication suffix "${f.suffix}" (a space in a filename is a copy artefact, never a naming convention)` +
          (f.siblingTracked ? ` — and "${f.original}" is tracked beside it` : ' — no original beside it, so this is a stranded artefact')
        : `duplication suffix "${f.suffix}" AND its original "${f.original}" is tracked in the same directory`;
    console.error(`  ${f.path}\n      ${why}`);
  }
  console.error('');
  console.error('Fix: delete the copy, or fold its changes into the original and delete it.');
  console.error('If this file is NOT a copy, note that a `-copy`/`_copy` name only fails when the');
  console.error('same directory also tracks the name without that suffix — rename one of the two.');
  process.exit(1);
}

// ── controls (positive AND negative), on synthetic fixtures only ────────────

/**
 * Build a throwaway git repo in the OS temp dir — never inside this repo, so
 * nothing here can be collected by a test runner or leak into the tree — and
 * return both guards' verdicts on it.
 *
 * `legacy` runs the REAL historical shell logic (git pathspec globs), not a
 * re-implementation, so the old-vs-new pair compares against what actually
 * shipped.
 *
 * @param {readonly string[]} files repo-relative paths to create and `git add`
 * @returns {{legacy: string[], next: string[], cleanup: () => void}}
 */
export function evaluateFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-copy-fixture-'));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'pipe' });
    for (const f of files) {
      const [sub] = splitPath(f);
      if (sub !== '') mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, f), '// fixture\n');
    }
    // `-f`: a fixture may deliberately use a name a global gitignore would skip.
    execFileSync('git', ['add', '-f', '-A'], { cwd: dir, stdio: 'pipe' });

    const legacy = [];
    for (const glob of LEGACY_GUARD_GLOBS) {
      const out = execFileSync('git', ['ls-files', '-z', '--', glob], { cwd: dir, encoding: 'utf8' });
      for (const p of out.split('\0')) if (p.length > 0 && !legacy.includes(p)) legacy.push(p);
    }
    const next = findShadowCopies(listTrackedFiles(dir)).map((f) => f.path);
    return { legacy: legacy.sort(), next: next.sort(), cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

function runSelfTest() {
  const failures = [];
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      process.stdout.write(`  OK   ${name}\n`);
    } else {
      process.stdout.write(`  FAIL ${name}: expected ${e}, got ${a}\n`);
      failures.push(name);
    }
  };

  // ---- the proof pair: the same fixture through both guards -----------------
  const fixtures = [
    {
      name: 'historical FALSE POSITIVE (#835): a legit -copy module with no sibling',
      files: ['src/handlers/structural-edit-decline-copy.ts'],
      // The defect, reproduced: the old guard convicted it.
      legacy: ['src/handlers/structural-edit-decline-copy.ts'],
      next: [],
    },
    {
      name: 'real shadow pair, Finder space-copy: x.ts + "x copy.ts"',
      files: ['src/x.ts', 'src/x copy.ts'],
      legacy: ['src/x copy.ts'],
      next: ['src/x copy.ts'],
    },
    {
      name: 'real shadow pair, kebab: y.ts + y-copy.ts',
      files: ['src/y.ts', 'src/y-copy.ts'],
      legacy: ['src/y-copy.ts'],
      next: ['src/y-copy.ts'],
    },
    {
      name: 'real shadow pair, snake: w.ts + w_copy.ts',
      files: ['src/w.ts', 'src/w_copy.ts'],
      legacy: ['src/w_copy.ts'],
      next: ['src/w_copy.ts'],
    },
    {
      name: 'real shadow pair, the shape that actually happened: z.ts + "z 2.ts"',
      files: ['src/z.ts', 'src/z 2.ts'],
      legacy: ['src/z 2.ts'],
      next: ['src/z 2.ts'],
    },
    {
      name: 'ORPHAN, Finder: "stranded 2.ts" with no original — still fails (no weakening)',
      files: ['src/stranded 2.ts'],
      legacy: ['src/stranded 2.ts'],
      next: ['src/stranded 2.ts'],
    },
    {
      name: 'ORPHAN, delimited: lonely-copy.ts with no original — passes (documented trade)',
      files: ['src/lonely-copy.ts'],
      legacy: ['src/lonely-copy.ts'],
      next: [],
    },
    {
      name: 'sibling must be in the SAME directory',
      files: ['src/a/foo.ts', 'src/b/foo-copy.ts'],
      legacy: ['src/b/foo-copy.ts'],
      next: [],
    },
    {
      name: 'STRENGTHENING: a .md artefact the old extension list could not see',
      files: ['Docs/a.md', 'Docs/a 2.md'],
      legacy: [],
      next: ['Docs/a 2.md'],
    },
    {
      name: 'STRENGTHENING: an extensionless artefact (".gitignore 2" really happened)',
      files: ['.gitignore', '.gitignore 2'],
      legacy: [],
      next: ['.gitignore 2'],
    },
    {
      name: 'STRENGTHENING: the "copy 2" chain',
      files: ['src/q.ts', 'src/q copy 2.ts'],
      legacy: ['src/q copy 2.ts'],
      next: ['src/q copy 2.ts'],
    },
    {
      name: 'legitimate names stay legitimate',
      files: [
        'src/deepcopy.ts',
        'src/copy.ts',
        'src/copy-quality-gate.ts',
        'Docs/canonical-1.md',
        'Docs/canonical-2.md',
        'src/use SseStream.tsx',
        'src/gm-held-consent-copy.test.ts',
      ],
      legacy: [],
      next: [],
    },
  ];

  for (const f of fixtures) {
    const { legacy, next, cleanup } = evaluateFixture(f.files);
    try {
      check(`[legacy] ${f.name}`, legacy, [...f.legacy].sort());
      check(`[new]    ${f.name}`, next, [...f.next].sort());
    } finally {
      cleanup();
    }
  }

  // ---- the scan cannot pass by finding nothing ------------------------------
  check('empty tracked list yields no findings (and the CLI treats it as a HARD ERROR, not a pass)', findShadowCopies([]), []);

  if (failures.length > 0) {
    process.stdout.write(`SELF-TEST FAILED: ${failures.length} check(s)\n`);
    process.exit(2);
  }
  process.stdout.write('SELF-TEST PASSED: real shadow copies fire on both guards; the #835 name fires only on the old one.\n');
  process.exit(0);
}

// ── entrypoint ──────────────────────────────────────────────────────────────

const invoked = process.argv[1];
const isMain = typeof invoked === 'string' && import.meta.url.endsWith(invoked.split('/').pop());
if (isMain) {
  const mode = process.argv[2];
  if (mode === '--self-test') {
    runSelfTest();
  } else if (mode === undefined) {
    runScan();
  } else {
    process.stderr.write(`assert-no-shadow-copies: unknown mode ${JSON.stringify(mode)} (no args = scan, or --self-test)\n`);
    process.exit(2);
  }
}
