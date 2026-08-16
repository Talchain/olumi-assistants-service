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

import { env } from 'node:process';

import type { OlumiResponse, Action, Insight, Block } from '@talchain/schemas/boundary';
import type { GraphV3T } from '../../orchestrator/types.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';
import { finalizeChips } from './chip-finalizer.js';
import { guardLoopingChipsAtEgress } from './looping-chip-guard.js';
// NOTE: `guardLeadingOptionClaimsAtEgress` is deliberately NOT imported here
// any more — it runs once at the send point in `sendFinalised200`. See the
// block where it used to be called, below.

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

import { FORBIDDEN_USER_FACING_REDACTION_MARKER } from '../../orchestrator/shared/repair-vocabulary-denylist.js';

export { sanitiseUserFacingText, sanitiseCoachingProse };
export type { SanitiseMatch, SanitiseResult };

// ----------------------------------------------------------------------------
// Redaction-marker egress net
// ----------------------------------------------------------------------------

/**
 * ⚠ 2026-08-16 (P1) — `[REDACTED]` REACHED A REAL USER'S CHAT.
 *
 * `enforceRepairVocabularyDenylist` used to substitute the literal string
 * `[REDACTED]` into user-facing prose, and four of its twelve patterns were
 * ordinary English, so the scrubber redacted the user's own words back at
 * them. Both halves are fixed at the source (every rule now carries a neutral
 * plain-English replacement). This is the net UNDER that fix.
 *
 * ⭐ WHY A NET AT ALL, given the source is fixed: `[REDACTED]` is emitted by
 * FOUR other modules in this repo (`utils/redaction.ts`, `utils/logger-config.ts`
 * as `REDACT_CENSOR`, and the enrichment strip in `compose.ts`), all of which
 * are correct in their own layer — LOGS and DROPPED ENRICHMENT FIELDS may
 * absolutely carry it. What must never happen is one of those values crossing
 * into `assistant_text`. A marker there is never legitimate user-facing data,
 * so the test is exact-substring and needs no judgement call.
 *
 * FAIL LOUD IN TESTS, STRIP IN PRODUCTION — deliberately asymmetric. A throw
 * on a live turn would convert a cosmetic leak into a dead conversation, which
 * is a worse outcome for the user than a slightly-clipped sentence; a silent
 * strip in CI would let the next regression ship. The production path emits
 * telemetry so the rate is observable rather than merely survived.
 */
function isTestEnv(): boolean {
  // Same shape as `routing-log.ts::isTestEnv` and `telemetry.ts::setTestSink`,
  // imported from `node:process` rather than read off the `process` global so
  // it satisfies the no-direct-process.env lint rule, and read AT CALL TIME
  // (not module load) so a test can exercise the production strip path by
  // clearing these for one call.
  return env.NODE_ENV === 'test' || env.VITEST === 'true' || Boolean(env.VITEST);
}

/**
 * Remove any redaction marker from user-facing prose, closing the whitespace
 * it leaves behind so the sentence does not ship a double space or a space
 * before its full stop.
 *
 * Exported for direct test: the rule is a concept with its own mutants, not an
 * expression buried in a walk nobody can point at.
 */
export function stripRedactionMarker(text: string): string {
  if (!text.includes(FORBIDDEN_USER_FACING_REDACTION_MARKER)) return text;
  return text
    .split(FORBIDDEN_USER_FACING_REDACTION_MARKER)
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .trim();
}

/**
 * The egress assertion. Returns the text that may ship.
 *
 * @throws in test environments, so a regression is a RED and not a warning.
 */
