/**
 * ⛔ WHAT WAS SAVED IS STATED BY THE SERVER, FROM THE TOOL RESULTS — NEVER BY THE MODEL.
 *
 * Release Control, 23 Sep 2026 (olumi-programme-docs#63 5788648244): the route
 * returned the model's `assistant_text` essentially verbatim, so a
 * model-authored "Saved…" survived on a turn where nothing was written. The
 * instructions already said not to claim an unrecorded change twice; a served
 * witness showed that is not a boundary.
 *
 * Two structural rules:
 *   1. When a write tool ran, the SERVER composes the write-status line from the
 *      authoritative results — version from the receipts, `already_applied`,
 *      refusal — and appends it. The model's own numbers are never the source.
 *   2. On EVERY turn (not only when no write landed — see narrateWriteOutcome), a
 *      sentence that asserts a completed write
 *      is removed. The claim shape is derived from REAL served replies
 *      (output/paul-test-20260923/repro, construction-witness/raw,
 *      openai-agent-lane/evidence): every success claim in that corpus OPENS
 *      with the past-tense verb — "Applied proposal `prop_…` successfully.",
 *      "Added: **A → B** (positive).", "Updated: all **8 assumptions** were
 *      adopted.", "Recorded assumptions:" — or says the effect "is now
 *      recorded / represented". The negations in the same corpus ("Nothing has
 *      been changed yet.", "I haven't added a duplicate.", "Proposed — not
 *      applied:", "Approve this specific link if you want it added.") do not
 *      match and survive.
 */

import type { ToolResult } from './runtime/agent-tools.js';
import { proposalsAwaitingApproval } from './approval-chips.js';

/** Tools whose result is a WRITE to the user's model. Proposers change nothing. */
export const WRITE_TOOLS: readonly string[] = ['authorise_change', 'build_model_from_brief'];

