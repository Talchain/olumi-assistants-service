/** The stated effect and its open question survive until that same link is resolved. */
import { findLinkEffectAmounts } from './link-effect-figures.js';
import { linkEffectStatementNamesEndpoints, quoteSpansIn } from './stated-by-user.js';
import { randomUUID } from 'node:crypto';
import { computeSurvivingPriorPendings } from '../commit.js';
import { isPendingActionExpired, parsePendingAction, type PendingAction } from '../session/pending-action.js';
import { linkEffectTargetOf } from '../system-events/link-effect-edit.js';

export const LINK_EFFECT_TOOL = 'propose_link_effect';
export const LINK_EFFECT_CLARIFICATION_TURN_TTL = 6;
export const LINK_EFFECT_CLARIFICATION_WALL_TTL_MS = 24 * 60 * 60_000;
export { LINK_EFFECT_BEST_GUESS_QUESTION, linkEffectBestGuessQuestion } from './link-effect-question.js';
export type LinkEffectClarificationPending = PendingAction & {
  readonly action: Extract<PendingAction['action'], { kind: 'elicit_link_effect_clarification' }>;
};
export type LinkEffectClarificationAction = LinkEffectClarificationPending['action'];
export type LinkEffectClarificationLink = Pick<LinkEffectClarificationAction, 'from_id' | 'to_id'>;
type Rec = Record<string, unknown>;
const record = (value: unknown): Rec | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;
const records = (value: unknown): Rec[] => Array.isArray(value) ? value.map(record).filter((r): r is Rec => r !== undefined) : [];
const linkKey = (link: LinkEffectClarificationLink): string => JSON.stringify([link.from_id, link.to_id]);
const isAsk = (pending: PendingAction | null): pending is LinkEffectClarificationPending => pending?.action.kind === 'elicit_link_effect_clarification';

/** Legacy snapshots and their revised descendants share the original chip identity until materialised. */
export function linkEffectClarificationLineage(pending: LinkEffectClarificationPending): string {
  return pending.action.lineage_id ?? pending.chip_id;
}

/** A reading answer supplies units only, never any number in the stored statement. */
export function linkEffectResolvedReading(answer: string): 'points' | 'relative' | undefined {
  const reply = answer.trim().replace(/^(?:I mean|I meant|it['’]?s|that['’]?s)\s+/i, '').replace(/[.!]$/, '').trim();
  if (/^relative(?:\s+(?:change|increase|decrease))?$/i.test(reply)) return 'relative';
  if (/^(?:(?:one|a|1(?:\.0+)?)\s+)?(?:percentage\s+)?points?$/i.test(reply)
    || /^(?:absolute|percentage[-\s]point)(?:\s+(?:change|increase|decrease))?$/i.test(reply)) return 'points';
  return undefined;
}

/** State changes replace a revision without renewing the original clarification's lifetime. */
export function reviseLinkEffectClarification(
  pending: LinkEffectClarificationPending, action: LinkEffectClarificationAction, emittedAtIso: string,
): LinkEffectClarificationPending {
  const emittedMs = Math.max(Date.parse(emittedAtIso), Date.parse(pending.emitted_at_iso) + 1);
  if (!Number.isFinite(emittedMs)) throw new Error('Link-effect clarification revisions require an ISO timestamp.');
  const id = randomUUID();
  return { ...pending, id, chip_id: `agent-link-effect-clarification:${id}`,
    emitted_at_iso: new Date(emittedMs).toISOString(),
    action: { ...action, lineage_id: linkEffectClarificationLineage(pending) } };
}

/** A changed revision or a Run is not resolution; only the held link and its authorship decide. */
function sameUnresolvedLink(ask: LinkEffectClarificationPending, graph: unknown): boolean {
  const found = linkEffectTargetOf(graph, ask.action.from_id, ask.action.to_id);
  if (found.kind !== 'one') return false;
  const provenance = record(found.edge.provenance);
  return found.edge.provenance !== 'user_specified' && provenance?.source !== 'user_specified' && provenance?.magnitude !== 'user_stated';
}

/** Last-created wins for each exact link, independently of unrelated pending actions. */
function latestPerLink(asks: readonly LinkEffectClarificationPending[]): LinkEffectClarificationPending[] {
  const byLink = new Map<string, LinkEffectClarificationPending>();
  for (const ask of asks) {
    const key = linkKey(ask.action);
    const previous = byLink.get(key);
    if (previous === undefined || Date.parse(ask.emitted_at_iso) > Date.parse(previous.emitted_at_iso)) byLink.set(key, ask);
  }
  return [...byLink.values()];
}

export function liveLinkEffectClarifications(
  pending: readonly unknown[], scenarioId: string, graph: unknown, nowMs = Date.now(),
): LinkEffectClarificationPending[] {
  return latestPerLink(pending.map(parsePendingAction).filter((p): p is LinkEffectClarificationPending => isAsk(p)
    && p.scenario_id === scenarioId && !isPendingActionExpired(p, nowMs) && sameUnresolvedLink(p, graph)));
}

