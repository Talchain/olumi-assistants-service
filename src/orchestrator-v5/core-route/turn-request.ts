/**
 * ⭐ CORE ROUTE: A TURN'S REQUEST IDENTITY (22 Oct 2026; DL: core moves to its own thin route, `routes/core-turn.ts`).
 * Moved VERBATIM from `routes/agent-v1-turn.ts`, which imports them from here, so both routes claim, hash and replay a turn
 * the same way: the durable claim (`<turn_id>:claim` with its per-request nonce) and how long a losing request waits; the
 * request hash (words, subject, operation, chip) and the typed-row proof read back from it; and the canvas's Challenge press.
 */
import { createHash } from 'node:crypto';
import { config } from '../../config/index.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../../config/timeouts.js';
import type { AgentSelectionContext } from '../agent-lane/selection-context.js';
import { NOTE_NODE_KINDS } from '../path-b/tools/note-on-item.js';

/**
 * ⛔ A TURN'S IDENTITY IS CLAIMED BEFORE IT RUNS — independent review of #1720
 * at f616bc2a (CHANGES_REQUIRED): a preflight READ of "has this turn
 * committed?" let two concurrent identical requests both see "no row" and both
 * call the provider and the tools; and a turn whose final row failed to persist
 * was re-run by its retry. So the identity is now CLAIMED in the durable turn
 * table (unique on (scenario_id, turn_id)) before any provider or tool call:
 *   · the CLAIM row carries `<turn_id>:claim` and no messages (history readers
 *     exclude it before their LIMIT — see `SupabaseSessionStore.readRecent`);
 *   · the ANSWER row carries the client's `turn_id` with the user and final text.
 * Only the request that CREATED the claim runs. Any other sees the claim, never
 * runs, and waits for the answer (replaying it) or says the outcome is unknown.
 * A claim without an answer is never read as permission to run again.
 */
export const claimTurnIdOf = (turnId: string): string => `${turnId}:claim`;
/**
 * ⛔ THE CLAIM MUST DECIDE OWNERSHIP ON THE PRODUCTION STORE — independent review
 * of #1720 at cb4e9d35: a non-graph write goes to `append_turn_atomic_v2`, which
 * does `ON CONFLICT DO NOTHING` and returns the EXISTING id with no error, so the
 * store never reports "someone else created this" for a claim. The claim row
 * therefore carries a per-request NONCE in its hash; the row is written once by
 * whichever insert wins and never updated, so reading it back says, exactly,
 * whether THIS request created it.
 */
const CLAIM_NONCE = '#claim:';
export const claimHashFor = (requestHash: string, nonce: string): string => `${requestHash}${CLAIM_NONCE}${nonce}`;
export const requestHashOfClaim = (claimHash: string): string => claimHash.split(CLAIM_NONCE)[0] ?? '';
/**
 * How long a request that did not win the claim waits for the winner's answer.
 *
 * ⛔ IT MUST END BEFORE THE BROWSER PROXY GIVES UP (Panel, #1720 APPROVE 5792014826,
 * non-blocking #1). At 150 s it outlasted the proxy's 125 s inject timeout, so a
 * same-id duplicate in the browser got a proxy timeout instead of the replay or the
 * 409 it was designed to return. Derived from the served proxy timeout, less the
 * same response headroom the V5 turn budget reserves, so the loser always answers.
 */
export const AGENT_TURN_CLAIM_WAIT = {
  totalMs: Math.min(150_000, config.proxy.browserProxyTimeoutMs - TURN_RESPONSE_HEADROOM_MS),
  everyMs: 1_000,
};

/**
 * What makes two Agent turns "the same request": the scenario, WHO is asking,
 * and the message itself (trimmed). Stored as the turn row's `request_hash`, so
 * an exact retry replays and a reused id carrying a different message refuses.
 */
export function agentTurnRequestHash(scenarioId: string, userId: string | null, message: string, operation?: string): string {
  /**
   * ⛔ A TYPED OPERATION IS PART OF WHAT WAS ASKED (independent review of #1782,
   * 5804375960). Two approval chips carry the SAME words ("Yes, use those.") for
   * DIFFERENT proposals, so a hash of the words alone let a reused turn_id replay
   * approval A's answer for a request to approve B. The operation is bound only when
   * present, so an ordinary message hashes exactly as before and its retries still
   * replay.
   */
  const digest = createHash('sha256')
    .update(JSON.stringify({ v: 1, scenario_id: scenarioId, subject: userId, message: message.trim(), ...(operation !== undefined ? { operation } : {}) }))
    .digest('hex');
  return `agent_turn:${digest}`;
}

/**
 * ⛔ THE CHIP IS PART OF WHAT WAS ASKED, TOO (DL P2 on #2481; the class, not the one chip). The same words do different
 * things with and without a chip, and with different chips: every chip turn withholds `authorise_change` and
 * `run_analysis` (`withheldToolsOf`), and the Run, research, Strengthen and starting-assumptions chips each take their
 * own path. So a reused turn_id carrying the same words with another chip, or none, is another request: it meets
 * `TURN_ID_REUSED`, never the other's recorded answer. The approve and explanation chips keep their own operations
 * (`approve:<id>`, the explanation id) inside the digest, unchanged.
 *
 * The chip rides as a SUFFIX (`#chip:<digest>`), not inside the digest, because the UI's own retry resends a turn's words
 * under its turn_id WITHOUT the chip (DGAI `buildPayload.ts`: `chip` only on chip sources; `retryLast` sends
 * `source: 'retry'`). `sameAgentTurnRequest` lets exactly that retry replay the recorded press (Codex pre-review P1).
 */
