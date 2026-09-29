/**
 * Mem0 connectivity smoke: ping → add (infer=false, verbatim) → poll until indexed → search (rerank off/on) → deleteAll.
 * Run: set -a; . /root/.config/olumi-mem0.env; set +a; MEM0_TELEMETRY=false pnpm exec tsx tools/mem0-spike/smoke.ts
 * Never prints the key.
 */
import MemoryClient from 'mem0ai';

const apiKey = process.env.MEM0_API_KEY;
if (!apiKey) { console.error('MEM0_API_KEY not set'); process.exit(2); }

const client = new MemoryClient({ apiKey });
const userId = 'olumi-poc-paul';
const runId = `mem0-spike-smoke-${Date.now()}`;
const ms = (t0: number) => Math.round(performance.now() - t0);

async function main(): Promise<void> {
  let t = performance.now();
  await client.ping();
  console.log(`ping ok ${ms(t)}ms`);

  t = performance.now();
  const added = await client.add(
    [{ role: 'user', content: 'Olumi asked: "How strongly does price affect churn?" — user: "It is a moderate effect."' }],
    { userId, runId, infer: false, metadata: { scenario_id: runId, turn_id: 't1', source: 'conversation', role: 'user', branch: 'exp/mem0-context-spike-20260929' } },
  );
  console.log(`add ${ms(t)}ms →`, JSON.stringify(added).slice(0, 400));

  const filters = { AND: [{ user_id: userId }, { run_id: runId }] };
  t = performance.now();
  let indexedAfter = -1;
  for (let i = 0; i < 60; i += 1) {
    const all = await client.getAll({ filters });
    if ((all as { results?: unknown[] }).results?.length ?? (Array.isArray(all) ? (all as unknown[]).length : 0)) { indexedAfter = ms(t); console.log('getAll →', JSON.stringify(all).slice(0, 600)); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`indexed after ${indexedAfter}ms`);

  for (const rerank of [false, true]) {
    const lat: number[] = [];
    let last: unknown;
    for (let i = 0; i < 5; i += 1) {
      t = performance.now();
      last = await client.search('what did the user say about price and churn?', { filters, topK: 5, rerank });
      lat.push(ms(t));
    }
    lat.sort((a, b) => a - b);
    console.log(`search rerank=${rerank} latencies ${lat.join(',')}ms →`, JSON.stringify(last).slice(0, 500));
  }

  // Isolation: a different run_id must see nothing.
  const other = await client.search('price churn moderate', { filters: { AND: [{ user_id: userId }, { run_id: `${runId}-other` }] }, topK: 5 });
  console.log('other-scenario search →', JSON.stringify(other).slice(0, 200));

  t = performance.now();
  console.log('deleteAll →', JSON.stringify(await client.deleteAll({ userId, runId })), `${ms(t)}ms`);
}

main().catch((err) => { console.error('smoke failed:', String(err).slice(0, 500)); process.exit(1); });