const CLAIM_OPENER =
  /^(?:[-•*>#\s]*)(?:\*\*)?(?:Applied|Added|Updated|Saved|Recorded|Adopted|Linked)(?:\*\*)?(?:\s*:|\s+(?:(?:the|all|a|an|your|this|that|these|those|both|every|each|proposal|assumptions?|levels?|values?|it|them)\b|\*\*|`|\d))/i;
const NOW_EFFECT = /\b(?:is|are)\s+now\s+(?:recorded|represented|saved|applied|in the model)\b|\b(?:was|were)\s+(?:recorded|applied|saved|added|adopted)\b/i;
const I_DID = /\bI(?:'|’)?(?:ve| have)\s+(?:applied|added|saved|recorded|updated|linked|adopted)\b/i;
const NEGATION = /\b(?:not|no|nothing|never|yet|haven(?:'|’)t|hasn(?:'|’)t|didn(?:'|’)t|won(?:'|’)t|cannot|can(?:'|’)t|once|if|until|when)\b|n(?:'|’)t\b/i;

/** Does this sentence ASSERT that a write happened? Exported for its own tests. */
export function assertsCompletedWrite(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length === 0) return false;
  if (CLAIM_OPENER.test(s)) return true;
  if (NEGATION.test(s)) return false;
  return NOW_EFFECT.test(s) || I_DID.test(s);
}

const versionsOf = (r: ToolResult): number[] => {
  const receipts = Array.isArray(r.receipts) ? (r.receipts as { version?: unknown }[]) : [];
  return receipts.map((x) => x.version).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
};
const versionPhrase = (vs: number[]): string =>
  vs.length === 0 ? '' : vs.length === 1 ? ` as version ${vs[0]}` : ` as versions ${vs[0]}–${vs[vs.length - 1]}`;

const REFUSAL_WORDS: Record<string, string> = {
  superseded: 'the model changed after this was proposed, so it was not applied — ask me to propose it again',
  unknown_proposal: 'that proposal is no longer available, so nothing was changed — ask me to suggest it again and approve the new one',
  not_authorised: 'that proposal belongs to a different conversation',
  integrity_failed: 'the stored proposal could not be verified',
  partially_applied: 'only part of it was saved',
  not_applied: 'none of it was applied',
  model_changed_while_proposing: 'the model changed while it was being put together',
  model_already_exists: 'a model already exists for this decision',
  read_only_preview: 'this preview cannot change the model',
  // ⛔ A REFUSED BUILD, IN WORDS WITH A NEXT STEP (served `785185b7`, scenario
  // `03b93536`): the user read "it was refused (model_too_large)" — a code, no
  // reason, nothing to do next. Every refusal `runtime/build-model.ts` returns.
  model_too_large: 'it came back larger than a first model can be, even after one attempt to make it more compact — ask me to build it again, or tell me which options and factors matter most',
  no_structured_output: 'the model builder returned nothing usable this time — ask me to try again',
  construction_failed: 'the model builder could not produce a usable model this time — ask me to try again',
  admitted_graph_invalid: 'what came back did not form a valid model, so nothing was saved — ask me to try again',
  registration_refused: 'it could not be saved to this decision — ask me to try again',
};

const PART_NAMES: Record<string, string> = { values: 'starting values', option_levels: 'option levels' };

/**
 * A compound approval (#1712) reports each part: what was recorded, out of how
 * many, and with which receipts. State exactly that — "Saved 6 of 6 starting
 * values as version 2. Not saved: 0 of 2 option levels (…)." — never a vague
 * "part of it".
 */
function partsLine(r: ToolResult): string | null {
  const parts = Array.isArray(r.parts) ? (r.parts as ToolResult[]) : null;
  if (parts === null || parts.length === 0) return null;
  const bits = parts.map((p) => {
    const what = PART_NAMES[String(p.part)] ?? String(p.part ?? 'change');
    const rec = typeof p.recorded_count === 'number' ? p.recorded_count : null;
    const req = typeof p.requested_count === 'number' ? p.requested_count : null;
    const count = rec !== null && req !== null ? `${rec} of ${req} ` : '';
    if (p.ok === true) return `Saved ${count}${what}${versionPhrase(versionsOf(p))}.`;
    const code = String(p.reason ?? p.refusal ?? '');
    const why = code !== '' ? ` (${REFUSAL_WORDS[code] ?? code.replace(/_/g, ' ')})` : '';
    return `Not saved: ${count}${what}${why}.`;
  });
  // A part the chain never reached is still not saved — say so.
  if (r.ok !== true && r.refusal === 'partially_applied' && parts.every((p) => p.part !== 'option_levels') && parts.some((p) => p.part === 'values')) {
    bits.push('Not saved: option levels (stopped before they were written).');
  }
  return bits.join(' ');
}

/**
 * ⭐ COMPACTION MUST NOT QUIETLY SHRINK THE THINKING (Paul, 23 Sep: "Olumi pushes
 * beyond the current model … surfaces missing factors and perspectives").
 * `build_model_from_brief` keeps the first model readable (#1710) and returns what
 * a compact retry left out; until now only the Agent was told, so a model that
 * skipped it dropped the disclosure silently (Panel N7). The server states it, as
 * ideas the user can bring back — never as deletions they must discover.
 */
const LEFT_OUT_SHOWN = 5;
function leftOutLine(r: ToolResult): string {
  const items = Array.isArray(r.left_out_to_stay_compact) ? (r.left_out_to_stay_compact as { label?: unknown }[]) : [];
  const labels = items.map((i) => String(i.label ?? '').trim()).filter((l) => l !== '');
  if (labels.length === 0) return '';
  const shown = labels.slice(0, LEFT_OUT_SHOWN).join('; ');
  const more = labels.length > LEFT_OUT_SHOWN ? `; and ${labels.length - LEFT_OUT_SHOWN} more` : '';
  return ` To keep it readable, I left out: ${shown}${more}. Ask me to add any of them back.`;
}

/** Factors held as context because no option changes them — stated, so the user can say which option should. */
function contextFactorsLine(r: ToolResult): string {
  const labels = Array.isArray(r.treated_as_context) ? (r.treated_as_context as unknown[]).map((l) => String(l).trim()).filter((l) => l !== '') : [];
  if (labels.length === 0) return '';
  return ` No option changes ${labels.join(' or ')}, so I held ${labels.length === 1 ? 'it' : 'them'} as fixed context rather than ${labels.length === 1 ? 'a lever' : 'levers'} \u2014 tell me if one of the options should change ${labels.length === 1 ? 'it' : 'them'}.`;
}

/** The questions the build parked instead of modelling — what to examine next, not answers. */
function openQuestionsLine(r: ToolResult): string {
  const qs = Array.isArray(r.open_questions) ? (r.open_questions as unknown[]).map((q) => String(q).trim()).filter((q) => q !== '') : [];
  if (qs.length === 0) return '';
  // Each question kept whole, so it still reads as a question the team can take up.
  const shown = qs.slice(0, LEFT_OUT_SHOWN).map((q) => (/[?.!]$/.test(q) ? q : `${q}?`)).join(' ');
  const more = qs.length > LEFT_OUT_SHOWN ? ` (and ${qs.length - LEFT_OUT_SHOWN} more)` : '';
  return ` Questions this model does not answer yet: ${shown}${more}`;
}

/**
 * ⛔ A SAVED BUILD MUST NOT READ AS SAVED FIGURES (Paul's test on served `d5d5839`, #69 5832088673).
 * The reply said "These are starting assumptions, not measurements. Shall I record them?" and Olumi
 * then said "The model was saved as version 1." The build really was saved; the figures were not —
 * but the line read as if they had been recorded before he agreed. So when the SAME turn leaves a
 * proposal awaiting approval after the build, the line says what was saved and what was not.
 *
 * Derived from the turn's own tool results by the approve chip's own rule (`proposalsAwaitingApproval`),
 * never from the model's prose. An authorisation refused before it named any proposal (a call withheld
 * on a chip turn, a read-only refusal) consumed nothing, so it is not an unknown identity here.
 */
const FIGURE_PROPOSERS: readonly string[] = ['propose_starting_point', 'propose_assumptions', 'propose_option_interventions'];
type AwaitingApproval = 'figures' | 'change' | null;
function awaitingApproval(toolCalls: readonly { name: string }[], toolResults: readonly ToolResult[]): AwaitingApproval {
  const calls = toolCalls
    .map((c, i) => {
      const r = toolResults[i];
      return { name: c.name, ok: r?.ok === true, mutated: r?.mutated === true, ...(typeof r?.proposal_id === 'string' ? { proposal_id: r.proposal_id } : {}) };
    })
    .filter((c) => !(c.name === 'authorise_change' && !c.ok && !c.mutated && c.proposal_id === undefined));
  const waiting = [...proposalsAwaitingApproval(calls).values()];
  if (waiting.length === 0) return null;
  return waiting.every((t) => FIGURE_PROPOSERS.includes(t)) ? 'figures' : 'change';
}

/** One authoritative line per write the turn attempted. */
function statusLine(name: string, r: ToolResult, pending: AwaitingApproval = null, versioned = true): string {
  if (name === 'build_model_from_brief') {
    const v = (r.model_version as { version_number?: unknown } | undefined)?.version_number;
    const vs = typeof v === 'number' ? ` (version ${v})` : '';
    if (r.ok === true && r.replayed === true) return `This model had already been built${vs}; nothing was built twice.`;
    if (r.ok === true && r.mutated === true) {
      const at = typeof v === 'number' ? ` as version ${v}` : '';
      const saved = pending === null
        ? `The model was saved${at}.`
        : `I saved the model I drafted${at}. ${pending === 'figures' ? 'The figures above are not recorded until you approve them.' : 'What I proposed above is not made until you approve it.'}`;
      return `${saved}${leftOutLine(r)}${openQuestionsLine(r)}${contextFactorsLine(r)}`;
    }
    return `The model was not built: ${REFUSAL_WORDS[String(r.refusal)] ?? `it was refused (${String(r.refusal ?? 'unknown')})`}.`;
  }
  const perPart = partsLine(r);
  if (perPart !== null) return perPart;
  if (r.ok === true && r.already_applied === true) {
    const vs = versionsOf(r);
    return `That change was already saved${vs.length > 0 ? ` (version ${vs[vs.length - 1]})` : ''}; nothing was written again.`;
  }
  if (r.ok === true && r.applied === true) {
    const vs = versionsOf(r);
    const partial = Array.isArray(r.failures) && r.failures.length > 0;
    // ⛔ A GUEST'S SAVE IS NEVER VERSIONED (the guest store policy), so "no version number was recorded" read as a
    // fault on every guest approval (Paul's test 1a298d6d; matrix C14). For a guest the confirmed save is the whole
    // truth; for a signed-in user a missing version is still worth saying.
    const head = vs.length > 0 ? `Saved${versionPhrase(vs)}.` : versioned ? 'Saved. No version number was recorded for it.' : 'Saved.';
    return partial ? `${head} Some of it was not recorded — see above.` : head;
  }
  /**
   * ⛔ A PARTIALLY ADDED OPTION SAYS WHAT LANDED AND WHAT REMAINS (independent review of #1788,
   * 5806071796). The generic line said "the change was refused (unknown reason)" and dropped the
   * named missing link. Composed only from the capability's readback-confirmed fields.
   */
  const opt = r.option as { label?: unknown; linked_to?: unknown } | undefined;
  if (r.ok !== true && r.mutated === true && opt !== undefined && Array.isArray(r.not_linked) && r.not_linked.length > 0) {
    const label = String(opt.label ?? 'The option');
    const linkedTo = Array.isArray(opt.linked_to) ? opt.linked_to.map(String) : [];
    const missing = (r.not_linked as { factor?: unknown }[]).map((n) => String(n.factor ?? ''));
    const vs = versionsOf(r);
    return `Partly saved${versionPhrase(vs)}: "${label}" was added${linkedTo.length > 0 ? ` and linked to ${linkedTo.join(', ')}` : ''}, `
      + `but not yet linked to ${missing.join(', ')}. Approving the same change again will try only the missing ${missing.length === 1 ? 'link' : 'links'}; `
      + 'if the model has changed since, you will be asked to confirm again.';
  }
  const code = String(r.refusal ?? '');
  const mutated = r.mutated === true;
  /**
   * ⛔ A WRITE THAT WAS SENT BUT COULD NOT BE READ BACK IS NEITHER SAVED NOR REFUSED. The product may have stored it,
   * so "Not saved" (or "Partly saved … refused") would be a claim Olumi cannot make. Say exactly what is known.
   */
  if (code === 'not_confirmed') return 'This change could not be confirmed: it was sent, but reading your model back did not show it. Ask me to check the model.';
  return `${mutated ? 'Partly saved' : 'Not saved'}: ${REFUSAL_WORDS[code] ?? `the change was refused (${code || 'unknown reason'})`}.`;
}

export interface WriteOutcomeNarration {
  /** The model's text with every completion claim removed — the server states what was saved. */
  readonly text: string;
  /** The server's own write-status line, or null when the turn neither wrote nor claimed to. */
  readonly status: string | null;
  /** Exactly what was removed, for the diagnostic trace. */
  readonly stripped: readonly string[];
}

export function narrateWriteOutcome(
  text: string,
  toolCalls: readonly { name: string }[],
  toolResults: readonly ToolResult[],
  /** False for a guest, whose saves are never versioned: a save without a version is then not an anomaly. */
  opts: { readonly versioned?: boolean } = {},
): WriteOutcomeNarration {
  const writes = toolCalls
    .map((c, i) => ({ name: c.name, result: toolResults[i] }))
    .filter((w): w is { name: string; result: ToolResult } => WRITE_TOOLS.includes(w.name) && w.result !== undefined);

  const stripped: string[] = [];
  let out = text;
  /**
   * ⛔ THE SERVER OWNS EVERY COMPLETION CLAIM ON EVERY TURN — not only when
   * nothing landed. Independent pre-read of #1712/#1720 (PR #1720 comment
   * 5790103315): a partial approval returns `mutated: true` (values landed,
   * levels refused), so a model sentence "Saved all values and option levels"
   * survived beside the server's own "Partly saved". A model-authored completion
   * sentence is therefore always removed; the extent saved/refused is stated
   * from the structured results below. Non-write reasoning is kept.
   */
  {
    out = text
      .split('\n')
      .map((line) => {
        const sentences = line.split(/(?<=[.!?])\s+/);
        const kept = sentences.filter((s) => {
          if (assertsCompletedWrite(s)) { stripped.push(s.trim()); return false; }
          return true;
        });
        return kept.length === sentences.length ? line : kept.join(' ');
      })
      .filter((line, i, all) => !(line.trim() === '' && (all[i - 1] ?? '').trim() === ''))
      .join('\n')
      .trim();
  }

  const pending = awaitingApproval(toolCalls, toolResults);
  const lines = writes.map((w) => statusLine(w.name, w.result, pending, opts.versioned ?? true));
  const status = lines.length > 0
    ? lines.join(' ')
    : stripped.length > 0 ? 'Nothing was saved this turn.' : null;
  return { text: out, status, stripped };
}

/** The user-visible text: the model's (checked) words, then the server's status line. */
/**
 * ⛔ WHAT A PROPOSAL LEAVES OUT IS SAID BY OLUMI, NOT LEFT TO THE MODEL (independent review of
 * #1800, 5806926323 / 5807008891). A named input that cannot hold a value (a risk, an outcome) is
 * dropped from the proposal; the one-click approval is generic, and a model reply that says only
 * "here is a starting point" would offer consent while the user-named input was silently absent.
 * This line is composed from the proposers' own results and rides with the status line, so the
 * response itself names every omission and why BEFORE the approval it accompanies.
 */
export function notAdoptedLine(
  toolCalls: readonly { name: string }[],
  toolResults: readonly ToolResult[],
): string | null {
  const PROPOSERS = ['propose_assumptions', 'propose_starting_point'];
  const seen = new Set<string>();
  const items: string[] = [];
  toolCalls.forEach((c, i) => {
    if (!PROPOSERS.includes(c.name)) return;
    const r = toolResults[i] as { not_a_factor?: unknown; assumptions_refused?: { not_a_factor?: unknown } } | undefined;
    const list = [
      ...(Array.isArray(r?.not_a_factor) ? r!.not_a_factor : []),
      ...(Array.isArray(r?.assumptions_refused?.not_a_factor) ? r!.assumptions_refused!.not_a_factor as unknown[] : []),
    ] as { label?: unknown; kind?: unknown }[];
    for (const n of list) {
      const label = String(n?.label ?? '').trim();
      if (label === '' || seen.has(label)) continue;
      seen.add(label);
      const kind = String(n?.kind ?? '').trim();
      items.push(kind !== '' ? `${label} (${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind})` : label);
    }
  });
  if (items.length === 0) return null;
  return `Not included in this proposal: ${items.join('; ')}. Only a factor can hold a starting value, so ${items.length === 1 ? 'it was' : 'they were'} left out — approving adds nothing for ${items.length === 1 ? 'it' : 'them'}.`;
}

export function withWriteOutcome(body: string, status: string | null): string {
  if (status === null) return body;
  return body.trim().length > 0 ? `${body}\n\n${status}` : status;
}

/**
 * ⭐ AN AUTHORISED REVISION SAYS WHAT IT DID TO THE RESULT ON SCREEN (R&C 5842738466; Delivery Lead 5842745019).
 * Served on e3b0844: the user approved "Monthly churn 5% → 4%", and the reply was "Saved. … The analysis can run
 * now." — never that the analysis on screen predates the change. Deterministic from THIS turn's typed readback only:
 * `run_state` stale because the graph changed, and `requires_rerun`. "Run it again" only when the same verdict the
 * Run control reads admits a run; otherwise the readiness sentence says why it cannot. Nothing about what a re-run
 * will check (a limit may still be unchecked), and no figure.
 */
export function staleResultLine(analysisState: unknown, analysisReady: unknown): string | null {
  const s = analysisState as { run_state?: { kind?: unknown; cause?: unknown }; requires_rerun?: unknown } | undefined;
  if (s?.run_state?.kind !== 'complete_stale' || s.run_state.cause !== 'graph_changed' || s.requires_rerun !== true) return null;
  const mayRun = (analysisReady as { may_run?: unknown } | undefined)?.may_run === true;
  return mayRun
    ? 'The analysis on screen was computed before this change; run it again to see the comparison with this change.'
    : 'The analysis on screen was computed before this change.';
}
