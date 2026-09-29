/**
 * SessionStore interface + error-class unit tests (slice B).
 */

import { describe, it, expect } from 'vitest';

import { SessionReadError, StateCommitFailedError } from '../store.js';

describe('StateCommitFailedError', () => {
  it('carries the message and rpc_code', () => {
    const err = new StateCommitFailedError('RPC died', { rpc_code: 'PGRST042' });
    expect(err.name).toBe('StateCommitFailedError');
    expect(err.message).toBe('RPC died');
    expect(err.rpc_code).toBe('PGRST042');
  });

  it('preserves cause when provided', () => {
    const inner = new Error('inner');
    const err = new StateCommitFailedError('outer', { cause: inner });
    expect((err as { cause?: unknown }).cause).toBe(inner);
  });

  it('rpc_code is undefined when not passed', () => {
    const err = new StateCommitFailedError('boom');
    expect(err.rpc_code).toBeUndefined();
  });

  it('is instanceof Error', () => {
    const err = new StateCommitFailedError('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('SessionReadError', () => {
  it('carries the message and code', () => {
    const err = new SessionReadError('read failed', { code: '42P01' });
    expect(err.name).toBe('SessionReadError');
    expect(err.message).toBe('read failed');
    expect(err.code).toBe('42P01');
  });

  it('preserves cause when provided', () => {
    const inner = { code: '42P01', message: 'missing table' };
    const err = new SessionReadError('outer', { cause: inner });
    expect((err as { cause?: unknown }).cause).toBe(inner);
  });
});
