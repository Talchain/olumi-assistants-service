/**
 * ⭐ A JOURNEY-A-SHAPED AGENT HISTORY — one run, then three propose → approve cycles (two options as one change, a
 * risk, a link's strength), as the DL's served run `pj-20260927T181846Z` (CEE 523e18d, scenario 1ceb77d8, turns
 * A02–A11; the grandfather cycle A05–A06 and the tool-less A07 are left out) made them. The user messages, chip
 * messages and Olumi statuses of the chip path are copied from that run's raw turns (the composer path's "yes" and
 * replies are composed: that path was not served); every tool output carries the fields its producer returns
 * (agent-capabilities.ts @ 9bd3747c: propose_new_option :4409, propose_new_risk :4568, propose_link_strength :1749,
 * confirmHeld :1198, update_edge :2669, `readiness_after` :4821, run_analysis :4791). The served per-call input deltas
 * bound each output: a successful proposal's 230–990 tokens (A03 720–743, A05 607–991, A08 232–373, A10 300–615, by
 * whether the reasoning item is re-billed), the run's 3,870–3,877 (A02). Here, serialised: the options 3,499 bytes,
 * the risk 935, the link 1,243 — the run is the served one, 14,865.
 *
 * Two approval paths, because the route records them differently (agent-v1-turn.ts @ 9bd3747c):
 *   - `composer`: the user types "yes" and the Agent calls authorise_change — a function_call/function_call_output
 *     pair naming the proposal lands in the history (agent-loop.ts :318, :389–393);
 *   - `chip`: the approve chip's fast path (agent-v1-turn.ts :1696–1751) appends ONLY the chip's message and Olumi's
 *     status — no call, no output, no proposal id. What it applied is on that turn's own `tool_results`.
 */

import { readFileSync } from 'node:fs';
import { analysisResultForAgent } from '../../decision-sensitivity.js';
import { claimPermissionsFrom } from '../../first-analysis.js';

export const REVISION = 'a3f09c1d'.repeat(8);
const OPTIONS_REF = 'gmh_2ec2e716e07c';
const RISK_REF = 'gmh_283bdd4d39ca';
const LINK_REF = 'prop_4f806dbf5ac981af36413822a2c810fd';
export const PROPOSAL_IDS = { options: OPTIONS_REF, risk: RISK_REF, link: LINK_REF } as const;

export const user = (text: string) => ({ role: 'user', content: [{ type: 'input_text', text }] });
export const said = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
export const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
export const out = (id: string, result: unknown) => ({ type: 'function_call_output', call_id: id, output: JSON.stringify(result) });

const SWITCH_NOTE = 'These factors are switches: Olumi takes each as off today and the option switches it on. Say that it is off today '
  + 'is Olumi’s reading of the option, for the user to correct, and that how strongly each changes what it acts on is Olumi’s estimate.';

/**
 * A02: the run — THE SERVED ONE. Built by the tool's own producers (`analysisResultForAgent`, `claimPermissionsFrom`, the
 * fields of agent-capabilities.ts :4791) over the analysis_result block, analysis_ready and analysis_state that turn
 * served, verbatim (`served-pj-a02-run.json`). It is the latest run, so it is kept: it sets the realistic floor.
 */
const served = JSON.parse(readFileSync(new URL('./served-pj-a02-run.json', import.meta.url), 'utf8')) as {
  analysis_result: unknown; analysis_ready: { status?: string; blockers?: unknown[]; options?: unknown[] }; analysis_state: unknown; assistant_text: string;
};
export const RUN_RESULT = {
  ok: true, mutated: false, ran: true,
  status: served.analysis_ready.status ?? 'unknown',
  what_is_missing: served.assistant_text,
  blockers: served.analysis_ready.blockers ?? [],
  options: served.analysis_ready.options ?? [],
  result: analysisResultForAgent(served.analysis_result),
  claim_permissions: claimPermissionsFrom(served.analysis_state, served.analysis_ready, { requested: true }),
};

