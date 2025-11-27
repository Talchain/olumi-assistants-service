# CEE Draft Validation UI Integration Guide v1

## Overview

This document describes the input validation system for `POST /assist/v1/draft-graph` and how UI clients should handle validation responses to provide helpful user guidance.

---

## New Error Codes

### Error Response Schema

All validation errors follow the `cee.error.v1` schema:

```typescript
interface CEEValidationError {
  schema: 'cee.error.v1';
  code: CEEErrorCode;
  message: string;
  retryable: boolean;
  trace?: {
    request_id?: string;
    correlation_id?: string;
  };
  details?: {
    // Preflight rejection details
    rejection_reason?: 'preflight_rejected';
    readiness_score?: number;           // 0-1 score
    readiness_level?: 'ready' | 'needs_clarification' | 'not_ready';
    factors?: {
      length_score: number;
      clarity_score: number;
      decision_relevance_score: number;
      specificity_score: number;
      context_score: number;
    };
    suggested_questions?: string[];      // Display these to user
    preflight_issues?: PreflightIssue[];
    hint?: string;

    // Clarification enforcement details
    required_rounds?: number;
    completed_rounds?: number;
    clarification_endpoint?: string;

    // Rate limit details
    retry_after_seconds?: number;

    // Schema validation details
    field_errors?: Record<string, string[]>;
  };
}

interface PreflightIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details?: {
    hint?: string;
    [key: string]: unknown;
  };
}

type CEEErrorCode =
  | 'CEE_VALIDATION_FAILED'
  | 'CEE_CLARIFICATION_REQUIRED'
  | 'CEE_RATE_LIMIT'
  | 'CEE_TIMEOUT'
  | 'CEE_INTERNAL_ERROR'
  | 'CEE_SERVICE_UNAVAILABLE'
  | 'CEE_GRAPH_INVALID';
```

---

## HTTP Status Mapping

| Code | HTTP | Condition | UI Action |
|------|------|-----------|-----------|
| `CEE_VALIDATION_FAILED` | 400 | Input fails schema validation | Show field errors |
| `CEE_VALIDATION_FAILED` | 400 | `rejection_reason: "preflight_rejected"` | Show `suggested_questions` inline |
| `CEE_CLARIFICATION_REQUIRED` | 400 | Clarification rounds required | Prompt user to use clarification endpoint |
| `CEE_RATE_LIMIT` | 429 | Too many requests | Show countdown timer using `retry_after_seconds` |
| `CEE_TIMEOUT` | 504 | Upstream timeout | Allow retry with exponential backoff |
| `CEE_INTERNAL_ERROR` | 500 | Server error | Generic error message, suggest retry |

---

## Response Headers

New headers to check:

```
X-CEE-API-Version: v1
X-CEE-Feature-Version: draft-model-1.0.0
X-CEE-Request-ID: req_abc123
X-CEE-Readiness-Score: 0.71    // Only on validation responses
Retry-After: 30                 // Only on rate limit responses
```

---

## Example Responses

### 1. Preflight Rejection (Low Readiness)

**Request:**
```json
{
  "brief": "hire developer?"
}
```

**Response (400 Bad Request):**
```json
{
  "schema": "cee.error.v1",
  "code": "CEE_VALIDATION_FAILED",
  "message": "Brief is not ready for processing. decision relevance score is too low. Please provide a clearer decision statement.",
  "retryable": true,
  "details": {
    "rejection_reason": "preflight_rejected",
    "readiness_score": 0.28,
    "readiness_level": "not_ready",
    "factors": {
      "length_score": 0.4,
      "clarity_score": 0.3,
      "decision_relevance_score": 0.15,
      "specificity_score": 0.3,
      "context_score": 0.2
    },
    "suggested_questions": [
      "What specific decision are you trying to make?",
      "What are the key constraints or parameters for this decision?",
      "What is the main goal or objective you're trying to achieve?"
    ],
    "preflight_issues": [
      {
        "code": "BRIEF_LOW_DECISION_RELEVANCE",
        "severity": "warning",
        "message": "Brief does not appear to describe a decision",
        "details": {
          "hint": "Try starting with 'Should I...', 'How should we...'"
        }
      }
    ],
    "hint": "Please provide a clearer decision statement or answer the suggested questions"
  }
}
```

