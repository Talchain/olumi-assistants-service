/** Offline gate by default. --live performs only authenticated GETs; never promotes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

process.env.LOG_LEVEL = 'fatal';
const { buildContractManifest, root } = await import('../tools/prompt-consumer/manifest.js');
const { sha256 } = await import('../tools/prompt-consumer/contract.js');
type Runtime = Parameters<typeof buildContractManifest>[0];
const arg = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
let runtime: Runtime;
if (process.argv.includes('--live')) {
  assert(process.env.ADMIN_API_KEY, 'ADMIN_API_KEY required; never written to evidence');
  const url = arg('--base-url') ?? 'https://cee-staging.onrender.com';
  const get = async (path: string) => {
    const r = await fetch(url + path, { headers: { 'X-Admin-Key': process.env.ADMIN_API_KEY! }, signal: AbortSignal.timeout(30_000) });
    assert(r.ok, `${path}: HTTP ${r.status}`);
    return r.json();
  };
  const health = z.object({ build: z.string() }).parse(await get('/healthz'));
  const verify = z.object({ prompts: z.array(z.object({ prompt_id: z.string(), content_hash: z.string(), store_version: z.number().nullable(), loaded_at: z.string().nullable() })) }).parse(await get('/admin/prompts/verify'));
  const prompts = {} as NonNullable<Runtime>['prompts'];
  for (const task of ['draft_graph', 'validate_graph'] as const) {
    const stored = z.object({ id: z.string(), activeVersion: z.number(), stagingVersion: z.number().nullable().optional(), versions: z.array(z.object({ version: z.number(), content: z.string() })), modelConfig: z.object({ staging: z.string().optional() }).nullable().optional() }).parse(await get(`/admin/prompts/${task}_default`));
    const version = stored.stagingVersion ?? stored.activeVersion;
    const selected = stored.versions.find(v => v.version === version);
    const loaded = verify.prompts.find(p => p.prompt_id === stored.id);
    assert(selected && loaded && loaded.store_version === version, 'selected and loaded versions disagree');
    prompts[task] = { id: stored.id, version, content: selected.content, sha256: sha256(selected.content), configuredModel: stored.modelConfig?.staging ?? null, loadedAt: loaded.loaded_at, verifiedLoadedHash: loaded.content_hash };
  }
  const deployedHead = arg('--deployed-head') ?? execFileSync('git', ['ls-remote', 'origin', 'refs/heads/staging'], { cwd: root, encoding: 'utf8' }).split(/\s/)[0]!;
  runtime = { observedAt: new Date().toISOString(), deployedHead, healthBuild: health.build, prompts };
}
const manifest = buildContractManifest(runtime);
const text = JSON.stringify(manifest, null, 2) + '\n';
const out = arg('--out');
if (out) { assert(!existsSync(out), 'Evidence output already exists; choose a new path'); writeFileSync(out, text, { flag: 'wx' }); }
else process.stdout.write(text);
// Expected failing probes are still a failing compatibility gate, even if their
// regression tests correctly pass. Unknown coverage cannot claim completion.
process.exitCode = manifest.status === 'FAIL' ? 1 : manifest.liveClosure.startsWith('UNVERIFIED') ? 2 : 0;
