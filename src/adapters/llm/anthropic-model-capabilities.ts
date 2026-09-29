/**
 * Anthropic model capability declarations — the EVIDENCE, split from the POLICY.
 *
 * ── Why this module exists (ROADMAP 2.973) ──────────────────────────────────
 * The adapter used to gate structured outputs on ONE set,
 * `STRUCTURED_OUTPUTS_SUPPORTED_MODELS`, which answered two DIFFERENT questions:
 *
 *   Q1  "May we send `output_config.format` for this model?"   (env-gated by
 *       CEE_ANTHROPIC_STRUCTURED_OUTPUTS)
 *   Q2  "Should tool definitions be built with `strict: true`?" (NO env gate —
 *       every live turn, the moment it deploys)
 *
 * Because one set answered both, `claude-sonnet-5` was deliberately kept OUT of
 * it (#454, 2026-07-14) purely to hold Q2 steady — the comment there said so
 * explicitly. That was correct at the time. Then #871 (2026-08-08) moved the
 * draft/edit/orchestrator task defaults to `claude-sonnet-5`, and the Q1 answer
 * silently flipped to "no" for the two highest-value paths: every draft turn
 * logged "falling back to prompt-only JSON mode" and lost grammar enforcement.
 *
 * That is CLAUDE.md trap 21 — two questions wearing one name, where a fix aimed
 * at one silently moves the other. The repair is to NAME THE CONCEPTS APART:
 *
 *   ANTHROPIC_MODEL_CAPABILITIES  — what the API actually accepts (evidence).
 *   STRUCTURED_OUTPUTS_CAPABLE_MODELS / THINKING_CAPABLE_MODELS — derived from
 *                                   that evidence, never hand-listed.
 *   STRICT_TOOL_CALLING_MODELS    — a POLICY set, deliberately NOT derived.
 *
 * ── Why the strict-tool set is frozen and NOT derived ───────────────────────
 * `buildStrictAnthropicTools` has no env gate, so widening it changes every live
 * turn at once. It is also NOT SAFE to widen blind: the edit path's
 * `propose_structural_edit` schema deliberately omits `required` on a nested
 * object, and its own comment records that this is only safe because
 * `strict: true` is not sent for staging's model. Sending strict tools there is
 * a live-behaviour change that needs its own lane, its own probe of that exact
 * schema, and its own deploy witness. It is NOT part of restoring the draft
 * grammar, so this module holds it byte-identical to its 2026-07-14 membership.
 *
 * ── Evidence standard ───────────────────────────────────────────────────────
 * Every verdict below was established by a REAL call to api.anthropic.com on the
 * date recorded in `probedOn`, using the exact request shape this adapter builds
 * (`output_config: { format: { type: 'json_schema', schema } }` for structured
 * outputs; `thinking: { type: 'enabled', budget_tokens }` for thinking). The
 * probe carried its own positive controls (a bogus model → 404, a malformed
 * `output_config` → 400) so that a 200 could not be a probe that tested nothing.
 * `note` carries the API's VERBATIM rejection message where there was one.
 *
 * Do NOT infer these verdicts from `MODEL_REGISTRY.extendedThinking`. That field
 * was measured WRONG IN BOTH DIRECTIONS on 2026-08-08: it claims `true` for
 * claude-sonnet-5 (which returns HTTP 400 for thinking.enabled) and `false` for
 * claude-sonnet-4-6 (which returns HTTP 200 and emits thinking blocks). It
 * appears to describe "has some thinking mode" rather than "accepts the
 * budget_tokens mechanism this adapter sends".
 */

export type AnthropicModelCapabilities = {
  /** Accepts the GA structured-outputs body `output_config.format`. */
  readonly structuredOutputs: boolean;
  /** Accepts `thinking: { type: 'enabled', budget_tokens }`. */
  readonly thinkingEnabled: boolean;
  /** ISO date of the live API probe that established both verdicts. */
  readonly probedOn: string;
  /** Verbatim API message when a capability was rejected, or a scope note. */
  readonly note?: string;
};

const NOT_AVAILABLE_404 =
  'HTTP 404 not_found_error — model is not available to this account; both capabilities are moot.';
const THINKING_ENABLED_REJECTED =
  'HTTP 400: "thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.';

/**
 * The single source of truth. Every Anthropic model reachable as a CEE task
 * default, or registered+enabled in MODEL_REGISTRY, MUST appear here — enforced
 * by `findUnclassifiedModels` and its test, so a future model swap cannot
 * silently drop a capability the way #871 did.
 */
export const ANTHROPIC_MODEL_CAPABILITIES: Readonly<
  Record<string, AnthropicModelCapabilities>
