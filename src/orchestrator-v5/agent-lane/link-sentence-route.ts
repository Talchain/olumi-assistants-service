/**
 * ⭐ A SENTENCE SAYING HOW STRONG A LINK IS GOES TO THE LINK'S OWN DOOR (AI Harness; DL design note "Link-sentence
 * defect", 6 Oct).
 *
 * The user types how strong a link in their model is ("AI reporting module availability has only a slight effect on
 * Enterprise prospect signing likelihood"). The prompt tells the Agent to call `propose_link_strength`
 * (`coach-route-v0_2.ts`), but the tool choice was free, so the Agent could answer in prose and nothing reached the
 * canvas (`no-direct-link.ts` records the same free choice for a figure). Now the host names that tool for the FIRST
 * call (`firstCallTool`, exactly as a pressed chip does: `agent-loop.ts`). The model still fills the arguments, and the
 * tool's own checks and its held card decide the rest: nothing is written until the user approves the card.
 *
 * `linkSentenceFirstCall` names the tool ONLY when ALL of these hold. Every miss leaves today's free choice:
 *   · the message was TYPED (no chip, no retry), and no other forced path owns the turn (a first brief's host call, a
 *     method or widen turn), which keeps precedence;
 *   · the canonical state was read (the same read the turn's context packet binds: entities and links by id);
 *   · the message writes no figure in digits outside the model's own labels: a figure is `propose_link_effect`'s (a
 *     figure in words, "fifty", is not read here: "one link" or "a strong effect" would read as one);
 *   · ONE clause of the message (`clausesOf`, the binders' own clause reader):
 *       – names, by whole label (`messageNamesLabel`; the longest label first, so "Price rise" inside "Customer losses
 *         from price rise" names only the longer), the two ends of EXACTLY ONE existing causal link, either way round.
 *         A decision's or option's link is structure, never a strength. A NEW link (none between them) never fires;
 *       – each end's label is carried by ONE node (the tool refuses a shared label as ambiguous);
 *       – its sentence is no question and no denial (`linkEffectQuoteContextMiss`, the RT-19 rule), and the clause is
 *         no condition ("if", "would", "were", …) and no embedded question ("how strongly …");
 *       – it states exactly ONE band, affirmed (`bandTheUserWrote`, the tool's own literal band reader);
 *   · and no other clause states a band for a different link (several links are the Agent's to batch).
 */
import { messageNamesLabel, STRUCTURAL_KINDS } from './link-size-ask.js';
import { bandTheUserWrote, clausesOf, linkEffectQuoteContextMiss } from './stated-by-user.js';

export const LINK_SENTENCE_TOOL = 'propose_link_strength';
const BANDS = ['very strong', 'strong', 'moderate', 'weak'] as const;

type Entity = { readonly id: string; readonly label: string; readonly kind: unknown };
type Link = { readonly from: string; readonly to: string };

/** The fold `messageNamesLabel` matches on: case, quotes and runs of spaces ignored. */
const fold = (s: string): string => s.toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/\s+/g, ' ').trim();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
/** A condition, a supposition or an embedded question: not a statement of how strong the link IS. */
const NOT_A_STATEMENT = /\b(?:if|suppose|supposing|imagine|assume|assuming|unless|whether|were|would|could|might|hypothetically|how)\b/i;

function stateOf(state: unknown): { entities: Entity[]; links: Link[] } | null {
  const s = state as { ok?: unknown; entities?: unknown; links?: unknown } | null | undefined;
  if (s === null || s === undefined || s.ok !== true || !Array.isArray(s.entities) || !Array.isArray(s.links)) return null;
  const entities = s.entities.filter((e): e is Entity => e !== null && typeof e === 'object'
    && typeof (e as Entity).id === 'string' && typeof (e as Entity).label === 'string');
  const links = s.links.filter((l): l is Link => l !== null && typeof l === 'object'
    && typeof (l as Link).from === 'string' && typeof (l as Link).to === 'string');
  return { entities, links };
}

/** The folded labels `text` names as whole words, longest first; each named label is blanked before shorter ones are read. */
function labelsNamedIn(text: string, labels: readonly string[]): { named: string[]; rest: string } {
  let rest = fold(text);
  const named: string[] = [];
  for (const label of labels) {
    if (!messageNamesLabel(rest, label)) continue;
    named.push(label);
    rest = rest.replace(new RegExp(`(^|[^a-z0-9])${escape(label)}(?=$|[^a-z0-9])`, 'g'), (_m, pre: string) => `${pre}${' '.repeat(label.length)}`);
  }
  return { named, rest };
}

/**
 * `propose_link_strength` when the user's typed message states, in ONE clause, a band for exactly one existing link
 * (see the module note); `undefined` otherwise, so the turn keeps its free choice.
 */
export function linkSentenceFirstCall(state: unknown, typedMessage: string | null, otherForcedPath: boolean): typeof LINK_SENTENCE_TOOL | undefined {
  if (otherForcedPath || typedMessage === null || typedMessage.trim() === '') return undefined;
  const read = stateOf(state);
  if (read === null) return undefined;
  const labels = [...new Set(read.entities.map((e) => fold(e.label)).filter((l) => l !== ''))].sort((a, b) => b.length - a.length);
  const carriers = (label: string): Entity[] => read.entities.filter((e) => fold(e.label) === label);
  // A figure in digits is the link-effect door's, never this one's. The model's own labels ("Raise to £59") are not figures.
  if (/\d/.test(labelsNamedIn(typedMessage, labels).rest)) return undefined;
  const stated = new Map<string, Set<string>>();
  for (const clause of clausesOf(typedMessage)) {
    const named = labelsNamedIn(clause, labels).named;
    const ends = new Set(named.flatMap(carriers).filter((e) => !STRUCTURAL_KINDS.has(e.kind)).map((e) => e.id));
    const hits = read.links.filter((l) => l.from !== l.to && ends.has(l.from) && ends.has(l.to));
    if (hits.length !== 1) continue;
    const link = hits[0]!;
    const labelOf = (id: string): string => fold(read.entities.find((e) => e.id === id)?.label ?? '');
    if (carriers(labelOf(link.from)).length !== 1 || carriers(labelOf(link.to)).length !== 1) continue;
    const miss = linkEffectQuoteContextMiss(clause, typedMessage);
    if (miss === 'question') continue;
    if (miss === 'denied') continue;
    if (NOT_A_STATEMENT.test(clause)) continue;
    const bands = BANDS.filter((b) => bandTheUserWrote(b, clause));
    if (bands.length !== 1) continue;
    const key = `${link.from}→${link.to}`;
    stated.set(key, new Set([...(stated.get(key) ?? []), bands[0]!]));
  }
  if (stated.size !== 1) return undefined;
  return [...stated.values()][0]!.size === 1 ? LINK_SENTENCE_TOOL : undefined;
}
