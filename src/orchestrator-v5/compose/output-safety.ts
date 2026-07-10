/**
 * Output safety — central egress entity-ID leak guard.
 *
 * Defence-in-depth scrubber that runs at the V5 chokepoint (sendFinalised200
 * in route-v2.ts). Catches raw internal entity IDs (e.g. `fac_delivery_cost`)
 * that slipped past every handler-level guard and replaces them with either a
 * resolved human label (when the graph is available) or a prefix-aware generic
 * fallback.
 *
 * Two layers protect user-facing prose:
 *   - Layer 1 (handler-local, e.g. edit-graph.ts): scrubs LLM/PLoT-generated
 *     strings before they enter `assistantText`. Logs the raw ID for triage.
 *   - Layer 2 (this file): scrubs the assembled OlumiResponse before egress.
 *     Logs ONLY the prefix type, never the raw ID.
 *
 * Design notes:
 *   - The exported `ENTITY_ID_LEAK_RE` regex (in entity-id-pattern.ts) is the
 *     single source of truth. We never mutate it; instead we build a per-call
 *     global matcher via `new RegExp(ENTITY_ID_LEAK_RE.source, 'gi')`. Mutating
 *     the source regex would corrupt the 7 `.test()` callsites in patch-summary.ts.
 *   - The base regex over-matches English compounds (`factor_analysis`,
 *     `option_value`, etc.). `isLikelyEntityId` adds a tiered confirmation
 *     gate so legitimate prose is left alone.
 *
 * Scope amendments to the original brief (recorded explicitly):
 *   - `edge_*` IDs are NOT in ENTITY_ID_LEAK_RE and are NOT covered by this
 *     scan. The brief listed `edge_` in the prefix taxonomy, but adding it to
 *     the shared regex requires co-reviewing 7 `.test()` callsites in
 *     patch-summary.ts (where over-matching changes bail-out behaviour in
 *     already-working code paths). Edge IDs in user-facing prose are
 *     vanishingly rare in this codebase (warnings reference nodes, not
 *     edges). Deferred to a separate change with explicit patch-summary
 *     co-review. If you encounter an edge ID leak in user-facing text,
 *     escalate the prefix expansion as a standalone work item.
 *   - Edge LABEL resolution is unsupported. The brief mentioned "node or
 *     edge label" but the canonical `EdgeV3T` schema in
 *     `src/schemas/cee-v3.ts` has no `label` field — only `from`, `to`,
 *     `strength`, `exists_probability`, `effect_direction`. Adding edge
 *     labels is a schema-contract change, not a sanitiser change. Until
 *     then, edge IDs (if their prefix gap above is closed) would always
 *     resolve via the generic-fallback path.
 *
 * Heuristic for distinguishing real IDs from English compounds:
 *   - Short prefixes (`fac`, `opt`, `dec`, `goal`): no English collisions in
 *     these prefixes. Any `fac_<anything>` / `opt_<anything>` etc. is treated
 *     as a confirmed internal ID even with a single-token suffix.
 *   - Risky short prefixes (`out`, `risk`, `con`): English collisions exist
 *     (`out_of_scope`, `risk_adjusted`, `constraint_based`/`con_text`). Apply
 *     the slug-shape gate.
 *   - Full-word prefixes (`factor`, `option`, `decision`, `outcome`,
 *     `constraint`): English compounds are common (`factor_analysis`,
 *     `option_value`). Apply the slug-shape gate.
 */

import type { OlumiResponse, Action, Insight, Block } from '@talchain/schemas/boundary';
import type { GraphV3T } from '../../orchestrator/types.js';
import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';
import { finalizeChips } from './chip-finalizer.js';

// ----------------------------------------------------------------------------
// Per-string scrubber — moved to neutral location so V4 + CEE pipeline can
// import without a V5 dependency edge. Re-exported here for backward
// compatibility with existing V5 callsites that did
// `import { sanitiseUserFacingText } from '.../compose/output-safety.js'`.
// ----------------------------------------------------------------------------

import {
  sanitiseUserFacingText,
  sanitiseCoachingProse,
  type SanitiseMatch,
  type SanitiseResult,
} from '../../orchestrator/shared/output-safety.js';

export { sanitiseUserFacingText, sanitiseCoachingProse };
export type { SanitiseMatch, SanitiseResult };

// ----------------------------------------------------------------------------
// Envelope-level walk
// ----------------------------------------------------------------------------

export interface EgressSanitiseOpts {
  readonly graph: GraphV3T | null;
  readonly requestId: string;
  /**
   * Exit path / handler context for telemetry correlation. REQUIRED — the
   * production chokepoint always has it. Making this required prevents
   * silent telemetry regression where a future caller forgets to thread
   * it through. Tests must supply a placeholder (e.g. 'test').
   */
  readonly exitPath: string;
}

