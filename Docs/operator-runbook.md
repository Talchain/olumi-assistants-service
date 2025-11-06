# Operator Runbook - Olumi Assistants Service v1.1.0

**Service:** olumi-assistants-service
**Version:** 1.1.0
**Endpoints:** `/assist/clarify-brief`, `/assist/critique-graph`, `/assist/draft-graph` (JSON + SSE), `/assist/suggest-options`, `/assist/explain-diff`

**New in v1.1.0:** Document grounding, feature flags, enhanced health endpoint

---

## Quick Reference

| Endpoint | Method | Timeout | Max Body | Purpose |
|----------|--------|---------|----------|---------|
| `/healthz` | GET | 1s | - | Health check |
| `/assist/clarify-brief` | POST | 15s | 1 MB | Generate clarifying questions |
| `/assist/critique-graph` | POST | 15s | 1 MB | Identify graph issues |
| `/assist/draft-graph` | POST | 15s | 1 MB | Draft initial graph (JSON) |
| `/assist/draft-graph/stream` | POST | 120s | 1 MB | Draft initial graph (SSE) |
| `/assist/suggest-options` | POST | 15s | 1 MB | Generate 3-5 strategic options |
| `/assist/explain-diff` | POST | 15s | 1 MB | Explain patch rationales |

---

## Feature Flags (v1.1.0+)

### Overview
Feature flags control optional capabilities with priority: **Per-Request > Environment > Default**

### Flags Matrix

| Flag | Env Var | Default | Purpose | Risk Level |
|------|---------|---------|---------|------------|
| `grounding` | `ENABLE_GROUNDING` | **false** | Document attachment processing | MEDIUM |
| `critique` | `ENABLE_CRITIQUE` | true | Graph critique endpoint | LOW |
| `clarifier` | `ENABLE_CLARIFIER` | true | Clarifying questions in drafts | LOW |

### Checking Current Flags
```bash
curl -s https://YOUR-SERVICE-URL/healthz | jq '.feature_flags'
```

**Expected Output:**
```json
{
  "grounding": false,
  "critique": true,
  "clarifier": true
}
```

### Enabling Grounding (Production)
**⚠️ IMPORTANT:** Grounding defaults to OFF for safety. Enable explicitly:

```bash
# In Render dashboard, add environment variable:
ENABLE_GROUNDING=true

# Restart service and verify:
curl -s https://YOUR-SERVICE-URL/healthz | jq '.feature_flags.grounding'
# Should return: true
```

### Per-Request Override
Flags can be overridden per-request via `flags` field:

```bash
# Enable grounding for this request only
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "...",
    "flags": {"grounding": true}
  }'

# Disable grounding for this request (even if env enabled)
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "...",
    "flags": {"grounding": false}
  }'
```

### Troubleshooting Flags

| Issue | Cause | Solution |
|-------|-------|----------|
| Attachments ignored | `ENABLE_GROUNDING=false` (default) | Set `ENABLE_GROUNDING=true` in env |
| Grounding always on | Env var set to `true` | Remove env var or set to `false` |
| Per-request flag ignored | Typo in request body | Verify `flags` field spelling |

---

## Health Check

### Command
```bash
curl -s https://YOUR-SERVICE-URL/healthz | jq .
```

### Expected Response (Good)
```json
{
  "ok": true,
  "service": "assistants",
  "version": "1.1.0",
  "provider": "fixtures",
  "model": "fixture-v1",
  "limits_source": "config",
  "feature_flags": {
    "grounding": false,
    "critique": true,
    "clarifier": true
  }
}
```

### Troubleshooting
- **No response:** Service is down, check Render logs
- **status: "degraded":** LLM provider timeout or error
- **Wrong version:** Deployment failed, check build logs

---

## Clarifier - Generate Questions

### Purpose
Given a user brief, generate 2-5 clarifying questions with:
- MCQ questions appear first (deterministic ordering)
- Stop when confidence ≥ 0.8
- Max 3 rounds (round 0, 1, 2)

### Command (Round 0)
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/clarify-brief \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Should I invest in renewable energy stocks for long-term growth?",
    "round": 0
  }' | jq .
```

### Expected Response (Good)
```json
{
  "questions": [
    {
      "question": "What is your investment timeline?",
      "why_we_ask": "Understanding your time horizon helps...",
      "impacts_draft": "A longer timeline allows...",
      "choices": ["1-2 years", "3-5 years", "5-10 years", "10+ years"]
    }
  ],
  "confidence": 0.3,
  "should_continue": true,
  "round": 0
}
```

### Command (Round 1 with Previous Answers)
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/clarify-brief \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Should I invest in renewable energy stocks?",
    "round": 1,
    "previous_answers": [
      {"question": "What is your investment timeline?", "answer": "5-10 years"}
    ]
  }' | jq .
```

