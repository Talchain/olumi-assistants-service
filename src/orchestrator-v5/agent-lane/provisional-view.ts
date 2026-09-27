/**
 * ⭐ C5 — THE AGENT'S PROVISIONAL VIEW (Paul's ruling, DL #70 5855324470, 11:12Z; Paul in session: "Yes, labelled
 * provisional").
 *
 * When Olumi cannot yet put an option forward — the leader is withheld: a limit unchecked, a gap open — the Agent MAY
 * give its own reading, "clearly labelled as its provisional view, with its reasoning, and never presented as the
 * analysis result", plus ONE step that would let the analysis confirm it.
 *
 * ⛔ THE LEADER GATE IS UNCHANGED. `enforceAgentLaneLeaderClaimsAtWire` drops every sentence that ranks or favours an
 * option on a withheld turn, and it stays the truth boundary for anything presented as the analysis's result. So the
 * view never travels as the model's prose (it would be stripped, and must be): it is a TYPED tool call
 * (`give_provisional_view`), and the ROUTE renders it as ONE server-owned paragraph appended AFTER the gate, opening on
 * its label and the typed reason the analysis cannot confirm it. It is never put in `blocks`, the analysis card or any
 * leader field; `_agent.provisional_view` carries the same four strings for a surface that renders it apart.
 *
 * ⛔ ONE AUTHORITY FOR "WITHHELD". `leaderStandingOf` reads the route's own readback through the wire gate's OWN
 * predicate (`agentLaneLeaderWithheld`, the inputs the route passes it) and the gate's OWN reason words
 * (`agentNoLeaderReason`, the clause its no-leader sentence closes on) — never a second derivation. The capability
 * receives it injected from the route; the route re-reads it on the final readback before rendering.
 */
import { splitIntoRedactableUnits } from '../compose/redactable-units.js';
import { agentLaneLeaderWithheld, agentNoLeaderReason, limitCauseCodesOf } from './withheld-leader-fail-closed.js';

export const PROVISIONAL_VIEW_TOOL = 'give_provisional_view';
/** The words the block opens on. Changing them changes what the user is told the paragraph IS. */
export const PROVISIONAL_VIEW_LABEL = 'Provisional view';

export interface ProvisionalView {
  /** What the Agent would do — at most two sentences. */
  readonly view: string;
  /** Why, from the model's facts and the user's own words — at most three sentences. */
  readonly reasoning: string;
  /** The ONE thing that would let the analysis confirm or overturn it — one sentence. */
  readonly confirm_step: string;
}

type Field = keyof ProvisionalView;

export const PROVISIONAL_VIEW_LIMITS: Readonly<Record<Field, { readonly sentences: number; readonly chars: number }>> = {
  view: { sentences: 2, chars: 400 },
  reasoning: { sentences: 3, chars: 600 },
  confirm_step: { sentences: 1, chars: 280 },
};

export type ProvisionalViewCheck =
  | { readonly ok: true; readonly view: ProvisionalView }
  | { readonly ok: false; readonly field: Field; readonly problem: 'missing' | 'too_long' | 'too_many_sentences'; readonly limit?: number };

/**
 * One line, sentence-final. A newline would let the model open a list, a heading or a second paragraph inside the
 * server's block, so every run of whitespace becomes one space before anything is counted.
 */
function oneLine(s: string): string {
  const line = s.replace(/\s+/g, ' ').trim();
  return /[.!?]["'’”)\]]*$/.test(line) ? line : `${line}.`;
}

const sentenceCount = (s: string): number => splitIntoRedactableUnits(s).filter((u) => /[\p{L}\p{N}]/u.test(u)).length;

/** Validates the tool's arguments. Never repairs a view into one the Agent did not give — it refuses instead. */
export function checkProvisionalView(args: unknown): ProvisionalViewCheck {
  const a = (args ?? {}) as Record<string, unknown>;
  const out: Partial<Record<Field, string>> = {};
  for (const field of ['view', 'reasoning', 'confirm_step'] as const) {
    const raw = a[field];
    if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, field, problem: 'missing' };
    const line = oneLine(raw);
    const limit = PROVISIONAL_VIEW_LIMITS[field];
    if (line.length > limit.chars) return { ok: false, field, problem: 'too_long', limit: limit.chars };
    if (sentenceCount(line) > limit.sentences) return { ok: false, field, problem: 'too_many_sentences', limit: limit.sentences };
    out[field] = line;
  }
  return { ok: true, view: out as ProvisionalView };
}

