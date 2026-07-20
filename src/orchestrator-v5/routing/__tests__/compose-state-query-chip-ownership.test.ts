/**
 * V5 product-state continuity (foamy-bee tranche) — ownership invariant.
 *
 * `composeStateQueryChip` is the home for the state-query continuity
 * chip. The chip-generator's post-mutation rule deliberately does NOT
 * read `priorFacts` — that's the structural fix from P1-6. If a future
 * agent calls `composeStateQueryChip` from anywhere other than the
 * state-query guard's dispatch block in turn-executor, the ownership
 * boundary is broken and the chip could surface on unrelated converse
 * turns again.
 *
 * This test grep-scans the production source tree (excluding tests and
 * the module itself) and asserts there is exactly ONE callsite. If that
 * count drifts, the test fails with an explicit pointer to the
 * regression and a list of all detected callsites for triage.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { stripComments } from '../../../../scripts/ci/strip-source-comments.mjs';

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
  it('has exactly one production callsite (turn-executor.ts state-query guard block)', () => {
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
      const lines = stripComments(readFileSync(abs, 'utf8')).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes('composeStateQueryChip(')) {
          callLines.push(`${rel}:${i + 1}:${lines[i]!.trim()}`);
        }
      }
    }

    const callFiles = new Set(callLines.map((l) => l.split(':')[0]));

    // Expected: one and only one call site, in turn-executor.ts. If a
    // future change reuses this function from another module, the
    // ownership boundary has drifted and the chip could surface on
    // unrelated converse turns. Failure shows the offending lines so
    // triage is one click.
    expect(
      callFiles.size,
      `expected 1 production file invoking composeStateQueryChip(); found ${callFiles.size}:\n${[...callFiles].join('\n')}`,
    ).toBe(1);
    expect(callFiles.has('src/orchestrator-v5/turn-executor.ts')).toBe(true);
    expect(
      callLines.length,
      `expected exactly 1 production call line; got:\n${callLines.join('\n')}`,
    ).toBe(1);
  });
});
