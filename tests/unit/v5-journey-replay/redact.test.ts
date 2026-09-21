import { describe, expect, it } from 'vitest';

import { createRedactor, redactString, sanitiseError } from '../../../tools/v5-journey-replay/redact.js';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';

describe('redactString', () => {
  it('returns input unchanged when secret is undefined', () => {
    expect(redactString(`prefix ${SENTINEL} suffix`, undefined)).toBe(`prefix ${SENTINEL} suffix`);
  });

  it('returns input unchanged when secret is empty string', () => {
    expect(redactString(`prefix ${SENTINEL} suffix`, '')).toBe(`prefix ${SENTINEL} suffix`);
  });

  it('replaces single occurrence with [REDACTED]', () => {
    expect(redactString(`x=${SENTINEL}`, SENTINEL)).toBe('x=[REDACTED]');
  });

  it('replaces every occurrence', () => {
    const input = `${SENTINEL} appears thrice: ${SENTINEL}, then ${SENTINEL}`;
    const out = redactString(input, SENTINEL);
    expect(out).not.toContain(SENTINEL);
    expect(out.match(/\[REDACTED\]/g)?.length).toBe(3);
  });

  it('handles regex metacharacters in secret (base64url +/=)', () => {
    const plusSecret = 'abc+def/ghi=';
    const input = `Authorization: Bearer ${plusSecret}`;
    expect(redactString(input, plusSecret)).toBe('Authorization: Bearer [REDACTED]');
  });

  it('handles regex metacharacters across multiple occurrences', () => {
    const dotSecret = 'v.1.2.3.key';
    const input = `${dotSecret} and ${dotSecret}`;
    expect(redactString(input, dotSecret)).toBe('[REDACTED] and [REDACTED]');
  });
});

describe('createRedactor', () => {
  it('returns identity stringifier when secret undefined', () => {
    const redact = createRedactor(undefined);
    expect(redact('hello')).toBe('hello');
    expect(redact({ a: 1 })).toBe('{"a":1}');
    expect(redact(null)).toBe('null');
    expect(redact(undefined)).toBe('undefined');
  });

  it('returns identity stringifier when secret empty', () => {
    const redact = createRedactor('');
    expect(redact(SENTINEL)).toBe(SENTINEL);
  });

  it('redacts plain string inputs', () => {
    const redact = createRedactor(SENTINEL);
    expect(redact(`msg=${SENTINEL}`)).toBe('msg=[REDACTED]');
  });

  it('redacts Error.stack including the secret', () => {
    const redact = createRedactor(SENTINEL);
    const err = new Error(`boom ${SENTINEL}`);
    err.stack = `Error: boom ${SENTINEL}\n    at redactor.test (file:1:1)`;
    const out = redact(err);
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('[REDACTED]');
  });

  it('redacts JSON-stringified objects', () => {
    const redact = createRedactor(SENTINEL);
    const obj = { header: { 'x-olumi-assist-key': SENTINEL }, url: 'https://example.com' };
    const out = redact(obj);
    expect(out).not.toContain(SENTINEL);
  });

  it('does not throw on circular references', () => {
    const redact = createRedactor(SENTINEL);
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => redact(obj)).not.toThrow();
  });
});

describe('sanitiseError', () => {
  it('returns new Error with redacted message', () => {
    const original = new Error(`fetch failed: header x-olumi-assist-key=${SENTINEL}`);
    const sanitised = sanitiseError(original, SENTINEL);
    expect(sanitised).toBeInstanceOf(Error);
    expect(sanitised.message).not.toContain(SENTINEL);
    expect(sanitised.message).toContain('[REDACTED]');
  });

  it('redacts stack trace', () => {
    const original = new Error('boom');
    original.stack = `Error: boom\n    header-value=${SENTINEL}\n    at test`;
    const sanitised = sanitiseError(original, SENTINEL);
    expect(sanitised.stack).toBeDefined();
    expect(sanitised.stack).not.toContain(SENTINEL);
  });

  it('preserves Error name (e.g. AbortError)', () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const sanitised = sanitiseError(abortErr, SENTINEL);
    expect(sanitised.name).toBe('AbortError');
  });

  it('handles non-Error values', () => {
    const sanitised = sanitiseError(`raw string with ${SENTINEL}`, SENTINEL);
    expect(sanitised).toBeInstanceOf(Error);
    expect(sanitised.message).not.toContain(SENTINEL);
  });

  it('is a no-op when secret is undefined', () => {
    const original = new Error('normal error');
    const sanitised = sanitiseError(original, undefined);
    expect(sanitised.message).toBe('normal error');
  });
});
