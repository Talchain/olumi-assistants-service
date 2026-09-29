# PR: Assistants Proxy v1.0.1 - RFC-Compliant SSE + Version Centralization

## Summary

This PR finalizes the Assistants proxy release (v1.0.1) with:
1. **RFC 8895-compliant SSE streaming** - Multi-line JSON payloads correctly formatted
2. **JSON/SSE guard parity** - Identical validation (caps, payload size) across both endpoints
3. **Version centralization** - Single source of truth (package.json → 1.0.1) across all endpoints
4. **Telemetry fallbacks** - Provider + cost_usd always present with safe defaults
5. **v04 SSOT conformance** - Full compliance verified (see `docs/v04-ssot-audit.md`)

## Changes

### 1. SSE Multi-line Payload Handling (RFC 8895)
**File**: `src/routes/assist.draft-graph.ts:373-386`

**Before** (Non-compliant):
```typescript
// ❌ Single-line JSON breaks on newlines in SSE spec
reply.raw.write(`data: ${JSON.stringify(stateUpdate)}\n\n`);
```

**After** (RFC 8895 compliant):
```typescript
// ✅ Each line prefixed with "data: " per RFC 8895
const dataLines = JSON.stringify(stateUpdate, null, 2).split('\n');
for (const line of dataLines) {
  reply.raw.write(`data: ${line}\n`);
}
reply.raw.write('\n'); // End of event marker
```

**Why**: SSE spec requires each line of multi-line data to be prefixed with `data: `. Single-line payloads break when JSON contains internal newlines (e.g., formatted output).

### 2. JSON/SSE Guard Parity
**Files**:
- `src/routes/assist.draft-graph.ts` (JSON handler)
- `src/routes/assist.draft-graph.ts` (SSE handler)

**Enforcement**:
- ✅ Node cap: ≤12 nodes (enforced in LLM adapters)
- ✅ Edge cap: ≤24 edges (enforced in LLM adapters)
- ✅ Payload cap: ≤1MB (Fastify body parser)
- ✅ Same validation logic for both JSON and SSE routes

**Test Coverage**: `tests/assist/proxy.sse.parity.test.ts` verifies identical behavior.

### 3. Version Centralization (1.0.1)
**Files**:
- `package.json` - Source of truth
- Engine repo: `plot-lite-service/package.json`, `src/version.ts`, `contracts/snapshots/report.v1.example.json`

**Implementation**:
```typescript
// src/version.ts (engine repo)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const SERVICE_VERSION =
  process.env.SERVICE_VERSION ??
  ((): string => {
    try {
      const pkgPath = join(__dirname, '../package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  })();
```

**Endpoints reporting 1.0.1**:
- `/version`
- `/v1/version`
- `/v1/health`
- Model metadata: `meta.version` in `/v1/run`, `/v1/self-check`

### 4. Telemetry Fallbacks
**File**: `src/utils/telemetry.ts`

**Provider tracking**:
```typescript
draft_source: String(data.draft_source || "unknown"),  // Fallback to "unknown"
```

**Cost tracking**:
```typescript
export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  // ... pricing lookup ...

  // Fixtures or unknown model - return 0
  if (model !== 'fixture-v1') {
    log.warn({ model }, "Unknown model for cost calculation");
  }
  return 0;  // Safe fallback
}
```

**Always present**:
- `provider` (via `draft_source` / `repair_source`)
- `cost_usd` (0 for fixtures/unknown models)

## v04 SSOT Compliance ✅

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Node cap ≤12 | ✅ PASS | `anthropic.ts:265`, `openai.ts:258` |
| Edge cap ≤24 | ✅ PASS | `anthropic.ts:270`, `openai.ts:263` |
| Payload cap ≤1MB | ✅ PASS | Fastify body parser |
| SSE RFC 8895 | ✅ PASS | `assist.draft-graph.ts:373-386` |
| Provider tracking | ✅ PASS | `telemetry.ts:164`, fallback "unknown" |
| Cost tracking | ✅ PASS | `telemetry.ts:186`, fallback 0 |
| Version 1.0.1 | ✅ PASS | `package.json`, all endpoints |
| JSON/SSE parity | ✅ PASS | `tests/assist/proxy.sse.parity.test.ts` |

**Full audit**: See [`docs/v04-ssot-audit.md`](./v04-ssot-audit.md)

## Testing

### Unit & Integration Tests
```bash
# Assistants repo
pnpm test

# Engine repo
cd ../plot-lite-service
npm test
```

### JSON/SSE Parity Tests
```bash
# Specific parity test suite
pnpm test tests/assist/proxy.sse.parity.test.ts
```

