# SSE Resilience II Roadmap

**Status:** Deferred to v1.8+
**Complexity:** High - Requires significant streaming architecture changes

---

## Overview

SSE Resilience II aims to improve stream reliability through heartbeat-based idle timer resets, single-attempt resumption on early aborts, and graceful fallback to non-streaming mode.

## Current State (v1.7)

**Implemented:**
- ✅ SSE heartbeats every 10 seconds to prevent proxy timeouts
- ✅ SSE end state tracking (complete/timeout/error/aborted)
- ✅ Comprehensive telemetry for stream lifecycle
- ✅ Fixture fallback for slow drafts (> 2.5s)

**Gaps:**
- ❌ Heartbeats don't reset upstream idle timers (Undici layer)
- ❌ No resumption mechanism for early client disconnects
- ❌ No non-streaming fallback path

---

## Proposed Features

### C1: Heartbeat Resets Idle Timers

**Goal:** Prevent upstream LLM request timeouts during streaming

**Current Behavior:**
- Heartbeats keep SSE connection alive
- Undici HTTP client has independent idle timer (10s default)
- LLM streaming responses can timeout if upstream pauses

**Proposed Solution:**
```typescript
// Option A: Activity tracking at Undici layer
const undiciOptions = {
  headersTimeout: 90000,  // 90s header timeout
  bodyTimeout: 0,          // Disable body timeout (SSE is long-lived)
  keepAliveTimeout: 60000, // 60s keep-alive
};

// Option B: Heartbeat forwarding
// Forward heartbeat events upstream to reset LLM connection timer
```

**Complexity:** Medium - Requires Undici configuration changes

---

### C2: Single Resume Attempt on Early Abort

**Goal:** Recover from transient network failures

**Use Cases:**
- Client WiFi switch mid-stream
- Mobile network handoff
- Proxy connection reset

**Proposed Architecture:**

```typescript
interface StreamCheckpoint {
  correlation_id: string;
  resume_token: string;
  created_at: number;
  expires_at: number;  // TTL: 60s
  partial_state: {
    stages_completed: string[];  // ["DRAFTING"]
    last_payload?: DraftGraphOutput;
  };
}
```

**Resume Protocol:**
```http
POST /assist/draft-graph/resume
Content-Type: application/json

{
  "resume_token": "abc123...",
  "from_stage": "DRAFTING"
}

Response (SSE):
data: {"stage":"DRAFTING","payload":{...}}
data: {"stage":"COMPLETE","payload":{...}}
```

**Implementation Steps:**
1. Store stream checkpoints in Redis (60s TTL)
2. Generate resume token on stream start
3. Include resume token in initial SSE event
4. Implement /assist/draft-graph/resume endpoint
5. Add client-side resume logic to SDK
6. Handle race conditions (resume vs original stream)

**Complexity:** Very High - Requires state management, new endpoints, SDK changes

---

### C3: Fallback to Non-Streaming if Resume Fails

**Goal:** Guarantee delivery even if SSE fails

**Proposed Behavior:**
```typescript
// Pseudocode
try {
  return await streamDraftGraph(request);
} catch (SSEError) {
  if (error.isRecoverable && !resumeAttempted) {
    try {
      return await resumeStream(resumeToken);
    } catch (ResumeError) {
      log.warn("Resume failed, falling back to non-streaming");
      return await draftGraph(request); // Non-SSE JSON response
    }
  }
  throw error;
}
```

**Challenges:**
- Duplicate cost (original stream + fallback request)
- Client confusion (SSE → JSON transition)
- Telemetry complexity (which response is "real"?)

**Complexity:** High - Requires dual-mode client handling

---

## Recommended Approach

### Phase 1: Idle Timer Improvements (v1.8)
- Configure Undici with proper timeouts
- Add configurable heartbeat interval (env var)
- Improve disconnect telemetry

**Effort:** 1-2 days
**Risk:** Low

### Phase 2: Resume Token Infrastructure (v1.9)
- Redis-backed checkpoint storage
- Resume token generation and validation
- Telemetry for resume success/failure

**Effort:** 3-5 days
**Risk:** Medium

### Phase 3: Resume Endpoint & SDK (v2.0)
- Implement /assist/draft-graph/resume
- Add SDK streaming client with auto-resume
- Comprehensive testing (race conditions, timeouts, etc.)

**Effort:** 5-7 days
**Risk:** High

### Phase 4: Non-Streaming Fallback (v2.1+)
- Implement fallback logic
- Handle cost accounting for fallback
- Update client expectations

**Effort:** 2-3 days
**Risk:** Medium

---

## Alternatives Considered

### 1. Increase Global Timeouts
**Pros:** Simple, no architecture changes
**Cons:** Doesn't solve network failures, increases resource usage

### 2. Client-Side Retry from Start
**Pros:** Simpler than resume
**Cons:** Duplicate cost, slow user experience

### 3. Polling-Based Status Checking
**Pros:** More resilient than SSE
**Cons:** Higher latency, more complex state management

---

## Testing Requirements

When implementing SSE resumption:

1. **Unit Tests**
   - Token generation and validation
   - Checkpoint storage and retrieval
   - Partial state reconstruction

2. **Integration Tests**
   - Resume from each SSE stage
   - Token expiry handling
   - Race condition: resume before original completes

3. **E2E Tests**
   - Network failure simulation
   - Proxy timeout scenarios
   - Multi-client coordination

4. **Performance Tests**
   - Resume latency (should be < 500ms)
   - Redis load under high resume rate
   - Memory usage for stored checkpoints

---

## Decision: Defer to Post-v1.7

**Rationale:**
- Core infrastructure (Redis, HMAC, Evidence Pack v2) takes priority
- SSE resume requires careful design to avoid race conditions
- Current heartbeat implementation handles most timeout scenarios
- Real-world data needed to tune resume TTL and retry strategy

**Next Steps:**
1. Monitor SSE abort telemetry in production
2. Identify most common disconnect patterns
3. Prototype resume mechanism in v1.8-alpha
4. Gather user feedback before full implementation

---

## References

- [SSE Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Undici Documentation](https://undici.nodejs.org/)
- [Redis TTL Best Practices](https://redis.io/commands/ttl/)
- [Anthropic Streaming Protocol](https://docs.anthropic.com/claude/reference/streaming)

---

**Last Updated:** 2025-01-13
**Owner:** Backend Team
**Reviewers:** Paul Lee, Architecture Team
