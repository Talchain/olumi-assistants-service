const RK = process.env.RK;
const svc = { 'cee-staging': 'srv-d4slpaili9vc73eiq4og', 'cee-production': 'srv-d46fp8q4d50c73b1dqqg', 'cee-demo': 'srv-d9hlamuq1p3s73a4g0i0' };
const want = ['CEE_V5_GRAPH_CAS_RPC', 'CEE_MODEL_VERSIONS_ENABLED', 'CEE_V5_GRAPH_CAS_MODE', 'SUPABASE_URL'];
const out = {};
for (const [name, id] of Object.entries(svc)) {
  let cursor = null, all = [], pages = 0;
  for (;;) {
    const u = `https://api.render.com/v1/services/${id}/env-vars?limit=100` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const r = await fetch(u, { headers: { Authorization: `Bearer ${RK}` } });
    const a = await r.json();
    if (!Array.isArray(a) || a.length === 0) break;
    all.push(...a); pages++;
    cursor = a[a.length - 1].cursor;
    if (a.length < 100) break;
    if (pages > 10) break;
  }
  const map = {};
  for (const e of all) if (want.includes(e.envVar.key)) map[e.envVar.key] = e.envVar.key === 'SUPABASE_URL' ? ('<ref ' + e.envVar.value.replace('https://','').split('.')[0].slice(0,4) + '… len ' + e.envVar.value.length + '>') : e.envVar.value;
  out[name] = { pages, total_env_vars: all.length, ...map };
}
console.log(JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
