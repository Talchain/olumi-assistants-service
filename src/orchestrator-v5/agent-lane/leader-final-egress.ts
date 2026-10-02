/**
 * ⭐ THE AGENT LANE'S FAIL-CLOSED FINAL EGRESS (AI HARNESS PR-L1, programme-docs#85 5931097719; DL v2 #5c).
 *
 * Before this, the Agent lane had no egress check at all: the leader gate ran only on analysis-bearing turns, before
 * the break-even / A7 / answer-shape rewrites, and never looked at `suggested_actions`, `run_delta` or the sidecars.
 * The V5 alarm (`guardLeadingOptionClaimsAtEgress`) is observe-only and has one call site, in route-v2.
 *
 * This runs on EVERY Agent turn, on the body exactly as it will ship (after every text editor, before the answer row is
 * written so a replay returns the same bytes). It reads the ONE licence (`compose/leader-licence.ts`); on any licence
 * but `withheld` it returns the body by reference. On a withheld turn it REMOVES, never merely reports:
 * 1. a member whose KEY designates a leading option and carries an identity → REMOVED (e.g. `run_delta.leader.
 *    current_leading_option_id`, gated today on entitlement only), or `null` only where the contract keeps the key
 *    required + nullable ({@link NULLABLE_LEADER_KEYS});
 * 2. the analysis block's enrichment → the wire's withheld projection again (idempotent), then any producer-prose string
 *    that BOTH uses leader vocabulary AND names an exact option label or id → deleted;
 * 3. a chip whose label / message / detail asserts a leading option by exact label → dropped;
 * 4. `assistant_text` / `framing_question` → the shared exact-label edit, on every withheld turn (after every rewrite).
 * Every removal is logged at level 50 (`agent_lane.leader_claim_residual_removed`), field PATHS only, never prose.
 * Prose that only matches the wide alarm vocabulary is reported at level 40 and left alone: the alarm is wider than any
 * enforcer may safely be over user-facing prose (see `leading-option-egress-guard.ts`).
 *
 * `_agent` (the provisional view, permitted on a withheld turn by design) is never touched. NEVER THROWS: a failure
 * logs at level 50 and the reply is replaced by a known-safe envelope (fail closed), never shipped half-checked.
 */
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { log } from '../../utils/telemetry.js';
import type { LeaderLicence } from '../compose/leader-licence.js';
import { isCodeShaped, keyNamesLeader, LICENSED_LABEL_KEYS } from './licensed-run-view.js';
import {
  findLeaderClaims,
  optionLabelPattern,
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from '../compose/leading-option-egress-guard.js';
import {
  enforceLeadingOptionClaimsAtWire,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
  optionRosterFromAnalysisReady,
  optionRosterFromGraph,
  type WireLeaderClaimEnforcementOpts,
} from '../compose/leading-option-wire-enforcement.js';
import { projectTransportEnrichmentForWithheldClaim } from '../compose/withheld-claim-projection.js';

/** Top-level members never walked: prose (handled by the shared gate) and the provisional view (permitted by design). */
const SKIPPED_TOP_LEVEL: ReadonlySet<string> = new Set(['assistant_text', 'framing_question', '_agent', 'suggested_actions', 'blocks']);

const CHIP_TEXT_MEMBERS = ['label', 'message', 'detail'] as const;

const MAX_DEPTH = 40;

/**
 * ⛔ A WITHHELD KEY IS REMOVED, NOT NULLED, unless the contract keeps it REQUIRED + NULLABLE (strip gap, CANVAS
 * 5943987710). @talchain/schemas types `leading_option_id` as `z.string().nullable()` (the `analysis_result` block), so
 * there `null` is the withheld value. Every other leader-designating key the wire types is OPTIONAL and non-nullable
 * (`run_delta.leader.{prior,current}_leading_option_id`, `leading_option`: `z.string().min(1).optional()`), and absence
 * already means "no entitled claim" (`route-with-tool-use.ts`). A `null` there failed the parse, and the UI quarantines a
 * whole additive member that fails (`responseParser` QUARANTINABLE_ADDITIVE_KEYS): every withheld Run's `run_delta` was
 * dropped, so the strip and Compare went empty. Untyped passthrough (enrichment) takes the same removal.
 */
const NULLABLE_LEADER_KEYS: ReadonlySet<string> = new Set(['leading_option_id']);

/** `record` without the withheld key, or with it nulled where the contract requires it ({@link NULLABLE_LEADER_KEYS}). */
function withheldKey(rec: Record<string, unknown>, key: string): Record<string, unknown> {
  if (NULLABLE_LEADER_KEYS.has(key)) return { ...rec, [key]: null };
  const { [key]: _withheld, ...rest } = rec;
  return rest;
}

export interface LeaderFinalEgressOpts extends WireLeaderClaimEnforcementOpts {
  readonly licence: LeaderLicence;
}

export interface LeaderFinalEgressResult<T> {
  readonly response: T;
  readonly removedPaths: readonly string[];
  readonly proseEdited: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function hasIdentity(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.some((v) => typeof v === 'string' && v.length > 0);
  return false;
}

/** Option names (labels) AND ids: a producer's prose can name an option either way (Paul's 09:48Z hit used the id). */
export function optionNamesAndIds(graph: unknown, analysisReady: unknown): readonly string[] {
  const names = new Set<string>([...optionRosterFromGraph(graph), ...optionRosterFromAnalysisReady(analysisReady)]);
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const node = record(n);
      if (node?.kind === 'option' && typeof node.id === 'string' && node.id.trim().length >= 3) names.add(node.id.trim());
    }
  }
  const options = (analysisReady as { options?: unknown } | null | undefined)?.options;
  if (Array.isArray(options)) {
    for (const o of options) {
      const id = record(o)?.id;
      if (typeof id === 'string' && id.trim().length >= 3) names.add(id.trim());
    }
  }
  return [...names];
}

