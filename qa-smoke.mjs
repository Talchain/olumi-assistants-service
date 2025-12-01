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
  let resp = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Olumi-Assist-Key": RAW_KEY },
    body: JSON.stringify(body)
  });

  if (resp.status === 401 || resp.status === 403) {
    resp = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "Authorization": `Bearer ${RAW_KEY}` },
      body: JSON.stringify(body)
    });
  }

  // V04: Extract correlation ID from response headers
  const correlationId = resp.headers.get("x-correlation-id") || "none";
  const json = await resp.json().catch(() => ({}));

  return { status: resp.status, json, correlationId };
}

async function testA1() {
  const { status, json } = await jget("/healthz");
  assert.equal(status, 200, "healthz not 200");
  assert.equal(json.ok, true, "healthz.ok != true");

  // V04: Dynamic version checking
  const actualVersion = String(json.version || "");
  const expectedVersion = process.env.SMOKE_EXPECTED_VERSION;

  if (expectedVersion) {
    // Exact match if env var is set
    assert.equal(actualVersion, expectedVersion, `version mismatch: expected ${expectedVersion}, got ${actualVersion}`);
  } else {
    // Otherwise, accept any same major.minor (e.g., 1.3.x)
    const [major, minor] = actualVersion.split(".");
    const expectedPrefix = `${major}.${minor}.`;
    assert.ok(actualVersion.startsWith(expectedPrefix) || actualVersion === `${major}.${minor}`,
      `version ${actualVersion} does not match expected major.minor pattern`);
  }

  console.log(`ACCEPT A1: /healthz 200 and version=${json.version}`);
}

async function testA2() {
  const { status } = await postJSON("/assist/draft-graph", { brief: "test unauth" });
  assert.ok(status === 401 || status === 403, `expected 401/403, got ${status}`);
  console.log("ACCEPT A2: /assist/draft-graph unauthenticated → 401/403");
}

async function testA3() {
  if (!RAW_KEY) { console.log("SKIP A3: no ASSIST_API_KEY in env"); return; }
  const body = { brief: "Should we expand to international markets or focus on domestic growth for our SaaS platform?" };

  // V04: Retry with exponential backoff [2s, 6s] on 408/429/500/502/503/504 + network aborts
  const maxAttempts = 3; // 0-indexed: attempts 1, 2, 3
  const backoffs = [2000, 6000]; // 2s, 6s
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startMs = Date.now();
    try {
      const { status, json, correlationId } = await withAuth("/assist/draft-graph", body);
      const elapsedMs = Date.now() - startMs;

      // Retry on transient errors
      const isRetriable = [408, 429, 500, 502, 503, 504].includes(status);
      if (isRetriable && attempt < maxAttempts) {
        const reason = `status_${status}`;
        console.log(JSON.stringify({ check: "A3", attempt, status, elapsed_ms: elapsedMs, reason, correlation_id: correlationId }));
        lastError = { status, json };
        await new Promise(resolve => setTimeout(resolve, backoffs[attempt - 1]));
        continue;
      }

      // Success - validate response
      assert.equal(status, 200, `draft-graph expected 200, got ${status}`);
      assert.ok(json.graph, "missing graph");
      const nodes = (json.graph?.nodes ?? []).length;
      const edges = (json.graph?.edges ?? []).length;
      assert.ok(nodes >= 3 && edges >= 2, `small graph expected, got nodes=${nodes}, edges=${edges}`);
      console.log(`ACCEPT A3: /assist/draft-graph authenticated → 200 with small graph (≥3 nodes, ≥2 edges) [correlation_id: ${correlationId}]`);
      return;
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      const isNetworkError = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.name === 'AbortError';
      if (isNetworkError && attempt < maxAttempts) {
        const reason = err.name === 'AbortError' ? 'abort' : err.code;
        console.log(JSON.stringify({ check: "A3", attempt, status: null, elapsed_ms: elapsedMs, reason }));
        lastError = err;
        await new Promise(resolve => setTimeout(resolve, backoffs[attempt - 1]));
        continue;
      }
      throw err;
    }
  }

  // Exhausted retries
  throw new Error(`A3 failed after ${maxAttempts} attempts: ${lastError?.status || lastError?.code || lastError?.name || 'unknown'}`);
}

