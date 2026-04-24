/**
 * V5 alpha hardening Phase 3 — replay harness shared types.
 */

export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface EvidenceRow {
  readonly step: string;
  readonly status: StepStatus;
  readonly evidence: string;
  readonly failing_contract?: string;
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

export interface HarnessConfig {
  readonly baseUrl: string;
  readonly outPath: string;
  readonly scenarioPrefix: string;
}
