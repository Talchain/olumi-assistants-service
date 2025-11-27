# CEE Enhancement Roadmap

This document outlines the phased delivery plan for CEE enhancements, starting with ISL-powered Decision Review and continuing through enterprise-grade prompt management.

## Current State (Completed)

The following foundational work has been completed:

- **Prompt Management Infrastructure**
  - Schema with Zod validation (`src/prompts/schema.ts`)
  - File-based JSON store with atomic writes (`src/prompts/store.ts`)
  - Prompt loader with fallback to defaults (`src/prompts/loader.ts`)
  - Braintrust integration for A/B experiments (`src/prompts/braintrust.ts`)
  - Audit logging (`src/prompts/audit.ts`)

- **Admin API & UI**
  - Full CRUD routes (`src/routes/admin.prompts.ts`)
  - Alpine.js-powered UI (`src/routes/admin.ui.ts`)
  - Header-based authentication (`X-Admin-Key`)

- **Robustness**
  - Store health tracking (`storeHealthy`, `isPromptStoreHealthy()`, `getPromptStoreStatus()`)
  - Graceful degradation (503 "store_unavailable" for unhealthy store)
  - SHA-256 content hashing with verification on load
  - Single production prompt per task enforcement
  - Braintrust initialization at server startup

- **Testing**
  - 35 unit tests covering store, loader, Braintrust, hashing, and enforcement

---

## Phase 0: CEE Decision Review Enhancement with ISL (Priority: CRITICAL)

**Goal:** Enhance CEE's Decision Review to leverage ISL's new capabilities: sensitivity analysis, contrastive explanations, conformal prediction, and enhanced validation.

**Key Principle:** Graceful degradation is paramount. CEE must function fully when ISL is unavailable.

### 0.1 ISL Client Extensions

Extend the existing ISL adapter to support the new endpoints.

**Files to create/modify:**
- `src/adapters/isl/client.ts` - Add new endpoint methods
- `src/adapters/isl/types.ts` - Add response types

**ISL Endpoints to integrate:**

| Endpoint | Method | CEE Use Case |
|----------|--------|--------------|
| `/causal/sensitivity/detailed` | `getSensitivityDetailed()` | Flag critical assumptions in critique |
| `/explain/contrastive` | `getContrastiveExplanation()` | Provide "do this instead" recommendations |
| `/causal/counterfactual/conformal` | `getConformalPrediction()` | Cite rigorous confidence intervals |
| `/causal/validate/strategies` | `getValidationStrategies()` | Suggest model improvements |

**Tasks:**
- [ ] Add `SensitivityDetailedResponse` type
- [ ] Add `ContrastiveExplanationResponse` type
- [ ] Add `ConformalPredictionResponse` type
- [ ] Add `ValidationStrategiesResponse` type
- [ ] Implement `getSensitivityDetailed()` with timeout/retry
- [ ] Implement `getContrastiveExplanation()` with timeout/retry
- [ ] Implement `getConformalPrediction()` with timeout/retry
- [ ] Implement `getValidationStrategies()` with timeout/retry
- [ ] Add circuit breaker integration for each endpoint

### 0.2 Enhanced Decision Review Schema

Define the enhanced critique structure with ISL-powered fields.

**Files to create:**
- `src/cee/decision-review/schema.ts` - Enhanced schema definitions
- `src/contracts/cee/decision-review-enhanced.ts` - Contract types

**Schema definitions:**

