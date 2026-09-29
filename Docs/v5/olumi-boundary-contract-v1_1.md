# Olumi Boundary Contract v1.1

**Version:** 1.1
**Date:** 16 April 2026
**Status:** Draft for approval
**Parent:** AI Architecture v4.1 §15
**Related:** V3 Platform Contract v4 (service schemas, authoritative), Process Charter v1 (forthcoming), CC Development Standards v3

---

## What changed from v1.0

8 fixes + 2 adjustments from ChatGPT review:

- B1 request schema corrected: UI sends turn payload, CEE computes TurnContext internally (was incorrectly referencing TurnContext as B1 request)
- B1 invariants split into public boundary checks vs CEE internal checks
- UI validates response shape at runtime (was incorrectly "types only")
- B5 reframed as adapter boundary with internal request/response contracts
- B1 egress failure prefers typed envelope over transport-level 500
- Fixture metadata requirements added
- Real-bundle replay split into contract and behavioural suites
- Telemetry targets split by failure class
- `@olumi/contracts` uses namespaced exports instead of package split
- MC-24 refined to permit shape-identical local aliases

---

## Purpose

V3 Platform Contract v4 defines canonical schemas. This contract defines how those schemas are **runtime-enforced** so violations cannot ship silently. V4's failure mode was six months of schema drift at boundaries because enforcement was partial, self-reported, or absent.

---

## 1. Governing invariants

1. **One source of truth per type.** Every cross-service type has exactly one definition in `@olumi/contracts`. All four repos import from that package. Local redefinitions of cross-service types are prohibited. Shape-identical local aliases are permitted if tested.
2. **Every boundary validates.** Every HTTP request and response crossing a service boundary runs through a runtime validator. No exceptions, including UI.
3. **Fail-closed.** Validation failure rejects the request with a typed error. It does not log-and-continue.
4. **Golden fixtures are behavioural truth.** Every boundary has captured staging fixtures replayed in CI. Synthetic fixtures alone are insufficient.
5. **Contract tests block merge.** PR CI runs validator + fixture suites; red blocks merge.
6. **Schema changes require version bumps.** Breaking changes bump major; additive bump minor. No silent shape changes.
7. **Violations log is canonical.** Any boundary currently failing validation is in the log (AI Architecture v4.1 §17).

---

## 2. The `@olumi/contracts` package

### 2.1 Namespaced exports

One npm package with namespaced exports separating cross-service boundary types from service-internal types:

**`@olumi/contracts/boundary`** — cross-service only

| Export | Content |
|---|---|
| Types | GraphV3, NodeV3, EdgeV3, V2RunRequest, V2RunResponse, V2RunError, V2Option, GoalConstraint, ValidatePatchRequest, ValidatePatchResponse, OrchestratorTurnPayload, OlumiResponse, Block (union), Chip, BoundaryError |
| Zod schemas | Runtime validators for every type above |
| Constants | MAX_NODES, MAX_EDGES, MAX_OPTIONS, MAX_CONSTRAINTS, DEFAULT_STRENGTH_SIGNATURE, ID regex, label caps |
| Enums | NodeKind, FactorCategory, ProductReadiness, RunResult, FeatureStatus, SeedSource, Severity, TurnClass, Stage |
| Error codes | Every typed error emitted at any boundary |

**`@olumi/contracts/orchestrator`** — CEE-internal

| Export | Content |
|---|---|
| Types | TurnContext, LLMResponse, ActionRecommendation, HandlerFact, ContextPack, CoachingSignal, Insight |
| Zod schemas | Runtime validators for CEE internal use |

Changes to `/orchestrator` only trigger CEE CI. Changes to `/boundary` trigger CI in all four repos.

### 2.2 What it does not contain

Service-specific internals (prompts, repair logic, ISL computation, UI state), business logic, formatters, prompt text.

### 2.3 Versioning

- Semver strict. Major = breaking, minor = additive, patch = fix.
- 2-release deprecation window on breaking changes. Old and new shapes accepted during window.
- All four repos pin to exact version. No caret ranges.
- Version bumps require accompanying PRs in all four repos before merge.

### 2.4 Ownership

Shared. Changes require: written proposal, Zod schema updated, golden fixtures updated, machine check entry updated, Paul sign-off, PRs prepared for all repos before merge.

---

## 3. Boundaries

Five boundaries. Each specifies request/response schema, public invariants, and failure handling.

### 3.1 Boundary inventory