### Expected Behavior
- **MCQ-first:** Questions with `choices` appear before open-ended
- **Stop rule:** If `confidence >= 0.8`, then `should_continue = false`
- **Round limit:** Rejects `round > 2` with 400 BAD_INPUT

### Error Cases

**400 BAD_INPUT - Provider Not Supported**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "not_supported",
  "details": {
    "hint": "Use LLM_PROVIDER=anthropic or fixtures"
  }
}
```
**Action:** Check `LLM_PROVIDER` env var, ensure it's `anthropic` or `fixtures`

**400 BAD_INPUT - Brief Too Short**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "String must contain at least 30 character(s)"
}
```
**Action:** Brief must be ≥30 chars

**400 BAD_INPUT - Round Out of Range**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Number must be less than or equal to 2"
}
```
**Action:** Use `round` in range [0, 2]

---

## Critique - Identify Graph Issues

### Purpose
Analyze a PLoT graph and return issues sorted by severity:
1. BLOCKER (critical structural issues)
2. IMPROVEMENT (optimization suggestions)
3. OBSERVATION (minor notes)

### Command
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/critique-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "graph": {
      "version": "1",
      "default_seed": 42,
      "nodes": [
        {"id": "goal_1", "kind": "goal", "label": "Increase revenue"},
        {"id": "dec_1", "kind": "decision", "label": "Pricing strategy"}
      ],
      "edges": [
        {"from": "goal_1", "to": "dec_1"}
      ]
    }
  }' | jq .
```

### Expected Response (Good)
```json
{
  "issues": [
    {
      "level": "BLOCKER",
      "note": "Decision 'dec_1' has no outgoing edges (no options)"
    },
    {
      "level": "IMPROVEMENT",
      "note": "Consider adding more specific metrics to goal"
    }
  ],
  "suggested_fixes": [
    "Add at least 2 options as children of decision nodes"
  ],
  "overall_quality": "fair"
}
```

### Expected Behavior
- **Deterministic ordering:** BLOCKER → IMPROVEMENT → OBSERVATION → alphabetical by note
- **Non-mutating:** Response never includes modified graph
- **Focus areas:** Optional `focus_areas` filter: `["structure", "completeness", "feasibility", "provenance"]`

### Error Cases

**400 BAD_INPUT - Provider Not Supported**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "not_supported",
  "details": {
    "hint": "Use LLM_PROVIDER=anthropic or fixtures"
  }
}
```
**Action:** Check `LLM_PROVIDER` env var

**400 BAD_INPUT - Missing Graph**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Required"
}
```
**Action:** Ensure `graph` field is present

---

## Draft Graph (JSON)

### Command
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Should I hire employees or use contractors for my startup?"
  }' | jq .
```

### Expected Response (Good)
```json
{
  "graph": {
    "version": "1",
    "default_seed": 42,
    "nodes": [
      {"id": "goal_1", "kind": "goal", "label": "Optimize hiring strategy"},
      {"id": "dec_1", "kind": "decision", "label": "Employment model"}
    ],
    "edges": [{"from": "goal_1", "to": "dec_1"}]
  }
}
```

---

## Draft Graph (SSE Stream)

### Command
```bash
curl -N -X POST https://YOUR-SERVICE-URL/assist/draft-graph/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Should I hire employees or use contractors?"
  }'
```

### Expected Response (Good - RFC 8895 SSE)
```
event: chunk
data: {"node": {"id": "goal_1", "kind": "goal", "label": "Optimize hiring"}}

event: chunk
data: {"edge": {"from": "goal_1", "to": "dec_1"}}

event: done
data: {}

```

### Expected Behavior
- **RFC 8895 framing:** Multi-line data with blank line terminators
- **Timeout:** 120s max (SSE_MAX_MS)
- **Parity:** Same validation guards as JSON endpoint

---

## Suggest Options - Strategic Alternatives

### Purpose
Given a goal, generate 3-5 distinct strategic options with:
- **Deterministic ordering:** Options sorted by `id` alphabetically
- **Structured output:** Each option has title, pros, cons, evidence_to_gather
- **Avoid duplicates:** Optional `existing_options` to prevent repeats

### Command
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/suggest-options \
  -H 'Content-Type: application/json' \
  -d '{
    "goal": "Optimize hiring strategy for my startup"
  }' | jq .
```

