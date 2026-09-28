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
  // A new switch listed at 0 under an option that leaves it off (served A03): the held change is exactly the one without
  // that entry, so the user is told nothing more than that change's own reply.
  'switch_off_entries_dropped', 'switch_off_entries_note',
  // A placeholder 0 on the one entry naming a new switch, read as no level (switch-loop step 5): the held change is the
  // option turning the switch on, which that change's own reply already says.
  'switch_placeholder_levels_read_as_on', 'switch_placeholder_levels_note',
]);
/** Every key `proposeNewRisk` returns on success (agent-capabilities.ts): every disclosure is typed in `risk`. */
const NEW_RISK_KEYS: ReadonlySet<string> = new Set([
  'ok', 'mutated', 'proposal_id', 'public_label', 'held_message', 'held_detail', 'base_revision', 'risk', 'note',
]);
/**
 * Every key `proposeOptionInterventions` returns on a clean success. Its disclosures (`not_the_users_figure`,
 * `no_stated_range`, `already_set`, `levels_not_accepted`, `unresolved`, `adds_links_note`, `ambiguous_targets`) each
 * carry a reason the user needs, so they keep the second call.
 */
const OPTION_LEVELS_KEYS: ReadonlySet<string> = new Set(['ok', 'mutated', 'proposal_id', 'public_label', 'base_revision', 'interventions', 'note']);
/**
 * Every key `proposeGoalCurrentLevel` returns on a clean success (goal-current-level.ts). The figure is the user's by
 * construction (`user_stated`). `replaces` (a revision) and a figure recorded in another unit keep the second call.
 */
const GOAL_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'ok', 'mutated', 'proposal_id', 'public_label', 'base_revision', 'goal', 'current_level', 'as_stated', 'target', 'rederived', 'note',
]);
/** Every key `proposeLimitChange` returns on success; the new figure is the user's by construction (`figure_not_stated`). */
const LIMIT_CHANGE_KEYS: ReadonlySet<string> = new Set(['ok', 'mutated', 'proposal_id', 'public_label', 'base_revision', 'limit', 'note']);
/** The capability's one strength disclosure for a new risk; any other wording has no template here. */
const RISK_PLACEHOLDER_STRENGTH = 'not known yet: Olumi uses a placeholder strength for each link, not an estimate';
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

/** The consent subject the product minted for a held change: its confirm message without "Yes, " and the full stop. */
const heldSubject = (r: Rec): string | undefined => {
  const subject = typeof r.held_message === 'string' ? /^Yes, ([\s\S]+?)\.?$/.exec(r.held_message.trim())?.[1] : undefined;
  return subject !== undefined && subject.trim() !== '' ? subject : undefined;
};
const phrases = (x: unknown): string[] | null =>
  Array.isArray(x) && x.every(nonEmpty) ? x.map((s) => s.trim()) : null;

/**
 * ⭐ A NEW RISK (PJ-C1; live replay of 68 served two-call turns, 28 Sep): what it threatens and what drives it are the
 * capability's own typed phrases, and how strongly is its one fixed disclosure. Anything else keeps the second call.
 */
function newRiskReply(r: Rec): string | null {
  const subject = heldSubject(r);
  const risk = recordOf(r.risk);
  if (subject === undefined || risk === undefined || !nonEmpty(risk.label)) return null;
  const threatens = phrases(risk.threatens);
  const drivenBy = phrases(risk.driven_by ?? []);
  if (threatens === null || threatens.length === 0 || drivenBy === null || risk.how_strongly !== RISK_PLACEHOLDER_STRENGTH) return null;
  return reply(subject, [
    `It threatens ${threatens.join(' and ')}.`,
    ...(drivenBy.length > 0 ? [`It is driven by ${drivenBy.join(' and ')}.`] : []),
    'How strongly it acts is not known yet: Olumi uses a placeholder strength for each link, not an estimate, for you to correct.',
  ], question(r.public_label));
}

/**
 * ⭐ OPTION LEVELS (PJ-C1; live replay of 68 served two-call turns: 10 were these). The consent subject is the
 * proposal's own label; each level Olumi estimated says so with its basis, in the option template's words. A level
 * whose `stated_by` is not typed keeps the second call: whose figure it is is never guessed.
 */
