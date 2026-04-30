/**
 * V5 alpha hardening Phase 3 — replay harness shared types.
 */

import type { OutcomeClass } from './classify-outcome.js';

export type StepStatus = 'passed' | 'failed' | 'skipped' | 'transient_failure';

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
  /**
   * Full redacted `assistant_text` from the response body, captured per-step
   * so reviewers can audit denial-phrase regressions and content drift
   * directly from the evidence pack. The pre-fix baseline showed the harness
   * passed structurally on Step 5 (text_len=1497) while curl on the same
   * staging build returned a denial phrase — text persistence closes that
   * blind spot. Always redacted via `redactString` before write.
   */
  readonly assistant_text?: string;
  /**
   * Non-fatal observations from the new (Wave 1–3) assertions: missing
   * coaching on a draft, unobservable decision-review enrichment, lenient
   * internal-term hits, etc. Surfaced in the per-step feature observation
   * table without affecting pass/fail.
   */
  readonly warnings?: ReadonlyArray<string>;
  /**
   * Short tags describing what features this step's response actually
   * exhibited (e.g. `coaching`, `node_provenance`, `staleness_prefix`,
   * `rerun_chip`). Drives the per-step feature observation table.
   */
  readonly features_observed?: ReadonlyArray<string>;
  /**
   * Endpoint label for the per-step feature observation table.
   * Defaults to `'orchestrate/v2/turn'` when the step uses postTurn,
   * `'assist/v1/draft-graph'` for the assist-route step.
   */
  readonly endpoint?: string;
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
  /**
   * V5 wire field stamped by `run_analysis` handler turns. Shape is
   * `AnalysisReadyPayload` from src/schemas/analysis-ready.ts. Carried as
   * `unknown` here because the harness narrows it with a cast at the
   * use-site rather than maintaining a parallel type definition.
   */
  readonly analysis_ready?: unknown;
  /**
   * V5 wire field stamped on draft-graph turns. The harness consumes only
   * `draft_graph.nodes[]` to extract option labels for downstream
   * label-reference assertions.
   */
  readonly draft_graph?: unknown;
  // BoundaryError shape (4xx/5xx). All optional — present only on the
  // error envelope path.
  readonly error?: string;
  readonly boundary?: string;
  readonly direction?: string;
  readonly validator?: string;
  readonly details?: Record<string, unknown>;
  readonly request_id?: string;
  readonly retryable?: boolean;
  // error.v1 envelope shape (auth + top-level validation errors).
  readonly schema?: string;
  readonly code?: string;
  readonly message?: string;
  // Sentinel set by client.ts when the response body is non-JSON or
  // empty and could not be parsed. Distinguishes "200 with empty
  // body" (where this sentinel is set) from "200 with valid empty
  // object" (where it isn't).
  //
  // We deliberately do NOT carry the raw body bytes — proxy or
  // runtime error pages can echo user input or other sensitive
  // content. The fingerprint (length + content-type + sha256 prefix)
  // is enough to triage without exfiltrating the body into the
  // committed evidence markdown.
  readonly __body_parse_failed?: true;
  readonly __body_length?: number;
  readonly __body_content_type?: string;
  readonly __body_sha256_prefix?: string;
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
  /**
   * Strict-mode opt-in. When set, the deploy gate halts unless the
   * /healthz `build` field equals this value. Resolved from
   * `--expected-build` CLI flag (preferred) or `OLUMI_REPLAY_EXPECTED_BUILD`
   * env var. When unset, the gate only confirms that `build` is
   * well-formed.
   */
  readonly expectedBuild?: string;
  /**
   * Minimum-build SHA the deploy must be at-or-after for the new
   * coaching / provenance / recovery / output-safety assertions to be
   * meaningful. Resolved from `--min-build` flag (preferred) or
   * `OLUMI_REPLAY_MIN_BUILD` env var, defaulting to the merge SHA of
   * commit `a555cf7` (`feat(cee): expose coaching + per-node/edge
   * provenance on /assist/v1/draft-graph`). Verified via local
   * `git merge-base --is-ancestor`; see `min-build.ts`.
   */
  readonly minBuild?: string;
}
