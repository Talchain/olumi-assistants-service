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
import { sayFigureExactly, twoStateLevelWords } from './say-figure.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import type { LinkSizing } from '../../cee/magnitude/link-sizing.js';
import { reliesOnRiskLine } from '../routing/relies-on-risk.js';
import { HELD_RISK_CAUSE_NOTE, HELD_RISK_WINDOW_NOTE } from './held-risk-notes.js';

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
  'ok', 'mutated', 'proposal_id', 'public_label', 'held_message', 'held_detail', 'base_revision', 'risk', 'likelihood', 'note', 'dropped_drivers',
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
/** Every key `proposeNewFactor` returns on success (PJ-E-FIG): each factor's figure, link and strength are typed in `factors`. */
const NEW_FACTOR_KEYS: ReadonlySet<string> = new Set([
  'ok', 'mutated', 'proposal_id', 'public_label', 'held_message', 'held_detail', 'base_revision', 'factors', 'note',
]);
/** The capability's one strength disclosure for a new factor's link; any other wording has no template here. */
const FACTOR_PLACEHOLDER_STRENGTH = 'not known yet: Olumi uses a placeholder strength for the link, not an estimate';
/** The capability's one strength disclosure for a new risk; any other wording has no template here. */
const RISK_PLACEHOLDER_STRENGTH = 'not known yet: Olumi uses a placeholder strength for each link, not an estimate';
/** Every key `proposeLinkStrength` returns on success: its reading is already in its consent label. */
const LINK_KEYS: ReadonlySet<string> = new Set(['ok', 'mutated', 'proposal_id', 'public_label', 'base_revision', 'link', 'interpretation', 'note']);
/** Every key `proposeLinkStrengths` returns on success: each link's band, figure and whose it is are in its consent label. */
const LINK_SET_KEYS: ReadonlySet<string> = new Set(['ok', 'mutated', 'proposal_id', 'public_label', 'base_revision', 'links', 'already', 'note']);

