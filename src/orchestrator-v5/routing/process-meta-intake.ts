/**
 * Round-1 process-meta intake guard (META-DECISION-DIAGNOSIS-2026-07-20).
 *
 * THE DEFECT THIS KILLS: the product's own coaching spark chips (UI
 * `pre-analysis-v3`) arrive as anonymous free text (`source='chip'`, no
 * `chip.action_type` — the wire's `chip.action_type` enum at
 * `@talchain/schemas` 0.19.0 has no coaching/readiness intent value, so the
 * UI has nothing to send). CEE's draft-shape heuristic
 * (`isDraftShapedText`: length ≥ 30 AND decision-verb-or-trailing-`?`) then
 * misreads them as decision briefs on an empty canvas, the clarify round
 * captures the question AS the working brief, and the drafter faithfully
 * models the meta-decision ("should we run the analysis?") — reproduced
 * live 2026-07-20 (scenario c1e6e5d7, replay 7e1f0000-…-202607200001).
 *
 * The clarify RESUME path already refuses to fold "a question back to us"
 * into the brief (`CLARIFY_V2_QUESTION_REPLY_PATTERN`, clarify-v2/
 * preflight.ts). Round-1 intake had NO equivalent — this module is that
 * missing guard, applied by route-v2:
 *
 *   1. as an exclusion term in `draftShapedTurn` (a process-meta question
 *      never opens a draft dispatch or a clarify round, and can never
 *      REPLACE a live round's working brief), and
 *   2. as a deterministic ANSWER branch ahead of the frame-stage no-brief
 *      guard (which would otherwise answer with the canned "I need a
 *      single decision question" prompt AND seed a C3 draft offer with the
 *      meta-question as the brief seed — re-creating the poisoned-brief
 *      defect one tap later).
 *
 * PRECISION BIAS (ratified in the diagnosis): over-blocking a genuine
 * decision brief is a WORSE defect than the one this fixes. The typed
 * pattern is deliberately narrow; false negatives fall through to the
 * pre-existing behaviour. "Should I hire a founding engineer or contract
 * the build out?" MUST still draft — pinned in
 * routing/__tests__/process-meta-intake.test.ts.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

/**
 * The product's own coaching prompts, byte-verbatim from DecisionGuideAI
 * `src/canvas/components/pre-analysis-v3/constants.ts` (ACTIONS_MENU +
 * SPARK_PROMPTS, deduplicated; staging tip 8007d03d at capture,
 * 2026-07-20). Every entry is product-authored text that reaches CEE as an
 * anonymous user message today.
 *
 * ⚠ HAND-MAINTAINED CROSS-REPO MIRROR — acknowledged, not accidental
 * (trap 12, "derive, don't mirror"). CEE cannot derive the UI's constants
 * at runtime, so this list is pinned instead:
 *   - the CEE test pins every string byte-verbatim with a pointer to the
 *     UI file, so a silent edit HERE goes RED against the test;
 *   - the UI workstream owns the counterpart contract test (every spark
 *     ships explicit intent metadata) so NEW sparks cannot regress to
 *     anonymous text;
 *   - drift fails SAFE: a UI prompt missing from this list gets today's
 *     (pre-fix) routing, never a new failure mode.
 * The real class-killer is wire-level intent (a chip action_type for
 * coaching/readiness), blocked on a `@talchain/schemas` addition — see the
 * lane notes (INTAKE-FIX-LANE-2026-07-20.md).
 */
export const PRODUCT_COACHING_PROMPTS: readonly string[] = [
  // ACTIONS_MENU
  'Is this the right question to be asking, and does it fit my wider goals?',
  'Suggest materially different options that work through a different mechanism from the ones I already have.',
  'Take the outside view on this decision: what do similar decisions and base rates suggest?',
  'Run a pre-mortem with me: imagine this choice failed a year from now. What went wrong?',
  'What risks and best-case upsides are missing from my model?',
  'Help me check the estimates that matter most to the analysis.',
  'Compare my view of this decision with yours. Where do we differ, and why?',
  'What should I check before running the first analysis?',
  // SPARK_PROMPTS (entries not already in ACTIONS_MENU)
  'Help me define a measurable success target for this goal.',
  'You flagged a possible blind spot in how my model leans. Help me think it through.',
];

/**
 * Match-insensitive normalisation for the known-prompt comparison: trim,
 * collapse internal whitespace, lower-case. Deliberately does NOT strip
 * punctuation — the prompts are compared as sentences, and a user who
 * re-typed one with different punctuation is handled by the typed pattern
 * (or falls through, which is safe).
 */
