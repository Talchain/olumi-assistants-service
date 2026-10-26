/** Pure saved-work checks reused by explicit requested rebuilds. No automatic caller, store or writer. */
import { RETAINED_LIMIT_QUESTION, RETAINED_LIMIT_QUANTITY_QUESTION, unresolvedRetainedLimits, retainedLimitWithheldLine } from '../../../graph/retained-limit.js';
import { GOAL_RECORD_PRECEDENCE, readGoalRecord } from '../../goal-target/goal-record.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { constructionOperationId } from './build-model.js';
import { edgeReviewedByUser, edgeStrengthProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { linkDrawnByOf, nodeIntroductionOf, provenanceOf } from '../../../cee/provenance/provenance-of.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { resolveMagnitudeFrame } from '../../../cee/magnitude/link-effect.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import { canonicalLabel, TODAY_LEVEL, TODAY_UNIT } from '../model-primitives.js';
import { isDeepStrictEqual } from 'node:util';
import { sameUnitAsEarlier } from '../same-unit.js';
import { userStatementFor, userStatementsOn } from '../../statement-door/statements.js';
import { factorUnitOf } from '../unit-conflict.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';


type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec).filter((x): x is Rec => x !== undefined) : []);
const named = (n: Rec | undefined, fallback: string): string => (typeof n?.label === 'string' && n.label.trim() !== '' ? `‘${n.label.trim()}’` : fallback);

/** Node-existence stamps that name the user as the one who added it (`identity-proposal.ts` USER_NODE, less the brief's). */
const USER_ADDED_NODE = new Set(['user_set', 'user_specified', 'user_stated', 'user']);
const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
/**
 * ⛔ A PRESENT value with no stamp is UNKNOWN authority, not "nobody's" (AIE 0452 AMEND 1): a figure held without a
 * source may be a human edit through a writer that stamps nothing. The one exception is construction's own definition,
 * written unstamped on purpose: "today is 100 % of today" (`admit-model.ts` `framedObservedState`, `model-primitives.ts`).
 */
const holdsAValue = (os: Rec): boolean => finite(os.value) || finite(os.raw_value);
const isTodayDefinition = (os: Rec): boolean => os.unit === TODAY_UNIT && os.raw_value === TODAY_LEVEL;

/**
 * One later contribution G1 found: its plain words, whose it is, and what the revised draft must carry to keep it.
 * `carry` is absent where no carry keeps it: an unknown author, a target for the goal, the steady-horizon judgement. Those
 * still refuse a replacement (current-model caller, PL #94 07:32Z: "Keep the unreadable-ledger, human-goal-target and
 * steady-horizon refusals").
 */
export interface HumanItem {
  readonly words: string;
  readonly origin: 'human' | 'unknown';
  readonly carry?:
    | { readonly kind: 'value'; readonly node: Rec; readonly stamp?: string }
    | { readonly kind: 'level'; readonly option: Rec; readonly factor: Rec | undefined; readonly factor_id: string; readonly cell: unknown }
    | { readonly kind: 'link'; readonly edge: Rec; readonly from: Rec | undefined; readonly to: Rec | undefined }
    | { readonly kind: 'node'; readonly node: Rec };
}

/** G1 by item: {@link humanMaterialAfterTheDraft}'s words, each with its origin and what keeps it. */
export function humanItemsAfterTheDraft(raw: unknown, goalHandled = false): HumanItem[] {
  const g = rec(raw);
  const nodes = recs(g?.nodes);
  const byId = new Map(nodes.filter((n) => typeof n.id === 'string').map((n) => [n.id as string, n]));
  const found: HumanItem[] = [];
  const figureNodes = new Set<Rec>();
  const unknown = (words: string): void => { found.push({ words, origin: 'unknown' }); };
  for (const n of nodes) {
    if (goalHandled && n.kind === 'goal') continue;
    const os = rec(n.observed_state) ?? rec(rec(n.data)?.observed_state);
    if (os !== undefined) {
      const origin = provenanceOf({ value: os }).origin;
      const colleague = os.elicited_from !== undefined;
      const recordedWords = userStatementsOn(n).length > 0;
      if (rec(os.reviewed_by_user) !== undefined || (recordedWords && origin === 'ai')) {
        found.push({ words: `the recorded value and source for ${named(n, 'a factor')}`, origin: 'human',
          ...(colleague ? {} : { carry: { kind: 'value' as const, node: n } }) });
      } else if (origin === 'human') {
        found.push({ words: `your figure for ${named(n, 'a factor')}`, origin: 'human',
          ...(colleague ? {} : { carry: { kind: 'value' as const, node: n } }) });
        figureNodes.add(n);
      } else if (origin === 'unknown' && holdsAValue(os) && !isTodayDefinition(os)) {
        unknown(`a value for ${named(n, 'a factor')} whose author is not recorded`);
      }
    }
    // ⛔ The node stamp `user_set` has three writers: a part the user added (`structural-add.ts`), a part the user renamed
    // (`structural-rename.ts`) and a figure the user typed (`set-factor-value.ts`, buddy FAIL on #3032: the card said a
    // drafted part was "added"). A typed figure's `user_set` is its own item's (above); any other is a part the user added
    // or renamed.
    if (typeof n.provenance === 'string' && USER_ADDED_NODE.has(n.provenance) && !figureNodes.has(n)) {
      found.push({ words: `${named(n, 'a part of the model')}, which you added or renamed`, origin: 'human', carry: { kind: 'node', node: n } });
    }
    // Requested rebuilds restore each WHOLE saved option and each of its held quantities below.
    if (goalHandled && n.kind === 'option') continue;
    const levels = rec(n.interventions) ?? rec(rec(n.data)?.interventions);
    for (const [factorId, level] of Object.entries(levels ?? {})) {
      const origin = provenanceOf({ setting: level, target: byId.get(factorId) }).origin;
      if (origin === 'human' || origin === 'ai') {
        found.push({ words: `the saved setting for ${named(n, 'an option')} on ${named(byId.get(factorId), 'a factor')}`, origin: 'human',
          carry: { kind: 'level', option: n, factor: byId.get(factorId), factor_id: factorId, cell: level } });
      } else unknown(`a level for ${named(n, 'an option')} whose author is not recorded`);
    }
  }
  for (const e of recs(g?.edges)) {
    const link = `${named(byId.get(String(e.from)), 'a factor')} → ${named(byId.get(String(e.to)), 'a factor')}`;
    const carry = { kind: 'link' as const, edge: e, from: byId.get(String(e.from)), to: byId.get(String(e.to)) };
    const context = { fromKind: String(byId.get(String(e.from))?.kind ?? '') };
    const origin = provenanceOf({ link: e, context }).origin;
    if (edgeReviewedByUser(e) || userStatementsOn(e).length > 0 || linkSizing(e) === 'olumi_accepted' || edgeStrengthProvenance(e) === 'user_stated' || origin === 'human') {
      found.push({ words: `the saved relationship and source ${link}`, origin: 'human', carry });
    } else if (origin === 'unknown' && linkDrawnByOf(e, context).origin === 'unknown') unknown(`a link ${link} whose author is not recorded`);
  }
  return found;
}

