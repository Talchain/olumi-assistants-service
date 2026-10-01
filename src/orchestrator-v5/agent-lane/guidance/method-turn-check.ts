import { POLICY } from './policy.js';
import type { MethodInputs, MethodTurnCheck, MethodTurnId, SuppliedItem } from './types.js';

function normalise(text: string): string {
  return text.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
const foldQuotes = (text: string) => text.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"');
/**
 * shared.label_masking: the reply with the user's own labels blanked (case-insensitive, quotes folded, longest first).
 * Every text BAN runs on this: a label the user wrote is grounding, not a claim (served D1's factor "Enterprise prospect
 * signing likelihood" failed PM-NO-PROB on every grounded story, SCIENCE/DSK 5938372911). Only supplied labels are masked.
 */
function masked(reply: string, labels: readonly (string | undefined)[]): string {
  const own = [...new Set(labels.filter((l): l is string => typeof l === 'string' && l.trim() !== '').map(foldQuotes))]
    .sort((a, b) => b.length - a.length);
  let out = foldQuotes(reply);
  // Whole tokens only: option 'A' must never blank the 'a' in 'probability' (HARNESS #2478 P1).
  for (const label of own) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu'), ' ');
  return out;
}
/** WHOLE-TOKEN match after normalise(): label 'B' never matches inside another word (HARNESS #2478 P1). */
function labelMatches(text: string, labels: readonly string[]): boolean {
  const normal = ` ${normalise(text)} `;
  return labels.some(label => normalise(label) !== '' && normal.includes(` ${normalise(label)} `));
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** A supplied item grounds a story by its ref as a whole word, or by EVERY label (a link needs both ends). */
function itemMatches(text: string, item: SuppliedItem): boolean {
  if (item.ref && new RegExp(`\\b${escape(item.ref)}\\b`, 'u').test(text)) return true;
  return (item.labels ?? []).length > 0 && item.labels!.every(label => labelMatches(text, [label]));
}
const NUMBERED = /^\s*[1-9]\.\s/u;
const BLINDSPOT = /^\s*Outside the model:\s/u;
/** A story runs from its numbered line to the next numbered line, the 'Outside the model:' line, or the end. */
function numberedItems(reply: string): string[] {
  const items: string[] = [];
  let current: string | undefined;
  for (const line of reply.split(/\r?\n/u)) {
    if (NUMBERED.test(line)) { if (current !== undefined) items.push(current); current = line.replace(NUMBERED, ''); }
    else if (BLINDSPOT.test(line)) { if (current !== undefined) items.push(current); current = undefined; }
    else if (current !== undefined) current += `\n${line}`;
  }
  if (current !== undefined) items.push(current);
  return items.map(item => item.trim());
}
/** Exactly one 'Outside the model:' question, after every story. */
function blindspotOk(reply: string): boolean {
  const lines = reply.split(/\r?\n/u);
  const blind = lines.flatMap((line, i) => BLINDSPOT.test(line) ? [i] : []);
  const numbered = lines.flatMap((line, i) => NUMBERED.test(line) ? [i] : []);
  return blind.length === 1 && lines[blind[0]].trimEnd().endsWith('?') && numbered.every(i => i < blind[0]);
}
function numberTokens(reply: string): string[] {
  const body = reply.replace(/^\s*[1-9]\.\s/gmu, '');
  return [...body.matchAll(/(?<![A-Za-z])[£$€]?\d[\d,]*(?:\.\d+)?\s*(?:%|k|m|bn)?/giu)].map(m => m[0].trim());
}
const digits = (text: string) => text.replace(/\D/gu, '');
function supplied(token: string, figures: readonly string[]): boolean {
  const value = digits(token);
  return value !== '' && figures.some(figure => value === digits(figure));
}

/** Exactly the text post-checks; no mechanism judgement and no fallback generation. */
export function checkMethodTurn(policy_id: MethodTurnId, reply: string, inputs: MethodInputs): MethodTurnCheck {
  const failed: string[] = [];
  let targets: (string | null)[] = [];
  // shared.label_masking: every node label of the current model is the user's word, never a claim.
  const model = inputs.model_labels ?? [];
  const check = (id: string, pass: boolean) => { if (!pass) failed.push(id); };
  if (policy_id === 'RC-PREMORTEM') {
    const items = numberedItems(reply);
    // Supplied order is action priority, so each story's target is the FIRST supplied item it rests on.
    targets = items.map(item => (inputs.supplied_items ?? []).find(supplied => itemMatches(item, supplied))?.id ?? null);
    check('PM-COUNT', items.length >= 2 && items.length <= 3);
    check('PM-GROUNDED', items.length > 0 && targets.every(target => target !== null));
    check('PM-WATCH-MITIGATE', items.length > 0 && items.every(item => item.includes('Watch for:') && item.includes('Mitigate:')));
    const own = masked(reply, [...model, ...(inputs.supplied_items ?? []).flatMap(item => item.labels ?? []), inputs.plan_label, ...(inputs.current_option_labels ?? [])]);
    check('PM-NO-PROB', !own.includes('%') && !/\b(likely|likelihood|chance|probability|probable|odds)\b/iu.test(own));
    check('PM-NO-PREDICTION', !/\b(will|is going to|are going to) fail\b/iu.test(own));
    const otherOptions = (inputs.current_option_labels ?? []).filter(label => normalise(label) !== normalise(inputs.plan_label ?? ''));
    check('PM-PLAN-ONLY', !labelMatches(reply, otherOptions));
    check('PM-BLINDSPOT', blindspotOk(reply));
  } else if (policy_id === 'RERUN-EXPLANATION') {
    check('RX-NAMES-CHANGES', (inputs.change_labels ?? []).slice(0, 3).every(label => labelMatches(reply, [label])));
    const labels = [...model, ...(inputs.change_labels ?? []), ...(inputs.current_option_labels ?? [])];
    const own = masked(reply, labels);
    check('RX-NO-CAUSE-UNPAIRED', inputs.attribution_case === 'C1_attributable'
      || !/\b(because (you|of your)|caused|due to your|as a result of your|led to)\b/iu.test(own));
    const sentences = reply.split(/(?<=[.!?])\s+|\n/u);
    check('RX-NO-LEADER-UNLICENSED', inputs.leader_licensed === true || !sentences.some(sentence =>
      labelMatches(sentence, inputs.current_option_labels ?? []) && /\b(leads|ahead|best|wins|now first)\b/iu.test(masked(sentence, labels))));
    check('RX-NOISE', inputs.noise_verdict !== 'not_noise_qualified'
      || !/\b(significant|meaningful(ly)? (better|worse)|clearly (better|worse))\b/iu.test(own));
    // The earlier run had no figures to move from (prior_withheld), or no option has figures in both runs.
    check('RX-NO-MOVEMENT-WITHOUT-PRIOR', !(inputs.prior_withheld === true || inputs.no_matched_figures === true)
      || !/\b(rose|fell|moved|increased|decreased|went (up|down)|up from|down from|jumped|dropped|climbed)\b/iu.test(own));
  } else if (policy_id === 'RC-WIDEN') {
    const items = reply.split(/\r?\n/u).filter(line => /^\s*-\s/u.test(line)).map(line => line.trim().slice(1).trim());
    check('WD-COUNT', items.length >= 1 && items.length <= 3);
    const exempt = new Set((inputs.left_out_labels ?? []).map(normalise));
    const current = new Set([...(inputs.current_option_labels ?? []), ...(inputs.current_risk_labels ?? []),
      ...(inputs.current_factor_labels ?? [])].map(normalise).filter(label => !exempt.has(label)));
    check('WD-NO-DUP', !items.some(item => current.has(normalise(item.split(':', 1)[0].trim()))));
    const figures = [...(inputs.supplied_figures ?? []), ...numberTokens(inputs.brief ?? ''),
      ...(inputs.user_messages ?? []).flatMap(numberTokens), ...(inputs.user_figures ?? [])];
    check('WD-NO-NEW-FIGURES', numberTokens(reply).every(token => supplied(token, figures)));
    check('WD-W1-NO-MEETS', inputs.variant !== 'W1' || !items.some(item => /\b(meets?|clears?|stays? (within|under)|within)\b[^.]{0,40}\blimit\b/iu.test(item)));
  } else if (policy_id === 'RC-WHAT-CHANGES') {
    check('WC-NAMES-FACTOR', labelMatches(reply, [inputs.factor_label ?? '']));
    const figures = [...(inputs.user_figures ?? []), ...(inputs.user_messages ?? []).flatMap(numberTokens),
      ...(inputs.factor_current_value === undefined ? [] : [String(inputs.factor_current_value)])];
    check('WC-NO-NEW-FIGURES', numberTokens(reply).every(token => supplied(token, figures)));
    const own = masked(reply, [...model, inputs.factor_label]);
    check('WC-NO-NOTHING', !/nothing would change|no single (assumption|factor)/iu.test(own));
    check('WC-BANNED', !/\b(EVPI|EVPPI|sensitivity score|elasticity)\b/iu.test(own) && !own.includes('%'));
  } else if (policy_id === 'RC-STRENGTHEN-ITEM') {
    const labels = inputs.item_labels ?? [];
    check('ST-NAMES-ITEM', labels.length > 0 && labels.every(label => labelMatches(reply, [label])));
    check('ST-BANNED', !/\b(placeholder|edge|node|default strength)\b/iu.test(masked(reply, [...model, ...labels])));
    const figures = [...(inputs.user_figures ?? []), ...(inputs.user_messages ?? []).flatMap(numberTokens),
      ...(inputs.item_current_value === undefined ? [] : [String(inputs.item_current_value)])];
    check('ST-NO-NEW-FIGURES', numberTokens(reply).every(token => supplied(token, figures)));
  } else {
    const labels = (inputs.edited_labels ?? []).slice(0, 3);
    check('CE-NAMES-EDITS', labels.length > 0 && labels.every(label => labelMatches(reply, [label])));
    check('CE-STALE-IFF', /out of date/iu.test(reply) === (inputs['run.kind'] === 'complete_stale'));
    check('CE-NO-RESULT-CLAIM', !/\b(the result (has )?changed|now leads|is now ahead|the answer is now)\b/iu.test(masked(reply, [...model, ...(inputs.edited_labels ?? [])])));
  }
  // Fail immediately on implementation/policy drift, rather than quietly leaving a rule unchecked.
  const expected = POLICY.method_turns[policy_id].post_checks.map(rule => rule.id);
  if (failed.some(id => !expected.some(expectedId => expectedId === id))) throw new Error('Unknown text post-check id');
  return { pass: failed.length === 0, failed, targets };
}
