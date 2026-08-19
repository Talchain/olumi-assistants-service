/**
 * ⭐ THE TYPED COACHING-INTENT ARM — what makes four MOUNTED, user-visible
 * affordances stop degrading to generic free prose.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * Four strategic-reasoning sparks are on screen today (`pressure_test_frame`,
 * `define_success`, `widen_options`, `reflect_bias` — DGAI
 * `pre-analysis-v3/constants.ts`). Each carries an English `prompt` and
 * `action_type: null`. The UI's send gate (`buildPayload.ts`,
 * `isSendableToken`) requires membership of BOTH `KNOWN_INTENTS` (published in
 * the vendored `Intent` enum) AND `CEE_ACCEPTED_INTENTS` (routed by the
 * deployed service). `CEE_ACCEPTED_INTENTS` held exactly one member,
 * `add_option`, because CEE had NO routing arm for the coaching intents —
 * derived at CEE `877affe2`: `challenge_frame`, `define_success` and
 * `elicit_options` reached ZERO non-test files in `src/` (contrast control
 * `pre_mortem`: 53 files). The gate FAILS CLOSED, so the chip silently
 * degraded to prose. This module is the missing arm.
 *
 * ── ⭐⭐ IT STEERS, IT NEVER SUBSTITUTES — AND THAT IS THE WHOLE DESIGN ──────
 * The obvious implementation is a deterministic responder that answers the
 * clicked method itself. That would be a REGRESSION, and the estate has
 * already shipped that exact shape: the free-prose path reaches the reasoning
 * layer and sometimes answers excellently, and a typed arm returning a canned
 * template replaces a good answer with a worse one.
 *
 * So this arm emits NO user-facing copy of its own. It appends a METHOD
 * DIRECTIVE to the routing turn — the same pure, append-after-`buildUserMessage`
 * seam `buildForcedIntentDirective` already uses for typed analytical pills —
 * and the coach still authors the answer, now with the named method in front of
 * it. The floor is therefore today's prose answer BY CONSTRUCTION: the same
 * model, the same ContextPack, the same tool surface, plus a frame. There is no
 * path through this module that can return less than the LLM would have
 * returned, because this module never returns an answer at all.
 *
 * ── ⭐⭐ WHY MOST OF THESE CARRY NO DSK CITATION, AND WHY THAT IS THE HONEST
 *        ANSWER RATHER THAN A GAP ────────────────────────────────────────────
 * The product's bar is science-grounded coaching with VISIBLE PROVENANCE (the
 * DSK bias cards do this well). The obvious move is to stamp each intent with a
 * `DSK-P-00x` id. Adjudicated against the bundle's own records at
 * `data/dsk/v1.json`, that would be false for three of the four:
 *
 *   - `challenge_frame` — the nearest protocol is DSK-P-005 (Devil's advocate),
 *     whose `required_inputs` are "analysis results showing a dominant factor
 *     or clear winner" and "factor sensitivity data", `stage_applicability`
 *     ["evaluate","decide"]. The spark lives on the PRE-ANALYSIS panel. There
 *     are no analysis results. The protocol does not name this exercise.
 *   - `challenge_assumption` — DSK-P-003 (Disconfirmation) requires "analysis
 *     results showing a clear winner with high win probability". Same wall.
 *   - `define_success` — DSK-P-006 (Implementation intentions) is
 *     `stage_applicability` ["decide"] and explicitly contraindicated "before
 *     the user has decided". Stamping it would cite science that forbids the
 *     use.
 *   - `elicit_options` — DSK-P-004 (Opportunity cost prompting) IS
 *     `stage_applicability` ["frame","ideate"] with `required_inputs`
 *     "current options in the model". This one genuinely fits.
 *
 * CEE #830 is what happens when "the id exists" is answered instead of "does
 * this id name the exercise this card performs". So the citation is attached
 * ONLY when the bundle's OWN `stage_applicability` contains the turn's stage
 * token, compared by EXACT IDENTITY.
 *
 * ⚠⚠ CORRECTED BEFORE MERGE, AND THE CORRECTION IS THE INTERESTING PART. The
 * first version of this docblock asserted that the DSK vocabulary
 * (frame/ideate/evaluate/decide) and the turn vocabulary
 * (frame/analyse/decide/review) are different sets and that "no mapping
 * between them is defined anywhere in this estate". THAT CLAIM IS FALSE — a
 * mapping exists and is live: `mapStageToDecisionStage`
 * (`handlers/edit-graph-dispatch.ts:754-767`) maps
 * `frame→frame, analyse→evaluate, decide→decide, review→optimise`. It was
 * missed because it is a PRIVATE function with exactly ONE caller
 * (`:1944`), invisible to a symbol sweep for the vocabularies themselves.
 * A false claim about our own estate, written into a code comment, is the
 * hand-maintained-mirror defect occurring inside the paragraph warning about
 * it (trap 12); it is corrected here rather than quietly dropped.
 *
 * The BEHAVIOUR still uses exact-token matching, now as a deliberate choice
 * with a named cost rather than a claim of necessity:
 *   - Reusing `mapStageToDecisionStage` would require EXPORTING it from
 *     `edit-graph-dispatch.ts`, which is under a live three-way conflict
 *     (#1029/#1007/#987). This lane does not touch it.
 *   - Copying the map here would be a second authority for one question —
 *     the genuine trap-12 mirror, and the thing that later drifts.
 *   - Exact-token matching agrees with the live map on every cell either can
 *     reach EXCEPT ONE, and that one cell is pinned by a test so it cannot
 *     change silently: `challenge_assumption` at turn stage `analyse`, which
 *     the live map would send to `evaluate` (in DSK-P-003's applicability)
 *     and which this arm instead leaves uncited. It UNDER-serves, never
 *     over-claims — a missing badge, never a wrong one.
 * Whoever exports the shared mapper should delete the exact-token gate and
 * that test together.
 *
 * ⭐ AND THE REACHABILITY QUESTION, DERIVED RATHER THAN ASSUMED. ROADMAP 2.616
 * records DSK-P-004 as blocked because "no live stage maps to `ideate`". That
 * is true of `ideate` and IRRELEVANT here: DSK-P-004 is
 * `stage_applicability: ["frame","ideate"]`, and `frame` IS a live turn stage
 * that maps to itself under both this gate and the live mapper. The citation
 * this arm emits is reachable; the blocked cell is only the `ideate`-ONLY
 * protocols (e.g. DSK-TR-004). Confirming the distinction matters, because
 * inheriting "DSK-P-004 is blocked" would have deleted the one honest badge
 * in this slice (trap 16's inverse — a live path wrongly believed dead).
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO IN THIS SLICE ──────────────────────────
 *   - It emits NO `ExerciseBlock`. The exercise carrier is honest only where a
 *     protocol is applicable AND `exercise_kind` names it; that enum is
 *     ["pre_mortem","outside_view","devils_advocacy","consider_opposite",
 *     "opportunity_cost","implementation_intentions"] and has no member for
 *     `challenge_frame` or `define_success`. A block with a borrowed kind is a
 *     mislabel, not a badge.
 *   - It writes NOTHING to the graph and holds no proposal. These are
 *     conversational coaching intents; there is no handler to pin, so unlike
 *     `buildForcedIntentDirective` this arm does NOT force a tool or pin a
 *     `handler_id`. The coach routes the turn exactly as it does today.
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { loadVerifiedDskBundle } from '../compose/dsk-bundle-record.js';
import type { DSKProtocol } from '../../dsk/types.js';

/**
 * The coaching intents this arm ROUTES. Deliberately NOT the whole `Intent`
 * enum: an intent belongs here only when a MOUNTED affordance sends it and its
 * directive has been written and reviewed. The UI's `CEE_ACCEPTED_INTENTS`
 * must list exactly these and no more — the two registries are the two halves
 * of one send gate, and widening either alone re-creates the silent-drop bug
 * the gate exists to prevent.
 *
 * Provenance per member (the DGAI affordance that sends it):
 *   challenge_frame      — ACTIONS_MENU `pressure_test_frame` + SPARK_PROMPTS.pressureTestFrame
 *   define_success       — SPARK_PROMPTS.defineSuccess (panel-only spark)
 *   elicit_options       — ACTIONS_MENU `widen_options` + SPARK_PROMPTS.widenOptions
 *   challenge_assumption — SPARK_PROMPTS.reflectBias (panel-only spark)
 */