```typescript
// src/cee/decision-review/schema.ts

import { z } from 'zod';

/**
 * Assumption warning from ISL sensitivity analysis
 */
export const AssumptionWarningSchema = z.object({
  /** The assumption being warned about */
  assumption: z.string(),
  /** Elasticity measure (how sensitive outcome is to this assumption) */
  sensitivity: z.number(),
  /** Human-readable impact description */
  impact: z.string(), // e.g., "10% violation → 23% outcome change"
  /** Actionable recommendation */
  recommendation: z.string(),
});
export type AssumptionWarning = z.infer<typeof AssumptionWarningSchema>;

/**
 * Actionable alternative from ISL contrastive explanation
 */
export const ActionableStepSchema = z.object({
  /** Current intervention values */
  current: z.record(z.number()),
  /** Suggested intervention values */
  suggested: z.record(z.number()),
  /** Expected improvement description */
  expectedImprovement: z.string(),
  /** Effort level to implement */
  effort: z.enum(['low', 'medium', 'high']),
});
export type ActionableStep = z.infer<typeof ActionableStepSchema>;

/**
 * Confidence statement from ISL conformal prediction
 */
export const ConfidenceStatementSchema = z.object({
  /** Confidence interval bounds */
  interval: z.tuple([z.number(), z.number()]),
  /** Coverage probability (e.g., 0.95 for 95%) */
  coverage: z.number().min(0).max(1),
  /** Plain English explanation */
  plainEnglish: z.string(), // e.g., "95% guaranteed to fall between..."
});
export type ConfidenceStatement = z.infer<typeof ConfidenceStatementSchema>;

/**
 * Model improvement suggestion from ISL validation
 */
export const ModelImprovementSchema = z.object({
  /** Category of improvement */
  category: z.enum(['data', 'structure', 'assumption', 'calibration']),
  /** Description of the improvement */
  description: z.string(),
  /** Priority level */
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  /** Specific action to take */
  action: z.string(),
});
export type ModelImprovement = z.infer<typeof ModelImprovementSchema>;

/**
 * Enhanced Decision Review with ISL-powered insights
 */
export const EnhancedDecisionReviewSchema = z.object({
  // Existing fields
  summary: z.string(),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),

  // NEW: ISL-powered fields
  assumptionWarnings: z.array(AssumptionWarningSchema).default([]),
  actionableAlternatives: z.array(ActionableStepSchema).default([]),
  confidenceStatement: ConfidenceStatementSchema.nullable().default(null),
  modelImprovements: z.array(ModelImprovementSchema).default([]),

  // Metadata
  islAvailable: z.boolean(),
  islEndpointsUsed: z.array(z.string()).default([]),
});
export type EnhancedDecisionReview = z.infer<typeof EnhancedDecisionReviewSchema>;
```

**Tasks:**
- [ ] Create schema file with Zod definitions
- [ ] Add OpenAPI schema for enhanced review
- [ ] Generate TypeScript types from schema
- [ ] Add schema validation tests

### 0.3 Decision Review Service

Core service that orchestrates ISL calls with graceful degradation.

**Files to create:**
- `src/cee/decision-review/service.ts` - Main service
- `src/cee/decision-review/formatters.ts` - Output formatters
- `src/cee/decision-review/templates.ts` - Plain-English templates

**Service implementation pattern:**