/** A03: two options as ONE held change (`gmh_`), each with a new switch factor. */
const OPTIONS_ARGS = {
  options: [
    { label: 'Improve trial-to-Pro conversion', acts_on: [{ factor: 'Trial-to-Pro conversion improvement', direction: 'raises it', level: { value: 1, estimate: 'The option switches the improvement on.' } }] },
    { label: 'Retention intervention for at-risk accounts', acts_on: [{ factor: 'At-risk account retention intervention', direction: 'raises it', level: { value: 1, estimate: 'The option switches the intervention on.' } }] },
  ],
  new_factors: [
    { label: 'Trial-to-Pro conversion improvement', kind: 'switch', changes: [{ factor: 'Pro paying subscribers at month 12', direction: 'raises it' }] },
    { label: 'At-risk account retention intervention', kind: 'switch', changes: [{ factor: 'Monthly churn rate', direction: 'lowers it' }] },
  ],
  rationale: 'The user asked to compare two non-price levers alongside the price options.',
};
const OPTIONS_CHIP_MESSAGE = "Yes, add option 'Improve trial-to-Pro conversion', add factor 'Trial-to-Pro conversion improvement', add factor 'At-risk account retention intervention', link 'Decision: MRR' to 'Improve trial-to-Pro conversion', link 'Trial-to-Pro conversion improvement' to 'Pro paying subscribers at month…', link 'At-risk account retention intervention' to 'Monthly churn rate', link 'Improve trial-to-Pro conversion' to 'Trial-to-Pro conversion improvement', add option 'Retention intervention for at-risk accounts', link 'Decision: MRR' to 'Retention intervention for at-risk accounts' and link 'Retention intervention for at-risk accounts' to 'At-risk account retention intervention'.";
export const OPTIONS_PROPOSED = {
  ok: true, mutated: false,
  proposal_id: OPTIONS_REF,
  public_label: 'Approve 10 changes',
  held_message: OPTIONS_CHIP_MESSAGE,
  held_detail: OPTIONS_CHIP_MESSAGE.replace(/^Yes, /, '').split(/, (?=add|link)| and (?=link)/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('\n'),
  base_revision: REVISION,
  options: OPTIONS_ARGS.options.map((o) => ({
    label: o.label, linked_from: 'Decision: MRR', acts_on: o.acts_on.map((a) => a.factor),
    levels: o.acts_on.map((a) => ({ factor: a.factor, value: 1, stated_by: 'olumi_estimate', basis: a.level.estimate })),
  })),
  new_factors: OPTIONS_ARGS.new_factors.map((f) => ({
    label: f.label, changes: f.changes.map((c) => `${c.factor} (${c.direction})`), how_strongly: 'Olumi’s estimate, for the user to correct',
    kind: 'switch', today: 'off — Olumi’s reading of the option, for the user to correct', under_the_option: 'on',
  })),
  new_factors_note: SWITCH_NOTE,
  note: 'Nothing has changed yet. Show the user all 2 options, as ONE change they approve once, that each is linked from the decision, what it acts on and each level — saying plainly which have no level yet, and which levels are Olumi’s estimates (stated_by olumi_estimate), with why, for the user to correct — never the id, and call authorise_change with this proposal_id once they agree.',
};
const OPTIONS_STATUS = 'Added "Improve trial-to-Pro conversion", linked from the decision and acting on "Trial-to-Pro conversion improvement". Its level for "Trial-to-Pro conversion improvement" is Olumi\'s estimate, for you to correct. Added "Retention intervention for at-risk accounts", linked from the decision and acting on "At-risk account retention intervention". Its level for "At-risk account retention intervention" is Olumi\'s estimate, for you to correct. Also added the factor "Trial-to-Pro conversion improvement", which changes "Pro paying subscribers at month…"; how strongly is not known yet: Olumi used a placeholder strength, not an estimate. Olumi takes it as off today and the option switches it on; that it is off today is Olumi\'s estimate, for you to correct. Also added the factor "At-risk account retention intervention", which changes "Monthly churn rate"; how strongly is not known yet: Olumi used a placeholder strength, not an estimate. Olumi takes it as off today and the option switches it on; that it is off today is Olumi\'s estimate, for you to correct.';
const SAVED_TAIL = '\n\nSaved. The analysis on screen was computed before this change; run it again to see the comparison with this change.';

const readinessAfter = (needs: readonly string[]) => ({
  checked: true, may_run: true,
  needs_from_user: needs.map((factor) => ({ message: `"${factor}" has no current value yet, so the comparison uses Olumi’s placeholder for it.`, factor })),
  olumi_can_offer: [], will_run_without: [], levels_not_set: [],
});
const receipt = (version: number) => ({ version, version_id: `ver_${String(version).padStart(4, '0')}${'9c1d'.repeat(7)}`, mutation_id: `mut_${'4e7a'.repeat(8)}`, source_turn_id: `agent-authorise:${'5b2f'.repeat(8)}` });

/** confirmHeld's result, as the approval guard hands it on (with `readiness_after`). */
export const OPTIONS_APPLIED = {
  ok: true, mutated: true, applied: true, outcome: 'applied', proposal_id: OPTIONS_REF,
  receipts: [receipt(4)], follow_up: OPTIONS_STATUS,
  readiness_after: readinessAfter(['Trial-to-Pro conversion improvement', 'At-risk account retention intervention']),
};

/** A08: a new risk, held (`gmh_`). */
const RISK_ARGS = { label: 'Competitor price or AI-feature response', threatens: [{ factor: 'MRR', direction: 'lowers it' }], driven_by: [], rationale: 'The user asked to add the competitive-response risk discussed earlier.' };
const RISK_CHIP_MESSAGE = "Yes, add risk 'Competitor price or AI-feature response' and link 'Competitor price or AI-feature response' to 'MRR'.";
export const RISK_PROPOSED = {
  ok: true, mutated: false,
  proposal_id: RISK_REF,
  public_label: 'Approve 2 changes',
  held_message: RISK_CHIP_MESSAGE,
  held_detail: "Add risk 'Competitor price or AI-feature response'\nLink 'Competitor price or AI-feature response' to 'MRR'",
  base_revision: REVISION,
  risk: { label: RISK_ARGS.label, threatens: ['MRR (lowers it)'], driven_by: [], how_strongly: 'not known yet: Olumi uses a placeholder strength for each link, not an estimate' },
  note: 'Nothing has changed yet. Tell the user it will add the risk, what it threatens and what drives it, and that how strongly is a placeholder for them to correct — never the id — and call authorise_change with this proposal_id once they agree.',
};
const RISK_STATUS = 'Added "Competitor price or AI-feature response" as a risk, affecting "MRR"; how strongly is not known yet: Olumi used a placeholder strength, not an estimate.';
export const RISK_APPLIED = {
  ok: true, mutated: true, applied: true, outcome: 'applied', proposal_id: RISK_REF,
  receipts: [receipt(5)], follow_up: RISK_STATUS, readiness_after: readinessAfter(['Trial-to-Pro conversion improvement', 'At-risk account retention intervention']),
};

/** A10: a link's strength, read from the user's own words (slice C3). */
const LINK_ARGS = { from_label: 'Price sensitivity', to_label: 'Monthly churn rate', strength: 'very strong', from_words: 'very high', rationale: 'Churn rose 15% after the last £4 price rise.' };
const INTERPRETATION = { field: 'strength', from_words: 'very high', reading: 'very strong', shown_as: 'Record as very strong (your "very high")' };
export const LINK_PROPOSED = {
  ok: true, mutated: false,
  proposal_id: LINK_REF,
  public_label: 'Record "Price sensitivity" → "Monthly churn rate" as very strong, Olumi’s reading of your "very high" (0.85 on Olumi\'s 0–1 scale), as your own estimate',
  base_revision: REVISION,
  link: { from: 'Price sensitivity', to: 'Monthly churn rate', was: { band: 'weak', strength: '0.0075', direction: 'positive' }, becomes: { band: 'very strong', strength: '0.85', direction: 'positive' }, keeps_current_strength: false },
  interpretation: INTERPRETATION,
  note: 'This is your reading of the user’s own words "very high" as very strong: say so plainly ("I’ve read your “very high” as very strong"), so that approving it approves that reading. Nothing has changed yet. Tell the user it will be recorded as very strong, which Olumi stores as 0.85 on its 0–1 strength scale, as their own estimate — never the id — and call authorise_change with this proposal_id once they agree.',
};
const LINK_STATUS = 'Recorded "Price sensitivity" → "Monthly churn rate" as very strong, Olumi’s reading of your "very high" (0.85 on Olumi\'s 0–1 scale), as your own estimate.';
export const LINK_APPLIED = {
  ok: true, mutated: true, applied: true, proposal_id: LINK_REF, operation_id: `agent-authorise:${'77aa'.repeat(8)}`,
  receipts: [receipt(6)], follow_up: LINK_STATUS,
  note: 'Recorded as the user’s own estimate. Offer to run the analysis again so they can see what it changes.',
  readiness_after: readinessAfter(['Trial-to-Pro conversion improvement', 'At-risk account retention intervention']),
};

const RUN_REPLY = 'The analysis cannot put any price option forward yet.\n\n• MRR relies on **Pro price × Pro subscribers**, but the model currently adds those effects rather than multiplying them; it therefore cannot determine which price produces more MRR.\n• The £59 scenario meets the under-4% churn constraint in some simulated cases but not all, so compliance is uncertain.\n• The comparison also rests on Olumi’s unvalidated assumptions: 1,360 Pro subscribers at month 12, 3% monthly churn, and £26k other-plan MRR.\n\nNo single recorded assumption measurably changes the comparison; the structural MRR calculation is the limiting issue.';

/** One turn: the items it appends, and the approval results it produced (what the route's `result.tool_results` holds). */
export interface JourneyTurn { readonly items: readonly unknown[]; readonly approvals: readonly unknown[] }

/** The three proposing turns, identical on both paths. */
const PROPOSING: Record<'options' | 'risk' | 'link', JourneyTurn> = {
  options: { approvals: [], items: [
    user('Please add two options to compare: "Improve trial-to-Pro conversion" and "Retention intervention for at-risk accounts".'),
    call('call_opt', 'propose_new_option', OPTIONS_ARGS), out('call_opt', OPTIONS_PROPOSED),
    said('I’ve prepared both options as one change:\n\n- **Improve trial-to-Pro conversion** turns on a new conversion-improvement switch, raising Pro subscribers at month 12.\n- **Retention intervention for at-risk accounts** turns on a new retention switch, lowering monthly churn.\n\nBoth are treated as off today and on under their respective option—Olumi’s reading for you to correct. Their effect sizes are still unknown; no numeric level has been assumed.\n\nApprove this change?'),
  ] },
  risk: { approvals: [], items: [
    user('Why can\'t you just add the risk we\'ve been discussing? I\'ve asked for this update, and you still haven\'t made it.'),
    call('call_risk', 'propose_new_risk', RISK_ARGS), out('call_risk', RISK_PROPOSED),
    said('You’re right—I should have prepared the risk rather than asking again.\n\nI’ve prepared **Competitor price or AI-feature response**, which would lower **MRR** through competitor price cuts or AI-feature deals. Its severity is unknown, so the MRR link uses a placeholder strength, not an estimate. I have not assigned a driver because the model has no factor for the AI launch itself.\n\nApprove this update?'),
  ] },
  link: { approvals: [], items: [
    user('Talking to the team, our customers\' price sensitivity is very high, and we\'ve seen our churn increase by 15% when we made our last price increase. That was only £4.'),
    call('call_link', 'propose_link_strength', LINK_ARGS), out('call_link', LINK_PROPOSED),
    said('That materially challenges the current churn assumption.\n\nI’ve read your **“very high”** as **very strong** for **Price sensitivity → Monthly churn rate**, changing the current Olumi default from slight to **0.85 on its 0–1 strength scale**. Your £4 rise associated with a 15% churn increase is recorded as the rationale for your estimate, not as a separate measured model value.\n\nApprove this link-strength update?'),
  ] },
};

/** The composer path: "yes" typed, the Agent calls authorise_change — the pair names the proposal. */
const composerApproval = (id: string, ref: string, applied: unknown, reply: string): JourneyTurn => ({
  approvals: [applied],
  items: [user('Yes, go ahead.'), call(id, 'authorise_change', { proposal_id: ref }), out(id, applied), said(reply)],
});

/** The chip path, exactly as the fast path stores it: the chip's message and Olumi's status, nothing else. */
const chipApproval = (message: string, status: string, applied: unknown): JourneyTurn => ({
  approvals: [applied],
  items: [user(message), said(`${status}${SAVED_TAIL}`)],
});

/** Journey A's turns A02–A11 (the brief's build is left out: its output is already stubbed by slice C1). */
export function journeyTurns(path: 'composer' | 'chip'): JourneyTurn[] {
  const run: JourneyTurn = { approvals: [], items: [user('Run the analysis'), call('call_run', 'run_analysis', { reason: 'the user asked to run it' }), out('call_run', RUN_RESULT), said(RUN_REPLY)] };
  const approve = path === 'composer'
    ? {
      options: composerApproval('call_ok_opt', OPTIONS_REF, OPTIONS_APPLIED, 'Both options are in the model now.'),
      risk: composerApproval('call_ok_risk', RISK_REF, RISK_APPLIED, 'The risk is in the model now.'),
      link: composerApproval('call_ok_link', LINK_REF, LINK_APPLIED, 'Recorded as very strong, your own estimate.'),
    }
    : {
      options: chipApproval(OPTIONS_CHIP_MESSAGE, OPTIONS_STATUS, OPTIONS_APPLIED),
      risk: chipApproval(RISK_CHIP_MESSAGE, RISK_STATUS, RISK_APPLIED),
      link: chipApproval('Yes, record that.', LINK_STATUS, LINK_APPLIED),
    };
  return [run, PROPOSING.options, approve.options, PROPOSING.risk, approve.risk, PROPOSING.link, approve.link];
}

/** Every item of the journey, in order, unpruned. */
export const journeyItems = (path: 'composer' | 'chip'): unknown[] => journeyTurns(path).flatMap((t) => [...t.items]);
