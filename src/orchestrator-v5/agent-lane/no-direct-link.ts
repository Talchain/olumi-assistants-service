/**
 * ⭐ A FIGURE STATED FOR TWO ENDS WITH NO DIRECT LINK GETS THE DOOR'S OWN WORDS, NEVER AN IMPROVISED OFFER (DL 0df0e1 ruling
 * (A) on red team 19's row, #87 6009566552; STEP 1 6009612287).
 *
 * Served (cut-5 pin b38592ed, r18d): "Each 10 percentage point rise in text reminder coverage lowers no-shows by about 1
 * percentage point of appointments." The model has no coverage → no-shows link (coverage acts through "Reminder reach
 * rate"), so the Agent called no tool (the tool records an EXISTING link) and improvised "how strong would you describe
 * it?" to add a NEW direct link it had itself said would double-count. Whether the Agent calls the tool is its choice
 * (19's row 2 on the same build did call it). The tool's own refusal words are honest and fixed: they are said here too.
 *
 * `noSuchLinkUserWords`: the ONE wording of "no such link" (the tool's `no_such_link` refusal wraps it unchanged).
 * `noDirectLinkFigureReply`: the host's guard. It fires ONLY when ALL hold:
 *   · no `propose_link_effect` ran this turn (the door already answered), and no other `propose_*` / `run_*` tool either:
 *     a card or a run made this turn keeps the Agent's own words about it (a read-only tool, e.g. `get_canonical_state`, does
 *     not stop the guard);
 *   · the message states a figure (`findLinkEffectAmounts`, the door's own figure reader);
 *   · it names exactly TWO nodes, both causal, by the existing label matcher (`messageNamesLabel`, link-size-ask), with
 *     two different labels, neither inside the other (an ambiguous label never fires);
 *   · those two have NO direct link of any kind, either way;
 *   · exactly ONE of them reaches the other through the model (no path, or both ways, leaves the direction unsaid: no fire).
 */
import { findLinkEffectAmounts } from './link-effect-figures.js';
import { messageNamesLabel, STRUCTURAL_KINDS } from './link-size-ask.js';

