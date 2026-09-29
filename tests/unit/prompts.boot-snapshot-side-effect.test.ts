/**
 * Boot-snapshot side-effect + structural guard.
 *
 * Goal: catch any future regression where `buildRoutingPromptSnapshot()` is
 * accidentally moved back inside the `if (promptSystemEnabled)` block in
 * `src/server.ts`, or removed entirely. Booting Fastify is too heavy for a
 * unit test, so this file pairs:
 *
 *   1. A live side-effect test: simulate "after boot" by calling
 *      `buildRoutingPromptSnapshot()` and asserting `getRoutingPromptSnapshot()`
 *      returns a populated snapshot.
 *   2. A static-source assertion: read `src/server.ts` and confirm the
 *      `buildRoutingPromptSnapshot()` invocation lives outside the
 *      `if (promptSystemEnabled)` block. This is a cheap, brittle-on-purpose
 *      guard against silent re-nesting.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import {
  buildRoutingPromptSnapshot,
  getRoutingPromptSnapshot,
  __resetRoutingPromptSnapshotForTests,
} from '../../src/orchestrator-v5/routing/prompt-loader.js';

beforeAll(() => {
  registerAllDefaultPrompts();
});

beforeEach(() => {
  __resetRoutingPromptSnapshotForTests();
});

describe('boot snapshot side effect', () => {
  it('after build*, sync accessor returns a populated snapshot', async () => {
    await buildRoutingPromptSnapshot();
    const snap = getRoutingPromptSnapshot();
    expect(snap.systemChars).toBeGreaterThan(18_000);
    expect(snap.source).toBe('default');
    expect(snap.version).toBe('v40');
  });
});

describe('server.ts unconditional snapshot build (static guard)', () => {
  it('invokes buildRoutingPromptSnapshot() outside the promptSystemEnabled block', () => {
    const serverSrc = readFileSync(
      pathResolve(process.cwd(), 'src', 'server.ts'),
      'utf-8',
    );

    // Guard 1 — the call must exist somewhere.
    expect(serverSrc).toMatch(/await buildRoutingPromptSnapshot\(\)/);

    // Guard 2 — the call must come AFTER the `if (promptSystemEnabled)`
    // block closes. We approximate this by locating the call's position
    // and the block's closing brace, then asserting ordering.
    const callIdx = serverSrc.indexOf('await buildRoutingPromptSnapshot()');
    expect(callIdx).toBeGreaterThan(0);

    const blockOpenIdx = serverSrc.indexOf('if (promptSystemEnabled)');
    expect(blockOpenIdx).toBeGreaterThan(0);

    // Find a heuristic close marker: the comment we put just before the
    // unconditional call. If a future refactor moves the call back inside
    // the conditional, this comment search will still pass but the call
    // location relative to the conditional block will not — which is what
    // the next assertion catches.
    const commentIdx = serverSrc.indexOf(
      '// V5 routing prompt snapshot — built unconditionally at startup',
    );
    expect(commentIdx).toBeGreaterThan(blockOpenIdx);
    expect(commentIdx).toBeLessThan(callIdx);

    // The call must be at the top-level "build()" function depth, not
    // nested inside `if (promptSystemEnabled)`. Approximation: between the
    // conditional's opening line and our call, there must exist at least
    // one closing-brace-on-its-own-line "  }" that closes the conditional.
    const between = serverSrc.slice(blockOpenIdx, callIdx);
    expect(between).toMatch(/\n {2}}\n/);
  });
});
