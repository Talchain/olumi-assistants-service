import { describe, expect, it } from 'vitest';

import { isLocalHost } from '../../../tools/v5-journey-replay/localhost.js';

describe('isLocalHost', () => {
  it.each([
    ['http://localhost', true],
    ['http://localhost:3000', true],
    ['http://localhost:3000/path', true],
    ['http://127.0.0.1', true],
    ['http://127.0.0.1:8080', true],
    ['http://0.0.0.0', true],
    ['http://0.0.0.0:9000', true],
    ['http://[::1]', true],
    ['http://[::1]:3000', true],
    ['https://localhost', true],
  ])('accepts local host: %s', (url, expected) => {
    expect(isLocalHost(url)).toBe(expected);
  });

  // Adversarial cases — these must NOT be treated as local, or a
  // misconfigured base URL could silently hit remote without a key.
  it.each([
    // substring-match attempts
    ['https://foolocalhost.com', false],
    ['https://localhost.example.com', false],
    ['https://staging.onrender.com', false],
    // wildcard DNS (nip.io / xip.io / localtest.me can resolve to any IP)
    ['http://127.0.0.1.nip.io', false],
    ['http://127.0.0.1.xip.io', false],
    ['http://localhost.localtest.me', false],
    // docker ergonomics — deliberately not local
    ['http://host.docker.internal:3000', false],
    // arbitrary IPs
    ['http://10.0.0.1', false],
    ['http://192.168.1.1', false],
    // the exact staging target
    ['https://cee-staging.onrender.com', false],
    // prod
    ['https://cee.onrender.com', false],
  ])('rejects non-local host: %s', (url, expected) => {
    expect(isLocalHost(url)).toBe(expected);
  });

  it('throws on invalid URL', () => {
    expect(() => isLocalHost('not-a-url')).toThrow();
  });
});
