#!/usr/bin/env node
// S5 slice 1: exact-token/file census, not an AST or a reader/writer classification.
// Fixed scope derived from NodeV3's 19 goal fields (including quantity_frame),
// GraphV3/CEEGraphResponseV3's goal_constraints + goal_node_id, and the named readers.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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
  return new RegExp(`\\b${token}\\b`);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['__tests__', 'fixtures', 'prompts'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)
      && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

export function runCensus(root = ROOT) {
  const tokens = [...GOAL_FIELDS, ABSENT_CONTROL];
  const patterns = tokens.map(tokenPattern);
  const refs = Object.fromEntries(tokens.map((token) => [token, []]));
  for (const path of walk(join(root, 'src'))) {
    // Deliberately conservative raw word-boundary census: literals/comments
    // count too. No inference, aliases, substrings, or occurrence counts.
    const source = readFileSync(path, 'utf8');
    const file = relative(root, path).split('\\').join('/');
    for (let i = 0; i < tokens.length; i += 1) {
      if (patterns[i].test(source)) refs[tokens[i]].push(file);
    }
  }
  const references = Object.fromEntries(GOAL_FIELDS.map((token) => [token, refs[token].sort()]));
  const counts = Object.fromEntries(GOAL_FIELDS.map((token) => [token, references[token].length]));
  return {
    references,
    counts,
    total_references: Object.values(counts).reduce((sum, count) => sum + count, 0),
    controls: { [ABSENT_CONTROL]: refs[ABSENT_CONTROL].length },
  };
}

export function baselineDifferences(census, baseline) {
  const errors = [];
  for (const field of new Set([...Object.keys(baseline.references), ...GOAL_FIELDS])) {
    const before = new Set(baseline.references[field] ?? []);
    const now = new Set(census.references[field] ?? []);
    for (const file of now) {
      if (!before.has(file)) errors.push(`new goal reference: ${field} in ${file} — read the goal through the one record (S5), or justify and regenerate`);
    }
    for (const file of before) {
      if (!now.has(file)) errors.push(`stale entry: ${field} in ${file} — the baseline must shrink in the same PR`);
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
    } else process.stdout.write(`S5 goal-record census: ${census.total_references} field/file references match baseline\n`);
  } else process.stdout.write(`${JSON.stringify(census, null, 2)}\n`);
}
