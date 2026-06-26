/**
 * V5 alpha hardening Phase 3 — replay harness shared types.
 */

import type { OutcomeClass } from './classify-outcome.js';
import type { JourneyId } from './steps.js';

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
   * Journey identifier the row was produced under. Optional and additive
   * — pre-DL-7 evidence packs render rows without this field; DL-7
   * journeys stamp it so multi-journey runs (or downstream tooling) can
   * group rows by journey. Optional to preserve backwards-compat with
   * existing harness self-tests.
   */
  readonly journey_id?: JourneyId;
  /**
   * Marks an evidence row as a deliberately skipped PR-B-gated assertion
   * or a `not_applicable` journey enqueue. Distinct from the
   * `status: 'skipped'` cascade-skip — used so downstream tooling can
   * report PR-B-gated counts without conflating with prerequisite
   * cascade misses.
   */
  readonly requires_dl7_pr_b?: true;
  /**
   * Redacted chip details captured per-step. Phase 2.6.4 — added to
   * support triage of staleness-signal-missing failures where the
   * signal may live in a chip's action_type / label / message rather
   * than in the assistant_text. The DL-7 audit specifically asks
   * whether the "rerun analysis" chip is present, and the row table
   * alone shows only `chip_count` — making chip content invisible.
   * Always redacted via `redactString` before write.
   */
  readonly chips?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly message: string;
    readonly action_type?: string;
  }>;
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
  readonly analysis_ready?: {
    readonly status?: unknown;
    readonly options?: unknown;
    readonly goal_node_id?: unknown;
    readonly computed_at?: unknown;
    /**
     * Freshness of the analysis relative to the current persisted graph,
     * serialised on the wire by `analysis-ready-emit.ts`. Derived from a
     * graph-hash comparison (graph_hash_at_run vs the current
     * analysis-affecting graph hash). The assurance journey reads this to
     * prove staleness after a mutation and freshness after a rerun.
     * Values: 'fresh' | 'stale' | 'unknown' | 'none' (typed as string for
     * forward-compat — never assert on an unmodelled literal).
     */
    readonly freshness?: string;
  };
  // Note: `turn_class` and `handler_id` were probed during the DL-7
  // audit but are NOT on the wire response envelope — they are
  // arguments to `commitDirectAnswer` / `append_turn_atomic` (DB
  // persistence) and internal telemetry events only. Replay therefore
  // cannot assert them; coverage lives in edit_graph dispatch unit
  // tests. Do not re-add these fields without first confirming wire
  // serialisation in the boundary schema.
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
   * Journey selector. Optional in the type to keep pre-existing unit-
   * test fixtures (which only need `baseUrl` / `outPath` / `scenarioPrefix`)
   * compiling. The runtime resolves `undefined` to `'canonical'` in
   * `parseConfig()`, so consumers that read `cfg.journey` after CLI
   * parsing observe a concrete `JourneyId`. DL-7 journeys are opted in
   * via the `--journey` CLI flag — see `JOURNEY_REGISTRY` in `./steps.ts`
   * for available ids.
   */
  readonly journey?: JourneyId;
}
