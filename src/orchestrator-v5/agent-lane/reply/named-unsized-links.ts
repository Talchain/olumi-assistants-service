/** Identity matcher banked in Codex WORDING; used only by the reply composer, never a prose deleter. */
const WORD_CHAR = /[\p{L}\p{N}_-]/u;
// Bounded quote spans and relation gaps: an unresolved quote cannot be re-read as an unquoted prefix.
export const QUOTED_LABEL = /‘([^‘’\n]{1,512})’|“([^“”\n]{1,512})”|"([^"\n]{1,512})"|(?<![\p{L}\p{N}])'([^'\n]{1,512})'(?![\p{L}\p{N}])/gu;
export const LINK_RELATION = /^[ \t]{0,16}(?:to|changes?|affects|drives|moves|→|->)[ \t]{0,16}$/iu;
export const THROUGH_RELATION = /^[ \t]{0,16}through[ \t]{0,16}$/iu;
export const UNSIZED_CAUSE = /comparison turns on|nobody has set yet|\b(?:isn't|aren't|isn’t|aren’t|is not|are not) sized(?: in the model)? yet\b|\b(?:has|have) no (?:size yet|recorded strength)\b/iu;
const normal = (s: string): string => s.toLocaleLowerCase().trim();

/** Resolve unique full or compacted graph labels to recorded directed link identities. */
export function namedUnsizedLinks(text: string, subjects: ReadonlySet<string>, graph?: unknown): Set<string> {
  const nodes = (graph as { nodes?: Array<{ id?: unknown; label?: unknown }> } | null)?.nodes;
  const labels = new Map<string, string>();
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (typeof n?.id === 'string' && typeof n.label === 'string') labels.set(n.id, normal(n.label));
  }
  const mentions = [...text.matchAll(QUOTED_LABEL)].map(m => {
    const alias = normal((m[1] ?? m[2] ?? m[3] ?? m[4])!);
    const ids = [...labels].filter(([, label]) => alias.endsWith('…')
      ? alias.length > 1 && label.startsWith(alias.slice(0, -1).trimEnd()) : label === alias).map(([id]) => id);
    return { id: ids.length === 1 ? ids[0] : undefined, start: m.index!, end: m.index! + m[0].length };
  });
  const quoted = mentions.slice();
  const folded = text.toLocaleLowerCase();
  // Case folding can change string length; only use original offsets when they still align.
  if (folded.length === text.length) for (const [id, label] of labels) {
    if (label === '' || [...labels.values()].filter(other => other === label).length !== 1) continue;
    let at = folded.indexOf(label);
    let quoteAt = 0;
    while (at >= 0) {
      const end = at + label.length;
      while (quoteAt < quoted.length && quoted[quoteAt]!.end <= at) quoteAt++;
      const quote = quoted[quoteAt];
      if (!WORD_CHAR.test(folded[at - 1] ?? '') && !WORD_CHAR.test(folded[end] ?? '')
        && (quote === undefined || end <= quote.start)) mentions.push({ id, start: at, end });
      at = folded.indexOf(label, end);
    }
  }
  mentions.sort((a, b) => a.start - b.start || b.end - a.end);
  const found = new Set<string>();
  const add = (from: string | undefined, to: string | undefined): void => {
    if (from !== undefined && to !== undefined && subjects.has(`${from}→${to}`)) found.add(`${from}→${to}`);
  };
  for (let i = 1; i < mentions.length; i++) {
    const a = mentions[i - 1]!, b = mentions[i]!;
    if (!LINK_RELATION.test(text.slice(a.end, b.start))) continue;
    const through = mentions[i + 1];
    if (through !== undefined && THROUGH_RELATION.test(text.slice(b.end, through.start))) {
      // End-to-end wording names a two-link path, never an invented direct edge.
      if (subjects.has(`${a.id}→${through.id}`) && subjects.has(`${through.id}→${b.id}`)) {
        add(a.id, through.id); add(through.id, b.id);
      }
    } else add(a.id, b.id);
  }
  return found;
}
