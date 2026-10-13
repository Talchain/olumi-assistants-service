import { describe, expect, it } from 'vitest';
import { statementOrigin as authority } from '../provenance-of.js';
import { statementOrigin } from '../../../orchestrator-v5/agent-lane/runtime/statement-origin.js';

describe('T2sm statementOrigin: completeness never establishes authorship', () => {
  it('the runtime re-exports the provenance authority', () => { expect(statementOrigin).toBe(authority); });
  it.each([
    [true, true, false, true, 'human'],
    [true, false, true, false, 'human'],
    [false, true, true, true, 'unknown'],
    [false, true, false, true, 'unknown'],
    [false, false, false, false, 'unknown'],
    [false, false, false, true, 'ai'],
    [false, false, true, false, 'unknown'],
    [false, false, true, true, 'ai'],
  ] as const)('verified=%s unknown=%s complete=%s ownEstimate=%s => %s', (verified, unknown, complete, own, origin) => {
    expect(statementOrigin(verified, unknown, complete, own)).toBe(origin);
  });
  it('absent completeness is incomplete, never evidence of AI authorship', () => {
    expect(statementOrigin(false, false)).toBe('unknown');
  });
});
