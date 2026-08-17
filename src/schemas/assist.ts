import { z } from "zod";
import { Graph } from "./graph.js";
import { CausalClaimsArraySchema } from "./causal-claims.js";
import { BiasType, TopologyPlanSchema, StrengthenItemActionType, GoalThresholdFrame } from "@talchain/schemas";

/**
 * Minimum brief length for draft_graph input validation.
 *
 * Changing this requires verifying that the preflight short-input exemption
 * (≤2-word all-letter inputs bypass coverage check) handles sub-30-char
 * briefs gracefully. See: preflight calibration brief, March 2026
 * (src/cee/validation/preflight.ts)
 *
 * Consumed by:
 *   - DraftGraphInput Zod (brief: z.string().min(DRAFT_GRAPH_MIN_BRIEF_LENGTH))
 *   - ClarifyBriefInput Zod (same)
 *   - V5 route-v2 dispatch trigger (isDraftGraphShape heuristic)
 *
 * TODO (backlog): Consider reducing to allow short valid decision questions
 * like "Should I hire?" (14 chars) or "Expand to EU?" (13 chars) that
 * currently fail here before reaching preflight readiness scoring.
 */
export const DRAFT_GRAPH_MIN_BRIEF_LENGTH = 30;
export const DRAFT_GRAPH_MAX_BRIEF_LENGTH = 5000;

/**
 * Positive decision-brief shape regex — common decision verbs or a trailing
 * question mark.
 *
 * CANONICAL definition (ROADMAP 2.63 C1/C2). This regex previously existed
 * as two hand-synced twins: a module-local copy in
 * `src/orchestrator/route-v2.ts` (the draft_graph dispatch heuristic) and
 * `BRIEF_SEED_DECISION_REGEX` in
 * `src/orchestrator-v5/session/derive-brief-seed.ts` (the brief_text seed
 * gate), each carrying a "keep the two in sync" comment. Both now derive
 * from this single export, alongside the explicit-generate brief assembler
 * (`src/orchestrator-v5/routing/assemble-explicit-generate-brief.ts`).
 * Lives here with the brief length constants so no consumer has to import
 * the HTTP route module.
 *
 * See `tests/integration/orchestrator/route-v2-draft-graph.test.ts` for
 * regression cases including known false negatives.
 */
export const DECISION_VERB_ALTERNATION_SOURCE =
  "should|shall|whether|versus|vs\\.?|choose|decide|expand|invest|launch|hire|fire|buy|sell|acquire|pivot|layoff|restructure";

export const DRAFT_GRAPH_DECISION_BRIEF_REGEX = new RegExp(
  `\\b(${DECISION_VERB_ALTERNATION_SOURCE})\\b|\\?$`,
  "i",
);

/** The decision-verb arm ALONE — the `\?$` arm's absence is the point. */
export const DRAFT_GRAPH_DECISION_VERB_REGEX = new RegExp(
  `\\b(?:${DECISION_VERB_ALTERNATION_SOURCE})\\b`,
  "i",
);

/**
 * INV-Q (ROADMAP 2.715) — the interrogative-opener alphabet.
 *
 * CANONICAL. `CLARIFY_V2_QUESTION_REPLY_PATTERN`
 * (`orchestrator-v5/clarify-v2/preflight.ts`) IS the pattern below, re-exported
 * under its historical name — not a copy of it. It lives here so the round-1
 * intake path can consult the same discriminator the clarify RESUME path has
 * always used, which is exactly the asymmetry `process-meta-intake.ts:15-18`
 * records: "the clarify RESUME path already refuses to fold a question back to
 * us into the brief; round-1 intake had NO equivalent."
 */
export const INTERROGATIVE_OPENER_ALTERNATION_SOURCE =
  "what|why|how|who|whom|whose|when|where|which|can|could|do|does|did|is|are|was|were|will|would|should|shall|whether";

/** Interrogative opener + trailing `?`. */
export const INTERROGATIVE_QUESTION_PATTERN = new RegExp(
  `^\\s*(?:${INTERROGATIVE_OPENER_ALTERNATION_SOURCE})\\b[\\s\\S]*\\?\\s*$`,
  "i",
);

