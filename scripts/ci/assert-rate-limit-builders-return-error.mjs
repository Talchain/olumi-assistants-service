#!/usr/bin/env node
/**
 * Assert that every `@fastify/rate-limit` `errorResponseBuilder` under `src/`
 * RETURNS an `Error`.
 *
 * WHY THIS EXISTS — the failure mode reads as GREEN, and the type system
 * cannot see it.
 *
 * `@fastify/rate-limit` THROWS whatever the builder RETURNS:
 *
 *     index.js:333    throw params.errorResponseBuilder(req, respCtx)
 *     index.js:31-35  // its own default builder returns an Error
 *
 * If a builder returns a PLAIN OBJECT, that object is thrown. This app installs
 * a custom `setErrorHandler`, so `toErrorV1` receives a non-`Error`, falls
 * through to its unknown-type branch, and answers **500 INTERNAL** — while the
 * limiter's own `x-ratelimit-*` and `retry-after` headers still say 429. That
 * shipped to staging on all nine builders and survived months of green CI
 * (ROADMAP 2.181). Adding `statusCode: 429` to the plain object does NOT fix it
 * here: that field is honoured only by Fastify's DEFAULT error handler.
 *
 * Nothing else catches it:
 *   - The plugin declares `errorResponseBuilder?: (req, context) => object`
 *     (`types/index.d.ts:143-146`). `object` accepts every plain object, so a
 *     raw pre-fix builder TYPECHECKS CLEAN (proven: `tsc -p tsconfig.build.json
 *     --noEmit` exit 0 on exactly that mutant).
 *   - `pnpm lint` reddens on a REVERT of an existing site only incidentally, via
 *     the then-unused `RateLimitedError` import. Delete the import too, or write
 *     a brand-new tenth builder, and every gate is green.
 *
 * So the nine correct call sites would otherwise be a nine-way hand-maintained
 * mirror with no drift alarm — CLAUDE.md's dominant defect class. This script is
 * the alarm.
 *
 * IT DERIVES ITS SITES; it never hand-lists them. A new tenth builder is
 * checked automatically the moment it is written.
 *
 * NON-VACUITY (CLAUDE.md trap 13): an absence check must first prove it can see
 * a presence. Blinding this scanner — pointing it at the wrong tree, or the
 * option being renamed upstream — must HARD-FAIL, never pass as `[] === []`.
 * It therefore fails if it finds zero TypeScript files, zero importers of
 * `@fastify/rate-limit`, zero `register(rateLimit, …)` sites, or zero builders.
 *
 * Run: node scripts/ci/assert-rate-limit-builders-return-error.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

// Resolve from THIS FILE's location, never the caller's cwd. A checker that
// silently reads the wrong tree and reports success is the failure mode it
// exists to catch (CLAUDE.md trap 15).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_SRC = join(REPO_ROOT, 'src');

const PLUGIN = '@fastify/rate-limit';
const BUILDER_PROP = 'errorResponseBuilder';

/** Recursively collect .ts/.mts/.cts files (excluding .d.ts) under a root. */
function collectTsFiles(root) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out; // missing root → caller's non-vacuity check turns this into a hard fail
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'generated') {
        continue;
      }
      out.push(...collectTsFiles(full));
    } else if (/\.(m|c)?ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** `new FooError(...)` / `new x.y.FooError(...)` → true. Anything else → false. */
function isNewErrorExpression(node) {
  if (!ts.isNewExpression(node)) return false;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : null;
  return name !== null && /Error$/.test(name);
}

/**
 * Collect the expressions a function returns, NOT descending into nested
 * function bodies (a `return` inside a callback is not this function's return).
 */
function collectReturnedExpressions(fn) {
  if (!fn.body) return { returns: [], bare: false };
  if (!ts.isBlock(fn.body)) return { returns: [fn.body], bare: false }; // concise arrow body

  const returns = [];
  let bare = false;
  const walk = (node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isClassDeclaration(node)
    ) {
      return; // a different function's returns
    }
    if (ts.isReturnStatement(node)) {
      if (node.expression) returns.push(node.expression);
      else bare = true; // `return;` → returns undefined → the plugin throws undefined
      return;
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(fn.body, walk);
  return { returns, bare };
}

/**
 * Derive every rate-limit fact this guard needs from the source tree.
 * Exported so the required-gate meta test can assert on it directly.
 */
export function scanRateLimitErrorBuilders(srcRoot = DEFAULT_SRC) {
  const files = collectTsFiles(srcRoot);
  const pluginFiles = [];
  const registrationSites = [];
  const builderSites = [];

  for (const file of files) {
    // Read as utf8: several CEE sources carry deliberate NUL sentinels, which
    // make `file(1)` call them binary and plain `grep` skip them (trap 17).
    // Reading + parsing the bytes is immune to that classification.
    const text = readFileSync(file, 'utf8');
    if (!text.includes(PLUGIN) && !text.includes(BUILDER_PROP)) continue;

    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const rel = relative(REPO_ROOT, file);
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    if (text.includes(PLUGIN)) pluginFiles.push(rel);

    const visit = (node) => {
      // `register(rateLimit, { … })` / `app.register(rateLimit, …)`
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const calleeName = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null;
        if (calleeName === 'register') {
          const first = node.arguments[0];
          if (first && ts.isIdentifier(first) && /rateLimit/i.test(first.text)) {
            registrationSites.push({ file: rel, line: lineOf(node) });
          }
        }
      }

      // `errorResponseBuilder: <value>`
      if (ts.isPropertyAssignment(node)) {
        const key = node.name;
        const keyText = ts.isIdentifier(key)
          ? key.text
          : ts.isStringLiteral(key)
            ? key.text
            : null;
        if (keyText === BUILDER_PROP) {
          const site = { file: rel, line: lineOf(node), ok: false, reason: '' };
          const value = node.initializer;

          if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) {
            site.reason =
              `${BUILDER_PROP} must be an inline function whose returns this guard can ` +
              `verify; got \`${ts.SyntaxKind[value.kind]}\`. If you are introducing a shared ` +
              `builder factory, teach this guard about it explicitly — do not weaken the check.`;
          } else {
            const { returns, bare } = collectReturnedExpressions(value);
            if (returns.length === 0) {
              site.reason = `${BUILDER_PROP} returns nothing — @fastify/rate-limit would throw \`undefined\`.`;
            } else if (bare) {
              site.reason = `${BUILDER_PROP} has a bare \`return;\` path — @fastify/rate-limit would throw \`undefined\`.`;
            } else {
              const bad = returns.filter((r) => !isNewErrorExpression(r));
              if (bad.length > 0) {
                site.reason =
                  `${BUILDER_PROP} returns a non-Error (e.g. \`${ts.SyntaxKind[bad[0].kind]}\` at line ` +
                  `${sf.getLineAndCharacterOfPosition(bad[0].getStart(sf)).line + 1}\`). ` +
                  `@fastify/rate-limit THROWS this value; a plain object reaches the custom ` +
                  `setErrorHandler as an unknown type and is answered 500 INTERNAL. ` +
                  `Return \`new RateLimitedError(retryAfterSecondsFromRateLimitContext(context), …)\`.`;
              } else {
                site.ok = true;
              }
            }
          }
          builderSites.push(site);
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return {
    srcRoot,
    tsFileCount: files.length,
    pluginFiles: [...new Set(pluginFiles)].sort(),
    registrationSites,
    builderSites,
    violations: builderSites.filter((s) => !s.ok),
  };
}

/** Non-vacuity + conformance. Returns a list of human-readable failures. */
export function checkRateLimitErrorBuilders(srcRoot = DEFAULT_SRC) {
  const scan = scanRateLimitErrorBuilders(srcRoot);
  const errors = [];

  // --- Non-vacuity: this check must be able to SEE a presence (trap 13). ---
  if (scan.tsFileCount === 0) {
    errors.push(
      `SCANNER BLINDED: no TypeScript files found under ${scan.srcRoot}. ` +
        `This check cannot pass by finding nothing.`,
    );
  }
  if (scan.pluginFiles.length === 0) {
    errors.push(
      `SCANNER BLINDED: no file under ${scan.srcRoot} imports "${PLUGIN}". ` +
        `Either the tree is wrong or the dependency was removed — do not let this pass silently.`,
    );
  }
  if (scan.registrationSites.length === 0) {
    errors.push(
      `SCANNER BLINDED: no \`register(rateLimit, …)\` site found under ${scan.srcRoot}.`,
    );
  }
  if (scan.builderSites.length === 0) {
    errors.push(
      `SCANNER BLINDED: no \`${BUILDER_PROP}\` found under ${scan.srcRoot}. ` +
        `If the plugin renamed this option, this guard is no longer guarding anything.`,
    );
  }

  // --- Conformance. ---
  for (const v of scan.violations) {
    errors.push(`${v.file}:${v.line} — ${v.reason}`);
  }

  return { scan, errors };
}

// CLI entry (skipped when imported by the meta test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { scan, errors } = checkRateLimitErrorBuilders();
  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::${e}`);
    console.error(`\nrate-limit errorResponseBuilder check FAILED (${errors.length} problem(s)).`);
    process.exit(1);
  }
  console.log(
    `OK: ${scan.builderSites.length} errorResponseBuilder site(s) across ` +
      `${scan.pluginFiles.length} file(s) importing ${PLUGIN} ` +
      `(${scan.registrationSites.length} registration site(s), ${scan.tsFileCount} .ts files scanned) — ` +
      `every one returns an Error.`,
  );
}