```typescript
// src/cee/decision-review/service.ts

import { ISLClient } from '../../adapters/isl/client.js';
import { log, emit } from '../../utils/telemetry.js';

export class DecisionReviewService {
  constructor(private readonly isl: ISLClient) {}

  async generateEnhancedReview(
    decision: Decision,
    graph: CausalGraph,
    options?: { timeout?: number }
  ): Promise<EnhancedDecisionReview> {

    // Parallel ISL calls with individual error handling
    const [sensitivity, contrastive, conformal, validation] = await Promise.allSettled([
      this.isl.getSensitivityDetailed(graph, decision.intervention),
      this.isl.getContrastiveExplanation(graph, decision.targetOutcome),
      this.isl.getConformalPrediction(graph, decision.intervention, decision.calibrationData),
      this.isl.getValidationStrategies(graph),
    ]);

    // Track which endpoints succeeded
    const islEndpointsUsed: string[] = [];

    // Format results with graceful degradation
    const assumptionWarnings = this.formatAssumptions(sensitivity, islEndpointsUsed);
    const actionableAlternatives = this.formatAlternatives(contrastive, islEndpointsUsed);
    const confidenceStatement = this.formatConfidence(conformal, islEndpointsUsed);
    const modelImprovements = this.formatImprovements(validation, islEndpointsUsed);

    // Determine if any ISL data was available
    const islAvailable = islEndpointsUsed.length > 0;

    // Emit telemetry
    emit('cee.decision_review.generated', {
      islAvailable,
      endpointsUsed: islEndpointsUsed,
      endpointsFailed: 4 - islEndpointsUsed.length,
    });

    return {
      summary: this.generateSummary(decision),
      strengths: this.identifyStrengths(decision, validation),
      risks: this.identifyRisks(decision, sensitivity),
      assumptionWarnings,
      actionableAlternatives,
      confidenceStatement,
      modelImprovements,
      islAvailable,
      islEndpointsUsed,
    };
  }

  /**
   * Fallback to basic review when all ISL endpoints fail
   */
  private generateBasicReview(decision: Decision): EnhancedDecisionReview {
    log.warn('All ISL endpoints unavailable, returning basic review');
    emit('cee.decision_review.isl_fallback', { reason: 'all_endpoints_failed' });

    return {
      summary: this.generateSummary(decision),
      strengths: this.identifyBasicStrengths(decision),
      risks: this.identifyBasicRisks(decision),
      assumptionWarnings: [],
      actionableAlternatives: [],
      confidenceStatement: null,
      modelImprovements: [],
      islAvailable: false,
      islEndpointsUsed: [],
    };
  }

  private formatAssumptions(
    result: PromiseSettledResult<SensitivityDetailedResponse>,
    endpointsUsed: string[]
  ): AssumptionWarning[] {
    if (result.status === 'rejected') {
      log.warn({ error: result.reason }, 'Sensitivity endpoint failed');
      return [];
    }

    endpointsUsed.push('sensitivity');

    return Object.entries(result.value.sensitivities)
      .filter(([_, metric]) => metric.critical)
      .slice(0, 5) // Limit to top 5
      .map(([name, metric]) => ({
        assumption: name,
        sensitivity: metric.elasticity,
        impact: `${(metric.elasticity * 10).toFixed(0)}% outcome change per 10% violation`,
        recommendation: metric.recommendation,
      }));
  }

  private formatAlternatives(
    result: PromiseSettledResult<ContrastiveExplanationResponse>,
    endpointsUsed: string[]
  ): ActionableStep[] {
    if (result.status === 'rejected') {
      log.warn({ error: result.reason }, 'Contrastive endpoint failed');
      return [];
    }

    endpointsUsed.push('contrastive');

    return result.value.minimalInterventions
      .slice(0, 3) // Limit to top 3
      .map(intervention => ({
        current: intervention.changesFrom,
        suggested: intervention.changesTo,
        expectedImprovement: intervention.expectedOutcome,
        effort: this.assessEffort(intervention),
      }));
  }

  private formatConfidence(
    result: PromiseSettledResult<ConformalPredictionResponse>,
    endpointsUsed: string[]
  ): ConfidenceStatement | null {
    if (result.status === 'rejected') {
      log.warn({ error: result.reason }, 'Conformal endpoint failed');
      return null;
    }

    endpointsUsed.push('conformal');

    const { lower, upper, coverage } = result.value;
    return {
      interval: [lower, upper],
      coverage,
      plainEnglish: `${(coverage * 100).toFixed(0)}% guaranteed to fall between ${lower.toFixed(2)} and ${upper.toFixed(2)}`,
    };
  }

  private formatImprovements(
    result: PromiseSettledResult<ValidationStrategiesResponse>,
    endpointsUsed: string[]
  ): ModelImprovement[] {
    if (result.status === 'rejected') {
      log.warn({ error: result.reason }, 'Validation endpoint failed');
      return [];
    }

    endpointsUsed.push('validation');

    return result.value.suggestions
      .slice(0, 5) // Limit to top 5
      .map(suggestion => ({
        category: suggestion.category,
        description: suggestion.description,
        priority: suggestion.priority,
        action: suggestion.action,
      }));
  }

  private assessEffort(intervention: MinimalIntervention): 'low' | 'medium' | 'high' {
    const changeCount = Object.keys(intervention.changesTo).length;
    const maxChange = Math.max(
      ...Object.entries(intervention.changesTo).map(([k, v]) =>
        Math.abs(v - (intervention.changesFrom[k] ?? 0)) / (intervention.changesFrom[k] || 1)
      )
    );

    if (changeCount === 1 && maxChange < 0.2) return 'low';
    if (changeCount <= 2 && maxChange < 0.5) return 'medium';
    return 'high';
  }
}
```

**Tasks:**
- [ ] Implement `DecisionReviewService` class
- [ ] Implement all formatter methods with graceful degradation
- [ ] Implement basic review fallback
- [ ] Add telemetry for ISL endpoint usage/failures
- [ ] Add timeout handling per endpoint

### 0.4 Plain-English Templates

Human-readable output templates for critique sections.

