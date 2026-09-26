/**
 * Case classes for Agent-lane turns.
 *
 * A class is the pair (what the USER did, what the SERVER did about it). The
 * user's action is known from the capture (the witness labels every turn it
 * sends) or from a fixture's `context.user_action`; the outcome — did a run
 * produce a result, was a leader permitted — is read off the response payload.
 */
import { ranAnalysisThisTurn, runBlockedThisTurn, type ReplyView } from './wire.js';

export const CASE_CLASSES = [
  'build_hiring',
  'build_pricing',
  'build_heldout',
  'run_leader_permitted',
  'run_leader_withheld',
  'run_blocked',
  'approval_chip',
  'approval_typed',
  'edit_no_run',
  'rerun_after_edit',
  'rerun_no_change',
  'challenge',
  'uncertainty_followup',
  'decline',
  'option_request',
  'exact_retry_replay',
  'no_reply',
  'unclassified',
] as const;
export type CaseClass = (typeof CASE_CLASSES)[number];

export type UserAction =
  | 'brief'
  | 'approve_chip'
  | 'approve_typed'
  | 'run'
  | 'rerun'
  | 'edit'
  | 'challenge'
  | 'uncertainty'
  | 'decline'
  | 'retry'
  | 'option_request'
  | 'other';

export type Domain = 'hiring' | 'pricing' | 'heldout' | 'unknown';

/** The witness's own turn vocabulary (construction-witness/acceptance-witness.mjs). */
export function userActionFromLabel(label: string): UserAction {
  const l = label.toLowerCase();
  if (/\bbrief\b/.test(l)) return 'brief';
  if (/exact retry/.test(l)) return 'retry';
  if (/approve[^()]*\(typed chip\)/.test(l)) return 'approve_chip';
  if (/\bapprove\b/.test(l)) return 'approve_typed';
  if (/canvas edit/.test(l)) return 'edit';
  if (/\bre-?run\b/.test(l)) return 'rerun';
  if (/\brun\b/.test(l)) return 'run';
  if (/challenge/.test(l)) return 'challenge';
  if (/uncertaint/.test(l)) return 'uncertainty';
  if (/decline/.test(l)) return 'decline';
  if (/ask for an option/.test(l)) return 'option_request';
  return 'other';
}

/** Witness scenario letters → the brief each one sends (A/D/E/O hiring, B/W pricing, G any held-out brief). */
export function domainFromScenario(sc: string): Domain {
  if (/^[ADEO]$/.test(sc)) return 'hiring';
  if (/^[BW]$/.test(sc)) return 'pricing';
  if (/^G$/.test(sc)) return 'heldout';
  return 'unknown';
}

export type RerunKind = 'after_edit' | 'no_change';

export interface ClassifyContext {
  readonly userAction: UserAction;
  readonly domain: Domain;
  /** For a re-run: did the model change since the previous run in this conversation? */
  readonly rerunKind?: RerunKind | null;
}

export function classify(v: ReplyView, ctx: ClassifyContext): CaseClass {
  if (!v.hasBody || (v.http !== null && v.http !== 200) || v.text.trim() === '') return 'no_reply';
  switch (ctx.userAction) {
    case 'brief':
      return ctx.domain === 'pricing' ? 'build_pricing' : ctx.domain === 'hiring' ? 'build_hiring' : 'build_heldout';
    case 'retry':
      return 'exact_retry_replay';
    case 'approve_chip':
      return 'approval_chip';
    case 'approve_typed':
      return 'approval_typed';
    case 'edit':
      return 'edit_no_run';
    case 'rerun':
      return ctx.rerunKind === 'no_change' ? 'rerun_no_change' : 'rerun_after_edit';
    case 'run':
      if (runBlockedThisTurn(v) || !v.hasAnalysisResult) return 'run_blocked';
      return v.leaderClaim?.permitted === true ? 'run_leader_permitted' : 'run_leader_withheld';
    case 'challenge':
      return 'challenge';
    case 'uncertainty':
      return 'uncertainty_followup';
    case 'decline':
      return 'decline';
    case 'option_request':
      return 'option_request';
    default:
      break;
  }
  // No witness label: fall back to what the server did.
  if (v.replayed) return 'exact_retry_replay';
  const names = v.toolCalls.map((t) => t.name);
  if (names.includes('build_model_from_brief')) return ctx.domain === 'pricing' ? 'build_pricing' : ctx.domain === 'hiring' ? 'build_hiring' : 'build_heldout';
  if (names.includes('authorise_change')) return v.fastPath === 'approve' ? 'approval_chip' : 'approval_typed';
  if (names.includes('run_analysis') || v.fastPath === 'run') {
    if (runBlockedThisTurn(v) || !ranAnalysisThisTurn(v)) return 'run_blocked';
    return v.leaderClaim?.permitted === true ? 'run_leader_permitted' : 'run_leader_withheld';
  }
  if (v.exitPath === 'agent_lane_forwarded' && v.hasGraphPatch) return 'edit_no_run';
  return 'unclassified';
}

/** Classes whose reply reports (or should report) an analysis result. */
export const REPORTS_ANALYSIS: ReadonlySet<CaseClass> = new Set<CaseClass>([
  'run_leader_permitted',
  'run_leader_withheld',
  'run_blocked',
  'rerun_after_edit',
  'rerun_no_change',
  'challenge',
  'uncertainty_followup',
]);
