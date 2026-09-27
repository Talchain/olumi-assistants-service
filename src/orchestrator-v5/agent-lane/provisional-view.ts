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
import { sanitiseCoachingProse } from '../../orchestrator/shared/output-safety.js';
import { withoutProposalIds } from './display-ids.js';
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
 * The EXACT sentence the view opens on: the label and the fact that the analysis cannot confirm it. Server-owned
 * words, so the view can never read as the analysis's own finding. The typed reason travels beside it as `because`. The chat renders it verbatim and composes no reason
 * of its own (AIC 5855633777, under ChatGPT's thin-UI ruling 5855577789).
 */
export function provisionalViewHeading(): string {
  // The reason is NOT repeated here (AIC 27 Sep, served 770a477: a four-line bold heading beside a reply that already
  // said it). It travels typed as `because`, and the chat opens "Why Olumi thinks this" with it (UI #2204).
  return `${PROVISIONAL_VIEW_LABEL} \u2014 the analysis can't confirm this yet.`;
}

/**
 * ⭐ TYPED, NEVER PROSE (AIC 5855633777; ChatGPT 5855577789 rule 1). The view travels ONLY as `_agent.provisional_view`
 * — `{heading, view, reasoning, confirm_step, because}` — and never in `assistant_text`: a copy in the prose would be
 * shown twice, land behind "Show more" (the answer shape runs after every append), and invite a surface to parse prose.
 */
export interface ProvisionalViewSidecar extends ProvisionalView {
  readonly heading: string;
  readonly because: string;
}
export function provisionalViewSidecar(v: ProvisionalView, because: string): ProvisionalViewSidecar {
  return { heading: provisionalViewHeading(), ...v, because };
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

/**
 * ⭐ C5b — THE VIEW ON THE RUN BUTTON (DL #70 5856336579, option 1: "fold it into the ONE interpreting call"). Paul met
 * the dead end on the Run button: all 4 Runs in `08bf9a1f` opened "No option can be put forward". Fast path 3 is ONE
 * interpreting call with NO tools (it may explain, never act), so the view cannot be a tool call there. On a withheld
 * completed run that same call returns a strict JSON answer instead — the reply, and the view as a typed field — and
 * the route puts the view through the SAME checks and sidecar as the Agent's `give_provisional_view`. A permitted run
 * is never asked for one.
 */
export const RUN_INTERPRETATION_FORMAT = Object.freeze({
  type: 'json_schema',
  name: 'run_interpretation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'provisional_view'],
    properties: {
      answer: { type: 'string' },
      provisional_view: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['view', 'reasoning', 'confirm_step'],
            properties: { view: { type: 'string' }, reasoning: { type: 'string' }, confirm_step: { type: 'string' } },
          },
        ],
      },
    },
  },
});

/** Appended to the interpreter's instructions ONLY when the run withholds its leader. */
export const RUN_INTERPRETATION_VIEW_INSTRUCTION =
  'On this call you have no tools, so give_provisional_view is not available. Answer as JSON. `answer` is your reply to the user, and every rule in these instructions applies to it: it never names, ranks or favours an option. '
  + '`provisional_view` is your own provisional view, the one give_provisional_view would carry: `view` (what you would do, at most two sentences), `reasoning` (why, from the model’s facts and the user’s own words, at most three sentences) and `confirm_step` (the ONE step that would let the analysis confirm or overturn it, one sentence). '
  + 'Olumi shows it beneath your reply, labelled as your provisional view and never as the analysis result. '
  // Served 27 Sep (pj-timing-2104, pj-dispatch-2106r): the FIRST Run carried a view, and the RERUN after the user's
  // challenge carried none, 2/2 (its output was the answer alone). The user lost Olumi's view just when they had changed
  // the model. The call is made only when the analysis withholds the leader, which is when Paul's ruling wants the view.
  + 'This call is made only because the analysis cannot put an option forward, so give your view on every such run, including a rerun or after a view you gave earlier: say it again, updated for this run. '
  + 'Set it to null only when the model and the user’s words give you no basis for any view. Never write the view in `answer`.';

/**
 * The typed answer of that one call — or `null` when the text is not it (a plain-text interpretation stays the reply,
 * exactly as before). The view is checked by the tool's own rules and refused, never repaired, when it breaks them.
 */
export function readRunInterpretation(text: string): { readonly answer: string; readonly view: ProvisionalView | null } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  const p = parsed as { answer?: unknown; provisional_view?: unknown } | null;
  if (p === null || typeof p !== 'object' || typeof p.answer !== 'string' || p.answer.trim() === '') return null;
  if (p.provisional_view === null || p.provisional_view === undefined) return { answer: p.answer, view: null };
  const checked = checkProvisionalView(p.provisional_view);
  return { answer: p.answer, view: checked.ok ? checked.view : null };
}

/**
 * ⛔ THE AGENT'S OWN WORDS PASS THE USER-FACING SCRUB BEFORE THEY SHIP (DL review of #2101, 5857437282). The view is the
 * model's text, so an internal id or a raw code in it would reach the chat verbatim (the recorded P1 class). In order:
 *   1. an exact graph id becomes that node's label (identity, against the turn's own readback graph);
 *   2. the narrow coaching-prose scrub removes any prefixed id left (`sanitiseCoachingProse`, which never rewrites
 *      ordinary English, unlike the pattern arm);
 *   3. proposal ids go (`withoutProposalIds`, as `assistant_text`).
 * A code-shaped token still left (snake_case or UPPER_SNAKE) REFUSES the view: it is never repaired into words the
 * Agent did not give. The result is re-checked by the tool's own limits.
 */
const CODE_TOKEN = /\b(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/;

export function sanitiseProvisionalView(
  v: ProvisionalView,
  graph: { readonly nodes?: readonly { readonly id?: unknown; readonly label?: unknown }[] } | null,
): ProvisionalView | null {
  const ids = (graph?.nodes ?? [])
    .map((n) => ({ id: typeof n.id === 'string' ? n.id : '', label: typeof n.label === 'string' ? n.label.trim() : '' }))
    .filter((n) => n.id !== '' && n.label !== '' && n.label !== n.id)
    .sort((a, b) => b.id.length - a.id.length);
  const scrub = (text: string): string | null => {
    let t = text;
    for (const n of ids) t = t.split(n.id).join(n.label);
    t = withoutProposalIds(sanitiseCoachingProse(t, graph as never).text);
    return CODE_TOKEN.test(t) ? null : t;
  };
  const view = scrub(v.view);
  const reasoning = scrub(v.reasoning);
  const confirm = scrub(v.confirm_step);
  if (view === null || reasoning === null || confirm === null) return null;
  const checked = checkProvisionalView({ view, reasoning, confirm_step: confirm });
  return checked.ok ? checked.view : null;
}
