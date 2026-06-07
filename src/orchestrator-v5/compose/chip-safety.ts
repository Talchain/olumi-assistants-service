/**
 * V5 Lane 2 — egress chip-safety primitives (leakage-only SSOT).
 *
 * `chip-finalizer.ts` runs at the V5 egress chokepoint over EVERY chip
 * (generated, floor, proposal, recovery), so its safety filter must be a
 * leakage-only SUBSET of `proposed-change.ts`'s `SAFETY_FORBIDDEN_TOKENS`:
 *
 *   - INCLUDE only substring-safe internal markers: underscored handler
 *     ids, schema/Zod jargon, pending-action vocabulary, the `{"` JSON
 *     opener, and the `prop_` / `chip_` raw-id prefixes. None collide with
 *     ordinary Title-Case user copy (handler ids carry underscores, so
 *     "Run analysis" never contains "run_analysis").
 *
 *   - EXCLUDE the em dash `—` and `":`. `proposed-change.ts` keeps them
 *     because proposal copy is author-controlled at emit time, but at
 *     egress they false-positive on legitimately composed prose — two
 *     live chips use em dashes (the decide-stage pre-mortem prompt and the
 *     edit-clarify Cancel chip), and `":` appears in ordinary text.
 *
 *   - NEVER add Communication Glossary words (winner / recommendation /
 *     graph / node / edge …). Substring matching would fire on ordinary
 *     words ("edge" inside "knowledge", "node" inside "anode"). Glossary
 *     enforcement at egress, if ever needed, must be a SEPARATE
 *     word-boundary validator with explicit false-positive coverage — not
 *     this list.
 *
 * `tests/.../chip-safety.test.ts` asserts CHIP_EGRESS_FORBIDDEN_TOKENS is a
 * subset of SAFETY_FORBIDDEN_TOKENS so the two cannot silently drift.
 */

/**
 * Leakage-only forbidden-token list applied to chip label/message at
 * egress. Case-insensitive substring match. A subset of
 * `proposed-change.ts`'s `SAFETY_FORBIDDEN_TOKENS` (which adds the
 * typographic `—` and `":` for stricter author-time proposal copy).
 */
export const CHIP_EGRESS_FORBIDDEN_TOKENS: readonly string[] = [
  // pending-action / proposal internal vocabulary
  'apply_proposed_change',
  'pending_actions',
  'proposal_ref',
  'chip_metadata',
  'graph_hash',
  // V5 handler ids — bare underscored identifiers, never in visible copy
  'add_constraint',
  'set_factor_value',
  'adjust_edge_strength',
  'run_analysis',
  'what_would_flip',
  'explain_from_structure',
  'explain_results',
  'explain_result',
  'compare_options',
  'edit_graph_add_risk',
  // schema / validation / Zod jargon
  'zod',
  'structural_validation_failed',
  'entity_kind_mismatch',
  'precondition_unmet',
  'invalid_type',
  // raw JSON object opener (serialised internals leaking into a label)
  '{"',
  // raw id prefixes the chip layer must not leak in VISIBLE text
  'prop_',
  'chip_',
];

/**
 * Case-insensitive substring match against {@link CHIP_EGRESS_FORBIDDEN_TOKENS}.
 * Returns the matched token (original casing) or null when nothing
 * forbidden appears.
 */
export function findChipLeakToken(value: string): string | null {
  const haystack = value.toLowerCase();
  for (const token of CHIP_EGRESS_FORBIDDEN_TOKENS) {
    if (haystack.includes(token.toLowerCase())) return token;
  }
  return null;
}

/**
 * Recognised user-scale display formats that legitimately carry a
 * fractional value:
 *   - currency prefix: `£1.50`, `$2.25`, `€3.10` (optional space, thousands)
 *   - percent suffix:  `12.5%` (optional space before %)
 *
 * Time / explicit-unit displays from `format-factor-value.ts` are always
 * whole numbers, so a decimal under a unit word is never produced by the
 * live path and is treated as bare-unitless (caught as a leak).
 */
