/**
 * Decision Records v1 — knowledge-over-time PROJECTION (ROADMAP 1.199, P6).
 *
 * The capture side (capture.ts) is write-only; this is the READ projection that
 * lets prior DECISIONS reach an LLM call site. Two layers:
 *
 *   1. `projectDecisionRecords(records, charBudget, totalStored)` — PURE.
 *      Compact, bounded, DISCLOSED-on-truncation projection of typed records
 *      into a prompt section. Each record → one provenance-stamped line
 *      `- [YYYY-MM-DD] Chose "<option>": <rationale>`. Bounded to `charBudget`;
 *      when records are dropped — for ANY reason, including the ones that never
 *      left the database — it appends a disclosure line stating the TRUE total
 *      (the estate's non-negotiable: a silent drop is the defect class, and a
 *      confidently-stated false count is the worst shape of it). No I/O.
 *   2. `loadOlderRelevantFactsSection({ store, scenarioId, charBudget })` — the
 *      fire-safe read+project loader (mirrors the rolling-summary injection
 *      loader). Reads the scenario's records via the store port (scenario-scoped
 *      at the bytes), projects them, and returns the section — or `undefined` on
 *      NO records / ANY failure, so the pack key is simply ABSENT (byte-identity
 *      for scenarios with no records; a store fault never fails a turn).
 */

import { log } from '../../utils/telemetry.js';
import { emitContextTruncation } from '../context/context-budget-telemetry.js';
import { projectDecisionRecordForWithheldClaim } from '../context/withheld-leader-projection.js';
import type {
  DecisionRecordRead,
  DecisionRecordStorePort,
} from './store-adapter.js';
import { DECISION_RECORDS_HARD_CAP } from './store-adapter.js';

/** Per-line rationale cap so one runaway statement cannot eat the whole budget. */
const RATIONALE_LINE_CHAR_CAP = 220;

/**
 * Headroom reserved below `charBudget` while accumulating lines, so the FINAL
 * text — body + the disclosure line + the JSON-serialisation wrapper the budget
 * emit measures (surrounding quotes + `\n`-escapes) — never exceeds `charBudget`.
 * Guarantees the section is genuinely ENFORCED (the emitted section_chars stay
 * under the declared ceiling, so neither computeOverBudget nor the divergence
 * tripwire flags a healthy full-budget projection).
 */
const BUDGET_SAFETY_HEADROOM = 200;

