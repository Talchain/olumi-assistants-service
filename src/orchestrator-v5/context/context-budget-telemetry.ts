/**
 * Context Architecture v2 — S0 "measure first" (ROADMAP 1.73).
 *
 * Central emitters + budget tables for the two S0 telemetry events
 * (design pack `03-budgets-and-telemetry` §1–§2):
 *
 *   - `v5.context_budget` — once per LLM call: per-section char accounting,
 *     the per-call-site budget verdict, disclosed truncations, and the API
 *     response's `usage` block (ground-truth tokens). `chars_per_token` is
 *     measured continuously per call site (total_chars / input_tokens) so
 *     char-budget ↔ token drift self-reports on the dashboard.
 *
 *   - `v5.context_truncation` — emitted at the cut site the moment ANY
 *     content is dropped. `disclosed:false` marks a cut the LLM cannot see;
 *     with in-band disclosure now unconditional, the turn-path cut sites
 *     emit `disclosed:true` and a persistent `disclosed:false` is a bug the
 *     harness ratchet can enforce.
 *
 * S0 discipline: telemetry-additive ONLY. This module never throws, never
 * mutates its inputs, and changes zero prompt bytes. Budgets here are the
 * design pack's MEASUREMENT targets (03 §1) — nothing in S0 enforces them.
 */

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import {
  deriveContextSectionBudgets,
  emitContextPolicyDivergence,
  type BudgetTelemetryCallSite,
} from './context-policy.js';

// ---------------------------------------------------------------------------
// Budget tables — a DERIVED VIEW of CONTEXT_POLICY (ROADMAP 1.199, Q1 rule 2)
// ---------------------------------------------------------------------------

// The call-site enum is the same set the policy's derived view keys on.
export type ContextBudgetCallSite = BudgetTelemetryCallSite;

interface SiteBudget {
  /** Per-section char budgets. Sections absent here are unbudgeted. */
  readonly sections: Readonly<Record<string, number>>;
  /** Whole-context char budget; null = instrumented but not budgeted. */
  readonly total: number | null;
}

/**
 * The per-site char-budget table. Formerly a hand-authored parallel table that
 * DRIFTED from the enforced caps (decision_review `brief:8_000` vs enforced
 * 2_000; edit `conversation:6_000` vs enforced 4_000). It is now a DERIVED VIEW
 * of {@link CONTEXT_POLICY} (ROADMAP 1.199, Q1 rule 2 / Q5): every budget is
 * projected out of the policy's per-section `char_budget`, so the two mirrors
 * can no longer diverge. `conversation_summary` / `older_relevant_facts` /
 * `decision_records` remain pre-declared reservations (policy `unpopulated`),
 * measuring 0 until the layer that fills them ships — the dashboard still shows
 * the layer arriving. draft_graph stays instrumented-only (POST wave-1, P4).
 */
export const CONTEXT_SECTION_BUDGETS: Readonly<Record<ContextBudgetCallSite, SiteBudget>> =
  deriveContextSectionBudgets();

/**
 * Which sections (by name, plus the sentinel `'total'`) exceed the 03 §1
 * budgets for the call site. Unbudgeted sections never flag. Pure.
 */
export function computeOverBudget(
  callSite: ContextBudgetCallSite,
  sectionChars: Readonly<Record<string, number>>,
  totalChars: number,
): string[] {
  const budget = CONTEXT_SECTION_BUDGETS[callSite];
  const over: string[] = [];
  for (const [section, chars] of Object.entries(sectionChars)) {
    const cap = budget.sections[section];
    if (typeof cap === 'number' && typeof chars === 'number' && chars > cap) {
      over.push(section);
    }
  }
  if (budget.total !== null && typeof totalChars === 'number' && totalChars > budget.total) {
    over.push('total');
  }
  return over;
}

// ---------------------------------------------------------------------------
// chars_per_token plausibility — the detector that was already there
// ---------------------------------------------------------------------------

