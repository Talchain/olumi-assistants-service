/** C1 retired the sole conventional state-query caller. Pin the complete
 * production call population at zero so an unrelated conversation cannot
 * regain its continuity chip without an explicit ownership review. */

import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { stripCommentsFile, GUARD_WALK_TIMEOUT_MS } from '../../../../scripts/ci/strip-source-comments.mjs';

const REPO_ROOT = resolve(__dirname, '../../../..');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('composeStateQueryChip — ownership boundary', () => {
  it('has no production callsite after the conventional state-query guard was retired', () => {
    // Match ACTUAL invocations only: `composeStateQueryChip(` with an open
    // paren, in the COMMENT-STRIPPED view of each file
    // (scripts/ci/strip-source-comments.mjs, the shared literal-aware
    // tokeniser). Comments are excluded by MECHANISM — the raw grep this
    // replaces claimed comments were excluded "because JSDoc wraps the name
    // in backticks", and a positive control on a plain comment naming the
    // call turned this gate red on 2026-07-20. Imports use a trailing comma
    // so they're naturally excluded too.
    const callLines: string[] = [];
    for (const abs of walkTsFiles(join(REPO_ROOT, 'src'))) {
      const rel = relative(REPO_ROOT, abs).split('\\').join('/');
      if (rel === 'src/orchestrator-v5/routing/state-query-guard.ts') continue;
      const lines = stripCommentsFile(abs).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes('composeStateQueryChip(')) {
          callLines.push(`${rel}:${i + 1}:${lines[i]!.trim()}`);
        }
      }
    }

    const callFiles = new Set(callLines.map((l) => l.split(':')[0]));

    // C1 removed the executor caller; a new production call is an ownership change.
    expect(
      callFiles.size,
      `expected 0 production files invoking composeStateQueryChip(); found ${callFiles.size}:\n${[...callFiles].join('\n')}`,
    ).toBe(0);
    // C1 deleted the sole executor caller; any new caller must reopen the ownership review.
    expect([...callFiles]).toEqual([]);
    expect(
      callLines.length,
      `expected exactly 0 production call lines; got:\n${callLines.join('\n')}`,
    ).toBe(0);
  }, GUARD_WALK_TIMEOUT_MS); // full-src tree walk; explicit timeout absorbs parallel-load CPU contention
});