/** Arm only a tool-refused question whose stored source is an exact span of the person's text. */
export function linkEffectClarificationOnRefusal(input: {
  action: Omit<LinkEffectClarificationAction, 'kind'>; message: string; scenarioId: string; graph: unknown; emittedAtIso: string;
}): LinkEffectClarificationPending | null {
  if (quoteSpansIn(input.message, input.action.quote).length === 0
    || !linkEffectStatementNamesEndpoints(input.action.quote, { source: input.action.from_label, target: input.action.to_label })) return null;
  const emittedMs = Date.parse(input.emittedAtIso);
  if (!Number.isFinite(emittedMs)) return null;
  const id = randomUUID();
  const pending = parsePendingAction({
    id, scenario_id: input.scenarioId, chip_id: `agent-link-effect-clarification:${id}`,
    action: { kind: 'elicit_link_effect_clarification', ...input.action,
      // A capability may have selected a newer durable ask than the route's initial snapshot.
      lineage_id: input.action.lineage_id ?? id, source_text: input.action.source_text ?? input.message },
    // A Run can change the hash; only the endpoints and question are carried.
    preconditions: { target_entity_ids: [input.action.from_id, input.action.to_id] },
    expires_at_turn_count: LINK_EFFECT_CLARIFICATION_TURN_TTL, emitted_at_iso: input.emittedAtIso,
    expires_at_iso: new Date(emittedMs + LINK_EFFECT_CLARIFICATION_WALL_TTL_MS).toISOString(),
  });
  return isAsk(pending) && sameUnresolvedLink(pending, input.graph) ? pending : null;
}

/** The outer answer owns the one carry step, including Run/Explain and refused answers. */
export function linkEffectClarificationsForAnswerRow(input: {
  prior: readonly LinkEffectClarificationPending[]; next: readonly LinkEffectClarificationPending[];
  /** Production consumption names the ask lineage, so later independent asks on the same pair survive. */
  consumedLineages?: readonly string[];
  /** Legacy callers only; ignored when lineage consumption is supplied. */
  consumedLinks?: readonly LinkEffectClarificationLink[];
  graph: unknown; graphHash: string | undefined; nowMs: number; typedByUser: boolean;
}): LinkEffectClarificationPending[] {
  const consumed = new Set(input.consumedLineages ?? []);
  const legacyConsumedLinks = new Set(input.consumedLineages === undefined ? (input.consumedLinks ?? []).map(linkKey) : []);
  const wasConsumed = (ask: LinkEffectClarificationPending): boolean => consumed.has(linkEffectClarificationLineage(ask))
    || legacyConsumedLinks.has(linkKey(ask.action));
  const held = record(input.graph);
  const graphKnown = Array.isArray(held?.nodes) && Array.isArray(held?.edges);
  // A failed read cannot confirm deletion or resolution. Retain the words without granting an answer licence.
  const mayCarry = (ask: LinkEffectClarificationPending): boolean => !graphKnown || sameUnresolvedLink(ask, input.graph);
  const prior = latestPerLink(input.prior).filter(p => !isPendingActionExpired(p, input.nowMs) && mayCarry(p));
  const next = latestPerLink(input.next).filter(p => !isPendingActionExpired(p, input.nowMs) && sameUnresolvedLink(p, input.graph));
  const nextByLink = new Map(next.map(p => [linkKey(p.action), p]));
  const carried: LinkEffectClarificationPending[] = [];
  for (const old of prior) {
    const key = linkKey(old.action);
    if (wasConsumed(old)) continue;
    const arriving = nextByLink.get(key);
    const replacement = arriving !== undefined && Date.parse(arriving.emitted_at_iso) > Date.parse(old.emitted_at_iso) ? arriving : undefined;
    if (arriving !== undefined && replacement === undefined) nextByLink.delete(key);
    // Re-asking about the same stored statement changes the question, never resets its lifetime.
    if (replacement !== undefined && replacement.action.quote !== old.action.quote) continue;
    const candidate = { ...(replacement ?? old), expires_at_iso: old.expires_at_iso,
      expires_at_turn_count: old.expires_at_turn_count + (input.typedByUser ? 0 : 1) };
    const survivor = computeSurvivingPriorPendings([candidate], [], [], input.graphHash, input.nowMs)[0];
    if (isAsk(survivor ?? null) && mayCarry(survivor as LinkEffectClarificationPending)) {
      carried.push(survivor as LinkEffectClarificationPending);
    }
    nextByLink.delete(key);
  }
  for (const fresh of nextByLink.values()) if (!wasConsumed(fresh)) carried.push(fresh);
  return carried;
}

/** A short reading answer cannot select between several open links. */
export function linkEffectClarificationForReply(
  state: unknown, asks: readonly LinkEffectClarificationPending[], typedMessage: string | null, otherForcedPath = false,
): LinkEffectClarificationPending | null {
  if (otherForcedPath || typedMessage === null) return null;
  const canonical = record(state);
  if (canonical?.ok !== true) return null;
  const entities = records(canonical.entities);
  const heldLinks = records(canonical.links);
  const live = asks.filter(ask => {
    if (isPendingActionExpired(ask, Date.now())
      || !entities.some(e => e.id === ask.action.from_id && e.label === ask.action.from_label)
      || !entities.some(e => e.id === ask.action.to_id && e.label === ask.action.to_label)) return false;
    const links = heldLinks.filter(l => l.from === ask.action.from_id && l.to === ask.action.to_id);
    return links.length === 1 && links[0]!.sizing !== 'user' && links[0]!.source !== 'user_specified';
  });
  if (live.length !== 1) return null;
  const ask = live[0]!;
  const text = typedMessage.trim();
  if (linkEffectResolvedReading(text) !== undefined) return ask;
  // A best-guess reply must state a fresh figure. The capability and writer validate its terms.
  return (ask.action.resolved_reading !== undefined || ask.action.question.includes('best single guess'))
    && findLinkEffectAmounts(text).length > 0 ? ask : null;
}

/** No chips, approval or other forced routes enter this reply gate. */
export function linkEffectAnswerFirstCall(
  state: unknown, asks: readonly LinkEffectClarificationPending[], typedMessage: string | null, otherForcedPath: boolean,
): typeof LINK_EFFECT_TOOL | undefined {
  return linkEffectClarificationForReply(state, asks, typedMessage, otherForcedPath) === null ? undefined : LINK_EFFECT_TOOL;
}
