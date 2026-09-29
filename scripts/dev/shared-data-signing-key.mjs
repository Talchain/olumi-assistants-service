// The shared-data experiment's ONE local user-token signing key (ES256), in its private state dir.
// Both local platform pieces read it: shared-data-db.mjs publishes the public half to PostgREST (beside the
// service_role HMAC secret), and shared-data-api.mjs serves it as CEE's JWKS and signs the synthetic user's token.
// Plain node:crypto so the DB runner stays dependency-free. Never printed.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The private JWK ({kty:'EC', crv:'P-256', x, y, d, kid, alg:'ES256'}), created once at mode 600. */
export function ensureSigningKey(stateDir) {
  const file = resolve(stateDir, 'api-signing-key.json');
  if (!existsSync(file)) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...privateKey.export({ format: 'jwk' }), kid: `local-${randomUUID().slice(0, 8)}`, alg: 'ES256' };
    try { writeFileSync(file, JSON.stringify(jwk), { mode: 0o600, flag: 'wx' }); } // wx: a racing writer's key wins
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The verification half only. */
export function publicJwkOf(privateJwk) {
  const { d: _secret, ...publicJwk } = privateJwk;
  return publicJwk;
}
