/**
 * Model-resolution gate as pure data-in/data-out (quarantined scaffold — not
 * imported by any live path).
 *
 * Extracts the m2-review inline gate's DECISION logic with exact parity
 * (verified by table tests mirroring m2-review.test.ts): the configured model
 * must be explicitly set, the router's resolution must land on a
 * structured-outputs-capable provider, and the resolved model must equal the
 * configured one exactly — anything else is a coded inert condition, never a
 * silent fallback.
 *
 * PURE by design: no imports from config/, adapters/, or dual-draft/. The
 * caller supplies the configured value and the resolution record, so this
 * module can never trigger adapter construction or a live call. Swapping
 * m2-review.ts onto this helper is a live-path refactor — findings-and-
 * handoff only (Docs/v6/handoff-shared-robustness-swaps.md), NOT this branch.
 */

/** Providers whose adapters implement ChatArgs.outputSchema (D2 ruling). */
export const STRUCTURED_OUTPUT_PROVIDERS = ['anthropic', 'fixtures'] as const;

/** The subset of the router's AdapterWithResolution.resolution this gate reads. */
export interface ModelResolutionLike {
  readonly provider: string;
  readonly resolved_model: string;
  readonly resolution_source?: string;
}

/** Coded gate outcome — mirrors M2ModelResolutionCause plus the ok arm. */
export type ModelGateResult =
  | { readonly ok: true; readonly model: string }
  | { readonly ok: false; readonly cause: 'model_unset'; readonly detail: string }
  | { readonly ok: false; readonly cause: 'provider_unsupported'; readonly detail: string }
  | { readonly ok: false; readonly cause: 'model_mismatch'; readonly detail: string };

export interface ModelGateOptions {
  /** Acceptable providers. Default: STRUCTURED_OUTPUT_PROVIDERS. */
  readonly allowedProviders?: readonly string[];
}

/**
 * Checks a model resolution against an explicitly configured expectation.
 * Check order matches the m2-review gate: unset → provider → exact match.
 */
export function checkModelResolution(
  configuredModel: string | null | undefined,
  resolution: ModelResolutionLike | null,
  opts?: ModelGateOptions,
): ModelGateResult {
  if (!configuredModel) {
    return { ok: false, cause: 'model_unset', detail: 'expected model not configured' };
  }
  if (resolution === null) {
    return { ok: false, cause: 'model_mismatch', detail: 'no resolution available' };
  }
  const allowed = opts?.allowedProviders ?? STRUCTURED_OUTPUT_PROVIDERS;
  if (!allowed.includes(resolution.provider)) {
    return {
      ok: false,
      cause: 'provider_unsupported',
      detail: `provider "${resolution.provider}" not in [${allowed.join(', ')}]`,
    };
  }
  if (resolution.resolved_model !== configuredModel) {
    return {
      ok: false,
      cause: 'model_mismatch',
      detail: `resolved "${resolution.resolved_model}" != configured "${configuredModel}"${
        resolution.resolution_source ? ` (source: ${resolution.resolution_source})` : ''
      }`,
    };
  }
  return { ok: true, model: configuredModel };
}
