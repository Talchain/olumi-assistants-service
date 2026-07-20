/**
 * F-1 / F-2 (POSTDEPLOY-PROBES-573, 2026-07-20) — the claim-then-starve seam.
 *
 * ## The defect this module exists to close
 *
 * `handleEditGraph`'s `propose_and_confirm` branch returns BEFORE the edit
 * prompt is loaded (edit-graph.ts: the branch sits above
 * `getSystemPrompt('edit_graph')`). It emits deterministic copy that asks the
 * user for "the specifics" and mints a `pendingProposal` — but
 * `ProposedChange` carries no value field, so the payload it mints can never
 * represent a specific. On the LIVE V5 path nothing ever reads that pending
 * back (persist/read-back/thread are all absent — see the note at
 * edit-graph-dispatch.ts), so the proposal is write-only.
 *
 * Live-proven consequence on build 53b817b: nine consecutive configure-shaped
 * turns — including ones phrased in the assistant's OWN requested format —
 * each exited `edit_graph` with `llm_calls=0` and the same specifics-blind
 * clarify, while the specifics ("set CRM Feature Depth to 0.7") were sitting
 * in the message. `opt_cloud_native.interventions` stayed `null` throughout.
 * The branch CLAIMED the turn and then STARVED it.
 *
 * ## The mechanism rule
 *
 * A deterministic claim must either fully handle the turn OR fall through to
 * the more capable path. It must never claim-then-starve. A clarify is
 * correct ONLY when neither path can proceed.
 *
 * Applied here: the propose branch may only terminate a turn when it has
 * something the LLM edit lane does not — i.e. a STORED proposal to replay
 * (the V4 confirm round-trip) — or when the turn genuinely carries no value
 * or direction for either path to act on. Otherwise it hands off.
 *
 * ## Why the predicate is the clarify's own ask
 *
 * The copy asks for exactly two things: a target value, or a direction
 * ("set to N" / "lower by N"). So the honest gate is: does the message
 * already contain a value or a direction? If it does, the clarify is a lie
 * and the turn belongs to the LLM lane. `assertProposeCopyAsksForValueOrDirection`
 * below is the anti-drift pin (trap-12): if the copy is ever reworded to ask
 * for something else, the test that calls it fails rather than silently
 * leaving this predicate measuring the wrong thing.
 *
 * Safe-biased, exactly like the sibling detectors: a false positive costs one
 * edit-lane turn (the edit LLM clarifies or no-ops, and the GM referee still
 * gates every mutation it proposes); a false negative is the live nine-turn
 * dead end.
 */

/**
 * A numeric magnitude in any shape the product's own copy suggests: bare
 * number, decimal, thousands-separated, percentage, or currency-prefixed.
 */
const NUMERIC_VALUE = /(?:£|\$|€)\s*\d|\b\d+(?:[.,]\d+)*\s*(?:%|percent|k\b|m\b|bn\b)?|\b\d/;

/**
 * Qualitative assignment targets — the no-digit form of "set X to N".
 * Anchored to `to`/`as` so a bare adjective in prose ("the high-level view")
 * cannot count as a specific.
 */
const QUALITATIVE_ASSIGNMENT =
  /\b(?:to|as)\s+(?:very\s+)?(?:high|low|medium|moderate|strong|weak|none|zero|nil|neutral|positive|negative)\b/;

/**
 * Relative direction with an implied magnitude — the "lower by N" half of the
 * clarify's ask, including the magnitude-word forms that carry no digit.
 */
const DIRECTIONAL_MAGNITUDE =
  /\b(?:double|doubling|halve|halving|triple|tripling)\b|\b(?:raise|lower|increase|decrease|reduce|boost|cut|bump)\b[^.?!]*\b(?:by|to)\b/;