/**
 * ⭐ WHAT THE USER SET IN THE SAVED MODEL IS CARRIED, BY IDENTITY, WITH ITS OWN STAMP AND ITS OWN MEANING (current-model
 * caller, PL #94 07:32Z Q3: "human-stamped items carry by identity from the saved authority, with full meaning. Missing or
 * incompatible → no offer"). Construction attests the user only from the brief, so a user edit the drafter reproduced from
 * the context would come back under the wrong author. Each item moves onto the revision's part of the same kind and label
 * (the lane's canonical label), and its MEANING is kept, never its encoded bytes.
 *
 * ⛔ A STORED FIGURE IS ENCODED ON ITS NODE'S RANGE (buddy FAIL on #3032: a level of £40,000 stored as 0.2 of a £200,000 range
 * read back as £20,000 on the revision's £100,000 range; a reviewed 1:1 link went to the engine as £2 per £1). So:
 *   · a value or an option's level is re-encoded from its NATURAL figure on the revision's range (`levelFrameOf`, the
 *     writer's own rule), and kept only when the revision's range reads it back as that same figure: the level writer's
 *     and the link sizer's ranges agree, on both models; the saved figure's two spellings agree; the units are the same;
 *     and the figure lies inside the revision's range, as the lane's writers require (`placeLevel` `out_of_range`, the
 *     value writer's floor and ceiling; buddy FAIL on #3032: £150,000 on a £100,000 range was analysed as £100,000). A
 *     range-less figure is kept only on a range-less revision, unchanged. The range's own fields (cap, declared scale,
 *     frame source, baseline) stay the revision's: the saved baseline was never the user's figure;
 *   · a link is carried only when both its ends keep the same magnitude range (`resolveMagnitudeFrame`), so its strength
 *     means the same natural size; a link cannot be re-sized here, so a moved range refuses;
 *   · a part the user added or renamed must be in the revision, and carries the user's own stamp onto it, but never onto
 *     a part holding a figure the user did not set (readers take a node's stamp as "whose number is this?",
 *     `format-graph-for-context.ts`, since deleted); a typed figure carries its own node stamp, as the value writer pairs them.
 * A user limit row is not carried: the stored graph cannot hold one (`GraphV3` limits are explicit / inferred / proxy), so
 * G1's limit item refuses, as before. MISSING (the part is absent) or INCOMPATIBLE (a unit or range that cannot hold the
 * same meaning) → the caller offers nothing and names the item. Nothing else in the candidate is changed.
 */
