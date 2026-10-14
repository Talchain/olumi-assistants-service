/**
 * ⭐ S2 FOR A LINK EFFECT STATED THROUGH AN OPTION (served hiring negative r3, 14 Oct 18:55Z, scenario d9e685fb; DL 19:03Z/20:2xZ).
 *
 * Paul wrote "For this model: hiring a Tech lead would raise productivity by about 8% of today’s, and each additional developer
 * by about 3% of today’s." on a model whose levers are "Tech lead headcount" and "Developer headcount". The link-effect binder
 * refused both links (`not_the_users_statement`): it splits at the colon, and "a Tech lead" counts leads while the label counts
 * headcount. Both effects stayed Olumi's placeholders and were asked again. Another wording pattern would be the host
 * word-matcher trap, so this is S2's ONE statement contract (`verifyStatements`) instead:
 *  - the quote is a WHOLE statement of the user's own typed words (`wholeStatementIn`, inside the verifier);
 *  - the SUBJECT is set from graph identity, never from the Agent's words: the option that sets the link's source (its
 *    intervention, or a non-repair edge), and the link's target;
 *  - the option's ROLE in the quote: exactly one coordinate clause names that option and no other (the lane's label reader,
 *    `factorTheUserNamed`, scoped to the options), and the amount is a figure written in THAT clause. "8% … and each
 *    additional developer by about 3%" gives the Tech lead 8% and the developer 3%, never the sentence's first figure;
 *  - the source change is the clause's other figure, or one when the clause writes no other;
 *  - a range, or a direction the words contradict, prepares nothing.
 *  - counted as one with no other figure, the source change is one of what the option adds, in the source's own unit;
 * What it returns is Olumi's reading of the user's words. The card shows it and only the user's press adopts it.
 */
import { factorTheUserNamed, directionTheWordsSay, COORDINATE_CUT } from './stated-by-user.js';
import { findLinkEffectAmounts, hasLinkEffectRange } from './link-effect-figures.js';
import { verifyStatements, type StatementTexts, type UserStatement } from './user-statements.js';

interface GraphNode { readonly id: string; readonly kind?: unknown; readonly label?: unknown; readonly interventions?: unknown }
interface GraphEdge { readonly from?: unknown; readonly to?: unknown; readonly origin?: unknown }
export interface OptionStatedEffect {
  readonly amount: number;
  readonly per_source_change: number;
}
/** The verified statement, and the source's own unit when the clause counts one of what the option adds. */
export interface OptionStatedReading {
  readonly statement: UserStatement;
  readonly per_source_change_unit?: string;
}

/** The clauses a statement coordinates: split at sentence ends and colons, and where a new clause is coordinated. */
export function coordinateClausesOf(quote: string): string[] {
  return quote.split(/[.!?;:\n]+/u).flatMap((sentence) => sentence.split(new RegExp(COORDINATE_CUT.source, 'giu')))
    .map((c) => c.trim()).filter((c) => c !== '');
}

function graphOf(persisted: unknown): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const rec = persisted !== null && typeof persisted === 'object' ? persisted as { nodes?: unknown; edges?: unknown } : {};
  const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> =>
    x !== null && typeof x === 'object' && !Array.isArray(x)) : []);
  return { nodes: records(rec.nodes).filter((n) => typeof n.id === 'string').map((n) => ({ id: String(n.id), kind: n.kind, label: n.label, interventions: n.interventions })),
    edges: records(rec.edges).map((e) => ({ from: e.from, to: e.to, origin: e.origin })) };
}

/** The options that set `sourceId` in this model: its intervention, or an edge that is not connectivity repair. */
function optionsSetting(nodes: readonly GraphNode[], edges: readonly GraphEdge[], sourceId: string): GraphNode[] {
  return nodes.filter((n) => n.kind === 'option' && (
    (n.interventions !== null && typeof n.interventions === 'object' && Object.prototype.hasOwnProperty.call(n.interventions, sourceId))
    || edges.some((e) => e.from === n.id && e.to === sourceId && e.origin !== 'repair')));
}