/**
 * `chars_per_token` has been a working detector sitting UNREAD on this event
 * for months. Measured on real staging logs (2026-09-17):
 *
 *   draft_graph      0.03   ← total_chars measures ONE component of the user
 *                             message; the model received ~140x that
 *   decision_review  0.74   ← honest
 *   draft_coaching   1.02   ← honest
 *
 * Nothing consumed the number, so a call site measuring a fraction of what it
 * sends looked exactly like a call site measuring all of it. These bounds turn
 * that into a LOUD, per-call verdict on the event itself.
 *
 * The band is deliberately WIDE. English-ish prose runs ~4 chars/token; JSON
 * and id-dense payloads run lower; heavy prompt CACHING lowers the ratio
 * further because `input_tokens` excludes cache reads on some adapters, and
 * a long system prompt the site does not measure lowers it too. 0.5 is far
 * below any honest assembly; 6.0 is far above any real tokeniser. Anything
 * outside is an ACCOUNTING fault, not a content property — which is exactly
 * the class this file failed to surface.
 */
export const CHARS_PER_TOKEN_PLAUSIBLE_MIN = 0.5;
/** Upper plausibility bound — see {@link CHARS_PER_TOKEN_PLAUSIBLE_MIN}. */
export const CHARS_PER_TOKEN_PLAUSIBLE_MAX = 6;

/**
 * `unmeasurable` is NOT a pass: it means no ground-truth token count arrived,
 * so the accounting could not be checked at all. It must never be collapsed
 * with `plausible` (the "nobody set one" vs "unbounded by design" distinction
 * this event gets wrong elsewhere, applied here before it can be got wrong).
 */
export type CharsPerTokenVerdict =
  | 'plausible'
  | 'implausibly_low'
  | 'implausibly_high'
  | 'unmeasurable';

/** Pure. Bounds are INCLUSIVE — a value exactly at an edge is not a defect. */
export function classifyCharsPerToken(charsPerToken: number | null): CharsPerTokenVerdict {
  if (charsPerToken === null || !Number.isFinite(charsPerToken)) return 'unmeasurable';
  if (charsPerToken < CHARS_PER_TOKEN_PLAUSIBLE_MIN) return 'implausibly_low';
  if (charsPerToken > CHARS_PER_TOKEN_PLAUSIBLE_MAX) return 'implausibly_high';
  return 'plausible';
}

// ---------------------------------------------------------------------------
// Content manifests — what a char count cannot tell you
// ---------------------------------------------------------------------------

/**
 * Structural counts for a JSON section, for `ContextBudgetArgs.section_shape`.
 *
 * ⚠⚠ THE HARM THIS CLOSES, measured on a real user session 16 Sep 2026 and
 * written up at `coaching/decision-review-enricher.ts:121-134`:
 * `v5.context_budget` reported `section_chars: { graph_json: 21, ... }` for
 * `decision_review`. Establishing that 21 characters is
 * `<GRAPH>\n\n{}\n\n</GRAPH>` — i.e. THE REVIEWING MODEL WAS SENT NO GRAPH
 * AT ALL — took a human doing arithmetic on three hypothetical renderings
 * (`{}` is 21, `{nodes:[],edges:[]}` is 51, a one-node graph 103). A count of
 * `{ nodes: 0, edges: 0 }` says it outright, on the same line, with no
 * arithmetic and no hypothesis.
 *
 * Bound to the SENT BYTES, never to an upstream object: callers pass the exact
 * substring that went on the wire, so this cannot certify a graph the assembler
 * dropped on the way (the "a fixture you wrote yourself is not evidence about
 * the wire" rule, applied to telemetry).
 *
 * Pure and total — never throws. Unparseable or absent input yields `{}`
 * rather than a fabricated zero, because "we could not read it" and "it was
 * empty" are different findings and this event's whole problem has been
 * collapsing distinctions like that one.
 */
export function jsonStructureManifest(
  jsonText: string | null | undefined,
): Readonly<Record<string, number>> {
  if (typeof jsonText !== 'string' || jsonText.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object') return {};
  if (Array.isArray(parsed)) return { items: parsed.length };
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) out[key] = value.length;
  }
  // An object with no array members is still a REAL reading — record its own
  // key count so `{}` (0) stays distinguishable from a populated object.
  out.keys = Object.keys(parsed as Record<string, unknown>).length;
  return out;
}

