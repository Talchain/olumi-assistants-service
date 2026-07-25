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
// P1-3 (derive, don't mirror): the REAL egress defence functions — the same
// module the registry-side allowlist applies after its structural match.
// The builder validates its COMPOSED suffix against these at build time;
// local regex mirrors are exactly the drift class that silently swallowed
// the disclosure for ID-shaped labels ("Plan E_2").
import { passesAssistantTextContentDefences } from './assistant-text-defences.js';

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
  /**
   * Stamped by `run_analysis` AFTER the analysis returns: did this option
   * actually reach the returned `option_comparison[]`?
   *
   * Optional so every producer that has no result to consult yet (the
   * scaffold itself, `computeScaffoldPlan`'s pre-run readiness projection)
   * emits records unchanged, and every consumer that ignores it behaves
   * exactly as before. `false` is the case this field exists for: an option
   * the scaffold filled placeholders for that the engine then dropped —
   * live on staging via `IDENTICAL_OPTIONS_DEDUPED` (see
   * {@link partitionScaffoldedByAnalysisPresence}). `undefined` means "not
   * derivable", never "absent".
   */
  readonly in_comparison?: boolean;
}

/**
 * Maximum characters a label may contribute to the disclosure suffix (and
 * to the configure chip built from it). Mirrored by the `{1,40}` slot in
 * {@link SCAFFOLD_DISCLOSURE_RE_SRC}.
 */
export const SCAFFOLD_LABEL_MAX_CHARS = 40;

/**
 * Return a label safe to interpolate into the disclosure suffix / chip, or
 * null to force the generic form.
 *
 * P1-3 mechanism — validate the COMPOSED suffix, not label properties: the
 * candidate label is interpolated into the real labelled suffix, and that
 * suffix must (a) match the exact egress grammar this module publishes
 * (which structurally enforces the quote / newline / length slot rules)
 * and (b) pass the REAL shared content defences
 * (`passesAssistantTextContentDefences` — the same function the registry
 * egress applies to the whole wire text: forbidden vocabulary, internal-ID
 * tokens, raw decimals). No local mirrors remain: a defence added to the
 * shared module bites here automatically, so a label that would get the
 * WHOLE disclosure-bearing summary silently replaced by the locked
 * template is rejected at build time instead.
 */
export function safeScaffoldOptionLabel(label: string | null | undefined): string | null {
  return safeLabelForSuffix(label, labelledSuffix);
}

/**
 * The OMITTED-form counterpart of {@link safeScaffoldOptionLabel}. Same
 * mechanism, different composed suffix: a label is only usable in the
 * "left out of this comparison" copy when THAT sentence survives egress.
 * The two forms have different literal text, so a label safe in one is not
 * automatically safe in the other and each must be probed against its own.
 */
function safeOmittedOptionLabel(label: string | null | undefined): string | null {
  return safeLabelForSuffix(label, omittedLabelledSuffix);
}

function safeLabelForSuffix(
  label: string | null | undefined,
  build: (label: string) => string,
): string | null {
  if (typeof label !== 'string') return null;
  const clean = sanitiseLabel(label, '');
  if (clean === null) return null;
  return composedSuffixSurvivesEgress(build(clean)) ? clean : null;
}

/**
 * True when a composed disclosure suffix would SURVIVE the registry-side
 * egress: single-line, matches this module's published grammar exactly, and
 * passes the shared content defences. The generic and plural forms are
 * probed always-surviving by the scaffold-disclosure test suite.
 *
 * The grammar probed is {@link SCAFFOLD_ANY_DISCLOSURE_RE_SRC} — the SAME
 * union the registry egress and the validation-registry salvage compile —
 * so both the placeholder and the omitted sentence are covered by one
 * published source, and neither can drift out of the allowlist silently.
 */
