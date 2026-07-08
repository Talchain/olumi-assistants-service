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
 *   - message-kind payload at `stage: 'frame'` only;
 *   - trimmed length ≥ {@link DRAFT_GRAPH_MIN_BRIEF_LENGTH};
 *   - matches the decision-brief shape regex.
 * This mirrors route-v2's `isDraftGraphShape` heuristic (route-v2.ts —
 * `DRAFT_GRAPH_DECISION_BRIEF_REGEX`; keep the two in sync), i.e. "a message
 * that WOULD have drafted (and therefore persisted the brief) had the draft
 * shortcut fired". Two deliberate deltas from route-v2: length and regex are
 * checked on the TRIMMED message (whitespace padding cannot sneak a short
 * message past the gate, and a trailing-space question still counts), and no
 * graph/continuation conditions apply — the RPC predicate already makes
 * re-seeding a no-op.
 *
 * The returned value is `normaliseBriefText`-bounded (trim → 8000-char cap
 * with word-boundary truncation) so it always satisfies the DB CHECK
 * constraint. The full normalisation result is returned (not just the value)
 * so the call site can emit the existing disclosed-truncation telemetry —
 * same pattern as draft-graph-dispatch ("truncation telemetry fires at the
 * call site, pure helper").
 */

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { DRAFT_GRAPH_MIN_BRIEF_LENGTH } from '../../schemas/assist.js';
import {
  normaliseBriefText,
  type NormaliseBriefTextResult,
} from './normalise-brief-text.js';

/**
 * Positive decision-brief regex — common decision verbs or a trailing
 * question mark. MIRROR of `DRAFT_GRAPH_DECISION_BRIEF_REGEX` in
 * `src/orchestrator/route-v2.ts` (module-local there; duplicated here so the
 * session layer does not import the HTTP route). If you change one, change
 * both — `derive-brief-seed.test.ts` exercises the shape gate.
 */
export const BRIEF_SEED_DECISION_REGEX =
  /\b(should|shall|whether|versus|vs\.?|choose|decide|expand|invest|launch|hire|fire|buy|sell|acquire|pivot|layoff|restructure)\b|\?$/i;

/**
 * Derive a brief-text seed from the turn payload, or `undefined` when the
 * payload must not seed (wrong kind/stage, or fails the brief shape gate).
 *
 * Pure and total. Callers persist `result.value` (via the commit metadata's
 * `briefText`) and disclose `result.truncated` through the existing
 * `V5BriefTextNormalised` telemetry event.
 */
export function deriveBriefTextSeed(
  payload: OrchestratorTurnPayload,
): NormaliseBriefTextResult | undefined {
  if (payload.kind !== 'message') return undefined;
  if (payload.stage !== 'frame') return undefined;
  const trimmed = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (trimmed.length < DRAFT_GRAPH_MIN_BRIEF_LENGTH) return undefined;
  if (!BRIEF_SEED_DECISION_REGEX.test(trimmed)) return undefined;
  return normaliseBriefText(payload.message);
}