> = Object.freeze({
  'claude-sonnet-5': {
    structuredOutputs: true,
    thinkingEnabled: false,
    probedOn: '2026-08-08',
    note:
      `${THINKING_ENABLED_REJECTED} Structured outputs confirmed with the REAL ` +
      '2689-byte draft grammar (buildDraftGraphSchema), not just a toy schema: ' +
      'HTTP 200, grammar compiled, 3/3 runs returned schema-conformant JSON.',
  },
  'claude-sonnet-4-6': {
    structuredOutputs: true,
    thinkingEnabled: true,
    probedOn: '2026-08-08',
    note:
      'Thinking CONFIRMED live (HTTP 200, thinking block emitted, ' +
      'thinking_tokens=25) even though MODEL_REGISTRY says extendedThinking:false.',
  },
  'claude-sonnet-4-5-20250929': {
    structuredOutputs: true,
    thinkingEnabled: true,
    probedOn: '2026-08-08',
  },
  'claude-haiku-4-5': {
    structuredOutputs: true,
    thinkingEnabled: true,
    probedOn: '2026-08-08',
  },
  'claude-opus-4-6': {
    structuredOutputs: true,
    thinkingEnabled: true,
    probedOn: '2026-08-08',
  },
  'claude-opus-4-5-20251101': {
    structuredOutputs: true,
    thinkingEnabled: true,
    probedOn: '2026-08-08',
  },
  'claude-opus-4-8': {
    structuredOutputs: true,
    thinkingEnabled: false,
    probedOn: '2026-08-08',
    note: THINKING_ENABLED_REJECTED,
  },
  // ── Registered but NOT available on the deployed credential ───────────────
  // These 404 today. They are classified (not omitted) so the drift guard stays
  // green and so the 404 is recorded as a MEASURED fact rather than rediscovered.
  'claude-sonnet-4-20250514': {
    structuredOutputs: false,
    thinkingEnabled: false,
    probedOn: '2026-08-08',
    note: `${NOT_AVAILABLE_404} ⚠ This is the checked-in bias_check task default.`,
  },
  'claude-opus-4-20250514': {
    structuredOutputs: false,
    thinkingEnabled: false,
    probedOn: '2026-08-08',
    note: `${NOT_AVAILABLE_404} Was listed in BOTH pre-2.973 allowlists.`,
  },
  'claude-3-5-haiku-20241022': {
    structuredOutputs: false,
    thinkingEnabled: false,
    probedOn: '2026-08-08',
    note: `${NOT_AVAILABLE_404} MODEL_REGISTRY has it enabled:false.`,
  },
});

/**
 * Derive a capability set from the evidence map.
 *
 * ANTI-VACUITY (CLAUDE.md trap 13): an empty derived set is a HARD FAILURE, not
 * "no models support this". A silently-empty set would turn every downstream
 * `.has()` into `false` and re-create exactly the silent capability loss this
 * module exists to prevent — and it would read as green everywhere.
 */
function deriveCapableModels(
  capability: 'structuredOutputs' | 'thinkingEnabled',
): ReadonlySet<string> {
  const ids = Object.entries(ANTHROPIC_MODEL_CAPABILITIES)
    .filter(([, caps]) => caps[capability])
    .map(([id]) => id);
  if (ids.length === 0) {
    throw new Error(
      `[anthropic-model-capabilities] Derived an EMPTY set for "${capability}". ` +
        'This is a hard failure, never "no support": an empty set silently disables ' +
        'the capability for every model. Check ANTHROPIC_MODEL_CAPABILITIES.',
    );
  }
  return Object.freeze(new Set(ids));
}

/** Models whose API accepts `output_config.format`. Consumption is env-gated. */
export const STRUCTURED_OUTPUTS_CAPABLE_MODELS = deriveCapableModels('structuredOutputs');

/** Models whose API accepts `thinking:{type:'enabled',budget_tokens}`. */
export const THINKING_CAPABLE_MODELS = deriveCapableModels('thinkingEnabled');

/**
 * POLICY set — deliberately a frozen literal, NOT derived from the evidence map.
 *
 * Consulted ONLY by `buildStrictAnthropicTools`, which has NO env gate. Its
 * membership is byte-identical to the 2026-07-14 shared set so that restoring
 * the draft grammar (a Q1 change) cannot move live tool-calling behaviour (Q2).
 *
 * ⚠ Do not "tidy" this into a derivation. `claude-opus-4-20250514` is knowingly
 * retained despite probing 404, precisely so this set changes NOTHING today.
 * Widening it — in particular to claude-sonnet-5, which staging serves on every
 * turn — is a separate lane: it needs the `propose_structural_edit` schema
 * re-probed under `strict: true` first (that schema omits `required` on a nested
 * object and its comment records two prior rounds of 400s).
 */
export const STRICT_TOOL_CALLING_MODELS: ReadonlySet<string> = Object.freeze(
  new Set([
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-opus-4-20250514',
    'claude-opus-4-5-20251101',
  ]),
);

/**
 * Drift guard (CLAUDE.md trap 12 — derive, don't mirror).
 *
 * Returns every model id in `reachable` that carries NO explicit capability
 * verdict. Callers pass the DERIVED reachable set (task defaults ∪ enabled
 * Anthropic registry entries); its test turns a non-empty result RED.
 *
 * This is deliberately "must be CLASSIFIED", not "must be CAPABLE": some models
 * genuinely lack a capability, and forcing them into a capable set would break
 * them. What must never happen again is a model becoming reachable with NO
 * verdict at all, which is how #871 shipped.
 */
export function findUnclassifiedModels(reachable: readonly string[]): string[] {
  return reachable.filter((id) => !(id in ANTHROPIC_MODEL_CAPABILITIES));
}
