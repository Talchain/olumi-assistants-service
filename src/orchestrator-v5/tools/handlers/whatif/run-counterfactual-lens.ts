/**
 * The what-if (counterfactual) lens — the coach-suggestion EXTENSION that
 * SUBSUMES `what_would_flip`'s single-factor case under a general what-if.
 *
 * Runs ONLY on the `what_would_flip` execute path, AFTER the base flip answer
 * is composed. It chains four steps and FAILS LOUD at every one:
 *
 *   selector → faithful model builder → ISL counterfactual call → claim-safe card
 *
 * Any absence or failure at any step — no client (transport dark / latent),
 * no auditable probe, an unmappable graph, a non-2xx / timeout / network /
 * unparsable ISL result, or a response that does not match the request we sent
 * — returns `null`. The handler then appends NOTHING and the base
 * `what_would_flip` answer is byte-preserved. Nothing here ever fabricates,
 * defaults, or partially-synthesises a value: the lens either has a validated
 * ISL 2xx for the exact intervention it asked about, or it stays silent.
 *
 * A 422 (e.g. ISL's do∩observe rejection) arrives as `reason: 'invalid_input'`
 * and is treated like any other non-success: emit nothing. The builder never
 * places the intervention variable in `context`, so we do not generate that
 * 422 in the first place.
 */

import type { FlipSummary } from '../../../compose/flip-proposal.js';
import type { RawRobustnessSignals } from '../../../coaching/robustness-honesty.js';
import { formatFactorValue } from '../../../compose/format-factor-value.js';
import type { CounterfactualClient } from '../../../../adapters/isl/counterfactual-client.js';

import { selectCounterfactualProbe } from './select-counterfactual-probe.js';
import { buildCounterfactualModel } from './build-counterfactual-model.js';
import {
  composeCounterfactualCard,
  type CounterfactualDirection,
} from './compose-counterfactual-card.js';

export interface RunCounterfactualLensInput {
  /** Injected transport; `null` when ISL is not configured (latent lens). */
  readonly client: CounterfactualClient | null;
  /** Per-turn graph (post-fallback selection), untyped — the builder parses it. */
  readonly graphForTurn: unknown;
  readonly flipSummary: FlipSummary | null | undefined;
  readonly rawRobustness: RawRobustnessSignals | null | undefined;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export interface CounterfactualLensResult {
  /** Claim-safe card to append to the base what_would_flip answer. */
  readonly card: string;
  /** Auditable trigger provenance (telemetry only). */
  readonly trigger: string;
}

/**
 * Run the counterfactual lens, or return `null` to emit nothing. Never throws:
 * every failure mode is a typed `null`.
 */
export async function runCounterfactualLens(
  input: RunCounterfactualLensInput,
): Promise<CounterfactualLensResult | null> {
  // 1. Transport must be reachable. A null client is the honest latent state.
  if (!input.client) return null;

  // 2. Deterministic selector (never an LLM lens choice).
  const probe = selectCounterfactualProbe(input.flipSummary, input.rawRobustness);
  if (!probe) return null;

  // 3. Faithful-or-null model. An unmappable graph emits nothing.
  const built = buildCounterfactualModel(input.graphForTurn, probe);
  if (!built) return null;

  // 4. Call ISL. ANY non-success => emit nothing (fail loud).
  const result = await input.client.getCounterfactual(built.request, input.requestId, {
    signal: input.signal,
  });
  if (!result.ok) return null;

  // Defensive: the response must be for the intervention we asked about, and
  // must carry a finite point estimate. Otherwise treat as no result.
  if (result.response.scenario.outcome !== built.request.outcome) return null;
  if (!Number.isFinite(result.response.prediction.point_estimate)) return null;

  // 5. Claim-safe card (no doctrine-pending outcome number — see composer).
  const { meta } = built;
  const direction: CounterfactualDirection =
    meta.interventionValue > meta.factorCurrentValue
      ? 'raise'
      : meta.interventionValue < meta.factorCurrentValue
        ? 'lower'
        : 'change';
  const targetDisplay = formatFactorValue(meta.interventionValue, meta.factorUnit)?.display ?? null;

  const card = composeCounterfactualCard({
    factorLabel: meta.factorLabel,
    goalLabel: meta.goalLabel,
    direction,
    targetDisplay,
  });

  return { card, trigger: probe.trigger };
}