/**
 * The user's statement of this link's effect, through the option that sets its source, or `null` when the quote does not
 * state it that way. `effect` is the Agent's reading; it is kept only when the clause's own figures give it.
 */
export function optionStatedLinkEffect(
  persisted: unknown,
  link: { readonly from: string; readonly to: string },
  quote: string,
  effect: OptionStatedEffect,
  texts: StatementTexts,
): OptionStatedReading | null {
  const graph = graphOf(persisted);
  const options = graph.nodes.filter((n) => n.kind === 'option');
  const labelOf = (n: GraphNode): string => String(n.label ?? '');
  const setters = optionsSetting(graph.nodes, graph.edges, link.from);
  if (setters.length === 0) return null;
  const others = options.filter((o) => !setters.some((s) => s.id === o.id));
  // ⛔ Served hiring negative r4 (14 Oct 22:15Z): "Hire two developers" and "Hire one developer" BOTH set the developer lever,
  // so "each additional developer" named neither by its own words. The options that set the SAME source are one group: a
  // clause names the source when it names a setter by words no other option shares, and names no option outside the group.
  const namesSetter = (clause: string): GraphNode[] => setters.filter((o) => factorTheUserNamed(labelOf(o), clause, { options: others.map(labelOf), others: [] }));
  const namesOther = (clause: string): boolean => others.some((o) => factorTheUserNamed(labelOf(o), clause,
    { options: [...setters, ...others.filter((x) => x.id !== o.id)].map(labelOf), others: [] }));
  const governing = coordinateClausesOf(quote).flatMap((clause) => {
    const named = namesSetter(clause);
    return named.length > 0 && !namesOther(clause) ? [{ clause, named }] : [];
  });
  if (governing.length !== 1) return null;
  const { clause, named } = governing[0]!;
  if (hasLinkEffectRange(clause)) return null;
  const figures = findLinkEffectAmounts(clause).map((a) => a.magnitude);
  const amount = Math.abs(effect.amount), per = Math.abs(effect.per_source_change);
  const at = figures.indexOf(amount);
  if (at < 0) return null;
  const rest = figures.filter((_, i) => i !== at);
  if (rest.length > 1 || (rest.length === 1 ? rest[0] !== per : per !== 1)) return null;
  // One figure is never both ends: a clause whose only figure is the 1 it moves by states no amount.
  if (rest.length === 0 && amount === 1) return null;
  // The sign is the words' where they say one (the clause's own, else the statement's): never against them.
  const says = directionTheWordsSay(clause) ?? directionTheWordsSay(quote);
  const sign = Math.sign(effect.amount) * Math.sign(effect.per_source_change);
  if (says === 'reverse' || (says === 'positive' && sign < 0) || (says === 'negative' && sign > 0)) return null;
  const verdict = verifyStatements([{ quote, form: 'point', value: amount }], texts, {
    subject: { quantity: link.to, node_id: link.from, ...(named.length === 1 ? { option_id: named[0]!.id } : {}) }, unit: 'link_effect', forms: ['point'],
    figuresIn: () => figures.map((f) => ({ low: f, high: f })) });
  if (verdict.kind !== 'verified') return null;
  // One of what the options add, in the source's own unit ("a Tech lead" on "Tech lead headcount" in people): Olumi's reading.
  // Several named setters must agree on that unit, or none is read.
  const units = new Set(named.map((o) => (o.interventions !== null && typeof o.interventions === 'object'
    ? (o.interventions as Record<string, { unit?: unknown } | undefined>)[link.from]?.unit : undefined))
    .map((u) => (typeof u === 'string' ? u.trim() : '')));
  const added = units.size === 1 ? [...units][0] : '';
  return { statement: verdict.statements[0]!, ...(rest.length === 0 && added !== '' ? { per_source_change_unit: added } : {}) };
}
