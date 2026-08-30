/**
 * Scenario setup + producer-bound extraction helpers.
 *
 * EVERY value a case asserts against is derived from the PRODUCER's own
 * output, never from a string this file invented. That distinction is the
 * whole point: a fixture you wrote yourself is not evidence about the wire,
 * because it silently encodes your model of the producer rather than the
 * producer (CLAUDE.md trap 16, inverse form).
 *
 * So `deriveAskedPair()` does not simply regex a sentence. It regexes the
 * sentence and then BINDS the result by identity to `analysis_ready.options[]`,
 * refusing to return a pair whose option label the producer does not also
 * report as an option. A regex alone would happily match a sentence that
 * mentioned any two quoted strings; the identity cross-check is what makes the
 * extraction about the model under test rather than about English punctuation.
 */

import { analysisReady, assistantText, suggestedActions } from './wire.mjs';

/**
 * A brief that states every option's value explicitly.
 * Empirically (30 Aug, caceba1a) yields `analysis_ready.status === 'ready'`:
 * nothing is pending, so this is the ZERO-BLOCKER world.
 */
export const BRIEF_FULLY_SPECIFIED =
  'We are deciding whether to raise our SaaS seat price. Options: hold at 45, ' +
  'partial increase to 55, full increase to 65. Factors: monthly price per seat, ' +
  'churn rate, new signups, revenue.';

/**
 * A brief that names options WITHOUT stating their effect values.
 * Empirically yields `analysis_ready.status === 'needs_user_input'` and an
 * assistant_text carrying `confirm the effect value for "<option>" on "<factor>"`.
 * This is the PENDING-ASK world.
 */
export const BRIEF_PENDING_ASK =
  'We are deciding whether to raise our SaaS seat price. Options: hold at current ' +
  'price, or a partial increase. Factors: monthly price per seat, churn rate, ' +
  'new signups, revenue.';

/** A structurally different domain, for controls that must not share vocabulary. */
export const BRIEF_WAREHOUSE =
  'Should we open a second warehouse? Options: open in Leeds, or stay single-site. ' +
  'It affects delivery time, fulfilment cost, and customer satisfaction.';

/** Draft a fresh scenario from a brief. Returns { scenarioId, response }. */
export async function draft(client, brief, label) {
  const scenarioId = client.newScenario();
  const response = await client.turn({
    scenarioId,
    message: brief,
    stage: 'frame',
    turnClass: 'frame',
    source: 'composer',
    label,
  });
  return { scenarioId, response };
}

/**
 * Draft until the scenario actually reaches the world a case needs.
 *
 * ⚠ WHY THIS EXISTS — measured, not anticipated. The first live run of this
 * harness voided itself: the SAME brief that had produced
 * `analysis_ready.status === 'ready'` minutes earlier produced
 * `needs_user_input` instead. The drafter is non-deterministic about which
 * values it infers, so a case that merely ASSUMES its brief yields a given
 * world will intermittently be testing something else entirely.
 *
 * This is not a weakening of the precondition — the precondition is still
 * asserted afterwards, and still voids the case if unmet. It moves the world
 * from ASSUMED to ACHIEVED, so that a red means "the product got it wrong"
 * rather than "the drafter rolled differently today". A control that silently
 * stops being a control is the exact defect this harness exists to prevent,
 * and the harness found it in its own fixtures on the first run.
 *
 * Bounded: if the world cannot be reached in `attempts` tries, the caller's
 * precondition fails and the case reports COULD_NOT_MEASURE — never a pass.
 */
export async function draftUntil(client, brief, predicate, label, attempts = 3) {
  const tried = [];
  for (let i = 0; i < attempts; i += 1) {
    const scenarioId = client.newScenario();
    const response = await client.turn({
      scenarioId,
      message: brief,
      stage: 'frame',
      turnClass: 'frame',
      source: 'composer',
      label: `${label}-attempt${i + 1}`,
    });
    tried.push({ attempt: i + 1, status: analysisStatus(response.body), http: response.status });
    if (response.ok && predicate(response.body)) {
      return { scenarioId, response, attempts: i + 1, tried, reached: true };
    }
  }
  return { scenarioId: null, response: null, attempts, tried, reached: false };
}

