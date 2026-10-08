// AIQ: words pending; Science confirmation pending.
export const LINK_EFFECT_BEST_GUESS_QUESTION = "You said ‘<user's words>’. What's your best single guess, and the lowest and highest it could plausibly be?";

export function linkEffectBestGuessQuestion(action: { readonly quote: string }): string {
  return LINK_EFFECT_BEST_GUESS_QUESTION.replace("<user's words>", () => action.quote);
}