function namesAnOption(text: string, names: readonly string[]): boolean {
  return names.some((name) => optionLabelPattern(name).test(text));
}

/** Walk one structured subtree: null designating keys; delete leader prose that names an option. */
function scrub(value: unknown, path: string, names: readonly string[], removed: string[], depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') {
    if (textNamesLeadingOption(value) && namesAnOption(value, names)) {
      removed.push(path);
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out: unknown[] = [];
    value.forEach((item, i) => {
      const next = scrub(item, `${path}[${i}]`, names, removed, depth + 1);
      if (next !== item) changed = true;
      if (next !== undefined) out.push(next);
    });
    return changed ? out : value;
  }
  const rec = record(value);
  if (rec === undefined) return value;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (keyNamesLeader(k) && hasIdentity(v)) {
      removed.push(`${path}.${k}`);
      if (NULLABLE_LEADER_KEYS.has(k)) out[k] = null;
      changed = true;
      continue;
    }
    const next = scrub(v, `${path}.${k}`, names, removed, depth + 1);
    if (next !== v) changed = true;
    if (next !== undefined) out[k] = next;
  }
  return changed ? out : value;
}

function chipAssertsLeader(chip: unknown, labels: readonly string[]): boolean {
  const rec = record(chip);
  if (rec === undefined) return false;
  return CHIP_TEXT_MEMBERS.some((m) => typeof rec[m] === 'string' && textAssertsLeadingOption(rec[m] as string, { optionLabels: labels }));
}

/**
 * The prose a reply is replaced by when the final egress itself fails: the shared gate's fixed withheld line (DL 380e54
 * 5932098302 item 1). Leader-free by that module's own build-time probe.
 */
export const FINAL_EGRESS_FAILED_TEXT = WIRE_WITHHELD_LEADER_REPLACEMENT;

/** Members the envelope never ships: prose, chips, the run delta, the provisional rewrite marker. */
const ENVELOPE_DROPPED: ReadonlySet<string> = new Set(['assistant_text', 'framing_question', 'suggested_actions', 'run_delta', '_answer_shape']);

/**
 * Members that carry the user's MODEL (`draft_graph`, the applied `graph`): omitted whole, never shipped thinned. The
 * UI applies them to the canvas, so a graph with its descriptions stripped would show (and could later save) a
 * different model; omitted, the UI keeps the model it has and the next turn's readback carries it.
 */
const ENVELOPE_MODEL_MEMBERS: ReadonlySet<string> = new Set(['draft_graph', 'graph']);

/**
 * The envelope's ONE string rule (CODEX CEE BUDDY 5932438459: the whole unchecked-text class, not one more field). A
 * string ships only when it is code-shaped (an id, code, enum, hash or timestamp) or a NAME under a label key, and in
 * either case uses no leader vocabulary. Everything else (summaries, block prose, sidecar notes, messages) is dropped.
 */
