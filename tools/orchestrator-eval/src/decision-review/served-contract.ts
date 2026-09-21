/**
 * decision_review — the SERVED prompt's own terminology contract, DERIVED.
 *
 * ── Why this file is a parser and not a list ─────────────────────────────────
 *
 * The decision_review prompt states its output-string bans itself, in one
 * block (`Prompts/canonical/decision_review.txt`, the `<TERMINOLOGY>` section's
 * closing `BANNED in every output string, no exceptions:` list). A scorer that
 * retyped those terms would be a hand-maintained mirror of a document that
 * changes — trap 12, the dominant defect class here, and exactly the drift the
 * `tools/graph-evaluator` `BANNED_TERMS` copy already demonstrates. So the
 * lexicon dimensions PARSE the block out of the canonical export instead.
 *
 * The canonical export is not a proxy for the served prompt — it IS the served
 * prompt. Verified at this tip: `sha256(Prompts/canonical/decision_review.txt)`
 * begins `b4f15305c2bb32e9`, which is the manifest's
 * `live_served_hash_observed` for PMS `decision_review_default` v14
 * (`served_hash_verified: true`). Parsing it therefore measures compliance with
 * the contract staging actually serves, and tracks a prompt bump for free.
 *
 * ── Why a frozen floor sits alongside the parse (trap 12b) ───────────────────
 *
 * A control pinned to "whatever is current" decays into a tautology the first
 * time current changes: if a future prompt revision quietly DROPPED
 * "recommendation" from its banned list, a purely-derived dimension would stop
 * checking it and keep reporting green. So the derived set is paired with
 * {@link V14_BANNED_LEXICON_FLOOR} — a permanently frozen snapshot of the v14
 * terms, asserted as a SUBSET of whatever the prompt currently bans.
 *
 * The two have deliberately different jobs and must not be merged:
 *   - the DERIVED set is what the scorer uses (it tracks live, so it can never
 *     be a stale mirror);
 *   - the FROZEN floor is what the drift test uses (it is pinned to a
 *     historical artefact by hash, so a silent relaxation of the contract goes
 *     RED and a human decides whether the relaxation was intended).
 *
 * A superset (the prompt banning MORE than v14 did) is reported, not failed —
 * that is a contract tightening, which the derived set picks up automatically.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The canonical export of the served decision_review prompt (read-only here). */
export const CANONICAL_DECISION_REVIEW_PROMPT_PATH = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'Prompts',
  'canonical',
  'decision_review.txt',
);

/**
 * The served-prompt hash this parser was written against (PMS
 * `decision_review_default` v14, `served_hash_verified: true` in
 * `Prompts/canonical/manifest.json`). Recorded so a baseline report names the
 * exact contract it measured; NOT asserted as equal at run time, because the
 * whole point of parsing is to keep working across a prompt bump.
 */
export const V14_SERVED_HASH_16 = 'b4f15305c2bb32e9';

/** sha256 (first 16 hex chars) of a prompt text — the manifest's own format. */
export function promptHash16(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
}

/** Read the canonical served prompt text. */
export function readServedPromptText(path: string = CANONICAL_DECISION_REVIEW_PROMPT_PATH): string {
  return readFileSync(path, 'utf-8');
}

// ============================================================================
// The parse
// ============================================================================

const BANNED_BLOCK_START = 'BANNED in every output string, no exceptions:';
const BANNED_BLOCK_END = '</TERMINOLOGY>';
const INTERNAL_VOCAB_MARKER = '- Internal vocabulary:';
/** The `Translate: …` sentence ends the internal-vocabulary enumeration. */
const INTERNAL_VOCAB_TERMINATOR = 'Translate:';

export interface ServedTerminologyContract {
  /**
   * Banned user-facing terms and phrases — every double-quoted token in the
   * banned block EXCEPT the ones inside the raw-decimal bullet's worked
   * examples (`"62%"`, `"0.62"`, `"7 percentage points"`, `"0.07"`), which are
   * illustrations of a numeric rule, not bannable words. Lower-cased.
   */
  readonly bannedTerms: readonly string[];
  /**
   * Internal vocabulary that must never surface in output prose — the
   * comma-separated identifier list from the `- Internal vocabulary:` bullet,
   * stopped at its `Translate:` sentence. Lower-cased.
   */
  readonly internalVocabulary: readonly string[];
  /** True when the block bans em dashes (the `- Em dashes;` bullet). */
  readonly bansEmDashes: boolean;
  /** The raw banned block, for reporting/debugging. */
  readonly rawBlock: string;
}

