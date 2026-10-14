import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Required timing advisory flag', () => {
  it('sets CEE_REQUIRED_GATE in test.env', () => {
    const config = readFileSync(new URL('../../../vitest.required.config.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/test:\s*\{\s*(?:\/\/[^\n]*\n\s*)*env:\s*\{\s*CEE_REQUIRED_GATE:\s*["']1["']/);
  });
  it('exports timingIt and timingGated keyed on the same Required condition', () => {
    const helper = readFileSync(new URL('../../helpers/scaling-ratio.ts', import.meta.url), 'utf8');
    expect(helper).toMatch(/export const timingIt(?::\s*typeof it\.skip)? = process\.env\.CEE_REQUIRED_GATE === '1' \? it\.skip : it;/);
    expect(helper).toMatch(/export const timingGated = process\.env\.CEE_REQUIRED_GATE !== '1';/);
  });
});