const q = (label: string): string => `‘${label}’`;
/** A level as the user writes it ("£15,000 over 6 months"): the lane's one figure formatter, as the consent subject says it. */
export const proposalFigure = (value: number, unit: unknown): string => {
  const u = nonEmpty(unit) ? unit.trim() : null;
  return sayFigureExactly(value, u ?? '') ?? formatFactorValue(value, u)?.display ?? (u === null ? String(value) : `${value} ${u}`);
};
/** Adapt returned option levels to the existing classifier's option/intervention shape. */
const levelSources = (levels: readonly unknown[]): unknown[] => levels.flatMap((raw) => {
  const l = recordOf(raw);
  return l !== undefined && nonEmpty(l.factor)
    ? [{ kind: 'option', interventions: { [l.factor]: l.value } }] : [];
});
const setting = (value: number, unit: unknown, nodes: readonly unknown[], factor: string): string => {
  const state = twoStateLevelWords(value, unit, nodes, factor);
  return state === null ? `set to ${proposalFigure(value, unit)}` : `switched ${state}`;
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
  const sources = levelSources(options.flatMap((o) => Array.isArray(o?.levels) ? o.levels : []));
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
      lines.push(`${q(l.factor)} is ${setting(l.value, l.unit, sources, l.factor)}, Olumi’s estimate (${l.basis.trim()}), for you to correct.`);
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
  // Validate before either branch: a precondition may retain the same host-grounded user occurrence as an ordinary risk.
  const likelihood = recordOf(risk.likelihood);
  if (risk.likelihood !== undefined && (likelihood === undefined || likelihood.basis !== 'user'
    || typeof likelihood.p_low_pct !== 'number' || typeof likelihood.p_high_pct !== 'number'
    || typeof likelihood.horizon_months !== 'number' || !nonEmpty(likelihood.quote))) return null;
  const likelihoodLines = likelihood === undefined ? []
    : [`It may happen (about ${likelihood.p_low_pct}${likelihood.p_low_pct === likelihood.p_high_pct ? '' : `–${likelihood.p_high_pct}`}% within ${likelihood.horizon_months} months), as you said.`];
  const precondition = recordOf(risk.relies_on);
  if (risk.relies_on !== undefined) {
    if (precondition === undefined || !nonEmpty(precondition.option_id) || !nonEmpty(precondition.option_label)
      || threatens === null || threatens.length !== 0 || drivenBy === null || drivenBy.length !== 0
      || (risk.links_dropped !== undefined && risk.links_dropped !== true) || risk.likelihood !== undefined) return null;
    return reply(subject, [
      reliesOnRiskLine(risk.label, precondition.option_label),
      ...(risk.links_dropped === true ? [`It is kept without links because it is a precondition of ${q(precondition.option_label)}.`] : []),
    ], question(r.public_label));
  }
  if (threatens === null || threatens.length === 0 || drivenBy === null || risk.how_strongly !== RISK_PLACEHOLDER_STRENGTH) return null;
  // event_risk.v1 slice 2a: the door's grounded occurrence, distinct from placeholder impact.
  const causeNote = HELD_RISK_CAUSE_NOTE;
  const droppedDrivers = r.dropped_drivers === undefined ? []
    : Array.isArray(r.dropped_drivers) && r.dropped_drivers.every(nonEmpty) ? r.dropped_drivers as string[] : null;
  if (droppedDrivers === null) return null;
  const droppedNote = `I left out ${droppedDrivers.map((driver) => `'${driver}'`).join(' and ')} as ${droppedDrivers.length === 1 ? 'a driver' : 'drivers'}: a risk with a stated likelihood can't have a driver in the model yet. Say if you'd rather keep the driver as an ordinary risk instead.`;
  const windowNote = HELD_RISK_WINDOW_NOTE;
  return reply(subject, [
    ...likelihoodLines,
    ...(typeof r.note === 'string' && r.note.includes(causeNote) ? [causeNote] : []),
    ...(droppedDrivers.length > 0 && typeof r.note === 'string' && r.note.includes(droppedNote) ? [droppedNote] : []),
    ...(typeof r.note === 'string' && r.note.includes(windowNote) ? [windowNote] : []),
    `It threatens ${threatens.join(' and ')}.`,
    ...(drivenBy.length > 0 ? [`It is driven by ${drivenBy.join(' and ')}.`] : []),
    'How strongly it acts is not known yet: Olumi uses a placeholder strength for each link, not an estimate, for you to correct.',
  ], question(r.public_label));
}

/**
 * ⭐ NEW FACTORS WITH THE USER'S FIGURES (PJ-E-FIG): each figure is the user's (`stated_by: 'user'`), what it affects is the
 * capability's own typed phrase, and how strongly is its one fixed disclosure. The figures are named here because the
 * consent subject is minted from the ops, which never carry them. Anything else keeps the second call.
 */
function newFactorReply(r: Rec): string | null {
  const subject = heldSubject(r);
  if (subject === undefined || !Array.isArray(r.factors) || r.factors.length === 0) return null;
  const lines: string[] = [];
  let toConfirm = false;
  for (const raw of r.factors) {
    const f = recordOf(raw);
    const cv = recordOf(f?.current_value);
    if (f === undefined || cv === undefined || !nonEmpty(f.label) || !nonEmpty(f.affects)
      || typeof cv.value !== 'number' || !Number.isFinite(cv.value) || f.how_strongly !== FACTOR_PLACEHOLDER_STRENGTH) return null;
    if (cv.stated_by === 'user') {
      lines.push(`${q(f.label)} is ${twoStateLevelWords(cv.value, cv.unit) === null ? proposalFigure(cv.value, cv.unit) : `switched ${twoStateLevelWords(cv.value, cv.unit)}`}, the figure you gave, and affects ${f.affects.trim()}.`);
    } else if (cv.stated_by === 'user_to_confirm' && nonEmpty(cv.quote)) {
      // ⛔ DL ruling on #2235: the PAIRING is Olumi's until the user approves it, so the card shows it with their own words.
      toConfirm = true;
      lines.push(`${q(f.label)}: ${proposalFigure(cv.value, cv.unit)}, from your message “${cv.quote.trim()}”; it affects ${f.affects.trim()}.`);
    } else {
      return null;
    }
  }
  if (toConfirm) lines.push('Olumi matched each figure to its factor from your words: approve only if every pairing is right.');
  lines.push('How strongly each acts is not known yet: Olumi uses a placeholder strength for the link, not an estimate, for you to correct.');
  return reply(subject, lines, question(r.public_label));
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
    lines.push(`${q(iv.factor)} under ${q(iv.option)} is ${setting(iv.value, iv.unit, levelSources(r.interventions), iv.factor)}, Olumi’s estimate (${iv.basis.trim().replace(/\.$/, '')}), for you to correct.`);
  }
  return reply(r.public_label.trim().replace(/\.$/, ''), lines, question(undefined));
}

