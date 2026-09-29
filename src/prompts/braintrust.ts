/**
 * Braintrust Integration
 *
 * Provides experiment tracking and A/B testing for prompts using Braintrust.
 * Falls back gracefully when Braintrust is not configured.
 *
 * To enable Braintrust:
 * 1. Install: pnpm add braintrust
 * 2. Set BRAINTRUST_API_KEY environment variable
 * 3. Enable in config: PROMPTS_BRAINTRUST_ENABLED=true
 */

import { log, emit } from '../utils/telemetry.js';
import { config } from '../config/index.js';

/**
 * Braintrust client interface (matches braintrust SDK)
 */
interface BraintrustClient {
  init: (options: { apiKey: string; project: string }) => void;
  startSpan: (name: string, options?: Record<string, unknown>) => BraintrustSpan;
  logFeedback: (options: {
    id: string;
    scores: Record<string, number>;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
}

interface BraintrustSpan {
  id: string;
  log: (data: Record<string, unknown>) => void;
  end: (options?: { output?: unknown; scores?: Record<string, number> }) => void;
}

/**
 * Experiment tracking configuration
 */
export interface ExperimentConfig {
  /** Experiment name */
  name: string;
  /** Prompt ID being tested */
  promptId: string;
  /** Version A (control) */
  versionA: number;
  /** Version B (variant) */
  versionB: number;
  /** Traffic split for version B (0.0 - 1.0) */
  trafficSplit: number;
  /** Whether the experiment is active */
  active: boolean;
  /** Experiment start time */
  startedAt: string;
  /** Optional end time */
  endedAt?: string;
}

/**
 * Experiment result tracking
 */
export interface ExperimentResult {
  experimentName: string;
  promptId: string;
  version: number;
  /** Request correlation ID */
  correlationId: string;
  /** Input provided to the prompt */
  input: Record<string, unknown>;
  /** Output from the LLM */
  output: unknown;
  /** Latency in milliseconds */
  latencyMs: number;
  /** Scores from automated evaluation */
  scores?: Record<string, number>;
  /** User feedback score (if available) */
  userFeedback?: number;
  /** Timestamp */
  timestamp: string;
}

/**
 * Telemetry events
 */
const BraintrustTelemetryEvents = {
  ExperimentStarted: 'prompt.experiment.started',
  ExperimentEnded: 'prompt.experiment.ended',
  ExperimentResultLogged: 'prompt.experiment.result_logged',
  ExperimentAssignment: 'prompt.experiment.assignment',
  BraintrustError: 'prompt.braintrust.error',
} as const;

/**
 * Braintrust client wrapper
 * Provides graceful fallback when Braintrust is not available
 */
export class BraintrustManager {
  private client: BraintrustClient | null = null;
  private initialized = false;
  private experiments: Map<string, ExperimentConfig> = new Map();
  private results: ExperimentResult[] = []; // In-memory fallback

  constructor() {
    // Client will be lazily initialized
  }

  /**
   * Initialize the Braintrust client
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return this.client !== null;
    }

    const enabled = config.prompts?.braintrustEnabled === true;
    // API key must still come from environment (not stored in config for security)
    // eslint-disable-next-line no-restricted-syntax -- Security: API key not stored in config
    const apiKey = process.env.BRAINTRUST_API_KEY;

    if (!enabled) {
      log.info('Braintrust integration disabled');
      this.initialized = true;
      return false;
    }

    if (!apiKey) {
      log.warn('BRAINTRUST_API_KEY not set, experiment tracking disabled');
      this.initialized = true;
      return false;
    }

    try {
      // Dynamically import braintrust SDK (optional dependency)
      // Uses a variable for the module name to avoid TypeScript module resolution errors
      const moduleName = 'braintrust';
      const braintrust = await import(moduleName).catch(
        () => null
      ) as BraintrustClient | null;

      if (!braintrust) {
        log.warn('braintrust package not installed, experiment tracking disabled');
        this.initialized = true;
        return false;
      }

      this.client = braintrust;
      this.client.init({
        apiKey,
        project: config.prompts?.braintrustProject ?? 'olumi-prompts',
      });

      log.info('Braintrust client initialized');
      this.initialized = true;
      return true;
    } catch (error) {
      log.error({ error }, 'Failed to initialize Braintrust client');
      emit(BraintrustTelemetryEvents.BraintrustError, {
        operation: 'initialize',
        error: String(error),
      });
      this.initialized = true;
      return false;
    }
  }

  /**
   * Check if Braintrust is available
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  // =========================================================================
  // Experiment Management
  // =========================================================================

  /**
   * Start a new A/B experiment
   */
  startExperiment(config: Omit<ExperimentConfig, 'startedAt' | 'active'>): void {
    const experiment: ExperimentConfig = {
      ...config,
      active: true,
      startedAt: new Date().toISOString(),
    };

    this.experiments.set(config.name, experiment);

    emit(BraintrustTelemetryEvents.ExperimentStarted, {
      name: config.name,
      promptId: config.promptId,
      versionA: config.versionA,
      versionB: config.versionB,
      trafficSplit: config.trafficSplit,
    });

    log.info(
      {
        name: config.name,
        promptId: config.promptId,
        trafficSplit: config.trafficSplit,
      },
      'Experiment started'
    );
  }

  /**
   * End an experiment
   */
  endExperiment(name: string): void {
    const experiment = this.experiments.get(name);
    if (!experiment) {
      return;
    }

    experiment.active = false;
    experiment.endedAt = new Date().toISOString();

    emit(BraintrustTelemetryEvents.ExperimentEnded, {
      name,
      duration_ms: Date.parse(experiment.endedAt) - Date.parse(experiment.startedAt),
    });

    log.info({ name }, 'Experiment ended');
  }

  /**
   * Get experiment assignment for a request
   * Uses deterministic hashing for consistent assignment
   */
  getExperimentAssignment(
    promptId: string,
    correlationId: string
  ): { version: number; experimentName: string } | null {
    // Find active experiment for this prompt
    const experiment = Array.from(this.experiments.values()).find(
      e => e.promptId === promptId && e.active
    );

    if (!experiment) {
      return null;
    }

    // Deterministic assignment based on correlation ID
    const hash = this.hashString(correlationId);
    const bucket = hash % 100;
    const isVariant = bucket < experiment.trafficSplit * 100;

    const version = isVariant ? experiment.versionB : experiment.versionA;

    emit(BraintrustTelemetryEvents.ExperimentAssignment, {
      experimentName: experiment.name,
      promptId,
      version,
      isVariant,
      correlationId,
    });

    return {
      version,
      experimentName: experiment.name,
    };
  }

  /**
   * Simple string hash for deterministic bucketing
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  // =========================================================================
  // Result Tracking
  // =========================================================================

  /**
   * Log an experiment result
   */
  async logResult(result: ExperimentResult): Promise<void> {
    // Always store locally
    this.results.push(result);

    // Log to Braintrust if available
    if (this.client) {
      try {
        const span = this.client.startSpan(result.experimentName, {
          promptId: result.promptId,
          version: result.version,
        });

        span.log({
          input: result.input,
          output: result.output,
          latency_ms: result.latencyMs,
          timestamp: result.timestamp,
        });

        span.end({
          output: result.output,
          scores: result.scores,
        });

        if (result.userFeedback !== undefined) {
          await this.client.logFeedback({
            id: span.id,
            scores: { user_feedback: result.userFeedback },
            metadata: { correlationId: result.correlationId },
          });
        }
      } catch (error) {
        log.error({ error, result }, 'Failed to log result to Braintrust');
        emit(BraintrustTelemetryEvents.BraintrustError, {
          operation: 'logResult',
          error: String(error),
        });
      }
    }

    emit(BraintrustTelemetryEvents.ExperimentResultLogged, {
      experimentName: result.experimentName,
      promptId: result.promptId,
      version: result.version,
      hasScores: !!result.scores,
      hasFeedback: result.userFeedback !== undefined,
    });
  }

  /**
   * Get results for an experiment (local storage)
   */
  getResults(experimentName: string): ExperimentResult[] {
    return this.results.filter(r => r.experimentName === experimentName);
  }

  /**
   * Get experiment statistics
   */
  getExperimentStats(experimentName: string): {
    versionA: { count: number; avgLatency: number; avgScore: number };
    versionB: { count: number; avgLatency: number; avgScore: number };
  } | null {
    const experiment = this.experiments.get(experimentName);
    if (!experiment) {
      return null;
    }

    const results = this.getResults(experimentName);
    const versionAResults = results.filter(r => r.version === experiment.versionA);
    const versionBResults = results.filter(r => r.version === experiment.versionB);

    const calcStats = (arr: ExperimentResult[]) => ({
      count: arr.length,
      avgLatency: arr.length > 0
        ? arr.reduce((sum, r) => sum + r.latencyMs, 0) / arr.length
        : 0,
      avgScore: arr.length > 0
        ? arr.reduce((sum, r) => sum + (r.userFeedback ?? 0), 0) / arr.length
        : 0,
    });

    return {
      versionA: calcStats(versionAResults),
      versionB: calcStats(versionBResults),
    };
  }
}

// =========================================================================
// Scorers for Automated Evaluation
// =========================================================================

/**
 * Scorer function type
 */
export type Scorer = (
  input: Record<string, unknown>,
  output: unknown,
  expected?: unknown
) => number | Promise<number>;

/**
 * Built-in scorers for prompt evaluation
 */
export const Scorers = {
  /**
   * Score based on JSON validity
   */
  jsonValidity: ((_input, output) => {
    if (typeof output !== 'string') {
      return output !== null && typeof output === 'object' ? 1.0 : 0.0;
    }
    try {
      JSON.parse(output);
      return 1.0;
    } catch {
      return 0.0;
    }
  }) as Scorer,

  /**
   * Score based on output length (normalized)
   */
  outputLength: ((input, output) => {
    const minLength = (input.minLength as number) ?? 100;
    const maxLength = (input.maxLength as number) ?? 10000;
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    const length = text.length;

    if (length < minLength) return length / minLength;
    if (length > maxLength) return Math.max(0, 1 - (length - maxLength) / maxLength);
    return 1.0;
  }) as Scorer,

  /**
   * Score based on presence of required fields (for JSON output)
   */
  requiredFields: ((input, output) => {
    const requiredFields = input.requiredFields as string[] ?? [];
    if (requiredFields.length === 0) return 1.0;

    let obj: Record<string, unknown>;
    if (typeof output === 'string') {
      try {
        obj = JSON.parse(output);
      } catch {
        return 0.0;
      }
    } else if (typeof output === 'object' && output !== null) {
      obj = output as Record<string, unknown>;
    } else {
      return 0.0;
    }

    const presentFields = requiredFields.filter(f => f in obj);
    return presentFields.length / requiredFields.length;
  }) as Scorer,

  /**
   * Score based on latency (lower is better)
   */
  latency: ((input, _output) => {
    const latencyMs = input.latencyMs as number ?? 0;
    const targetMs = input.targetLatencyMs as number ?? 5000;
    const maxMs = input.maxLatencyMs as number ?? 30000;

    if (latencyMs <= targetMs) return 1.0;
    if (latencyMs >= maxMs) return 0.0;
    return 1 - (latencyMs - targetMs) / (maxMs - targetMs);
  }) as Scorer,
};

/**
 * Run multiple scorers and aggregate results
 */
export async function runScorers(
  scorers: Record<string, Scorer>,
  input: Record<string, unknown>,
  output: unknown,
  expected?: unknown
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  for (const [name, scorer] of Object.entries(scorers)) {
    try {
      results[name] = await scorer(input, output, expected);
    } catch (error) {
      log.warn({ scorer: name, error }, 'Scorer failed');
      results[name] = 0;
    }
  }

  return results;
}

// =========================================================================
// Singleton Instance
// =========================================================================

let braintrustManager: BraintrustManager | null = null;

/**
 * Get the Braintrust manager instance
 */
export function getBraintrustManager(): BraintrustManager {
  if (!braintrustManager) {
    braintrustManager = new BraintrustManager();
  }
  return braintrustManager;
}

/**
 * Reset the Braintrust manager (for testing)
 */
export function resetBraintrustManager(): void {
  braintrustManager = null;
}