const INTERROGATIVE_OPENER_CAPTURE = new RegExp(
  `^\\s*(${INTERROGATIVE_OPENER_ALTERNATION_SOURCE})\\b`,
  "i",
);

/**
 * The decision verbs that are ALSO interrogative openers AND are ordinary
 * advice modals outside the opener slot.
 *
 * WHY A POSITIONAL RULE RATHER THAN "no decision verb anywhere". Measured at
 * `8c316b5e` against the derivation's own corpus: 10 of the 11 questions that
 * capture as briefs carry no decision verb, but the eleventh —
 * "What should I be checking before I run this?" — carries `should`. A flat
 * "no decision verb anywhere" rule therefore leaves 1 of 11 capturing, and the
 * derivation's claim that "none contains a decision verb" is false. `should`
 * and `shall` are decision-BEARING when they OPEN the question ("Should we
 * expand into Germany?") and are advice modals everywhere else ("What should I
 * be checking?"). That is the same positional distinction
 * `process-meta-intake.ts:119-121` already draws when it refuses these words
 * as ARM OPENERS.
 *
 * ⚠ `whether` is in the same intersection and is DELIBERATELY NOT here — and
 * the exclusion is TESTED, not implicit. It is a choice marker (a sibling of
 * `versus`), not an advice modal: demoting it would strand
 * "Can you help me work out whether to migrate the CRM or stay?", and
 * over-blocking a genuine brief is the worse defect (the ratified precision
 * bias, META-DECISION-DIAGNOSIS-2026-07-20).
 *
 * The list is checked against BOTH source alphabets at module load — a derived
 * guard cannot prove a hand-written list is RIGHT, but it can prove it has not
 * drifted out of the lists it claims to be an intersection of (trap 12d), and
 * a corpus in `__tests__/question-to-assistant.test.ts` is the other half.
 */
export const AMBIGUOUS_MODAL_DECISION_VERBS: readonly string[] = ["should", "shall"];

const UNAMBIGUOUS_DECISION_VERB_ALTERNATION = (() => {
  const verbs = DECISION_VERB_ALTERNATION_SOURCE.split("|");
  const openers = INTERROGATIVE_OPENER_ALTERNATION_SOURCE.split("|");
  for (const modal of AMBIGUOUS_MODAL_DECISION_VERBS) {
    if (!verbs.includes(modal) || !openers.includes(modal)) {
      throw new Error(
        `AMBIGUOUS_MODAL_DECISION_VERBS: '${modal}' must be a member of BOTH the ` +
          `decision-verb alternation and the interrogative-opener alternation — ` +
          `it is the intersection that makes it ambiguous. Remove it, or restore the source list.`,
      );
    }
  }
  return verbs.filter((v) => !AMBIGUOUS_MODAL_DECISION_VERBS.includes(v)).join("|");
})();

const UNAMBIGUOUS_DECISION_VERB_REGEX = new RegExp(
  `\\b(?:${UNAMBIGUOUS_DECISION_VERB_ALTERNATION})\\b`,
  "i",
);

/**
 * SUBJECT-POSITIONAL RULE (PR #1002 fix round, 2026-08-17) — a decision verb
 * whose SUBJECT is the assistant is not decision-BEARING.
 *
 * The execution-proven blocker: "How do you decide which factors matter in
 * the analysis?" and "How does Olumi decide which options to include?" carry
 * `decide`, so the unambiguous-verb escape below rescued them from deflection
 * — and under draft-first intake the cost of that pre-existing
 * misclassification rose from a recoverable question list to a fabricated
 * model + auto-run with the human checkpoint removed.
 *
 * Same positional philosophy as AMBIGUOUS_MODAL_DECISION_VERBS above: the
 * WORD is not the signal, its GRAMMATICAL SLOT is. `decide` with subject "we"
 * frames the user's decision; `decide` with subject "you"/"Olumi" asks about
 * the PRODUCT's behaviour. The construction matched here is
 * `aux + you|olumi + [one optional intervening word] + unambiguous-verb`,
 * derived from the same single-source alternations as everything else in
 * this file. The optional single word is forced by a measured case — the
 * product's own bias-library copy "Would you STILL choose to invest…?" — and
 * is deliberately capped at ONE: each widening of this predicate needs its
 * own opposite-direction twins (traps 22b/22f), and the corpus in
 * `__tests__/question-to-assistant.test.ts` A7 carries the current set
 * (including "Do you think we should buy the warehouse?", which must STILL
 * draft — "think" is not a decision verb, and `we` owns `buy`).
 *
 * KNOWN RESIDUAL, recorded rather than hidden: two or more intervening words
 * ("Would you ever really choose…?") are not matched and such a message will
 * draft — the precision-bias direction (META-DECISION-DIAGNOSIS-2026-07-20)
 * prefers a wrong draft over a stranded genuine brief, and the bounded slot
 * keeps the predicate reviewable.
 *
 * `g` flag: consumed ONLY via `String.replace` (which always scans from the
 * start), never `.test()` — a global regex's `lastIndex` makes `.test()`
 * stateful across calls.
 */
