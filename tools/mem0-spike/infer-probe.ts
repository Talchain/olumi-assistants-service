/** Probe: how Mem0's own extraction (infer=true) behaves on a correction, and how long it takes to become searchable. */
import MemoryClient from 'mem0ai';

const client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY! });
const userId = 'olumi-poc-paul';
const runId = `mem0-spike-infer-probe-${Date.now()}`;
const filters = { AND: [{ user_id: userId }, { run_id: runId }] };

async function main(): Promise<void> {
  const say = async (content: string) => {
    const t = performance.now();
    const r = await client.add([{ role: 'user', content }], { userId, runId, infer: true, metadata: { scenario_id: runId, source: 'conversation' } });
    console.log(`add ${Math.round(performance.now() - t)}ms →`, JSON.stringify(r).slice(0, 300));
  };
  await say('Olumi asked: "What is your monthly churn?" — user: "Churn is around 9% a month, I think."');
  await say('User: "Sorry, I misread the dashboard. Monthly churn is 7% a month."');
  const t0 = performance.now();
  for (let i = 0; i < 40; i += 1) {
    const all = (await client.getAll({ filters })) as { results?: { memory?: string; createdAt?: string }[] };
    const n = all.results?.length ?? 0;
    if (n > 0) { console.log(`visible after ${Math.round(performance.now() - t0)}ms:`, JSON.stringify(all.results!.map((m) => m.memory))); if (i > 6) break; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const s = await client.search('What churn figure did I give you in the end?', { filters, topK: 5, rerank: true });
  console.log('search →', JSON.stringify((s as { results: { memory: string; score: number }[] }).results.map((m) => [m.memory, m.score])));
  console.log('deleteAll →', JSON.stringify(await client.deleteAll({ userId, runId })));
}
main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
