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
 * 1. a member whose KEY designates a leading option and carries an identity → `null` (e.g. `run_delta.leader.
 *    current_leading_option_id`, gated today on entitlement only);
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
import { keyNamesLeader, withoutLeaderDesignations } from './licensed-run-view.js';
import {
  findLeaderClaims,
  optionLabelPattern,
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from '../compose/leading-option-egress-guard.js';
import {
  enforceLeadingOptionClaimsAtWire,
  optionRosterFromAnalysisReady,
  optionRosterFromGraph,
  type WireLeaderClaimEnforcementOpts,
} from '../compose/leading-option-wire-enforcement.js';
import { projectTransportEnrichmentForWithheldClaim } from '../compose/withheld-claim-projection.js';

/** Top-level members never walked: prose (handled by the shared gate) and the provisional view (permitted by design). */
const SKIPPED_TOP_LEVEL: ReadonlySet<string> = new Set(['assistant_text', 'framing_question', '_agent', 'suggested_actions', 'blocks']);

const CHIP_TEXT_MEMBERS = ['label', 'message', 'detail'] as const;

const MAX_DEPTH = 40;

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
      out[k] = null;
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

/** The one sentence a reply is replaced by when the final egress itself fails. Leader-free by construction. */
export const FINAL_EGRESS_FAILED_TEXT =
  'Something went wrong while checking this reply, so it is not shown. Nothing in your model changed; please ask again.';

/** Known-safe: no prose, no chips, no run delta, no enrichment; leader-designating keys nulled on what remains. */
export function knownSafeEnvelope(response: Record<string, unknown>): Record<string, unknown> {
  const src = response;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'assistant_text' || k === 'framing_question' || k === 'suggested_actions' || k === 'run_delta' || k === '_answer_shape') continue;
    out[k] = v;
  }
  const agent = record(src._agent);
  if (agent !== undefined && 'provisional_view' in agent) {
    const { provisional_view: _view, ...rest } = agent;
    out._agent = rest;
  }
  if (Array.isArray(src.blocks)) {
    out.blocks = src.blocks.map((b) => {
      const block = record(b);
      if (block === undefined) return b;
      const { enrichment: _dropped, ...rest } = block;
      return rest;
    });
  }
  const safe: Record<string, unknown> = { ...(withoutLeaderDesignations(out) as Record<string, unknown>), assistant_text: FINAL_EGRESS_FAILED_TEXT, suggested_actions: [] };
  return safe;
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
      if (keyNamesLeader(k) && hasIdentity(v)) { removed.push(k); body = { ...body, [k]: null }; continue; }
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
          if (keyNamesLeader(k) && hasIdentity(v)) { removed.push(`blocks[${i}].${k}`); out = { ...out, [k]: null }; }
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