export const ROUTED_COACHING_INTENTS = [
  'challenge_frame',
  'define_success',
  'elicit_options',
  'challenge_assumption',
] as const;

export type RoutedCoachingIntent = (typeof ROUTED_COACHING_INTENTS)[number];

const ROUTED_SET: ReadonlySet<string> = new Set(ROUTED_COACHING_INTENTS);

/**
 * The DSK protocol each intent WOULD perform, when the bundle says it applies.
 *
 * This map answers "which published protocol names this exercise", NOT "is it
 * applicable here" — applicability is the bundle's own
 * `stage_applicability`, read at resolve time and never restated. An intent
 * absent from this map can never carry a citation.
 *
 * `challenge_frame` and `define_success` are ABSENT ON PURPOSE. See the module
 * docblock: no published protocol names either exercise at the stage these
 * sparks fire, and the honest badge is no badge.
 */
const INTENT_PROTOCOL_ID: Partial<Record<RoutedCoachingIntent, string>> = {
  elicit_options: 'DSK-P-004',
  challenge_assumption: 'DSK-P-003',
};

/**
 * The method framing for each routed intent — what the coach is asked to DO.
 *
 * These are directives to the model, never user-facing copy, so they carry no
 * prose-guard obligation; they are written in the same register as
 * `buildForcedIntentDirective`. Each names a concrete, checkable output rather
 * than an attitude: "generic encouragement" is precisely the failure mode the
 * routed arm exists to replace, so every directive demands specifics the user
 * can act on.
 */