export function carryHumanItems(candidate: unknown, items: readonly HumanItem[],
  levelFrameOf: (node: Rec | undefined) => number | null): { replacement: Rec; carried: string[]; missing: string[] } {
  const replacement = structuredClone(rec(candidate) ?? {}) as Rec;
  const nodes = recs(replacement.nodes);
  const edges = recs(replacement.edges);
  const identity = (n: Rec | undefined): string | null => (n === undefined || typeof n.label !== 'string' || n.label.trim() === ''
    ? null : `${String(n.kind ?? '')}:${canonicalLabel(n.label)}`);
  const sameNode = (saved: Rec | undefined): Rec | undefined => {
    const key = identity(saved);
    return key === null ? undefined : nodes.find((n) => identity(n) === key);
  };
  const osOf = (n: Rec | undefined): Rec | undefined => rec(n?.observed_state) ?? rec(rec(n?.data)?.observed_state);
  const magnitudeFrame = (n: Rec | undefined): number | undefined =>
    (n === undefined ? undefined : resolveMagnitudeFrame({ ...(n as object), label: String(n.label ?? ''), option_levels: [] } as never));
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  /** The revision node's ONE range, or null when it has none; undefined when the writer's and the sizer's ranges disagree. */
  const rangeOf = (n: Rec): number | null | undefined => {
    const level = levelFrameOf(n);
    const sized = magnitudeFrame(n);
    return level !== null && sized !== undefined && !close(level, sized) ? undefined : level;
  };
  /** The saved figure's natural size and its range, or undefined when its range or its two spellings disagree. */
  const savedFigure = (cell: Rec | undefined, node: Rec | undefined): { natural: number; range: number | null; value: number } | undefined => {
    const value = cell?.value;
    if (node === undefined || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const range = rangeOf(node);
    if (range === undefined) return undefined;
    const raw = typeof cell!.raw_value === 'number' && Number.isFinite(cell!.raw_value) ? cell!.raw_value : undefined;
    if (range === null) return { natural: raw ?? value, range, value };
    if (raw !== undefined && !close(value * range, raw)) return undefined;
    return { natural: raw ?? value * range, range, value };
  };
  /** The saved figure on the revision's range: its encoded value, or undefined when that range cannot hold it as the same figure. */
  const encodeOn = (saved: { natural: number; range: number | null; value: number }, n: Rec): number | undefined => {
    const range = rangeOf(n);
    if (range === undefined) return undefined;
    if (range === null || saved.range === null) return range === null && saved.range === null ? saved.value : undefined;
    const value = saved.natural / range;
    return Number.isFinite(value) && value >= 0 && value <= 1 && close(value * range, saved.natural) ? value : undefined;
  };
  const unitOf = (u: unknown): string | undefined => (typeof u === 'string' && u.trim() !== '' ? u.trim() : undefined);
  const holdsAFigure = (n: Rec): boolean => { const os = osOf(n); return os !== undefined && holdsAValue(os); };
  const RANGE_FIELDS = ['cap', 'declared_scale', 'frame_source', 'baseline'] as const;
  const carried: string[] = [];
  const missing: string[] = [];
  for (const item of items) {
    const c = item.carry;
    if (item.origin !== 'human' || c === undefined) continue;
    if (c.kind === 'value') {
      const target = sameNode(c.node);
      const saved = osOf(c.node);
      const figure = savedFigure(saved, c.node);
      const own = osOf(target);
      const value = target === undefined || figure === undefined || unitOf(own?.unit) !== unitOf(saved?.unit) ? undefined : encodeOn(figure, target);
      if (target === undefined || saved === undefined || figure === undefined || value === undefined) { missing.push(item.words); continue; }
      // The user's figure and stamp; the revision's own range fields, so it reads back as theirs on the revision's range.
      const theirs: Rec = { ...saved };
      for (const k of RANGE_FIELDS) delete theirs[k];
      const ownRange: Rec = {};
      for (const k of RANGE_FIELDS) if (own?.[k] !== undefined) ownRange[k] = own[k];
      target.observed_state = { ...theirs, value, ...(figure.range === null ? {} : { raw_value: figure.natural }), ...ownRange };
      if (c.stamp !== undefined && c.node.provenance === c.stamp) target.provenance = c.stamp;
    } else if (c.kind === 'level') {
      const option = sameNode(c.option);
      const factor = sameNode(c.factor);
      const cell = rec(c.cell);
      const figure = savedFigure(cell, c.factor);
      const sameUnits = (unitOf(cell?.unit) ?? unitOf(osOf(c.factor)?.unit)) === unitOf(osOf(factor)?.unit);
      const value = factor === undefined || figure === undefined || !sameUnits ? undefined : encodeOn(figure, factor);
      if (option === undefined || factor === undefined || typeof factor.id !== 'string' || cell === undefined || figure === undefined || value === undefined) {
        missing.push(item.words);
        continue;
      }
      const match = rec(cell.target_match);
      option.interventions = { ...(rec(option.interventions) ?? {}), [factor.id]: { ...structuredClone(cell), value,
        ...(typeof cell.raw_value === 'number' ? { raw_value: figure.natural } : {}), ...(match !== undefined ? { target_match: { ...match, node_id: factor.id } } : {}) } };
    } else if (c.kind === 'link') {
      const from = sameNode(c.from);
      const to = sameNode(c.to);
      const kept = (saved: Rec | undefined, next: Rec | undefined): boolean => {
        const a = magnitudeFrame(saved);
        const b = magnitudeFrame(next);
        return a !== undefined && b !== undefined && close(a, b);
      };
      if (from === undefined || to === undefined || !kept(c.from, from) || !kept(c.to, to)) { missing.push(item.words); continue; }
      const edge = { ...structuredClone(c.edge), from: from.id, to: to.id };
      const at = edges.findIndex((e) => e.from === from.id && e.to === to.id);
      if (at >= 0) edges[at] = { ...edge, ...(typeof edges[at]!.id === 'string' ? { id: edges[at]!.id } : {}) };
      else edges.push(edge);
    } else if (c.kind === 'node') {
      const target = sameNode(c.node);
      if (target === undefined || holdsAFigure(target)) { missing.push(item.words); continue; }
      target.provenance = c.node.provenance;
    } else {
      missing.push(item.words);
      continue;
    }
    carried.push(item.words);
  }
  return { replacement: { ...replacement, nodes, edges }, carried, missing };
}

/** G2's count of later writes, or why the ledger cannot say (an incomplete read, or no record of the construction). */
export function laterWritesThan(ledger: CommittedTurnLedger, scenarioId: string, brief: string): number | string {
  if (!ledger.complete) return 'more saved history than this check reads';
  const construction = registrationTurnId(scenarioId, constructionOperationId(scenarioId, brief));
  if (!ledger.write_turn_ids.includes(construction)) return 'no saved record that this draft is the one built from your brief';
  return ledger.write_turn_ids.filter((id) => id !== construction).length;
}

/**
 * Complete history can disagree with the early-draft assumption without making its author unknown. These are card
 * warnings (DL/TL 16 Oct 03:58); an unreadable/incomplete record or missing conversation text is still a hard refusal.
 * At approval, exclude the correction's own answer row and require the exact earlier conversation the card bound.
 */
export function draftHistory(ledger: CommittedTurnLedger, scenarioId: string, brief: string, currentTurnId?: string,
  approval?: { readonly bound: readonly string[]; readonly goalTurnId: string }): {
    found: string[]; warnings: string[]; bound: string[]; messages: string[]; context: unknown; later: boolean;
  } {
  const found: string[] = [];
  const warnings: string[] = [];
  const turns = ledger.user_message_turn_ids.filter(id => id !== currentTurnId && id !== approval?.goalTurnId);
  const bound = turns.slice(1);
  const later = (ledger.later_user_messages ?? []).filter(m => bound.includes(m.turn_id));
  const messages = bound.flatMap(id => later.filter(m => m.turn_id === id).map(m => m.text));
  if (!ledger.complete) found.push('the saved history is incomplete, so Olumi cannot check all earlier work');
  if (bound.some(id => later.filter(m => m.turn_id === id && m.text.trim() !== '').length !== 1)) {
    found.push('some earlier conversation could not be read');
  }
  if (approval !== undefined && (bound.length !== approval.bound.length || bound.some((id, i) => id !== approval.bound[i]))) {
    found.push('the conversation changed after this card was offered; ask for an updated card');
  }
  if (ledger.complete) {
    const writes = laterWritesThan(ledger, scenarioId, brief);
    if (typeof writes === 'string') warnings.push('The saved history does not confirm the original construction of this draft.');
    else if (writes > 0) warnings.push('Your model has saved changes after the draft; check what this revision keeps and replaces.');
    if (turns.length === 0 || ledger.first_user_message !== brief.trim()) {
      found.push('the saved brief cannot be verified against the complete first message; it cannot be used as human source for a replacement');
    }
    if (bound.length > 0) warnings.push('There are later messages in this conversation; check that this revision reflects them.');
  }
  return { found, warnings, bound, messages, later: warnings.length > 0,
    context: [ledger.write_turn_ids, turns, ledger.first_user_message, later] };
}

/**
 * The revised draft's input: the stored brief, then each message the user TYPED after it (this turn's last), each verbatim
 * and in that order. Nothing else (no chip, assistant or unknown-origin text) is made part of what construction reads as
 * the user's words.
 */
export function revisedDraftBrief(storedBrief: string, typed: string | readonly string[]): string {
  return [storedBrief, ...(typeof typed === 'string' ? [typed] : typed)].map((t) => t.trim()).join('\n\n');
}

export interface HeldRow { readonly node_id: string; readonly operator: string; readonly value: number; readonly unit: string; readonly role?: 'goal_target' }
const rowsOf = (raw: unknown): Rec[] => recs(rec(raw)?.goal_constraints);
const goalIdsOf = (raw: unknown): Set<string> => new Set(recs(rec(raw)?.nodes)
  .filter((n) => n.kind === 'goal' && typeof n.id === 'string')
  .flatMap((n) => {
    const goal = readGoalRecord(raw, n.id as string);
    return goal === null ? [] : [goal.goal_id];
  }));
/** The quantity a row (or a target) is ON, by the lane's canonical label of its node (or the row's own label). */
const quantityOf = (raw: unknown, c: Rec): string | null => {
  const n = recs(rec(raw)?.nodes).find((x) => x.id === c.node_id);
  const label = typeof n?.label === 'string' ? n.label : typeof c.label === 'string' ? c.label : null;
  return label === null || label.trim() === '' ? null : canonicalLabel(label);
};
const numeric = (c: Rec): c is Rec & { value: number } => typeof c.value === 'number' && Number.isFinite(c.value);
const unitOf = (c: Rec): string => (typeof c.unit === 'string' ? c.unit.trim() : '');

/** The user's own verified sentences on a node that state `value`: the sentence (source line + quote; the quote is in its line) and its unit. */
const sentencesStating = (raw: unknown, nodeId: unknown, value: number): { key: string; unit: string }[] =>
  userStatementsOn(recs(rec(raw)?.nodes).find((n) => n.id === nodeId)).flatMap((r) => r.statements)
    .filter((s) => s.speaker === 'user' && s.quote.trim() !== '' && s.source.includes(s.quote) && (s.high === value || s.low === value))
    .map((s) => ({ key: `${s.source.trim()}\u0000${s.quote.trim()}`, unit: (s.unit ?? '').trim() }));
/** The same sentence, read in the same unit (a redraft's unstated base or period is the earlier reading's: `sameUnitAsEarlier`). */
const sameSentence = (earlier: readonly { key: string; unit: string }[], later: readonly { key: string; unit: string }[]): boolean =>
  later.some((l) => earlier.some((e) => e.key === l.key && (e.unit === l.unit || sameUnitAsEarlier(e.unit, l.unit))));

/**
 * The candidate with its node `from` given the saved node's identity: every reference to `from` by id (edges, option
 * interventions, rows) names the saved id, and the node takes the saved label and the saved record of the user's words. The
 * redraft's links and option settings on the quantity are kept; its row for the limit is replaced by the saved row (below).
 */
function asSavedNode(candidate: unknown, from: string, savedNode: Rec): Rec {
  const to = String(savedNode.id);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v === from ? to : v;
    if (Array.isArray(v)) return v.map(walk);
    const r = rec(v);
    return r === undefined ? v : Object.fromEntries(Object.entries(r).map(([k, x]) => [k === from ? to : k, walk(x)]));
  };
  const out = walk(candidate) as Rec;
  const { user_statements: _drafted, ...rest } = recs(out.nodes).find((n) => n.id === to) ?? {};
  out.nodes = recs(out.nodes).map((n) => (n.id === to ? { ...rest, label: savedNode.label,
    ...(savedNode.user_statements !== undefined ? { user_statements: structuredClone(savedNode.user_statements) } : {}) } : n));
  return out;
}

