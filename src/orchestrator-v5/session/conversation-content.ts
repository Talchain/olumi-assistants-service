/**
 * V5 Conversation Context Reliability — in-repo conversation-content carrier.
 *
 * The two durable conversation-content columns (`user_message`,
 * `assistant_message`, added by migration 20260609120000) are NOT part of the
 * vendored `SessionTurnSchema`, which is `.strict()` and rejects unknown keys.
 * Feeding the columns into that schema would fail the parse and drop every
 * turn. So the read path (`SupabaseSessionStore.readRecent`) strips these two
 * keys, strict-parses the remaining core row with the vendored schema, then
 * re-attaches the content as this in-repo superset type.
 *
 * `SessionTurnWithContent` is a strict SUPERSET of `SessionTurn`, so it is
 * assignable anywhere a `SessionTurn` is expected — existing consumers compile
 * unchanged; only the ContextPack conversation projection reads the new fields.
 */

import { z } from 'zod';

import type { SessionTurn } from '@talchain/schemas/orchestrator';

/**
 * Read-side parser for the two content columns. Tolerant by design:
 * `null` (column present, no content), `undefined` (column absent on a DB that
 * predates the migration, or a pre-migration row) and a string all parse; any
 * non-string/non-null value coerces to `null` rather than throwing, so a DB
 * anomaly in free-text content can never fail an otherwise-valid turn read.
 */
export const ConversationContentSchema = z.object({
  user_message: z.string().nullish(),
  assistant_message: z.string().nullish(),
});

export interface ConversationContent {
  /** The user's verbatim turn message, or null when none was persisted. */
  readonly user_message: string | null;
  /** The final public assistant answer, or null when none was persisted. */
  readonly assistant_message: string | null;
}

/**
 * A `SessionTurn` widened with the durable conversation-content columns.
 *
 * The content fields are OPTIONAL here (not just nullable) so any plain
 * `SessionTurn` — every existing test fixture and any legacy caller — remains
 * assignable to `SessionTurnWithContent` without modification. The production
 * read path (`SupabaseSessionStore.readRecent`) ALWAYS attaches both via
 * {@link parseConversationContent} (string | null, never undefined), and the
 * ContextPack conversation projection coerces `?? null`, so the pack schema's
 * required `string | null` fields are always satisfied. The optionality is a
 * type-level assignability convenience only.
 */
export type SessionTurnWithContent = SessionTurn & Partial<ConversationContent>;

/**
 * Coerce the raw (stripped) content keys of a `v5_conversation_turns` row into
 * a normalised {@link ConversationContent}. Unknown/odd shapes collapse to
 * `null` — never throws. Empty / whitespace-only strings normalise to `null`
 * so the projection never carries a content-free string as if it were content.
 */
export function parseConversationContent(raw: {
  user_message?: unknown;
  assistant_message?: unknown;
}): ConversationContent {
  const parsed = ConversationContentSchema.safeParse(raw);
  if (!parsed.success) return { user_message: null, assistant_message: null };
  return {
    user_message: normalise(parsed.data.user_message),
    assistant_message: normalise(parsed.data.assistant_message),
  };
}

function normalise(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.trim().length === 0 ? null : value;
}
