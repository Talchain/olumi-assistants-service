/**
 * Self-test for run/eval hygiene (C-hygiene fixes):
 *   - run-dir.mjs prepareRunDir — every run starts CLEAN; stale turn dirs from
 *     a previous journey must never be scored; foreign dirs are refused.
 *   - prompt-eval.sh pins — unique per-eval run dirs + baseline store
 *     refresh/verify (age gate, sha256 evidence). The shell script has no unit
 *     seam, so these are syntax + structural pins, not behaviour tests.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — untyped harness-local .mjs module (tool-local, not src/)
import { prepareRunDir } from '../run-dir.mjs';

const HARNESS = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('prepareRunDir (unique CLEAN run dirs) [fix]', () => {
  it('creates a fresh skeleton for a new dir', () => {
    const base = mkdtempSync(join(tmpdir(), 'run-dir-'));
    const dir = join(base, 'arm-1');
    prepareRunDir(dir, { wantL0: true });
    expect(existsSync(join(dir, 'turns'))).toBe(true);
    expect(existsSync(join(dir, 'l0'))).toBe(true);
  });

  it('WIPES stale turn dirs from a previous run it owns (run-log.txt marker)', () => {
    const base = mkdtempSync(join(tmpdir(), 'run-dir-'));
    const dir = join(base, 'arm-1');
    // Previous, LONGER journey left extra turns behind — score-run.ts's
    // defensive loader would append them to the scored set (the stale-dir bug).
    mkdirSync(join(dir, 'turns', 'STALE9'), { recursive: true });
    writeFileSync(join(dir, 'turns', 'STALE9', 'wire.json'), '{}');
    writeFileSync(join(dir, 'run-log.txt'), 'RUN END\n');
    prepareRunDir(dir);
    expect(existsSync(join(dir, 'turns', 'STALE9'))).toBe(false);
    expect(readdirSync(join(dir, 'turns'))).toEqual([]);
  });

  it('REFUSES to clean a dir it does not own (no run-log.txt marker)', () => {
    const base = mkdtempSync(join(tmpdir(), 'run-dir-'));
    const dir = join(base, 'precious-data');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notes.txt'), 'do not delete');
    expect(() => prepareRunDir(dir)).toThrow(/refusing/i);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf-8')).toBe('do not delete');
  });

  it('treats an existing EMPTY dir as safe to (re)initialise', () => {
    const base = mkdtempSync(join(tmpdir(), 'run-dir-'));
    const dir = join(base, 'empty');
    mkdirSync(dir, { recursive: true });
    prepareRunDir(dir);
    expect(existsSync(join(dir, 'turns'))).toBe(true);
  });
});

describe('runner.mjs + prompt-eval.sh hygiene pins', () => {
  it('runner.mjs prepares its run dir via prepareRunDir (no bare mkdir into a reused dir)', () => {
    const src = readFileSync(join(HARNESS, 'runner.mjs'), 'utf-8');
    expect(src).toContain("import { prepareRunDir } from './run-dir.mjs'");
    expect(src).toContain('prepareRunDir(runDir');
  });

  it('prompt-eval.sh parses (bash -n)', () => {
    execFileSync('bash', ['-n', join(HARNESS, 'prompt-eval.sh')]); // throws on syntax error
  });

  it('prompt-eval.sh uses a UNIQUE per-eval runs dir (stale base-N reuse eliminated)', () => {
    const sh = readFileSync(join(HARNESS, 'prompt-eval.sh'), 'utf-8');
    expect(sh).toMatch(/EVAL_ID="\$\(date \+%Y%m%d-%H%M%S\)-\$\$"/);
    expect(sh).toContain('RUNS_DIR="$DIR/runs/eval-${TASK}-${EVAL_ID}"');
  });

  it('prompt-eval.sh age-gates + verifies the baseline store and records its sha256', () => {
    const sh = readFileSync(join(HARNESS, 'prompt-eval.sh'), 'utf-8');
    expect(sh).toContain('BASELINE_MAX_AGE_HOURS');
    expect(sh).toContain('--refresh-baseline');
    expect(sh).toContain('baseline-store.txt');
    expect(sh).toContain('json.loads(raw)'); // parse verification hard-fails a corrupt store
  });
});
