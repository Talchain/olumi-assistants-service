/**
 * PATH-B: create an OpenAI Conversation (the durable conversation state of one scenario's `core` lane).
 *
 * This lives in the adapter folder because every request to the provider leaves the process from here. It is not a
 * generative call (no model, no tokens), so it takes no `_provider_calls` row; it still obeys the request's provider
 * policy, so a route that does not allow OpenAI never reaches the provider.
 */
import { config } from '../../config/index.js';
import { ForbiddenProviderError, currentProviderPolicy, isProviderAllowed } from './provider-policy.js';

const CONVERSATIONS_URL = 'https://api.openai.com/v1/conversations';

/** Create a Conversation with `items` as its first items; returns its id (`conv_…`). */
export async function createOpenAiConversation(
  metadata: Readonly<Record<string, string>>,
  items: readonly unknown[],
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!isProviderAllowed('openai')) throw new ForbiddenProviderError('openai', currentProviderPolicy()?.route ?? 'unknown', 'conversation.create');
  const r = await fetch(CONVERSATIONS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.llm.openaiApiKey ?? ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({ metadata, items }),
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`openai_conversation_${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  const id = ((await r.json()) as { id?: unknown }).id;
  if (typeof id !== 'string' || id === '') throw new Error('openai_conversation_no_id');
  return id;
}