### Expected Response (Good)
```json
{
  "options": [
    {
      "id": "opt_a",
      "title": "Full-time employees",
      "pros": ["Long-term commitment", "Team cohesion"],
      "cons": ["Higher fixed costs", "Slower to scale"],
      "evidence_to_gather": ["Average salary benchmarks", "Turnover rates"]
    },
    {
      "id": "opt_b",
      "title": "Contract workers",
      "pros": ["Flexibility", "Lower overhead"],
      "cons": ["Less loyalty", "Coordination overhead"],
      "evidence_to_gather": ["Contractor availability", "Hourly rates"]
    },
    {
      "id": "opt_c",
      "title": "Hybrid approach",
      "pros": ["Balanced risk", "Adaptable"],
      "cons": ["Complex management", "Mixed incentives"],
      "evidence_to_gather": ["Industry best practices", "Case studies"]
    }
  ]
}
```

### Expected Behavior
- **Count:** Returns 3-5 options
- **Deterministic sorting:** Options sorted by `id` alphabetically
- **Required fields:** Each option has `id`, `title`, `pros`, `cons`, `evidence_to_gather`

### Error Cases

**400 BAD_INPUT - Goal Too Short**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "String must contain at least 30 character(s)"
}
```
**Action:** Ensure `goal` is at least 30 characters

**400 BAD_INPUT - Missing Goal**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Required"
}
```
**Action:** Ensure `goal` field is present

---

## Explain Diff - Patch Rationales

### Purpose
Given a graph patch (adds/updates/removes), explain why each change was made:
- **Rationales:** One per changed element (node/edge)
- **Concise:** Each `why` is ≤280 characters
- **Deterministic ordering:** Sorted by `target` alphabetically

### Command
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/explain-diff \
  -H 'Content-Type: application/json' \
  -d '{
    "patch": {
      "adds": {
        "nodes": [
          {"id": "goal_1", "kind": "goal", "label": "Increase revenue"}
        ],
        "edges": []
      },
      "updates": [],
      "removes": []
    }
  }' | jq .
```

### Expected Response (Good)
```json
{
  "rationales": [
    {
      "target": "goal_1",
      "why": "Added goal to represent the primary objective of increasing revenue",
      "provenance_source": "user_brief"
    }
  ]
}
```

### Expected Behavior
- **Count:** At least 1 rationale per change
- **Deterministic sorting:** Sorted by `target` alphabetically
- **Concise:** Each `why` is ≤280 characters
- **Optional provenance:** `provenance_source` indicates where the change came from

### Error Cases

**400 BAD_INPUT - Empty Patch**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "patch has no changes to explain"
}
```
**Action:** Ensure patch has at least one add, update, or remove

**400 BAD_INPUT - Missing Patch**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Required"
}
```
**Action:** Ensure `patch` field is present

---

## Rollback Procedures

### Quick Rollback (Render Dashboard)
1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select `olumi-assistants-service`
3. **Events** tab → Find last good deployment
4. Click **"Redeploy"**

### Git Revert (If Merged to Main)
```bash
cd /path/to/olumi-assistants-service
git checkout main
git pull
git revert <merge-commit-sha>
git push origin main
```

Render will auto-deploy the reverted commit.

### Emergency Pause
```bash
# In Render Dashboard
Settings → Auto-Deploy → OFF
```

---

## Monitoring & Alerts

### Key Metrics to Monitor
- **Health check failures:** More than 2 consecutive failures
- **Response time p95:** Target <8s for draft, <5s for clarify/critique
- **Error rate:** >5% 5xx responses
- **Cost per call:** Target <$0.01 per draft, <$0.003 per clarify/critique

### Log Queries (Render Dashboard)

**Find 5xx errors:**
```
"statusCode":5
```

**Find capability errors:**
```
"not_supported"
```

**Find high-cost calls:**
```
"cost_usd" AND NOT "0.00"
```

---

## Common Issues & Solutions

### Issue: All Requests Return 400 BAD_INPUT with "not_supported"
**Cause:** LLM_PROVIDER is not `anthropic` or `fixtures`
**Solution:** Update env var `LLM_PROVIDER=fixtures` (safe default) or `LLM_PROVIDER=anthropic`

### Issue: Service Returns 503 Temporarily Unavailable
**Cause:** Cold start (Render free/starter tier)
**Solution:** Wait 10-20s for service to warm up, then retry

### Issue: High Costs
**Cause:** Using Anthropic without proper limits
**Solution:** Check `COST_MAX_USD=1.00` is set, monitor logs for `cost_usd` telemetry

### Issue: Slow Response Times (>10s)
**Cause:** LLM provider latency
**Solution:** Check provider status, consider increasing `ASSISTANTS_TIMEOUT_MS` or switching to fixtures for testing

---

## Contact & Escalation

- **Service logs:** Render Dashboard → olumi-assistants-service → Logs
- **Health status:** `GET /healthz`
- **Emergency:** Suspend service via Render Dashboard

---

**Last Updated:** 2025-11-05
**Version:** 1.0.1
