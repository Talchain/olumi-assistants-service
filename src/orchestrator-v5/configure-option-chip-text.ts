/**
 * ROADMAP 2.11 / P0-2+P1-3 — the SINGLE source of configure-option chip
 * copy.
 *
 * Every surface that offers "configure this option" (the
 * `options_not_configured` recovery composer, the GM held-apply receipt)
 * builds its chip from here, and the deterministic route-v2 gate
 * (`routing/configure-option-intent.ts`) matches the SAME prefix — so the
 * chip message and the route can never drift apart (trap-12: derive, don't
 * mirror). Before this module, the chip copy lived inline in
 * `handler-failure-responses.ts` while routing knew nothing about it: the
 * system's own chip message routed to `adjust_edge_strength` and closed the
 * live infinite loop documented in the 2.11 diagnosis brief (scenario A,
 * A6→A7).
 *
 * Dependency-free on purpose: imported by both routing and compose without
 * cycle risk.
 */

/**
 * The load-bearing prefix. `detectConfigureOptionIntent` treats any message
 * starting with this as configure-option intent (chips replay their message
 * as user text, and "help me configure …" is unambiguous configure intent
 * in this product's vocabulary).
 */
export const CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX = 'Help me configure ';

/** Build the chip MESSAGE for a (render-safe) option reference. */
export function buildConfigureOptionChipMessage(entityRef: string): string {
  return `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}${entityRef}.`;
}

export interface ConfigureOptionChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
}

/**
 * The labelled configure chip (`options_not_configured` with a usable
 * label; GM held-apply receipt for a needs-encoding option).
 */
export function buildConfigureOptionChip(entityRef: string): ConfigureOptionChip {
  return {
    id: 'chip_prompt_configure_option',
    label: `Configure ${entityRef}`,
    message: buildConfigureOptionChipMessage(entityRef),
  };
}

/** The generic fallback chip (no safe label available). */
export const CONFIGURE_OPTION_GENERIC_CHIP: ConfigureOptionChip = Object.freeze({
  id: 'chip_prompt_configure_option_generic',
  label: 'Configure an option',
  message: buildConfigureOptionChipMessage('one of my options'),
});

/**
 * ROADMAP 2.308 / S2(b) — the post-draft readiness chip ("Set values for
 * options"), moved here from `handlers/draft-graph-dispatch.ts`.
 *
 * Its previous message — `'Help me set up the options for this decision so
 * the analysis can run.'` — was blocked TWICE over (2.308 diagnosis §7 row 3,
 * re-measured at `a5a3e22a`):
 *
 *   1. NO_MATCH at `detectConfigureOptionIntent`. The gate's chip trigger is
 *      the `Help me configure ` prefix; this chip never adopted it.
 *   2. A hit on `EDIT_GRAPH_NEGATIVE_REGEX` via the phrasal verb "set up",
 *      which route-v2 applies to the configure gate as a shared negative —
 *      so even a matching detector would NOT have dispatched it.
 *
 * "The product's own 'Set values for options' readiness chip is not in its own
 * configure vocabulary" — the ROADMAP-2.11 defect surviving in the sibling
 * chip the 2.11 fix did not cover. Building the message from the shared prefix
 * fixes both blocks at once and, because it is DERIVED, cannot drift back
 * (trap 12). The chip's `id` and `label` are unchanged: this is a routing fix,
 * not a UI-surface change.
 */
export const SET_OPTION_VALUES_CHIP_LABEL = 'Set values for options';

/**
 * The load-bearing half. Every producer of a "Set values for options" chip
 * MUST build from this — `handlers/draft-graph-dispatch.ts` (post-draft) and
 * all four sites in `compose/chip-generator.ts` (the readiness floor at
 * `needs_encoding` — i.e. the 2.308 blocked state itself — and the three
 * analyse/decide-stage fallbacks). The first cut of 2.308 converted only the
 * post-draft producer, which left the chip a blocked tester actually sees
 * still carrying the doubly-blocked literal.
 */
export const SET_OPTION_VALUES_CHIP_MESSAGE = `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}the options for this decision so the analysis can run.`;

export const SET_OPTION_VALUES_CHIP: ConfigureOptionChip = Object.freeze({
  id: 'chip_prompt_set_option_values',
  label: SET_OPTION_VALUES_CHIP_LABEL,
  message: SET_OPTION_VALUES_CHIP_MESSAGE,
});

/**
 * ⭐ ROADMAP 2.308 / S2(a) — THE phrasing the assistant is allowed to advise
 * when it needs an option's effect value.
 *
 * The edit lane's "what value?" reply used to suggest
 * `'Set Customer Retention Investment to £40,000'` and
 * `'Set retention investment to 0.8'`. Both are NO_MATCH against the configure
 * gate (diagnosis §2c rows 2 / 2b): "the assistant suggests phrasings that
 * cannot return to the lane that suggested them: a closed loop, minted by the
 * product's own copy." Neither can simply be made to match — they name a
 * FACTOR and carry no option reference, so claiming them would reroute every
 * plain "set X to N" off `set_factor_value` into the edit LLM, the blast
 * radius the diagnosis explicitly refused.
 *
 * This shape is the one that works, and it is not a guess: it is probe P1
 * (diagnosis §5) verbatim — sent to deployed CEE `a5a3e22`, it flipped
 * `analysis_ready` from `needs_encoding` to `ready`, wrote
 * `interventions: {fac_retention_investment: 1}`, and the analysis then ran
 * (§6c). It anchors on the literal word "option" (via `option's`), so it needs
 * no label list and routes on `effect_vocab` on any turn, in any scenario.
 */
export function buildConfigureOptionAdvisedFormat(
  optionRef: string,
  factorRef: string,
  value: string,
): string {
  return `Set the ${optionRef} option's effect on ${factorRef} to ${value}`;
}

/**
 * The advised format for embedding in prompt copy. Derived from the builder
 * above so a prompt and a live suggestion can never diverge.
 *
 * ⚠ THE VALUE SLOT CARRIES A CONCRETE NUMBER, NOT `'<0-1>'` (NEW-5, 2026-08-16).
 * `<option>` and `<factor>` are placeholders the MODEL substitutes before the
 * sentence is ever shown — the value slot was not: the prompt told the model to
 * advise "exactly this phrasing", so `<0-1>` was reproduced verbatim into user
 * copy and a strategic user was asked to expand a template by hand. A real
 * number is what the model should be advising, and the routing witness accepts
 * a decimal exactly as it accepted the placeholder (it requires only a digit
 * after `to`). The 0-1 scale is stated in the prompt block that embeds this.
 */
export const CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE = buildConfigureOptionAdvisedFormat(
  '<option>',
  '<factor>',
  '0.6',
);