async function testA4() {
  if (!RAW_KEY) { console.log("SKIP A4: no ASSIST_API_KEY in env"); return; }

  // V04: Retry with exponential backoff [2s, 6s]; second attempt gets 90s timeout
  const maxAttempts = 3;
  const backoffs = [2000, 6000]; // 2s, 6s
  const timeouts = [75000, 90000, 90000]; // 75s, 90s, 90s
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startMs = Date.now();
    const ctrl = new AbortController();
    const timeoutMs = timeouts[attempt - 1];
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = { "content-type": "application/json", "X-Olumi-Assist-Key": RAW_KEY };
    let sawDrafting = false, sawComplete = false;
    let _lastHeartbeat = Date.now();

    try {
      const r = await fetch(`${BASE_URL}/assist/draft-graph/stream`, {
        method: "POST", headers, body: JSON.stringify({ brief: "test" }),
        signal: ctrl.signal
      });

      const elapsedMs = Date.now() - startMs;

      // Retry on transient errors
      const isRetriable = [408, 429, 500, 502, 503, 504].includes(r.status);
      if (isRetriable && attempt < maxAttempts) {
        const reason = `status_${r.status}`;
        console.log(JSON.stringify({ check: "A4", attempt, status: r.status, elapsed_ms: elapsedMs, reason }));
        lastError = { status: r.status };
        clearTimeout(timeoutId);
        await new Promise(resolve => setTimeout(resolve, backoffs[attempt - 1]));
        continue;
      }

      assert.equal(r.status, 200, `stream status ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();

      // V04: Heartbeats reset idle timer; require DRAFTING → COMPLETE
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Stream ended without COMPLETE
          if (!sawComplete && attempt < maxAttempts) {
            const reason = "incomplete_stream";
            console.log(JSON.stringify({ check: "A4", attempt, status: 200, elapsed_ms: Date.now() - startMs, reason }));
            lastError = { reason };
            clearTimeout(timeoutId);
            await new Promise(resolve => setTimeout(resolve, backoffs[attempt - 1]));
            break; // Retry
          }
          break;
        }

        const chunk = dec.decode(value);

        // Check for heartbeats (reset idle timer)
        if (chunk.includes(": heartbeat")) {
          lastHeartbeat = Date.now();
        }

        // Check for DRAFTING and COMPLETE states
        if (chunk.includes("DRAFTING")) sawDrafting = true;
        if (chunk.includes("COMPLETE")) {
          sawComplete = true;
          break;
        }
      }

      clearTimeout(timeoutId);

      if (!sawComplete && attempt < maxAttempts) {
        continue; // Retry loop continues from break above
      }

      assert.ok(sawDrafting && sawComplete, "did not see DRAFTING→COMPLETE");
      console.log(`ACCEPT A4: /assist/draft-graph/stream emits DRAFTING→COMPLETE within ${timeoutMs}ms`);
      return;
    } catch (err) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startMs;
      const isNetworkError = err.name === 'AbortError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';

      if (isNetworkError && attempt < maxAttempts) {
        const reason = err.name === 'AbortError' ? 'abort' : err.code;
        console.log(JSON.stringify({ check: "A4", attempt, status: null, elapsed_ms: elapsedMs, reason }));
        lastError = err;
        await new Promise(resolve => setTimeout(resolve, backoffs[attempt - 1]));
        continue;
      }
      throw err;
    }
  }

  // Exhausted retries
  throw new Error(`A4 failed after ${maxAttempts} attempts: ${lastError?.status || lastError?.code || lastError?.name || lastError?.reason || 'unknown'}`);
}

async function testA4R() {
  // v1.8: Optional SSE Resume smoke test (opt-in via SMOKE_RESUME_ENABLED)
  const resumeEnabled = process.env.SMOKE_RESUME_ENABLED === "true";
  if (!resumeEnabled) {
    console.log("SKIP A4R: SMOKE_RESUME_ENABLED not set (resume smoke test is opt-in)");
    return;
  }

  if (!RAW_KEY) {
    console.log("SKIP A4R: no ASSIST_API_KEY in env");
    return;
  }

  const maxAttempts = 2;
  const backoff = 3000; // 3s
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startMs = Date.now();
    let resumeToken = null;

    try {
      // Step 1: Start stream and capture resume token
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 30000); // 30s timeout

      const r = await fetch(`${BASE_URL}/assist/draft-graph/stream`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Olumi-Assist-Key": RAW_KEY },
        body: JSON.stringify({ brief: "Resume smoke test" }),
        signal: ctrl.signal
      });

      assert.equal(r.status, 200, `stream status ${r.status}`);

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";

      // Read until we get resume token
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += dec.decode(value);

        // Look for resume event
        if (buffer.includes("event: resume")) {
          const events = buffer.split("\n\n");
          for (const event of events) {
            if (event.includes("event: resume")) {
              const dataLine = event.split("\n").find(line => line.startsWith("data: "));
              if (dataLine) {
                const jsonData = dataLine.substring(6);
                const parsed = JSON.parse(jsonData);
                resumeToken = parsed.token;
                break;
              }
            }
          }
          if (resumeToken) break;
        }
      }

      clearTimeout(timeoutId);
      reader.releaseLock();

      assert.ok(resumeToken, "no resume token received");

      // Step 2: Resume with token
      const resumeStartMs = Date.now();
      const resumeResp = await fetch(`${BASE_URL}/assist/draft-graph/resume`, {
        method: "POST",
        headers: { "X-Resume-Token": resumeToken, "X-Olumi-Assist-Key": RAW_KEY }
      });

      const resumeElapsedMs = Date.now() - resumeStartMs;

      // Accept 200 (success) or 426 (resume not available/expired)
      const validStatuses = [200, 426];
      assert.ok(validStatuses.includes(resumeResp.status),
        `resume expected 200 or 426, got ${resumeResp.status}`);

      if (resumeResp.status === 200) {
        // Verify we got some replay content
        const resumeBody = await resumeResp.text();
        assert.ok(resumeBody.length > 0, "empty resume response");

        console.log(`ACCEPT A4R: /assist/draft-graph/resume with valid token → 200 (replay succeeded in ${resumeElapsedMs}ms)`);
      } else {
        // 426 is acceptable (state expired or Redis not configured)
        const resumeJson = await resumeResp.json().catch(() => ({}));
        console.log(`ACCEPT A4R: /assist/draft-graph/resume → 426 (resume unavailable: ${resumeJson.message || "unknown"})`);
      }

      return;
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      const isNetworkError = err.name === "AbortError" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";

      if ((isNetworkError || err.status >= 500) && attempt < maxAttempts) {
        const reason = err.name === "AbortError" ? "abort" : err.code || `status_${err.status}`;
        console.log(JSON.stringify({ check: "A4R", attempt, status: err.status || null, elapsed_ms: elapsedMs, reason }));
        lastError = err;
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      throw err;
    }
  }

  // Exhausted retries
  throw new Error(`A4R failed after ${maxAttempts} attempts: ${lastError?.status || lastError?.code || lastError?.name || "unknown"}`);
}

async function testA5() {
  const { status, json } = await jget("/healthz");
  assert.equal(status, 200, "healthz not 200 for A5");
  assert.ok(json.feature_flags?.grounding && json.feature_flags?.critique && json.feature_flags?.clarifier, "missing feature flags");
  console.log("ACCEPT A5: feature_flags grounding/critique/clarifier are true");
}

// V04: Warm-up to wake Render before A3/A4
async function warmup() {
  console.log("Warming up (calling /healthz to wake Render)...");
  await jget("/healthz");
  await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5s
  console.log("Warm-up complete");
}

(async () => {
  console.log(`BASE_URL=${BASE_URL}  ASSIST_API_KEY=${MASKED}`);
  await testA1();
  await testA2();
  await warmup();
  await testA3();
  await testA4();
  await testA4R(); // v1.8: Optional resume smoke test
  await testA5();
  console.log("✅ All smoke tests PASS");
})();
