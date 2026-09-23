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
 *   2. When NO write landed this turn, a sentence that asserts a completed write
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
  unknown_proposal: 'there was no such proposal to apply',
  not_authorised: 'that proposal belongs to a different conversation',
  integrity_failed: 'the stored proposal could not be verified',
  partially_applied: 'only part of it was saved',
  not_applied: 'none of it was applied',
  model_changed_while_proposing: 'the model changed while it was being put together',
  model_already_exists: 'a model already exists for this decision',
  read_only_preview: 'this preview cannot change the model',
};

/** One authoritative line per write the turn attempted. */
function statusLine(name: string, r: ToolResult): string {
  if (name === 'build_model_from_brief') {
    const v = (r.model_version as { version_number?: unknown } | undefined)?.version_number;
    const vs = typeof v === 'number' ? ` (version ${v})` : '';
    if (r.ok === true && r.replayed === true) return `This model had already been built${vs}; nothing was built twice.`;
    if (r.ok === true && r.mutated === true) return `The model was saved${typeof v === 'number' ? ` as version ${v}` : ''}.`;
    return `The model was not built: ${REFUSAL_WORDS[String(r.refusal)] ?? `it was refused (${String(r.refusal ?? 'unknown')})`}.`;
  }
  if (r.ok === true && r.already_applied === true) {
    const vs = versionsOf(r);
    return `That change was already saved${vs.length > 0 ? ` (version ${vs[vs.length - 1]})` : ''}; nothing was written again.`;
  }
  if (r.ok === true && r.applied === true) {
    const vs = versionsOf(r);
    const partial = Array.isArray(r.failures) && r.failures.length > 0;
    const head = vs.length > 0 ? `Saved${versionPhrase(vs)}.` : 'Saved. No version number was recorded for it.';
    return partial ? `${head} Some of it was not recorded — see above.` : head;
  }
  const code = String(r.refusal ?? '');
  const mutated = r.mutated === true;
  return `${mutated ? 'Partly saved' : 'Not saved'}: ${REFUSAL_WORDS[code] ?? `the change was refused (${code || 'unknown reason'})`}.`;
}

export interface WriteOutcomeNarration {
  /** The model's text, with unsupported write claims removed when nothing landed. */
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
): WriteOutcomeNarration {
  const writes = toolCalls
    .map((c, i) => ({ name: c.name, result: toolResults[i] }))
    .filter((w): w is { name: string; result: ToolResult } => WRITE_TOOLS.includes(w.name) && w.result !== undefined);
  const landed = toolResults.some((r) => r.mutated === true);

  const stripped: string[] = [];
  let out = text;
  if (!landed) {
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

  const lines = writes.map((w) => statusLine(w.name, w.result));
  const status = lines.length > 0
    ? lines.join(' ')
    : stripped.length > 0 ? 'Nothing was saved this turn.' : null;
  return { text: out, status, stripped };
}

/** The user-visible text: the model's (checked) words, then the server's status line. */
export function withWriteOutcome(body: string, status: string | null): string {
  if (status === null) return body;
  return body.trim().length > 0 ? `${body}\n\n${status}` : status;
}
