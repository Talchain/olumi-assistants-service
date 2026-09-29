/**
 * ⛔ A RUN'S REASON IS THE ENGINE'S TYPED OUTCOME (DL #72 5867687155 + AIQ 5867754251; one seam, DL order 5867785083).
 *
 * The Agent runs the analysis through the product's own Run turn (`/orchestrate/v2/turn`, the typed chip). When that
 * turn produces no result, it answers 200 with CEE's OWN words for the outcome, chosen per cause and per PLoT code by
 * `composeHandlerFailureBody`, and a typed `analysis_ready.blocked_reason`. Two served defects came from the Agent
 * explaining such a Run from elsewhere:
 *   - served `9cd467e`, journey C run 2 (09:21Z): the engine refused the request (ISL 422), and the reply said "the
 *     analysis did not run because the 50/50 option has no setting…". That was a separate, NON-blocking readiness
 *     issue, taken from the state;
 *   - served `d202fc5` (AIQ R3-W): ISL withheld the analysis on a declared identity that does not add up. CEE composed
 *     the one ask that unblocks it (`details.identity_ask`: "The figures don't add up: …" plus "Check the figures"),
 *     and the reply was the model's own prose, with no chip.
 *
 * This reads that outcome off the Run turn's own response, by TYPE:
 *   - `identity_ask`: the Run turn offered the identity chip (`chip_prompt_identity_<reason>`, minted only from a
 *     well-formed `identity_ask` by `composeHandlerFailureBody`). Its text and that chip ARE the ask, verbatim;
 *   - `engine`: the typed `blocked_reason` is one of the engine's own outcomes (below). The text is CEE's per-cause /
 *     per-code sentence, and the chips are the ones it chose (a retry where a retry can help);
 *   - otherwise `undefined`: readiness stopped the Run (`options_not_configured`, `analysis_not_ready` and its reason
 *     codes), or the outcome is not typed. The Agent explains it as before, and a readiness ask is named only then.
 */

/** The Run turn's typed no-result outcomes that are the ENGINE's, not the model's readiness. */
export const ENGINE_RUN_OUTCOMES: ReadonlySet<string> = new Set([
  'analysis_blocked',
  'analysis_engine_busy',
  'analysis_failed',
  'analysis_not_completed',
  'plot_error',
  'plot_timeout',
  'plot_unknown',
]);

/**
 * The Run turn's typed no-result outcome that is neither the engine's nor readiness: the model MOVED while the run was
 * being prepared (DL #2233 follow-up 1). CEE's own words say so and offer the Run again; the model never explains it,
 * so it can never blame readiness, and the Retry is never replaced.
 */
export const MOVED_RUN_OUTCOMES: ReadonlySet<string> = new Set(['analysis_snapshot_diverged']);

/** The prefix of the chip `composeHandlerFailureBody` mints from a well-formed `identity_ask`, and of no other chip. */
export const IDENTITY_ASK_CHIP_PREFIX = 'chip_prompt_identity_';

export interface RunOutcomeChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type?: 'run_analysis';
}

export type RunOutcome =
  | { readonly kind: 'identity_ask'; readonly text: string; readonly chips: readonly RunOutcomeChip[] }
  | { readonly kind: 'engine'; readonly reason: string; readonly text: string; readonly chips: readonly RunOutcomeChip[] }
  | { readonly kind: 'moved'; readonly reason: string; readonly text: string; readonly chips: readonly RunOutcomeChip[] };

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function chipsOf(actions: unknown): RunOutcomeChip[] {
  if (!Array.isArray(actions)) return [];
  const out: RunOutcomeChip[] = [];
  for (const raw of actions) {
    const a = rec(raw);
    const [id, label, message] = [a?.id, a?.label, a?.message];
    if (typeof id !== 'string' || id === '' || typeof label !== 'string' || label.trim() === '' || typeof message !== 'string' || message.trim() === '') continue;
    out.push({ id, label, message, ...(a?.action_type === 'run_analysis' ? { action_type: 'run_analysis' as const } : {}) });
  }
  return out;
}

/**
 * The typed outcome of a Run turn that produced NO result, or `undefined` when readiness stopped it or the outcome is
 * not typed. Pure; never throws. Only the Run turn's own CEE-authored text is returned, never PLoT or ISL prose.
 */
export function runOutcomeOf(runTurn: unknown): RunOutcome | undefined {
  const r = rec(runTurn);
  if (r === null) return undefined;
  const blocks = Array.isArray(r.blocks) ? r.blocks : [];
  if (blocks.some((b) => rec(b)?.type === 'analysis_result')) return undefined;
  const text = typeof r.assistant_text === 'string' ? r.assistant_text.trim() : '';
  if (text === '') return undefined;
  const chips = chipsOf(r.suggested_actions);
  const ask = chips.find((c) => c.id.startsWith(IDENTITY_ASK_CHIP_PREFIX));
  if (ask !== undefined) return { kind: 'identity_ask', text, chips: [ask] };
  const reason = rec(r.analysis_ready)?.blocked_reason;
  if (typeof reason === 'string' && ENGINE_RUN_OUTCOMES.has(reason)) return { kind: 'engine', reason, text, chips };
  if (typeof reason === 'string' && MOVED_RUN_OUTCOMES.has(reason)) return { kind: 'moved', reason, text, chips };
  return undefined;
}