/**
 * Match quantity, stated comparator, figure and frame; the caller supplies the existing figure formatter to
 * recognise unit spelling. Never infer quantity equivalence from a shared figure. Unmatched rows are carried
 * verbatim, together with their node if absent. The result is prepared before the card and its hash are built.
 * A conflicting node/row identity cannot safely carry an unchanged row and is reported, never overwritten.
 */
export function limitsKeptBy(base: unknown, drafted: unknown, figure = (value: number, unit: string) => `${value} ${unit}`) {
  const limitIn = (raw: unknown) => {
    const goals = goalIdsOf(raw);
    // An outcome's target is not the governing goal's own target. Carry it too, with its role/source/conditions intact;
    // ignoring it in the qualitative-goal gate must never silently delete it from the proposed replacement.
    return (c: Rec): boolean => !goals.has(String(c.node_id))
      && numeric(c) && ['<=', '>=', '<', '>'].includes(String(c.operator)) && c.deadline_metadata == null;
  };
  const limitsOf = (raw: unknown) => rowsOf(raw).filter(limitIn(raw));
  const rowOf = (c: Rec): HeldRow => ({ node_id: String(c.node_id), operator: String(c.operator_as_stated ?? c.operator),
    value: c.value as number, unit: unitOf(c), ...(c.role === 'goal_target' ? { role: 'goal_target' as const } : {}) });
  /**
   * ⭐ THE SAME SENTENCE OF THE USER'S IS THE SAME LIMIT (DL 15 Oct 07:03Z; served widen4/widen3 on 87d5f90e): a redraft that
   * names a saved limit afresh ("Founder time on launch marketing" for the saved "Founder time on campaign") while citing the
   * SAME verified sentence of the user's (same quote and source line, read in the same unit), with the same comparator, figure
   * and frame and the same row unit through the unit reader, holds the saved limit: its id and bindings are kept, and nothing is
   * asked. Exactly one row must match. A limit from a different sentence, a unit both state differently, or a saved limit with
   * no recorded sentence of the user's takes the paths below (it asks).
   */
  let candidate: unknown = drafted;
  /** The redraft's row for a same-sentence limit (by its constraint id) → the saved row that replaces it. */
  const savedRowFor = new Map<unknown, Rec>();
  const savedIds = new Set(limitsOf(base).map((c) => c.constraint_id));
  for (const c of limitsOf(base)) {
    const savedNode = recs(rec(base)?.nodes).find((n) => n.id === c.node_id);
    if (savedNode === undefined || limitsOf(candidate).some((t) => t.constraint_id === c.constraint_id)
      || recs(rec(candidate)?.nodes).some((n) => n.id === c.node_id)) continue;
    const row = rowOf(c);
    const said = sentencesStating(base, c.node_id, row.value);
    const same = limitsOf(candidate).filter((t) => !savedIds.has(t.constraint_id) && !savedRowFor.has(t.constraint_id)
      && (t.role === 'goal_target') === (c.role === 'goal_target')
      && String(t.operator_as_stated ?? t.operator) === row.operator && t.value === row.value
      && (t.value_frame ?? 'level') === (c.value_frame ?? 'level') && (unitOf(t) === row.unit || sameUnitAsEarlier(row.unit, unitOf(t)))
      && sameSentence(said, sentencesStating(candidate, t.node_id, row.value)));
    if (same.length !== 1) continue;
    candidate = asSavedNode(candidate, String(same[0]!.node_id), savedNode);
    savedRowFor.set(same[0]!.constraint_id, c);
  }
  // Excluded historical subjects keep their saved rows, including absence after a goal reframe.
  // Reuse this row assembly: a stale draft cannot revive an earlier aim as an active target.
  const excludedIds = new Set(recs(rec(base)?.nodes).filter(n => n.analysis_participation === 'retained_excluded').map(n => n.id));
  const rows = [...rowsOf(candidate).filter(r => !excludedIds.has(r.node_id)),
    ...rowsOf(base).filter(r => excludedIds.has(r.node_id)).map(r => structuredClone(r))]
    .map((r) => (savedRowFor.has(r.constraint_id) ? structuredClone(savedRowFor.get(r.constraint_id)!) : r));
  const theirs = rows.filter(limitIn(candidate));
  const kept: HeldRow[] = [];
  const dropped: HeldRow[] = [];
  const carried: HeldRow[] = [];
  const uncertain: { previous: HeldRow; proposed: HeldRow[] }[] = [];
  const nodes = [...recs(rec(candidate)?.nodes)];
  /** The rows carried from the earlier draft, by identity: they keep their own origin (`targetsStoredInferred`). */
  const carriedRows = new Set<Rec>();
  let conflict = false;
  /** The earlier limits a conflicting identity stops from being carried (named on the refusal, never overwritten). */
  const conflicts: HeldRow[] = [];
  for (const c of limitsOf(base)) {
    const row = rowOf(c);
    const quantity = quantityOf(base, c);
    const sameFigure = (t: Rec) => String(t.operator_as_stated ?? t.operator) === row.operator
      && (t.role === 'goal_target') === (c.role === 'goal_target')
      && t.value === row.value && figure(row.value, unitOf(t)) === figure(row.value, row.unit)
      && (t.value_frame ?? 'level') === (c.value_frame ?? 'level');
    if (theirs.some((t) => quantity !== null && quantityOf(candidate, t) === quantity && sameFigure(t))) {
      kept.push(row);
      continue;
    }
    /**
     * ⛔ THE SAME ROW, RE-SPELLED (served marketing-2992 13 Oct: `GBP/year` → `£`; served cohort witness 15 Oct on c1e944a4:
     * `% of founder time` → `%`, cee_drafter_raw_responses 0d12d9ca): the redraft wrote the SAME constraint id in a unit
     * that leaves a part unstated, so it was neither kept (`sameFigure` compares spellings) nor carriable (the id collides)
     * and the whole card was refused. That row is carried UNCHANGED, the earlier row replacing the candidate's, only when
     * the identity, the quantity, the stated comparator, the value and the frame are the same and the units name the same
     * quantity through the unit reader once the redraft's unstated base or period is read as the earlier unit's
     * (`sameUnitAsEarlier`). Any part both state that differs still refuses, as does any other same-id difference.
     */
    const sameId = theirs.find((t) => t.constraint_id === c.constraint_id);
    if (sameId !== undefined && quantity !== null && quantityOf(candidate, sameId) === quantity
      && (sameId.role === 'goal_target') === (c.role === 'goal_target')
      && String(sameId.operator_as_stated ?? sameId.operator) === row.operator && sameId.value === row.value
      && (sameId.value_frame ?? 'level') === (c.value_frame ?? 'level')
      && sameUnitAsEarlier(row.unit, unitOf(sameId))) {
      const respelled = structuredClone(c);
      rows[rows.indexOf(sameId)] = respelled;
      carriedRows.add(respelled);
      kept.push(row);
      continue;
    }
    dropped.push(row);
    const proposedRows = theirs.filter(sameFigure);
    const proposed = proposedRows.map(rowOf);
    if (proposed.length > 0) uncertain.push({ previous: row, proposed });
    else carried.push(row);
    const node = recs(rec(base)?.nodes).find((n) => n.id === c.node_id);
    const existing = nodes.find((n) => n.id === c.node_id);
    if (node === undefined || (existing !== undefined && quantityOf(candidate, c) !== quantity)
      || rows.some((r) => r.constraint_id === c.constraint_id)) {
      conflict = true;
      conflicts.push(row);
      continue;
    }
    if (existing === undefined) nodes.push(structuredClone(node));
    const marker = { state: 'unscored', reason: 'retained_limit_equivalence_unresolved',
      previous_constraint_id: c.constraint_id, proposed_constraint_ids: proposedRows.map((r) => r.constraint_id),
      question: RETAINED_LIMIT_QUESTION };
    const carriedRow: Rec = { ...structuredClone(c), ...(proposedRows.length > 0
      ? { retained_unresolved_limit: { ...marker, role: 'original' } }
      : existing === undefined ? { retained_unresolved_limit: { ...marker, role: 'original',
        reason: 'retained_limit_quantity_unresolved', question: RETAINED_LIMIT_QUANTITY_QUESTION } } : {}) };
    rows.push(carriedRow);
    carriedRows.add(carriedRow);
    // An isolated proposed interpretation is retained for this SAME unanswered question, not made a causal factor.
    // Connected proposed quantities remain independently modelled; only the isolated question carrier is unscored.
    for (const proposedRow of proposedRows) {
      const linked = recs(rec(candidate)?.edges).some((e) => e.from === proposedRow.node_id || e.to === proposedRow.node_id);
      const set = [...nodes, ...recs(rec(candidate)?.options)].some((n) =>
        Object.prototype.hasOwnProperty.call(rec(n.interventions) ?? {}, String(proposedRow.node_id)));
      if (!linked && !set) {
        const index = rows.indexOf(proposedRow);
        rows[index] = { ...proposedRow, retained_unresolved_limit: { ...marker, role: 'proposed' } };
      }
    }
  }
  // The revised draft's own targets are stored `inferred` (`targetsStoredInferred`); its carried limits keep their origin.
  const replacement = { ...rec(candidate), nodes: goalTargetStampsInferred(nodes, candidate),
    goal_constraints: targetsStoredInferred(rows, candidate, carriedRows) };
  // The card's limits are the candidate's own rows as they stand after the carry (a re-spelled row says its earlier unit).
  const candidateLimitIds = new Set(theirs.map((t) => t.constraint_id));
  return { kept, dropped, carried, uncertain, conflict, conflicts, limits: limitsOf(replacement).filter((r) => candidateLimitIds.has(r.constraint_id)).map(rowOf),
    ...(unresolvedRetainedLimits(replacement).length > 0 ? { withheld: retainedLimitWithheldLine(replacement) } : {}), replacement };
}

