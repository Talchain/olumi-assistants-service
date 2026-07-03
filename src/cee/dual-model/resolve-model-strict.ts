/**
 * Strict (no-fallback) model resolution candidate (quarantined scaffold —
 * not imported by any live path, NOT swapped into m2-review or the router).
 *
 * The router's precedence chain happily falls back (task default →
 * providers.json → LLM_MODEL fallback), which is right for general chat but
 * wrong for activation-critical slots like m2_graph_review: those must run
 * on EXACTLY the operator-configured model or stay inert. m2-review.ts
 * implements that gate inline today; this module generalises it for any
 * future strict slot. Decision logic is delegated to the pure
 * checkModelResolution (model-resolution.ts) so the two cannot drift.
 *
 * Live-call safety: the default resolver is getAdapterWithResolution, which
 * CONSTRUCTS an adapter but never calls it — same as the live m2 gate.
 * Resolver exceptions propagate to the caller (parity with m2-review, whose
 * caller maps throws to internal_error). Swapping m2-review onto this helper
 * is a live-path refactor — see Docs/v6/handoff-shared-robustness-swaps.md.
 */
import {
  getAdapterWithResolution,
  type AdapterWithResolution,
  type ResolutionSource,
} from '../../adapters/llm/router.js';
import type { LLMAdapter } from '../../adapters/llm/types.js';
import { checkModelResolution, STRUCTURED_OUTPUT_PROVIDERS } from './model-resolution.js';

export type StrictResolution =
  | {
      readonly kind: 'ok';
      readonly model: string;
      readonly provider: string;
      readonly source: ResolutionSource;
      readonly adapter: LLMAdapter;
    }
  | { readonly kind: 'model_unset'; readonly detail: string }
  | { readonly kind: 'provider_unsupported'; readonly provider: string; readonly detail: string }
  | {
      readonly kind: 'model_mismatch';
      readonly resolved: string;
      readonly source: ResolutionSource;
      readonly detail: string;
    };

export interface ResolveModelStrictOpts {
  /** Acceptable providers. Default mirrors the m2 gate (structured outputs). */
  readonly allowedProviders?: readonly string[];
  /** Injectable for tests / dry-run tooling. Default: getAdapterWithResolution. */
  readonly resolver?: (task: string) => AdapterWithResolution;
}

/**
 * Resolves `task` and requires the outcome to be exactly `expectedModel` on
 * an allowed provider. Any other outcome is a coded inert condition.
 */
export function resolveModelStrict(
  task: string,
  expectedModel: string | null | undefined,
  opts?: ResolveModelStrictOpts,
): StrictResolution {
  if (!expectedModel) {
    return { kind: 'model_unset', detail: `expected model for task "${task}" not configured` };
  }

  const resolver = opts?.resolver ?? getAdapterWithResolution;
  const { adapter, resolution } = resolver(task);
  const provider = resolution.provider ?? 'unknown';

  const gate = checkModelResolution(
    expectedModel,
    { provider, resolved_model: resolution.resolved_model, resolution_source: resolution.resolution_source },
    { allowedProviders: opts?.allowedProviders ?? STRUCTURED_OUTPUT_PROVIDERS },
  );

  if (gate.ok) {
    return {
      kind: 'ok',
      model: gate.model,
      provider,
      source: resolution.resolution_source,
      adapter,
    };
  }
  switch (gate.cause) {
    case 'model_unset':
      return { kind: 'model_unset', detail: gate.detail };
    case 'provider_unsupported':
      return { kind: 'provider_unsupported', provider, detail: gate.detail };
    case 'model_mismatch':
      return {
        kind: 'model_mismatch',
        resolved: resolution.resolved_model,
        source: resolution.resolution_source,
        detail: gate.detail,
      };
  }
}