| # | Boundary | Caller | Callee | Endpoints |
|---|---|---|---|---|
| B1 | UI → CEE | UI | CEE | `POST /orchestrate/v1/turn`, `POST /assist/v1/draft-graph` |
| B2 | CEE → PLoT | CEE | PLoT | `POST /v2/run`, `POST /v1/validate-patch` |
| B3 | UI → PLoT (legacy) | UI | PLoT | `POST /v2/run` (feature-flagged, removed at V5 exit) |
| B4 | PLoT → ISL | PLoT | ISL | `POST /api/v1/robustness/analyze/v2` |
| B5 | CEE → LLM (adapter) | CEE | LLM adapter | Internal adapter interface |

### 3.2 B1: UI → CEE

**Request schema: `OrchestratorTurnPayload`**

The UI sends a turn payload. CEE computes TurnContext internally from this payload. `TurnContext` is never part of the B1 public contract.

```typescript
interface OrchestratorTurnPayload {
  scenario_id: string;
  message: string;
  conversation_history: ConversationTurn[];
  graph_state?: GraphV3;
  analysis_state?: V2RunResponse;
  session_state?: SessionState;
  selected_elements?: string[];
  system_event?: SystemEvent;
  client_turn_id: string;
  chip_metadata?: { action_type: string; parameters: Record<string, unknown> };
}
```

**Response schema: `OlumiResponse`** (AI Arch v4.1 §10)

**Public boundary invariants (validated at B1):**
- Envelope shape matches `OlumiResponse` Zod schema
- `assistant_text` non-empty unless typed error
- No XML in `assistant_text`
- Chip count ≤ 3
- Valid block / chip sub-schemas
- `stage_indicator` present and valid enum value

**CEE internal invariants (validated inside CEE, NOT at B1 boundary):**
- Every `recommended_actions[].action_type` in `TurnContext.eligible_actions`
- Every semantic number in prose grounded in context pack (MC-05)
- Referential integrity of entity references (MC-06)
- Turn class matches call-pattern matrix (MC-07)

**Request failure:** HTTP 422 with `BoundaryError`

**Response failure (egress):** CEE prefers a typed `OlumiResponse` with error block over a transport-level 500 wherever possible. Only truly unrecoverable process failures (OOM, crash) produce raw 500. This aligns with "no blank turn" (AI Arch §13).

### 3.3 B2: CEE → PLoT

**Request schema:** `V2RunRequest` (V3 Platform Contract §3.3.5), `ValidatePatchRequest`

**Response schema:** `V2RunOutput = V2RunResponse | V2RunError` (V3 §3.3.6), `ValidatePatchResponse`

**Public boundary invariants:**
- `goal_node_id` references node in `graph.nodes`
- `options[].interventions` keys reference factor nodes
- `constraint_id` unique within request, max 20
- Seed chain integrity per V3 §5.2
- All numeric fields finite

**Request failure:** HTTP 422 per V3 §4.6 error mapping

**Response failure:** `V2RunError { analysis_status: 'blocked' | 'failed', retryable, critiques }` per V3 §3.3.6

**Caller policy:** PLoT retries once on ISL 500; normalises 422 to `blocked`; normalises 5xx to `failed`.

### 3.4 B3: UI → PLoT (legacy direct)

Same schema and invariants as B2. Flagged behind `VITE_ENABLE_LEGACY_DIRECT_RUN`. Removed at V5 staging exit per AI Arch §18. Owner: UI. Telemetry tracks remaining usage via `boundary.validation` events with `boundary: 'B3'`.

### 3.5 B4: PLoT → ISL

**Request schema:** `ISLRequest` with `edge.from_` field translation per V3 §3.2.1

**Response schema:** `ISLResponse` (distributions, sensitivity, robustness, constraint_results)

**Public boundary invariants:**
- Seed forwarded verbatim
- `edge.from_` translation applied
- Option nodes filtered out before send
- `_meta.filtered_constraints` logs any stripped constraints

**Request failure:** PLoT validates before send; invalid request is a PLoT bug (logged, typed error returned upstream)

**Response failure:** Invalid ISL response normalised to `V2RunError { failed, retryable: true }`

**Caller policy:** PLoT retries once on ISL 500 before normalising to failed.

### 3.6 B5: CEE → LLM (adapter boundary)

B5 is an **adapter boundary**, not a peer service boundary. The LLM provider's API shape is outside our control. We validate what CEE sends to its own adapter and what the adapter returns.

**Internal request contract (CEE → adapter):**