/**
 * Does the message already carry the value or direction the propose-and-confirm
 * clarify is about to ask for?
 *
 * This is deliberately a property of the MESSAGE, not of the resolved target:
 * the question being answered is "would asking the user for specifics be
 * truthful?", and that is false the moment the specifics are present —
 * whatever the deterministic resolver did or did not manage to match them to.
 */
export function messageCarriesValueOrDirection(message: string): boolean {
  if (typeof message !== 'string') return false;
  const normalised = message.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalised.length === 0) return false;
  return (
    NUMERIC_VALUE.test(normalised)
    || QUALITATIVE_ASSIGNMENT.test(normalised)
    || DIRECTIONAL_MAGNITUDE.test(normalised)
  );
}

/**
 * The propose-and-confirm branch's terminate-or-hand-off decision.
 *
 * @param editDescription - the turn's edit request (the raw user message on
 *   the live path).
 * @param hasStoredProposal - whether `invocationInput.pending_proposal`
 *   carried a `proposed_changes` payload. The V4 pipeline persists this into
 *   `conversational_state` and replays it on confirm; when it is present the
 *   deterministic branch genuinely holds something the LLM lane does not, so
 *   it keeps the turn.
 */
export function shouldHandOffProposeToLlmLane(
  editDescription: string,
  hasStoredProposal: boolean,
): boolean {
  if (hasStoredProposal) return false;
  return messageCarriesValueOrDirection(editDescription);
}

// ---------------------------------------------------------------------------
// F-2 — clarify target extraction
// ---------------------------------------------------------------------------

/** Shared normaliser: casefold, strip punctuation, collapse whitespace. */
function normaliseLabelText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * F-2: resolve a clause to a REAL graph label, or to nothing.
 *
 * Live-proven garbling on build 53b817b: `buildProposedChanges` splits the
 * message on `/\band\b|,/` and the trailing clause of
 * "…set its CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55." is
 * "CRM Platform Cost to 0.55.". The old `inferElementLabel` was handed only
 * the RESOLVED target's label as its candidate set — never the graph's label
 * set — so nothing matched and it fell back to echoing the raw clause. The
 * copy builder then BOLDED that echo, presenting
 * "**CRM Platform Cost to 0.55.**" and "**Not anything on the option.**" to
 * the user as entities the system had understood.
 *
 * Rule: a bolded target is a graph entity or it is nothing. Derive it from
 * the graph's own labels (trap-12), never from clause text.
 *
 * Longest match wins so a label that is a prefix of another ("CRM Platform
 * Cost" vs a hypothetical "CRM") cannot shadow the more specific one.
 */
export function resolveClauseLabel(
  clause: string,
  knownLabels: readonly string[],
): string | null {
  if (typeof clause !== 'string') return null;
  const normClause = normaliseLabelText(clause);
  if (normClause.length === 0) return null;

  let best: string | null = null;
  let bestLength = 0;
  for (const raw of knownLabels) {
    if (typeof raw !== 'string') continue;
    const label = raw.trim();
    if (label.length === 0) continue;
    const normLabel = normaliseLabelText(label);
    if (normLabel.length === 0) continue;
    if (!normClause.includes(normLabel)) continue;
    if (normLabel.length > bestLength) {
      best = label;
      bestLength = normLabel.length;
    }
  }
  return best;
}

/**
 * Anti-drift pin for `messageCarriesValueOrDirection` (trap-12: a
 * hand-maintained relationship between two files drifts silently and the
 * drift reads as green).
 *
 * The predicate above is only correct while the propose copy asks for a
 * VALUE or a DIRECTION. Tests call this against the live copy strings; if the
 * copy is reworded to ask for something else, the pin fails loudly instead of
 * leaving the gate measuring the wrong thing.
 */
export function proposeCopyAsksForValueOrDirection(copy: string): boolean {
  if (typeof copy !== 'string') return false;
  const normalised = copy.toLowerCase();
  return (
    normalised.includes('specific value or direction')
    || normalised.includes('target value')
    || normalised.includes('exact changes')
    || normalised.includes('exact change')
  );
}
