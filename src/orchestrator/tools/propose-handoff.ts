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

import { applyWordNumberPrePass } from '../../orchestrator-v5/context/cqe/word-numbers.js';

/**
 * A numeric magnitude in any shape the product's own copy suggests: bare
 * number, decimal, thousands-separated, percentage, or currency-prefixed.
 */
const NUMERIC_VALUE = /(?:£|\$|€)\s*\d|\b\d+(?:[.,]\d+)*\s*(?:%|percent|k\b|m\b|bn\b)?|\b\d/;

/**
 * Word-number VALUES the digit grammar above cannot see (Codex #10):
 * "set X to seventy percent", "set X to half". Without this the propose branch
 * false-terminates a turn whose specifics are already present — the same
 * claim-then-starve dead end this module exists to close, one word-number
 * phrasing away.
 *
 * Coverage is split deliberately, derive-don't-mirror (trap-12):
 *   - one..ten is reused from CQE's shared word-number pre-pass (imported, not
 *     copied): `applyWordNumberPrePass` folds them to digits the NUMERIC_VALUE
 *     grammar already reads, so "set it to seven" / "ten percent" resolve; and
 *   - the forms that shared pre-pass omits BY DESIGN — it is scoped to one..ten
 *     and excludes fractions, feeding the CQE rule table — are matched below.
 *     CQE's fuller `extractQuantities` does NOT close this gap either (verified
 *     at the bytes 2026-07-21): its compromise backstop drops word-cardinal
 *     tokens (reads `entry.number` as a scalar, but the installed
 *     compromise-numbers returns a nested `{num}` for "seventy") and P5 fires
 *     only on "<verb> by <fraction>", never on a value assignment. English
 *     number words are a CLOSED, stable lexicon, so this short list is not the
 *     moving-target mirror trap-12 warns about.
 *
 * Anchored like the sibling grammars (percent, or a `to`/`as`/`by` slot) so an
 * ordinal in prose ("access to third parties", "the third column") is not read
 * as a value.
 */
const WORD_NUMBER_TOKEN =
  'eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million';
const WORD_NUMBER_VALUE = new RegExp(
  // "<cardinal> percent" — the seventy-percent class, needs no assignment slot.
  `\\b(?:${WORD_NUMBER_TOKEN})\\b\\s*(?:percent|%)`
    // assignment/direction slot: "to/as/by [a] <cardinal>" or "… a <fraction>",
    // plus bare "… half" (rarely an ordinal, unlike third/quarter).
    + `|\\b(?:to|as|by)\\s+(?:`
    + `(?:a\\s+|an\\s+|one\\s+)?(?:${WORD_NUMBER_TOKEN})`
    + `|(?:a\\s+|an\\s+|one\\s+)(?:half|halves|quarter|quarters|third|thirds)`
    + `|half|halves`
    + `)\\b`,
  'i',
);

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
  // Fold CQE's one..ten word-numbers to digits so the NUMERIC_VALUE grammar
  // reads them; the larger cardinals and value-fractions fall to
  // WORD_NUMBER_VALUE (see its doc for why the shared facility stops short).
  const folded = applyWordNumberPrePass(normalised).text;
  return (
    NUMERIC_VALUE.test(normalised)
    || NUMERIC_VALUE.test(folded)
    || QUALITATIVE_ASSIGNMENT.test(normalised)
    || DIRECTIONAL_MAGNITUDE.test(normalised)
    || WORD_NUMBER_VALUE.test(folded)
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
