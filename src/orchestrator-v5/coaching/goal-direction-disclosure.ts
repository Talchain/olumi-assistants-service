/**
 * ⭐⭐ THE OBJECTIVE-SENSE DISCLOSURE — the product says it read your goal as a
 * quantity to REDUCE, because that reading decides which option leads.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GAP THIS CLOSES, MEASURED.
 *
 * #1680 made CEE attest a reduce-goal to the engine as `goal_direction:
 * 'minimise'`. It is the right fix — without it ISL runs its maximiser
 * unattested and, for a goal that is a quantity to reduce, crowns the WORST
 * option. Measured live against deployed PLoT, same graph and same seed:
 *
 *     control (field absent)       opt_low 0.025   opt_high 0.975   <- the WRONG option
 *     goal_direction: 'minimise'   opt_low 0.975   opt_high 0.025   <- the ranking flips
 *
 * ⛔ AND THE USER IS NEVER TOLD. Measured at `staging`: outside tests
 * `goal_direction` occurs ONLY at the outbound PLoT payload
 * (`run-analysis.ts`) and one log line. Contrast control: `goal_node_id`
 * appears in `src/schemas/analysis-ready.ts`, a user-facing schema — so the
 * probe does see disclosed fields. Nothing carries it back.
 *
 * Reading *"Reduce monthly churn"* as *minimise* is an INFERENCE ABOUT THE
 * USER'S OWN OBJECTIVE, and it silently decides the leader. The product
 * charter is explicit that this class must be visible:
 *
 *   > *"Olumi is explicit about what it knows, what it inferred and where its
 *   > limits are. Its own assumptions, estimates, causal claims and
 *   > alternatives remain distinguishable, appropriately uncertain and open to
 *   > correction."*
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ FOUR THINGS THIS COPY MAY NOT DO, each for a reason this estate has paid
 * for at least once.
 *
 *   1. NAME OR IMPLY A LEADING OPTION, and carry no shape that varies with any
 *      option's position. It varies with NOTHING — it is one fixed sentence
 *      pair, emitted or not. There is nothing to probe for.
 *
 *   2. CARRY A DECIMAL. `assistant-text-defences.ts` applies
 *      `RAW_DECIMAL_REGEX = /\d+\.\d+/` to the WHOLE assistant_text, so one
 *      number here would get the entire disclosure-bearing summary rejected at
 *      egress and silently replaced by the locked template. This copy contains
 *      no digits at all.
 *
 *   3. INVITE A CORRECTION THE USER CANNOT MAKE. This is the failure the same
 *      product already commits elsewhere — *"Which factor does \"49\"
 *      correspond to in the decision model?"* asks the user to explain their
 *      own number back to the product. The direction is derived from the goal
 *      node's LABEL and from nothing else, so RENAMING THE GOAL is a real,
 *      available, single-step correction, and that is what the copy names.
 *
 *   4. CLAIM THE READING IS CERTAIN, or that it was the user's instruction.
 *      It says where the reading came from — the wording — so the person can
 *      tell an inference from something they set.
 *
 * ⭐ IT FIRES ONLY WHEN THE ATTESTATION WAS ACTUALLY SENT. The trigger is the
 * emitted value itself, not a re-derivation from the label: a second authority
 * answering "is this a reduce goal?" is how the disclosure and the wire come to
 * disagree (trap 21). If nothing was attested there is nothing to disclose, and
 * `maximise` is never emitted by `deriveEmittedGoalDirection` by construction.
 */

import { passesAssistantTextContentDefences } from './assistant-text-defences.js';
import type { EmittedGoalDirection } from '../goal-target/goal-direction.js';

/**
 * ⚠ THE GRAMMAR BELOW IS ESCAPED FROM THESE VERY CONSTANTS, so a copy edit
 * breaks the build-time probe loudly instead of breaking the wire silently.
 */
const READING =
  ' Your goal reads as a quantity to reduce, so a smaller result counts as better in this comparison.';
const PROVENANCE = ' That is how the goal is worded, not something you set.';
const REPAIR = ' Rename the goal if it is not what you meant.';

function composeDisclosure(): string {
  return `${READING}${PROVENANCE}${REPAIR}`;
}

/** Local regex-literal escape (kept local to avoid an import cycle). */
function escapeForRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Grammar source for the disclosure suffix, consumed by the registry-side
 * egress allowlist (`isAllowedRunAnalysisAssistantText`, via
 * `TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS`) and by this module's own survival
 * probe.
 *
 * ONE FIXED SHAPE — there is no slot, because there is no quantity to report.
 * It cannot match the empty string (the leading space and the sentences are all
 * required), which the anchored template branch of the allowlist depends on.
 */
export const GOAL_DIRECTION_DISCLOSURE_RE_SRC = escapeForRegex(composeDisclosure());

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * builder's own output, never hand-estimated, so an honest disclosure cannot
 * silently knock the summary back to the locked template on length.
 */
export const GOAL_DIRECTION_DISCLOSURE_MAX_CHARS = composeDisclosure().length;

let suffixExactRegex: RegExp | null = null;
function SUFFIX_EXACT_REGEX(): RegExp {
  suffixExactRegex ??= new RegExp(`^(?:${GOAL_DIRECTION_DISCLOSURE_RE_SRC})$`);
  return suffixExactRegex;
}

function survivesEgress(suffix: string): boolean {
  if (suffix.includes('\n') || suffix.includes('\r')) return false;
  if (!SUFFIX_EXACT_REGEX().test(suffix)) return false;
  return passesAssistantTextContentDefences(suffix);
}

/**
 * Disclose the objective sense the run actually attested.
 *
 * @param emitted the value `deriveEmittedGoalDirection` returned for this run —
 *   `undefined` when nothing was attested, which is the common case.
 * @returns the suffix, or `''` when there is nothing to disclose.
 */
export function buildGoalDirectionDisclosure(
  emitted: EmittedGoalDirection | null | undefined,
): string {
  if (emitted !== 'minimise') return '';
  const suffix = composeDisclosure();
  // A composed suffix that would not survive its own published grammar must not
  // ship: the allowlist would reject the WHOLE summary and the person would
  // receive the locked template — strictly worse than telling them nothing.
  // Unreachable while the constants and the grammar agree, which the build-time
  // probe below pins.
  return survivesEgress(suffix) ? suffix : '';
}

/**
 * BUILD-TIME PROBE — this module's copy must survive its own egress and its own
 * derived budget. Evaluated at module load, so a copy edit that breaks either
 * invariant throws at import rather than degrading the wire. Same construction
 * as `separability-disclosure.ts` and `intake-option-disclosure.ts`, for the
 * same stated reason: without it, the only symptom of a broken disclosure is a
 * telemetry rate nobody had a reason to look at.
 */
export const GOAL_DIRECTION_DISCLOSURE_SURVIVES_EGRESS: true = (() => {
  const shape = composeDisclosure();
  if (!survivesEgress(shape)) {
    throw new Error(
      `goal-direction-disclosure: composed suffix does not survive its own published ` +
        `grammar — the allowlist would reject it and the user would silently receive ` +
        `the locked template. Offending shape: ${shape}`,
    );
  }
  if (shape.length > GOAL_DIRECTION_DISCLOSURE_MAX_CHARS) {
    throw new Error(
      `goal-direction-disclosure: composed suffix exceeds its own derived budget ` +
        `(${shape.length} > ${GOAL_DIRECTION_DISCLOSURE_MAX_CHARS}).`,
    );
  }
  return true as const;
})();
