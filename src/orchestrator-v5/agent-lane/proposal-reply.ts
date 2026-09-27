/**
 * ⭐ PJ-C1 LATENCY: A PROPOSAL TURN'S REPLY FROM THE TOOL'S OWN RESULT — ONE MODEL CALL, NOT TWO.
 * Proposal: Runtime #70 5859918872. Words: AI Conversation 5859933281 (GO, 4 conditions). DL GO 5859943722.
 *
 * Measured (X3 192916Z/193756Z/194514Z, CEE cd489f1): one converse call ≈ 1.3 s + 11.5 ms per OUTPUT token, so a turn's
 * time is its calls. 19 of 41 message turns were propose → reply (two calls, 6–17 s), and the second call only narrated
 * what the tool had returned. Here that reply is composed from the result itself:
 *
 *   "I've prepared this change: <the consent subject the approval chip carries>."
 *   one line per TYPED disclosure, in AIC's templates (never the tool-facing prose: `note`, `reason`, `*_note` are
 *     written to the model — they name tools and give it instructions);
 *   "Approve this change?" / "Approve these N changes?" (the chip's own count).
 *
 * `null` — and so today's second call — unless the model marked the call `whole_request: true`, and for anything else: another tool, a refused / applied / id-less result, a figure the tool refused to set (`levels_not_set`: its reason is the user's), a
 * result carrying a key outside the tool's allowlist (a disclosure kind with no template), a graded new factor (its
 * current value must be asked for), a multi-option change with a level not set, or a user message holding a question
 * (a question in the same message must be answered; served A08). Nothing is said that the tool did not return.
 */
import { formatFactorValue } from '../compose/format-factor-value.js';

type Rec = Record<string, unknown>;
const recordOf = (x: unknown): Rec | undefined => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : undefined);
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';

/** Every key `proposeNewOption` returns on success when every disclosure has a template (agent-capabilities.ts). */
const NEW_OPTION_KEYS: ReadonlySet<string> = new Set([
  'ok', 'mutated', 'proposal_id', 'public_label', 'held_message', 'held_detail', 'base_revision',
  'option', 'options', 'levels', 'levels_not_set', 'new_factors', 'new_factors_note', 'note',
]);
/** Every key `proposeLinkStrength` returns on success: its reading is already in its consent label. */
const LINK_KEYS: ReadonlySet<string> = new Set(['ok', 'mutated', 'proposal_id', 'public_label', 'base_revision', 'link', 'interpretation', 'note']);

const q = (label: string): string => `‘${label}’`;
const shown = (value: number, unit: unknown): string => {
  const u = nonEmpty(unit) ? unit.trim() : null;
  return formatFactorValue(value, u)?.display ?? (u === null ? String(value) : `${value} ${u}`);
};
const question = (publicLabel: unknown): string => {
  const n = typeof publicLabel === 'string' ? /^Approve (\d+) changes$/.exec(publicLabel.trim())?.[1] : undefined;
  return n !== undefined && Number(n) > 1 ? `Approve these ${n} changes?` : 'Approve this change?';
};
const reply = (subject: string, lines: readonly string[], ask: string): string =>
  [`I’ve prepared this change: ${subject}.`, ...lines, ask].join('\n\n');

function newOptionReply(r: Rec): string | null {
  const subject = typeof r.held_message === 'string' ? /^Yes, ([\s\S]+?)\.?$/.exec(r.held_message.trim())?.[1] : undefined;
  if (subject === undefined || subject.trim() === '') return null;
  const options = Array.isArray(r.options) ? r.options.map(recordOf) : [{ levels: r.levels }];
  if (options.some((o) => o === undefined)) return null;
  const lines: string[] = [];
  const notSet: string[] = [];
  const addNotSet = (factor: string): void => {
    if (!notSet.includes(factor)) notSet.push(factor);
  };
  for (const o of options) {
    const levels = o!.levels;
    if (levels !== undefined && !Array.isArray(levels)) return null;
    for (const raw of levels ?? []) {
      const l = recordOf(raw);
      if (l === undefined || !nonEmpty(l.factor)) return null;
      if (l.value === null || l.still_needed === true) {
        addNotSet(l.factor);
        continue;
      }
      if (typeof l.value !== 'number' || !Number.isFinite(l.value)) return null;
      if (l.stated_by === 'user') continue; // the consent subject states it
      if (l.stated_by !== 'olumi_estimate' || !nonEmpty(l.basis)) return null;
      lines.push(`${q(l.factor)} is set to ${shown(l.value, l.unit)}, Olumi’s estimate (${l.basis.trim()}), for you to correct.`);
    }
  }
  // A figure the tool REFUSED to set carries a reason the user needs (a name conflict, no range, another unit) —
  // "tell me the figure" would ask for one they already gave. The second call explains it.
  if (r.levels_not_set !== undefined) return null;
  // Several options: AIC's "not set" line names no option, so it cannot say which one lacks the level.
  if (notSet.length > 0 && options.length > 1) return null;
  for (const factor of notSet) lines.push(`It doesn’t set a level for ${q(factor)} yet. Tell me the figure and I’ll set it.`);
  if (r.new_factors !== undefined) {
    if (!Array.isArray(r.new_factors)) return null;
    for (const raw of r.new_factors) {
      const f = recordOf(raw);
      // A graded new factor's current value must be ASKED for (its note): no template — the second call does it.
      if (f === undefined || f.kind !== 'switch' || !nonEmpty(f.label)) return null;
      lines.push(`${q(f.label)} is off today and on under this option. That is Olumi’s reading, for you to correct.`);
    }
  }
  return reply(subject, lines, question(r.public_label));
}

function linkStrengthReply(r: Rec): string | null {
  if (!nonEmpty(r.public_label)) return null;
  const label = r.public_label.trim().replace(/\.$/, '');
  return reply(label.charAt(0).toLowerCase() + label.slice(1), [], question(undefined));
}

export function composeProposalReply(tool: string, args: unknown, result: unknown, userMessage: string): string | null {
  // The model's own typed word that this call is the WHOLE request: a message asking for two things never loses one.
  if (recordOf(args)?.whole_request !== true) return null;
  if (typeof userMessage === 'string' && userMessage.includes('?')) return null;
  const r = recordOf(result);
  if (r === undefined || r.ok !== true || r.mutated !== false || !nonEmpty(r.proposal_id)) return null;
  const allowed = tool === 'propose_new_option' ? NEW_OPTION_KEYS : tool === 'propose_link_strength' ? LINK_KEYS : undefined;
  if (allowed === undefined || Object.keys(r).some((k) => !allowed.has(k))) return null;
  return tool === 'propose_new_option' ? newOptionReply(r) : linkStrengthReply(r);
}
