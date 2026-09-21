/**
 * Verifies the v40 routing prompt is registered as a PMS default and
 * resolves byte-equally to the on-disk file (PMS-equivalence guard).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import { getDefaultPrompts, loadPrompt } from '../../src/prompts/loader.js';

beforeAll(() => {
  registerAllDefaultPrompts();
});

function sha16(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

describe('routing default registration', () => {
  it('registers a default for the routing task_id', () => {
    const defaults = getDefaultPrompts();
    expect(defaults.routing).toBeDefined();
    expect(typeof defaults.routing).toBe('string');
    expect((defaults.routing as string).length).toBeGreaterThan(18_000);
  });

  it('default content is byte-identical to Prompts/v40.txt on disk', () => {
    const defaults = getDefaultPrompts();
    const onDisk = readFileSync(
      resolve(process.cwd(), 'Prompts', 'v40.txt'),
      'utf-8',
    );
    expect(sha16(defaults.routing as string)).toBe(sha16(onDisk));
  });

  it('loadPrompt(routing) returns the registered default when store is bypassed', async () => {
    const loaded = await loadPrompt('routing', { forceDefault: true });
    expect(loaded.source).toBe('default');
    const defaults = getDefaultPrompts();
    expect(sha16(loaded.content)).toBe(sha16(defaults.routing as string));
  });
});