const CHIP_HASH_SEP = '#chip:';
/**
 * Restart continuity (DL 17:18Z, 14 Oct): a durable answer row's words were TYPED when its stored hash is this subject's
 * PLAIN hash of them: no `#chip:` suffix and no operation in the digest, the same rule as `typedByUser`. The reseed holds
 * proven rows as typed words (`HistoryStore.seed`); every other row stays source-unknown.
 */
export function typedRowProof(scenarioId: string, userId: string | null):
  (row: { request_hash?: string | null; user_message?: string | null; created_at?: string | null }) => boolean {
  return (row) => typeof row.user_message === 'string' && writtenSinceTypedOriginCutoff(row.created_at)
    && row.request_hash === agentTurnRequestHash(scenarioId, userId, row.user_message);
}
/**
 * ⛔ THE CUTOFF (DL, 14 Oct): before DGAI c3a20ea9 (#2792 + #2793 + #2794) the UI sent some of Olumi's own text without a
 * chip (GuidanceStrip discuss and exercise, confirm, OptionsComparison, OptionPreview, DraftNotes, FactorNode, …), so an
 * older row's plain hash does not prove its words were typed. Only rows written once that UI was served are proven:
 * staging's version.json showed c3a20ea9 at 21:03Z (built 20:24:48Z), so the cutoff is that observation, never earlier.
 * An older row, or one with no readable time, stays source-unknown.
 */
export const TYPED_ORIGIN_PROOF_FROM = '2026-10-14T21:03:00Z';
function writtenSinceTypedOriginCutoff(createdAt: string | null | undefined): boolean {
  const at = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(at) && at >= Date.parse(TYPED_ORIGIN_PROOF_FROM);
}
/** A durable typed discriminator lets the UI's chipless retry recognise SCI-DEEP without reversing the digest. */
export const STRUCTURAL_CHALLENGE_HASH_TAG = 'sci-deep:';
export function chipOperationOf(body: Record<string, unknown>): string | undefined {
  const chip = body['chip'];
  if (chip === null || typeof chip !== 'object') return undefined;
  const { id, action_type: actionType } = chip as { id?: unknown; action_type?: unknown };
  return `chip:${JSON.stringify([typeof id === 'string' ? id : null, typeof actionType === 'string' ? actionType : null])}`;
}
/** The turn's request hash with its chip bound, when it has one (see `chipOperationOf`). */
export function withChipOperation(requestHash: string, chipOperation: string | undefined, tag = ''): string {
  return chipOperation === undefined ? requestHash
    : `${requestHash}${CHIP_HASH_SEP}${tag}${createHash('sha256').update(chipOperation).digest('hex').slice(0, 32)}`;
}
/** A UI retry: `source: 'retry'` and no chip (the UI drops it on a retry). */
export function isChiplessRetry(body: Record<string, unknown>): boolean {
  return body['source'] === 'retry' && (body['chip'] === undefined || body['chip'] === null);
}
/**
 * Whether a recorded turn (`stored`) is this request. Exact, except that a chipless UI retry of the same words is the
 * same request as the recorded chip press of those words: it is that press, resent without its chip.
 */
export function sameAgentTurnRequest(stored: string, requested: string, chiplessRetry: boolean): boolean {
  if (stored === requested) return true;
  return chiplessRetry && !requested.includes(CHIP_HASH_SEP) && stored.startsWith(`${requested}${CHIP_HASH_SEP}`);
}

/** The canvas's Challenge press on one card (DGAI `NodeQuickActions` → `askAi`, chip `ask:challenge`). */
export const ASK_CHALLENGE_CHIP_ID = 'ask:challenge';
/**
 * ⭐ CHALLENGE ON ONE CARD (DL 22 Oct, Lenses lease; served 0/4 notes with #3630's description alone): a Challenge press on
 * exactly ONE card the model holds gets that card's own selection note for this turn, and its first call must be
 * note_on_item, so the challenge lands beside the card. No card, several, a link, or a selection that could not be checked:
 * null, and the turn runs as before.
 */
export function challengeTargetOf(body: Record<string, unknown>, selection: AgentSelectionContext | null | undefined,
  savedGraph: unknown): AgentSelectionContext | null {
  const chip = body['chip'] as { id?: unknown } | null | undefined;
  if (chip?.id !== ASK_CHALLENGE_CHIP_ID || selection == null) return null;
  if (selection.grounded.element_ids.length !== 1 || selection.links !== undefined || selection.grounded.unresolved !== 'none') return null;
  // Only a card a note can sit beside, on the saved model note_on_item itself reads (Codex r1: a decision is refused there).
  const id = selection.grounded.element_ids[0];
  const rec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const nodes = rec(savedGraph) && Array.isArray(savedGraph['nodes']) ? (savedGraph['nodes'] as unknown[]).filter(rec) : [];
  const card = nodes.find((n) => n['id'] === id);
  return card !== undefined && NOTE_NODE_KINDS.has(String(card['kind'])) ? selection : null;
}
