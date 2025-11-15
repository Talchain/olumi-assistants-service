# SSE Resume API Guide

## Overview

The SSE Resume feature (v1.8.0+) enables clients to reconnect to interrupted SSE streams without losing data. When a network connection drops or a client needs to reconnect, they can use the resume token to continue streaming from where they left off.

**v1.9.0** adds **Live Resume** mode for seamless continuation with automatic event streaming.

## Key Features

- **Zero-loss reconnection** - Replay missed events during disconnection
- **Live resume mode (v1.9)** - Continue streaming new events after replay
- **Automatic buffering** - Server buffers up to 256 events or 1.5 MB
- **Snapshot fallback** - Late reconnection to completed streams returns final result
- **Graceful degradation** - Streams continue without resume if Redis unavailable
- **Security hardened** - HMAC-SHA256 signed tokens with constant-time verification

## Quick Start

### 1. Start a Stream

```bash
curl -X POST https://api.example.com/assist/draft-graph/stream \
  -H "Content-Type: application/json" \
  -d '{"brief": "Create a todo app"}'
```

**Response (SSE):**
```
event: stage
data: {"stage":"DRAFTING"}

event: resume
data: {"token":"eyJyZXF1ZXN0X2lkIjoiYWJjMTIzIiwic3RlcCI6IkRSQUZUSU5HIiwic2VxIjoxLCJleHBpcmVzX2F0IjoxNzMxNTIwODAwfQ.a1b2c3d4e5f6"}

event: stage
data: {"stage":"DRAFTING","payload":{...}}

...
```

### 2. Save the Resume Token

Extract the token from the `event: resume` message. This token allows reconnection if the stream is interrupted.

**Token Format:**
```
<base64url-payload>.<base64url-signature>
```

**Token Payload:**
- `request_id` - Unique stream identifier
- `step` - Current processing step (DRAFTING, COMPLETE)
- `seq` - Last received event sequence number
- `expires_at` - Unix timestamp (15-minute TTL)

### 3. Resume on Disconnection

If the connection drops, reconnect using the resume token:

```bash
curl -X POST https://api.example.com/assist/draft-graph/resume \
  -H "Content-Type: application/json" \
  -H "X-Resume-Token: eyJyZXF1ZXN0X2lkIjoiYWJjMTIzIi..." \
```

**Success Response (200):**
```
event: stage
data: {"stage":"DRAFTING","payload":{...}}

event: stage
data: {"stage":"COMPLETE","payload":{...}}

: heartbeat
```

The server replays all events after the sequence number in the token.

**⚠️ Important - Resume Modes**

The resume endpoint supports two modes:

**Replay-Only Mode (default, v1.8.0):**
1. Server replays all buffered events since the token sequence
2. For **completed streams**: Final `event: complete` is sent, then connection closes
3. For **in-progress streams**: Buffered events are replayed, heartbeat sent, then connection closes
4. Clients must reconnect to the main `/stream` endpoint for ongoing updates

**Live Resume Mode (v1.9.0):**
1. Server replays all buffered events since the token sequence
2. Connection stays open and continues streaming new events
3. Server polls for new events until stream completes or times out (2 minutes)
4. Snapshot TTL renewed every 30 seconds during live streaming
5. Requires `SSE_RESUME_LIVE_ENABLED=true` (opt-in feature flag)

**To use Live Resume Mode:**
```bash
# Via query parameter
curl -X POST https://api.example.com/assist/draft-graph/resume?mode=live \
  -H "X-Resume-Token: eyJ..."

# Or via header
curl -X POST https://api.example.com/assist/draft-graph/resume \
  -H "X-Resume-Token: eyJ..." \
  -H "X-Resume-Mode: live"
```

If live mode is not enabled on the server, it gracefully falls back to replay-only.

## API Reference

### POST /assist/draft-graph/stream

Start a new SSE stream with resume capability.

**Request:**
```json
{
  "brief": "Your task description",
  "attachments": [...],  // Optional
  "flags": {...}         // Optional
}
```

**Response Headers:**
- `Content-Type: text/event-stream`
- `X-Correlation-ID: <uuid>` - Request tracking ID

**Events:**
1. `event: stage` - Initial DRAFTING stage
2. `event: resume` - Resume token (only if Redis + secrets configured)
3. `event: stage` - Progress updates with partial results
4. `event: stage` - Final COMPLETE stage with graph

**Notes:**
- Resume token appears in second event (seq=1)
- Token is only generated if both Redis and secrets are configured
- Stream continues normally even if resume unavailable

### POST /assist/draft-graph/resume

Resume an interrupted stream using a resume token.