function composedSuffixSurvivesEgress(suffix: string): boolean {
  if (suffix.includes('\n') || suffix.includes('\r')) return false;
  if (!SCAFFOLD_SUFFIX_EXACT_REGEX().test(suffix)) return false;
  return passesAssistantTextContentDefences(suffix);
}

// Lazily-compiled anchored grammar (the RE source constant is declared at
// the bottom of this module, next to the budget it documents).
let scaffoldSuffixExactRegex: RegExp | null = null;
function SCAFFOLD_SUFFIX_EXACT_REGEX(): RegExp {
  scaffoldSuffixExactRegex ??= new RegExp(`^(?:${SCAFFOLD_ANY_DISCLOSURE_RE_SRC})$`);
  return scaffoldSuffixExactRegex;
}

// P2-4 (A1 execution ruling): the copy names the WHOLE COMPARISON as
// illustrative, not just the scaffolded option's own results — placeholder
// values shift every option's relative position, so scoping the caveat to
// the new option would under-disclose.
function labelledSuffix(label: string): string {
  return (
    ` Placeholder values were used for '${label}' because it has no values set — ` +
    `the whole comparison is illustrative until you configure it. ` +
    `To set real values, say '${buildConfigureOptionChipMessage(label)}'`
  );
}

function genericSingleSuffix(): string {
  return (
    ` Placeholder values were used for one of your options because it has no values set — ` +
    `the whole comparison is illustrative until you configure it. ` +
    `To set real values, say '${CONFIGURE_OPTION_GENERIC_CHIP.message}'`
  );
}

function pluralSuffix(count: number): string {
  return (
    ` Placeholder values were used for ${count} of your options because they have no values set — ` +
    `the whole comparison is illustrative until you configure them. ` +
    `To set real values, say '${CONFIGURE_OPTION_GENERIC_CHIP.message}'`
  );
}

// ── OMITTED form (2026-07-25) ───────────────────────────────────────────
// A scaffolded option can be SCAFFOLDED and still not reach the results.
// Reproduced on deployed staging 2026-07-25 (scenario 454c14fb…, CEE
// 74c785f): the scaffold's neutral rule is "the factor's own observed_state
// numbers — the factor's current position", and the drafter defines the
// baseline / status-quo option as exactly the factors at their current
// observed values. The two definitions coincide, so PLoT/ISL removes the
// scaffolded arm as a duplicate:
//
//   IDENTICAL_OPTIONS_DEDUPED — "Option 'Franchise the Leeds Location' has
//   identical interventions to 'Stay at Current Location (Status Quo)' and
//   was removed. Analysis proceeds with deduplicated options."
//
// The user's option was then absent from `option_comparison` and from
// `win_probabilities`, while the summary asserted "Placeholder values were
// used for 'Franchise the Leeds Location'". These sentences are the honest
// alternative for that case; which one ships is DERIVED from the returned
// result (see {@link partitionScaffoldedByAnalysisPresence}), never
// predicted from PLoT's dedup rule — predicting it would be exactly the
// hand-maintained mirror that produced the false claim.
function omittedLabelledSuffix(label: string): string {
  return (
    ` '${label}' was left out of this comparison because it has no values set. ` +
    `To include it, say '${buildConfigureOptionChipMessage(label)}'`
  );
}

function omittedGenericSingleSuffix(): string {
  return (
    ` One of your options was left out of this comparison because it has no values set. ` +
    `To include it, say '${CONFIGURE_OPTION_GENERIC_CHIP.message}'`
  );
}

function omittedPluralSuffix(count: number): string {
  return (
    ` ${count} of your options were left out of this comparison because they have no values set. ` +
    `To include them, say '${CONFIGURE_OPTION_GENERIC_CHIP.message}'`
  );
}