function linkStrengthReply(r: Rec): string | null {
  if (!nonEmpty(r.public_label)) return null;
  const label = r.public_label.trim().replace(/\.$/, '');
  return reply(label.charAt(0).toLowerCase() + label.slice(1), [], question(undefined));
}

/**
 * ⭐ A SET OF LINK STRENGTHS (DL #72 5871594233): the label names every link, its band, its figure and whose estimate it
 * is; when any is Olumi's, one line says how it is stored. Its words are the capability's own, so nothing is re-derived.
 */
/** F1b's sizing classes (`LinkSizing`, link-sizing.ts): what a link's `was.sizing` may hold. */
const LINK_SIZINGS: ReadonlySet<string> = new Set<LinkSizing>(['user', 'placeholder', 'olumi_accepted', 'olumi_estimate', 'unmarked']);
/** `proposeLinkStrengths`' own literals for whose a strength is; a first estimate never implies a prior size. */
const REVIEW_ONLY_LINK = 'review only; nobody has sized this link';
const UNSIZED_LINK_CHANGE = 'placeholder prior changed; nobody has sized this link';
const LINK_WHOSE: ReadonlySet<string> = new Set(['yours', 'Olumi\u2019s estimate', 'Olumi\u2019s first estimate for a link nobody had sized', REVIEW_ONLY_LINK, UNSIZED_LINK_CHANGE]);