/**
 * Words that mark the quoted token AFTER them as a PRESCRIPTION (the form the
 * prompt wants) rather than a ban. Derived from the block's own phrasing:
 * `write "62%"`, `say "the latest available run"`, `Translate: "…"`.
 */
const PRESCRIPTION_MARKERS = /\b(say|write|instead|use)\b/i;

/** A word that marks the quoted token after it as an explicit ban. */
const BAN_MARKER = /\bnever\b/i;

/**
 * Once this appears in a bullet, EVERY remaining quoted token in that bullet is
 * a prescribed replacement (the internal-vocabulary bullet's `Translate:`
 * sentence lists only replacements).
 */
const PRESCRIPTION_MODE_SWITCH = 'Translate:';

/**
 * Split the banned block into bullets, JOINING each bullet's wrapped
 * continuation lines into one line.
 *
 * Joining is load-bearing, not cosmetic: quoted phrases wrap across lines in
 * the source (`"confidence this\n  result holds"`), and a per-line quote scan
 * pairs the wrong quotes — the first draft of this parser emitted a bare `","`
 * as a "banned term" for exactly that reason. A banned term of `,` would match
 * every review ever written.
 */
function splitBullets(rawBlock: string): string[] {
  const bullets: string[] = [];
  for (const line of rawBlock.split('\n')) {
    if (/^\s*-\s/.test(line)) bullets.push(line.trim());
    else if (bullets.length > 0) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return bullets;
}

/**
 * Extract the BANNED quoted tokens from one joined bullet, skipping prescribed
 * replacements. Scans left to right so each token is classified by the text
 * immediately preceding it.
 */
function bannedTokensInBullet(bullet: string): string[] {
  const out: string[] = [];
  const switchAt = bullet.indexOf(PRESCRIPTION_MODE_SWITCH);
  let cursor = 0;
  for (const m of bullet.matchAll(/"([^"\n]+)"/g)) {
    const openIndex = m.index ?? 0;
    const preceding = bullet.slice(cursor, openIndex);
    cursor = openIndex + m[0].length;
    if (switchAt !== -1 && openIndex > switchAt) continue; // after `Translate:`
    if (PRESCRIPTION_MARKERS.test(preceding) && !BAN_MARKER.test(preceding)) continue;
    const token = m[1].trim().toLowerCase();
    // A banned LEXICON term contains a letter. This drops two classes that the
    // block quotes but this dimension must not own:
    //   - punctuation fragments a mis-paired quote scan can produce (`,`) —
    //     belt-and-braces now that bullets are joined;
    //   - the raw-decimal bullet's numeric literals (`"0.62"`, `"0.07"`), which
    //     are INSTANCES of the raw-decimal rule that
    //     `no_raw_probability_decimals` scores in general. One source of truth
    //     per rule, same doctrine as STALENESS_TOKENS_OWNED_BY_R_CONT.
    if (token.length > 0 && /[a-z]/.test(token)) out.push(token);
  }
  return out;
}

/**
 * The quoted tokens that belong to the STALENESS bullet. They are genuinely
 * banned, but the runtime already enforces them through R-CONT
 * (`FABRICATED_CONTINUITY_PATTERNS` in `src/cee/decision-review/contract-gate.ts`
 * carries `previous analysis`, `prior analysis`, `cached result` verbatim).
 * Excluding them here keeps ONE source of truth per rule: a hit is reported by
 * the production-guard dimension, not by two dimensions with different
 * provenance. The drift test asserts the runtime patterns still cover them, so
 * dropping them from this exclusion set can never silently lose the check.
 */
export const STALENESS_TOKENS_OWNED_BY_R_CONT: ReadonlySet<string> = new Set([
  'previous analysis',
  'prior analysis',
  'cached result',
]);

/**
 * Parse the served prompt's terminology contract.
 *
 * FAIL-LOUD: a prompt whose banned block cannot be located throws. A parser
 * that silently returned an empty lexicon would make every lexicon dimension
 * pass vacuously — the anti-vacuity failure this pack exists to prevent, one
 * level up from the scorer.
 */