export interface DecisionRecordsProjection {
  /** The prompt-ready section text (includes the disclosure line when truncated). */
  readonly text: string;
  /** How many records made it into the text. */
  readonly includedCount: number;
  /**
   * How many records EXIST for the scenario — the store's pre-cap count, NOT
   * the length of the array this projection was handed. Deriving this from the
   * post-cap array is the defect (see {@link projectDecisionRecords}).
   */
  readonly totalCount: number;
  /** True when at least one record was dropped or a rationale was cut. */
  readonly truncated: boolean;
  /**
   * BODY chars actually kept — header + included lines, excluding the
   * disclosure line (which is metadata about the cut, not content).
   */
  readonly bodyChars: number;
  /**
   * BODY chars the section would have occupied had every line this projection
   * could render been included. `projectableChars > bodyChars` is exactly "the
   * CHAR budget cut something"; equal values with `includedCount < totalCount`
   * is exactly "whole records were dropped before they could be rendered".
   * Records lost at the SQL LIMIT contribute to NEITHER — their chars never
   * entered the process and are not invented.
   */
  readonly projectableChars: number;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** `2026-07-24T…Z` → `2026-07-24`; anything unparseable → the raw string. */
function isoDate(createdAt: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(createdAt);
  return m ? m[1] : createdAt;
}

/**
 * `mayNameLeadingOption === true` is the PASS-THROUGH branch and is byte-identical
 * to this function before the claim-safety gate existed. On `false` both
 * leader-bearing members go through
 * {@link projectDecisionRecordForWithheldClaim} — the ONE place the doctrine
 * and the shared substitution live.
 *
 * The char cap is applied AFTER the projection, deliberately: capping first
 * would measure a budget against content that is then replaced, and a
 * substituted rationale that happened to exceed the cap would ship uncapped.
 */
function projectOneLine(
  record: DecisionRecordRead,
  mayNameLeadingOption: boolean,
): { line: string; cut: boolean } | null {
  const option = readString(record.decision, 'chosen_option_label');
  const statement = readString(record.prediction, 'statement');
  if (option === null || statement === null) return null; // never id-as-label / empty
  const projected = mayNameLeadingOption
    ? { optionLabel: option, rationale: statement }
    : projectDecisionRecordForWithheldClaim(statement);
  let rationale = projected.rationale.trim();
  let cut = false;
  if (rationale.length > RATIONALE_LINE_CHAR_CAP) {
    rationale = `${rationale.slice(0, RATIONALE_LINE_CHAR_CAP)}…`;
    cut = true;
  }
  // Key-absence doctrine applied to prose: a withheld line carries NO
  // designation clause at all rather than an empty `Chose "": ` husk, which
  // would tell the model a designation existed and was removed — and would put
  // a shape no reader has ever seen into the prompt.
  const designation = projected.optionLabel === null ? '' : `Chose "${projected.optionLabel}": `;
  return { line: `- [${isoDate(record.created_at)}] ${designation}${rationale}`, cut };
}

const SECTION_HEADER = 'Prior decisions recorded on this scenario (most recent first):';

/**
 * The one disclosure line. It states BOTH numbers — the true total on record
 * and how many are shown — because the failure this replaced was not "the user
 * was told nothing", it was "the user was told a false number with full
 * confidence". A disclosure that only says "some were omitted" still leaves the
 * coach free to count the lines it can see and assert that as the total.
 *
 * Longest at `included = 0` (largest `omitted`), which is what the reservation
 * in {@link projectDecisionRecords} is computed against.
 */
function disclosureLine(included: number, totalStored: number): string {
  const omitted = totalStored - included;
  return (
    `\n[INCOMPLETE — ${totalStored} decision${totalStored === 1 ? '' : 's'} are on record for this ` +
    `scenario; the ${included} most recent are shown above and ${omitted} older ` +
    `${omitted === 1 ? 'one is' : 'ones are'} not shown. Do not describe this list as complete; ` +
    `if asked how many decisions are on record, the true total is ${totalStored}.]`
  );
}

/**
 * Project decision records into a bounded, HONESTLY-COUNTED prompt section, or
 * `null` when the scenario has no records at all.
 *
 * `totalStored` is the number of records that EXIST for the scenario — the
 * store's pre-cap count — and it is REQUIRED, deliberately. Every drop is
 * derived from it as a single subtraction (`totalStored - included`), which
 * covers the SQL cap, this function's own slice, unrenderable rows and the char
 * budget in ONE number with no per-path accounting to keep in step.
 *
 * That parameter is the fix for a live defect (build `55c64ed`, 2026-07-25):
 * `omitted` used to be derived from the POST-cap array, so it could only ever
 * report char-budget drops. With 9 records stored the SQL `LIMIT 8` dropped the
 * oldest before the process ever saw it, `omitted` computed to 0, no disclosure
 * was emitted, `truncated` was reported as `false` — and the coach, asked
 * point-blank for the total, answered "8" and called the list "the full
 * record". A default value for `totalStored` would let any future call site
 * silently restore exactly that, so there is none: a caller that cannot supply
 * the true total fails typecheck instead of lying.
 *
 * A record that exists but cannot be rendered (no option label / no statement)
 * counts as NOT SHOWN rather than as "not really a record". Claiming
 * completeness because a row failed to render is the same falsehood in
 * miniature.
 *
 * `mayNameLeadingOption` is the turn's ONE persisted claim-safety verdict,
 * threaded from the caller — this function never re-derives it, so the
 * permission and the content it governs describe the same turn (CLAUDE.md trap
 * #12). REQUIRED, with no default, for the same reason `totalStored` has none:
 * an optional claim-permission is one a future call site silently forgets to
 * supply, and the forgotten value would be the PERMISSIVE one. A caller that
 * cannot answer fails typecheck instead of leaking.
 */
export function projectDecisionRecords(
  records: readonly DecisionRecordRead[],
  charBudget: number,
  totalStored: number,
  mayNameLeadingOption: boolean,
): DecisionRecordsProjection | null {
  const usable = records.slice(0, DECISION_RECORDS_HARD_CAP);
  // Defensive clamp: the total can never be smaller than what we were actually
  // handed. Guards a miscounting caller from producing a NEGATIVE omission.
  const total = Math.max(
    Number.isFinite(totalStored) ? Math.floor(totalStored) : 0,
    usable.length,
  );
  if (total === 0) return null;

  // Accumulate against a REDUCED ceiling so the disclosure line + JSON wrapper
  // still fit under the real budget. The disclosure's own length is RESERVED
  // exactly (worst case = fewest included) rather than hoped to fit inside
  // BUDGET_SAFETY_HEADROOM, so "the section never exceeds charBudget" stays a
  // derived guarantee after the line got longer.
  const disclosureReserve = disclosureLine(0, total).length;
  const accumulationCeiling = Math.max(
    SECTION_HEADER.length,
    charBudget - BUDGET_SAFETY_HEADROOM - disclosureReserve,
  );

  // Project each usable record ONCE (simplification F7 / 2026-07-24): both the
  // inclusion loop and the total-projectable count read this array, instead of
  // re-running projectOneLine (date regex + trim + slice) over every record a
  // second time purely to count omissions.
  const projectedLines: Array<{ line: string; cut: boolean }> = [];
  for (const record of usable) {
    const projected = projectOneLine(record, mayNameLeadingOption);
    if (projected !== null) projectedLines.push(projected);
  }

  let anyRationaleCut = false;
  let body = SECTION_HEADER;
  let included = 0;
  let projectableChars = SECTION_HEADER.length;
  for (const projected of projectedLines) {
    projectableChars += 1 + projected.line.length;
    const candidate = `${body}\n${projected.line}`;
    if (candidate.length > accumulationCeiling) break;
    body = candidate;
    included += 1;
    if (projected.cut) anyRationaleCut = true;
  }

  // `included === 0` with records on file is NOT "nothing to say" — it is the
  // total-loss case (a single pathological line can push the first candidate
  // over the ceiling). Returning null there would drop the whole section and
  // leave the coach believing the scenario has no decision history, which is
  // the same falsehood the disclosure exists to prevent. Emit the header plus
  // the disclosure so the count is still true.
  const omitted = total - included;
  const truncated = omitted > 0 || anyRationaleCut;
  const text = omitted > 0 ? `${body}${disclosureLine(included, total)}` : body;

  return {
    text,
    includedCount: included,
    totalCount: total,
    truncated,
    bodyChars: body.length,
    projectableChars,
  };
}

export interface LoadOlderRelevantFactsArgs {
  readonly store: Pick<DecisionRecordStorePort, 'retrieveRecords'>;
  readonly scenarioId: string;
  readonly charBudget: number;
  /**
   * The turn's persisted claim-safety verdict. REQUIRED — see
   * {@link projectDecisionRecords} for why there is no default.
   */
  readonly mayNameLeadingOption: boolean;
  readonly requestId?: string | null;
}

/**
 * Fire-safe read+project loader. Returns the projected section, or `undefined`
 * when the scenario has no records OR any read/projection fault occurs — so the
 * caller simply omits the pack key. NEVER throws (a knowledge-read fault must
 * degrade the coach's memory of prior decisions, never fail the turn).
 */
export async function loadOlderRelevantFactsSection(
  args: LoadOlderRelevantFactsArgs,
): Promise<DecisionRecordsProjection | undefined> {
  try {
    const page = await args.store.retrieveRecords(args.scenarioId, {
      limit: DECISION_RECORDS_HARD_CAP,
    });
    if (page.totalCount === 0 && page.records.length === 0) return undefined;
    const projection = projectDecisionRecords(
      page.records,
      args.charBudget,
      page.totalCount,
      args.mayNameLeadingOption,
    );
    if (projection === null) return undefined;
    // Emit at the CUT SITE, the moment content is dropped — the truncation
    // stream's stated contract. Before this the projection's own `truncated`
    // flag reached no telemetry at all: it existed only as prose inside the
    // model-facing prompt, so `v5.context_budget.truncations` read `[]` on the
    // very turn a record was evicted.
    if (projection.truncated) {
      emitContextTruncation({
        site: 'decision-records.loadOlderRelevantFactsSection',
        section: 'older_relevant_facts',
        // Chars are only meaningful for the CHAR-budget cut; a record dropped
        // by the SQL LIMIT never entered the process, so its chars are not
        // knowable and are not invented. `original_chars === kept_chars` with
        // `kept_records < original_records` is exactly "records were dropped,
        // no char cut occurred".
        original_chars: projection.projectableChars,
        kept_chars: projection.bodyChars,
        original_records: projection.totalCount,
        kept_records: projection.includedCount,
        strategy:
          projection.includedCount < projection.totalCount ? 'record_drop' : 'rationale_cap',
        disclosed: true,
        request_id: args.requestId ?? null,
        scenario_id: args.scenarioId,
      });
    }
    return projection;
  } catch (err) {
    log.warn(
      {
        event: 'v5.decision_records.read_failed',
        scenario_id: args.scenarioId,
        request_id: args.requestId ?? null,
        err: err instanceof Error ? err.message : String(err),
      },
      'DecisionRecords — older-relevant-facts read failed (non-fatal; the section is omitted, the turn is unaffected)',
    );
    return undefined;
  }
}