// ---------------------------------------------------------------------------
// What `total_chars` actually covers, per call site
// ---------------------------------------------------------------------------

/**
 * A number that measures a FRACTION and is named `total_chars` is worse than
 * no number. The repo-wide convention is `total_chars` = the whole assembled
 * USER-side context (`decision_review` counts the assembled user message;
 * `draft_coaching` counts brief + the exact serialised graph string it sends;
 * `edit_graph` counts the whole serialised context section). `draft_graph` is
 * the OUTLIER: it reports `effectiveBrief.length` alone, while the real
 * request also carries the served system prompt, the records instruction, the
 * records JSON grammar, the untrusted-content envelope, the compliance
 * reminder, brief signals, the currency instruction and any attached document.
 * That is the 128-vs-~18,000 gap.
 *
 * ⚠ NO CALL SITE COUNTS THE SYSTEM HALF — not even the honest ones. This
 * declaration states that plainly rather than leaving every reader to assume
 * `total` means total.
 *
 * DERIVE-DON'T-MIRROR, as far as the type system can take it: the record is
 * keyed on {@link ContextBudgetCallSite}, so a NEW call site does not compile
 * until it declares what its number measures. It cannot go silently missing;
 * it can still go stale, which is why the loud half is
 * {@link classifyCharsPerToken}, measured against ground-truth tokens on every
 * single call rather than asserted here.
 */
export type TotalCharsScope =
  /** Every model-facing byte of the assembled USER message (system half excluded). */
  | 'assembled_user_message'
  /** Only the sections named in `section_chars`; other user-message parts are NOT counted. */
  | 'declared_sections_only';

export const TOTAL_CHARS_SCOPE: Readonly<Record<ContextBudgetCallSite, TotalCharsScope>> = {
  routing: 'assembled_user_message',
  edit_graph: 'assembled_user_message',
  repair_edit_graph: 'assembled_user_message',
  decision_review: 'assembled_user_message',
  // The measured defect. `draft-graph-dispatch.ts` has no assembled-prompt
  // bytes in scope — `DraftGraphResult.toolLLMTelemetry` carries identities and
  // token counts only, so an honest total needs char counts plumbed back from
  // `adapters/llm/anthropic.ts buildDraftPrompt`. Declared honestly here and
  // flagged loudly by chars_per_token until that plumb lands.
  draft_graph: 'declared_sections_only',
  draft_coaching: 'assembled_user_message',
};

/**
 * Why `budget_chars` is null, stated rather than implied. "Unbounded by
 * design" and "nobody set one" must not look identical on the wire — they did,
 * and `draft_graph` (genuinely unbounded: the brief is passed UNCAPPED, so
 * declaring a cap would be a false guarantee) was indistinguishable from an
 * un-migrated site that had simply never been given one.
 */
export type BudgetBasis = 'budgeted' | 'unbounded_by_design';

// ---------------------------------------------------------------------------
// v5.context_budget
// ---------------------------------------------------------------------------

/** Disclosed-truncation record carried inside `v5.context_budget`. */
export interface ContextTruncationRecord {
  readonly section: string;
  readonly original_chars: number;
  readonly kept_chars: number;
  readonly disclosed: boolean;
  /**
   * Item counts, for sections cut by ITEM rather than by chars (the
   * decision-records read drops whole records at the SQL LIMIT, whose chars
   * never enter the process and must not be invented). Absent on char-only
   * cuts. Additive: char-cut producers are unchanged.
   */
  readonly original_records?: number;
  readonly kept_records?: number;
}

/**
 * Token usage from the API response — ground truth (03 §3). Shapes vary by
 * adapter (`UsageMetrics`, `ChatWithToolsResult['usage']`, pipeline
 * `token_usage`) so every field is optional here and normalised to
 * number-or-null on the event.
 */
export interface ContextBudgetUsage {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
}