export function parseServedTerminologyContract(promptText: string): ServedTerminologyContract {
  const start = promptText.indexOf(BANNED_BLOCK_START);
  if (start === -1) {
    throw new Error(
      `served decision_review prompt has no "${BANNED_BLOCK_START}" block — the terminology ` +
        'dimensions cannot be derived. Refusing to score with an empty lexicon (that would pass ' +
        'every lexicon dimension vacuously). Re-derive the parser against the current prompt.',
    );
  }
  const end = promptText.indexOf(BANNED_BLOCK_END, start);
  if (end === -1) {
    throw new Error(
      `served decision_review prompt has no "${BANNED_BLOCK_END}" terminator after the banned ` +
        'block — refusing to guess where the block ends.',
    );
  }
  const rawBlock = promptText.slice(start, end);

  // Banned terms: the BANNED quoted tokens of every bullet (prescriptions
  // skipped), minus the staleness phrases R-CONT already owns.
  const quoted = splitBullets(rawBlock).flatMap(bannedTokensInBullet);
  const bannedTerms = [
    ...new Set(quoted.filter((t) => !STALENESS_TOKENS_OWNED_BY_R_CONT.has(t))),
  ];
  if (bannedTerms.length === 0) {
    throw new Error('served prompt banned block parsed to ZERO banned terms — refusing (vacuous).');
  }

  // Internal vocabulary: the identifier list on the `- Internal vocabulary:`
  // bullet, up to its `Translate:` sentence.
  const vocabStart = rawBlock.indexOf(INTERNAL_VOCAB_MARKER);
  let internalVocabulary: string[] = [];
  if (vocabStart !== -1) {
    const afterMarker = rawBlock.slice(vocabStart + INTERNAL_VOCAB_MARKER.length);
    const terminator = afterMarker.indexOf(INTERNAL_VOCAB_TERMINATOR);
    const listText = terminator === -1 ? afterMarker : afterMarker.slice(0, terminator);
    internalVocabulary = [
      ...new Set(
        listText
          .split(',')
          .map((s) => s.replace(/[.\s]+$/g, '').trim().toLowerCase())
          .filter((s) => s.length > 0 && /^[a-z][a-z0-9_]*$/.test(s)),
      ),
    ];
  }
  if (internalVocabulary.length === 0) {
    throw new Error(
      'served prompt banned block parsed to ZERO internal-vocabulary terms — refusing (vacuous).',
    );
  }

  return {
    bannedTerms,
    internalVocabulary,
    bansEmDashes: /- Em dashes/i.test(rawBlock),
    rawBlock,
  };
}

// ============================================================================
// TONE ALIGNMENT — also derived, not retyped
//
// The prompt carries a four-row table (`TONE ALIGNMENT (follow the MORE
// CAUTIOUS of readiness | headline_type)`) mapping the run's readiness /
// headline_type to a tone and to phrasings that are FORBIDDEN at that tone.
// `tools/graph-evaluator/src/decision-review-scorer.ts` retyped that table as a
// `TONE_RULES` constant in March and it has not been re-checked since — the
// same mirror defect as `BANNED_TERMS`. Parsing it means the tone dimension
// tracks the served contract.
//
// CAUTIOUSNESS IS ROW ORDER. The header says to follow the MORE CAUTIOUS of the
// two signals, and the table is written least-cautious first (ready →
// close_call → needs_evidence → needs_framing). So "more cautious" is "later
// row", and the resolver takes the max row index the two signals select. This
// is a property of the table's own layout, read from the table, not assumed.
// ============================================================================

const TONE_TABLE_HEADER = '| readiness | headline_type | Tone | Forbidden phrasing |';

export interface ToneRow {
  /** 0 = least cautious. Row order in the served table. */
  readonly cautionRank: number;
  readonly readiness: readonly string[];
  readonly headlineTypes: readonly string[];
  readonly tone: string;
  /** Phrasings forbidden at this tone, lower-cased. Empty for `none`. */
  readonly forbidden: readonly string[];
}

/** Parse the TONE ALIGNMENT table. Throws when it cannot be located. */
export function parseToneTable(promptText: string): ToneRow[] {
  const headerAt = promptText.indexOf(TONE_TABLE_HEADER);
  if (headerAt === -1) {
    throw new Error(
      'served decision_review prompt has no TONE ALIGNMENT table header — refusing to score ' +
        'tone against a table that is not there (an empty table would pass every candidate).',
    );
  }
  const lines = promptText.slice(headerAt).split('\n').slice(1);
  const rows: ToneRow[] = [];
  for (const line of lines) {
    if (!line.trim().startsWith('|')) break; // table ends at the first non-row
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4) break;
    const [readiness, headlineTypes, tone, forbidden] = cells;
    rows.push({
      cautionRank: rows.length,
      readiness: readiness.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      headlineTypes: headlineTypes.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      tone,
      forbidden:
        /^none$/i.test(forbidden.trim())
          ? []
          : [...forbidden.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim().toLowerCase()),
    });
  }
  if (rows.length === 0) throw new Error('TONE ALIGNMENT table parsed to ZERO rows — refusing (vacuous).');
  return rows;
}