/**
 * ⭐ APPROVING AN AI REINTERPRETATION IS NOT AUTHORSHIP (Codex CHECK-3020-45e7c1e3 item 2; DL #3020 r2 (a), 14 Oct): the
 * revised draft's drafter re-reads the user's goal, and its `explicit` on a target is its own claim. Relabelled ‘Partner
 * sign-ups’, Paul's "20 new customers" was stored `explicit` on another entity. So every target row the candidate holds (each
 * `goal_target` row and the goal's own row, the rows `targetsHeldBy` reads, in any frame) is stored `inferred` until a
 * verifier proves the user's own words state it. The rows carried from the earlier draft are limits (`limitsKeptBy`) and keep
 * their origin, as do carried targets on other outcomes; the user's typed goal stays the source on the operation.
 * Applied to the replacement `limitsKeptBy` returns.
 */
function targetsStoredInferred(rows: readonly Rec[], candidate: unknown, carried: ReadonlySet<Rec>): Rec[] {
  const goals = goalIdsOf(candidate);
  return rows.map((c) => (!carried.has(c) && (c.role === 'goal_target' || goals.has(String(c.node_id))) && c.provenance === 'explicit'
    ? { ...c, provenance: 'inferred' } : c));
}

/**
 * The same rule on the candidate's GOAL node (#3020 r2 buddy): its target source (the goal record's `source` field) is the host's
 * attestation that the brief wrote the drafter's figure (`holdStatedGoalAttributes`), which checks the figure, never which
 * quantity it is on, so "20 new customers" attested a goal relabelled ‘Partner sign-ups’. Any source but a definitional one is
 * removed (not attested, as when nothing grounds it); a definitional one is not authorship and is kept. The goal's figure,
 * comparator and period stay, so the Run reads the same target. Carried nodes are the earlier draft's limit nodes, never a goal.
 */