export interface ContextBudgetArgs {
  readonly call_site: ContextBudgetCallSite;
  /** Join keys mirroring ContextPackAssembled (null when unknown). */
  readonly model: string | null;
  readonly prompt_version: string | null;
  readonly prompt_hash: string | null;
  readonly request_id: string | null;
  readonly scenario_id: string | null;
  /** Char count per context section actually sent on this call. */
  readonly section_chars: Readonly<Record<string, number>>;
  /**
   * CONTENT MANIFEST per section — structural counts for sections that are
   * structured objects, e.g. `{ graph: { nodes: 0, edges: 0 } }`.
   *
   * A char count cannot distinguish `<GRAPH>{}</GRAPH>` from a real graph of
   * the same size, and `draft_graph` is where the product's worst defects are
   * born (an option minted with no interventions; a limit bound to an
   * unmeasurable node). A FIELD count would have screamed on day one that the
   * model was handed an empty structure.
   *
   * Optional and ADDITIVE: every existing consumer of `section_chars`,
   * `over_budget` and the divergence tripwire is untouched, and a site with no
   * structured section emits `{}`. Values must be flat records of finite
   * numbers — the logger's measurement-container exemption passes those
   * through and DIGESTS anything else, so a section named `brief` cannot
   * smuggle text out under this key.
   */
  readonly section_shape?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly total_chars: number;
  /** Truncations that shaped this context (may be empty). */
  readonly truncations: readonly ContextTruncationRecord[];
  /** Summary staleness in turns — null until S4 ships the summary layer. */
  readonly summary_lag_turns: number | null;
  /**
   * True when the UI declared pre-narrowed analysis context via the
   * `analysis_state.narrowing` marker (02 Seam 4 [R8]); false when the
   * marker says un-narrowed; null when no marker (pre-S8u UIs).
   */
  readonly ui_narrowed: boolean | null;
  readonly usage: ContextBudgetUsage | undefined;
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Emit `v5.context_budget`. Never throws — a telemetry fault must never
 * fail a turn (same posture as every other emit site in this repo).
 */
export function emitContextBudget(args: ContextBudgetArgs): void {
  try {
    const inputTokens = numOrNull(args.usage?.input_tokens);
    const totalChars = numOrNull(args.total_chars);
    const charsPerToken =
      inputTokens !== null && inputTokens > 0 && totalChars !== null
        ? Math.round((totalChars / inputTokens) * 100) / 100
        : null;

    const budget = CONTEXT_SECTION_BUDGETS[args.call_site].total;
    const charsPerTokenVerdict = classifyCharsPerToken(charsPerToken);

    emit(TelemetryEvents.V5ContextBudget, {
      call_site: args.call_site,
      model: args.model,
      prompt_version: args.prompt_version,
      prompt_hash: args.prompt_hash,
      request_id: args.request_id,
      scenario_id: args.scenario_id,
      section_chars: args.section_chars,
      section_shape: args.section_shape ?? {},
      total_chars: args.total_chars,
      total_chars_scope: TOTAL_CHARS_SCOPE[args.call_site],
      budget_chars: budget,
      budget_basis: (budget === null ? 'unbounded_by_design' : 'budgeted') satisfies BudgetBasis,
      over_budget: computeOverBudget(args.call_site, args.section_chars, args.total_chars),
      truncations: args.truncations,
      summary_lag_turns: args.summary_lag_turns,
      ui_narrowed: args.ui_narrowed,
      usage: {
        input_tokens: inputTokens,
        output_tokens: numOrNull(args.usage?.output_tokens),
        cache_read_input_tokens: numOrNull(args.usage?.cache_read_input_tokens),
        cache_creation_input_tokens: numOrNull(args.usage?.cache_creation_input_tokens),
      },
      chars_per_token: charsPerToken,
      chars_per_token_verdict: charsPerTokenVerdict,
    });

    // FAIL LOUD. The 0.03 on draft_graph sat on this stream for months because
    // nothing read it. A warn line names the site, the ratio and both sides of
    // the arithmetic, so the next instance is a search away rather than a
    // month away. Observe-only — never throws, never changes a prompt byte.
    if (charsPerTokenVerdict === 'implausibly_low' || charsPerTokenVerdict === 'implausibly_high') {
      log.warn(
        {
          event: 'v5.context_budget.accounting_implausible',
          call_site: args.call_site,
          chars_per_token: charsPerToken,
          chars_per_token_verdict: charsPerTokenVerdict,
          plausible_min: CHARS_PER_TOKEN_PLAUSIBLE_MIN,
          plausible_max: CHARS_PER_TOKEN_PLAUSIBLE_MAX,
          total_chars: args.total_chars,
          total_chars_scope: TOTAL_CHARS_SCOPE[args.call_site],
          input_tokens: inputTokens,
          request_id: args.request_id,
        },
        'v5.context_budget accounting is implausible — total_chars does not explain the tokens the model was billed for (measure the assembled message, or narrow total_chars_scope)',
      );
    }
  } catch (err) {
    log.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'v5.context_budget emit failed (swallowed — telemetry must never fail a turn)',
    );
  }
  // ROADMAP 1.199 — the ContextPolicy divergence tripwire rides the SAME
  // once-per-LLM-call seam, so it covers every migrated call site from one
  // insertion point (derive-don't-mirror). Observe-only, never throws; it fires
  // v5.context_policy.divergence only when the realised composition departs from
  // CONTEXT_POLICY (an undeclared section or an enforced section over budget).
  emitContextPolicyDivergence(
    args.call_site,
    args.section_chars,
    args.total_chars,
    args.request_id,
    args.scenario_id,
  );
}