```typescript
interface LLMAdapterRequest {
  mode: 'interpret' | 'artefact' | 'narrate';
  fragments: PromptFragment[];           // versioned, assembled by code
  tools?: ToolDefinition[];              // only for interpret mode
  schema?: ZodType;                      // only for artefact mode
  budget: { max_input_tokens: number; max_output_tokens: number };
  timeout_ms: number;
}
```

CEE validates `LLMAdapterRequest` before sending. Invalid request is a CEE assembly bug.

**Internal response contract (adapter → CEE):**

| Mode | Parsed output | Validator |
|---|---|---|
| Interpret | `LLMResponse` (text + insights + recommended_actions) | Zod `LLMResponseSchema` |
| Artefact | JSON matching declared schema | Zod per schema argument |
| Narrate | `string` | Non-empty, contamination regex |

Adapter validates parsed output before returning to CEE. Parse failure triggers one repair loop, then typed error per AI Arch §13.

**Adapter failure handling:**
- LLM timeout → typed `CEE_LLM_TIMEOUT` error
- Schema violation after repair → typed `CEE_LLM_SCHEMA_VIOLATION` error
- Contamination detected → strip + telemetry + degraded response (non-blocking)

---

## 4. Runtime enforcement

### 4.1 Validator placement

Every service implements validators at both send and receive sides per boundary:

```
Inbound request  → validateRequest(body, Schema)  → handler
Outbound response ← validateResponse(body, Schema) ← caller

Outbound request  → validateRequest(body, Schema)  → send
Inbound response  ← validateResponse(body, Schema) ← consumer
```

All validators use Zod schemas from `@olumi/contracts/boundary`. UI validates response shape on consumption — it is passthrough semantically but not structurally.

### 4.2 Fail-closed policy

| Direction | Action |
|---|---|
| Inbound request invalid | Reject with HTTP 422 + `BoundaryError`. Do not process. |
| Inbound response invalid (consuming) | Throw boundary error. Caller handles per service policy. |
| Outbound request invalid (sending) | Throw boundary error before send. This is a sender bug. |
| Outbound response invalid (serving) | For B1: prefer typed `OlumiResponse` with error block. For B2-B4: throw boundary error, return 500. |

**Prohibited:** `warnOnInvalidApiResponse()` patterns that log and pass bad data through (V-003 in violations log).

### 4.3 Error format

```typescript
interface BoundaryError {
  error: string;                    // stable code from @olumi/contracts/boundary
  boundary: string;                 // "B1", "B2", "B3", "B4", "B5"
  direction: 'request' | 'response';
  validator: string;                // schema name
  details: ValidationIssue[];       // Zod issues, trimmed for safety
  request_id: string;
  retryable: boolean;
}
```

Error codes centralised in `@olumi/contracts/boundary`. No inline strings.

### 4.4 Telemetry

Every validation emits:

```typescript
{
  event: 'boundary.validation',
  boundary: string,
  direction: string,
  outcome: 'pass' | 'fail',
  failure_class?: 'ingress_invalid' | 'producer_bug' | 'consumer_bug' | 'adapter_failure' | 'schema_drift',
  error_code?: string,
  request_id: string,
  timestamp: ISO8601,
  schema_version: string,
}
```

**Alert thresholds by failure class:**

| Class | Meaning | Target | Alert |
|---|---|---|---|
| `ingress_invalid` | Malformed client request | Expected low volume | Alert if > 5% of requests |
| `producer_bug` | Outbound request invalid before send | Must be 0 | Immediate alert |
| `consumer_bug` | Inbound response invalid after receive | Must be 0 | Immediate alert |
| `adapter_failure` | LLM provider returned unparseable output | Expected low volume | Alert if > 2% |
| `schema_drift` | Service versions disagree on shape | Must be 0 | Immediate alert, block deploy |

---

## 5. Golden fixtures

### 5.1 Fixture metadata

Every fixture carries:

```typescript
interface FixtureMetadata {
  fixture_id: string;                  // e.g. "B1_post_draft_gap_coaching"
  boundary: string;                    // "B1", "B2", etc.
  source_environment: string;          // "staging", "production"
  contract_version: string;            // @olumi/contracts version at capture
  capture_date: string;                // ISO 8601
  scenario_tags: string[];             // e.g. ["post_draft", "thin_brief", "GS-1"]
  expected_result_class: string;       // "success", "blocked", "failed", "typed_error"
  replay_suite: 'contract' | 'behavioural' | 'both';
}
```

### 5.2 Fixture inventory

At minimum for V5 exit:

**Per boundary (B1-B4):**
- Happy path: standard request, full computed response
- Edge cases: minimum valid input, maximum valid input
- Known failure modes: blocked, failed, 422, 504

**Per LLM output mode (B5):**
- Interpret: 3 fixtures covering different stage contexts
- Artefact: `draft_graph`, `edit_graph`, `review_graph_changes`, `decision_review`
- Narrate: direct answer, clarification, post-analysis summary

**Gold Standard Scenarios (GS-1 through GS-8 per AI Arch §16.4):**
- One end-to-end fixture per scenario covering B1 request → B1 response

Total minimum: 30 fixtures. Living set; grows with each new failure mode captured.

### 5.3 Replay suites

**Contract replay** — runs on every PR in every repo:
- Schema validity against current Zod schemas
- Semantic invariants per boundary spec
- Validates fixture still parses cleanly

**Behavioural replay** — runs on every CEE/UI PR:
- Expected user-visible outcome class (success/blocked/typed_error)
- No silent failures
- No duplicate chips
- No XML contamination
- Response shape matches Gold Standard structure where applicable

Fixture failures block merge. Fixtures are not updated to silence CI — shape changes require schema bump and migration.

### 5.4 Real-bundle regression fixtures

Known V4 failure bundles, captured and replayed as permanent guards:

| Bundle | Guards against | Suite |
|---|---|---|
| RB-01 | Rebuild intent → edit-repair timeout | behavioural |
| RB-02 | Real-unit factor calibration confusion | behavioural |
| RB-03 | Duplicated chips across composer + LLM | behavioural |
| RB-04 | Incorrect guidance prioritisation | behavioural |
| RB-05 | Proposal/applied state leakage | contract + behavioural |
| RB-06 | Add-option readiness regression (is_baseline null) | contract |
| RB-07 | Empty graph blocking draft_graph eligibility | contract |
| RB-08 | XML envelope contamination in assistant_text | contract + behavioural |

---

## 6. Schema references

### 6.1 Graph and analysis schemas

Authoritative in V3 Platform Contract v4 §3.3. `@olumi/contracts/boundary` re-exports as Zod:

- GraphV3, NodeV3, EdgeV3, NodeKind, FactorCategory — V3 §3.3.1
- AnalysisReadyV3, OptionForAnalysis, ProductReadiness — V3 §3.3.2
- CEEDraftGraphResponse, ValidationWarning — V3 §3.3.3
- V2RunRequest, V2Option, GoalConstraint — V3 §3.3.5
- V2RunOutput, V2RunResponse, V2RunError, V2OptionResult, Critique, ResponseMetaFull, ResponseMetaMinimal — V3 §3.3.6

### 6.2 Orchestrator schemas

Authoritative in AI Architecture v4.1. `@olumi/contracts/orchestrator` exports:

- TurnContext — AI Arch §5
- LLMResponse, ActionRecommendation — AI Arch §9
- HandlerFact — AI Arch §10.1
- ContextPack — schema TBD in Turn Lifecycle Spec

### 6.3 Validate-patch schemas

```typescript
interface ValidatePatchRequest {
  graph: GraphV3;
  operations: PatchOperation[];
  request_id?: string;
}

interface PatchOperation {
  op: 'add_node' | 'add_edge' | 'remove_node' | 'remove_edge' | 'update_node' | 'update_edge';
  path: string;
  value?: Partial<NodeV3 | EdgeV3>;
  previous?: Partial<NodeV3 | EdgeV3>;
}

interface ValidatePatchResponse {
  status: 'applied' | 'rejected';
  graph?: GraphV3;
  graph_hash?: string;
  repairs_applied: RepairEntry[];
  warnings: ValidationWarning[];
  violations?: Critique[];
}
```

### 6.4 Error codes

Centralised in `@olumi/contracts/boundary`:

| Code | Source | Meaning |
|---|---|---|
| `INVALID_REQUEST` | B1-B4 | Request validation failed |
| `INVALID_RESPONSE` | All | Response validation failed |
| `CEE_LLM_TIMEOUT` | B5 | LLM call timed out |
| `CEE_REQUEST_BUDGET_EXCEEDED` | B1 | Total request exceeded budget |
| `CEE_PROXY_TIMEOUT` | B2 | PLoT proxy fired before CEE responded |
| `CEE_INVALID_TOOL_CALL` | B5 | LLM called tool not in catalogue |
| `CEE_LLM_SCHEMA_VIOLATION` | B5 | LLM output failed Zod after repair |
| `PLOT_VALIDATION_FAILED` | B2 | PLoT rejected request |
| `ISL_COMPUTATION_FAILED` | B4 | ISL computation error |
| `INGRESS_CONTRACT_VIOLATION` | Any inbound | Request shape mismatch |
| `EGRESS_CONTRACT_VIOLATION` | Any outbound | Response shape mismatch |

