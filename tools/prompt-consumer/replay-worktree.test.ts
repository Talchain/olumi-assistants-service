import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertExactCaseIds } from './contract.js';
import { requireReplayHistory, withReplayWorktree } from './replay-worktree.js';

const root = resolve(import.meta.dirname, '../..');
type Workflow = { jobs: Record<string, { name?: string; steps: { uses?: string; run?: string; with?: Record<string, unknown> }[] }> };
const workflow = parseYaml(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')) as Workflow;
function assertFullReplayHistory(value: Workflow) {
  const owners = Object.entries(value.jobs).filter(([, job]) => job.steps?.some(step => step.run === 'pnpm test -- --coverage' || step.run === 'pnpm test:required'));
  assert.deepEqual(owners.map(([id]) => id).sort(), ['full-test-suite', 'unit-tests']);
  for (const [, job] of owners) {
    const checkouts = job.steps.filter(step => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkouts.length, 1);
    assert.equal(checkouts[0]!.with?.['fetch-depth'], 0, 'Replay-owning checkout must supply all branch history');
  }
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe',
  env: { ...process.env, GIT_AUTHOR_NAME: 'Replay fixture', GIT_AUTHOR_EMAIL: 'replay@example.invalid', GIT_COMMITTER_NAME: 'Replay fixture', GIT_COMMITTER_EMAIL: 'replay@example.invalid' } }).trim();
const directories: string[] = [], names: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  assertExactCaseIds(['workflow-history', 'shallow-refusal', 'other-branch-history', 'owned-success', 'owned-failure'], names);
});
function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'replay-history-control-')); directories.push(directory);
  const origin = join(directory, 'origin'); git(directory, 'init', '-b', 'main', origin);
  writeFileSync(join(origin, 'marker.txt'), 'common source'); git(origin, 'add', '.'); git(origin, 'commit', '-m', 'common');
  git(origin, 'switch', '-c', 'archived-runtime');
  writeFileSync(join(origin, 'marker.txt'), 'archived runtime'); git(origin, 'add', '.'); git(origin, 'commit', '-m', 'archived source');
  const archivedHead = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', 'main');
  writeFileSync(join(origin, 'marker.txt'), 'current source'); git(origin, 'add', '.'); git(origin, 'commit', '-m', 'current');
  const shallow = join(directory, 'shallow');
  git(directory, 'clone', '--quiet', '--depth', '1', '--single-branch', '--branch', 'main', `file://${origin}`, shallow);
  return { origin, shallow, archivedHead };
}

describe('archival replay checkout authority and owned lifecycle, no provider calls', () => {
  it('workflow-history', () => {
    names.push('workflow-history'); assertFullReplayHistory(workflow);
    const broken = structuredClone(workflow);
    const checkout = broken.jobs['full-test-suite']!.steps.find(step => step.uses?.startsWith('actions/checkout@'))!;
    delete checkout.with;
    expect(() => assertFullReplayHistory(broken)).toThrow('all branch history');
    const unrelated = structuredClone(workflow); unrelated.jobs['full-test-suite']!.name = 'An unrelated descriptive name';
    expect(() => assertFullReplayHistory(unrelated)).not.toThrow();
  });
  it('shallow-refusal', () => {
    names.push('shallow-refusal'); const { shallow, archivedHead } = repository();
    expect(git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('true');
    const before = git(shallow, 'worktree', 'list', '--porcelain');
    let reached = false;
    expect(() => withReplayWorktree(shallow, archivedHead, [], () => { reached = true; return 'must not run'; })).toThrow(`REPLAY_SOURCE_UNAVAILABLE: ${archivedHead}`);
    expect(() => withReplayWorktree(shallow, git(shallow, 'rev-parse', 'HEAD'), [archivedHead], () => { reached = true; return 'recorder must be available too'; })).toThrow(`REPLAY_SOURCE_UNAVAILABLE: ${archivedHead}`);
    expect(reached).toBe(false);
    expect(git(shallow, 'worktree', 'list', '--porcelain')).toBe(before);
    expect(git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('true'); // No hidden fetch.
    expect(() => requireReplayHistory(shallow, [git(shallow, 'rev-parse', 'HEAD')])).not.toThrow();
  });
  it('other-branch-history', () => {
    names.push('other-branch-history'); const { shallow, archivedHead } = repository();
    git(shallow, 'fetch', '--quiet', '--unshallow', 'origin');
    expect(git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('false');
    expect(() => requireReplayHistory(shallow, [archivedHead])).toThrow('REPLAY_SOURCE_UNAVAILABLE');
    // Local-file transport models actions/checkout depth0's all-branch fetch;
    // the replay utility itself performs no fetch or network operation.
    git(shallow, 'fetch', '--quiet', 'origin', '+refs/heads/*:refs/remotes/origin/*');
    expect(() => requireReplayHistory(shallow, [archivedHead])).not.toThrow();
  });
  it('owned-success', () => {
    names.push('owned-success'); const { origin, archivedHead } = repository();
    const before = git(origin, 'worktree', 'list', '--porcelain');
    let allocated: string | undefined;
    const result = withReplayWorktree(origin, archivedHead, [], runtime => {
      allocated = runtime;
      expect(git(runtime, 'rev-parse', 'HEAD')).toBe(archivedHead);
      expect(readFileSync(join(runtime, 'marker.txt'), 'utf8')).toBe('archived runtime');
      return 'actual archived source, not current source';
    });
    expect(result).toBe('actual archived source, not current source');
    expect(allocated).toBeDefined(); expect(existsSync(allocated!)).toBe(false);
    expect(git(origin, 'worktree', 'list', '--porcelain')).toBe(before);
  });
  it('owned-failure', () => {
    names.push('owned-failure'); const { origin, archivedHead } = repository();
    const before = git(origin, 'worktree', 'list', '--porcelain'), failure = new Error('original replay failure');
    let allocated: string | undefined, caught: unknown;
    try { withReplayWorktree(origin, archivedHead, [], runtime => { allocated = runtime; throw failure; }); }
    catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(allocated).toBeDefined(); expect(existsSync(allocated!)).toBe(false);
    expect(git(origin, 'worktree', 'list', '--porcelain')).toBe(before);
  });
});