**Request Headers:**
- `X-Resume-Token: <token>` - **Required**
- `X-Resume-Mode: live` - **Optional** (v1.9) - Enable live resume mode

**Query Parameters:**
- `mode=live` - **Optional** (v1.9) - Alternative way to enable live resume mode

**Response Codes:**

| Code | Meaning | Details |
|------|---------|---------|
| 200 | Success | Replaying buffered events (+ live streaming if mode=live) |
| 400 | Bad Request | Missing or malformed token |
| 401 | Unauthorized | Invalid signature or expired token |
| 426 | Upgrade Required | Resume not available (secrets/Redis not configured) |

**Live Resume Mode (v1.9):**
- Requires `SSE_RESUME_LIVE_ENABLED=true` on server
- Rate limit: `SSE_RESUME_LIVE_RPM` (default: same as stream endpoint)
- Timeout: 120 seconds (2 minutes)
- Falls back to replay-only if feature disabled

**Success Response (200):**
```
event: stage
data: {...}

event: complete
data: {"graph": {...}}
```

**Error Response (401):**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Invalid resume token: TOKEN_EXPIRED"
}
```

**Graceful Degradation (426):**
```json
{
  "schema": "error.v1",
  "code": "INTERNAL",
  "message": "Resume functionality not available (secrets not configured)",
  "details": {
    "upgrade": "resume=unsupported"
  }
}
```

## Resume Scenarios

### Scenario 1: Mid-Stream Reconnection - Replay-Only Mode (v1.8)

**Timeline:**
1. Client starts stream at seq=0
2. Client receives events 0-10
3. Network drops at seq=11
4. Client reconnects with resume token (seq=10)
5. Server replays events 11-20, sends heartbeat, then closes
6. Client reconnects to main `/stream` endpoint for ongoing events

**Result:** Zero data loss (all missed events replayed)

**⚠️ Note:** Resume connection closes after replay. For in-progress streams, client must reconnect to the main streaming endpoint to continue receiving live events.

### Scenario 1b: Mid-Stream Reconnection - Live Resume Mode (v1.9)

**Timeline:**
1. Client starts stream at seq=0
2. Client receives events 0-10
3. Network drops at seq=11
4. Client reconnects with resume token + `mode=live` (seq=10)
5. Server replays events 11-20
6. Server continues polling and streaming events 21-50
7. Stream completes with `event: complete`
8. Connection closes

**Result:** Zero data loss with seamless continuation (no reconnection needed)

**✅ Advantage:** Single reconnection recovers all missed events AND continues streaming until completion.

### Scenario 2: Late Reconnection (Snapshot Fallback)

**Timeline:**
1. Client starts stream
2. Client receives token but doesn't save it
3. Stream completes (seq=50)
4. Client reconnects 30 seconds later
5. Server returns snapshot with final graph

**Result:** Complete graph delivered via `event: complete`

**Note:** Snapshots are kept for 60 seconds after completion

### Scenario 3: Expired State

**Timeline:**
1. Client starts stream
2. Client receives token
3. Stream completes
4. Client waits > 60 seconds
5. Client attempts resume

**Result:** 426 error - state expired

### Scenario 4: Resume Without Redis

**Timeline:**
1. Server starts without Redis
2. Client requests stream
3. Stream proceeds normally
4. No resume token generated

**Result:** Stream succeeds, resume unavailable

## Security

### Token Security

- **HMAC-SHA256 signing** - Tokens cannot be forged without secret
- **Constant-time verification** - Prevents timing attacks
- **15-minute expiration** - Prevents replay of old tokens
- **No PII in tokens** - Only request_id, step, and sequence

### Secret Configuration

Set either environment variable:
```bash
SSE_RESUME_SECRET=<64-char-hex-secret>
# OR
HMAC_SECRET=<64-char-hex-secret>
```

**Production Recommendation:**
- Use dedicated `SSE_RESUME_SECRET` for isolation
- Rotate secrets during maintenance windows
- Monitor `SseResumeExpired` telemetry for rotation impact

## Configuration

### Environment Variables

```bash
# Resume Secrets
SSE_RESUME_SECRET=<secret>      # Preferred for SSE resume tokens
HMAC_SECRET=<secret>            # Fallback if SSE_RESUME_SECRET not set

# Redis Configuration (required for resume)
REDIS_URL=redis://localhost:6379

# Buffer Limits
SSE_BUFFER_MAX_EVENTS=256       # Max events per stream (default: 256)
SSE_BUFFER_MAX_SIZE_MB=1.5      # Max buffer size in MB (default: 1.5)