function goalTargetStampsInferred(nodes: readonly Rec[], candidate: unknown): Rec[] {
  const goals = goalIdsOf(candidate);
  const [field] = GOAL_RECORD_PRECEDENCE.source;
  return nodes.map((n) => {
    if (!goals.has(String(n.id)) || n[field] === undefined || n[field] === 'definitional') return n;
    const { [field]: _userSource, ...rest } = n;
    return rest;
  });
}

/** The candidate's targets for the goal: each `goal_target` row and the goal's own row, with the comparator as stated. */
export function targetsHeldBy(candidate: unknown): { node_id: string; quantity: string | null; comparator: string; value: number; unit: string }[] {
  const goals = goalIdsOf(candidate);
  return rowsOf(candidate)
    .filter((c) => numeric(c) && (c.role === 'goal_target' || goals.has(String(c.node_id))) && c.deadline_metadata == null
      && (c.value_frame === undefined || c.value_frame === 'level'))
    .map((c) => ({ node_id: String(c.node_id), quantity: quantityOf(candidate, c), comparator: String(c.operator_as_stated ?? c.operator), value: c.value as number, unit: unitOf(c) }));
}

export { approvedGraphHeld } from '../../model-program-turn/saved-read.js';

export type RebuildMissingKind = 'saved_option' | 'option_setting' | 'recorded_reasoning' | 'goal_target' | 'goal_frame' | 'limit' | 'human_item' | 'goal_contract';

