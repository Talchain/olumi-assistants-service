/**
 * V5 alpha hardening Phase 2.1 — prompt-loader unit tests.
 *
 * Covers:
 *   - Sanity range check (correction 5): systemChars in [18500, 20500].
 *   - Hash + version are the primary proof of installation.
 *   - Load-failure isolation via the `resolvePath` test seam (correction 7)
 *     — no global fs mutation, no child process, no env mutation.
 *   - Stability: two loads of the real file produce identical hash.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  defaultPromptPath,
  EXPECTED_SYSTEM_CHARS_MAX,
  EXPECTED_SYSTEM_CHARS_MIN,
  loadRoutingPrompt,
  LOADED_PROMPT,
  ROUTING_PROMPT_VERSION,
} from '../prompt-loader.js';

describe('prompt-loader (v5 alpha hardening 2.1)', () => {
  it('exports the eager-loaded prompt with version v39', () => {
    expect(LOADED_PROMPT.version).toBe('v39');
    expect(ROUTING_PROMPT_VERSION).toBe('v39');
  });

  it('prompt size falls within the sanity range', () => {
    expect(LOADED_PROMPT.systemChars).toBeGreaterThanOrEqual(
      EXPECTED_SYSTEM_CHARS_MIN,
    );
    expect(LOADED_PROMPT.systemChars).toBeLessThanOrEqual(
      EXPECTED_SYSTEM_CHARS_MAX,
    );
  });

  it('hash is a 16-character lowercase hex prefix', () => {
    expect(LOADED_PROMPT.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hash is stable across reloads of the real prompt file', () => {
    const a = loadRoutingPrompt();
    const b = loadRoutingPrompt();
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(LOADED_PROMPT.hash);
    expect(a.systemChars).toBe(LOADED_PROMPT.systemChars);
  });

  it('throws when the prompt file is missing — exercised via the test seam', () => {
    // Correction 7: no fs mutation, no env mutation. The seam accepts an
    // injectable path resolver that points at a guaranteed-missing file.
    const missing = () =>
      resolve(process.cwd(), 'Prompts', '__does_not_exist_v38_2.txt');
    expect(() => loadRoutingPrompt(missing)).toThrow(/ENOENT|no such file/);
  });

  it('throws when a resolved file is too small (wrong file detection)', () => {
    // Point at a small file that definitely exists but is not the prompt.
    // tsconfig.build.json is tiny — well below EXPECTED_SYSTEM_CHARS_MIN.
    const wrong = () => resolve(process.cwd(), 'tsconfig.build.json');
    expect(() => loadRoutingPrompt(wrong)).toThrow(/outside expected range/);
  });

  it('defaultPromptPath resolves under process.cwd()/Prompts/v39.txt with exact casing', () => {
    // Exact casing matters on Linux/Render (correction 2). We assert the
    // segments rather than a full path to stay portable across runners.
    const p = defaultPromptPath();
    expect(p.endsWith('/Prompts/v39.txt')).toBe(true);
  });

  // Correction 6: confirm the loader works in the compiled dist layout, not
  // only under tsx. Render runs `node dist/src/server.js` with cwd at the
  // repo root; our process.cwd()-based resolver is invariant across tsx and
  // dist by design, and this test proves it by booting the compiled module
  // in a subprocess when dist is available. Skips on a fresh checkout
  // without a prior build — CI / prestart always runs `pnpm build` first.
  it.skipIf(
    !existsSync(
      resolve(
        process.cwd(),
        'dist',
        'src',
        'orchestrator-v5',
        'routing',
        'prompt-loader.js',
      ),
    ),
  )(
    'compiled dist module boots and reports matching hash',
    () => {
      const distModule = resolve(
        process.cwd(),
        'dist',
        'src',
        'orchestrator-v5',
        'routing',
        'prompt-loader.js',
      );
      const script = [
        `const m = require(${JSON.stringify(distModule)});`,
        `const p = m.LOADED_PROMPT;`,
        `process.stdout.write(JSON.stringify({ v: p.version, h: p.hash, c: p.systemChars }));`,
      ].join(' ');
      const out = execFileSync('node', ['-e', script], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      const parsed = JSON.parse(out) as { v: string; h: string; c: number };
      expect(parsed.v).toBe(ROUTING_PROMPT_VERSION);
      expect(parsed.h).toBe(LOADED_PROMPT.hash);
      expect(parsed.c).toBe(LOADED_PROMPT.systemChars);
    },
  );
});