# TTLs
SSE_STATE_TTL_SEC=900           # State TTL in seconds (default: 900 = 15 min)
SSE_SNAPSHOT_TTL_SEC=60         # Snapshot TTL after completion (default: 60)
```

### Buffer Trimming

When buffer limits are exceeded, the **oldest events are dropped**:

1. **Size limit** - Buffer exceeds 1.5 MB → trim oldest event
2. **Count limit** - Buffer exceeds 256 events → trim oldest event

**Telemetry:** `SseBufferTrimmed` event emitted with:
- `trimmed_seq` - Sequence number of dropped event
- `trimmed_size_bytes` - Size of dropped event
- `reason` - "size_limit" or "count_limit"
- `new_buffer_size_bytes` - New buffer size
- `new_buffer_event_count` - New event count

## Client Implementation

### JavaScript Example

```javascript
class ResumableSSEClient {
  constructor(url) {
    this.url = url;
    this.resumeToken = null;
    this.events = [];
  }

  async start(brief) {
    const response = await fetch(`${this.url}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief })
    });

    await this.processStream(response.body);
  }

  async processStream(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // Keep incomplete event

        for (const event of lines) {
          this.handleEvent(event);
        }
      }
    } catch (error) {
      // Connection dropped - attempt resume
      if (this.resumeToken) {
        await this.resume();
      }
    }
  }

  handleEvent(eventData) {
    const lines = eventData.split('\n');
    const type = lines.find(l => l.startsWith('event:'))?.substring(7);
    const data = lines.find(l => l.startsWith('data:'))?.substring(6);

    if (type === 'resume') {
      const parsed = JSON.parse(data);
      this.resumeToken = parsed.token;
      console.log('Resume token saved:', this.resumeToken);
    }

    if (type === 'stage') {
      const parsed = JSON.parse(data);
      this.events.push(parsed);
      console.log('Stage:', parsed.stage);
    }
  }

  async resume() {
    console.log('Attempting resume with token:', this.resumeToken);

    const response = await fetch(`${this.url}/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Resume-Token': this.resumeToken
      }
    });

    if (response.status === 200) {
      console.log('Resume successful');
      await this.processStream(response.body);
    } else if (response.status === 426) {
      console.log('Resume not available - restart required');
    } else {
      const error = await response.json();
      console.error('Resume failed:', error);
    }
  }
}

// Usage
const client = new ResumableSSEClient('https://api.example.com/assist/draft-graph');
await client.start('Create a todo app');
```

### Python Example

```python
import requests
import json
import sseclient

class ResumableSSEClient:
    def __init__(self, base_url):
        self.base_url = base_url
        self.resume_token = None
        self.events = []

    def start(self, brief):
        response = requests.post(
            f"{self.base_url}/stream",
            json={"brief": brief},
            stream=True,
            headers={"Accept": "text/event-stream"}
        )

        try:
            self.process_stream(response)
        except requests.exceptions.ConnectionError:
            if self.resume_token:
                self.resume()

    def process_stream(self, response):
        client = sseclient.SSEClient(response)

        for event in client.events():
            if event.event == "resume":
                data = json.loads(event.data)
                self.resume_token = data["token"]
                print(f"Resume token saved: {self.resume_token}")

            elif event.event == "stage":
                data = json.loads(event.data)
                self.events.append(data)
                print(f"Stage: {data['stage']}")

    def resume(self):
        print(f"Attempting resume with token: {self.resume_token}")

        response = requests.post(
            f"{self.base_url}/resume",
            headers={
                "Content-Type": "application/json",
                "X-Resume-Token": self.resume_token
            },
            stream=True
        )

        if response.status_code == 200:
            print("Resume successful")
            self.process_stream(response)
        elif response.status_code == 426:
            print("Resume not available - restart required")
        else:
            error = response.json()
            print(f"Resume failed: {error}")

# Usage
client = ResumableSSEClient("https://api.example.com/assist/draft-graph")
client.start("Create a todo app")
```

## Telemetry and Monitoring

### Key Metrics

Monitor these telemetry events in Datadog:

```
assist.sse.resume_issued         # Tokens generated
assist.sse.resume_attempt        # Resume attempts
assist.sse.resume_success        # Successful resumes
assist.sse.resume_expired        # Expired/invalid tokens
assist.sse.resume_replay_count   # Events replayed per resume
assist.sse.buffer_trimmed        # Buffer pressure indicator
assist.sse.snapshot_created      # Snapshot fallbacks
assist.sse.partial_recovery      # Late reconnections
```

### Dashboard Queries

**Resume Success Rate:**
```
sum:assist.sse.resume_success / sum:assist.sse.resume_attempt
```

**Buffer Pressure:**
```
sum:assist.sse.buffer_trimmed.as_count()
```

**Average Replay Count:**
```
avg:assist.sse.resume_replay_count
```

### Alerting

Recommended alerts:

1. **High resume failure rate** - `resume_success / resume_attempt < 0.8`
2. **Buffer trimming spike** - `buffer_trimmed.as_count() > 100/min`
3. **Token expiration spike** - `resume_expired.as_count() > 50/min`

## Troubleshooting

### Resume Token Not Generated

**Symptoms:** No `event: resume` in stream

**Causes:**
1. Redis not available
2. Secrets not configured (SSE_RESUME_SECRET or HMAC_SECRET)

**Solution:**
```bash
# Check Redis connection
redis-cli ping

