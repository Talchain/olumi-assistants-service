/**
 * ⭐ S2 CONFIRM, ONE PRESS (DL 20:09Z 14 Oct; SCIENCE's pricing e2e on served CEE 2a35ff31, turn 02 "Run analysis"): the Run's
 * identity ask said "Is your £49 per subscriber per month today's ‘Pro plan price’?" as free text, and the only button was
 * "Explain this result". The Run press's interpreter cannot call a tool after the Run, so #3113's confirm card never existed.
 * The route issues it here when the Agent did not (the identity card's precedent, `identityCardToIssue`): the SAME
 * `propose_assumptions` confirm, once, quoting the ONE sentence of the brief that states the held figure. It writes nothing:
 * the button is the only way to a yes, and the card's own door (`verifyStatements`) still checks the quote as the user's.
 */
import { identityPartsWithoutLevel } from '../system-events/identity-confirm-edit.js';
import { proposeProductIdentity } from './identity-proposal.js';
import { findLinkEffectAmounts } from './link-effect-figures.js';
import { sentenceAround } from './unplaced-goal-level.js';
import { alreadyTrueQuoteOf, riskOccurrenceSubject } from './risk-occurrence.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The parts each held identity names, and the reading's, as the identity asks read them. */
function identityPartIds(graph: Rec): string[] {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const declared = nodes.flatMap((n) => (isRec(n.nonlinear_identity) && Array.isArray(n.nonlinear_identity.factor_ids)
    ? n.nonlinear_identity.factor_ids.filter((id): id is string => typeof id === 'string') : []));
  return [...new Set([...declared, ...(proposeProductIdentity(graph)?.factor_ids ?? [])])];
}

/**
 * The confirm card's arguments for every part the Run's identity ask CONFIRMS (`identityPartsWithoutLevel`'s `held`: the
 * user's own figure, role unverified) whose figure exactly ONE sentence of the brief states. Any doubt (no brief, no stored
 * figure, no sentence, or two) prepares nothing for that part, and the ask stays as it is.
 */
export function heldFigureConfirmArgs(graph: unknown, brief: string | null | undefined, askSaid: string):
  { readonly assumptions: readonly Rec[] } | undefined {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || typeof brief !== 'string' || brief.trim() === '') return undefined;
  const assumptions = identityPartsWithoutLevel(graph, identityPartIds(graph)).flatMap((part) => {
    if (part.held === undefined || !askSaid.includes(`‘${part.label}’`)) return [];
    const node = (graph.nodes as unknown[]).find((n): n is Rec => isRec(n) && n.id === part.id);
    const os = isRec(node?.observed_state) ? node.observed_state : undefined;
    const figure = typeof os?.raw_value === 'number' && Number.isFinite(os.raw_value) ? os.raw_value : undefined;
    if (figure === undefined) return [];
    const sentences = [...new Set(findLinkEffectAmounts(brief).filter((a) => a.magnitude === figure)
      .map((a) => sentenceAround(brief, a.index, a.index + a.matchedText.length).trim()))];
    if (sentences.length !== 1) return [];
    return [{ factor_label: part.label, value: figure, unit: typeof os?.unit === 'string' ? os.unit : '', user_stated: true, basis: '',
      statements: [{ quote: sentences[0]!, form: 'point', value: figure }] }];
  });
  return assumptions.length > 0 ? { assumptions } : undefined;
}

/**
 * Issue the confirm card when THIS turn's Run said an identity ask (`identity_ask_say`) and the turn proposed, approved and
 * changed nothing, with no held card waiting: then the card is the ask's one press. The identity ask itself, from the Run.
 */
export function heldFigureAskToConfirm(p: {
  readonly toolCalls: readonly { readonly name: string }[];
  readonly toolResults: readonly unknown[];
  readonly mutated: boolean;
  readonly proposalOffered: boolean;
  readonly heldWaiting: boolean;
}): string | undefined {
  if (p.mutated || p.proposalOffered || p.heldWaiting
    || p.toolCalls.some((c) => c.name === 'authorise_change' || c.name.startsWith('propose_'))) return undefined;
  // The LAST Run decides, as `identityAskLineOwed` reads it: a later Run without the ask clears it.
  const last = p.toolCalls.flatMap((c, i) => (c.name === 'run_analysis' ? [p.toolResults[i]] : [])).at(-1);
  return isRec(last) && typeof last.identity_ask_say === 'string' && last.identity_ask_say.trim() !== '' ? last.identity_ask_say : undefined;
}

/**
 * ⭐ S2 HOLDS NOW, FROM THE BRIEF, ONE PRESS (DL 14 Oct, marketing de659cfd: "I'm not that experienced with marketing" was asked
 * "How likely is ‘Limited marketing experience’ to happen…?" every turn). The drafter read that the brief says the risk ALREADY
 * holds, and admission kept its whole sentence (`already_true_quote`). The route issues S2-B's holds-now card for the FIRST such
 * risk the event path can record (`riskOccurrenceSubject` eligible), quoting that sentence; the card's door re-verifies it as the
 * user's words, and only the press records it. Never when the turn proposed or approved anything or a card is waiting.
 */
export function briefHoldsNowArgs(graph: unknown): { readonly assumptions: readonly Rec[] } | undefined {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return undefined;
  for (const node of graph.nodes.filter(isRec)) {
    const quote = alreadyTrueQuoteOf(node);
    if (quote === undefined || typeof node.id !== 'string' || typeof node.label !== 'string') continue;
    if (riskOccurrenceSubject(graph, node.id).kind !== 'eligible') continue;
    return { assumptions: [{ factor_label: node.label, value: 0, unit: '', basis: '', user_stated: true, holds_now: { quote } }] };
  }
  return undefined;
}

export function briefHoldsNowToIssue(p: {
  readonly toolCalls: readonly { readonly name: string }[];
  readonly proposalOffered: boolean;
  readonly heldWaiting: boolean;
}): boolean {
  return !p.proposalOffered && !p.heldWaiting && !p.toolCalls.some((c) => c.name === 'authorise_change' || c.name.startsWith('propose_'));
}