/**
 * Split the scaffold records by whether the option ACTUALLY reached the
 * analysis result.
 *
 * Derived, not mirrored (trap-12): `analysedOptionIds` is read off the
 * returned `option_comparison[]` — the source of truth for what was
 * compared — so if a downstream filter (dedup, status gate, a future rule)
 * removes an arm, the disclosure follows automatically. Nothing here models
 * PLoT's dedup semantics.
 *
 * Positive control built into the mechanism (trap-13): an ABSENCE is only
 * asserted when a PRESENCE was seen. When `analysedOptionIds` is empty the
 * result carries no readable option identity at all, so no absence can be
 * derived and every record is classified `analysed` — the pre-existing copy,
 * which is the fail-safe direction (it makes no new claim).
 */
export interface ScaffoldPresencePartition {
  /** Scaffolded AND present in the returned comparison. */
  readonly analysed: readonly ScaffoldedOptionRecord[];
  /** Scaffolded but ABSENT from the returned comparison. */
  readonly omitted: readonly ScaffoldedOptionRecord[];
  /**
   * Every record in its ORIGINAL order, each stamped with `in_comparison`.
   * This is what `run_analysis` puts on the `__scaffolded_options` channel,
   * so downstream disclosure surfaces (the decision-review prompt) inherit
   * the verdict WITHOUT a second channel and without re-deriving it.
   */
  readonly stamped: readonly ScaffoldedOptionRecord[];
}

