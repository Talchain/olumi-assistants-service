/**
 * V5 replay harness — localhost detection for the auth fail-fast gate.
 *
 * Contract: when `--base-url` points at a remote host, `OLUMI_REPLAY_API_KEY`
 * is required. For local development, the key is optional.
 *
 * We match only the exact hostnames below. We deliberately do NOT widen to
 *   - `host.docker.internal` (container ergonomics — letting it pass means
 *     a misconfigured Docker environment could silently hit remote staging
 *     without a key)
 *   - `*.nip.io`, `*.localtest.me`, `*.xip.io` (wildcard DNS — can resolve
 *     to any public IP, including a rotated attacker-controlled one)
 *   - `/etc/hosts` entries (dev-laptop-specific, not reproducible in CI)
 *
 * If you find yourself wanting to widen this set, halt and ask. The safe
 * path is always "set OLUMI_REPLAY_API_KEY for any non-localhost URL".
 */

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

/**
 * Returns true if `baseUrl`'s hostname is one of the exact localhost
 * values. Invalid URLs throw.
 */
export function isLocalHost(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  // `new URL('http://[::1]').hostname` returns '[::1]' with brackets.
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  return LOCAL_HOSTNAMES.has(hostname);
}
