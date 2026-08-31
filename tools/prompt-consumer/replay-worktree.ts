/** Offline test support: use the actual archived source, never today's parser. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const git = (root: string, args: string[]) => execFileSync('git', args, {
  cwd: root, stdio: 'pipe', env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
});

export function requireReplayHistory(root: string, heads: readonly string[]): void {
  assert(heads.length > 0 && heads.every(head => /^[a-f0-9]{40}$/.test(head)), 'Exact replay source heads required');
  const missing = heads.filter(head => {
    try { git(root, ['cat-file', '-e', `${head}^{commit}`]); return false; }
    catch { return true; }
  });
  assert.equal(missing.length, 0, `REPLAY_SOURCE_UNAVAILABLE: ${missing.join(', ')}. Check out all branch history (actions/checkout fetch-depth: 0); no fetch, skip or HEAD substitution is performed by replay.`);
}

/** The callback synchronously runs the native replay and returns its output. */
export function withReplayWorktree(root: string, runtimeHead: string, recorderHeads: readonly string[], replay: (runtimeRoot: string) => string): string {
  requireReplayHistory(root, [runtimeHead, ...recorderHeads]);
  // Only share installed dependencies if all committed dependency pins match.
  git(root, ['diff', '--exit-code', runtimeHead, 'HEAD', '--', 'package.json', 'pnpm-lock.yaml', 'vendor']);
  const temporary = mkdtempSync(join(tmpdir(), 'local-response-replay-'));
  const runtimeRoot = join(temporary, 'runtime');
  let owned = false, failed = false;
  let primaryError: unknown;
  let result = '';
  try {
    git(root, ['worktree', 'add', '--detach', runtimeRoot, runtimeHead]);
    owned = true;
    symlinkSync(resolve(root, 'node_modules'), join(runtimeRoot, 'node_modules'), 'dir');
    result = replay(runtimeRoot);
  } catch (error) { failed = true; primaryError = error; }
  const cleanupErrors: unknown[] = [];
  try { if (owned) git(root, ['worktree', 'remove', '--force', runtimeRoot]); }
  catch (error) { cleanupErrors.push(error); }
  try { rmSync(temporary, { recursive: true, force: true }); }
  catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) throw new AggregateError(failed ? [primaryError, ...cleanupErrors] : cleanupErrors,
    failed ? `Archived replay failed: ${String(primaryError)}; cleanup also failed` : 'Archived replay cleanup failed', { cause: failed ? primaryError : cleanupErrors[0] });
  if (failed) throw primaryError;
  return result;
}
