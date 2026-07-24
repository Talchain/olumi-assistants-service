/**
 * Decision Records v1 — knowledge-over-time PROJECTION (ROADMAP 1.199, P6).
 *
 * The capture side (capture.ts) is write-only; this is the READ projection that
 * lets prior DECISIONS reach an LLM call site. Two layers:
 *
 *   1. `projectDecisionRecords(records, charBudget)` — PURE. Compact, bounded,
 *      DISCLOSED-on-truncation projection of typed records into a prompt
 *      section. Each record → one provenance-stamped line
 *      `- [YYYY-MM-DD] Chose "<option>": <rationale>`. Bounded to `charBudget`;
 *      when records are dropped it appends an honest disclosure line (the
 *      estate's non-negotiable — a silent drop is the defect class). No I/O.
 *   2. `loadOlderRelevantFactsSection({ store, scenarioId, charBudget })` — the
 *      fire-safe read+project loader (mirrors the rolling-summary injection
 *      loader). Reads the scenario's records via the store port (scenario-scoped
 *      at the bytes), projects them, and returns the section — or `undefined` on
 *      NO records / ANY failure, so the pack key is simply ABSENT (byte-identity
 *      for scenarios with no records; a store fault never fails a turn).
 */

import { log } from '../../utils/telemetry.js';
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
  /** How many records were offered to the projection. */
  readonly totalCount: number;
  /** True when at least one record was dropped or a rationale was cut. */
  readonly truncated: boolean;
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

function projectOneLine(record: DecisionRecordRead): { line: string; cut: boolean } | null {
  const option = readString(record.decision, 'chosen_option_label');
  const statement = readString(record.prediction, 'statement');
  if (option === null || statement === null) return null; // never id-as-label / empty
  let rationale = statement.trim();
  let cut = false;
  if (rationale.length > RATIONALE_LINE_CHAR_CAP) {
    rationale = `${rationale.slice(0, RATIONALE_LINE_CHAR_CAP)}…`;
    cut = true;
  }
  return { line: `- [${isoDate(record.created_at)}] Chose "${option}": ${rationale}`, cut };
}

const SECTION_HEADER = 'Prior decisions recorded on this scenario (most recent first):';

/**
 * Project decision records into a bounded, disclosed prompt section, or `null`
 * when there is nothing usable to show. Records are consumed newest-first (the
 * order the store returns them); the projection stops adding lines once the
 * next line would exceed `charBudget`, and discloses how many were omitted.
 */
export function projectDecisionRecords(
  records: readonly DecisionRecordRead[],
  charBudget: number,
): DecisionRecordsProjection | null {
  const usable = records.slice(0, DECISION_RECORDS_HARD_CAP);
  // Accumulate against a REDUCED ceiling so the disclosure line + JSON wrapper
  // still fit under the real budget (see BUDGET_SAFETY_HEADROOM).
  const accumulationCeiling = Math.max(SECTION_HEADER.length, charBudget - BUDGET_SAFETY_HEADROOM);
  let anyRationaleCut = false;
  let body = SECTION_HEADER;
  let included = 0;

  for (const record of usable) {
    const projected = projectOneLine(record);
    if (projected === null) continue;
    const candidate = `${body}\n${projected.line}`;
    if (candidate.length > accumulationCeiling) break;
    body = candidate;
    included += 1;
    if (projected.cut) anyRationaleCut = true;
  }

  if (included === 0) return null;

  // totalCount = usable records that COULD have been projected (had a usable
  // option+statement), so the disclosure reflects real omissions, not skips.
  const projectableTotal = usable.reduce(
    (acc, r) => acc + (projectOneLine(r) !== null ? 1 : 0),
    0,
  );
  const omitted = projectableTotal - included;
  const truncated = omitted > 0 || anyRationaleCut;
  let text = body;
  if (omitted > 0) {
    const disclosure = `\n[+${omitted} earlier decision${omitted === 1 ? '' : 's'} omitted for length]`;
    // The disclosure is always additive within the headroom we reserved above.
    text = `${text}${disclosure}`;
  }

  return { text, includedCount: included, totalCount: projectableTotal, truncated };
}

export interface LoadOlderRelevantFactsArgs {
  readonly store: Pick<DecisionRecordStorePort, 'retrieveRecords'>;
  readonly scenarioId: string;
  readonly charBudget: number;
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
    const records = await args.store.retrieveRecords(args.scenarioId, {
      limit: DECISION_RECORDS_HARD_CAP,
    });
    if (records.length === 0) return undefined;
    const projection = projectDecisionRecords(records, args.charBudget);
    return projection ?? undefined;
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
