/**
 * D-ask-1 (ROADMAP 2.11 P0-1) — scaffold disclosure copy: the SINGLE source
 * of the user-facing sentence that marks a scaffolded option's analysis
 * numbers as placeholder DEFAULTS, plus the record type the scaffold
 * mechanism reports through.
 *
 * Paul's ratified decision (D-ask-1, 2.11): an option added without
 * configuration gets SCAFFOLDED, DISCLOSED placeholder values so analysis
 * keeps running. Disclosure is claim-safety-critical — the analysis result
 * must never present a scaffolded option's numbers as user-provided. This
 * module owns:
 *
 *   - {@link ScaffoldedOptionRecord} — the mechanism record
 *     (`value_defaulted: true` reuses the established wire/receipt
 *     vocabulary: `@talchain/schemas` enrichment carries the same
 *     factor-level boolean for engine-defaulted values).
 *   - {@link buildScaffoldDisclosureSuffix} — the summary/receipt suffix.
 *     The advised configure phrasing is DERIVED from #487's
 *     `configure-option-chip-text.ts` (trap-12: derive, don't mirror), so
 *     the disclosure's "say '…'" exemplar always routes through the
 *     deterministic configure-option gate.
 *   - {@link buildScaffoldConfigureChip} — the chip the success turn offers,
 *     from the same single chip-copy source.
 *   - {@link SCAFFOLD_DISCLOSURE_RE_SRC} — the grammar the registry-side
 *     egress allowlist (`analysis-result-headline.ts`) accepts, so the
 *     disclosure SURVIVES to the wire instead of being silently replaced by
 *     the locked-template fallback. The `builder output matches the
 *     grammar` pin in scaffold-disclosure.test.ts is the drift guard
 *     between the copy and the pattern.
 *
 * Lives in coaching/ (not tools/handlers/) so the registry contract,
 * turn-executor, and chip generator can import the record type without
 * violating the registry-isolation rule against cross-file handler imports.
 */

import {
  buildConfigureOptionChip,
  buildConfigureOptionChipMessage,
  CONFIGURE_OPTION_GENERIC_CHIP,
  type ConfigureOptionChip,
} from '../configure-option-chip-text.js';
import { sanitiseLabel } from '../context/enrichment-graph-labels.js';

/**
 * One scaffolded option, as reported by the run_analysis scaffold mechanism
 * (`tools/handlers/scaffold-unconfigured-options.ts`) on the
 * `HandlerOutcome.__scaffolded_options` channel.
 */
export interface ScaffoldedOptionRecord {
  readonly option_id: string;
  /** Raw option label (unsanitised); null when the node carried none. */
  readonly label: string | null;
  /** Factor ids that received a neutral placeholder intervention. */
  readonly factor_ids: readonly string[];
  /**
   * Established disclosure vocabulary — mirrors the factor-level
   * `value_defaulted` boolean on the schemas enrichment boundary: these
   * values are DEFAULTS, not user-provided numbers.
   */
  readonly value_defaulted: true;
}

/**
 * Maximum characters a label may contribute to the disclosure suffix (and
 * to the configure chip built from it). Mirrored by the `{1,40}` slot in
 * {@link SCAFFOLD_DISCLOSURE_RE_SRC}.
 */
export const SCAFFOLD_LABEL_MAX_CHARS = 40;

/** Raw decimals are rejected by the run_analysis egress defence-in-depth. */
const DECIMAL_REGEX = /\d+\.\d+/;
/** Mirror of the egress forbidden-vocabulary defence (headline scope). */
const FORBIDDEN_VOCAB_REGEX =
  /\b(?:recommend(?:s|ed|ation|ations)?|winners?|best|optimal|preferred)\b/i;

/**
 * Return a label safe to interpolate into the disclosure suffix / chip, or
 * null to force the generic form. A label that would trip ANY of the
 * registry egress defences (raw decimal, internal-id shape, forbidden
 * vocabulary) or break the suffix grammar (quote, newline, over-length)
 * must be rejected here — otherwise the WHOLE disclosure-bearing summary
 * would be replaced by the bland locked-template fallback and the
 * disclosure silently lost.
 */
export function safeScaffoldOptionLabel(label: string | null | undefined): string | null {
  if (typeof label !== 'string') return null;
  const clean = sanitiseLabel(label, '');
  if (clean === null) return null;
  if (clean.length > SCAFFOLD_LABEL_MAX_CHARS) return null;
  if (clean.includes("'") || clean.includes('\n') || clean.includes('\r')) return null;
  if (DECIMAL_REGEX.test(clean)) return null;
  if (FORBIDDEN_VOCAB_REGEX.test(clean)) return null;
  return clean;
}

function labelledSuffix(label: string): string {
  return (
    ` Placeholder values were used for '${label}' because it has no values set — ` +
    `its results are illustrative until you configure it. ` +
    `To set real values, say '${buildConfigureOptionChipMessage(label)}'`
  );
}