# Verify secrets configured
echo $SSE_RESUME_SECRET
echo $HMAC_SECRET

# Check logs for initialization messages
grep "Resume token generation skipped" logs/*.log
```

### 426 Upgrade Required

**Symptoms:** Resume endpoint returns 426

**Causes:**
1. Secrets not configured on resume
2. State expired (> 15 minutes)
3. Snapshot expired (> 60 seconds after completion)

**Solution:**
- Configure secrets before deployment
- Implement client-side retry with exponential backoff
- Fall back to new stream request

### Buffer Trimming Alerts

**Symptoms:** High `SseBufferTrimmed` event rate

**Causes:**
1. Long-running streams with many events
2. Clients not resuming quickly enough
3. Buffer limits too low for use case

**Solution:**
```bash
# Increase buffer limits
SSE_BUFFER_MAX_EVENTS=512        # Double the default
SSE_BUFFER_MAX_SIZE_MB=3.0       # Double the default

# Monitor impact
curl -s https://api.example.com/metrics | grep sse_buffer
```

## Limitations

### Current (v1.8.0)

1. **⚠️ Replay-only resume** - Resume endpoint replays buffered events then **closes the connection**
   - **Impact**: Clients must reconnect to `/stream` endpoint for in-progress streams
   - **Workaround**: Implement reconnection logic after resume completes
   - **Use case**: Designed for recovering missed events after network interruption
   - **Future (v1.9+)**: Keep connection open for live event continuation

2. **Single stream per request_id** - Cannot resume from multiple clients
   - Future: Multi-client resume with sequence synchronization

3. **Buffer size limits** - Long streams may lose old events
   - Workaround: Increase `SSE_BUFFER_MAX_EVENTS` and `SSE_BUFFER_MAX_SIZE_MB`

4. **Redis dependency** - Resume requires Redis for state management
   - Workaround: Graceful degradation continues streaming without resume

### Known Issues

None at this time. Report issues at: https://github.com/Talchain/olumi-assistants-service/issues

## Migration Guide

### From v1.7 (No Resume Support)

**No breaking changes** - Resume feature is additive:

1. ✅ Existing clients continue working without changes
2. ✅ Streams succeed even if resume unavailable
3. ✅ No changes to request/response format

**To enable resume:**

1. Configure Redis: `REDIS_URL=redis://localhost:6379`
2. Set secret: `SSE_RESUME_SECRET=<64-char-hex>`
3. Update clients to save resume token
4. Implement resume logic on disconnection

**Gradual rollout:**
1. Deploy server with resume support
2. Monitor telemetry for `resume_issued` events
3. Update clients in stages
4. Monitor `resume_attempt` and `resume_success` rates

## Best Practices

### Client-Side

1. **Always save the resume token** - Even if you don't use it immediately
2. **Implement exponential backoff** - Don't hammer the resume endpoint
3. **Handle 426 gracefully** - Fall back to new stream request
4. **Monitor resume success rate** - Track reconnection reliability

### Server-Side

1. **Configure appropriate buffer sizes** - Balance memory vs. resume window
2. **Monitor buffer trimming** - Adjust limits if trimming is frequent
3. **Rotate secrets during maintenance** - Coordinate with low-traffic windows
4. **Set up alerting** - Track resume success rates and buffer pressure

### Production Deployment

1. **Use dedicated SSE_RESUME_SECRET** - Isolate from other HMAC operations
2. **Enable Redis persistence** - Prevent state loss on Redis restart
3. **Monitor Redis memory** - Watch for buffer memory growth
4. **Load test resume endpoint** - Verify performance under concurrent resumes

---

## Support

For questions or issues:
- GitHub Issues: https://github.com/Talchain/olumi-assistants-service/issues
- Documentation: https://docs.olumi.ai/sse-resume
- API Reference: https://docs.olumi.ai/api-reference
