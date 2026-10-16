/**
 * Leaf copy of the existing reply sentence and quote/emphasis normalisation rules.
 * Draft-side readers load this before the reply stack: keep it free of runtime imports.
 */
const SENTENCE_BOUNDARY = /([.!?…]["'”’)\]*_`]*)([ \t]+)(?=["'“‘([*_`]*[A-Z0-9£$€])/g;

export function recordedSentencesOf(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  SENTENCE_BOUNDARY.lastIndex = 0;
  for (let m = SENTENCE_BOUNDARY.exec(line); m !== null; m = SENTENCE_BOUNDARY.exec(line)) {
    const end = m.index + m[1]!.length;
    const s = line.slice(start, end).trim();
    if (s.length > 0) out.push(s);
    start = m.index + m[0].length;
  }
  const rest = line.slice(start).trim();
  if (rest.length > 0) out.push(rest);
  return out;
}

const plainWords = (t: string): string => t.replace(/[\u0027\u0022\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2032\u2033`]|\*\*|__|(?<![\w])[*_]|[*_](?![\w])/g, '')
  .replace(/\s+/g, ' ').trim();

/** A complete recorded sentence, allowing presentation alone and the explicit record citation frame.
 * A negation, condition, different value/unit or other enclosing assertion is not the recorded sentence.
 */
export function recordedSentenceIn(text: string, recorded: string): boolean {
  return text.split(/\r?\n/u).flatMap(recordedSentencesOf).some(part => {
    const sentence = part.replace(/^\s*(?:[-*•]\s+)?(?:\*\*What changed:\*\*\s*)?(?:Olumi[’']s record says:\s*)?/u, '');
    return plainWords(sentence) === plainWords(recorded);
  });
}
