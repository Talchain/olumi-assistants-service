/**
 * ⭐ S2 ONE TURN CONTEXT (DL 15 Oct; architecture review arch12/2-context-management.md). What every AI call is told about
 * the turn besides its own task: today's date and the user's brief, verbatim. The rest already travels:
 * - the user's older typed words: the history store's labelled item (`olderWordsItem`), carried through any trim;
 * - awaiting approvals, the model, the last Run and the user's recorded statements: `canonical_state`
 *   (`awaiting_your_approval`, the goal's `user_statements`, `analysis`), never copied here a second time.
 * The brief is the USER's words, so it goes as a user item (history-store's rule: a developer item would lift the user's
 * words above the lane's truth rules); only the date, Olumi's own fact, is a developer item.
 */
import { todayLine } from './runtime/agent-loop.js';

/** The brief item's first line: what it is, and that it is not a new request. */
export const BRIEF_LABEL = 'The user’s brief, verbatim (for reference; not a new request):';

const textOf = (item: unknown): string => {
  const content = (item as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content.map((part) => (typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : '')).join('\n')
    : '';
};

/**
 * The context items that go BEFORE `conversation`: today (developer), then the brief (user), unless the conversation
 * already carries the brief verbatim (the older-words item opens with it), so it is sent once.
 */
export function turnContextItems(args: { readonly now: Date; readonly briefText: unknown; readonly conversation: readonly unknown[] }): unknown[] {
  const items: unknown[] = [{ role: 'developer', content: [{ type: 'input_text', text: todayLine(args.now) }] }];
  const brief = typeof args.briefText === 'string' ? args.briefText.trim() : '';
  if (brief !== '' && !args.conversation.some((item) => textOf(item).includes(brief))) {
    items.push({ role: 'user', content: [{ type: 'input_text', text: `${BRIEF_LABEL}\n${brief}` }] });
  }
  return items;
}
