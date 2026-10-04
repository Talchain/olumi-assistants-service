/**
 * `scripts/validate-docs-consistency.sh` rule 3 — the pinned `@talchain/schemas` archive.
 *
 * The rule once compared EVERY vendored archive filename to the one pin, so a deliberately kept rollback archive
 * (for a separate rollout) failed every native push (programme-docs #87 5972191802). It now
 * checks the PINNED archive: present, and matching its committed `.sha256`. These rows run the real script against a
 * throwaway repo root, so each one is the guard's own exit code, not a re-implementation of it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARD = resolve(__dirname, '../../scripts/validate-docs-consistency.sh');
const roots: string[] = [];

function repo(pin: string, archives: Record<string, { bytes: string; sha256?: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-consistency-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'vendor'));
  copyFileSync(GUARD, join(root, 'scripts', 'validate-docs-consistency.sh'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@talchain/schemas': pin } }, null, 2));
  for (const [name, { bytes, sha256 }] of Object.entries(archives)) {
    writeFileSync(join(root, 'vendor', name), bytes);
    if (sha256 !== undefined) writeFileSync(join(root, 'vendor', `${name}.sha256`), `${sha256}\n`);
  }
  return root;
}

const sha = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
const run = (root: string) => spawnSync('bash', [join(root, 'scripts', 'validate-docs-consistency.sh')], { encoding: 'utf8' });

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('docs-consistency guard, rule 3: the pinned schemas archive', () => {
  const PIN = 'file:./vendor/talchain-schemas-0.76.0.tgz';

  it('passes with the pinned archive AND a kept rollback archive beside it', () => {
    const r = run(repo(PIN, {
      'talchain-schemas-0.75.0.tgz': { bytes: 'old', sha256: sha('old') },
      'talchain-schemas-0.76.0.tgz': { bytes: 'new', sha256: sha('new') },
    }));
    expect(r.stdout).toContain('Docs consistency check OK');
    expect(r.status).toBe(0);
  });

  it('fails when the pinned archive is missing, even with another version vendored', () => {
    const r = run(repo(PIN, { 'talchain-schemas-0.75.0.tgz': { bytes: 'old', sha256: sha('old') } }));
    expect(r.stdout).toContain('pin (0.76.0) has no vendored tarball');
    expect(r.status).toBe(1);
  });

  it('fails when the pinned archive does not match its committed checksum', () => {
    const r = run(repo(PIN, { 'talchain-schemas-0.76.0.tgz': { bytes: 'new', sha256: sha('tampered') } }));
    expect(r.stdout).toContain('does not match its committed .sha256');
    expect(r.status).toBe(1);
  });

  it.each([
    ['a four-component version', 'file:./vendor/talchain-schemas-0.76.0.1.tgz'],
    ['a trailing dot', 'file:./vendor/talchain-schemas-0.76.0..tgz'],
    ['a registry range', '^0.76.0'],
  ])('a NEIGHBOURING archive cannot satisfy a different pin: %s', (_label, pin) => {
    const r = run(repo(pin, { 'talchain-schemas-0.76.0.tgz': { bytes: 'new', sha256: sha('new') } }));
    expect(r.stdout).toContain('pin does not match file:./vendor/... shape');
    expect(r.status).toBe(1);
  });
});