/**
 * Apply `sanitiseUserFacingText` to every user-facing string field in the
 * OlumiResponse envelope. Returns a shallow-cloned response with field-level
 * replacement; never mutates the input.
 *
 * Logs `v5.egress_id_leak` once per match found, with PREFIX TYPE ONLY (never
 * the raw ID — this is the last line of defence and we don't want to surface
 * leaked IDs to log infrastructure).
 */
export function sanitiseOlumiResponseForEgress(
  response: OlumiResponse,
  opts: EgressSanitiseOpts,
): OlumiResponse {
  const allMatches: SanitiseMatch[] = [];
  const collect = (text: string): string => {
    const r = sanitiseUserFacingText(text, opts.graph);
    if (r.matches.length > 0) allMatches.push(...r.matches);
    return r.text;
  };

  // Per-string entity-id scrub FIRST, so the chip-quality finalizer
  // classifies on already-cleaned text (a leaked id is replaced with a
  // human label before the leakage classifier runs).
  const scrubbedActions = response.suggested_actions.map((a) => sanitiseAction(a, collect));
  // V5 Lane 2 — deterministic chip-quality finalizer (classify, drop
  // unsafe/generic, dedupe exact + near, proposal-protected budget). Pure
  // and idempotent; the chokepoint runs this up to 4× per response.
  const finalized = finalizeChips(scrubbedActions);

  const sanitised: OlumiResponse = {
    ...response,
    assistant_text: collect(response.assistant_text),
    blocks: response.blocks.map((b) => sanitiseBlock(b, collect)),
    // Spread the finalizer's readonly result into the mutable wire array.
    suggested_actions: [...finalized.chips],
    insights: response.insights.map((i) => sanitiseInsight(i, collect)),
  };

  for (const m of allMatches) {
    log.warn(
      {
        event: 'v5.egress_id_leak',
        request_id: opts.requestId,
        exit_path: opts.exitPath,
        prefix: m.prefix,
        resolution: m.resolved,
        // INTENTIONAL: do NOT log the raw matched string. Layer 1 logs raw
        // IDs for triage; Layer 2 redacts because it is the egress boundary.
      },
      'V5 egress: entity-id leak caught and replaced',
    );
  }

  // V5 Lane 2 — aggregate chip-finalizer telemetry, content-free (scalar
  // counts + routing ids only). Guarded so idempotent re-runs of this
  // chokepoint (sendFinalised200 calls it up to 4×) emit at most once per
  // response in the common case.
  const r = finalized.report;
  if (
    r.input !== r.output ||
    r.dropped_unsafe > 0 ||
    r.dropped_generic > 0 ||
    r.deduped > 0 ||
    r.over_budget_trimmed > 0
  ) {
    emit(TelemetryEvents.V5ChipsFinalized, {
      request_id: opts.requestId,
      exit_path: opts.exitPath,
      input: r.input,
      output: r.output,
      dropped_unsafe: r.dropped_unsafe,
      dropped_raw_decimal: r.dropped_raw_decimal,
      dropped_generic: r.dropped_generic,
      deduped: r.deduped,
      proposal_protected: r.proposal_protected,
      over_budget_trimmed: r.over_budget_trimmed,
    });
  }

  return sanitised;
}

// ----------------------------------------------------------------------------
// Discriminated-union walker — exhaustiveness is enforced by the `never` check
// in the default branch. The `Block` type imported above is the boundary
// schema's discriminated union (`@talchain/schemas/boundary`). When that
// schema gains a new block-type variant (e.g. `BlockSchema` adds a member),
// the `never` assignment below becomes a compile error, forcing a deliberate
// decision about whether the new type contains user-facing prose. Treat the
// build break as a feature, not a chore: do not add a `default` branch that
// silently passes the new variant through unscanned.
// ----------------------------------------------------------------------------

