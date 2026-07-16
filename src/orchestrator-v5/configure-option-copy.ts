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
