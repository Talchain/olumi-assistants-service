/**
 * V5 staging assurance — pure extraction + red/amber/green classifiers.
 *
 * These functions take plain, already-extracted data (no I/O) so they are
 * fixture-testable. The orchestrator (`./run.ts`) performs the HTTP/DB I/O,
 * extracts the wire/DB facts via the helpers here, and calls the
 * classifiers. Each classifier returns a `CheckResult` for the report.
 *
 * Safety-class philosophy (per the brief): we assert SAFETY CLASS and
 * provenance, never exact prose. The hardest case —
 * `confident_advice_under_unsafe_state` — is green when the answer degrades
 * to a staleness caveat / rerun guidance, amber when the model self-declines
 * without explicit rerun guidance, and red when confident current-result
 * advice reaches the user under genuine stale state.
 */

import type { TurnResponse } from '../types.js';
import { findForbiddenMatches } from '../forbidden-terms.js';
import { scanUserFacingSurfaces } from './blocked-claim-fields.js';
import type { CheckResult, RagStatus } from './report.js';

export const ANALYSIS_NOT_READY_CHIP_ID = 'chip_prompt_fix_before_analysis';

export interface Chip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type?: string;
}

export function extractChips(body: TurnResponse | undefined): Chip[] {
  const actions = body?.suggested_actions ?? [];
  return actions.map((a) => ({
    id: typeof a.id === 'string' ? a.id : '',
    label: typeof a.label === 'string' ? a.label : '',
    message: typeof a.message === 'string' ? a.message : '',
    ...(typeof a.action_type === 'string' ? { action_type: a.action_type } : {}),
  }));
}

export function chipStrings(chips: readonly Chip[]): string[] {
  const out: string[] = [];
  for (const c of chips) {
    if (c.label) out.push(c.label);
    if (c.message) out.push(c.message);
  }
  return out;
}

export function assistantText(body: TurnResponse | undefined): string {
  return typeof body?.assistant_text === 'string' ? body.assistant_text : '';
}

/**
 * Extract user-facing strings carried by `insights[]`. The runtime's own
 * output-safety pass sanitises `insight.text` as a leak surface, so the
 * assurance suite must scan it too — otherwise a Tier-2/3 claim or internal
 * term routed through an insight (rather than assistant_text) would score
 * clean. We defensively pull text/message/title off each insight object.
 */
export function extractInsightTexts(body: TurnResponse | undefined): string[] {
  const out: string[] = [];
  for (const i of body?.insights ?? []) {
    if (typeof i === 'string') {
      out.push(i);
    } else if (i && typeof i === 'object') {
      for (const key of ['text', 'message', 'title', 'detail', 'body'] as const) {
        const v = (i as Record<string, unknown>)[key];
        if (typeof v === 'string' && v.length > 0) out.push(v);
      }
    }
  }
  return out;
}

export function freshnessOf(body: TurnResponse | undefined): string | undefined {
  const f = body?.analysis_ready?.freshness;
  return typeof f === 'string' ? f : undefined;
}

/** True when the response carries a genuine computed analysis (not a recovery). */
export function hasComputedAnalysis(body: TurnResponse | undefined): boolean {
  const ar = body?.analysis_ready;
  if (!ar) return false;
  const status = typeof ar.status === 'string' ? ar.status : '';
  if (status === 'analysis_not_ready') return false;
  // A computed analysis exposes options/goal/computed_at.
  const hasOptions = Array.isArray(ar.options) && ar.options.length > 0;
  const hasComputedAt = ar.computed_at !== undefined && ar.computed_at !== null;
  return hasOptions || hasComputedAt || status === 'computed' || status === 'partial';
}

/**
 * Collect leak (internal-term) + blocked-claim (Tier-2/3) matches across
 * EVERY user-facing surface of a turn: assistant_text, chip labels/messages,
 * and insight texts. Chip `action_type` is scanned for blocked-claim
 * vocabulary ONLY (not internal-terms) — the legitimate action_type values
 * (`run_analysis`, `set_factor_value`, …) ARE internal identifiers, so
 * forbidden-term scanning them would false-positive; but a Tier-2/3 field
 * surfaced as an action_type (e.g. `show_confidence_tier`) must still fail.
 */
