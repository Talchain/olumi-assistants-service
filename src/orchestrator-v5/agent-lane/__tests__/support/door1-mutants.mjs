#!/usr/bin/env node
/**
 * Door 1 mutation evidence, run only by the author once the load check succeeds.
 * All mutants live in an isolated /tmp copy. The shared working tree is never modified.
 * A green baseline is required; only a failed assertion in the named route row kills a mutant.
 */
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, lstatSync, readlinkSync,
  readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

let repo = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(repo, 'package.json'))) {
  const parent = dirname(repo);
  if (parent === repo) throw new Error('Cannot locate repository package.json.');
  repo = parent;
}
const testFile = 'src/orchestrator-v5/agent-lane/__tests__/agent-risk-likelihood-door1-seam.test.ts';
const sourceFile = 'src/orchestrator-v5/handlers/risk-likelihood-dispatch.ts';
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const load = spawnSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' });
if (load.status !== 0) {
  process.stderr.write(`BLOCKED: load check failed; no baseline or mutant ran. ${load.stderr.trim()}\n`);
  process.exit(2);
}
const oneMinute = Number(load.stdout.match(/[\d.]+/)?.[0]);
const maximum = Number(process.env.DOOR1_MAX_LOAD ?? availableParallelism());
if (!Number.isFinite(oneMinute) || !Number.isFinite(maximum) || oneMinute > maximum) {
  process.stderr.write(`BLOCKED: load ${load.stdout.trim()} exceeds limit ${maximum}; no baseline or mutant ran.\n`);
  process.exit(2);
}
const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8' });
if (files.status !== 0) throw new Error(`Cannot inventory working-tree files: ${files.stderr}`);
const originalHash = hash(join(repo, sourceFile));
const original = readFileSync(join(repo, sourceFile), 'utf8');
const temp = mkdtempSync('/tmp/olumi-door1-mutants-');
const evidence = { load: load.stdout.trim(), source_sha256: originalHash, baseline: null, mutants: [] };
const keepTemp = process.argv.includes('--keep-temp');
let success = false;

