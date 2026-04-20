/**
 * Tarball SHA drift simulation — V5 slice A1.
 *
 * Proves that `scripts/validate-tarball-sha.sh` rejects when the vendored
 * tarball's bytes drift from the recorded manifest. Required by the A1
 * brief: "drift simulation test: spawns a temp tarball with modified bytes,
 * confirms hook exits non-zero".
 *
 * The test swaps the real tarball for a modified copy inside a try/finally
 * so the real file is always restored, even on assertion failure.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'validate-tarball-sha.sh');

// Derive the currently-pinned tarball from package.json so the drift
// simulation targets whatever the validator actually checks. Mirrors the
// pin-discovery logic in scripts/validate-tarball-sha.sh (generalised in
// the CQE 0.6.0 bump to avoid a hardcoded version per file).
const PACKAGE_JSON = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');
const PIN_MATCH = PACKAGE_JSON.match(
  /"@talchain\/schemas":\s*"file:\.\/vendor\/([^"]+\.tgz)"/,
);
if (!PIN_MATCH) {
  throw new Error(
    'tarball-sha-drift test cannot run: package.json has no pinned @talchain/schemas file:./vendor/*.tgz',
  );
}
const PINNED_TARBALL = PIN_MATCH[1]!;
const TARBALL = join(REPO_ROOT, 'vendor', PINNED_TARBALL);
const BACKUP = `${TARBALL}.backup-for-drift-test`;

function runValidator(): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT], { encoding: 'utf8' });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof e.status === 'number' ? e.status : 1,
      stdout: typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '',
      stderr: typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '',
    };
  }
}

describe('tarball SHA drift simulation', () => {
  afterEach(() => {
    // Restore the tarball even if a test throws mid-way.
    if (existsSync(BACKUP)) {
      const backupBytes = readFileSync(BACKUP);
      writeFileSync(TARBALL, backupBytes);
      execFileSync('rm', ['-f', BACKUP]);
    }
  });

  it('passes on the committed tarball (clean tree)', () => {
    expect(existsSync(TARBALL)).toBe(true);
    expect(existsSync(SCRIPT)).toBe(true);
    const result = runValidator();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tarball SHA OK');
  });

  it('rejects when the tarball bytes drift from the manifest', () => {
    // 1. Back up the real tarball.
    const original = readFileSync(TARBALL);
    writeFileSync(BACKUP, original);

    // 2. Write a tampered copy (flip one byte at the end so metadata-style
    //    processing still recognises it as a tarball, but the SHA changes).
    const tampered = Buffer.from(original);
    const lastIdx = tampered.length - 1;
    tampered[lastIdx] = (tampered[lastIdx]! + 1) % 256;
    writeFileSync(TARBALL, tampered);

    // 3. Verify the file size is unchanged (bug guard — we changed one byte).
    expect(statSync(TARBALL).size).toBe(original.length);

    // 4. Run validator, expect non-zero + stable error message.
    const result = runValidator();
    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain(
      'Vendored schemas tarball changed without manifest update. Rebuild and commit both.',
    );
  });
});
