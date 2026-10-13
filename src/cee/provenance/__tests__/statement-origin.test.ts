import { describe, expect, it } from 'vitest';
import { statementOrigin } from '../provenance-of.js';
import { statementOrigin as hostOrigin } from '../../../orchestrator-v5/agent-lane/runtime/statement-origin.js';

describe('T2c one statement-origin reader', () => {
  it('the existing host verification entry point is the reader itself', () => {
    expect(hostOrigin).toBe(statementOrigin);
  });
  it.each([
    [true, true, false, true, 'human'],
    [true, false, true, false, 'human'],
    [false, true, true, true, 'unknown'],
    [false, true, false, true, 'unknown'],
    [false, false, false, false, 'unknown'],
    [false, false, false, true, 'ai'],
    [false, false, true, false, 'ai'],
  ] as const)('verified=%s unknown=%s complete=%s ownEstimate=%s → %s', (verified, unknown, complete, own, origin) => {
    expect(hostOrigin(verified, unknown, complete, own)).toBe(origin);
  });
});
