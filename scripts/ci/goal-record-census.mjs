#!/usr/bin/env node
// S5 slice 1: exact-token/file census, not an AST or a reader/writer classification.
// Fixed scope derived from NodeV3's 19 goal fields (including quantity_frame),
// GraphV3/CEEGraphResponseV3's goal_constraints + goal_node_id, and the named readers.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = join(ROOT, 'scripts/ci/goal-record-census-baseline.json');
export const ABSENT_CONTROL = 'goal_threshold_zzz_absent';
export const GOAL_FIELDS = Object.freeze([
  'goal_threshold', 'goal_threshold_raw', 'goal_threshold_unit',
  'goal_threshold_cap', 'goal_threshold_cap_provenance', 'goal_threshold_frame',
  'success_threshold', 'threshold_source', 'goal_direction', 'goal_horizon',
  'goal_horizon_months', 'goal_deadline_as_stated', 'goal_period', 'goal_stated_as',
  'goal_sense_reading', 'goal_level_reading', 'goal_scope', 'unit_reading',
  'quantity_frame', 'goal_constraints', 'goal_node_id',
  'statedGoalTargetOf', 'soleGoalOf', 'findSoleGoalNode', 'scoredGoalIdOf',
  'goalDeadlineOf', 'goalUnitOf', 'goalKindOf', 'readHeldGoalComparator',
  'resolveGoalDirection', 'resolveGoalThresholdStrict', 'goalChanceTargetCause',
  'extractPersistedGoalTarget', 'pickGoalThresholdTrio',
].sort());

export function tokenPattern(token) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) throw new Error(`Invalid token: ${token}`);
  return new RegExp(`\\b${token}\\b`, 'g');
}

// The tracked src/ tree (git ls-files): gitignored/generated files are out, tracked
// symlinks are in. Excluded: any __tests__/fixtures/prompts segment, any *.test.* basename.
export function censusFiles(root = ROOT) {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  return tracked.filter((file) => {
    const parts = file.split('/');
    const base = parts[parts.length - 1];
    return !parts.some((part) => ['__tests__', 'fixtures', 'prompts'].includes(part))
      && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(base) && !base.includes('.test.');
  }).sort();
}

export function countOccurrences(source, token) {
  return (source.match(tokenPattern(token)) ?? []).length;
}

export function runCensus(root = ROOT) {
  const tokens = [...GOAL_FIELDS, ABSENT_CONTROL];
  const refs = Object.fromEntries(tokens.map((token) => [token, {}]));
  for (const file of censusFiles(root)) {
    const path = join(root, file);
    // A tracked symlink to a directory would hide its contents: fail closed.
    if (statSync(path).isDirectory()) throw new Error(`symlinked directory in src/: ${file}; the census cannot see inside it`);
    // Deliberately conservative raw word-boundary census: literals/comments count too.
    const source = readFileSync(path, 'utf8');
    for (const token of tokens) {
      const n = countOccurrences(source, token);
      if (n > 0) refs[token][file] = n;
    }
  }
  const references = Object.fromEntries(GOAL_FIELDS.map((token) => [token,
    Object.fromEntries(Object.keys(refs[token]).sort().map((file) => [file, refs[token][file]]))]));
  const counts = Object.fromEntries(GOAL_FIELDS.map((token) => [token,
    Object.values(references[token]).reduce((sum, n) => sum + n, 0)]));
  return {
    references,
    counts,
    total_references: Object.values(counts).reduce((sum, count) => sum + count, 0),
    controls: { [ABSENT_CONTROL]: Object.keys(refs[ABSENT_CONTROL]).length },
  };
}

// Ratchet on occurrences per token per file: any growth fails, and any shrink fails
// until the baseline is regenerated in the same PR.
export function baselineDifferences(census, baseline) {
  const errors = [];
  for (const field of new Set([...Object.keys(baseline.references), ...GOAL_FIELDS])) {
    const before = baseline.references[field] ?? {};
    const now = census.references[field] ?? {};
    for (const file of new Set([...Object.keys(before), ...Object.keys(now)])) {
      const b = before[file] ?? 0;
      const n = now[file] ?? 0;
      if (n > b) errors.push(`new goal reference: ${field} in ${file} (${b} → ${n}) — read the goal through the one record (S5), or justify and regenerate`);
      else if (n < b) errors.push(`stale entry: ${field} in ${file} (${b} → ${n}) — the baseline must shrink in the same PR`);
    }
  }
  return errors.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--write', '--check'].includes(args[0]))) {
    throw new Error('Usage: node scripts/ci/goal-record-census.mjs [--write|--check]');
  }
  const census = runCensus();
  if (args[0] === '--write') {
    const source_sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    writeFileSync(BASELINE, `${JSON.stringify({ source_sha, ...census }, null, 2)}\n`);
  }
  if (args[0] === '--check') {
    const errors = baselineDifferences(census, JSON.parse(readFileSync(BASELINE, 'utf8')));
    if (errors.length) {
      process.stderr.write(`${errors.join('\n')}\n`);
      process.exitCode = 1;
    } else process.stdout.write(`S5 goal-record census: ${census.total_references} occurrences match baseline\n`);
  } else process.stdout.write(`${JSON.stringify(census, null, 2)}\n`);
}