/**
 * Resolve the applicable tone row for a run: the MORE CAUTIOUS (later) of the
 * rows selected by `readiness` and by `headline_type`. A `headline_type` cell of
 * `any` matches nothing on its own — that row is reachable only via its
 * readiness value, which is what "needs_framing | any" means.
 *
 * Returns null when neither signal matches any row (unknown vocabulary): the
 * dimension then reports "not applicable" rather than inventing a verdict.
 */
export function resolveToneRow(
  rows: readonly ToneRow[],
  readiness: string | null,
  headlineType: string | null,
): ToneRow | null {
  const r = readiness?.trim().toLowerCase() ?? '';
  const h = headlineType?.trim().toLowerCase() ?? '';
  let best: ToneRow | null = null;
  for (const row of rows) {
    const byReadiness = r.length > 0 && row.readiness.includes(r);
    const byHeadline = h.length > 0 && row.headlineTypes.includes(h);
    if (!byReadiness && !byHeadline) continue;
    if (best === null || row.cautionRank > best.cautionRank) best = row;
  }
  return best;
}

// ============================================================================
// The frozen historical floor (trap 12b)
// ============================================================================

/**
 * The banned lexicon as served by PMS `decision_review_default` **v14**
 * (`Prompts/canonical/decision_review.txt:114-115`, prompt hash
 * `b4f15305c2bb32e9`, frozen 2026-07-31).
 *
 * PERMANENTLY PINNED TO THAT HISTORICAL ARTEFACT. Never "refresh" this to
 * match a newer prompt — that is precisely the move that turns a control into
 * a tautology. If a prompt revision legitimately retires a term, the drift test
 * goes RED, a human reviews the retirement, and the retirement is recorded HERE
 * as an explicit, dated exception with its reason.
 */
export const V14_BANNED_LEXICON_FLOOR: readonly string[] = [
  'winner',
  'winning',
  'wins',
  'win rate',
  'recommendation',
  'recommended',
  'recommend',
  'the best choice',
  'the optimal choice',
  'you should choose',
];

/**
 * The internal-vocabulary floor at v14
 * (`Prompts/canonical/decision_review.txt:121-125`). Same freezing doctrine as
 * {@link V14_BANNED_LEXICON_FLOOR}.
 */
export const V14_INTERNAL_VOCABULARY_FLOOR: readonly string[] = [
  'headline_type',
  'readiness',
  'voi',
  'elasticity',
  'attribution_stability',
  'rank_flip_rate',
  'model_critiques',
  'recommendation_stability',
  'exists_probability',
  'factor_sensitivity',
  'switch_probability',
  'win_probability',
  'zero_reason',
  'intervention_override',
  'dsk_claim_id',
  'evidence_strength',
  'validator',
  'schema',
  'node',
  'edge',
  'graph',
];

export interface ContractDriftReport {
  /** Floor terms the CURRENT prompt no longer bans — a silent relaxation. */
  readonly lexiconRetired: readonly string[];
  /** Terms the current prompt bans that v14 did not — a tightening (fine). */
  readonly lexiconAdded: readonly string[];
  readonly vocabularyRetired: readonly string[];
  readonly vocabularyAdded: readonly string[];
}

/** Compare a parsed contract against the frozen v14 floor. */
export function diffAgainstV14Floor(contract: ServedTerminologyContract): ContractDriftReport {
  const banned = new Set(contract.bannedTerms);
  const vocab = new Set(contract.internalVocabulary);
  return {
    lexiconRetired: V14_BANNED_LEXICON_FLOOR.filter((t) => !banned.has(t)),
    lexiconAdded: contract.bannedTerms.filter((t) => !V14_BANNED_LEXICON_FLOOR.includes(t)),
    vocabularyRetired: V14_INTERNAL_VOCABULARY_FLOOR.filter((t) => !vocab.has(t)),
    vocabularyAdded: contract.internalVocabulary.filter(
      (t) => !V14_INTERNAL_VOCABULARY_FLOOR.includes(t),
    ),
  };
}