function linkSetReply(r: Rec): string | null {
  if (!nonEmpty(r.public_label) || !Array.isArray(r.links) || r.links.length === 0) return null;
  const links = r.links.map(recordOf);
  // Whose each strength is, as the capability types it: anything else is untyped and keeps the second call (DL on #2475).
  if (links.some((l) => l === undefined || !LINK_WHOSE.has(l.whose as string))) return null;
  const olumis = links.filter((l) => l!.whose === 'Olumi\u2019s estimate').length;
  const firstEstimates = links.filter((l) => l!.whose === 'Olumi\u2019s first estimate for a link nobody had sized');
  const reviewOnly = links.filter((l) => l!.whose === REVIEW_ONLY_LINK);
  const unsizedChanges = links.filter((l) => l!.whose === UNSIZED_LINK_CHANGE);
  /**
   * ⭐ A LINK OLUMI HAD ALREADY ESTIMATED IS RE-SIZED, NOT SIZED (AI HARNESS #2475; CODEX_CLI_OVERFLOW + DL CR 5937945418 on
   * R3 DEFECT 2): read from the capability's typed `whose`, `keeps_current_strength` and `was.sizing` (F1b's `linkSizing`),
   * never from its note. A link whose sizing before is not typed keeps the second call.
   */
  const replaced: string[] = [];
  for (const l of links) {
    const was = recordOf(l!.was);
    if (was === undefined || !LINK_SIZINGS.has(was.sizing as string) || typeof l!.keeps_current_strength !== 'boolean') return null;
    // B1: the capability previewed the canonical review writer and read its class with linkSizing. Only a retained
    // placeholder can carry the bounded review literal; it neither offers a size nor earns authorship on approval.
    if (l!.whose === REVIEW_ONLY_LINK) {
      if (was.sizing !== 'placeholder' || l!.keeps_current_strength !== true || l!.sizing_after_approval !== 'placeholder') return null;
      continue;
    }
    if (l!.whose === UNSIZED_LINK_CHANGE) {
      if (was.sizing !== 'placeholder' || l!.keeps_current_strength !== false || l!.sizing_after_approval !== 'placeholder') return null;
      continue;
    }
    if (l!.sizing_after_approval === 'placeholder') return null;
    // Science 393023 LICENCE ruling 3: a first-estimate attribution is valid only for an unsized prior, and vice versa.
    if ((l!.whose === 'Olumi\u2019s first estimate for a link nobody had sized')
      !== (l!.whose !== 'yours' && was.sizing === 'placeholder')) return null;
    if (l!.whose === 'yours' || l!.keeps_current_strength || (was.sizing !== 'olumi_estimate' && was.sizing !== 'olumi_accepted')) continue;
    if (!nonEmpty(l!.from) || !nonEmpty(l!.to) || !nonEmpty(was.band)) return null;
    replaced.push(`${q(l!.from.trim())} \u2192 ${q(l!.to.trim())} (${was.band.trim()})`);
  }
  return reply(subjectOf(r.public_label), [
    ...(olumis > 0 ? ['Olumi\u2019s estimates stay marked as Olumi\u2019s, never as your own: approving applies them.'] : []),
    ...(firstEstimates.length > 0 ? ['For links nobody had sized, this offers Olumi\u2019s first estimate: approving records it as Olumi\u2019s, never as your own.'] : []),
    ...(firstEstimates.some((l) => l!.keeps_current_strength) ? ['Where the strength is kept as it is, approving records only your review, never authorship.'] : []),
    ...(reviewOnly.length > 0 ? ['These links aren\u2019t sized in the model yet: approving records only your review and keeps their strength as it is.'] : []),
    ...(unsizedChanges.length > 0 ? ['These links aren\u2019t sized in the model yet: approving changes the stored placeholder strength and records your review.'] : []),
    ...(replaced.length === 1 ? [`${replaced[0]} already held Olumi\u2019s estimate: this replaces that estimate.`]
      : replaced.length > 1 ? [`These links already held Olumi\u2019s estimate, which this replaces: ${replaced.join('; ')}.`] : []),
  ], question(undefined));
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

/** Argument keys that QUOTE the user's words: a figure inside a quote is carried into no reply. */
const QUOTE_KEY = /(?:^|_)(?:words|quote|rationale|basis|reason)$/;

/** A number an argument carries, with the unit written beside it in the same object (if any). */
type Carried = { readonly value: number; readonly unit: string | null };

/** Every number (with its sibling `unit`) and string an argument carries, outside quotes of the user's own words. */
function carriedBy(value: unknown, key: string, into: { nums: Carried[]; strs: string[] }, unit: string | null): void {
  if (QUOTE_KEY.test(key)) return;
  if (typeof value === 'number' && Number.isFinite(value)) into.nums.push({ value, unit });
  else if (typeof value === 'string') into.strs.push(value);
  else if (Array.isArray(value)) for (const v of value) carriedBy(v, key, into, unit);
  else if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const own = typeof o.unit === 'string' ? o.unit : null;
    for (const [k, v] of Object.entries(o)) carriedBy(v, k, into, own);
  }
}

const PERCENT_UNIT = /%|percent|pct|fraction|ratio|proportion/i;
const MONEY_UNIT = /£|\$|€|\bGBP\b|\bUSD\b|\bEUR\b|pound|dollar|euro/i;
/** The currency a carried unit names (null when it names none): compared with the written amount's `currencyCode`. */
const currencyOf = (unit: string | null): string | null => unit === null ? null
  : /£|\bGBP\b|pound/i.test(unit) ? 'GBP' : /\$|\bUSD\b|dollar/i.test(unit) ? 'USD' : /€|\bEUR\b|euro/i.test(unit) ? 'EUR' : null;