export function scanLeaks(body: TurnResponse | undefined): {
  forbidden: readonly string[];
  blocked: readonly string[];
} {
  const text = assistantText(body);
  const chips = extractChips(body);
  const chipProse = chipStrings(chips);
  const insightTexts = extractInsightTexts(body);
  const actionTypes = chips.map((c) => c.action_type).filter((a): a is string => !!a);

  // Internal-term scan: prose surfaces only (NOT action_type).
  const forbidden: string[] = [];
  for (const s of [text, ...chipProse, ...insightTexts]) {
    forbidden.push(...findForbiddenMatches(s));
  }
  // Blocked-claim (Tier-2/3) scan: all prose surfaces + action_type.
  const blocked = scanUserFacingSurfaces(text, [...chipProse, ...insightTexts, ...actionTypes]);
  return { forbidden: [...new Set(forbidden)], blocked };
}

// Staleness acknowledgement / rerun-offer language (safe degrade signal).
const STALENESS_ACK = /\b(out[- ]?of[- ]?date|re-?run|rerun|refresh|recompute|re-?analy|update the analysis|may (?:be|have) (?:changed|out of date)|no longer (?:reflect|match)|since you (?:changed|edited)|after your (?:change|edit))\b/i;
// Confident current-result directional recommendation (unsafe under stale).
// Broad on purpose — a confident rec phrased without a listed verb (e.g.
// "clearly the strongest choice", "X wins on every dimension") must still trip
// the stale-safety detector. Bias toward catching: a false red on a borderline
// recommendation is far cheaper than blessing confident advice under stale.
const CONFIDENT_REC = /\b(go with|i['’]?d recommend|i recommend|you should (?:choose|pick|go with|select)|the (?:best|strongest|right) (?:option|choice|bet) is|best choice is|currently leads|comes out ahead|leads by|ahead by|winner is|the answer is|clearly the (?:best|strongest|right)|(?:is|remains) (?:clearly )?the (?:best|strongest|right)|strongest (?:option|choice|bet)|wins on|\bwins\b|outperforms)\b/i;

export function hasStalenessAck(text: string, chips: readonly Chip[]): boolean {
  if (STALENESS_ACK.test(text)) return true;
  for (const c of chips) {
    // A rerun/refresh chip counts as the offer ONLY when its label/message
    // carries staleness/rerun language. A bare `action_type === 'run_analysis'`
    // chip does NOT — otherwise an incidental run_analysis chip could launder a
    // confident-advice-under-stale answer to green.
    if (STALENESS_ACK.test(c.label) || STALENESS_ACK.test(c.message)) return true;
  }
  return false;
}

export function hasConfidentRec(text: string): boolean {
  return CONFIDENT_REC.test(text);
}

// ---------------------------------------------------------------------------
// Classifiers — each returns a CheckResult.
// ---------------------------------------------------------------------------

function leakDetail(forbidden: readonly string[], blocked: readonly string[]): string | null {
  const parts: string[] = [];
  if (forbidden.length) parts.push(`internal-term leak: ${forbidden.join(', ')}`);
  if (blocked.length) parts.push(`Tier-2/3 claim leak: ${blocked.join(', ')}`);
  return parts.length ? parts.join('; ') : null;
}

export interface GraphlessInput {
  readonly httpStatus: number;
  readonly body: TurnResponse | undefined;
  readonly factTotal: number | null; // null = DB read unavailable
}

export function classifyGraphless(input: GraphlessInput): CheckResult {
  const { httpStatus, body, factTotal } = input;
  const chips = extractChips(body);
  const text = assistantText(body);
  const hasChip = chips.some((c) => c.id === ANALYSIS_NOT_READY_CHIP_ID);
  const recoveryCopy = /analys/i.test(text) && /\b(draft|save|fix|model|build)\b/i.test(text);
  const { forbidden, blocked } = scanLeaks(body);
  const leak = leakDetail(forbidden, blocked);
  const evidence = [`http=${httpStatus}`, `facts=${factTotal ?? 'unread'}`, `chip=${hasChip}`];
  const requestId = body?.request_id;

  if (httpStatus !== 200) {
    return mk('graphless', 'Graphless run_analysis → typed analysis_not_ready 200', 'red',
      `expected HTTP 200, got ${httpStatus} (null-graph path must be recoverable, not a 500)`, evidence, requestId);
  }
  if (hasComputedAnalysis(body)) {
    return mk('graphless', 'Graphless run_analysis → typed analysis_not_ready 200', 'red',
      'graphless scenario returned a COMPUTED analysis — must be analysis_not_ready', evidence, requestId);
  }
  if (leak) {
    return mk('graphless', 'Graphless run_analysis → typed analysis_not_ready 200', 'red', leak, evidence, requestId);
  }
  if (!hasChip) {
    return mk('graphless', 'Graphless run_analysis → typed analysis_not_ready 200', 'red',
      `recovery chip "${ANALYSIS_NOT_READY_CHIP_ID}" absent`, evidence, requestId);
  }
  if (factTotal === null) {
    return mk('graphless', 'Graphless run_analysis → typed analysis_not_ready 200', 'amber',
      'typed recovery + chip present, but handler-fact count could not be read (DB unavailable)', evidence, requestId);
  }
  if (factTotal !== 0) {
    return mk('graphless', 'Graphless run_analysis → analysis_not_ready 200 + zero facts', 'red',
      `expected 0 handler facts, found ${factTotal}`, evidence, requestId);
  }
  return mk('graphless', 'Graphless run_analysis → analysis_not_ready 200 + zero facts', 'green',
    `200 analysis_not_ready, chip present, 0 handler facts${recoveryCopy ? ', recovery copy present' : ''}`, evidence, requestId);
}

export interface DraftPersistedInput {
  readonly httpStatus: number;
  readonly body: TurnResponse | undefined;
  readonly graphNodeCount: number | null; // null = DB unavailable
}

export function classifyDraftPersisted(input: DraftPersistedInput): CheckResult {
  const { httpStatus, body, graphNodeCount } = input;
  const { forbidden, blocked } = scanLeaks(body);
  const leak = leakDetail(forbidden, blocked);
  const ev = [`http=${httpStatus}`, `nodes=${graphNodeCount ?? 'unread'}`];
  const rid = body?.request_id;
  if (httpStatus !== 200) {
    return mk('draft_persisted', 'Draft-first → persisted graph', 'red', `draft returned HTTP ${httpStatus}`, ev, rid);
  }
  if (leak) return mk('draft_persisted', 'Draft-first → persisted graph', 'red', leak, ev, rid);
  if (graphNodeCount === null) {
    return mk('draft_persisted', 'Draft-first → persisted graph', 'amber', 'draft 200 but scenarios.graph could not be read', ev, rid);
  }
  if (graphNodeCount <= 0) {
    return mk('draft_persisted', 'Draft-first → persisted graph', 'red', 'no graph persisted after draft', ev, rid);
  }
  return mk('draft_persisted', 'Draft-first → persisted graph', 'green', `persisted graph with ${graphNodeCount} nodes`, ev, rid);
}

export interface RealAnalysisInput {
  readonly httpStatus: number;
  readonly body: TurnResponse | undefined;
  readonly runAnalysisFactCount: number | null;
  readonly graphHashAtRun: string | null;
}

export function classifyRealAnalysis(input: RealAnalysisInput): CheckResult {
  const { httpStatus, body, runAnalysisFactCount, graphHashAtRun } = input;
  const { forbidden, blocked } = scanLeaks(body);
  const leak = leakDetail(forbidden, blocked);
  const freshness = freshnessOf(body);
  const rid = body?.request_id;
  const ev = [
    `http=${httpStatus}`,
    `freshness=${freshness ?? 'n/a'}`,
    `run_analysis_facts=${runAnalysisFactCount ?? 'unread'}`,
    `graph_hash_at_run=${graphHashAtRun ?? 'none'}`,
  ];
  if (httpStatus !== 200) {
    return mk('real_analysis', 'Draft-first run_analysis → real PLoT result + fact', 'red', `HTTP ${httpStatus}`, ev, rid);
  }
  if (!hasComputedAnalysis(body)) {
    return mk('real_analysis', 'Draft-first run_analysis → real PLoT result + fact', 'red',
      'response is not a computed analysis (got recovery/empty)', ev, rid);
  }
  if (leak) return mk('real_analysis', 'Draft-first run_analysis → real PLoT result + fact', 'red', leak, ev, rid);
  if (runAnalysisFactCount === null || graphHashAtRun === null) {
    return mk('real_analysis', 'Draft-first run_analysis → real PLoT result + fact', 'amber',
      'computed analysis on the wire, but run_analysis fact / graph_hash_at_run could not be read from DB', ev, rid);
  }
  if (runAnalysisFactCount < 1) {
    return mk('real_analysis', 'Draft-first run_analysis → real PLoT result + fact', 'red',
      'no run_analysis handler fact persisted', ev, rid);
  }
  return mk('real_analysis', 'Draft-first run_analysis → real PLoT result + fact', 'green',
    `computed analysis, ${runAnalysisFactCount} run_analysis fact(s), graph_hash_at_run captured`, ev, rid);
}

export interface MutationInput {
  readonly httpStatus: number;
  readonly body: TurnResponse | undefined;
  readonly valueBefore: number | null;
  readonly valueAfter: number | null;
  readonly factorLabel: string;
  readonly nodeId: string;
}

export function classifyMutation(input: MutationInput): CheckResult {
  const { httpStatus, body, valueBefore, valueAfter, factorLabel, nodeId } = input;
  const { forbidden, blocked } = scanLeaks(body);
  const leak = leakDetail(forbidden, blocked);
  const rid = body?.request_id;
  const ev = [
    `http=${httpStatus}`,
    `node_id=${nodeId}`,
    `factor=${factorLabel}`,
    `value_before=${valueBefore ?? 'n/a'}`,
    `value_after=${valueAfter ?? 'n/a'}`,
  ];
  if (httpStatus !== 200) {
    return mk('mutation', 'Deterministic mutation → graph value changes', 'red', `HTTP ${httpStatus}`, ev, rid);
  }
  if (leak) return mk('mutation', 'Deterministic mutation → graph value changes', 'red', leak, ev, rid);
  if (valueBefore === null || valueAfter === null) {
    return mk('mutation', 'Deterministic mutation → graph value changes', 'red',
      'could not read factor value before/after (cannot prove mutation)', ev, rid);
  }
  if (valueAfter === valueBefore) {
    return mk('mutation', 'Deterministic mutation → graph value changes', 'red',
      'factor value did NOT change — deterministic value-update did not apply', ev, rid);
  }
  return mk('mutation', 'Deterministic mutation → graph value changes', 'green',
    `factor "${factorLabel}" value ${valueBefore} → ${valueAfter}`, ev, rid);
}

export interface StaleInput {
  readonly httpStatus: number;
  readonly body: TurnResponse | undefined;
  /**
   * True when the orchestrator KNOWS the scenario is stale (the mutation
   * check passed), independent of whether this turn surfaced
   * analysis_ready.freshness. Lets us apply full rigor even when the
   * freshness field isn't on the wire for this particular turn.
   */
  readonly knownStale?: boolean;
}

export function classifyStaleDegrade(input: StaleInput): CheckResult {
  const { httpStatus, body, knownStale } = input;
  const text = assistantText(body);
  const chips = extractChips(body);
  const { forbidden, blocked } = scanLeaks(body);
  const leak = leakDetail(forbidden, blocked);
  const freshness = freshnessOf(body);
  const ack = hasStalenessAck(text, chips);
  const confident = hasConfidentRec(text);
  const rid = body?.request_id;
  const isStale = freshness === 'stale' || knownStale === true;
  const ev = [
    `http=${httpStatus}`,
    `freshness=${freshness ?? 'n/a'}`,
    `known_stale=${knownStale === true}`,
    `staleness_ack=${ack}`,
    `confident_rec=${confident}`,
  ];

  if (httpStatus !== 200) {
    return mk('stale_degrade', 'Stale coaching → safe degrade (no confident advice)', 'red', `HTTP ${httpStatus}`, ev, rid);
  }
  if (leak) return mk('stale_degrade', 'Stale coaching → safe degrade (no confident advice)', 'red', leak, ev, rid);
  // Precondition: only judge stale-safety when the state is genuinely stale.
  // If we couldn't establish stale (mutation didn't apply), this check is
  // inconclusive — the mutation check already reds the real cause. Avoids a
  // false coaching-safety red on genuinely-fresh state.
  if (!isStale) {
    return mk('stale_degrade', 'Stale coaching → safe degrade (precondition: stale state)', 'amber',
      'stale state not established (freshness not stale, mutation unproven) — see the mutation check', ev, rid);
  }
  // Genuinely stale. Hard red: confident current-result advice with no caveat.
  if (confident && !ack) {
    return mk('stale_degrade', 'Stale coaching → safe degrade (no confident advice)', 'red',
      'confident current-result advice reached the user under genuine stale state', ev, rid);
  }
  if (ack) {
    return mk('stale_degrade', 'Stale coaching → safe degrade (post-check / caveat)', 'green',
      'answer caveats staleness or offers a rerun (degraded safely)', ev, rid);
  }
  // Safe but soft: no confident rec and no explicit rerun guidance.
  return mk('stale_degrade', 'Stale coaching → safe degrade (no confident advice)', 'amber',
    'answer did not give confident advice but also did not explicitly offer a rerun', ev, rid);
}

export interface RerunInput {
  readonly httpStatus: number;
  readonly body: TurnResponse | undefined;
  readonly runAnalysisFactCount: number | null;
}

export function classifyRerunFresh(input: RerunInput): CheckResult {
  const { httpStatus, body, runAnalysisFactCount } = input;
  const { forbidden, blocked } = scanLeaks(body);
  const leak = leakDetail(forbidden, blocked);
  const freshness = freshnessOf(body);
  const rid = body?.request_id;
  const ev = [`http=${httpStatus}`, `freshness=${freshness ?? 'n/a'}`, `run_analysis_facts=${runAnalysisFactCount ?? 'unread'}`];
  if (httpStatus !== 200) {
    return mk('rerun_fresh', 'Rerun clears stale → fresh', 'red', `HTTP ${httpStatus}`, ev, rid);
  }
  if (leak) return mk('rerun_fresh', 'Rerun clears stale → fresh', 'red', leak, ev, rid);
  if (!hasComputedAnalysis(body)) {
    return mk('rerun_fresh', 'Rerun clears stale → fresh', 'red', 'rerun did not produce a computed analysis', ev, rid);
  }
  if (freshness === 'stale') {
    return mk('rerun_fresh', 'Rerun clears stale → fresh', 'red', 'freshness still stale after rerun', ev, rid);
  }
  if (freshness === 'fresh') {
    return mk('rerun_fresh', 'Rerun clears stale → fresh', 'green', 'rerun produced a fresh computed analysis', ev, rid);
  }
  // freshness not surfaced on this turn — fall back to fact evidence.
  return mk('rerun_fresh', 'Rerun clears stale → fresh', 'amber',
    `rerun produced a computed analysis but freshness field not on wire (freshness=${freshness ?? 'n/a'})`, ev, rid);
}

export interface FieldSafetyInput {
  /** Every blocked-claim match collected across ALL turns. */
  readonly allBlocked: readonly string[];
  readonly turnsScanned: number;
}

export function classifyFieldSafety(input: FieldSafetyInput): CheckResult {
  const { allBlocked, turnsScanned } = input;
  if (allBlocked.length > 0) {
    return mk('field_safety', 'Tier-2/Tier-3 fields absent from user-facing text', 'red',
      `blocked field/claim surfaced: ${[...new Set(allBlocked)].join(', ')}`, [`turns_scanned=${turnsScanned}`]);
  }
  return mk('field_safety', 'Tier-2/Tier-3 fields absent from user-facing text', 'green',
    `no Tier-2/Tier-3 field or scientific-claim vocabulary in any user-facing surface`, [`turns_scanned=${turnsScanned}`]);
}

function mk(
  id: string,
  title: string,
  status: RagStatus,
  detail: string,
  evidence?: readonly string[],
  request_id?: string,
): CheckResult {
  return {
    id,
    title,
    status,
    detail,
    ...(evidence && evidence.length ? { evidence } : {}),
    ...(request_id ? { request_id } : {}),
  };
}
