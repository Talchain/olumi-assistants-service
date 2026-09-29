export function percentile(sorted: number[], quantile: number): number;

export interface SsePerfWindow {
  resume_attempts: number;
  resume_successes: number;
  resume_failures: number;
  buffer_trims: number;
  resume_latencies: number[];
  streams_in_window: number;
  errors_total: number;
  error_types?: Record<string, number>;
}

export interface WindowGateEvaluation {
  violations: string[];
  resumeSuccessRate: number;
  trimRate: number;
  maxResumeLatency: number;
  errorRate: number;
}

export function evaluateWindowGates(window: SsePerfWindow): WindowGateEvaluation;