function normalisePrompt(message: string): string {
  return message.trim().replace(/\s+/g, ' ').toLowerCase();
}

const KNOWN_PROMPTS_NORMALISED: ReadonlySet<string> = new Set(
  PRODUCT_COACHING_PROMPTS.map(normalisePrompt),
);

/**
 * Narrow typed-variant pattern for genuinely typed process-meta questions
 * (diagnosis §5 P1). Two arms, both requiring a single-question message
 * (no internal `?`) ending in `?`:
 *
 *   A. "What should I check/do/know/prepare/need … before … the
 *      analysis/model/draft" — the reproduced defect shape. The process
 *      word is REQUIRED after "before", so "What should I check before
 *      buying the house?" (a genuine brief opener) never matches.
 *   B. "How does the/this/your analysis|model|draft|simulation|tool work"
 *      (+ the bare "how does Olumi work" form). The determiner must be
 *      ADJACENT to the process word, so "How does the competitor's
 *      pricing model work?" stays with the pre-existing routing.
 *
 * Interrogative openers that are ALSO decision verbs ("should", "shall",
 * "whether") are deliberately NOT accepted as arm openers: "Should we run
 * the analysis before hiring?" falls toward draft, per the precision bias.
 */
export const PROCESS_META_TYPED_PATTERN: RegExp = new RegExp(
  [
    // Arm A — pre-analysis preparation questions.
    String.raw`^\s*(?:what|which|is\s+there\s+anything|anything(?:\s+else)?)\b[^?]*\b(?:check|do|know|prepare|review|need|have|complete|set\s+up|get\s+ready)\b[^?]*\bbefore\b[^?]*\b(?:analysis|analyse|analysing|model(?:ling)?|draft(?:ing)?)\b[^?]*\?\s*$`,
    // Arm B — how-does-the-product-work questions.
    String.raw`^\s*(?:how\s+(?:does|do|will|would)|can\s+you\s+explain\s+how)\b[^?]*\b(?:(?:the|this|your)\s+(?:analysis|model(?:ling)?|draft(?:ing)?|simulation|tool)|olumi)\b[^?]*\bworks?\b[^?]*\?\s*$`,
  ].join('|'),
  'i',
);

/**
 * Is this round-1 message a question TO the assistant about the product /
 * process (rather than a decision brief)? True for the product's own
 * coaching prompts (exact, normalised) and for the narrow typed shapes
 * above. Pure and total.
 */
export function isProcessMetaIntake(message: string): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  if (KNOWN_PROMPTS_NORMALISED.has(normalisePrompt(trimmed))) return true;
  return PROCESS_META_TYPED_PATTERN.test(trimmed);
}

/**
 * Stable copy marker for tests/telemetry greps: the deterministic answer
 * always contains this phrase.
 */
export const PROCESS_META_ANSWER_MARKER = 'a model on the canvas';

/**
 * Deterministic empty-canvas answer. Honest by construction: on the state
 * this branch claims (fresh scenario, unpopulated canvas) CEE's own
 * readiness machinery (`computeStructuralReadiness`) has nothing to score —
 * there is no goal node — so the true readiness signal IS "no model yet",
 * and the checklist below names exactly what the analysis gates check
 * (decision + ≥2 options, a goal with a measurable target, factors with
 * estimates). Richer readiness-derived coaching for populated canvases
 * deliberately stays with the LLM path (TurnExecutor), which this branch
 * never claims.
 *
 * House style: British English, no em dashes. Must stay clear of
 * FORBIDDEN_USER_FACING_PHRASES (no change-denial phrasing).
 * NO suggested_actions: a "Build the model" offer here would need a brief
 * seed, and the only candidate seed is the meta-question itself — the
 * exact poisoned-brief defect this module exists to prevent.
 */
export function composeProcessMetaIntakeResponse(): OlumiResponse {
  const assistantText =
    'Happy to help with that. This decision does not have ' +
    'a model on the canvas yet, so there is nothing for me to analyse or review so far. ' +
    'A first analysis needs four things in place: the decision question itself, at least ' +
    'two options you are genuinely weighing up, a goal with a measurable target to judge ' +
    'the options against, and the factors you believe drive the result, with rough ' +
    'estimates or ranges. ' +
    'The first step is the model. Tell me the decision you are weighing up, in a sentence ' +
    'or two, and I will draft it for you. Once it is on the canvas, ask me again and we ' +
    'will work through the checks together before you run the analysis.';
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}
