import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const current = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const base = execFileSync('git', ['rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim();
const check = (...args: string[]) => spawnSync(process.execPath,
  ['--import', 'tsx', 'scripts/gp-goal-census.ts', ...args, '--check-identity'], { encoding: 'utf8' });

describe('the census binds caller-supplied baseline and reviewed HEAD', () => {
  it('RED old hard-coded HEAD: current HEAD is accepted and supplied baseline is reported, without scanning', () => {
    const result = check('--base', base, '--head', current);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Census identities: ${base} → ${current} (working tree).`);
    expect(result.stdout).not.toContain('Scanned');
  });
  it('a different requested HEAD fails before scanning or writing census artifacts', () => {
    const result = check('--base', base, '--head', base);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Expected HEAD ${base}, got ${current}`);
    expect(result.stdout).not.toContain('Scanned');
  });
  it('requires both identities rather than silently replaying a pinned baseline', () => {
    const result = check('--head', current);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Both --base and --head are required');
  });
});