type Edge = { from?: unknown; to?: unknown; edge_type?: unknown };
type GNode = { id?: unknown; kind?: unknown; label?: unknown };
const nodesOf = (raw: unknown): GNode[] => {
  const g = raw as { nodes?: unknown[] } | null;
  return (Array.isArray(g?.nodes) ? g.nodes : []).filter((n): n is GNode => n !== null && typeof n === 'object');
};
const edgesOf = (raw: unknown): Edge[] => {
  const g = raw as { edges?: unknown[] } | null;
  return (Array.isArray(g?.edges) ? g.edges : []).filter((e): e is Edge => e !== null && typeof e === 'object');
};
/** The causal edges a "moves … through …" walk may take: never a shared cause, never out of an option or the decision. */
function causalWalk(raw: unknown): Edge[] {
  const kind = new Map(nodesOf(raw).map((n) => [n.id, n.kind] as const));
  return edgesOf(raw).filter((e) => e.edge_type !== 'bidirected' && kind.get(e.from) !== 'option' && kind.get(e.from) !== 'decision');
}
function reachesIn(walk: readonly Edge[], start: unknown, target: unknown): boolean {
  const seen = new Set<unknown>([start]);
  for (const queue = [start]; queue.length > 0;) {
    const at = queue.shift();
    if (at === target) return true;
    for (const e of walk) if (e.from === at && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  }
  return false;
}

export function noSuchLinkUserWords(raw: unknown, from: { id: string; label: string }, to: { id: string; label: string }): string {
  const g = raw as { nodes?: unknown[]; edges?: unknown[] } | null;
  const nodes = (Array.isArray(g?.nodes) ? g.nodes : []) as Array<{ id?: unknown; kind?: unknown; label?: unknown }>;
  const edges = (Array.isArray(g?.edges) ? g.edges : []) as Array<{ from?: unknown; to?: unknown; edge_type?: unknown }>;
  const walk = causalWalk(raw);
  const reaches = (start: unknown): boolean => reachesIn(walk, start, to.id);
  // Codex r2 on #2641: the named first link must be one the canvas edit can take: ONE edge of any type on that pair, and
  // both ends one entity each that is not an option or the decision (else the strength edit refuses it as ambiguous).
  const one = (id: unknown): boolean => nodes.filter((n) => n.id === id).length === 1;
  const editable = (a: unknown, b: unknown): boolean => one(a) && one(b) && edges.filter((e) => e.from === a && e.to === b).length === 1
    && !['option', 'decision'].includes(String(nodes.find((n) => n.id === b)?.kind));
  const first = walk.find((e) => e.from === from.id && e.to !== to.id && editable(e.from, e.to) && reaches(e.to));
  const via = first === undefined ? undefined : nodes.find((n) => n.id === first.to);
  if (via !== undefined) {
    const v = typeof via.label === 'string' && via.label.trim() !== '' ? via.label : String(via.id);
    return `The model has no direct link from \u201c${from.label}\u201d to \u201c${to.label}\u201d: \u201c${from.label}\u201d moves \u201c${to.label}\u201d through \u201c${v}\u201d. `
      + `You can set how strong that first link is now: on the canvas, click the link from \u201c${from.label}\u201d to \u201c${v}\u201d, and under `
      + '\u201cHow strong is this effect?\u201d choose Slight, Moderate, Strong or Very strong. That records how strong you judge the link, not your figure.';
  }
  // Codex r2 on #2641: a pair the model already holds as a SHARED CAUSE (bidirected) cannot take an added link
  // (`propose_model_change` refuses already_present), so that offer is never made for it.
  if (edges.some((e) => e.from === from.id && e.to === to.id)) {
    return `The model holds \u201c${from.label}\u201d and \u201c${to.label}\u201d as moved by a shared cause, not one moving the other, so there is `
      + 'no effect to record. If you meant two other factors, name them and I\u2019ll check.';
  }
  return `The model has no link from \u201c${from.label}\u201d to \u201c${to.label}\u201d, so there is no effect to record yet. `
    + `If \u201c${from.label}\u201d does move \u201c${to.label}\u201d, I can add that link for you to approve; your figure can then size it.`;
}


const labelText = (n: GNode): string => (typeof n.label === 'string' ? n.label.trim() : '');
const folded = (s: string): string => s.toLowerCase().replace(/[\u201c\u201d"\u2018\u2019'`]/g, '').replace(/\s+/g, ' ').trim();

/** The guard (see the module note): the door's own words, or null when any condition does not hold. */
export function noDirectLinkFigureReply(graph: unknown, message: string, toolCallNames: readonly string[]): string | null {
  if (toolCallNames.some((n) => n.startsWith('propose_') || n.startsWith('run_'))) return null;
  if (findLinkEffectAmounts(message).length === 0) return null;
  const named = nodesOf(graph).filter((n) => messageNamesLabel(message, labelText(n)));
  if (named.length !== 2 || named.some((n) => STRUCTURAL_KINDS.has(n.kind))) return null;
  const [a, b] = named as [GNode, GNode];
  const [la, lb] = [folded(labelText(a)), folded(labelText(b))];
  if (la === lb || la.includes(lb) || lb.includes(la)) return null;
  if (edgesOf(graph).some((e) => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id))) return null;
  const walk = causalWalk(graph);
  const ab = reachesIn(walk, a.id, b.id);
  const ba = reachesIn(walk, b.id, a.id);
  if (ab === ba) return null;
  const [from, to] = ab ? [a, b] : [b, a];
  return noSuchLinkUserWords(graph, { id: String(from.id), label: labelText(from) }, { id: String(to.id), label: labelText(to) });
}
