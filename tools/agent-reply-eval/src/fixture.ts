/**
 * The shared acceptance fixture — prompt/harness half.
 *
 * A case is ONE captured Agent-lane response cut down to the fields the scorer
 * reads, with every identifier removed, plus an `expect` block stating what a
 * good reply to that same state must and must not do. The AI Conversation lane
 * adds the rendering half (`expect_render`) to the same cases.
 *
 * ⛔ Nothing here may carry an id: no request / session / turn / scenario / trace
 * id, no proposal id, no graph hash, no timestamp. `assertNoIds` enforces it on
 * the serialised case, and the builder refuses to write a case that fails it.
 */
import { caveatReasons, type CheckName, type Verdict } from './checks.js';
import type { CaseClass, Domain, RerunKind, UserAction } from './classify.js';
import { DEFAULT_WORDS_SOFT, scoreWire, type TurnScore } from './score.js';
import { viewOf } from './wire.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const PROPOSAL_ID = /prop_[0-9a-f]{6,}/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** 16+ hex characters with at least one letter (a pure digit run is a number, e.g. a float mantissa). */
const LONG_HEX = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi;

export function redactText(s: string): string {
  return s.replace(PROPOSAL_ID, 'prop_redacted').replace(UUID, 'uuid-redacted').replace(LONG_HEX, 'hex-redacted');
}