All errors include `retryable: boolean`.

---

## 7. Contract Integrity Layer invariants

Per V3 Platform Contract v4 §5. Every invariant has a boundary-level machine check.

| Invariant | Boundary | Check |
|---|---|---|
| Seed chain integrity | B2, B4 | `meta.seed_used` matches seed PLoT sent to ISL |
| Request ID chain | B1-B4 | `all_match = true` on every analysis run |
| Repair logging | B2, B4 | Every semantic transform has matching `RepairEntry` |
| Option node filtering | B4 | No `NodeKind=option` nodes in ISL request |
| Hard `V2RunError` invariant | B2 | `/v2/run` response is `V2RunResponse` or `V2RunError`, no other shape |
| Timeout hierarchy | B1, B2, B5 | CEE LLM (80s) < CEE budget (90s) < PLoT proxy (105s) |
| ID pattern | All | All entity IDs match `^[a-z0-9_:-]+$` |

---

## 8. Migration from V4

### 8.1 Rollout sequence

1. **Package creation.** `@olumi/contracts` published at `0.1.0` with `/boundary` and `/orchestrator` namespaces. Types from V3 Platform Contract §3 + AI Arch §5, §9, §10.
2. **B2/B4 wire-up.** PLoT imports and validates requests/responses. Lowest risk — existing code mostly conforms.
3. **B1 wire-up.** CEE imports and validates at `/orchestrate/v1/turn`. V5 code only.
4. **UI wire-up.** UI imports types AND response validators from `/boundary`. Validates response shape on consumption. Fails closed to typed error presentation. Never repairs semantics.
5. **B5 adapter wire-up.** CEE validates `LLMAdapterRequest` before send; validates parsed output on return.
6. **Golden fixtures captured** from staging covering all boundaries.
7. **CI wired** in all four repos: validator tests + fixture replay on every PR.

All 7 steps must land before V5 staging exit per AI Arch §18.2.

### 8.2 V4 during strangler

V4 paths validate at B2/B4 (PLoT's enforcement) but may tolerate legacy shapes during window. Tolerance logged per `response_source`. When V5 owns golden path, tolerance removed before V4 deletion.

---

## 9. Machine Check Registry additions

Added to AI Arch v4.1 §16.2:

| ID | Clause | Check | Asserts |
|---|---|---|---|
| MC-24 | §1.1 one source | Linter | No local redefinition of `@olumi/contracts/boundary` types. Shape-identical aliases permitted if tested |
| MC-25 | §1.2 every boundary validates | Runtime + telemetry | Every B1-B5 request/response emits `boundary.validation` event |
| MC-26 | §1.3 fail-closed | CI | Adversarial invalid fixtures rejected at every boundary with typed error |
| MC-27 | §1.5 contract tests block merge | CI config | `contracts-test` workflow required for merge in all four repos |
| MC-28 | §1.6 schema versioning | CI | Breaking change without major bump blocks merge |
| MC-29 | §4.2 no log-and-continue | Linter | `warnOnInvalidApiResponse`-style patterns prohibited |
| MC-30 | §5.3 contract replay | CI | All fixtures validate against current schema |
| MC-31 | §5.4 behavioural replay | CI | RB-01 through RB-08 pass |
| MC-32 | §7 CIL invariants | Runtime + telemetry | Seed chain, request ID chain, repair logging pass per request |

---

## 10. What this contract does not cover

- Specific Zod schema code — lives in `@olumi/contracts` source
- Fixture file format — package README
- Telemetry dashboard specifics — tooling concern
- LLM provider contracts — outside our control
- Formatter implementations — AI Arch §11
- Prompt contents — product-owned, PMS
- Process for dispatching boundary changes — Process Charter v1

---

## 11. Approval and enforcement

### 11.1 Approval gate

1. Paul marks clauses
2. ChatGPT reviews (final lightweight pass)
3. This conversation incorporates
4. Paul sign-off

### 11.2 Enforcement

- Boundary changes require Zod schema + fixture + machine check update in same PR
- New boundary requires contract update before dispatch
- Any boundary in code without validation is a violation (added to AI Arch §17)

### 11.3 Change control

Same as AI Arch v4.1 §20.3.

---

*End of v1.1*
