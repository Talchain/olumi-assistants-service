#!/usr/bin/env node
// Register a reproducible model through the REAL HTTP boundary, owned by the
// isolated API test user. Keeps the scenario for the browser journey.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { importJWK, SignJWT } from 'jose';

const stateDir = resolve(homedir(), '.codex/workspaces/shared-data-spine-local');
const connection = JSON.parse(readFileSync(resolve(stateDir, 'connection.json'), 'utf8'));
if (connection.supabaseUrl !== 'http://127.0.0.1:55431') throw new Error('Local target required');
const token = readFileSync(resolve(stateDir, 'api-user-token.txt'), 'utf8').trim();
const user = JSON.parse(readFileSync(resolve(stateDir, 'api-user.json'), 'utf8'));
let assistKey;
for (const line of readFileSync(resolve(homedir(), 'Documents/GitHub/olumi-assistants-service/.env.staging.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*ASSIST_API_KEY\s*=\s*(.*?)\s*$/);
  if (m) assistKey = m[1].replace(/^['"]|['"]$/g, '');
}
if (!assistKey) throw new Error('Existing assist credential required');
const scenarioId = randomUUID();
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/cross-service/b5-per-limit/17d1cd3a.graph.json', import.meta.url), 'utf8'));
async function post(path, body, bearer = token) {
  const response = await fetch(`http://127.0.0.1:8791${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-olumi-assist-key': assistKey, authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
  });
  return { status: response.status, body: await response.json() };
}
const root = `/assist/v1/scenarios/${scenarioId}/graph`;
const registered = await post(`${root}/register`, { graph: fixture.graph, brief_text: fixture.brief_text,
  operation_id: randomUUID(), expected_graph_identity_hash: null });
if (registered.status !== 200) throw new Error(`Register failed: ${JSON.stringify(registered)}`);
const read = await post(root, {});
if (read.status !== 200 || !read.body.graph_present) throw new Error(`Owner read failed: ${JSON.stringify(read)}`);
const jwk = JSON.parse(readFileSync(resolve(stateDir, 'api-signing-key.json'), 'utf8'));
const other = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
  .setSubject(randomUUID()).setAudience('authenticated').setIssuer(`${connection.supabaseUrl}/auth/v1`)
  .setIssuedAt().setExpirationTime('5m').sign(await importJWK(jwk, 'ES256'));
const wrongOwner = await post(root, {}, other);
const parts = token.split('.');
parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
const invalidToken = await post(root, {}, parts.join('.'));
if (wrongOwner.status !== 404 || invalidToken.status !== 401) throw new Error('Auth isolation check failed');
const receipt = { scenarioId, userId: user.id, register: registered.status, ownerRead: read.status,
  wrongOwner: wrongOwner.status, tamperedToken: invalidToken.status,
  browserUrl: `http://127.0.0.1:5178/#/scenario/${scenarioId}`, graphHash: read.body.graph_hash };
writeFileSync(resolve(stateDir, 'browser-scenario.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