export function assertNoRedactionMarkerInAssistantText(
  text: string,
  opts: { readonly requestId: string; readonly exitPath: string },
): string {
  if (!text.includes(FORBIDDEN_USER_FACING_REDACTION_MARKER)) return text;

  if (isTestEnv()) {
    throw new Error(
      `assistant_text carried the redaction marker ${FORBIDDEN_USER_FACING_REDACTION_MARKER} at egress `
        + `(exit_path=${opts.exitPath}). A placeholder token is never legitimate user-facing copy — `
        + 'give the producing rule a neutral plain-English replacement instead. '
        + 'See src/orchestrator/shared/repair-vocabulary-denylist.ts.',
    );
  }

  const stripped = stripRedactionMarker(text);
  log.warn(
    {
      event: 'v5.egress_redaction_marker_stripped',
      request_id: opts.requestId,
      exit_path: opts.exitPath,
      // Lengths only — never the raw text, which still contains whatever the
      // producing layer was trying to hide.
      text_length_before: text.length,
      text_length_after: stripped.length,
    },
    'V5 egress: redaction marker removed from assistant_text',
  );
  return stripped;
}

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
  /**
   * The user's message for THIS turn, verbatim, or `null` when the turn has
   * no user message (system events). Feeds the looping-chip guard, which
   * drops any pure-text-replay chip that would re-submit this exact message
   * (see `looping-chip-guard.ts` for the invariant and its scope).
   *
   * REQUIRED — same rationale as `exitPath` above. An optional field is one a
   * future caller silently forgets, which would turn the no-dead-end
   * guarantee into theatre. `null` is an explicit, honest "this turn has no
   * user message"; omission is not an option the type checker allows.
   */
  readonly userMessage: string | null;
  /**
   * T1 claim safety, LAYER 3 — may THIS turn name a leading option?
   *
   * `false` means the constraint verdict withheld the claim, so any copy on the
   * envelope naming or presuming a leader contradicts the turn's own
   * confirmation. The guard reports that (observe-only today) — see
   * `leading-option-egress-guard.ts`.
   *
   * ⚠ VESTIGIAL AS OF 2026-07-27 (E1), AND SAID PLAINLY RATHER THAN DRESSED UP.
   * This function no longer reads this field: the Layer-3 guard moved to a
   * single pass in `sendFinalised200`, which arms it from
   * `ctx.mayNameLeadingOption` — the same value, from the same source, one
   * frame up. So this is currently a REQUIRED FIELD WITH NO READER.
   *
   * It is retained, not removed, and the reason is scope rather than merit:
   * dropping it is ~38 mechanical call-site edits across seven test files plus
   * a rewrite of the `EgressSanitiseOpts declares mayNameLeadingOption as
   * REQUIRED` pin in `route-egress-claim-safety-marking.drift.test.ts`, which
   * is a claim-safety drift gate and deserves its own reviewed change rather
   * than a ride-along in a performance PR.
   *
   * The paragraph this replaced argued the field must stay REQUIRED because "a
   * claim-safety guard a caller can forget to arm is theatre". That argument is
   * still TRUE — but it is now true of `sendFinalised200`'s ctx marking, not of
   * this field, and the drift test that enforces it scans the
   * `sendFinalised200` call sites, which is the half that was always
   * load-bearing. Leaving the old sentence here would have been an honest label
   * quietly turned false (CLAUDE.md trap #14) — the exact thing this PR's
   * sibling is fixing two files over.
   */
  readonly mayNameLeadingOption: boolean;
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
  // No-dead-end invariant: a chip whose click would re-submit the user's own
  // message verbatim is an inescapable loop, never a choice. Runs AFTER the
  // finalizer so it sees the same post-scrub text the wire would carry.
  // Idempotent (a second pass finds nothing left to drop), which the
  // chokepoint's up-to-4× re-entry requires.
  const loopGuarded = guardLoopingChipsAtEgress(finalized.chips, opts.userMessage, {
    requestId: opts.requestId,
    exitPath: opts.exitPath,
  });

  // ROADMAP 1.192 leg κ — identity handshake (top-level `graph_hash`). Stamp
  // the canonical identity of the graph THIS turn reasoned/committed over onto
  // the response envelope, at the single V5 egress chokepoint every exit path
  // funnels through. `opts.graph` (= runResult.effectiveGraph) is the
  // authoritative per-turn graph — the request graph_state parsed, the
  // persisted fallback, or the just-ADOPTED graph on a first-touch turn (leg 2
  // row A) — the SAME graph the entity-id scrub above resolves against.
  // `computeAnalysisAffectingGraphHash` is the SAME canonical hash function the
  // freshness envelope uses (freshness.current_graph_hash), so the two are
  // byte-identical for the same graph. Fail-closed: a null/empty graph yields a
  // null hash → OMIT `graph_hash` (it is .optional(); never emit an empty
  // string, the schema is .min(1)). Idempotent: this chokepoint re-runs up to
  // 4x per response; a graph-derived hash is stable, and a response that
  // already carries `graph_hash` (a prior pass, or a future authoritative
  // upstream setter) keeps it.
  const graphHash =
    response.graph_hash ??
    (computeAnalysisAffectingGraphHash(
      opts.graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    ) ?? undefined);

  const sanitised: OlumiResponse = {
    ...response,
    // The redaction-marker net runs AFTER the entity-id scrub, so it sees the
    // same bytes the wire would carry rather than a pre-scrub draft.
    assistant_text: assertNoRedactionMarkerInAssistantText(collect(response.assistant_text), {
      requestId: opts.requestId,
      exitPath: opts.exitPath,
    }),
    blocks: response.blocks.map((b) => sanitiseBlock(b, collect)),
    // Spread the finalizer + loop-guard readonly result into the mutable wire array.
    suggested_actions: [...loopGuarded],
    insights: response.insights.map((i) => sanitiseInsight(i, collect)),
    ...(graphHash !== undefined ? { graph_hash: graphHash } : {}),
  };

  // ═════════════════════════════════════════════════════════════════════════
  // T1 claim safety, LAYER 3 — THE GUARD USED TO RUN HERE. It now runs ONCE,
  // in `sendFinalised200`, on the final `wireBody` immediately before
  // `reply.send`. Moved 2026-07-27 (ROADMAP 1.272 E1).
  //
  // ORDERING IS LOAD-BEARING, and the move STRENGTHENS it rather than risking
  // it. The rule is that the guard must sit after every pass that can edit
  // user-facing prose — because `compose/terminology-rewrite.ts` turns
  // "recommendation" into "leading option" and "the winner" into "the leading
  // option", i.e. OUR OWN SAFETY PASS MANUFACTURES THE BANNED LANGUAGE, and a
  // scan placed upstream of it reads clean prose and ships the leak.
  //
  // ⚠ AND THIS POSITION WAS NOT ACTUALLY LAST. `sendFinalised200` wraps EVERY
  // call to this function in `finaliseV5Response(...)`, which then deletes
  // transport-banned enrichment members, rewrites enrichment prose leaves and
  // overrides `graph_hash`. So the scan here never saw the bytes that shipped —
  // it saw a pre-finalise draft of them. Worse, the last two re-attach passes
  // (`_answer_shape`, and the synthesised shape) can FAIL CLOSED and discard
  // the very object this guard just scanned. Scanning `wireBody` at the send
  // point is the only position from which "the guard scanned what the user
  // received" is true by construction.
  //
  // Do NOT re-add a call here. This function is re-entered 2–8 times per
  // response, so a scan here is 2–8 scans of near-identical bytes, and the
  // alarm's own `hit_count` telemetry was multiplied by that factor.
  // ═════════════════════════════════════════════════════════════════════════

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
        // ROADMAP 2.225 — `action_prompt` is USER-FACING TWICE OVER: it is
        // rendered on the pill's card and then submitted verbatim as the
        // user's own message. Without this line it rides through on the
        // spread above unscrubbed, so a leaked entity id or raw decimal would
        // not merely be displayed — it would be echoed back into the
        // conversation as something the user appears to have written.
        ...(block.action_prompt !== undefined
          ? { action_prompt: collect(block.action_prompt) }
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
      // (structured) — untouched.
      //
      // ⚠ AMENDED 2026-07-31 (capability P1, CEE #770). This comment read
      // "ExerciseBlock is NOT auto-emitted by any composer in PR 2
      // (handler-only per v1.3 §1.4); the case exists for exhaustiveness +
      // future on-demand handler wiring." It was accurate when written (#178,
      // cf7c85f7 — checked: introduced there, never overwritten, so this is an
      // OVERTAKEN label and not a swapped confession) and is now FALSE. A V5
      // composer DOES auto-emit this kind: the pre-mortem lens companion
      // (`buildPreMortemExerciseBlock` -> `rebuildPhase3BlocksFresh`, permitted
      // arm only). The scrub arm below is a LIVE path, not a dormant one — the
      // three fields #770 emits (warning_signs / mitigation / review_trigger)
      // now carry producer prose to real users, so a change here has user-facing
      // consequences.
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
      // (number) — typed machine fields, untouched. Emitted by the R4
      // slice-1 emitter (compose/ui-directive.ts — UNCONDITIONAL since
      // #539 deleted CEE_UI_DIRECTIVE_EMIT, Paul's 19 Jul no-dark-launch
      // ruling); that slice never populates `note`, so this scrub stays
      // fail-closed for future slices that do.
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
    // 0.19.0 (wave-2 ask #20): `detail` is user-facing prose (the full
    // sentence behind a clamped label) — scrubbed like label/message.
    ...(action.detail !== undefined ? { detail: collect(action.detail) } : {}),
  };
}

function sanitiseInsight(insight: Insight, collect: (s: string) => string): Insight {
  return { ...insight, text: collect(insight.text) };
}
