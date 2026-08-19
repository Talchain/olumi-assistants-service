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

import { elideLabelAtWordBoundary } from '../utils/label-elision.js';

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
  return buildConfigureOptionChipWithDisplay(entityRef, entityRef);
}

/**
 * ⭐⭐ THE SAME CHIP WHEN THE CALLER HOLDS A SHORTENED DISPLAY FORM — one
 * implementation, two entry points, and NO optional flag.
 *
 * WHY IT EXISTS, measured at pristine `7abed98e` on the live-journey capture
 * `tests/unit/ci/fixtures/live-journey-draftfirst-turn1-2ceb65f.json`:
 * `coaching/readiness-recovery.ts` elides every label it resolves to 40
 * characters (`MAX_LABEL_CHARS`, for the on-screen sentence) and then handed
 * THAT string to `buildConfigureOptionChip` — so the chip's MESSAGE read
 *
 *   "Help me configure open a second bakery location in Leeds…."
 *
 * naming an entity that exists in no graph. `detectConfigureOptionIntent`'s
 * label anchor cannot match it and `resolveOptionEffectWrite` returns
 * `not_effect_framed_intent`: the product's own repair chip could not route
 * back into the lane that offered it — ROADMAP 2.11's closed loop, re-minted by
 * a display cut.
 *
 * ⚠ #1041 (N26) DOES NOT CLOSE THIS, and the distinction is the whole point.
 * That change made the CUT honest — `elideLabelAtWordBoundary` is bracket-aware,
 * so the on-screen sentence no longer breaks mid-parenthesis. An honest cut is
 * still a cut: `…in Leeds…` names no node either. The two fixes compose —
 * #1041 owns what the user READS, this owns what the product REPLAYS.
 *
 * The split is the fix and it belongs HERE rather than at the call site: a
 * caller that rebuilt `Configure ${label}` itself would be a second spelling of
 * this chip's copy, which is the drift this module exists to make impossible
 * (CLAUDE.md trap 12). The MESSAGE is always the full entity reference; only
 * the LABEL may be shortened, because only the label is display.
 */
export function buildConfigureOptionChipWithDisplay(
  entityRef: string,
  displayRef: string,
): ConfigureOptionChip {
  return {
    id: 'chip_prompt_configure_option',
    label: `Configure ${displayRef}`,
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
  return `Set ${buildOptionEffectReference(optionRef, factorRef)} to ${value}`;
}

/**
 * ⭐ THE NOUN PHRASE THAT NAMES ONE option × factor SLOT, and the estate's only
 * spelling of it.
 *
 * It was inlined in `buildConfigureOptionAdvisedFormat` above. Extracted —
 * byte-identically — because the identity-carrying repair chip below needs the
 * SAME phrase without a value, and a chip that spelled the phrase itself would
 * drift from the one the router's `effect_vocab` trigger is calibrated against
 * the first time either is edited (CLAUDE.md trap 12: the second spelling is
 * the one that rots). One phrase, two sentences.
 */
export function buildOptionEffectReference(optionRef: string, factorRef: string): string {
  return `the ${optionRef} option's effect on ${factorRef}`;
}

/**
 * ⭐⭐ THE IDENTITY-CARRYING REPAIR AFFORDANCE — the chip the product offers
 * when its own readiness blocker says one option × factor slot has no value.
 *
 * WHAT IT SUPERSEDES. The `provide_value` recovery class used to mint
 * `chip_prompt_configure_option` from an OPTION LABEL ALONE — no factor, and
 * (see `buildConfigureOptionChipWithDisplay`) an ellipsis-truncated one at
 * that. Witnessed on deployed UI `aa916511` / CEE `7abed98` (19 Aug 2026, fresh
 * guest, brief `04-conflicting-constraints`): a chip was offered for a pair the
 * user had ALREADY set, clicking it made zero progress — *"was already set to
 * 0.8 in the previous turn"* — and the turn that followed carried no chips at
 * all. A chip that names only an option leaves the model to choose WHICH of
 * that option's factors it meant, and it chose one that was already resolved.
 *
 * WHY NAMING THE PAIR IS THE FIX AND NOT MERELY BETTER COPY: the pair comes
 * from `deriveAskedEffectPair` — the estate's one owner of "which slot is the
 * product currently asking about" — so the chip cannot name a slot the product
 * is not asking about, cannot name a slot that already has a value (a resolved
 * slot has no blocker), and cannot name a slot with no option→factor edge (the
 * producer derives `missing_value` blockers strictly from the option→factor
 * adjacency, `cee/transforms/analysis-ready.ts`). All three of those are
 * properties of the CANDIDATE SET, inherited rather than re-checked here.
 *
 * ⚠ WHAT IT DELIBERATELY DOES NOT DO: carry a value. The value is the one thing
 * in this slot that is not a derivable fact about the graph, and a chip bearing
 * a plausible number would put a fabricated intervention one click away behind
 * a control that reads as the product's recommendation (the posture
 * `configure-option-clarify.ts` states at length). So this chip completes the
 * IDENTIFICATION and leaves the number to the user; the value-bearing siblings
 * (`chip_prompt_repair_value_bind_*`, the outstanding-ask chip) fire only once
 * the user has supplied one.
 */
export function buildRepairPairChipMessage(optionRef: string, factorRef: string): string {
  return `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}${buildOptionEffectReference(optionRef, factorRef)}.`;
}

/**
 * Display cap for the repair chip's LABEL only. The MESSAGE always carries the
 * full labels — it is replayed as user text and must name real entities.
 */
const REPAIR_PAIR_CHIP_LABEL_MAX = 48;

export function buildRepairPairChip(optionRef: string, factorRef: string): ConfigureOptionChip {
  return {
    id: 'chip_prompt_repair_effect_value',
    // ⭐ THE CANONICAL ELIDER (#1041 / N26), not a local truncator. A private
    // `slice`-and-ellipsis here would be the third instance of exactly the
    // helper that PR deleted two of, and it is bracket-unaware — the witnessed
    // `…enterprise sales (higher…` is what that costs.
    label: `Set effect on ${elideLabelAtWordBoundary(factorRef, REPAIR_PAIR_CHIP_LABEL_MAX)}`,
    message: buildRepairPairChipMessage(optionRef, factorRef),
  };
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