**File:** `src/cee/decision-review/templates.ts`

```typescript
export const TEMPLATES = {
  assumptionWarning: `
⚠️ **Critical Assumption:** {{assumption}}
Your conclusion depends heavily on this. If wrong by 10%,
outcomes could shift by {{impact}}.
**Suggestion:** {{recommendation}}
`,

  actionableAlternative: `
💡 **Alternative Path:**
Instead of {{current}}, consider {{suggested}}.
Expected improvement: {{expectedImprovement}}
Effort: {{effort}}
`,

  confidenceStatement: `
📊 **Confidence:** {{coverage}}% guaranteed
Outcome range: {{lower}} – {{upper}}
{{plainEnglish}}
`,

  modelImprovement: `
🔧 **Improvement ({{priority}}):** {{description}}
Category: {{category}}
Action: {{action}}
`,

  islUnavailable: `
ℹ️ **Note:** Advanced analysis features are temporarily unavailable.
This review is based on core decision analysis only.
`,
};
```

**Tasks:**
- [ ] Create template file
- [ ] Implement template interpolation helper
- [ ] Add Markdown formatting utilities
- [ ] Test template rendering

### 0.5 Route Integration

Wire the enhanced review into the existing CEE Decision Review route.

**Files to modify:**
- `src/routes/assist.decision-review.ts` (or equivalent)
- `src/server.ts` - Service initialization

**Tasks:**
- [ ] Initialize `DecisionReviewService` with ISL client
- [ ] Update route handler to use enhanced review
- [ ] Add `enhanced: boolean` query param to opt-in/out
- [ ] Add response schema for enhanced review
- [ ] Update OpenAPI spec

### 0.6 Testing (Target: 30+ tests)

Comprehensive test coverage with emphasis on graceful degradation.

**File:** `tests/unit/decision-review-enhanced.test.ts`

**Test categories:**

```typescript
describe('Enhanced Decision Review', () => {
  describe('Full ISL Integration', () => {
    it('should integrate all 4 ISL endpoints when available');
    it('should include assumption warnings from sensitivity');
    it('should include actionable alternatives from contrastive');
    it('should include confidence statement from conformal');
    it('should include model improvements from validation');
    it('should track all endpoints used in metadata');
  });

  describe('Graceful Degradation - Single Endpoint Failures', () => {
    it('should work without sensitivity data');
    it('should work without contrastive data');
    it('should work without conformal data');
    it('should work without validation data');
    it('should still include working endpoint data');
  });

  describe('Graceful Degradation - Multiple Failures', () => {
    it('should work with only sensitivity available');
    it('should work with only contrastive available');
    it('should work with only conformal available');
    it('should work with only validation available');
  });

  describe('Graceful Degradation - Total ISL Failure', () => {
    it('should fall back to basic review when all ISL fails');
    it('should emit telemetry for ISL fallback');
    it('should set islAvailable to false');
    it('should return empty ISL arrays');
  });

  describe('Assumption Warnings Formatting', () => {
    it('should format critical assumptions correctly');
    it('should calculate impact string from elasticity');
    it('should limit to 5 warnings maximum');
    it('should sort by sensitivity');
  });

  describe('Actionable Alternatives Formatting', () => {
    it('should limit to 3 alternatives');
    it('should assess effort correctly');
    it('should format current/suggested values');
  });

  describe('Confidence Statement Formatting', () => {
    it('should generate plain English explanation');
    it('should format coverage as percentage');
    it('should handle edge case intervals');
  });

  describe('Model Improvements Formatting', () => {
    it('should categorize improvements correctly');
    it('should prioritize improvements');
    it('should limit to 5 improvements');
  });

  describe('Telemetry', () => {
    it('should emit event with endpoint counts');
    it('should emit fallback event when ISL unavailable');
  });

  describe('Templates', () => {
    it('should render assumption warning template');
    it('should render actionable alternative template');
    it('should render confidence statement template');
    it('should render ISL unavailable notice');
  });
});
```

**Tasks:**
- [ ] Write tests for full ISL integration (5 tests)
- [ ] Write tests for single endpoint failures (5 tests)
- [ ] Write tests for multiple failures (4 tests)
- [ ] Write tests for total ISL failure (4 tests)
- [ ] Write tests for assumption formatting (4 tests)
- [ ] Write tests for alternative formatting (3 tests)
- [ ] Write tests for confidence formatting (3 tests)
- [ ] Write tests for improvement formatting (3 tests)
- [ ] Write tests for telemetry (2 tests)
- [ ] Write tests for templates (4 tests)
- [ ] Total: 37 tests