const INTENT_METHOD: Record<
  RoutedCoachingIntent,
  { readonly clicked: string; readonly method: readonly string[] }
> = {
  challenge_frame: {
    clicked: 'pressure-test the framing of this decision',
    method: [
      'Name the question the current model is actually answering, in one sentence.',
      'Offer at least two materially different framings of the same situation — not rewordings, framings that would change which options are worth considering.',
      'Say which wider goal each framing serves, and where the current frame may be too narrow, too wide, or solving the wrong problem.',
      'End by asking the user which framing they want to work in, and what would have to change in the model to adopt it.',
    ],
  },
  define_success: {
    clicked: 'define a measurable success target for this decision',
    method: [
      'Propose success criteria that are MEASURABLE: each one needs a named metric, a threshold, and a date or time window.',
      'Distinguish the outcome that would count as success from the leading indicators that would show it arriving early.',
      'Name at least one way the stated target could be hit while the decision still failed, so the measure is not gamed by construction.',
      'Ask the user to confirm or correct the threshold and the date. Never invent a number the user has not stated and present it as theirs.',
    ],
  },
  elicit_options: {
    clicked: 'widen the set of options under consideration',
    method: [
      // ⭐ THE ANALOGICAL STEP IS ADOPTED, NOT INVENTED. It is P-G2's own
      // METHOD STEP in `parallel-briefs/GENERATION-AND-CHALLENGE-POLICY-DESIGN-2026-08-07.md`
      // §A.2, which braids analogical transfer (Gick & Holyoak; Dahl & Moreau
      // 2002, medium) into the alternative-generation protocol rather than
      // giving it a trigger of its own. Writing a different widening prompt
      // here would have been coaching invented in this file while a graded,
      // reviewed one already existed.
      'First ask the user to name a decision structurally like this one, and what options THAT decision had which this one lacks.',
      'Propose options that work through a DIFFERENT MECHANISM from the ones already in the model, not variations on them.',
      'Include the alternatives people routinely omit: doing nothing, deferring the decision, and redirecting the same resources elsewhere.',
      'For each option, say in one line what it gives up — the resources it commits and what those resources could otherwise buy.',
      'Ask which of these the user wants added to the model. The user\'s own options are theirs — never present one you generated as something they said.',
    ],
  },
  challenge_assumption: {
    clicked: 'think through a possible blind spot in how their model leans',
    method: [
      'Take the opposite side of the leaning the user flagged and argue it as strongly as the evidence honestly allows.',
      'Name the specific assumption or estimate that, if wrong, would most change the picture — and say what evidence would settle it.',
      'Separate what the model asserts from what the user has actually observed, and say which is which.',
      'Ask whether the user wants to adjust anything, and be explicit that nothing has been changed.',
    ],
  },
};