function envelopeStringSurvives(key: string | undefined, value: string): boolean {
  if (textNamesLeadingOption(value)) return false;
  return isCodeShaped(value) || (key !== undefined && LICENSED_LABEL_KEYS.has(key));
}

function envelopeAllowList(value: unknown, key: string | undefined, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === 'string') return envelopeStringSurvives(key, value) ? value : undefined;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const kept = envelopeAllowList(item, key, depth + 1);
      if (kept !== undefined) out.push(kept);
    }
    return out;
  }
  const rec = record(value);
  if (rec === undefined) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (keyNamesLeader(k) && v !== null && v !== undefined && v !== '') { if (NULLABLE_LEADER_KEYS.has(k)) out[k] = null; continue; }
    const kept = envelopeAllowList(v, k, depth + 1);
    if (kept !== undefined) out[k] = kept;
  }
  return out;
}

/**
 * Blocks: only the `analysis_result` block survives (the UI's deterministic result), reduced by the same allow-list
 * with its enrichment dropped and its REQUIRED `summary` emptied (`boundary/blocks.ts`: `summary: z.string()`,
 * `leading_option_id` required + nullable). Every other block type is prose-bearing with a required non-empty
 * title/body, so it is dropped whole rather than shipped invalid.
 */
function envelopeBlocks(blocks: unknown): unknown[] {
  if (!Array.isArray(blocks)) return [];
  const out: unknown[] = [];
  for (const b of blocks) {
    const block = record(b);
    if (block?.type !== 'analysis_result') continue;
    const { enrichment: _e, summary: _s, ...rest } = block;
    const kept = record(envelopeAllowList(rest, undefined, 0)) ?? {};
    out.push({ ...kept, type: 'analysis_result', summary: '', leading_option_id: null });
  }
  return out;
}

/** The last resort, when building the envelope itself fails: nothing from the reply at all. */
const MINIMAL_ENVELOPE: Readonly<Record<string, unknown>> = Object.freeze({ assistant_text: WIRE_WITHHELD_LEADER_REPLACEMENT, suggested_actions: [], blocks: [] });

/**
 * Known-safe, by ALLOW-LIST: the fixed withheld line, no chips, no run delta, no model members, the `analysis_result`
 * block reduced to codes and numbers, and every other member reduced to codes, numbers, booleans and user-given names
 * with leader-designating keys nulled. Never throws: a failure here returns {@link MINIMAL_ENVELOPE}.
 */
export function knownSafeEnvelope(response: Record<string, unknown>): Record<string, unknown> {
  try {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(response)) {
      if (ENVELOPE_DROPPED.has(k) || ENVELOPE_MODEL_MEMBERS.has(k)) continue;
      if (k === 'blocks') { out.blocks = envelopeBlocks(v); continue; }
      if (k === '_agent') {
        const agent = record(v);
        if (agent === undefined) continue;
        const { provisional_view: _view, ...rest } = agent;
        out._agent = envelopeAllowList(rest, k, 0);
        continue;
      }
      if (keyNamesLeader(k) && v !== null && v !== undefined && v !== '') { if (NULLABLE_LEADER_KEYS.has(k)) out[k] = null; continue; }
      const kept = envelopeAllowList(v, k, 0);
      if (kept !== undefined) out[k] = kept;
    }
    return { ...out, assistant_text: FINAL_EGRESS_FAILED_TEXT, suggested_actions: [], blocks: out.blocks ?? [] };
  } catch {
    return { ...MINIMAL_ENVELOPE, suggested_actions: [], blocks: [] };
  }
}

