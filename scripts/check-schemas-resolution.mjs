#!/usr/bin/env node
/**
 * Assert that the `@talchain/schemas` this repo ACTUALLY BINDS is the version it
 * pins — and that it binds from THIS project, not from a parent directory.
 *
 * Why this exists
 * ---------------
 * Schema-version skew is the platform's dominant risk: a consumer on an older
 * @talchain/schemas silently DROPS wire fields it does not know about. Worse, a
 * bare `git worktree` has no node_modules of its own, so Node's resolution
 * algorithm walks UP the directory tree and silently binds whatever version sits
 * in a parent (historically 0.8.1 at the GitHub/ checkout root). Typechecks taken
 * that way are green against a DIFFERENT codebase than the one being shipped — a
 * baseline that measures nothing.
 *
 * This check turns that silent mis-measurement into a LOUD, blocking failure. It
 * is wired as a `pretypecheck` prerequisite, so a mismatch fails the gate; it
 * never merely warns, and it has no env escape hatch (an escape hatch is how
 * gates rot into theatre). It FAILS CLOSED: an unrecognised pin form is an error,
 * never a silent pass.
 *
 * Why it walks node_modules by hand rather than calling Node's resolver
 * --------------------------------------------------------------------
 * The package's `exports` map declares only "import"/"types" conditions (no
 * "require"), so `createRequire(...).resolve('@talchain/schemas')` throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED / "No exports main defined"; and `exports` does
 * not expose "./package.json" either, so the manifest cannot be required. The
 * node_modules walk-up below replicates Node's own lookup for bare specifiers,
 * is independent of exports maps and conditions, and models the exact trap this
 * check exists to catch: WHICH directory wins the lookup.
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = '@talchain/schemas';
const projectRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

/** Print a blocking error and exit non-zero. */
function fail(headline, detail) {
  console.error(`\n✖ schemas-resolution check FAILED: ${headline}\n`);
  if (detail) console.error(`${detail}\n`);
  process.exit(1);
}

/**
 * Derive the exact version this repo intends, from the package.json pin.
 * Supported (the only forms that occur here):
 *   - vendored tarball: "file:./vendor/talchain-schemas-0.16.0.tgz" -> "0.16.0"
 *   - exact semver:     "0.16.0"                                    -> "0.16.0"
 * Anything else (^, ~, ranges, tags, git/url specs) cannot be checked for exact
 * identity, so we FAIL CLOSED rather than pretend to have verified it.
 */
function expectedVersionFromPin(pin) {
  if (pin.startsWith('file:')) {
    const m = pin.match(/-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/);
    if (!m) {
      fail(
        `cannot derive a version from the vendored tarball pin: "${pin}"`,
        'Expected a filename ending "-<major>.<minor>.<patch>.tgz".\n' +
          'Fix the pin, or extend expectedVersionFromPin() in scripts/check-schemas-resolution.mjs.',
      );
    }
    return m[1];
  }
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin)) return pin;
  fail(
    `pin "${pin}" is not an exact version this check can verify`,
    `${PKG} must be pinned to an exact version (vendored tarball or bare semver) so the\n` +
      'bound package can be asserted identical to the intended one. Ranges (^, ~, tags) permit\n' +
      'silent drift and are rejected on purpose.',
  );
}

// ---------------------------------------------------------------------------
// 1. Read the intended pin.
// ---------------------------------------------------------------------------
const manifestPath = join(projectRoot, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pin =
  manifest.dependencies?.[PKG] ??
  manifest.devDependencies?.[PKG] ??
  manifest.optionalDependencies?.[PKG];

if (!pin) fail(`${PKG} is not present in ${manifestPath}`);

const expected = expectedVersionFromPin(pin);

// ---------------------------------------------------------------------------
// 2. Replicate Node's bare-specifier lookup: first node_modules/<PKG> found
//    walking UP from the project root is the one that wins.
// ---------------------------------------------------------------------------
let boundManifest = null;
let dir = projectRoot;
while (true) {
  const candidate = join(dir, 'node_modules', PKG, 'package.json');
  if (existsSync(candidate)) {
    boundManifest = candidate;
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

if (!boundManifest) {
  fail(
    `${PKG} is not installed anywhere Node would find it from ${projectRoot}`,
    'A bare git worktree has no node_modules — run `pnpm install --frozen-lockfile`\n' +
      '(or scripts/bootstrap-worktree.sh) in THIS directory before taking any typecheck baseline.',
  );
}

let actual;
try {
  actual = JSON.parse(readFileSync(boundManifest, 'utf8')).version;
} catch (err) {
  fail(`could not read the bound ${PKG} manifest at ${boundManifest}`, err.message);
}

// ---------------------------------------------------------------------------
// 3. Assert containment — the worktree trap.
//    Checked on the LOOKUP path (not its realpath): the question is which
//    directory won Node's walk-up. Using the realpath here would false-fail a
//    legitimate external/global package store.
// ---------------------------------------------------------------------------
if (!boundManifest.startsWith(projectRoot + sep)) {
  fail(
    `${PKG} resolved OUTSIDE this project — a parent directory's copy is being measured`,
    `  project root : ${projectRoot}\n` +
      `  bound from   : ${boundManifest}\n` +
      `  its version  : ${actual}   (this repo pins ${expected})\n\n` +
      'This is the worktree trap: with no local node_modules, Node walks UP the tree and binds a\n' +
      "parent's @talchain/schemas. Every typecheck taken this way measured a DIFFERENT codebase.\n" +
      'Run `pnpm install --frozen-lockfile` (or scripts/bootstrap-worktree.sh) inside this directory.',
  );
}

// ---------------------------------------------------------------------------
// 4. Assert version identity — the skew trap.
// ---------------------------------------------------------------------------
if (actual !== expected) {
  fail(
    `${PKG} version mismatch — bound ${actual}, but package.json pins ${expected}`,
    `  pin        : ${pin}\n` +
      `  expected   : ${expected}\n` +
      `  actually   : ${actual}\n` +
      `  bound from : ${boundManifest}\n\n` +
      'A stale install silently drops wire fields the newer schema defines, so any result measured\n' +
      'against it is untrustworthy. Run `pnpm install --frozen-lockfile`.',
  );
}

console.log(`✔ ${PKG}@${actual} bound from this project (pin: ${pin})`);
