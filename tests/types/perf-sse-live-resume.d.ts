declare module "../../perf/sse-live-resume.mjs" {
  export function percentile(sorted: number[], quantile: number): number;

  export interface PerfWindow {
    resume_attempts: number;
    resume_successes: number;
    resume_failures: number;
    buffer_trims: number;
    resume_latencies: number[];
    streams_in_window: number;
    errors_total: number;
    error_types: {
      server_5xx: number;
      client_400: number;
      client_401: number;
      rate_limit_429: number;
      transport: number;
    };
  }

  export function evaluateWindowGates(window: PerfWindow): {
    violations: string[];
    resumeSuccessRate: number;
    trimRate: number;
    maxResumeLatency: number;
    errorRate: number;
  };
}