### 0.7 Integration Tests

End-to-end tests with mocked ISL.

**File:** `tests/integration/decision-review-enhanced.test.ts`

**Tasks:**
- [ ] Test full request/response cycle
- [ ] Test with ISL fixture responses
- [ ] Test circuit breaker integration
- [ ] Test timeout handling

---

## Phase 0 Success Criteria

- [ ] Integrates 4 ISL endpoints (`sensitivity`, `contrastive`, `conformal`, `validation`)
- [ ] Graceful degradation when any/all ISL endpoints unavailable
- [ ] Assumption warnings surfaced from sensitivity analysis
- [ ] Actionable alternatives from contrastive explanations
- [ ] Confidence statements from conformal prediction
- [ ] Model improvements from validation strategies
- [ ] 30+ tests passing (target: 37)
- [ ] Templates for plain-English output
- [ ] Telemetry for ISL usage tracking
- [ ] OpenAPI spec updated

---

## Phase 1: Prompt Management CEE Integration (Priority: HIGH)

**Goal:** Route CEE flows through the prompt loader to enable runtime prompt switching.

### 1.1 Create Default Prompt Registry

Register all current inline prompts as defaults during server initialization.

**Files to modify:**
- `src/server.ts` - Add prompt registration on startup
- New: `src/prompts/defaults.ts` - Centralized default prompt definitions

**Tasks:**
- [ ] Audit all CEE routes to identify inline system prompts
- [ ] Extract prompts to `src/prompts/defaults.ts` with `registerDefaultPrompt()` calls
- [ ] Call registration in `server.ts` before routes are registered
- [ ] Add tests verifying all CEE tasks have registered defaults

**CEE Tasks to cover:**
- `draft_graph` - Draft graph generation
- `suggest_options` - Option suggestions
- `repair_graph` - Graph repair
- `clarify_brief` - Brief clarification questions
- `critique_graph` - Graph critique
- `bias_check` - Bias detection
- `evidence_helper` - Evidence suggestions
- `sensitivity_coach` - Sensitivity analysis
- `explainer` - Decision explanations
- `preflight` - Preflight validation
- `decision_review` - Decision review (NEW from Phase 0)

### 1.2 Wire CEE Routes to Loader

Replace inline prompts with `loadPrompt()` calls.

**Files to modify:**
- `src/routes/assist.draft-graph.ts`
- `src/routes/assist.clarify-brief.ts`
- `src/routes/assist.critique-graph.ts`
- `src/cee/bias/index.ts`
- `src/cee/evidence-helper.ts`
- `src/cee/sensitivity-coach.ts`
- `src/cee/decision-review/service.ts` (from Phase 0)
- (others as identified in 1.1)

**Pattern:**
```typescript
// Before
const systemPrompt = `You are an expert decision analyst...`;

// After
import { loadPromptSync } from '../prompts/index.js';

// In route initialization
registerDefaultPrompt('draft_graph', `You are an expert decision analyst...`);

// In request handler
const systemPrompt = loadPromptSync('draft_graph', {
  maxNodes: config.cee.maxNodes,
  maxEdges: config.cee.maxEdges,
});
```

**Tasks:**
- [ ] Update `draft_graph` route (pilot implementation)
- [ ] Add integration test verifying prompt source switching
- [ ] Roll out to remaining CEE routes
- [ ] Update CEE tests to use registered defaults

### 1.3 Add Staging/A/B Support to CEE

Enable experimental prompt variants via correlation ID.

**Files to modify:**
- CEE route handlers
- `src/prompts/loader.ts` (if additional options needed)

**Tasks:**
- [ ] Pass `correlationId` to `loadPrompt()` for experiment assignment
- [ ] Add `useStaging` option support for pre-production testing
- [ ] Document how to run prompt experiments

---

## Phase 2: Observability & Documentation (Priority: HIGH)

**Goal:** Production-grade monitoring and operational documentation.

### 2.1 Surface Store Health in Diagnostics

**Files to modify:**
- `src/server.ts` - Add to `/diagnostics` endpoint