function genericSingleSuffix(): string {
  return (
    ` Placeholder values were used for one of your options because it has no values set — ` +
    `its results are illustrative until you configure it. ` +
    `To set real values, say '${CONFIGURE_OPTION_GENERIC_CHIP.message}'`
  );
}

function pluralSuffix(count: number): string {
  return (
    ` Placeholder values were used for ${count} of your options because they have no values set — ` +
    `their results are illustrative until you configure them. ` +
    `To set real values, say '${CONFIGURE_OPTION_GENERIC_CHIP.message}'`
  );
}

/**
 * Build the disclosure suffix appended to the run_analysis summary /
 * assistant_text when the scaffold filled placeholder interventions.
 * Returns '' for an empty record list (defensive; callers gate on length).
 */
export function buildScaffoldDisclosureSuffix(
  scaffolded: readonly ScaffoldedOptionRecord[],
): string {
  if (scaffolded.length === 0) return '';
  if (scaffolded.length === 1) {
    const label = safeScaffoldOptionLabel(scaffolded[0].label);
    return label !== null ? labelledSuffix(label) : genericSingleSuffix();
  }
  // >99 is structurally impossible (NODE_LIMIT); clamp so the `\d{1,2}`
  // grammar slot can never be exceeded into a silent fallback.
  return pluralSuffix(Math.min(scaffolded.length, 99));
}

/**
 * The configure chip a scaffolded run_analysis success turn offers — same
 * single copy source as the `options_not_configured` recovery composer and
 * the GM held-apply receipt (#487), so chip message and deterministic route
 * can never drift apart.
 */
export function buildScaffoldConfigureChip(
  scaffolded: readonly ScaffoldedOptionRecord[],
): ConfigureOptionChip {
  if (scaffolded.length === 1) {
    const label = safeScaffoldOptionLabel(scaffolded[0].label);
    if (label !== null) return buildConfigureOptionChip(label);
  }
  return CONFIGURE_OPTION_GENERIC_CHIP;
}

/**
 * P1-2 — the LLM-facing disclosure line for the decision_review prompt
 * context. The DR enricher threads `HandlerOutcome.__scaffolded_options`
 * here and forwards the result on
 * `DecisionReviewInvokeInput.scaffold_disclosure`; the prompt builders
 * render it in an explicit `<SCAFFOLDED_OPTIONS>` section. Without it the
 * review narrates a scaffolded option's placeholder numbers as real user
 * data. Lives in THIS module so every disclosure surface (summary suffix,
 * chip, DR prompt) shares one copy source. Deterministic; labels go through
 * the same `sanitiseLabel` used everywhere else (falling back to the
 * option id — this text goes to the LLM, which already sees graph ids, not
 * to the user-facing wire).
 */
export function buildScaffoldPromptDisclosure(
  scaffolded: readonly ScaffoldedOptionRecord[],
): string {
  if (scaffolded.length === 0) return '';
  const lines = scaffolded.map((record) => {
    const name =
      record.label !== null
        ? (sanitiseLabel(record.label, record.option_id) ?? record.option_id)
        : record.option_id;
    const factorCount = record.factor_ids.length;
    return (
      `Option '${name}' had no user-provided values, so the analysis used neutral ` +
      `placeholder interventions on ${factorCount} factor${factorCount === 1 ? '' : 's'} ` +
      `(value_defaulted). Its numbers are defaults, not user data.`
    );
  });
  return (
    `${lines.join('\n')}\n` +
    'Because placeholder values shift every option\'s relative position, treat the WHOLE ' +
    'comparison as illustrative until the scaffolded option(s) are configured. Never present ' +
    'a scaffolded option\'s numbers as real or user-provided; caveat any comparison that ' +
    'involves them.'
  );
}

/**
 * Grammar source for the disclosure suffix, consumed by the registry-side
 * egress allowlist (`isAllowedRunAnalysisAssistantText`). Mirrors the three
 * builder shapes above exactly:
 *   - labelled single:  `'…'` slot (≤ {@link SCAFFOLD_LABEL_MAX_CHARS})
 *   - generic single:   `one of your options`
 *   - plural:           `\d{1,2} of your options`
 * The advised-exemplar slot pins the deterministic chip prefix verbatim
 * (`Help me configure …`), so a copy edit that breaks the routing promise
 * also breaks the grammar (and the contract test) loudly.
 */
export const SCAFFOLD_DISCLOSURE_RE_SRC =
  " Placeholder values were used for (?:'[^'\\n]{1,40}'|one of your options|\\d{1,2} of your options) " +
  'because (?:it has|they have) no values set — ' +
  '(?:its|their) results are illustrative until you configure (?:it|them)\\. ' +
  "To set real values, say 'Help me configure [^'\\n]{1,41}\\.'";

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * worst-case builder outputs (never hand-estimated), so an over-budget
 * disclosure cannot silently knock the summary back to the fallback.
 */
export const SCAFFOLD_DISCLOSURE_MAX_CHARS = Math.max(
  labelledSuffix('x'.repeat(SCAFFOLD_LABEL_MAX_CHARS)).length,
  genericSingleSuffix().length,
  pluralSuffix(99).length,
);