export function partitionScaffoldedByAnalysisPresence(
  scaffolded: readonly ScaffoldedOptionRecord[],
  analysedOptionIds: ReadonlySet<string>,
): ScaffoldPresencePartition {
  if (analysedOptionIds.size === 0) {
    return { analysed: scaffolded, omitted: [], stamped: scaffolded };
  }
  const analysed: ScaffoldedOptionRecord[] = [];
  const omitted: ScaffoldedOptionRecord[] = [];
  const stamped: ScaffoldedOptionRecord[] = [];
  for (const record of scaffolded) {
    const present = analysedOptionIds.has(record.option_id);
    (present ? analysed : omitted).push(record);
    stamped.push({ ...record, in_comparison: present });
  }
  return { analysed, omitted, stamped };
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
 * Build the suffix for scaffolded options that did NOT reach the comparison.
 * Same shape rules as {@link buildScaffoldDisclosureSuffix}; different claim.
 */
export function buildScaffoldOmittedSuffix(
  omitted: readonly ScaffoldedOptionRecord[],
): string {
  if (omitted.length === 0) return '';
  if (omitted.length === 1) {
    const label = safeOmittedOptionLabel(omitted[0].label);
    return label !== null ? omittedLabelledSuffix(label) : omittedGenericSingleSuffix();
  }
  return omittedPluralSuffix(Math.min(omitted.length, 99));
}

/**
 * The WHOLE scaffold disclosure for one run, composed from the presence
 * partition. TOTAL over the partition: all-analysed keeps today's copy
 * byte-for-byte, all-omitted ships only the honest omission sentence, and
 * the mixed case ships both in that order (matching the grammar union's
 * `placeholder-then-omitted` alternation).
 */
export function buildScaffoldDisclosureForPartition(
  partition: ScaffoldPresencePartition,
): string {
  return (
    buildScaffoldDisclosureSuffix(partition.analysed) +
    buildScaffoldOmittedSuffix(partition.omitted)
  );
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
  // Reads the `in_comparison` stamp `run_analysis` applied — a record with
  // no stamp is "not derivable", which keeps the pre-existing line. Without
  // this split the review is told an option carries placeholder numbers
  // when it carries NO numbers, and can narrate an arm absent from the data.
  const analysed = scaffolded.filter((r) => r.in_comparison !== false);
  const omitted = scaffolded.filter((r) => r.in_comparison === false);
  const nameOf = (record: ScaffoldedOptionRecord): string =>
    record.label !== null
      ? (sanitiseLabel(record.label, record.option_id) ?? record.option_id)
      : record.option_id;
  const lines = analysed.map((record) => {
    const factorCount = record.factor_ids.length;
    return (
      `Option '${nameOf(record)}' had no user-provided values, so the analysis used neutral ` +
      `placeholder interventions on ${factorCount} factor${factorCount === 1 ? '' : 's'} ` +
      `(value_defaulted). Its numbers are defaults, not user data.`
    );
  });
  const omittedLines = omitted.map(
    (record) =>
      `Option '${nameOf(record)}' had no user-provided values and is NOT in the option ` +
      `comparison — it was left out of this analysis and has NO numbers. Never state or ` +
      `imply a result, ranking, or probability for it.`,
  );
  const allLines = [...lines, ...omittedLines];
  const tail =
    analysed.length > 0
      ? 'Because placeholder values shift every option\'s relative position, treat the WHOLE ' +
        'comparison as illustrative until the scaffolded option(s) are configured. Never present ' +
        'a scaffolded option\'s numbers as real or user-provided; caveat any comparison that ' +
        'involves them.'
      : 'The comparison covers only the options listed in the analysis data. Do not describe the ' +
        'omitted option(s) as compared, ranked, or scored.';
  return `${allLines.join('\n')}\n${tail}`;
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
  // Review fix B12 (derive-don't-mirror): the label slots interpolate
  // SCAFFOLD_LABEL_MAX_CHARS instead of hand-mirroring {1,40}/{1,41} — the
  // chip slot is +1 for the trailing period the builder appends inside it.
  ` Placeholder values were used for (?:'[^'\\n]{1,${SCAFFOLD_LABEL_MAX_CHARS}}'|one of your options|\\d{1,2} of your options) ` +
  'because (?:it has|they have) no values set — ' +
  'the whole comparison is illustrative until you configure (?:it|them)\\. ' +
  `To set real values, say 'Help me configure [^'\\n]{1,${SCAFFOLD_LABEL_MAX_CHARS + 1}}\\.'`;

/**
 * Grammar source for the OMITTED suffix. Same three shapes, same pinned
 * `Help me configure …` exemplar, so the honest-omission copy is held to
 * exactly the discipline the placeholder copy is.
 */
export const SCAFFOLD_OMITTED_RE_SRC =
  ` (?:'[^'\\n]{1,${SCAFFOLD_LABEL_MAX_CHARS}}' was|One of your options was|\\d{1,2} of your options were) ` +
  'left out of this comparison because (?:it has|they have) no values set\\. ' +
  `To include (?:it|them), say 'Help me configure [^'\\n]{1,${SCAFFOLD_LABEL_MAX_CHARS + 1}}\\.'`;

/**
 * The union every consumer compiles — the registry egress allowlist tail,
 * the validation-registry salvage, and this module's own build-time
 * survival probe. Ordered `placeholder [omitted] | omitted` to match
 * {@link buildScaffoldDisclosureForPartition}'s append order, so the mixed
 * case is matchable as ONE tail rather than needing a second optional slot
 * in every consumer's pattern.
 */
export const SCAFFOLD_ANY_DISCLOSURE_RE_SRC =
  `(?:${SCAFFOLD_DISCLOSURE_RE_SRC}(?:${SCAFFOLD_OMITTED_RE_SRC})?|${SCAFFOLD_OMITTED_RE_SRC})`;

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * worst-case builder outputs (never hand-estimated), so an over-budget
 * disclosure cannot silently knock the summary back to the fallback.
 *
 * Covers the mixed case: the worst-case placeholder suffix AND the
 * worst-case omitted suffix can both ride on one summary.
 */
export const SCAFFOLD_DISCLOSURE_MAX_CHARS =
  Math.max(
    labelledSuffix('x'.repeat(SCAFFOLD_LABEL_MAX_CHARS)).length,
    genericSingleSuffix().length,
    pluralSuffix(99).length,
  ) +
  Math.max(
    omittedLabelledSuffix('x'.repeat(SCAFFOLD_LABEL_MAX_CHARS)).length,
    omittedGenericSingleSuffix().length,
    omittedPluralSuffix(99).length,
  );