// Anchors are intentionally exact: source drift makes the driver stop, never silently run a different mutation.
const mutants = [
  { name: 'keep-probability-F5', row: 'door1-jw-j2-convert',
    before: "if (probability !== undefined) operations.push({ op: 'remove_node', path: probability.id });",
    after: '// MUTANT: retain the probability factor instead of removing it.'  },
  { name: 'keep-duplicate-R3', row: 'door1-jw-j2-merge',
    before: "for (const duplicate of duplicates) operations.push({ op: 'remove_node', path: duplicate.id });",
    after: '// MUTANT: retain the duplicate event risk instead of merging it.'  },
  { name: 'keep-F6-under-ii', row: 'door1-convert-run-ready', failureIncludes: 'ORPHAN_NODE',
    before: "    if (soleShareLink(share.id, risk.id, g)) operations.push({ op: 'remove_node', path: share.id });",
    after: '    // MUTANT: retain the sole share factor after its figure moves onto the impact link.',
    also: [{
      // Keep the declared operations consistent so this mutant reaches Apply and canonical readiness.
      before: '    ...removedShareIds(member, g).map((id) => `remove_node:${id}`),',
      after: '    // MUTANT: allow the retained share factor through expected-operation validation.',
    }]  },
  { name: 'detection-off', row: 'door1-jw-j2-convert',
    before: 'export function detectSameModelledEvent(graph: unknown, label: string, targetId: string | undefined, userText: string): SameModelledEvent | undefined {\n  const g = viewOf(graph);',
    after: 'export function detectSameModelledEvent(graph: unknown, label: string, targetId: string | undefined, userText: string): SameModelledEvent | undefined {\n  return undefined; // MUTANT: disable existing-event detection.\n  const g = viewOf(graph);'  },
  { name: 'impact-path-i-with-sized-op', row: 'door1-jw-j2-convert',
    before: 'impact_path: impactPath, effects,',
    // Keep every sized update_edge operation, while the persisted member claims the placeholder path.
    // Clearing the declared effects reproduces the contradiction rather than relying on an invalid enum member.
    after: "impact_path: 'i', effects: [],"  },
];
const run = (id, row) => {
  const report = join(temp, `door1-${id}.json`);
  const args = [join(repo, 'node_modules/vitest/vitest.mjs'), 'run', testFile,
    '--maxWorkers=1', '--no-file-parallelism', '--no-cache', '--configLoader=runner',
    '--reporter=json', `--outputFile=${report}`, ...(row ? ['-t', row] : [])];
  const result = spawnSync(process.execPath, args, { cwd: temp, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' } });
  writeFileSync(join(temp, `door1-${id}.stdout.log`), result.stdout ?? '');
  writeFileSync(join(temp, `door1-${id}.stderr.log`), result.stderr ?? '');
  const summary = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : {};
  const assertions = (summary.testResults ?? []).flatMap((entry) => entry.assertionResults ?? []);
  return { exit_code: result.status, passed: summary.numPassedTests ?? 0, failed: summary.numFailedTests ?? 0,
    target_failures: assertions.filter((entry) => entry.status === 'failed' && entry.fullName?.includes(row ?? ''))
      .map((entry) => ({ row: entry.fullName, failure_messages: entry.failureMessages ?? [] })),
    report };
};

try {
  for (const relative of [...new Set(files.stdout.split('\0').filter(Boolean))]) {
    if (relative.startsWith('acceptance-evidence/') || relative.startsWith('artefacts/') || relative.startsWith('output/')) continue;
    const source = resolve(repo, relative);
    if (!existsSync(source)) continue;
    const target = resolve(temp, relative);
    if (!target.startsWith(`${temp}/`)) throw new Error(`Unsafe inventory path ${relative}`);
    mkdirSync(dirname(target), { recursive: true });
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), target);
    else if (stat.isFile()) copyFileSync(source, target);
  }
  symlinkSync(join(repo, 'node_modules'), join(temp, 'node_modules'), 'dir');
  evidence.baseline = run('baseline');
  if (evidence.baseline.exit_code !== 0 || evidence.baseline.failed !== 0 || evidence.baseline.passed < 17) {
    throw new Error('Baseline is not GREEN. Mutant results would be inconclusive, so no mutants ran.');
  }
  for (const mutant of mutants) {
    let mutated = original;
    for (const mutation of [{ before: mutant.before, after: mutant.after }, ...(mutant.also ?? [])]) {
      if (mutated.split(mutation.before).length !== 2) throw new Error(`Mutation anchor missing or ambiguous: ${mutant.name}`);
      mutated = mutated.replace(mutation.before, mutation.after);
    }
    writeFileSync(join(temp, sourceFile), mutated);
    const result = run(mutant.name, mutant.row);
    const expectedFailure = mutant.failureIncludes === undefined
      || result.target_failures.some((entry) => entry.failure_messages.some((message) => message.includes(mutant.failureIncludes)));
    const killed = result.exit_code !== 0 && result.target_failures.length === 1 && expectedFailure;
    evidence.mutants.push({ mutant: mutant.name, row: mutant.row, killed, ...result });
    process.stdout.write(`${mutant.name}: ${killed ? 'KILLED (named route row RED)' : 'NOT PROVEN'}\n`);
  }
  success = evidence.mutants.every((entry) => entry.killed);
} finally {
  if (existsSync(join(temp, sourceFile))) writeFileSync(join(temp, sourceFile), original);
  writeFileSync(join(temp, 'door1-mutation-evidence.json'), JSON.stringify(evidence, null, 2));
  if (hash(join(repo, sourceFile)) !== originalHash) throw new Error('Shared source changed during verification; inspect independent agent edits.');
  process.stdout.write(`Evidence: ${join(temp, 'door1-mutation-evidence.json')}\n`);
  if (!keepTemp && success) {
    const savedReport = `/tmp/olumi-door1-mutation-evidence-${Date.now()}.json`;
    writeFileSync(savedReport, JSON.stringify(evidence, null, 2));
    rmSync(temp, { recursive: true, force: true });
    process.stdout.write(`Compact evidence retained: ${savedReport}\n`);
  }
}
process.exitCode = success ? 0 : 1;
