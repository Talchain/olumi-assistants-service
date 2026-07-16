/**
 * Lane 28 — brief pipeline seam 1: derive a `scenarios.brief_text` SEED from
 * a turn payload.
 *
 * Why this exists (context-architecture dossier gap G2 / item C): the only
 * production writer of `brief_text` was draft-graph-dispatch, whose route-v2
 * trigger (`isDraftGraphShape`) requires `graph_state == null` AND is
 * suppressed for scenarios with prior committed turns (the Signature-Loop
 * continuation guard). Every turn routed to the TurnExecutor instead —
 * including the "greeting first, brief second" flow, where the brief message
 * lands on a continuation scenario — committed via sites that re-passed only
 * `context.scenarioBriefText` (the ALREADY-persisted brief): a circular
 * no-op when nothing had ever been written. Net effect on staging: scenarios
 * carry no persisted brief, so the decision_review enricher skips with
 * `no_brief` and the brief reaches no LLM after the draft turn.
 *
 * Gate (deliberately conservative — the RPC write is FIRST-WRITE-WINS via
 * `WHERE brief_text IS NULL OR brief_text = ''`, so a wrong seed poisons the
 * scenario's brief permanently):
 *   - the scenario has NO committed graph yet (`hasCommittedGraph` — the
 *     executor passes `context.persistedGraph != null`, its server-side
 *     scenarios read). This mirrors route-v2's actual draft scope
 *     (`graph_state == null` + no prior committed turns): once a graph
 *     exists the conversation is past the framing turn, and no
 *     mid-conversation message should be able to claim the permanent
 *     first-write-wins brief slot;
 *   - message-kind payload at `stage: 'frame'` only;
 *   - trimmed length ≥ {@link DRAFT_GRAPH_MIN_BRIEF_LENGTH};
 *   - matches the decision-brief shape regex;
 *   - the trimmed message does NOT end with `?`. Rationale: a permanent
 *     first-write-wins field must not be claimable by any mid-conversation
 *     question ("What should I do next?" is a prompt to the assistant, not
 *     the user's decision brief). The regex's `\?$` alternative is kept for
 *     mirror-fidelity with route-v2, but this exclusion deliberately
 *     overrides it for SEEDING: questions never seed.
 * The shape checks mirror route-v2's `isDraftGraphShape` heuristic
 * (route-v2.ts — `DRAFT_GRAPH_DECISION_BRIEF_REGEX`; keep the two in sync),
 * i.e. "a message that WOULD have drafted (and therefore persisted the
 * brief) had the draft shortcut fired". Deliberate deltas from route-v2:
 * length and regex are checked on the TRIMMED message (whitespace padding
 * cannot sneak a short message past the gate), and questions are excluded
 * outright (see above). The RPC predicate remains the last line of defence
 * against re-seeding.
 *
 * The returned value is `normaliseBriefText`-bounded (trim → 8000-char cap
 * with word-boundary truncation) so it always satisfies the DB CHECK
 * constraint. The full normalisation result is returned (not just the value)
 * so the call site can emit the existing disclosed-truncation telemetry —
 * same pattern as draft-graph-dispatch ("truncation telemetry fires at the
 * call site, pure helper").
 */

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import {
  DRAFT_GRAPH_DECISION_BRIEF_REGEX,
  DRAFT_GRAPH_MIN_BRIEF_LENGTH,
} from '../../schemas/assist.js';
import {
  normaliseBriefText,
  type NormaliseBriefTextResult,
} from './normalise-brief-text.js';

/**
 * Positive decision-brief regex — common decision verbs or a trailing
 * question mark. Formerly a hand-synced MIRROR of the module-local copy in
 * `src/orchestrator/route-v2.ts`; both now derive from the CANONICAL
 * `DRAFT_GRAPH_DECISION_BRIEF_REGEX` export in `src/schemas/assist.ts`
 * (ROADMAP 2.63 — the mirror could drift silently, and the session layer
 * must not import the HTTP route). Re-exported under the historical name
 * for existing consumers/tests; `derive-brief-seed.test.ts` exercises the
 * shape gate.
 */
export const BRIEF_SEED_DECISION_REGEX = DRAFT_GRAPH_DECISION_BRIEF_REGEX;

/**
 * Options for {@link deriveBriefTextSeed}. A dedicated object (not a bare
 * boolean) so call sites read as `{ hasCommittedGraph: ... }` — the gate is
 * too consequential for an anonymous positional flag.
 */
export interface DeriveBriefTextSeedOptions {
  /**
   * Whether the scenario already has a COMMITTED (server-side persisted)
   * graph. The turn-executor passes `context.persistedGraph != null` — the
   * same scenarios read `buildTurnContext` performs at turn start. When
   * true, seeding is refused outright: the scenario is past its framing
   * turn, and a permanent first-write-wins field must not be claimable by
   * any later message.
   */
  readonly hasCommittedGraph: boolean;
}

/**
 * Derive a brief-text seed from the turn payload, or `undefined` when the
 * payload must not seed (graph already committed, wrong kind/stage, fails
 * the brief shape gate, or is a question — see the module doc).
 *
 * Pure and total. Callers persist `result.value` (via the commit metadata's
 * `briefText`) and disclose `result.truncated` through the existing
 * `V5BriefTextNormalised` telemetry event.
 */
export function deriveBriefTextSeed(
  payload: OrchestratorTurnPayload,
  options: DeriveBriefTextSeedOptions,
): NormaliseBriefTextResult | undefined {
  // A committed graph means the framing turn is behind us — never seed the
  // permanent first-write-wins brief slot from a mid-conversation message.
  if (options.hasCommittedGraph) return undefined;
  if (payload.kind !== 'message') return undefined;
  if (payload.stage !== 'frame') return undefined;
  const trimmed = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (trimmed.length < DRAFT_GRAPH_MIN_BRIEF_LENGTH) return undefined;
  if (!BRIEF_SEED_DECISION_REGEX.test(trimmed)) return undefined;
  // A permanent first-write-wins field must not be claimable by any
  // mid-conversation question — "What should I do next?" addresses the
  // assistant; it is not the user's decision brief. Overrides the regex's
  // `\?$` alternative (kept only as a route-v2 mirror) for seeding.
  if (trimmed.endsWith('?')) return undefined;
  return normaliseBriefText(payload.message);
}