const pick = (o: Rec | null, keys: readonly string[]): Rec => {
  const out: Rec = {};
  if (o === null) return out;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

/** The minimal, id-free payload the scorer needs. */
export function stripPayload(json: unknown): Rec {
  const w = rec(json) ?? {};
  const state = rec(w.analysis_state);
  const ready = rec(w.analysis_ready);
  const trace = rec(w._diagnostic_trace);
  const agent = rec(w._agent);
  const runState = rec(state?.run_state);
  return {
    assistant_text: typeof w.assistant_text === 'string' ? redactText(w.assistant_text) : '',
    suggested_actions: arr(w.suggested_actions).map((c) => {
      const chip = rec(c) ?? {};
      return { ...pick(chip, ['label', 'action_type']), id: redactText(String(chip.id ?? '')) };
    }),
    analysis_state:
      state === null
        ? null
        : {
            run_state: pick(runState, ['kind', 'cause']),
            leader_claim: rec(state.leader_claim),
            robustness: rec(state.robustness),
          },
    analysis_ready:
      ready === null
        ? null
        : {
            analysis_admission: pick(rec(ready.analysis_admission), ['permitted_analysis_mode', 'structurally_analysable']),
            options: arr(ready.options).map((o) => {
              const opt = rec(o) ?? {};
              const details = rec(opt.intervention_details) ?? {};
              return {
                option_id: opt.option_id,
                label: opt.label,
                intervention_details: Object.fromEntries(
                  Object.entries(details).map(([f, d]) => [f, pick(rec(d), ['raw_value', 'unit', 'display_value'])]),
                ),
              };
            }),
          },
    blocks: arr(w.blocks).map((b) => {
      const block = rec(b) ?? {};
      if (block.type !== 'analysis_result') return { type: block.type };
      const robustness = rec(rec(block.enrichment)?.robustness);
      return {
        type: 'analysis_result',
        summary: block.summary,
        leading_option_id: block.leading_option_id,
        win_probabilities: block.win_probabilities,
        enrichment: { robustness: { level: robustness?.level, near_tie: pick(rec(robustness?.near_tie), ['is_tie']) } },
      };
    }),
    draft_graph: {
      nodes: arr(rec(w.draft_graph)?.nodes).map((n) => {
        const node = rec(n) ?? {};
        const interventions = rec(node.interventions);
        return {
          ...pick(node, ['id', 'kind', 'label', 'provenance', 'display_value']),
          ...(rec(node.observed_state) !== null ? { observed_state: pick(rec(node.observed_state), ['unit', 'value', 'raw_value', 'source']) } : {}),
          ...(interventions !== null
            ? { interventions: Object.fromEntries(Object.entries(interventions).map(([f, c]) => [f, pick(rec(c), ['value', 'source'])])) }
            : {}),
        };
      }),
    },
    _agent: {
      mutated: agent?.mutated,
      tool_calls: arr(agent?.tool_calls).map((t) => pick(rec(t), ['name', 'ok', 'mutated', 'refusal'])),
    },
    _diagnostic_trace: {
      ...pick(trace, ['exit_path', 'fast_path', 'replayed', 'write_claims_removed']),
      ...(Array.isArray(trace?.llm_calls) ? { llm_calls: trace.llm_calls.map(() => ({})) } : {}),
    },
    _provider_calls: Array.isArray(w._provider_calls) ? w._provider_calls.map((p) => pick(rec(p), ['provider', 'model', 'purpose'])) : null,
  };
}

export function assertNoIds(serialised: string): void {
  const hits = [...(serialised.match(PROPOSAL_ID) ?? []), ...(serialised.match(UUID) ?? []), ...(serialised.match(LONG_HEX) ?? [])].filter(
    (h) => h !== 'prop_redacted',
  );
  if (hits.length > 0) throw new Error(`fixture carries identifier-like strings: ${[...new Set(hits)].slice(0, 5).join(', ')}`);
  for (const key of ['request_id', 'session_id', 'turn_id', 'scenario_id', 'graph_hash', 'computed_at', 'computed_against_hash', 'brief_id']) {
    if (serialised.includes(`"${key}"`)) throw new Error(`fixture carries a "${key}" field`);
  }
}

export interface FixtureContext {
  readonly user_action: UserAction;
  readonly domain: Domain;
  readonly rerun_kind: RerunKind | null;
  readonly next_approval_ran: boolean | null;
}

export interface FixtureExpect {
  /** "Up to about 90 words by default": soft — no minimum, no absolute cap. */
  readonly max_words_default: number;
  readonly words_soft: true;
  readonly max_questions: number;
  /** Runtime PR-B's rule: leader_claim.permitted AND permitted_analysis_mode = comparative_leader. null = not decidable from the payload. */
  readonly leader_may_be_named: boolean | null;
  readonly leader_withheld_reason: string | null;
  readonly caveat_required: boolean;
  readonly caveat_reasons: readonly string[];
  readonly chips_shown: readonly string[];
  readonly forbidden_claims: readonly string[];
  readonly next_move: 'only_when_supported';
  readonly notes: readonly string[];
}

export interface FixtureCase {
  readonly id: string;
  readonly class: CaseClass;
  readonly source: { readonly capture: string; readonly build: string; readonly scenario: string; readonly turn: string };
  readonly context: FixtureContext;
  readonly payload: Rec;
  readonly expect: FixtureExpect;
  /** What the SERVED reply in this capture did, by the scorer at the time the fixture was built — a record, not an expectation. */
  readonly served_reply_verdicts: Record<CheckName, Verdict>;
}

export function scoreFixtureCase(c: Pick<FixtureCase, 'id' | 'source' | 'context' | 'payload'>): TurnScore {
  return scoreWire(
    c.payload,
    200,
    { capture: c.source.capture, build: c.source.build, scenario: c.source.scenario, turn: c.source.turn, index: 0 },
    {
      userAction: c.context.user_action,
      domain: c.context.domain,
      rerunKind: c.context.rerun_kind,
      nextApprovalRan: c.context.next_approval_ran,
    },
  );
}

export function expectFor(score: TurnScore, payload: Rec): FixtureExpect {
  const v = viewOf(payload, 200);
  const f = score.facets;
  const leaderMay = f.leaderMayBeNamedPrB;
  const caveat = score.checks.CAVEAT;
  const caveatRequired = caveat.verdict !== 'NOT_DECIDABLE' && !caveat.vacuous;
  const wrote = v.toolCalls.some((t) => (t.name === 'authorise_change' || t.name === 'build_model_from_brief') && t.mutated === true) || (v.exitPath === 'agent_lane_forwarded' && v.hasGraphPatch);
  const offered = v.chips.some((c) => c.id.startsWith('agent-approve-proposal'));
  const forbidden = [
    ...(leaderMay === true ? [] : ['names_or_hints_a_leading_option']),
    ...(wrote ? [] : ['claims_a_save_or_version']),
    ...(f.ranAnalysis ? [] : ['claims_the_analysis_ran_this_turn']),
    ...(offered ? [] : ['asks_to_approve_or_claims_a_pending_proposal']),
    'promises_the_analysis_will_run_on_approval',
    'names_a_control_not_in_chips_shown',
    'calls_a_brief_stated_or_measured_figure_an_estimate',
    'calls_an_olumi_figure_the_users',
    'renames_an_option',
    'quotes_a_figure_without_its_unit',
  ];
  return {
    max_words_default: DEFAULT_WORDS_SOFT,
    words_soft: true,
    max_questions: 1,
    leader_may_be_named: leaderMay,
    leader_withheld_reason: f.withheldReason,
    caveat_required: caveatRequired,
    caveat_reasons: caveatRequired ? caveatReasons(v, score.cls).reasons : [],
    chips_shown: v.chips.map((c) => c.label),
    forbidden_claims: forbidden,
    next_move: 'only_when_supported',
    notes: [
      'A next move is offered only when the state supports it; the reply never asks the user to press a chip it was not shown.',
      'Olumi states saves and versions beneath the reply; the model does not restate them.',
      ...(score.metrics.splitBasis === 'fast_path_approve' || score.metrics.splitBasis === 'forwarded_no_llm'
        ? ['Every word of this reply is server-authored (no model call); the prompt cannot change it.']
        : []),
    ],
  };
}