const ASSISTANT_SUBJECT_AUXILIARY_ALTERNATION_SOURCE = "do|does|did|would|will|can|could";
const ASSISTANT_SUBJECT_ALTERNATION_SOURCE = "you|olumi";
const ASSISTANT_SUBJECT_DECISION_VERB_REGEX = (() => {
  const openers = INTERROGATIVE_OPENER_ALTERNATION_SOURCE.split("|");
  for (const aux of ASSISTANT_SUBJECT_AUXILIARY_ALTERNATION_SOURCE.split("|")) {
    if (!openers.includes(aux)) {
      throw new Error(
        `ASSISTANT_SUBJECT auxiliary '${aux}' must be a member of the interrogative-opener ` +
          `alternation — the rule only ever runs inside interrogative-shaped messages.`,
      );
    }
  }
  return new RegExp(
    `\\b(?:${ASSISTANT_SUBJECT_AUXILIARY_ALTERNATION_SOURCE})\\s+` +
      `(?:${ASSISTANT_SUBJECT_ALTERNATION_SOURCE})\\s+` +
      `(?:[a-z]['’a-z]*\\s+)?` +
      `(?:${UNAMBIGUOUS_DECISION_VERB_ALTERNATION})\\b` +
      // Catenative chain: the matched verb's own infinitive complements
      // ("choose TO INVEST in this option") belong to the same
      // assistant-subject construction — consume them so a chained verb
      // cannot re-trigger the escape. Extends only an ALREADY-matched
      // construction; it can never create a match a twin lacks.
      `(?:\\s+to\\s+(?:${UNAMBIGUOUS_DECISION_VERB_ALTERNATION})\\b)*`,
    "gi",
  );
})();

/**
 * INV-Q (ROADMAP 2.715) — is this message a question TO the assistant rather
 * than a decision brief?
 *
 * True when the message is interrogative-shaped (opener from the alphabet
 * above, trailing `?`), its OPENER is not itself a decision verb, and it
 * carries no unambiguous decision verb anywhere. Pure and total. No LLM, and
 * no new vocabulary — both inputs are existing single-source alternations.
 *
 * This inverts the capture default for interrogatives: the `\?$` arm of
 * `DRAFT_GRAPH_DECISION_BRIEF_REGEX` makes EVERY ≥30-char question
 * draft-shaped, which is how the product's own coaching prompts — retyped
 * rather than tapped, so the exact-string mirror misses them — came to be
 * modelled as decisions on an empty canvas.
 */
export function isQuestionToAssistant(message: string): boolean {
  if (typeof message !== "string") return false;
  const trimmed = message.trim();
  if (!INTERROGATIVE_QUESTION_PATTERN.test(trimmed)) return false;
  const opener = INTERROGATIVE_OPENER_CAPTURE.exec(trimmed)?.[1];
  if (opener !== undefined && DRAFT_GRAPH_DECISION_VERB_REGEX.test(opener)) return false;
  // Subject-positional rule (PR #1002 fix round): neutralise decision verbs
  // whose subject is the assistant BEFORE the escape below — "How do you
  // decide…?" stays a question; "Do you think we should buy…?" keeps `buy`
  // (subject "we") and drafts. See ASSISTANT_SUBJECT_DECISION_VERB_REGEX.
  const neutralised = trimmed.replace(ASSISTANT_SUBJECT_DECISION_VERB_REGEX, " ");
  return !UNAMBIGUOUS_DECISION_VERB_REGEX.test(neutralised);
}