### 2. Clarification Required

**Request:**
```json
{
  "brief": "Should I expand my team with remote contractors?",
  "clarification_rounds_completed": 0
}
```

**Response (400 Bad Request):**
```json
{
  "schema": "cee.error.v1",
  "code": "CEE_CLARIFICATION_REQUIRED",
  "message": "Brief requires clarification before drafting",
  "retryable": true,
  "details": {
    "readiness_score": 0.55,
    "readiness_level": "needs_clarification",
    "required_rounds": 1,
    "completed_rounds": 0,
    "suggested_questions": [
      "What specific decision are you trying to make?",
      "What are the key constraints or parameters for this decision?",
      "Are there specific metrics or success criteria you're targeting?"
    ],
    "clarification_endpoint": "/assist/clarify-brief",
    "hint": "Complete 1 more clarification round(s) before drafting"
  }
}
```

### 3. Rate Limited

**Response (429 Too Many Requests):**
```json
{
  "schema": "cee.error.v1",
  "code": "CEE_RATE_LIMIT",
  "message": "CEE Draft My Model rate limit exceeded",
  "retryable": true,
  "details": {
    "retry_after_seconds": 45
  }
}
```

### 4. Successful Draft

**Response (200 OK):**
```json
{
  "graph": {
    "version": "1.0",
    "nodes": [...],
    "edges": [...],
    "meta": {...}
  },
  "rationales": [...],
  "quality": {
    "overall": "good",
    "completeness": 0.85,
    "confidence": 0.78
  },
  "trace": {
    "request_id": "req_abc123"
  }
}
```

---

## UI Implementation Recommendations

### 1. Error Handler Enhancement

```typescript
async function handleDraftRequest(brief: string, options?: DraftOptions) {
  const response = await fetch('/assist/v1/draft-graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief, ...options }),
  });

  if (!response.ok) {
    const body = await response.json();

    // Handle preflight rejection with guidance
    if (body.details?.rejection_reason === 'preflight_rejected') {
      return {
        type: 'preflight_guidance',
        questions: body.details.suggested_questions,
        issues: body.details.preflight_issues,
        score: body.details.readiness_score,
        level: body.details.readiness_level,
        hint: body.details.hint,
      };
    }

    // Handle clarification required
    if (body.code === 'CEE_CLARIFICATION_REQUIRED') {
      return {
        type: 'clarification_required',
        requiredRounds: body.details.required_rounds,
        completedRounds: body.details.completed_rounds,
        questions: body.details.suggested_questions,
        endpoint: body.details.clarification_endpoint,
      };
    }

    // Handle rate limit
    if (body.code === 'CEE_RATE_LIMIT') {
      return {
        type: 'rate_limited',
        retryAfter: body.details.retry_after_seconds,
      };
    }

    // Generic error
    throw new Error(body.message);
  }

  return { type: 'success', data: await response.json() };
}
```

### 2. Inline Guidance Display

```tsx
function DraftForm({ onSubmit }: Props) {
  const [guidance, setGuidance] = useState<PreflightGuidance | null>(null);

  const handleSubmit = async (brief: string) => {
    const result = await handleDraftRequest(brief);

    if (result.type === 'preflight_guidance') {
      setGuidance(result);
      return;
    }

    // Handle other result types...
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea name="brief" />

      {guidance && (
        <div className="preflight-guidance">
          {/* Readiness Badge */}
          <span
            className="readiness-badge"
            data-level={guidance.level}
          >
            Readiness: {(guidance.score * 100).toFixed(0)}%
          </span>

          {/* Suggested Questions */}
          <div className="suggested-questions">
            <h4>To improve your brief, consider:</h4>
            {guidance.questions.map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => appendToBrief(q)}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Issues */}
          {guidance.issues?.map((issue, i) => (
            <div key={i} className={`issue issue-${issue.severity}`}>
              <span>{issue.message}</span>
              {issue.details?.hint && (
                <small>{issue.details.hint}</small>
              )}
            </div>
          ))}
        </div>
      )}

      <button type="submit">Draft My Decision</button>
    </form>
  );
}
```