/** Whether a provisional view may stand beside the analysis, and why the analysis cannot confirm it. */
export interface LeaderStanding {
  /** A completed analysis is on record (current or out of date). Without one there is nothing to be provisional beside. */
  readonly analysis_on_record: boolean;
  /** The wire gate's own verdict: the leader may NOT be named on this readback. */
  readonly withheld: boolean;
  /** Why, in the gate's own words (`agentNoLeaderReason`): "because …". */
  readonly because: string;
}

/**
 * A completed run. `never_run` still carries a `leader_claim` (`permitted: false`, `constraint_verdict_withheld` by
 * default — `composeLeaderClaim`), and its reason words ("a limit … was not shown to be met on this run") would be false.
 */
const COMPLETED_RUN_KINDS: ReadonlySet<string> = new Set(['complete_current', 'complete_stale']);

/**
 * The standing on ONE readback — the route's `readBackState` result — through the gate's own predicate, fed exactly
 * what the route feeds `enforceAgentLaneLeaderClaimsAtWire`.
 */
export function leaderStandingOf(readback: { readonly analysisState?: unknown; readonly analysisReady?: unknown; readonly analysisResult?: unknown }): LeaderStanding {
  const state = readback.analysisState as { run_state?: { kind?: unknown }; leader_claim?: { permitted?: unknown; separation?: unknown; withheld_reason?: unknown } } | null | undefined;
  const claim = state?.leader_claim;
  const withheldReason = typeof claim?.withheld_reason === 'string' ? claim.withheld_reason : undefined;
  const kind = state?.run_state?.kind;
  return {
    analysis_on_record: claim !== undefined && claim !== null && typeof kind === 'string' && COMPLETED_RUN_KINDS.has(kind),
    withheld: agentLaneLeaderWithheld({
      mayNameLeadingOption: claim?.permitted === true,
      separationEstablished: claim?.separation === 'separated',
      ...(withheldReason !== undefined ? { leaderClaimWithheldReason: withheldReason } : {}),
      analysisReady: readback.analysisReady,
    }),
    because: agentNoLeaderReason(withheldReason, readback.analysisReady,
      limitCauseCodesOf(readback.analysisResult === undefined ? [] : [readback.analysisResult])),
  };
}

/**
 * The ONE paragraph the route appends: the label and the typed reason in bold, then the Agent's view, its reasoning and
 * the one step. Server-owned words open it, so it can never read as the analysis's own finding.
 */
export function provisionalViewBlock(v: ProvisionalView, because: string): string {
  const why = because.startsWith('because ') ? ` ${because}` : `, ${because}`;
  return `**${PROVISIONAL_VIEW_LABEL} — the analysis can't confirm this yet${why}.** ${v.view} ${v.reasoning} To let the analysis confirm it: ${v.confirm_step}`;
}

/** Appended as the reply's LAST paragraph — call it only on text the leader gate has already seen. */
export function withProvisionalView(text: string, v: ProvisionalView, because: string): string {
  const body = text.trimEnd();
  const block = provisionalViewBlock(v, because);
  return body.length === 0 ? block : `${body}\n\n${block}`;
}

/**
 * The view this turn's Agent GAVE — the last `give_provisional_view` call the capability accepted, re-checked. `null`
 * when there was none: nothing is ever composed on the Agent's behalf.
 */
export function provisionalViewOfTurn(
  calls: readonly { readonly name: string; readonly ok: boolean; readonly mutated?: boolean; readonly refusal?: string }[],
  results: readonly unknown[],
): ProvisionalView | null {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    if (calls[i]!.name !== PROVISIONAL_VIEW_TOOL || calls[i]!.ok !== true) continue;
    const r = results[i] as { ok?: unknown; provisional_view?: unknown } | undefined;
    if (r?.ok !== true) continue;
    const checked = checkProvisionalView(r.provisional_view);
    if (checked.ok) return checked.view;
  }
  return null;
}