**Expected**: All parity tests green (node caps, edge caps, payload caps, response structure).

### Version Tests
```bash
# Engine repo
npm test tests/v1-routes.test.ts

# Check version endpoint
node -e "import('./dist/version.js').then(m => console.log('VERSION:', m.SERVICE_VERSION))"
# Expected: VERSION: 1.0.1
```

## Post-Merge Smoke Tests

### 5-Minute Operator Checklist

After deploying to staging/production, run these commands:

#### 1. Health & Version Checks
```bash
# Health check
curl -s https://api.olumi.app/health | jq '.status, .version'
# Expected: "ok", "1.0.1"

# Version endpoint
curl -s https://api.olumi.app/version | jq '.version, .api'
# Expected: "1.0.1", "olumi-assistants/v1"

# Engine health (if directly accessible)
curl -s https://engine.olumi.app/v1/health | jq '.status, .api_version'
# Expected: "ok", "v1"

# Engine version
curl -s https://engine.olumi.app/v1/version | jq '.version, .api'
# Expected: "1.0.1", "plot-engine/v1"
```

#### 2. JSON Draft Call
```bash
# Draft graph via JSON
curl -X POST https://api.olumi.app/assist/draft-graph \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "brief": "Optimize subscription pricing",
    "domain": "pricing",
    "constraints": []
  }' | jq '.boards[0].graph | {nodes: .nodes | length, edges: .edges | length}'
# Expected: {"nodes": <number ≤12>, "edges": <number ≤24>}
```

#### 3. SSE Draft Call
```bash
# Draft graph via SSE
curl -X POST https://api.olumi.app/assist/draft-graph \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "brief": "Optimize subscription pricing",
    "domain": "pricing",
    "constraints": []
  }' --no-buffer
# Expected: SSE stream with multi-line data: prefixes
# Look for: data: {
#          data:   "state": "DRAFTING"
#          data: }
```

#### 4. Caps Enforcement
```bash
# Attempt to trigger node cap (should return valid graph capped at 12 nodes)
curl -X POST https://api.olumi.app/assist/draft-graph \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "brief": "Complex workflow with many steps and decision points",
    "domain": "operations",
    "constraints": []
  }' | jq '.boards[0].graph.nodes | length'
# Expected: ≤12
```

#### 5. Telemetry Check (if Datadog/logs accessible)
```bash
# Check recent telemetry events contain provider + cost_usd
# Via logs:
kubectl logs -l app=olumi-assistants --tail=50 | grep "assist.draft.completed" | jq '.draft_source, .cost_usd'
# Expected: "anthropic" (or "openai"), <number>
```

### Success Criteria
- ✅ All health checks return 200 with version "1.0.1"
- ✅ JSON draft returns valid graph with ≤12 nodes, ≤24 edges
- ✅ SSE draft streams with RFC 8895 multi-line formatting
- ✅ Caps enforced (no graphs exceeding 12 nodes or 24 edges)
- ✅ Telemetry events include provider + cost_usd

## Rollback Plan

If issues arise post-deploy:

```bash
# Revert to previous release
git revert HEAD
git push origin main

# Or roll back via deployment platform
# Render: Click "Manual Deploy" → select previous commit
# K8s: kubectl rollout undo deployment/olumi-assistants
```

## Performance Baseline (Optional)

Run performance test to establish baseline:

```bash
# Engine repo (if Artillery configured)
cd ../plot-lite-service
npm run loadcheck

# Or manual load test
ab -n 100 -c 10 -T application/json -p payload.json \
  https://api.olumi.app/assist/draft-graph
```

**Baseline targets**:
- p50 latency: <2s
- p95 latency: <5s
- Error rate: <1%

## Migration Notes

### Breaking Changes
None - this is a non-breaking enhancement.

### Deprecations
None.

### Configuration Changes
None required. Version is read automatically from package.json.

## Reviewer Checklist

- [ ] v04 SSOT audit reviewed (`docs/v04-ssot-audit.md`)
- [ ] SSE RFC 8895 compliance verified (multi-line data: prefix)
- [ ] JSON/SSE parity tests green
- [ ] Version 1.0.1 in all endpoints
- [ ] Telemetry includes provider + cost_usd with fallbacks
- [ ] Smoke test commands validated
- [ ] No security concerns (no hardcoded secrets, proper error handling)

## Related PRs

- Engine repo PR: `feat/templates-v1.2-clean` → `main` (version centralization)

## References

- v04 SSOT Specification: [Olumi "Draft My Model" Product & Technical Spec]
- RFC 8895: [Server-Sent Events](https://www.rfc-editor.org/rfc/rfc8895.html)
- Version centralization commit: `3c86766` (engine repo)

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
