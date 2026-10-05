/**
 * Codex R1 F1 (PR #2573 @ 5d35e906), DL ruling: FREEZE. `records-v25/` is the Anthropic route's records compile, frozen
 * at staging 890923c9 because the Anthropic grammar is unchanged and cannot supply what the v-next compiler requires.
 *
 * NORMALISATION (the ONLY difference allowed between a frozen file and its staging blob): relative module specifiers in
 * `from '…'`, `import '…'` and `import('…')` positions are re-based from the staging file's directory onto
 * `records-v25/` — to the frozen sibling when the target is itself frozen, otherwise to the same live module. The
 * manifest lists every such [frozen specifier, staging specifier] pair; this test reverses exactly those pairs, in
 * specifier position only, and requires the git blob hash of the result to equal the staging blob. Any other edit to
 * a frozen file fails here.
 *
 * FOLLOW-UP: delete records-v25 when production is on PROXY_V5_TARGET=agent and witnessed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from './frozen-manifest.json';

const STAGING_COMMIT = ['890923c9', 'cb0919e5', 'd80fd05c', '32757d0b', '81d7e76d'].join('');
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const V25 = 'src/cee/draft/records-v25';
const SPECIFIER = /(\bfrom\s+|\bimport\s+|\bimport\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g;

const read = (path: string): string => readFileSync(posix.join(ROOT, path), 'utf8');
const gitBlob = (text: string): string => {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
};
const stripExt = (p: string): string => p.replace(/\.(js|ts)$/, '');

describe('records-v25 is byte-identical to staging 890923c9 after import-path normalisation only', () => {
  it('pins the staging commit as a 40-hex SHA built from a variable', () => {
    expect(STAGING_COMMIT).toHaveLength(40);
    expect(STAGING_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.staging_commit).toBe(STAGING_COMMIT);
    expect(manifest.frozen_dir).toBe(V25);
  });

  it('the manifest covers every frozen module, and nothing else lives in records-v25', () => {
    const onDisk = readdirSync(posix.join(ROOT, V25)).filter(name => name.endsWith('.ts')).map(name => `${V25}/${name}`).sort();
    expect(onDisk.length).toBeGreaterThan(10); // positive control: the probe sees the frozen set
    expect(manifest.files.map(f => f.frozen).sort()).toEqual(onDisk);
  });

  for (const entry of manifest.files) {
    it(`${entry.frozen} equals ${entry.staging_path} @ staging`, () => {
      expect(entry.staging_blob).toMatch(/^[0-9a-f]{40}$/);
      const pairs = new Map(entry.specifiers.map(([frozen, staging]) => [frozen, staging] as const));
      for (const [frozenSpec, stagingSpec] of pairs) {
        // Each pair is the re-basing rule, never an arbitrary substitution.
        const viaFrozen = posix.normalize(posix.join(V25, frozenSpec));
        const viaStaging = posix.normalize(posix.join(posix.dirname(entry.staging_path), stagingSpec));
        const sibling = manifest.files.find(f => stripExt(f.frozen) === stripExt(viaFrozen));
        if (sibling !== undefined) expect(stripExt(sibling.staging_path)).toBe(stripExt(viaStaging));
        else expect(viaFrozen).toBe(viaStaging);
      }
      let used = 0;
      const restored = read(entry.frozen).replace(SPECIFIER, (whole, lead: string, quote: string, spec: string) => {
        const original = pairs.get(spec);
        if (original === undefined) return whole;
        used += 1;
        return `${lead}${quote}${original}${quote}`;
      });
      if (pairs.size > 0) expect(used).toBeGreaterThanOrEqual(pairs.size);
      expect(gitBlob(restored)).toBe(entry.staging_blob);
    });
  }
});

/** Runtime imports only: a type-only import is erased and loads nothing. */
function runtimeSpecifiers(source: string): string[] {
  const out: string[] = [];
  const statement = /(?:^|\n)[ \t]*((?:import|export)\b[^;'"]*?(?:\{[^}]*\}[^;'"]*?)?\bfrom\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"])/g;
  for (const m of source.matchAll(statement)) {
    const head = m[1]!.trim();
    if (/^(import|export)\s+type\b/.test(head)) continue;
    const braces = /\{([^}]*)\}/.exec(head);
    if (braces && !/^import\s+[\w$]+\s*,/.test(head) && !/^import\s+\*/.test(head)) {
      const items = braces[1]!.split(',').map(x => x.trim()).filter(Boolean);
      if (items.length > 0 && items.every(x => x.startsWith('type '))) continue;
    }
    out.push(m[2] ?? m[3]!);
  }
  for (const m of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
  return out;
}
function reach(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeSpecifiers(read(file))) {
      if (!spec.startsWith('.')) continue;
      const base = posix.normalize(posix.join(posix.dirname(file), spec));
      const candidates = base.endsWith('.js') ? [`${stripExt(base)}.ts`, `${stripExt(base)}.tsx`] : [`${base}.ts`, `${base}/index.ts`];
      const hit = candidates.find(c => existsSync(posix.join(ROOT, c)));
      if (hit !== undefined && !seen.has(hit)) stack.push(hit);
    }
  }
  return seen;
}

describe('import graph: the Anthropic route compiles records ONLY through records-v25', () => {
  const LIVE_COMPILE = [
    'src/cee/draft/records/projector.ts', 'src/cee/draft/records/seam.ts', 'src/cee/draft/records/completion.ts',
    'src/cee/draft/records/grammar.ts', 'src/cee/draft/records/index.ts', 'src/cee/provenance/stated-effect.ts',
    'src/cee/context-integrity/not-modelled-manifest.ts', 'src/validators/graph-validator.ts',
  ];
  it('anthropic.ts reaches the frozen projector and seam, and never the live compile modules', () => {
    const reached = reach('src/adapters/llm/anthropic.ts');
    expect(reached.size).toBeGreaterThan(100); // positive control: the walker follows the real graph
    for (const frozen of ['projector.ts', 'seam.ts', 'index.ts', 'completion.ts', 'draft-document-acceptance.ts']) {
      expect(reached.has(`${V25}/${frozen}`), frozen).toBe(true);
    }
    expect(LIVE_COMPILE.filter(file => reached.has(file))).toEqual([]);
  });
  it('CONTRAST agent.construct (build-model-from-records) reaches the live projector and no records-v25 module', () => {
    const reached = reach('src/orchestrator-v5/agent-lane/runtime/build-model-from-records.ts');
    expect(reached.has('src/cee/draft/records/projector.ts')).toBe(true);
    expect(reached.has('src/cee/draft/records/seam.ts')).toBe(true);
    expect([...reached].filter(file => file.startsWith(`${V25}/`))).toEqual([]);
  });
});