export function enforceLeaderLicenceAtFinalEgress<T extends Record<string, unknown>>(response: T, opts: LeaderFinalEgressOpts): LeaderFinalEgressResult<T> {
  if (opts.licence !== 'withheld') return { response, removedPaths: [], proseEdited: false };
  const removed: string[] = [];
  let body: Record<string, unknown> = response;
  let proseEdited = false;
  try {
    const names = optionNamesAndIds(opts.graph, opts.analysisReady);
    const labels = [...new Set([...optionRosterFromGraph(opts.graph), ...optionRosterFromAnalysisReady(opts.analysisReady)])];

    // 1 + 2: structured members (everything but prose, chips, blocks and the provisional view).
    for (const [k, v] of Object.entries(body)) {
      if (SKIPPED_TOP_LEVEL.has(k)) continue;
      if (keyNamesLeader(k) && hasIdentity(v)) { removed.push(k); body = withheldKey(body, k); continue; }
      const next = scrub(v, k, names, removed, 0);
      if (next !== v) body = { ...body, [k]: next };
    }
    if (Array.isArray(body.blocks)) {
      let changed = false;
      const blocks = body.blocks.map((b, i) => {
        const block = record(b);
        if (block === undefined) return b;
        let out: Record<string, unknown> = block;
        for (const [k, v] of Object.entries(block)) {
          if (keyNamesLeader(k) && hasIdentity(v)) { removed.push(`blocks[${i}].${k}`); out = withheldKey(out, k); }
        }
        const enrichment = record(block.enrichment);
        if (enrichment !== undefined) {
          const before = removed.length;
          const projected = projectTransportEnrichmentForWithheldClaim(enrichment);
          const scrubbed = projected === undefined ? undefined : scrub(projected, `blocks[${i}].enrichment`, names, removed, 0);
          if (JSON.stringify(scrubbed) !== JSON.stringify(enrichment)) {
            if (scrubbed === undefined) { const { enrichment: _e, ...rest } = out; out = rest; } else out = { ...out, enrichment: scrubbed };
            // The earlier gate projects the analysis block on analysis-bearing turns; a change here means it did not.
            if (removed.length === before) removed.push(`blocks[${i}].enrichment`);
          }
        }
        if (out !== block) changed = true;
        return out;
      });
      if (changed) body = { ...body, blocks } as typeof body;
    }

    // 3: chips.
    if (Array.isArray(body.suggested_actions)) {
      const kept = body.suggested_actions.filter((chip, i) => {
        const drop = chipAssertsLeader(chip, labels);
        if (drop) removed.push(`suggested_actions[${i}]`);
        return !drop;
      });
      if (kept.length !== body.suggested_actions.length) body = { ...body, suggested_actions: kept } as typeof body;
    }

    // 4: prose, by the shared exact-label edit, on EVERY withheld turn: the break-even / A7 / answer-shape rewrites run
    // after the earlier gate (DL 380e54 5931709758), so this is the only edit that sees the final words.
    const shared = enforceLeadingOptionClaimsAtWire(body as OlumiResponse, opts);
    if (shared.changed) {
      body = shared.response;
      proseEdited = shared.editedFields.length > 0;
      for (const f of shared.editedFields) removed.push(f);
    }
  } catch (err) {
    // FAIL CLOSED: an unfinished check never ships unexamined content. The known-safe envelope keeps the state the UI
    // renders deterministically, drops every structured carrier a leader could ride in, and says one true sentence.
    log.error(
      { event: 'agent_lane.leader_final_egress_failed', request_id: opts.requestId, exit_path: opts.exitPath, err: err instanceof Error ? err.message : String(err), removed_paths: removed },
      'agent-lane: the final leader egress threw — the reply is replaced by the known-safe envelope',
    );
    return { response: knownSafeEnvelope(response) as T, removedPaths: ['*'], proseEdited: true };
  }

  if (removed.length > 0) {
    log.error(
      { event: 'agent_lane.leader_claim_residual_removed', request_id: opts.requestId, exit_path: opts.exitPath, removed_paths: [...new Set(removed)].sort(), removed_count: removed.length, enforced: true },
      'agent-lane: a withheld leader reached the final egress and was removed — fix the producer named by removed_paths',
    );
  }
  // Report-only: prose the wide alarm vocabulary flags, which no enforcer may safely delete.
  try {
    const residue = findLeaderClaims(body as OlumiResponse).filter((h) => h.path === 'assistant_text' || h.path === 'framing_question' || /^blocks\[\d+\]\.[a-z_]+$/.test(h.path));
    if (residue.length > 0) {
      log.warn(
        { event: 'agent_lane.leader_prose_residue', request_id: opts.requestId, paths: [...new Set(residue.map((h) => h.path))].sort(), codes: [...new Set(residue.map((h) => h.code))].sort() },
        'agent-lane: prose on a withheld turn matches the leader vocabulary without an exact option name — reported, not removed',
      );
    }
  } catch { /* report-only */ }

  return { response: body as T, removedPaths: [...new Set(removed)], proseEdited };
}