/**
 * Read the intent a typed coaching chip declared, or `undefined`.
 *
 * Two independent conditions, both required: a chip-sourced turn AND a routed
 * intent. `payload.chip.intent` is the wire `Intent` value
 * (`@talchain/schemas` `MessageTurnPayloadSchema`) — NOT the UI's `ActionChip.intent`
 * ('primary' | 'secondary' | 'undo'), which is a styling variant that DGAI's
 * `useConversation.sendChip` deliberately does not forward. Two concepts, one
 * name; conflating them is CLAUDE.md trap 21, and it would let a plain styled
 * chip claim a method arm.
 *
 * Pure, total, and does not consult the bundle — an unroutable turn costs one
 * set lookup.
 */
export function resolveCoachingIntent(
  payload: MessageTurnPayload,
): RoutedCoachingIntent | undefined {
  if (payload.source !== 'chip' && payload.source !== 'chip_click') return undefined;
  const intent = payload.chip?.intent;
  if (typeof intent !== 'string') return undefined;
  return ROUTED_SET.has(intent) ? (intent as RoutedCoachingIntent) : undefined;
}

/**
 * The protocol backing this intent AT THIS STAGE, or null.
 *
 * Fail-closed at every step: no mapped id, no readable/verified bundle, no such
 * record, a deprecated record, or a `stage_applicability` that does not contain
 * this exact stage token — all yield null, and the directive is emitted without
 * a citation. A missing citation costs a badge; a wrong one is a lie about
 * science (the `dsk-protocol-record.ts` rule, applied to the prompt side).
 */
export function resolveApplicableProtocol(
  intent: RoutedCoachingIntent,
  stage: string,
): DSKProtocol | null {
  const id = INTENT_PROTOCOL_ID[intent];
  if (id === undefined) return null;

  const bundle = loadVerifiedDskBundle();
  if (bundle === null) return null;

  // The bundle is a flat `objects` array; narrow to the PROTOCOL arm by its
  // discriminant before matching the id. `resolveDskProtocolProvenance` refuses
  // non-protocol ids for the same reason: "the id exists" is not "the id names
  // a protocol" (CEE #830).
  const record =
    (bundle.objects ?? []).find(
      (o): o is DSKProtocol => o.type === 'protocol' && o.id === id,
    ) ?? null;
  if (record === null) return null;
  if (record.deprecated === true) return null;

  // EXACT TOKEN IDENTITY. No cross-vocabulary mapping — see the module
  // docblock. A stage the protocol does not literally list is not applicable.
  const stages: readonly string[] = record.stage_applicability ?? [];
  if (!stages.includes(stage)) return null;

  return record;
}

export interface CoachingDirective {
  /** The text appended to the routing turn. Never user-facing. */
  readonly directive: string;
  /** The cited protocol id, or null when none was applicable. Telemetry only. */
  readonly dskProtocolId: string | null;
}

/**
 * Build the method directive for a routed coaching intent.
 *
 * Shape mirrors `buildForcedIntentDirective`: a markdown heading plus a short
 * instruction block, appended after the pure `buildUserMessage` output so every
 * non-coaching turn stays byte-identical.
 *
 * When a protocol applies, its PUBLISHED TITLE and EXPECTED OUTPUTS are read
 * from the bundle and named to the coach — derived, never restated here, so
 * this file cannot drift from the science it cites (trap 12). The protocol's
 * `steps` are deliberately NOT interpolated: they carry authoring placeholders
 * (`[winning option]`, `[dominant factor]`) that would leak bracket syntax into
 * the model's context.
 */
export function buildCoachingMethodDirective(
  intent: RoutedCoachingIntent,
  stage: string,
): CoachingDirective {
  const spec = INTENT_METHOD[intent];
  const protocol = resolveApplicableProtocol(intent, stage);

  const lines: string[] = [
    '## Requested coaching method (explicit)',
    `The user clicked a button to ${spec.clicked}. Answer THAT request directly, grounded in the decision, the model and the conversation above. Do not answer a different question, and do not reply with general encouragement.`,
    '',
    'Work through this method:',
    ...spec.method.map(step => `- ${step}`),
  ];

  if (protocol !== null) {
    const outputs = (protocol.expected_outputs ?? []).filter(o => typeof o === 'string' && o.length > 0);
    lines.push(
      '',
      `This is the published "${protocol.title}" protocol. Produce what it expects: ${outputs.join('; ')}.`,
    );
  }

  lines.push(
    '',
    'Ground every claim in what the user has actually said or what the model actually contains. Where you are inferring, say so. Never present an invented number as the user\'s.',
  );

  return {
    directive: lines.join('\n'),
    dskProtocolId: protocol === null ? null : protocol.id,
  };
}