const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Whether ONE carried number evidences ONE written amount, by value AND by quantity kind (Codex CHANGES_REQUIRED on
 * #2263: `{ value: 4, unit: 'GBP' }` must not carry both "£4" and "4%"). `unit` = the carried unit says the same kind;
 * `bare` = no unit beside it, so it may stand for the amount but only once; null = not this amount.
 */
function evidences(c: Carried, a: { readonly magnitude: number; readonly kind?: unknown; readonly currencyCode?: string }): 'unit' | 'bare' | null {
  const money = c.unit !== null && MONEY_UNIT.test(c.unit);
  const percent = c.unit !== null && PERCENT_UNIT.test(c.unit);
  if (a.kind === 'percent') {
    if (money || !(sameNumber(c.value, a.magnitude) || sameNumber(c.value, a.magnitude / 100))) return null;
    return c.unit === null ? 'bare' : percent ? 'unit' : null;
  }
  if (!sameNumber(c.value, a.magnitude)) return null;
  if (c.unit === null) return 'bare';
  // Codex CR #2 on #2263: USD 4 never carries the user's £4 — the written amount's currency identity, not "some money".
  if (a.kind === 'currency') return money && !percent && (a.currencyCode === undefined || currencyOf(c.unit) === a.currencyCode) ? 'unit' : null;
  return money || percent ? null : 'unit';
}

/**
 * ⛔ A FIGURE THE USER WROTE THAT THE CALL DOES NOT CARRY IS SOMETHING ELSE TO ACKNOWLEDGE (served journey-A C3, real-role
 * replay 28 Sep, 15 served turns): "price sensitivity is very high, and we've seen our churn increase by 15% when we made
 * our last price increase. That was only £4." — the model called the link-strength proposal `whole_request: true` on
 * 11/15, and the reply composed from the result named the user's +15% / £4 on 4/15. Each figure the repo's one extractor
 * (`findStatedAmounts`) reads in the message needs its OWN evidence in the call: a carried number of the same quantity
 * kind (a percent may be carried as its fraction), each number standing for one figure only, or the figure's own text
 * in a non-quote argument. Otherwise the turn keeps its narrating call, for any model.
 */
export function userFiguresTheCallLeaves(args: unknown, userMessage: string): string[] {
  if (typeof userMessage !== 'string' || userMessage === '') return [];
  const c: { nums: Carried[]; strs: string[] } = { nums: [], strs: [] };
  carriedBy(args, '', c, null);
  const used = new Set<number>();
  // Codex CR #2 on #2263: text evidence is one-to-one too — each written occurrence consumes one occurrence of its text
  // (whole figures only: "£4" is not inside "£45"), so one "£4" in a label never carries two written "£4"s.
  const textUsed = new Map<string, number>();
  const occurrences = (s: string, text: string): number => {
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (s.match(new RegExp(`(?<![\\d.,])${esc}(?![\\d]|[.,]\\d)`, 'g')) ?? []).length;
  };
  const amounts = findStatedAmounts(userMessage);
  /**
   * ⛔ A UNITLESS VALUE THAT COULD BE TWO KINDS CARRIES NEITHER (AIQ meaning 5880894832, Codex CR #3 on #2263): with
   * "£4 and 4%" written, a bare `4` is £4 or 4%, so it is ambiguous. It evidences neither, and the turn narrates (asks)
   * rather than guessing which. A bare value whose written candidates share ONE kind and currency is not ambiguous.
   */
  const identity = (x: { kind?: unknown; currencyCode?: string }): string => `${String(x.kind)}|${x.currencyCode ?? ''}`;
  c.nums.forEach((n, i) => {
    if (n.unit !== null) return;
    const kinds = new Set(amounts.filter((x) => evidences(n, x as { magnitude: number; kind?: unknown; currencyCode?: string }) === 'bare')
      .map((x) => identity(x as { kind?: unknown; currencyCode?: string })));
    if (kinds.size > 1) used.add(i);
  });
  const left: string[] = [];
  for (const a of amounts) {
    const text = a.matchedText.trim();
    const amount = a as { magnitude: number; kind?: unknown; currencyCode?: string };
    const pick = (want: 'unit' | 'bare'): number => c.nums.findIndex((n, i) => !used.has(i) && evidences(n, amount) === want);
    const i = pick('unit') >= 0 ? pick('unit') : pick('bare');
    if (i >= 0) { used.add(i); continue; }
    const s = c.strs.findIndex((str, k) => occurrences(str, text) > (textUsed.get(`${k}|${text}`) ?? 0));
    if (s >= 0) { textUsed.set(`${s}|${text}`, (textUsed.get(`${s}|${text}`) ?? 0) + 1); continue; }
    left.push(text);
  }
  return left;
}

export function composeProposalReply(tool: string, args: unknown, result: unknown, userMessage: string): string | null {
  // The model's own typed word that this call is the WHOLE request: a message asking for two things never loses one.
  // RC3 (a′): a precondition composes unless the model said the call is NOT the whole request (Codex #2823 r1/r2).
  const precondition = tool === 'propose_new_risk' && recordOf(recordOf(recordOf(result)?.risk)?.relies_on) !== undefined;
  const whole = recordOf(args)?.whole_request;
  if (precondition ? whole === false : whole !== true) return null;
  if (typeof userMessage === 'string' && userMessage.includes('?')) return null;
  return composeRecoveredProposalReply(tool, args, result, userMessage);
}

/** Recovery drops conversational gates, but must not ignore or re-ask a figure the user already gave. */
export function composeRecoveredProposalReply(tool: string, args: unknown, result: unknown, userMessage: string): string | null {
  const r = recordOf(result);
  // event_risk.v1 slice 2a: this door deterministically carries these user words outside the LLM arguments.
  const likelihood = tool === 'propose_new_risk' ? recordOf(recordOf(r?.risk)?.likelihood) : undefined;
  // RC3 (a′): a precondition press names its option by label ("Raise Pro price to £59"); the stamp carries that label.
  const precondition = tool === 'propose_new_risk' ? recordOf(recordOf(r?.risk)?.relies_on) : undefined;
  const hasLikelihood = likelihood?.basis === 'user' && nonEmpty(likelihood.quote);
  const hasPrecondition = precondition !== undefined && nonEmpty(precondition.option_label);
  // A precondition's links were discarded by the host: their words can't count as carrying the user's figures (Codex #2823 r2).
  const kept = hasPrecondition ? { ...(recordOf(args) ?? {}), affects: [], caused_by: [] } : args;
  const carried = hasLikelihood || hasPrecondition ? {
    args: kept,
    ...(hasLikelihood ? { event_risk_statement: likelihood!.quote } : {}),
    ...(hasPrecondition ? { relies_on_option: precondition!.option_label } : {}),
  } : args;
  if (userFiguresTheCallLeaves(carried, userMessage).length > 0) return null;
  return composeHeldResultReply(tool, result);
}

/** ⭐ P44 (a) / Codex #2781 r5: typed held-result disclosures, independent of conversational gates. */
export function composeHeldResultReply(tool: string, result: unknown): string | null {
  const r = recordOf(result);
  if (r === undefined || r.ok !== true || r.mutated !== false || !nonEmpty(r.proposal_id)) return null;
  const allowed = tool === 'propose_new_option' ? NEW_OPTION_KEYS : tool === 'propose_link_strength' ? LINK_KEYS
    : tool === 'propose_link_strengths' ? LINK_SET_KEYS : tool === 'propose_new_risk' ? NEW_RISK_KEYS : tool === 'propose_new_factor' ? NEW_FACTOR_KEYS : tool === 'propose_option_interventions' ? OPTION_LEVELS_KEYS
      : tool === 'propose_goal_current_level' ? GOAL_LEVEL_KEYS : tool === 'propose_limit_change' ? LIMIT_CHANGE_KEYS : undefined;
  if (allowed === undefined || Object.keys(r).some((k) => !allowed.has(k))) return null;
  return tool === 'propose_new_option' ? newOptionReply(r) : tool === 'propose_new_risk' ? newRiskReply(r)
    : tool === 'propose_new_factor' ? newFactorReply(r)
    : tool === 'propose_option_interventions' ? optionLevelsReply(r) : tool === 'propose_goal_current_level' ? goalLevelReply(r)
      : tool === 'propose_limit_change' ? limitChangeReply(r) : tool === 'propose_link_strengths' ? linkSetReply(r) : linkStrengthReply(r);
}
