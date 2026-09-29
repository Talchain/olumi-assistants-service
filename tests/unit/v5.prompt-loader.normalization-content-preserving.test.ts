/**
 * V5 routing prompt — normalization is the documented whitespace-only
 * transform.
 *
 * Tripwire: if `loadRoutingPrompt()` ever applies a transform broader
 * than (CRLF/CR → LF) + (per-line trailing whitespace strip), this test
 * fails. The test asserts EXACT byte equality against the documented
 * transform — not just that stripping all whitespace gives the same
 * result, which would miss internal whitespace edits.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  defaultPromptPath,
  loadRoutingPrompt,
} from '../../src/orchestrator-v5/routing/prompt-loader.js';

function documentedTransform(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}

describe('routing prompt normalization is content-preserving', () => {
  it('loader output equals the documented (CRLF→LF + trim-trailing) transform exactly', () => {
    const raw = readFileSync(defaultPromptPath(), 'utf-8');
    const loaded = loadRoutingPrompt().text;
    expect(loaded).toBe(documentedTransform(raw));
  });

  it('non-whitespace characters are preserved (broader sanity check)', () => {
    const raw = readFileSync(defaultPromptPath(), 'utf-8');
    const loaded = loadRoutingPrompt().text;
    const stripWs = (s: string) => s.replace(/\s/g, '');
    expect(stripWs(loaded)).toBe(stripWs(raw));
  });
});
