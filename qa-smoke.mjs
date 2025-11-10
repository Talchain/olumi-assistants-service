import assert from "node:assert";
const BASE_URL = process.env.BASE_URL ?? "https://olumi-assistants-service.onrender.com";
const RAW_KEY = process.env.ASSIST_API_KEY || "";
const MASKED = RAW_KEY ? `****…${RAW_KEY.slice(-6)}` : "(none)";

async function jget(path) {
  const r = await fetch(`${BASE_URL}${path}`, { method: "GET" });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function postJSON(path, body, headers = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function withAuth(path, body) {
  // Try X-Olumi-Assist-Key first, then Authorization bearer if needed
  let r = await postJSON(path, body, { "X-Olumi-Assist-Key": RAW_KEY });
  if (r.status === 401 || r.status === 403) {
    r = await postJSON(path, body, { Authorization: `Bearer ${RAW_KEY}` });
  }
  return r;
}

async function testA1() {
  const { status, json } = await jget("/healthz");
  assert.equal(status, 200, "healthz not 200");
  assert.equal(json.ok, true, "healthz.ok != true");
  assert.ok(String(json.version || "").startsWith("1.3.0"), "version mismatch");
  console.log("ACCEPT A1: /healthz 200 and version=1.3.0");
}

async function testA2() {
  const { status } = await postJSON("/assist/draft-graph", { brief: "test unauth" });
  assert.ok(status === 401 || status === 403, `expected 401/403, got ${status}`);
  console.log("ACCEPT A2: /assist/draft-graph unauthenticated → 401/403");
}

async function testA3() {
  if (!RAW_KEY) { console.log("SKIP A3: no ASSIST_API_KEY in env"); return; }
  const body = { brief: "Should we expand to international markets or focus on domestic growth for our SaaS platform?" };
  const { status, json } = await withAuth("/assist/draft-graph", body);
  if (status !== 200) {
    console.error("A3 error response:", JSON.stringify(json, null, 2));
  }
  assert.equal(status, 200, `expected 200, got ${status}`);
  const nodes = (json.graph?.nodes ?? []).length;
  const edges = (json.graph?.edges ?? []).length;
  assert.ok(nodes >= 3 && edges >= 2, `small graph expected, got nodes=${nodes}, edges=${edges}`);
  console.log("ACCEPT A3: /assist/draft-graph authenticated → 200 with small graph (≥3 nodes, ≥2 edges)");
}

async function testA4() {
  if (!RAW_KEY) { console.log("SKIP A4: no ASSIST_API_KEY in env"); return; }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 60000);
  const headers = { "content-type": "application/json", "X-Olumi-Assist-Key": RAW_KEY };
  let sawDrafting = false, sawComplete = false;

  try {
    const r = await fetch(`${BASE_URL}/assist/draft-graph/stream`, {
      method: "POST", headers, body: JSON.stringify({ brief: "Should we build our own data center or use cloud providers for our infrastructure?" }),
      signal: ctrl.signal
    });
    assert.equal(r.status, 200, `stream status ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value);
      if (chunk.includes("DRAFTING")) sawDrafting = true;
      if (chunk.includes("COMPLETE")) { sawComplete = true; break; }
    }
  } finally {
    clearTimeout(timeout);
  }
  assert.ok(sawDrafting && sawComplete, "did not see DRAFTING→COMPLETE");
  console.log("ACCEPT A4: /assist/draft-graph/stream emits DRAFTING→COMPLETE within 60s");
}

async function testA5() {
  const { json } = await jget("/healthz");
  const f = json.feature_flags || {};
  assert.equal(Boolean(f.grounding), true, "grounding flag false");
  assert.equal(Boolean(f.critique), true, "critique flag false");
  assert.equal(Boolean(f.clarifier), true, "clarifier flag false");
  console.log("ACCEPT A5: feature_flags grounding/critique/clarifier are true");
}

(async () => {
  console.log(`BASE_URL=${BASE_URL}  ASSIST_API_KEY=${MASKED}`);
  await testA1();
  await testA2();
  await testA3();
  await testA4();
  await testA5();
})().catch(e => { console.error("SMOKE FAILED:", e?.message || e); process.exit(1); });