**Tasks:**
- [ ] Add `promptStore` section to diagnostics response:
  ```json
  {
    "promptStore": {
      "initialized": true,
      "healthy": true,
      "enabled": true,
      "storePath": "data/prompts.json",
      "promptCount": 5,
      "productionPrompts": ["draft_graph", "clarify_brief"]
    }
  }
  ```
- [ ] Add health check to `/healthz` (degraded if store unhealthy but not critical)

### 2.2 Wire Telemetry to Metrics

**Files to modify:**
- `src/utils/telemetry.ts` - Add StatsD mappings
- `src/config/datadog.ts` (or equivalent)

**Events to track as metrics:**
| Event | Metric Type | Tags |
|-------|-------------|------|
| `prompt.store_error` | Counter | `operation`, `error` |
| `prompt.loader.error` | Counter | `task_id` |
| `prompt.loader.store` | Counter | `task_id`, `version` |
| `prompt.loader.default` | Counter | `task_id` |
| `prompt.compiled` | Counter | `task_id`, `version` |
| `prompt.hash_mismatch` | Counter | `prompt_id` |
| `admin.prompt.access` | Counter | `action` |
| `cee.decision_review.generated` | Counter | `isl_available` |
| `cee.decision_review.isl_fallback` | Counter | `reason` |

**Tasks:**
- [ ] Add metric mappings to telemetry config
- [ ] Create Datadog dashboard for prompt system health
- [ ] Create Datadog dashboard for Decision Review ISL usage
- [ ] Define SLOs:
  - Store initialization success rate > 99.9%
  - Prompt loader error rate < 0.1%
  - Default fallback rate (when prompts.enabled) < 1%
  - Decision Review ISL availability > 95%

### 2.3 Documentation

**New files:**
- `Docs/cee/prompt-management.md` - User guide
- `Docs/cee/prompt-runbook.md` - Operational runbook
- `Docs/cee/decision-review-enhanced.md` - Enhanced review guide

**Prompt Management Guide contents:**
- How to enable (`config.prompts.*` settings)
- Admin API reference
- Admin UI walkthrough
- Prompt lifecycle (draft → staging → production → archived)
- Variable interpolation syntax
- A/B experiment setup

**Decision Review Enhanced Guide contents:**
- ISL integration overview
- Enhanced fields explained
- Graceful degradation behavior
- Telemetry and monitoring

**Runbook contents:**
- Failure modes and recovery
  - Store initialization failure
  - Braintrust unavailable
  - Hash mismatch detected
  - ISL endpoints unavailable
- Emergency procedures
  - Disable prompt management quickly
  - Roll back a bad prompt version
  - Force fallback to defaults
  - Disable enhanced review features
- Troubleshooting guide

**Tasks:**
- [ ] Write prompt management guide
- [ ] Write decision review enhanced guide
- [ ] Write operational runbook
- [ ] Add link from main README

---

## Phase 3: Security Hardening (Priority: MEDIUM)

**Goal:** Enterprise-grade security posture for admin interface.

### 3.1 Self-Host Alpine.js

Remove CDN dependency for strict CSP compliance.

**Files to modify:**
- `src/routes/admin.ui.ts`
- New: `public/admin/alpine.min.js`

**Tasks:**
- [ ] Download Alpine.js and add to repo
- [ ] Update admin UI to serve from local path
- [ ] Add build step to minify/update Alpine version

### 3.2 Add Content Security Policy

**Files to modify:**
- `src/routes/admin.ui.ts` - Add CSP header

