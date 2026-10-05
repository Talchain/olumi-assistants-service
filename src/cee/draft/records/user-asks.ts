/**
 * ⭐ #2576 PRINCIPLE (DL audit, PRINCIPLE-AUDIT.md "Model-facing repair prompts become user-facing open questions"):
 * THE USER IS ASKED IN THEIR OWN WORDS, NEVER IN THE COMPILER'S.
 *
 * An ask item's `detail` is written for the completion turn: it names refs (`claims[3]`), reason codes (`missing_ref`),
 * field names (`causal_links`, `to_stated`). The records build used to append those `detail`s to `open_questions`, which
 * the server appends to every reply and the UI shows verbatim (`write-outcome.ts` `openQuestionsForReply`). This is the
 * ONE mapping from an ask KIND to the plain sentence a user reads: it quotes only the item's own words
 * (`CompletionAskItem.user`, typed at the push site) and never reads `detail`.
 *
 * Typed `Record<kind, …>`: a new ask kind does not compile until it has a user sentence (no `default:` arm to fall into).
 * Quotes are double, as every other construction question (`limited-level-ask.ts`, `deadlineOpenQuestion`) quotes.
 * An item the user did not author (Olumi's own link) is said as Olumi's.
 */
import type { AskItemUserWords, CompletionAskItem } from "./completion.js";

type Kind = CompletionAskItem["kind"];

const first = (w: AskItemUserWords): string | undefined => w.names.find((n) => n.trim() !== "")?.trim();
const quotedList = (names: readonly string[]): string => {
  const q = names.filter((n) => n.trim() !== "").map((n) => `"${n.trim()}"`);
  return q.length <= 2 ? q.join(" and ") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
};
/** The goal by the user's own words when there is exactly one; "your goal" otherwise (never a guess between two). */
const goal = (w: AskItemUserWords): string => {
  const named = w.names.filter((n) => n.trim() !== "");
  return named.length === 1 ? `"${named[0]!.trim()}"` : "your goal";
};

const USER_QUESTION_BY_KIND: Readonly<Record<Kind, (w: AskItemUserWords) => string>> = {
  unresolved_reference: (w) => {
    const n = first(w);
    return n === undefined
      ? "Olumi suggested a connection it couldn't place in the model. If something is missing, what affects what?"
      : `Olumi suggested "${n}", but couldn't tell what it connects, so it is not in the model. If it matters to your decision, what does it affect?`;
  },
  illegal_shape: (w) => {
    const n = first(w);
    return n === undefined
      ? "Olumi suggested a link the model can't hold as drawn, so it is not in the model. If it matters to your decision, what does it change instead?"
      : `Olumi suggested "${n}", but the model can't hold that link as drawn, so it is not in the model. If it matters to your decision, what does it change instead?`;
  },
  unconnected_record: (w) => {
    const n = first(w);
    return n === undefined ? "Something you described isn't connected to your goal yet. What does it affect?"
      : `"${n}" isn't connected to your goal yet. What does it affect?`;
  },
  option_without_chain: (w) => {
    const n = first(w);
    return n === undefined ? "One of your options doesn't change anything that leads to your goal yet. What would it change?"
      : `"${n}" doesn't change anything that leads to your goal yet. What would it change?`;
  },
  no_goal: () =>
    "Olumi couldn't find a goal in your brief, so nothing can be compared yet. What are you trying to achieve, and how will you know you've got there?",
  constraint_target_unbindable: (w) => {
    const n = first(w);
    const subject = n === undefined ? "One of your limits" : `"${n}"`;
    return w.missing === "threshold"
      ? `${subject}: Olumi couldn't find the level this limit sets, so it isn't applied yet. What level does it set, and on what?`
      : `${subject}: Olumi couldn't tell what this limit applies to. Which factor or outcome does it limit?`;
  },
  stated_link_unresolved: (w) => {
    const n = first(w);
    const lacks = (w.lacks ?? []).filter((l) => l.trim() !== "");
    const what = lacks.length === 0 ? "everything it needs" : lacks.join(", or ");
    return `${n === undefined ? "Something you described" : `"${n}"`}: your brief doesn't say ${what}, so Olumi left it open rather than guess. Can you say?`;
  },
  no_chain_reaches_goal: (w) => `Nothing in the model leads to ${goal(w)} yet. What do your options change that affects it?`,
  no_outcome_or_risk: (w) => `Nothing in the model sits between your options and ${goal(w)} yet. What do your options change that matters for it?`,
  options_indistinguishable: (w) => {
    const named = w.names.filter((n) => n.trim() !== "");
    return named.length < 2
      ? "Some of your options set the same factors to the same levels, so the model can't tell them apart. What makes them different?"
      : `${quotedList(named)} set the same factors to the same levels, so the model can't tell them apart. What makes them different?`;
  },
};

/** The one plain sentence a user reads for an ask item. Never reads `detail`. */
export function userQuestionForAskItem(item: Pick<CompletionAskItem, "kind" | "user">): string {
  return USER_QUESTION_BY_KIND[item.kind](item.user ?? { names: [] });
}