/**
 * Draft-shaped TEXT predicate — the length + decision-regex core of the
 * draft heuristic (ROADMAP 1.152(i), maintained-twin fix). This is the
 * SINGLE definition; the null/population-of-graph term is deliberately NOT
 * here — each call site applies its own graph judgement:
 *   - route-v2 `isDraftGraphShape` adds `graphState == null` (plus the
 *     stage/continuation terms);
 *   - route-v2's clarify-v2 gate judges POPULATION instead (A5,
 *     `isPopulatedIngressGraph`);
 *   - clarify-v2-dispatch's resume replacement check uses the text
 *     predicate alone (the round is pre-graph by construction).
 * Previously each of those hand-duplicated the two terms below.
 *
 * ROADMAP 2.715 (INV-Q): a question TO the assistant is never draft-shaped,
 * whatever the `\?$` arm says. Applied HERE rather than at each consumer so
 * every path that asks "would this have drafted?" gets the same answer — the
 * route's dispatch heuristic, its continuation-guard telemetry, and
 * clarify-v2-dispatch's resume replacement check (which is what bars a
 * mid-round question from REPLACING a live round's working brief).
 */
export function isDraftShapedText(message: string): boolean {
  if (isQuestionToAssistant(message)) return false;
  return (
    message.length >= DRAFT_GRAPH_MIN_BRIEF_LENGTH &&
    DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(message)
  );
}

export const DraftGraphInput = z.object({
  brief: z.string().min(DRAFT_GRAPH_MIN_BRIEF_LENGTH).max(DRAFT_GRAPH_MAX_BRIEF_LENGTH),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["pdf", "csv", "txt", "md"]),
        name: z.string()
      })
    )
    .optional(),
  attachment_payloads: z.record(z.any()).optional(), // Attachment content (base64 or { data, encoding })
  constraints: z.record(z.any()).optional(),
  flags: z.record(z.boolean()).optional(),
  include_debug: z.boolean().optional(),
  focus_areas: z
    .array(z.enum(["structure", "completeness", "feasibility", "provenance"]))
    .optional(),
  // Optional structured context for graph generation
  context: z.object({
    goals: z.array(z.string().min(5).max(200)).max(5).optional(),
  }).optional(),
  // Optional refinement context for iterative drafting (Phase B)
  previous_graph: Graph.optional(),
  refinement_mode: z
    .enum(["auto", "expand", "prune", "clarify"])
    .optional(),
  refinement_instructions: z.string().min(1).max(2000).optional(),
  preserve_nodes: z.array(z.string()).max(50).optional(),
  // Clarification enforcement (Phase 5)
  clarification_rounds_completed: z.number().int().min(0).max(3).optional(),
  // Multi-turn clarifier integration — INERT since 2026-07-16: the Stage-4
  // clarifier was retired (ROADMAP 1.94 Option A). These request fields are
  // still accepted for wire compatibility but are ignored by the pipeline.
  clarifier_response: z.object({
    question_id: z.string(),
    answer: z.string(),
  }).optional(),
  conversation_history: z.array(z.object({
    question_id: z.string(),
    question: z.string(),
    answer: z.string(),
  })).optional(),
  max_clarifier_rounds: z.number().int().min(0).max(10).default(5).optional(),
  // Raw output mode - skip all post-processing repairs (factor enrichment, goal repair, etc.)
  // Returns LLM output directly after basic schema validation
  raw_output: z.boolean().optional(),
  // Model selection for different pipeline operations
  // All models must be enabled in MODEL_REGISTRY. Use CLIENT_BLOCKED_MODELS env var to block specific models.
  // Main graph generation model (default: gpt-4o)
  model: z.string().optional(),
  // Graph repair model - used when initial draft needs fixing (default: claude-sonnet-4-20250514)
  repair_model: z.string().optional(),
  // Bias detection model (default: claude-sonnet-4-20250514)
  bias_model: z.string().optional(),
  // Factor enrichment model (default: claude-sonnet-4-20250514)
  enrichment_model: z.string().optional(),
});