function sanitiseBlock(block: Block, collect: (s: string) => string): Block {
  switch (block.type) {
    case 'text':
      return { ...block, content: collect(block.content) };

    case 'analysis_result':
      // enrichment / leading_option_id / win_probabilities are structured /
      // opaque — leave untouched.
      return { ...block, summary: collect(block.summary) };

    case 'explanation':
      // referenced_option_ids[] is intentional machine IDs — leave untouched.
      return { ...block, narrative: collect(block.narrative) };

    case 'comparison':
      return {
        ...block,
        narrative: block.narrative !== undefined ? collect(block.narrative) : block.narrative,
        options: block.options.map((opt) => ({
          ...opt,
          label: collect(opt.label),
          // option_id, win_probability, attributes: structured — untouched.
        })),
      };

    case 'flip_analysis':
      // flip_scenarios[].factor_id / from_option_id / to_option_id are
      // intentional machine IDs — leave untouched.
      return { ...block, narrative: collect(block.narrative) };

    case 'error':
      // error_code (enum), severity (enum), details (opaque passthrough) —
      // no user-facing prose to scrub.
      return block;

    case 'graph_patch':
      // status / operation (enums); target_id / before / after — structured
      // machine fields. No user-facing prose to scrub.
      return block;

    case 'draft_graph':
      // nodes / edges arrays of z.unknown() — opaque, untouched.
      return block;

    case 'review_card':
      // Phase 3 (Analysis tab v1.3 §1.1). User-facing prose fields:
      //   title, body, optional action_label.
      // Structured / enum / metadata (block_id, signal_id, created_at,
      // source_handler, graph_hash_at_generation, freshness, card_kind,
      // severity, priority_rank, action_intent) and target_refs (IDs
      // allowed in structured fields per §0.1) — untouched.
      return {
        ...block,
        title: collect(block.title),
        body: collect(block.body),
        ...(block.action_label !== undefined
          ? { action_label: collect(block.action_label) }
          : {}),
      };

    case 'coaching':
      // Phase 3 (Analysis tab v1.3 §1.2). Same user-facing slots as
      // review_card. coaching_kind / source / target_refs / priority_rank
      // / action_intent — structured, untouched.
      return {
        ...block,
        title: collect(block.title),
        body: collect(block.body),
        ...(block.action_label !== undefined
          ? { action_label: collect(block.action_label) }
          : {}),
      };

    case 'evidence':
      // Phase 3 (Analysis tab v1.3 §1.3). User-facing prose fields:
      //   factor_label, evidence_gap, suggested_technique,
      //   impact_if_gathered, optional action_label.
      // factor_ref (structured), target_refs (structured),
      // current_confidence (enum), priority_rank (number), severity
      // (enum), action_intent (enum) — untouched.
      return {
        ...block,
        factor_label: collect(block.factor_label),
        evidence_gap: collect(block.evidence_gap),
        suggested_technique: collect(block.suggested_technique),
        impact_if_gathered: collect(block.impact_if_gathered),
        ...(block.action_label !== undefined
          ? { action_label: collect(block.action_label) }
          : {}),
      };

    case 'exercise':
      // Phase 3 (Analysis tab v1.3 §1.4). User-facing prose fields (all
      // optional in the schema):
      //   failure_scenario, mitigation, reference_class, counter_case,
      //   review_trigger, plus each warning_signs[] entry.
      // exercise_kind (enum), target_element_ref / target_refs
      // (structured) — untouched. ExerciseBlock is NOT auto-emitted by
      // any composer in PR 2 (handler-only per v1.3 §1.4); the case
      // exists for exhaustiveness + future on-demand handler wiring.
      return {
        ...block,
        ...(block.failure_scenario !== undefined
          ? { failure_scenario: collect(block.failure_scenario) }
          : {}),
        ...(block.warning_signs !== undefined
          ? { warning_signs: block.warning_signs.map((s) => collect(s)) }
          : {}),
        ...(block.mitigation !== undefined
          ? { mitigation: collect(block.mitigation) }
          : {}),
        ...(block.reference_class !== undefined
          ? { reference_class: collect(block.reference_class) }
          : {}),
        ...(block.counter_case !== undefined
          ? { counter_case: collect(block.counter_case) }
          : {}),
        ...(block.review_trigger !== undefined
          ? { review_trigger: collect(block.review_trigger) }
          : {}),
      };

    case 'held_proposal':
      // 0.15.0 (ROADMAP 1.43 held-mutation shape). User-facing prose field:
      //   summary (display-safe by construction per the boundary schema, but
      //   fail-closed policy: scrub anyway).
      // proposal_id (minted gmh_ handle), mutation_class / reason_code
      // (enums), confirm_action_id / decline_action_id (refs into this
      // response's suggested_actions[].id) — typed machine fields, untouched.
      // NOT emitted by CEE yet — dormant-but-armed for the emitter lane.
      return { ...block, summary: collect(block.summary) };

    case 'ui_directive':
      // 0.15.0 (seamlessness R4). User-facing copy field: optional note.
      // verb (enum), targets (TargetRef[] — ids are intentional targeting,
      // same treatment as target_refs on Phase-3 blocks), duration_ms
      // (number) — typed machine fields, untouched. NOT emitted by CEE yet —
      // dormant-but-armed for the emitter lane.
      return {
        ...block,
        ...(block.note !== undefined ? { note: collect(block.note) } : {}),
      };

    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return block;
    }
  }
}

function sanitiseAction(action: Action, collect: (s: string) => string): Action {
  // id, action_type are machine routing fields — untouched.
  return {
    ...action,
    label: collect(action.label),
    message: collect(action.message),
  };
}

function sanitiseInsight(insight: Insight, collect: (s: string) => string): Insight {
  return { ...insight, text: collect(insight.text) };
}
