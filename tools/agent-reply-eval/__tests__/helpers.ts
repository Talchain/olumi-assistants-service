/** Minimal synthetic Agent-lane responses for the discriminating pairs. */
import { scoreWire, type ScoreContext, type TurnScore } from '../src/score.js';

export interface MkOpts {
  text: string;
  options?: string[];
  factors?: { label: string; unit?: string; raw?: number; value?: number; source?: string | null; provenance?: string }[];
  chips?: { label: string; id?: string; action_type?: string }[];
  tools?: { name: string; ok?: boolean; mutated?: boolean }[];
  leader?: { permitted: boolean; withheld_reason?: string; separation?: string } | null;
  mode?: string;
  result?: boolean;
  robustness?: string;
  nearTie?: boolean;
  runState?: string;
  fastPath?: string;
  exitPath?: string;
  providerCalls?: number;
}

export function mk(o: MkOpts): Record<string, unknown> {
  return {
    assistant_text: o.text,
    suggested_actions: (o.chips ?? []).map((c) => ({ id: c.id ?? `chip-${c.label}`, label: c.label, ...(c.action_type ? { action_type: c.action_type } : {}) })),
    analysis_state: {
      run_state: { kind: o.runState ?? (o.result ? 'complete_current' : 'never_run') },
      ...(o.leader === null ? {} : { leader_claim: o.leader ?? { permitted: false, withheld_reason: 'constraint_verdict_withheld' } }),
      robustness: o.robustness ? { aggregate_level: o.robustness } : {},
    },
    analysis_ready: { analysis_admission: { permitted_analysis_mode: o.mode ?? 'comparative_leader' }, options: [] },
    blocks: o.result
      ? [{ type: 'analysis_result', summary: '', enrichment: { robustness: { level: o.robustness ?? 'moderate', near_tie: { is_tie: o.nearTie ?? false } } } }]
      : [],
    draft_graph: {
      nodes: [
        ...(o.options ?? []).map((label, i) => ({ id: `opt_${i}`, kind: 'option', label, provenance: 'from_brief' })),
        ...(o.factors ?? []).map((f, i) => ({
          id: `fac_${i}`,
          kind: 'factor',
          label: f.label,
          provenance: f.provenance ?? 'user_set',
          ...(f.raw !== undefined ? { observed_state: { unit: f.unit, raw_value: f.raw, value: f.value ?? f.raw, source: f.source === undefined ? 'user_override' : f.source } } : {}),
        })),
      ],
    },
    _agent: { tool_calls: (o.tools ?? []).map((t) => ({ name: t.name, ok: t.ok ?? true, mutated: t.mutated ?? false })) },
    _diagnostic_trace: { exit_path: o.exitPath ?? 'agent_lane_v1', ...(o.fastPath ? { fast_path: o.fastPath } : {}) },
    _provider_calls: Array.from({ length: o.providerCalls ?? 1 }, () => ({ provider: 'openai' })),
  };
}

export const CTX: ScoreContext = { userAction: 'other', domain: 'hiring', rerunKind: null, nextApprovalRan: null };

export function score(o: MkOpts, ctx: Partial<ScoreContext> = {}): TurnScore {
  return scoreWire(mk(o), 200, { capture: 'test', build: 'test', scenario: 'T', turn: 't', index: 0 }, { ...CTX, ...ctx });
}

export const HIRING = ['Hire a Tech Lead', 'Hire Two Developers'];
export const RUN_OK = [{ name: 'run_analysis', ok: true, mutated: false }];