// Graph correction tracking schema
export const GraphCorrectionSchema = z.object({
  id: z.string(),
  stage: z.number().int().min(1).max(25),
  stage_name: z.string(),
  layer: z.enum(["adapter", "pipeline", "guards"]),
  type: z.enum([
    "node_added", "node_removed", "node_modified",
    "edge_added", "edge_removed", "edge_modified",
    "kind_normalised", "coefficient_adjusted"
  ]),
  target: z.object({
    node_id: z.string().optional(),
    edge_id: z.string().optional(),
    kind: z.string().optional(),
  }),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string(),
});

export const CorrectionsSummarySchema = z.object({
  total: z.number().int().min(0),
  by_layer: z.object({
    adapter: z.number().int().min(0),
    pipeline: z.number().int().min(0),
    guards: z.number().int().min(0),
  }),
  by_type: z.record(z.string(), z.number().int().min(0)),
});

/**
 * Goal constraint schema for compound goal extraction (Phase 3).
 * Defines a threshold constraint on a target node.
 * PLoT merges explicit goal_constraints[] with compiled constraint nodes.
 */
// CIL Phase 1: all known fields declared — unknown fields stripped
export const GoalConstraintSchema = z.object({
  /** Unique constraint identifier */
  constraint_id: z.string().min(1),
  /** ID of the target node (factor/outcome) this constraint applies to */
  node_id: z.string().min(1),
  /** Comparison operator - ASCII only (>= or <=) */
  operator: z.enum([">=", "<="]),
  /** Threshold value in user units - PLoT normalises */
  value: z.number(),
  /** Human-readable constraint label */
  label: z.string().optional(),
  /** Unit of measurement if known */
  unit: z.string().optional(),
  /** Source quote from brief */
  source_quote: z.string().max(200).optional(),
  /** Extraction confidence (0-1) */
  confidence: z.number().min(0).max(1).optional(),
  /** Provenance marker for UI display */
  provenance: z.enum(["explicit", "inferred", "proxy"]).optional(),
  /**
   * ROADMAP 2.855 / 2.798 — the FRAME `value` is stated in. Channel B's twin
   * of `goal_threshold_frame`, and the field ISL blocks on: absent means
   * UNATTESTED, and ISL omits the ENTIRE constraint_analysis block with a
   * `CONSTRAINT_FRAME_UNSPECIFIED` warning rather than guessing.
   *
   * ⚠ THIS DECLARATION IS LOAD-BEARING, NOT DOCUMENTATION. This object is a
   * plain `z.object` — see the closing "CIL Phase 1: strip unknown fields"
   * comment below — so an undeclared `value_frame` is SILENTLY DELETED at
   * every parse hop between the mint site and the PLoT payload, and the stamp
   * would reach nothing with no error anywhere. Exactly how the
   * `goal_threshold_frame` stamp nearly shipped dark on the node channel.
   *
   * ⚠ NOT DEFAULTED, AND NEVER TO BE. A defaulted frame is a manufactured
   * attestation. Only producers that KNOW their own minting arithmetic stamp
   * this; see `cee/compound-goal/extractor.ts`. Derived from the contract's
   * own enum rather than restated as a local literal union (trap 12).
   */
  value_frame: GoalThresholdFrame.optional(),
  /** Deadline metadata for temporal constraints */
  deadline_metadata: z.object({
    deadline_date: z.string().optional(),
    reference_date: z.string().optional(),
    assumed_reference_date: z.boolean().optional(),
  }).optional(),
}); // CIL Phase 1: strip unknown fields

export type GoalConstraintT = z.infer<typeof GoalConstraintSchema>;

