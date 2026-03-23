/**
 * Diagnostic Trace — in-memory accumulator for pipeline observability.
 *
 * Captures LLM calls, prompt identity, zone 2 assembly, tool policy,
 * provider resolution, structured output config, streaming metrics,
 * and fallback events as they occur during a pipeline turn.
 *
 * Serialised once at response time via `freeze()`. Zero-copy — all
 * captures are append-only pushes to pre-allocated arrays.
 */

// ============================================================================
// Trace data types (response-only, never fed back into LLM context)
// ============================================================================

export interface LLMCallTrace {
  role: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  latency_ms: number;
  stop_reason: string | null;
  thinking_enabled: boolean;
  error: { status: number; type: string; message: string } | null;
}

export interface PromptIdentity {
  task_id: string;
  prompt_id: string;
  version: number | string;
  hash: string;
  source: string;
  is_staging: boolean;
}

export interface Zone2Assembly {
  total_chars: number;
  zone2_chars: number;
  section_count: number;
  sections_present: {
    continuity: boolean;
    graph: boolean;
    analysis: boolean;
    entities: boolean;
    entity_memory: boolean;
    event_log: boolean;
    isl_fields: boolean;
    artefact_appendix: boolean;
  };
}

export interface ToolPolicy {
  stage: string;
  tools_offered: string[];
  tools_permitted: string[];
  filtered_count: number;
}

export interface ProviderResolution {
  task: string;
  env_default_provider: string;
  env_model_override: string | null;
  prompt_config_model: string | null;
  resolved_model: string;
  resolved_provider: string;
  switch_reason: string | null;
}

export interface StructuredOutputConfig {
  enabled: boolean;
  api_shape: string;
  schema_hash: string | null;
  beta_header_present: boolean;
}

export interface StreamingMetrics {
  time_to_first_event_ms: number | null;
  time_to_first_text_delta_ms: number | null;
  total_stream_duration_ms: number | null;
  event_count: number;
  text_delta_count: number;
  disconnect_reason: string | null;
}

export interface FallbackTrace {
  stage: string;
  reason: string;
  original_error: string | null;
  fallback_action: string;
  fallback_succeeded: boolean;
}

export interface DiagnosticTrace {
  llm_calls: LLMCallTrace[];
  prompt_identity: PromptIdentity[];
  zone2_assembly: Zone2Assembly | null;
  tool_policy: ToolPolicy | null;
  provider_resolution: ProviderResolution[];
  structured_output_config: StructuredOutputConfig | null;
  streaming_metrics: StreamingMetrics | null;
  fallback_trace: FallbackTrace[];
}

// ============================================================================
// Collector — mutable accumulator, one per pipeline turn
// ============================================================================

export class DiagnosticTraceCollector {
  private llmCalls: LLMCallTrace[] = [];
  private promptIdentities: PromptIdentity[] = [];
  private zone2: Zone2Assembly | null = null;
  private toolPol: ToolPolicy | null = null;
  private providerResolutions: ProviderResolution[] = [];
  private structuredOutputCfg: StructuredOutputConfig | null = null;
  private streamingMet: StreamingMetrics | null = null;
  private fallbacks: FallbackTrace[] = [];

  recordLLMCall(call: LLMCallTrace): void {
    this.llmCalls.push(call);
  }

  recordPromptIdentity(identity: PromptIdentity): void {
    this.promptIdentities.push(identity);
  }

  recordZone2Assembly(assembly: Zone2Assembly): void {
    this.zone2 = assembly;
  }

  recordToolPolicy(policy: ToolPolicy): void {
    this.toolPol = policy;
  }

  recordProviderResolution(resolution: ProviderResolution): void {
    this.providerResolutions.push(resolution);
  }

  recordStructuredOutputConfig(cfg: StructuredOutputConfig): void {
    this.structuredOutputCfg = cfg;
  }

  recordStreamingMetrics(metrics: StreamingMetrics): void {
    this.streamingMet = metrics;
  }

  recordFallback(fallback: FallbackTrace): void {
    this.fallbacks.push(fallback);
  }

  /**
   * Produce an immutable snapshot of all accumulated diagnostic data.
   * Safe to call multiple times — returns a fresh object each time.
   */
  freeze(): DiagnosticTrace {
    return {
      llm_calls: [...this.llmCalls],
      prompt_identity: [...this.promptIdentities],
      zone2_assembly: this.zone2,
      tool_policy: this.toolPol,
      provider_resolution: [...this.providerResolutions],
      structured_output_config: this.structuredOutputCfg,
      streaming_metrics: this.streamingMet,
      fallback_trace: [...this.fallbacks],
    };
  }
}

/**
 * Build an empty DiagnosticTrace — used for error envelopes when no collector
 * was created (e.g. failure before Phase 1 completes).
 */
export function emptyDiagnosticTrace(): DiagnosticTrace {
  return {
    llm_calls: [],
    prompt_identity: [],
    zone2_assembly: null,
    tool_policy: null,
    provider_resolution: [],
    structured_output_config: null,
    streaming_metrics: null,
    fallback_trace: [],
  };
}