function optionLevelsReply(r: Rec): string | null {
  if (!nonEmpty(r.public_label) || !Array.isArray(r.interventions) || r.interventions.length === 0) return null;
  const lines: string[] = [];
  for (const raw of r.interventions) {
    const iv = recordOf(raw);
    if (iv === undefined || !nonEmpty(iv.option) || !nonEmpty(iv.factor) || typeof iv.value !== 'number' || !Number.isFinite(iv.value)) return null;
    if (iv.stated_by === 'user') continue; // the consent subject states it
    if (iv.stated_by !== 'olumi_estimate' || !nonEmpty(iv.basis)) return null;
    lines.push(`${q(iv.factor)} under ${q(iv.option)} is set to ${shown(iv.value, iv.unit)}, Olumi’s estimate (${iv.basis.trim().replace(/\.$/, '')}), for you to correct.`);
  }
  return reply(r.public_label.trim().replace(/\.$/, ''), lines, question(undefined));
}

function linkStrengthReply(r: Rec): string | null {
  if (!nonEmpty(r.public_label)) return null;
  const label = r.public_label.trim().replace(/\.$/, '');
  return reply(label.charAt(0).toLowerCase() + label.slice(1), [], question(undefined));
}

/** A verb-led consent label ("Record…", "Change…") read after "I’ve prepared this change:". */
const subjectOf = (label: string): string => {
  const l = label.trim().replace(/\.$/, '');
  return l.charAt(0).toLowerCase() + l.slice(1);
};

/**
 * ⭐ A GOAL'S CURRENT LEVEL (PJ-C1, journey C). The consent subject says the figure is the user's and, when the same
 * approval re-derives Olumi's one estimated part of the product (#2214), says that too and that it stays Olumi's — so
 * the reply adds nothing. A re-derivation the label does not state keeps the second call.
 */
function goalLevelReply(r: Rec): string | null {
  if (!nonEmpty(r.public_label)) return null;
  const level = recordOf(r.current_level);
  const stated = recordOf(r.as_stated);
  // The same figure: a unit only spelled another way ("GBP/month", "GBP per month") is matched by the capability, which
  // refuses any other; a figure it RESCALED ("£72k" → 72000) differs here and keeps the second call.
  if (level === undefined || stated === undefined || typeof level.value !== 'number' || level.value !== stated.value) return null;
  if (r.rederived !== undefined) {
    const d = recordOf(r.rederived);
    if (d === undefined || d.whose !== "Olumi's estimate" || !nonEmpty(d.factor)) return null;
    if (!r.public_label.includes(`Olumi's estimate of "${d.factor}"`) || !r.public_label.includes("it stays Olumi's estimate")) return null;
  }
  return reply(subjectOf(r.public_label), [], question(undefined));
}

/** ⭐ A LIMIT'S NEW FIGURE (PJ-C1, journey C): the subject names the limit, its figure now and the one it becomes. */
function limitChangeReply(r: Rec): string | null {
  const limit = recordOf(r.limit);
  if (!nonEmpty(r.public_label) || limit === undefined || !nonEmpty(limit.on) || !nonEmpty(limit.now) || !nonEmpty(limit.becomes)) return null;
  return reply(subjectOf(r.public_label), ['The new figure is the one you gave.'], question(undefined));
}

export function composeProposalReply(tool: string, args: unknown, result: unknown, userMessage: string): string | null {
  // The model's own typed word that this call is the WHOLE request: a message asking for two things never loses one.
  if (recordOf(args)?.whole_request !== true) return null;
  if (typeof userMessage === 'string' && userMessage.includes('?')) return null;
  const r = recordOf(result);
  if (r === undefined || r.ok !== true || r.mutated !== false || !nonEmpty(r.proposal_id)) return null;
  const allowed = tool === 'propose_new_option' ? NEW_OPTION_KEYS : tool === 'propose_link_strength' ? LINK_KEYS
    : tool === 'propose_new_risk' ? NEW_RISK_KEYS : tool === 'propose_option_interventions' ? OPTION_LEVELS_KEYS
      : tool === 'propose_goal_current_level' ? GOAL_LEVEL_KEYS : tool === 'propose_limit_change' ? LIMIT_CHANGE_KEYS : undefined;
  if (allowed === undefined || Object.keys(r).some((k) => !allowed.has(k))) return null;
  return tool === 'propose_new_option' ? newOptionReply(r) : tool === 'propose_new_risk' ? newRiskReply(r)
    : tool === 'propose_option_interventions' ? optionLevelsReply(r) : tool === 'propose_goal_current_level' ? goalLevelReply(r)
      : tool === 'propose_limit_change' ? limitChangeReply(r) : linkStrengthReply(r);
}