**Tasks:**
- [ ] Add strict CSP for `/admin/*` routes:
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
  ```
- [ ] Test that admin UI works with CSP
- [ ] Add CSP violation reporting (optional)

### 3.3 IP Allowlist Support (Optional)

For highly regulated environments.

**Files to modify:**
- `src/config/index.ts` - Add `prompts.adminAllowedIPs`
- `src/routes/admin.prompts.ts` - Add IP check

**Tasks:**
- [ ] Add `ADMIN_ALLOWED_IPS` config (comma-separated)
- [ ] Check request IP in `verifyAdminKey()`
- [ ] Log blocked attempts via telemetry
- [ ] Document in runbook

### 3.4 Read/Write Key Separation (Optional)

Split admin capabilities for principle of least privilege.

**Config:**
```
ADMIN_API_KEY_READ=...   # List, get, diff only
ADMIN_API_KEY_WRITE=...  # Full access
```

**Tasks:**
- [ ] Add key type to config schema
- [ ] Update `verifyAdminKey()` to check permission level
- [ ] Return 403 for write operations with read-only key

---

## Phase 4: Scalability (Priority: LOW - Future)

**Goal:** Support multi-node deployments with concurrent admin activity.

### 4.1 Abstract Store Interface

Prepare for pluggable backends.

**Files to create:**
- `src/prompts/stores/interface.ts` - Abstract store interface
- `src/prompts/stores/file.ts` - Current implementation
- `src/prompts/stores/postgres.ts` - DB implementation

**Tasks:**
- [ ] Define `IPromptStore` interface
- [ ] Refactor current `PromptStore` to implement interface
- [ ] Update `getPromptStore()` to select implementation based on config

### 4.2 Postgres Store Implementation

**Schema:**
```sql
CREATE TABLE prompts (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  description TEXT,
  task_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  active_version INT NOT NULL DEFAULT 1,
  staging_version INT,
  tags TEXT[], -- PostgreSQL array
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE prompt_versions (
  prompt_id VARCHAR(128) REFERENCES prompts(id),
  version INT NOT NULL,
  content TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  content_hash CHAR(64) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_note TEXT,
  PRIMARY KEY (prompt_id, version)
);

-- Enforce single production per task
CREATE UNIQUE INDEX idx_single_production
ON prompts (task_id)
WHERE status = 'production';
```

**Tasks:**
- [ ] Add Postgres client dependency
- [ ] Implement `PostgresPromptStore`
- [ ] Add migration scripts
- [ ] Update config to support `PROMPTS_STORE_TYPE=postgres|file`
- [ ] Add connection pooling and retry logic

### 4.3 Cache Layer (Optional)

For high-throughput CEE deployments.

**Tasks:**
- [ ] Add in-memory prompt cache with TTL
- [ ] Add cache invalidation on writes
- [ ] Add `prompt.cache.hit` / `prompt.cache.miss` metrics

---

## Implementation Timeline

| Phase | Scope | Estimated Effort |
|-------|-------|------------------|
| **Phase 0** | **CEE Decision Review Enhancement** | **3-4 days** |
| Phase 1 | Prompt Management CEE Integration | 2-3 days |
| Phase 2 | Observability & Docs | 1-2 days |
| Phase 3 | Security Hardening | 1-2 days |
| Phase 4 | Scalability | 3-5 days (when needed) |

**Recommended order:** 0 → 1 → 2 → 3 → 4

Phase 4 should only be started when there's a concrete multi-node deployment requirement.

---

## Success Criteria

### Phase 0 Complete When:
- [ ] 4 ISL endpoints integrated
- [ ] Graceful degradation working for all failure scenarios
- [ ] 30+ tests passing
- [ ] Enhanced review schema in OpenAPI
- [ ] Templates rendering correctly

### Phase 1 Complete When:
- [ ] All CEE routes use `loadPrompt()` / `loadPromptSync()`
- [ ] Default prompts registered for all 11 CEE tasks (including decision_review)
- [ ] Existing tests pass with no behavior change
- [ ] New integration test verifies store → route flow

### Phase 2 Complete When:
- [ ] `/diagnostics` includes prompt store status
- [ ] Metrics appear in Datadog/monitoring
- [ ] Documentation merged and linked from README

### Phase 3 Complete When:
- [ ] Admin UI works without external CDN
- [ ] CSP header present on all `/admin/*` routes
- [ ] Security scan passes (no XSS, injection vectors)

### Phase 4 Complete When:
- [ ] Postgres store passes all existing tests
- [ ] Two app instances can safely manage prompts concurrently
- [ ] Single-production constraint enforced at DB level

---

## References

- [ISL Adapter](../../src/adapters/isl/)
- [Prompt Schema](../../src/prompts/schema.ts)
- [Prompt Store](../../src/prompts/store.ts)
- [Prompt Loader](../../src/prompts/loader.ts)
- [Admin Routes](../../src/routes/admin.prompts.ts)
- [Admin UI](../../src/routes/admin.ui.ts)
- [Config](../../src/config/index.ts)