export const DraftGraphOutput = z.object({
  graph: Graph,
  patch: z
    .object({
      adds: z.object({ nodes: z.array(z.any()).default([]), edges: z.array(z.any()).default([]) }).default({ nodes: [], edges: [] }),
      updates: z.array(z.any()).default([]),
      removes: z.array(z.any()).default([])
    })
    .default({ adds: { nodes: [], edges: [] }, updates: [], removes: [] }),
  rationales: z
    .array(
      z.object({ target: z.string(), why: z.string().max(280), provenance_source: z.string().optional() })
    )
    .default([]),
  issues: z.array(z.string()).optional(),
  // clarifier_status is retained for wire compatibility; since the Stage-4
  // clarifier retirement (2026-07-16) the pipeline always emits "complete".
  clarifier_status: z.enum(["complete", "max_rounds", "confident"]).optional(),
  layout: z
    .object({
      suggested_positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() }))
    })
    .optional(),
  debug: z.object({ needle_movers: z.any().optional() }).optional(),
  confidence: z.number().min(0).max(1).optional(),
  /**
   * Goal constraints extracted from compound goals (Phase 3).
   * Populated when brief contains multiple quantitative targets.
   * PLoT merges these with compiled constraint nodes (explicit wins on conflict).
   */
  goal_constraints: z.array(GoalConstraintSchema).optional(),
  /** LLM coaching output — first-class declared contract per
   *  `@talchain/schemas` v0.11.0. `summary` remains nullable here at the
   *  ingestion-stage parse (LLM may emit null when the brief is too thin
   *  for actionable coaching commentary); the canonical `CoachingSchema`
   *  in the shared package requires it as a string. CEE's Stage 5 Package
   *  default at `src/cee/unified-pipeline/stages/package.ts` populates
   *  the empty default when the LLM omits the field.
   *
   *  `widening_log` and `bias_signals` are optional at this ingestion
   *  parse (transitional v192b → v194 rollout); the canonical schema
   *  declares them required. The legacy normaliser at
   *  `src/adapters/llm/normalise-legacy-coaching.ts` converts legacy
   *  array-shape `widening_log` to canonical object shape, but does not
   *  synthesise an empty default when the field is absent — Stage 6 V3
   *  transform handles legacy-absence by emitting the canonical empty
   *  coaching block so the V3 boundary always carries the field.
   */
  coaching: z.object({
    summary: z.string().nullable(),
    strengthen_items: z.array(z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string(),
      action_type: StrengthenItemActionType,
      bias_category: BiasType.optional(),
    }).passthrough()),
    widening_log: z.object({
      elements_added: z.array(z.string()),
      elements_considered_but_excluded: z.array(z.string()),
      brief_completeness: z.enum(["complete", "partial", "thin"]),
    }).passthrough().optional(),
    bias_signals: z.array(z.object({
      type: BiasType,
      detail: z.string(),
    }).passthrough()).optional(),
  }).passthrough().optional(),
  /** LLM causal claims — stated reasoning about effects, mediations, confounders.
   *  Canonical contract lives in `@talchain/schemas` v0.11.0. */
  causal_claims: CausalClaimsArraySchema.optional(),
  /** Topology plan — structural lines describing graph layout, ≤15 lines (soft).
   *  Canonical contract lives in `@talchain/schemas` v0.11.0. Required at the
   *  Anthropic structured-output boundary; optional here for legacy callers
   *  that pre-date v0.11.0. */
  topology_plan: TopologyPlanSchema.optional(),
  // Graph corrections tracking + pipeline repair observability
  trace: z.object({
    // Pipeline repair tracking fields
    draft_graph_produced: z.boolean().optional(),
    simple_repair_executed: z.boolean().optional(),
    repair_loop_attempts: z.number().optional(),
    repair_attempted: z.boolean().optional(),
    // Graph corrections
    corrections: z.array(GraphCorrectionSchema).optional(),
    corrections_summary: CorrectionsSummarySchema.optional(),
  }).passthrough().optional(),
}).passthrough();

export const SuggestOptionsInput = z.object({
  goal: z.string().min(5),
  constraints: z.record(z.any()).optional(),
  graph_summary: z.object({ decision: z.string(), existing_options: z.array(z.string()) }).optional(),
  include_debug: z.boolean().optional()
});

export const SuggestOptionsOutput = z.object({
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(3),
        pros: z.array(z.string()).min(2).max(3),
        cons: z.array(z.string()).min(2).max(3),
        evidence_to_gather: z.array(z.string()).min(2).max(3)
      })
    )
    .min(3)
    .max(5)
});