### 3. Clarification Flow Integration

```tsx
function useClarificationFlow() {
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [answers, setAnswers] = useState<ClarifyAnswer[]>([]);

  const submitClarification = async (answer: string) => {
    const response = await fetch('/assist/clarify-brief', {
      method: 'POST',
      body: JSON.stringify({
        brief,
        round: roundsCompleted,
        previous_answers: answers,
      }),
    });

    const data = await response.json();

    if (!data.should_continue || data.confidence >= 0.8) {
      // Ready to draft
      return submitDraft({ clarification_rounds_completed: roundsCompleted + 1 });
    }

    // Continue clarification
    setRoundsCompleted(r => r + 1);
    return data.questions;
  };

  const submitDraft = async (options: DraftOptions) => {
    return fetch('/assist/v1/draft-graph', {
      method: 'POST',
      body: JSON.stringify({
        brief,
        clarification_rounds_completed: options.clarification_rounds_completed,
      }),
    });
  };

  return { submitClarification, submitDraft, roundsCompleted };
}
```

### 4. Rate Limit Handling

```tsx
function RateLimitCountdown({ retryAfter, onComplete }: Props) {
  const [remaining, setRemaining] = useState(retryAfter);

  useEffect(() => {
    if (remaining <= 0) {
      onComplete();
      return;
    }

    const timer = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  return (
    <div className="rate-limit-notice">
      <p>Too many requests. Please wait {remaining} seconds.</p>
      <progress value={retryAfter - remaining} max={retryAfter} />
    </div>
  );
}
```

---

## Feature Flags

The validation behavior can be controlled by these environment variables:

| Flag | Default | Description |
|------|---------|-------------|
| `CEE_PREFLIGHT_ENABLED` | `true` | Enable input validation before draft |
| `CEE_PREFLIGHT_STRICT` | `false` | Reject low-readiness briefs (vs log warning) |
| `CEE_PREFLIGHT_READINESS_THRESHOLD` | `0.4` | Minimum score for strict mode |
| `CEE_CLARIFICATION_ENFORCED` | `false` | Require clarification rounds based on readiness |
| `CEE_CLARIFICATION_THRESHOLD_ALLOW_DIRECT` | `0.8` | Score >= this allows direct draft |
| `CEE_CLARIFICATION_THRESHOLD_ONE_ROUND` | `0.4` | Score >= this requires 1 round |

---

## Readiness Score Breakdown

The readiness score (0-1) is computed from these weighted factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| `length_score` | 15% | Optimal range: 50-500 characters |
| `clarity_score` | 25% | Dictionary coverage + entropy |
| `decision_relevance_score` | 30% | Decision keywords detected |
| `specificity_score` | 15% | Numbers, dates, constraints |
| `context_score` | 15% | Goals, stakeholders, criteria |

### Readiness Levels

| Score Range | Level | Meaning |
|-------------|-------|---------|
| >= 0.7 | `ready` | Brief is ready for drafting |
| 0.4 - 0.7 | `needs_clarification` | Could benefit from clarification |
| < 0.4 | `not_ready` | Needs significant improvement |

---

## Affected Endpoints

| Endpoint | Changes |
|----------|---------|
| `POST /assist/v1/draft-graph` | Now validates input before drafting; may return validation errors |
| `POST /assist/clarify-brief` | OpenAI provider now fully supported |

---

## Migration Checklist

- [ ] Update error handling to check for `rejection_reason` in details
- [ ] Display `suggested_questions` when preflight fails
- [ ] Show readiness score as visual indicator
- [ ] Handle `CEE_CLARIFICATION_REQUIRED` error code
- [ ] Implement clarification flow if using enforced mode
- [ ] Handle rate limit with countdown display
- [ ] Read `X-CEE-Readiness-Score` header for analytics