/** Prepare a complete replacement without discarding the saved goal, options or recorded human work. Pure. */
export function prepareRequestedRebuild(base: unknown, drafted: unknown,
  levelFrameOf: (node: Rec | undefined) => number | null, unadoptedOptionIds: readonly string[] = []): {
    candidate?: Rec; kept: string[]; retired: string[]; adoption_unknown: string[]; missing: string[]; missing_kind?: RebuildMissingKind;
  } {
  const before = rec(base), draft = rec(drafted);
  const missing = (why: string, missing_kind: RebuildMissingKind = 'goal_contract') => ({ kept: [], retired: [], adoption_unknown: [], missing: [why], missing_kind });
  if (!before || !draft) return missing('the complete saved model');
  const oldNodes = recs(before.nodes), newNodes = recs(draft.nodes);
  if ([oldNodes, newNodes].some(nodes => nodes.some(n => typeof n.id !== 'string')
    || new Set(nodes.map(n => n.id)).size !== nodes.length)) return missing('unambiguous saved and replacement identities', 'recorded_reasoning');
  const oldGoal = oldNodes.filter(n => n.kind === 'goal'), newGoal = newNodes.filter(n => n.kind === 'goal');
  if (oldGoal.length !== 1 || newGoal.length !== 1) return missing('one current governing goal');
  const old = oldGoal[0]!, next = newGoal[0]!;
  if (canonicalLabel(String(old.label)) !== canonicalLabel(String(next.label))) return missing('the saved governing outcome; use the existing goal-change card before rebuilding');
  const meaning = (g: unknown, id: string) => {
    const r = readGoalRecord(g, id);
    return r === null ? null : { label: canonicalLabel(r.label), target: r.target === null ? null
      : { raw: r.target.raw, unit: r.target.unit, comparator: r.target.comparator, frame: r.target.frame },
      horizon: r.horizon === null ? null : { deadline: r.horizon.deadline, months: r.horizon.months }, period: r.period };
  };
  const savedMeaning = meaning(before, String(old.id)), proposedMeaning = meaning(draft, String(next.id));
  if (savedMeaning === null || proposedMeaning === null || (proposedMeaning.target !== null && !isDeepStrictEqual(savedMeaning.target, proposedMeaning.target))) return missing('the saved goal’s target or measurement; use its existing correction card first', 'goal_target');
  // Construction does not author a saved deadline/approved timing judgement. Restore the WHOLE old goal below,
  // rather than requiring the drafter to recreate a server-owned proof or re-author its human source.
  if (levelFrameOf(old) !== levelFrameOf(next)) return missing('the saved goal’s numerical frame', 'goal_frame');
  const matches = (n: Rec, nodes: Rec[]) => nodes.filter(x => x.kind === n.kind && canonicalLabel(String(x.label)) === canonicalLabel(String(n.label)));
  let candidate: Rec = { ...structuredClone(before), ...structuredClone(draft) };
  const kept: string[] = [], retired: string[] = [], adoptionUnknown: string[] = [];
  const unadopted = new Set(unadoptedOptionIds);
  const protectedIds = new Set(oldNodes.filter(n => n.kind === 'option' && !unadopted.has(String(n.id))).map(n => String(n.id)));
  for (const row of recs(before.goal_constraints)) protectedIds.add(String(row.node_id));
  const protectedEdges = recs(before.edges).filter(e => {
    const from = oldNodes.find(n => n.id === e.from);
    const to = oldNodes.find(n => n.id === e.to);
    const p = provenanceOf({ link: e, context: { fromKind: String(from?.kind ?? '') } });
    const recorded = ['relation', 'effect'].some(field => userStatementFor(before,
      { kind: 'link', id: String(e.from), to_id: String(e.to), field: field as 'relation' | 'effect' }) !== undefined);
    return (from?.kind === 'option' && !unadopted.has(String(from.id))) || (to?.kind === 'option' && !unadopted.has(String(to.id))) || recorded
      || p.origin !== 'ai' || p.accepted || edgeReviewedByUser(e) || userStatementsOn(e).length > 0;
  });
  for (const e of protectedEdges) { protectedIds.add(String(e.from)); protectedIds.add(String(e.to)); }
  const copyAbsent = (n: Rec): boolean => {
    if (recs(candidate.nodes).some(x => x.id === n.id)) return false;
    candidate.nodes = [...recs(candidate.nodes), structuredClone(n)]; return true;
  };
  const mayLeaveOut = (n: Rec): boolean => {
    const introduction = nodeIntroductionOf(n);
    return unadopted.has(String(n.id)) && n.kind === 'option' && introduction.origin === 'olumi_added'
      && !introduction.adopted && n.analysis_participation === 'retained_excluded'
      && !protectedIds.has(String(n.id)) && userStatementsOn(n).length === 0 && n.reviewed_by_user === undefined
      && Object.keys(mergeInterventionSourceObjects(n as never)).length === 0;
  };
  for (const option of oldNodes.filter(n => n.kind === 'option')) {
    const found = matches(option, recs(candidate.nodes));
    if (found.length === 0 && mayLeaveOut(option)) continue;
    // Restoring a whole saved option must not silently erase the draft's setting on an unidentified different quantity.
    if (found.length === 1 && Object.keys(mergeInterventionSourceObjects(found[0] as never)).some(id => {
      const quantity = recs(candidate.nodes).find(n => n.id === id);
      return quantity === undefined || matches(quantity, oldNodes).length !== 1;
    })) return missing(`the saved quantity and setting on “${String(option.label)}” without substituting an unidentified different quantity`, 'option_setting');
    if (found.length > 1 || (found.length === 0 && !copyAbsent(option))) return missing(`the identity of saved option “${String(option.label)}”`, 'saved_option');
    if (found.length === 0) kept.push(`the complete saved option “${String(option.label)}”`);
  }
  // Factor, outcome and risk are one quantity family: redrafting may change kind as well as label.
  // Other kinds retain same-kind protection; carrying either absent node beside its possible relabel leaves identity unresolved.
  const quantityKinds = new Set(['factor', 'outcome', 'risk']);
  for (const saved of oldNodes.filter(n => n.kind !== 'option' && matches(n, newNodes).length === 0)) {
    const neighbours = new Set(recs(before.edges).flatMap(e => e.from === saved.id ? [e.to] : e.to === saved.id ? [e.from] : []));
    const possible = newNodes.find(added => (quantityKinds.has(String(saved.kind)) ? quantityKinds.has(String(added.kind)) : added.kind === saved.kind)
      && matches(added, oldNodes).length === 0
      && recs(draft.edges).some(e => {
        const id = e.from === added.id ? e.to : e.to === added.id ? e.from : undefined;
        const neighbour = newNodes.find(n => n.id === id);
        return neighbour !== undefined && matches(neighbour, oldNodes).some(n => neighbours.has(n.id));
      }));
    if (possible !== undefined) return missing(`the distinct identities of saved “${String(saved.label)}” and proposed “${String(possible.label)}”`, 'recorded_reasoning');
  }
  for (const option of oldNodes.filter(n => n.kind === 'option')) {
    for (const id of Object.keys(mergeInterventionSourceObjects(option as never))) {
      const saved = oldNodes.find(n => n.id === id);
      if (saved && matches(saved, recs(candidate.nodes)).length === 0 && !copyAbsent(saved)) return missing(`the identity of the saved quantity on “${String(option.label)}”`, 'option_setting');
      const found = saved && matches(saved, recs(candidate.nodes));
      if (!saved || !found || found.length !== 1 || levelFrameOf(saved) !== levelFrameOf(found[0])
        || !isDeepStrictEqual(rec(saved.observed_state)?.unit, rec(found[0]!.observed_state)?.unit)) return missing(`the saved quantity and setting on “${String(option.label)}”`, 'option_setting');
      protectedIds.add(id);
    }
  }
  // Reuse the existing stable-identity carry; no constructor/store/second writer is introduced.
  for (const n of oldNodes) {
    const found = matches(n, recs(candidate.nodes));
    if (found.length > 1 || (found.length === 1 && found[0]!.id !== n.id && recs(candidate.nodes).some(x => x.id === n.id))) {
      return missing(`the unambiguous saved identity of “${String(n.label)}” without overwriting another part`, 'recorded_reasoning');
    }
    if (found.length === 1 && !mayLeaveOut(n)) {
      const oldUnit = factorUnitOf(before, n), newUnit = factorUnitOf(candidate, found[0]);
      if (levelFrameOf(n) !== levelFrameOf(found[0]) || (oldUnit !== undefined && newUnit !== undefined && !sameUnitAsEarlier(oldUnit, newUnit))) {
        return missing(`the saved numerical frame and measurement for “${String(n.label)}”`, 'human_item');
      }
    }
    if (found.length === 1) candidate = asSavedNode(candidate, String(found[0]!.id), n);
    else if (mayLeaveOut(n)) retired.push(String(n.label));
    else if (!copyAbsent(n)) return missing(`the recorded identity and reasoning for “${String(n.label)}”`, 'recorded_reasoning');
    else kept.push(`the complete saved reasoning for “${String(n.label)}”`);
  }
  for (const option of oldNodes.filter(n => n.kind === 'option')) {
    if (matches(option, newNodes).length === 0) continue;
    const aligned = recs(candidate.nodes).find(n => n.id === option.id);
    for (const [id, oldCell] of Object.entries(mergeInterventionSourceObjects(option as never))) {
      const saved = oldNodes.find(n => n.id === id), p = provenanceOf({ setting: oldCell, target: saved });
      const draftCell = mergeInterventionSourceObjects(aligned as never)[id];
      // An Olumi cell can keep the same source after approval. Unknown adoption is carried, never guessed from origin.
      if (p.origin === 'ai' && !p.structural && !p.accepted && !nodeIntroductionOf(option).adopted) {
        adoptionUnknown.push(`the saved setting on “${String(option.label)}” for “${String(saved?.label ?? id)}”`);
      }
      if (p.origin === 'unknown' && !isDeepStrictEqual(oldCell, draftCell)) kept.push(`the source-unverified setting on “${String(option.label)}”`);
    }
  }
  const limits = limitsKeptBy(before, candidate);
  if (limits.conflict) return missing('a saved limit or target', 'limit');
  candidate = limits.replacement;
  candidate.nodes = recs(candidate.nodes).map(n => {
    const saved = oldNodes.find(p => p.id === n.id);
    if (!saved) return n;
    if (saved.proposed_by === 'olumi' && !nodeIntroductionOf(saved).adopted && !mayLeaveOut(saved)
      && userStatementsOn(saved).length === 0) adoptionUnknown.push(`“${String(saved.label)}”`);
    // Whole records retain sources, speakers, qualifications, ranges, evidence and uncertainty without re-authorship.
    // A retained suggestion cannot silently become active just because the drafter reproduced it.
    return mayLeaveOut(saved) ? { ...n, analysis_participation: saved.analysis_participation } : structuredClone(saved);
  });
  const edges = recs(candidate.edges), nodeIds = new Set(recs(candidate.nodes).map(n => n.id));
  for (const e of recs(before.edges)) {
    const absent = [e.from, e.to].filter(id => !nodeIds.has(id));
    if (absent.length > 0) {
      // Only the positively evidenced retired option may take its own incident links out of this candidate.
      if (absent.every(id => oldNodes.some(n => n.id === id && mayLeaveOut(n)))) continue;
      return missing('both ends of a saved relationship', 'recorded_reasoning');
    }
    const at = edges.findIndex(x => x.from === e.from && x.to === e.to);
    if (at < 0 || !isDeepStrictEqual(edges[at], e)) {
      const from = oldNodes.find(n => n.id === e.from), to = oldNodes.find(n => n.id === e.to);
      const p = provenanceOf({ link: e, context: { fromKind: String(from?.kind ?? '') } });
      const source = p.origin === 'ai' ? p.accepted ? 'accepted Olumi estimate' : 'Olumi’s estimate; adoption not recorded'
        : p.origin === 'human' ? 'recorded human source' : 'source not verified';
      kept.push(`the saved relationship “${String(from?.label)}” → “${String(to?.label)}” (${source})`);
    }
    if (at < 0) edges.push(structuredClone(e)); else edges[at] = structuredClone(e);
  }
  candidate.edges = edges;
  // The draft cannot overwrite existing scenario-level reasoning metadata either.
  for (const [key, value] of Object.entries(before)) if (!['nodes', 'edges', 'goal_constraints', 'ref_high_water'].includes(key)) candidate[key] = structuredClone(value);
  const items = humanItemsAfterTheDraft(before, true);
  // Unknown authorship stays unknown on the exact saved record; retaining it is not a human-source claim.
  const carried = carryHumanItems(candidate, items, levelFrameOf);
  if (carried.missing.length) return { kept: [], retired: [], adoption_unknown: [], missing: carried.missing, missing_kind: 'human_item' };
  candidate = carried.replacement;
  if (!isDeepStrictEqual(readGoalRecord(before, String(old.id)), readGoalRecord(candidate, String(old.id)))) return missing('the complete saved goal contract');
  return { candidate, kept: [...kept, ...carried.carried, ...limits.carried.map(r => `the saved bound on ${String(r.node_id)}`)],
    retired, adoption_unknown: [...new Set(adoptionUnknown)], missing: [] };
}
