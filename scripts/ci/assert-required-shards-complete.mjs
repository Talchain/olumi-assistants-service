#!/usr/bin/env node
/**
 * Assert that the SHARDED required test run executed EVERY required test file,
 * each exactly once, and that every shard passed.
 *
 * WHY THIS EXISTS. `pnpm test:required` used to run on ONE runner for ~21 min —
 * the single largest, steadiest cost between review-ready code and a green
 * required check (measured: `Lint, TypeCheck, Unit Tests` p50 23.0 min, n=441,
 * 48h to 24 Sep 2026). ci.yml now splits it across `required-tests` matrix
 * shards (`vitest --shard=i/N`). A split gate has a failure mode the single
 * runner did not: tests can silently NOT RUN — a shard that never started, a
 * shard whose report was lost, a matrix narrowed to [1,2] while the flag still
 * says /3, a shard index typo. Every one of those leaves each surviving shard
 * GREEN. So "all shard jobs succeeded" is necessary and NOT sufficient; this
 * script is the sufficient half. It runs in the `Lint, TypeCheck, Unit Tests`
 * job — the single required context — after that job has asserted every
 * `needs` result is `success`.
 *
 * DERIVED, NOT LISTED. The expected population is `vitest list --filesOnly`
 * under vitest.required.config.ts, produced in the same workflow run from the
 * same checkout — the config's own include/exclude, never a copy of it. The
 * observed population is each shard's vitest JSON report. Neither side is a
 * hand-maintained list, so neither can go stale.
 *
 * IT FAILS IN EVERY DIRECTION, and closed on its own blindness:
 *   · expected population empty                  → BLINDED (never a vacuous pass)
 *   · a shard report missing, unparseable, empty → RED
 *   · a report extra to 1..N (e.g. shard-4 of 3) → RED
 *   · a shard not successful / any failed file   → RED
 *   · a file in two shards                       → RED (population double-counted)
 *   · an expected file in no shard               → RED (a test did not run)
 *   · a reported file not expected               → RED (population drifted)
 *
 * WHAT IT CANNOT SEE: whether a test that RAN asserted anything useful, and
 * whether a file skipped itself (`describe.skipIf`) for a reason that differs
 * from the unsharded run — e.g. the compiled-boot test skips without `dist`,
 * which is why every shard runs `pnpm build` first. The per-shard and total
 * skipped counts are printed so that drift is visible against an unsharded run.
 *
 * Node builtins only; the aggregating job runs it with bare `node`, no install.
 *
 *   node scripts/ci/assert-required-shards-complete.mjs \
 *     --expected .vitest-reports/expected.json --dir .vitest-reports --shards 3
 *
 * Exit 0 = complete and green; 1 = incomplete or red; 2 = bad invocation.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const REPORT_RE = /^shard-(\d+)\.json$/;
const LIST_LIMIT = 20;

/** Repo-relative POSIX path, or null when the file lies outside `root`. */
export function toRepoPath(file, root) {
  const abs = isAbsolute(file) ? file : resolve(root, file);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

/**
 * The expected population from `vitest list --filesOnly --json=<file>`, which
 * writes `[{ "file": "<absolute path>" }, ...]`.
 */
export function parseExpectedList(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('expected list is not a JSON array');
  return parsed.map((entry, i) => {
    const file = typeof entry === 'string' ? entry : entry?.file;
    if (typeof file !== 'string' || file === '') throw new Error(`expected list entry ${i} has no "file"`);
    return file;
  });
}

function sample(items) {
  const shown = items.slice(0, LIST_LIMIT).map((p) => `    ${p}`).join('\n');
  return items.length > LIST_LIMIT ? `${shown}\n    … and ${items.length - LIST_LIMIT} more` : shown;
}

/**
 * The whole rule, as a pure function.
 *
 * @param {object} input
 * @param {string[]} input.expectedFiles  absolute or root-relative paths
 * @param {Map<number, unknown>} input.reports  shard index → parsed vitest JSON
 *        report, or an Error when the file existed but could not be parsed
 * @param {number} input.shardTotal  N, the matrix size
 * @param {string} input.root  directory every path must lie inside
 */
export function verifyShardReports({ expectedFiles, reports, shardTotal, root }) {
  const errors = [];
  const shards = [];
  const totals = { files: 0, tests: 0, passed: 0, failed: 0, pending: 0, todo: 0 };

  if (!Number.isInteger(shardTotal) || shardTotal < 1) {
    errors.push(`shard total must be a positive integer, got ${JSON.stringify(shardTotal)}`);
    return { errors, shards, totals };
  }

  const expected = new Set();
  const outsideExpected = [];
  for (const file of expectedFiles) {
    const p = toRepoPath(file, root);
    if (p === null) outsideExpected.push(file);
    else expected.add(p);
  }
  if (outsideExpected.length > 0) {
    errors.push(`expected list names ${outsideExpected.length} file(s) outside ${root}:\n${sample(outsideExpected)}`);
  }
  if (expected.size === 0) {
    errors.push(
      'BLINDED: the expected required-test population is EMPTY. `vitest list --filesOnly` found no files, ' +
        'so completeness cannot be proven — refusing to report a vacuous pass.',
    );
  }

  for (const index of reports.keys()) {
    if (!Number.isInteger(index) || index < 1 || index > shardTotal) {
      errors.push(`unexpected report for shard ${index}: the matrix is 1..${shardTotal}`);
    }
  }

  const seenIn = new Map();
  for (let k = 1; k <= shardTotal; k++) {
    const report = reports.get(k);
    if (report === undefined) {
      errors.push(`shard ${k}/${shardTotal}: NO REPORT — that shard's tests cannot be shown to have run`);
      continue;
    }
    if (report instanceof Error) {
      errors.push(`shard ${k}/${shardTotal}: report unreadable — ${report.message}`);
      continue;
    }
    const results = Array.isArray(report?.testResults) ? report.testResults : null;
    if (results === null || results.length === 0) {
      errors.push(`shard ${k}/${shardTotal}: BLINDED — the report lists zero test files`);
      continue;
    }

    const failedFiles = [];
    const outside = [];
    for (const r of results) {
      const p = typeof r?.name === 'string' ? toRepoPath(r.name, root) : null;
      if (p === null) {
        outside.push(String(r?.name));
        continue;
      }
      if (r.status === 'failed') failedFiles.push(p);
      const where = seenIn.get(p) ?? [];
      where.push(k);
      seenIn.set(p, where);
    }
    if (outside.length > 0) {
      errors.push(`shard ${k}/${shardTotal}: ${outside.length} reported file(s) outside ${root}:\n${sample(outside)}`);
    }

    const num = (key) => (Number.isInteger(report[key]) ? report[key] : 0);
    const failedSuites = num('numFailedTestSuites');
    const failedTests = num('numFailedTests');
    if (report.success !== true || failedSuites > 0 || failedTests > 0 || failedFiles.length > 0) {
      errors.push(
        `shard ${k}/${shardTotal}: NOT GREEN (success=${JSON.stringify(report.success)}, ` +
          `failed files=${Math.max(failedSuites, failedFiles.length)}, failed tests=${failedTests})` +
          (failedFiles.length > 0 ? `\n${sample(failedFiles)}` : ''),
      );
    }

    const row = {
      shard: k,
      files: results.length,
      tests: num('numTotalTests'),
      passed: num('numPassedTests'),
      failed: failedTests,
      pending: num('numPendingTests'),
      todo: num('numTodoTests'),
    };
    shards.push(row);
    for (const key of Object.keys(totals)) totals[key] += row[key];
  }

  const duplicated = [...seenIn].filter(([, where]) => where.length > 1).map(([p, where]) => `${p} (shards ${where.join(', ')})`);
  if (duplicated.length > 0) {
    errors.push(`${duplicated.length} file(s) ran in MORE THAN ONE shard:\n${sample(duplicated)}`);
  }

  // Only meaningful once every shard reported: a missing shard already REDs
  // above, and listing its files again as "missing" would bury the cause.
  const allReported = shards.length === shardTotal;
  if (allReported && expected.size > 0) {
    const missing = [...expected].filter((p) => !seenIn.has(p)).sort();
    if (missing.length > 0) {
      errors.push(
        `${missing.length} of ${expected.size} required test file(s) ran in NO shard — ` +
          `the sharded gate did not execute them:\n${sample(missing)}`,
      );
    }
  }
  const unexpected = [...seenIn.keys()].filter((p) => !expected.has(p)).sort();
  if (expected.size > 0 && unexpected.length > 0) {
    errors.push(
      `${unexpected.length} reported file(s) are not in the expected population ` +
        `(vitest list and the shards disagree about the config):\n${sample(unexpected)}`,
    );
  }

  return { errors, shards, totals, expectedCount: expected.size, observedCount: seenIn.size };
}

/** Read `shard-<k>.json` reports from `dir`. A parse failure becomes an Error value. */
export function readShardReports(dir) {
  const reports = new Map();
  for (const name of readdirSync(dir)) {
    const m = name.match(REPORT_RE);
    if (!m) continue;
    const index = Number.parseInt(m[1], 10);
    try {
      reports.set(index, JSON.parse(readFileSync(join(dir, name), 'utf8')));
    } catch (err) {
      reports.set(index, new Error(`${name}: ${err.message}`));
    }
  }
  return reports;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!['--expected', '--dir', '--shards'].includes(flag) || argv[i + 1] === undefined) {
      throw new Error(`unknown or incomplete argument ${JSON.stringify(flag)}`);
    }
    args[flag.slice(2)] = argv[++i];
  }
  for (const key of ['expected', 'dir', 'shards']) {
    if (args[key] === undefined) throw new Error(`missing --${key}`);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(
      `assert-required-shards-complete: ${err.message}\n` +
        'usage: --expected <vitest list json> --dir <reports dir> --shards <N>\n',
    );
    process.exit(2);
  }

  const root = process.cwd();
  const errors = [];
  let expectedFiles = [];
  if (!existsSync(args.expected)) {
    errors.push(`expected list ${args.expected} does not exist — the population step did not publish it`);
  } else {
    try {
      expectedFiles = parseExpectedList(readFileSync(args.expected, 'utf8'));
    } catch (err) {
      errors.push(`expected list ${args.expected} is unreadable: ${err.message}`);
    }
  }
  const reports = existsSync(args.dir) ? readShardReports(args.dir) : new Map();

  const result = verifyShardReports({
    expectedFiles,
    reports,
    shardTotal: Number(args.shards),
    root,
  });
  errors.push(...result.errors);

  for (const s of result.shards) {
    console.log(
      `shard ${s.shard}/${args.shards}: ${s.files} files · ${s.tests} tests ` +
        `(${s.passed} passed, ${s.failed} failed, ${s.pending} skipped, ${s.todo} todo)`,
    );
  }
  const t = result.totals;
  console.log(
    `TOTAL: ${t.files} files · ${t.tests} tests (${t.passed} passed, ${t.failed} failed, ` +
      `${t.pending} skipped, ${t.todo} todo) · expected ${result.expectedCount ?? 0} files, ` +
      `observed ${result.observedCount ?? 0}`,
  );

  if (errors.length > 0) {
    for (const e of errors) console.log(`::error title=Required test shards incomplete::${e.split('\n')[0]}`);
    console.error(`\n✖ The sharded required test run is NOT complete and green:\n\n${errors.join('\n\n')}\n`);
    process.exit(1);
  }
  console.log(`✅ Every one of ${result.expectedCount} required test files ran in exactly one shard, and every shard passed.`);
  process.exit(0);
}

const invoked = process.argv[1];
const isMain = typeof invoked === 'string' && import.meta.url.endsWith(invoked.split('/').pop());
if (isMain) main();