// ---------------------------------------------------------------------------
// v5.context_truncation
// ---------------------------------------------------------------------------

export interface ContextTruncationArgs {
  /** Stable cut-site identifier, e.g. 'serialise.truncateGraphJson'. */
  readonly site: string;
  /** Context section the cut applies to, e.g. 'graph_json'. */
  readonly section: string;
  readonly original_chars: number;
  readonly kept_chars: number;
  /** Item counts for item-wise cuts — see {@link ContextTruncationRecord}. */
  readonly original_records?: number;
  readonly kept_records?: number;
  /** Bounded enum-ish string, e.g. 'hard_slice' | 'window_slice'. */
  readonly strategy: string;
  /** Whether the LLM can SEE that the cut happened (in-band disclosure). */
  readonly disclosed: boolean;
  /**
   * Whole-pack accounting for a cut driven by a call site's TOTAL budget
   * rather than by a per-section cap (Context/Memory V5 defect 3,
   * `enforceContextPackCeiling`). ABSENT on section-driven cuts, so every
   * pre-existing producer is unchanged. Present together or not at all: they
   * are one measurement (pack chars before → after, against the ceiling that
   * fired), and reading `after` without `budget` would invite the reader to
   * supply a number of their own.
   */
  readonly pack_total_chars_before?: number;
  readonly pack_total_chars_after?: number;
  readonly pack_total_budget?: number;
  /**
   * Present-and-true when the cut stopped at its RETENTION FLOOR while the
   * pack was still over the ceiling — the honest "this did not fit" signal.
   * Absent when the cut reached the target (never a noisy `false`), matching
   * the key-absence disclosure doctrine used across this pack.
   */
  readonly floor_reached?: true;
  readonly request_id?: string | null;
  readonly scenario_id?: string | null;
}

/** Emit `v5.context_truncation`. Never throws. */
export function emitContextTruncation(args: ContextTruncationArgs): void {
  try {
    emit(TelemetryEvents.V5ContextTruncation, {
      site: args.site,
      section: args.section,
      original_chars: args.original_chars,
      kept_chars: args.kept_chars,
      ...(args.original_records === undefined ? {} : { original_records: args.original_records }),
      ...(args.kept_records === undefined ? {} : { kept_records: args.kept_records }),
      ...(args.pack_total_chars_before === undefined
        ? {}
        : { pack_total_chars_before: args.pack_total_chars_before }),
      ...(args.pack_total_chars_after === undefined
        ? {}
        : { pack_total_chars_after: args.pack_total_chars_after }),
      ...(args.pack_total_budget === undefined ? {} : { pack_total_budget: args.pack_total_budget }),
      ...(args.floor_reached === undefined ? {} : { floor_reached: args.floor_reached }),
      strategy: args.strategy,
      disclosed: args.disclosed,
      request_id: args.request_id ?? null,
      scenario_id: args.scenario_id ?? null,
    });
  } catch (err) {
    log.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'v5.context_truncation emit failed (swallowed — telemetry must never fail a turn)',
    );
  }
}