/**
 * The product's own pending effect-value ask, bound by identity.
 *
 * Returns null when there is no such ask — which is a legitimate world, not an
 * error. The caller decides whether null is the arm's failure or the control's
 * requirement.
 */
export function deriveAskedPair(body) {
  const text = assistantText(body);
  if (!text) return null;

  // The producer's phrasing at caceba1a. Matched loosely on the connective so a
  // copy tweak degrades to "no pair found" (→ COULD_NOT_MEASURE) rather than to
  // a silent wrong match.
  const m = text.match(/effect value for\s+"([^"]+)"\s+on\s+"([^"]+)"/i);
  if (!m) return null;

  const optionLabel = m[1].trim();
  const factorLabel = m[2].trim();
  if (!optionLabel || !factorLabel) return null;

  // ---- IDENTITY BINDING --------------------------------------------------
  // The option named in the prose must be an option the producer reports.
  // Without this, the pair is just "two quoted strings in a sentence".
  const ar = analysisReady(body);
  const options = (ar && Array.isArray(ar.options) ? ar.options : []);
  const matched = options.find(
    (o) => String(o.label || '').trim().toLowerCase() === optionLabel.toLowerCase(),
  );
  if (!matched) return null;

  return {
    optionLabel,
    factorLabel,
    optionId: matched.option_id,
    boundBy: 'analysis_ready.options[].label identity match',
  };
}

/**
 * Does this scenario currently hold a pending user-input state?
 * Read from the producer's own status field, never inferred from prose.
 */
export function isPendingUserInput(body) {
  const ar = analysisReady(body);
  return Boolean(ar && ar.status === 'needs_user_input');
}

export function analysisStatus(body) {
  const ar = analysisReady(body);
  return ar ? ar.status : undefined;
}

/** Option labels the producer reports, for identity-bound assertions. */
export function optionLabels(body) {
  const ar = analysisReady(body);
  return (ar && Array.isArray(ar.options) ? ar.options : []).map((o) => String(o.label || ''));
}

/** Node labels from the drafted graph, for inventory/version cases. */
export function nodeLabels(body) {
  const g = body && body.draft_graph;
  if (!g || !Array.isArray(g.nodes)) return [];
  return g.nodes.map((n) => String(n.label || ''));
}

export function nodeCount(body) {
  const g = body && body.draft_graph;
  return g && typeof g.node_count === 'number' ? g.node_count : (g && Array.isArray(g.nodes) ? g.nodes.length : undefined);
}

/**
 * The readiness blocker list.
 *
 * ⚠ LOCATION DERIVED, NOT INHERITED. The obvious guess — `analysis_ready.blockers`
 * — DOES NOT EXIST on this wire: `analysis_ready` carries
 * {status, may_run, options, model_adjustments, freshness, ...} and no blockers
 * key at all. The real list is `analysis_state.readiness.blockers`. A
 * precondition pinned to the guessed path would read `undefined`, compare
 * falsy, and silently never pin anything — a guard agreeing with itself.
 */
export function readinessBlockers(body) {
  const st = body && body.analysis_state;
  const r = st && st.readiness;
  return r && Array.isArray(r.blockers) ? r.blockers : null;
}

/** `analysis_state.run_state.kind` — the oracle for "did a run actually complete?". */
export function runStateKind(body) {
  const st = body && body.analysis_state;
  return st && st.run_state ? st.run_state.kind : undefined;
}

/** `analysis_state.leader_claim` — watched for the permitted/withheld instability. */
export function leaderClaim(body) {
  const st = body && body.analysis_state;
  return (st && st.leader_claim) || null;
}

export function configureChips(body) {
  return suggestedActions(body).filter((a) => String(a.id || '').includes('configure_option'));
}
