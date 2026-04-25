/**
 * V5 alpha hardening Phase 3 — replay harness shared types.
 */

import type { OutcomeClass } from './classify-outcome.js';

export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface EvidenceRow {
  readonly step: string;
  readonly status: StepStatus;
  readonly evidence: string;
  readonly failing_contract?: string;
  /** Outcome class per v5-replay-proof brief Phase 3. */
  readonly outcome_class: OutcomeClass;
  /** HTTP status received, if the request returned one. */
  readonly http_status?: number;
  /** Prompt metadata captured per-turn, if the response envelope exposes it. */
  readonly prompt_version?: string;
  readonly system_chars?: number;
}

export interface TurnResponse {
  readonly response_version?: number;
  readonly assistant_text?: string;
  readonly blocks?: ReadonlyArray<{ type: string; error_code?: string }>;
  readonly suggested_actions?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly message: string;
    readonly action_type?: string;
  }>;
  readonly insights?: ReadonlyArray<unknown>;
  readonly stage_indicator?: string;
  // For the 5xx BoundaryError shape.
  readonly error?: string;
  readonly boundary?: string;
  readonly details?: Record<string, unknown>;
  readonly retryable?: boolean;
}

/**
 * Public /healthz response shape emitted by `src/server.ts`.
 */
export interface HealthzBody {
  readonly ok?: boolean;
  readonly build?: string;
  readonly version?: string;
  readonly service?: string;
  readonly degraded?: boolean;
  readonly degraded_reasons?: ReadonlyArray<string>;
}

export interface HealthzResult {
  readonly status: number;
  readonly body: HealthzBody | undefined;
  readonly elapsed_ms: number;
}

/**
 * Preflight outcome after a single authenticated probe to
 * `/orchestrate/v2/turn` with a minimal body. Drives halt vs. advance.
 */
export type PreflightVerdict =
  | { readonly kind: 'advance'; readonly status: number; readonly note: string }
  | { readonly kind: 'halt'; readonly status: number; readonly reason: string };

export interface HarnessConfig {
  readonly baseUrl: string;
  readonly outPath: string;
  readonly scenarioPrefix: string;
  /** Loaded from `OLUMI_REPLAY_API_KEY` env var. Undefined for localhost runs. */
  readonly apiKey?: string;
}