const RECOGNISED_DECIMAL_RE =
  /(?:[£$€]\s?\d[\d,]*\.\d+)|(?:\b\d+\.\d+\s?%)/g;

/** Any decimal number; the capture group is the fractional part incl. the dot. */
const ANY_DECIMAL_RE = /\b\d+(\.\d+)\b/g;

/**
 * The WHOLE string is essentially just a bare decimal (optionally a leading
 * `=`), e.g. `0.8`, `= 0.8`, `0.4732`. This shape is an internal value leak —
 * a chip whose label/message is nothing but a number. A decimal EMBEDDED in a
 * phrase (`Plan 2.5`, `2.5 days`) is NOT matched, so user-authored
 * candidate/option names survive.
 */
const STANDALONE_BARE_DECIMAL_RE = /^[\s=]*\d+\.\d+\s*$/;

/** A decimal is "high precision" — internal numeric precision — at ≥3 dp. */
const HIGH_PRECISION_FRACTION_DIGITS = 3;

interface DecimalSpan {
  readonly start: number;
  readonly end: number;
}

function recognisedDecimalSpans(text: string): DecimalSpan[] {
  const spans: DecimalSpan[] = [];
  const re = new RegExp(RECOGNISED_DECIMAL_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function withinAnySpan(spans: readonly DecimalSpan[], start: number, end: number): boolean {
  for (const s of spans) {
    if (start >= s.start && end <= s.end) return true;
  }
  return false;
}

/**
 * Detect a "raw decimal" leak in chip copy per the approved Lane 2 rule
 * (narrow heuristic, validated-proposal exempt). A decimal is leaky when:
 *
 *   1. the WHOLE string is a **standalone bare decimal** (`0.8`, `= 0.8`,
 *      `0.4732`) — a chip whose copy is nothing but a number; OR
 *   2. it is **high-precision** (≥3 fractional digits, e.g. `0.4732`) — a
 *      signal of internal numeric precision regardless of surrounding text.
 *
 * A LOW-precision decimal embedded in a phrase is NOT leaky: user-authored
 * candidate/option names (`Plan 2.5`, `2.5 days`) and display values
 * (`12.5%`, `£1.50`) must survive. (This is the refinement that closed the
 * `Plan 2.5` false-positive raised in the #239 review.)
 *
 *   Exemption: a **validated proposal-backed chip** (`prop_` id + a proposal
 *   `action_type`, asserted by the caller via `isValidatedProposal`) is
 *   allowed to keep a high-precision decimal ONLY when it carries a recognised
 *   currency/percent format (a pre-vetted display value, e.g. a `12.567%`
 *   threshold). A standalone bare decimal is never exempt.
 *
 * Returns true when a non-exempt leaky decimal is present in either field.
 */
export function findChipRawDecimalLeak(
  label: string,
  message: string,
  opts: { readonly isValidatedProposal: boolean },
): boolean {
  for (const text of [label, message]) {
    if (text.length === 0) continue;
    // 1. The whole string is just a bare decimal → leak (never exempt).
    if (STANDALONE_BARE_DECIMAL_RE.test(text)) return true;
    // 2. High-precision decimals anywhere in the text.
    const recognised = recognisedDecimalSpans(text);
    const re = new RegExp(ANY_DECIMAL_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const fractionDigits = m[1].length - 1; // m[1] is ".ddd"
      if (fractionDigits < HIGH_PRECISION_FRACTION_DIGITS) continue; // low-precision embedded → kept
      const start = m.index;
      const end = m.index + m[0].length;
      const formatted = withinAnySpan(recognised, start, end);
      // A validated proposal may carry a high-precision FORMATTED display
      // value (currency/percent) — exempt only those.
      if (opts.isValidatedProposal && formatted) continue;
      return true;
    }
  }
  return false;
}
