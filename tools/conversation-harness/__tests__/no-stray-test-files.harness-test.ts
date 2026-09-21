/**
 * Naming-convention guard (the #432 review ask). Every test under
 * tools/conversation-harness MUST use the `.harness-test.ts` suffix. A stray
 * `*.test.ts` / `*.spec.ts` here WOULD be collected by the repo-root required
 * gate (vitest.required.config.ts uses the default `**.{test,spec}.*` include and
 * does NOT exclude tools/conversation-harness), silently pulling harness code —
 * which imports src/ guards and hits live services — into the product gate.
 *
 * This lane is path-restricted to tools/conversation-harness/**, so we enforce
 * the convention from inside the harness (a guard test in the harness-local
 * suite) + a README warning, rather than editing the root required config.
 * If this test fails, either rename the offending file to *.harness-test.ts, or
 * (if a root-gate test is genuinely intended) add an explicit exclusion to
 * vitest.required.config.ts in a lane that owns the repo root.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'runs', 'stores', '.git', 'dist']);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe('harness test-file naming convention', () => {
  it('has no *.test.ts / *.spec.ts files (they would enter the required gate)', () => {
    const stray = walk(HARNESS_ROOT).filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
    expect(stray, `rename these to *.harness-test.ts:\n${stray.join('\n')}`).toEqual([]);
  });

  it('finds the harness self-tests under the expected suffix', () => {
    const harnessTests = walk(HARNESS_ROOT).filter((f) => f.endsWith('.harness-test.ts'));
    expect(harnessTests.length).toBeGreaterThanOrEqual(4);
  });
});
