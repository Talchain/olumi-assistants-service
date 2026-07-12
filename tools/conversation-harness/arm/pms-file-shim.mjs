// Boot CEE with a FILE prompt store while sessions still hit staging Supabase.
// Config parses process.env once at import (src/config/index.ts); the prompt-store
// factory auto-selects Supabase when SUPABASE_* exist in parsed config
// (src/prompts/store.ts:108-133). The session store re-reads env per call
// (src/orchestrator-v5/session/index.ts:77-84). So: hide the two vars during
// import, restore before listen. No repo change, no PMS write.
const SERVER = process.env.CEE_SERVER_TS ?? '/tmp/cee-ab-run/src/server.ts';
const HELD = {};
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  HELD[k] = process.env[k];
  delete process.env[k];
}
const mod = await import(`file://${SERVER}`); // config freezes without Supabase creds
for (const [k, v] of Object.entries(HELD)) if (v !== undefined) process.env[k] = v;
const app = await mod.build();
await app.listen({ port: Number(process.env.PORT ?? 3101), host: '0.0.0.0' });
console.log(`[shim] file-PMS boot complete on ${process.env.PORT ?? 3101}, store=${process.env.PROMPTS_STORE_PATH}`);
