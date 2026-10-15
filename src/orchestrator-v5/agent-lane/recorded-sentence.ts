import { sameWordsIn } from './goal-chance-withheld.js';
import { sentencesOf } from './reply/compose-reply.js';

/** A complete recorded sentence, allowing presentation alone and the explicit record citation frame.
 * A negation, condition, different value/unit or other enclosing assertion is not the recorded sentence.
 */
export function recordedSentenceIn(text: string, recorded: string): boolean {
  return text.split(/\r?\n/u).flatMap(sentencesOf).some(part => {
    const sentence = part.replace(/^\s*(?:[-*•]\s+)?(?:\*\*What changed:\*\*\s*)?(?:Olumi[’']s record says:\s*)?/u, '');
    return sameWordsIn(sentence, recorded) && sameWordsIn(recorded, sentence);
  });
}
