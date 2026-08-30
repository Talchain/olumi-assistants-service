/** Read-only sampling. Retains response bodies, never authentication headers. */
import assert from 'node:assert/strict';
import { sha256 } from './contract.js';
import type { ReadOnlyGetCapture, ServingObservation } from './serving-evidence.js';

export async function readServingObservation(input: { baseUrl: string; promptId: string; adminKey: string; environment: 'staging' | 'production' }, fetcher: typeof fetch = fetch): Promise<ServingObservation> {
  const base = new URL(input.baseUrl);
  assert(!base.username && !base.password, 'credentials must not be embedded in the evidence URL');
  assert(input.adminKey, 'ADMIN_API_KEY required for read-only observation');
  const get = async (path: string): Promise<ReadOnlyGetCapture> => {
    const url = new URL(path, base).href;
    const response = await fetcher(url, { method: 'GET', headers: { 'X-Admin-Key': input.adminKey }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    return { method: 'GET', url, httpStatus: response.status, body, bodySha256: sha256(body) };
  };
  const [stored, loaded, routing, health] = await Promise.all([
    get(`/admin/prompts/${encodeURIComponent(input.promptId)}`), get('/admin/prompts/verify'), get('/admin/models/routing'), get('/healthz'),
  ]);
  return { observedAt: new Date().toISOString(), environment: input.environment, instanceId: null, stored, loaded, routing, health };
}