export const ClarifyBriefInput = z.object({
  brief: z.string().min(DRAFT_GRAPH_MIN_BRIEF_LENGTH).max(DRAFT_GRAPH_MAX_BRIEF_LENGTH),
  round: z.number().int().min(0).max(2).default(0),
  previous_answers: z.array(z.object({
    question: z.string(),
    answer: z.string()
  })).optional(),
  seed: z.number().int().optional(),
  flags: z.record(z.boolean()).optional() // Feature flags (per-request overrides)
}).strict();

export const ReadinessFactors = z.object({
  length_score: z.number().min(0).max(1),
  clarity_score: z.number().min(0).max(1),
  decision_relevance_score: z.number().min(0).max(1),
  specificity_score: z.number().min(0).max(1),
  context_score: z.number().min(0).max(1),
});

export const ClarifyBriefOutput = z.object({
  questions: z.array(z.object({
    question: z.string().min(10),
    choices: z.array(z.string()).optional(),
    why_we_ask: z.string().min(20),
    impacts_draft: z.string().min(20),
    targets_factor: z.enum(["length", "clarity", "decision_relevance", "specificity", "context"]).optional()
  })).min(1).max(5),
  confidence: z.number().min(0).max(1),
  should_continue: z.boolean(),
  round: z.number().int().min(0).max(2),
  // Enhanced readiness assessment (Phase 5)
  readiness: z.object({
    score: z.number().min(0).max(1),
    level: z.enum(["ready", "needs_clarification", "not_ready"]),
    factors: ReadinessFactors,
    weakest_factor: z.enum(["length", "clarity", "decision_relevance", "specificity", "context"]).optional()
  }).optional()
});

export const CritiqueGraphInput = z.object({
  graph: Graph,
  brief: z.string().min(DRAFT_GRAPH_MIN_BRIEF_LENGTH).max(DRAFT_GRAPH_MAX_BRIEF_LENGTH).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["pdf", "csv", "txt", "md"]),
        name: z.string()
      })
    )
    .optional(),
  attachment_payloads: z.record(z.any()).optional(), // Attachment content (base64 or { data, encoding })
  flags: z.record(z.boolean()).optional(), // Feature flags (per-request overrides)
  focus_areas: z.array(z.enum(["structure", "completeness", "feasibility", "provenance"])).optional()
}).strict();

export const CritiqueGraphOutput = z.object({
  issues: z.array(z.object({
    level: z.enum(["BLOCKER", "IMPROVEMENT", "OBSERVATION"]),
    note: z.string().min(10).max(280),
    target: z.string().optional()
  })),
  suggested_fixes: z.array(z.string()).max(5).default([]),
  overall_quality: z.enum(["poor", "fair", "good", "excellent"]).optional()
});

export const ExplainDiffInput = z.object({
  patch: z.object({
    adds: z.object({
      nodes: z.array(z.any()).default([]),
      edges: z.array(z.any()).default([])
    }).default({ nodes: [], edges: [] }),
    updates: z.array(z.any()).default([]),
    removes: z.array(z.any()).default([])
  }),
  brief: z.string().min(DRAFT_GRAPH_MIN_BRIEF_LENGTH).max(DRAFT_GRAPH_MAX_BRIEF_LENGTH).optional(),
  graph_summary: z.object({
    node_count: z.number(),
    edge_count: z.number()
  }).optional()
}).strict();

export const ExplainDiffOutput = z.object({
  rationales: z.array(z.object({
    target: z.string(),
    why: z.string().max(280),
    provenance_source: z.string().optional()
  })).min(1)
});

export const ErrorV1 = z.object({
  schema: z.literal("error.v1"),
  code: z.enum(["BAD_INPUT", "RATE_LIMITED", "INTERNAL"]),
  message: z.string(),
  details: z.record(z.any()).optional()
});

export type DraftGraphInputT = z.infer<typeof DraftGraphInput>;
export type ClarifyBriefInputT = z.infer<typeof ClarifyBriefInput>;
export type CritiqueGraphInputT = z.infer<typeof CritiqueGraphInput>;
export type ExplainDiffInputT = z.infer<typeof ExplainDiffInput>;
export type ExplainDiffOutputT = z.infer<typeof ExplainDiffOutput>;
