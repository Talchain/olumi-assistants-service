import { POLICY } from './policy.js';
import type { MethodInputs, PolicyId } from './types.js';

function normalise(text: string): string {
  return text.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
function labelMatches(text: string, labels: readonly string[]): boolean {
  const normal = normalise(text);
  return labels.some(label => normalise(label) !== '' && normal.includes(normalise(label)));
}
function refsMatch(text: string, refs: readonly string[]): boolean {
  return refs.some(ref => /^[OFR][0-9]+$/iu.test(ref) && new RegExp(`\\b${ref}\\b`, 'iu').test(text));
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
export function checkMethodTurn(policy_id: PolicyId, reply: string, inputs: MethodInputs): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  const check = (id: string, pass: boolean) => { if (!pass) failed.push(id); };
  if (policy_id === 'RC-PREMORTEM') {
    const items = reply.split(/^\s*[1-9]\.\s/gmu).slice(1).map(item => item.trim());
    check('PM-COUNT', items.length >= 2 && items.length <= 3);
    check('PM-GROUNDED', items.length > 0 && items.every(item => labelMatches(item, inputs.supplied_labels ?? []) || refsMatch(item, inputs.supplied_refs ?? [])));
    check('PM-WATCH-MITIGATE', items.length > 0 && items.every(item => item.includes('Watch for:') && item.includes('Mitigate:')));
    check('PM-NO-PROB', !reply.includes('%') && !/\b(likely|likelihood|chance|probability|probable|odds)\b/iu.test(reply));
    check('PM-NO-PREDICTION', !/\b(will|is going to|are going to) fail\b/iu.test(reply));
    const otherOptions = (inputs.current_option_labels ?? []).filter(label => normalise(label) !== normalise(inputs.plan_label ?? ''));
    check('PM-PLAN-ONLY', !labelMatches(reply, otherOptions));
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
    check('WC-NO-NOTHING', !/nothing would change|no single (assumption|factor)/iu.test(reply));
    check('WC-BANNED', !/\b(EVPI|EVPPI|sensitivity score|elasticity)\b/iu.test(reply) && !reply.includes('%'));
  } else if (policy_id === 'RC-STRENGTHEN-ITEM') {
    const labels = inputs.item_labels ?? [];
    check('ST-NAMES-ITEM', labels.length > 0 && labels.every(label => labelMatches(reply, [label])));
    check('ST-BANNED', !/\b(placeholder|edge|node|default strength)\b/iu.test(reply));
    const figures = [...(inputs.user_figures ?? []), ...(inputs.user_messages ?? []).flatMap(numberTokens),
      ...(inputs.item_current_value === undefined ? [] : [String(inputs.item_current_value)])];
    check('ST-NO-NEW-FIGURES', numberTokens(reply).every(token => supplied(token, figures)));
  } else {
    const labels = (inputs.edited_labels ?? []).slice(0, 3);
    check('CE-NAMES-EDITS', labels.length > 0 && labels.every(label => labelMatches(reply, [label])));
    check('CE-STALE-IFF', /out of date/iu.test(reply) === (inputs['run.kind'] === 'complete_stale'));
    check('CE-NO-RESULT-CLAIM', !/\b(the result (has )?changed|now leads|is now ahead|the answer is now)\b/iu.test(reply));
  }
  // Fail immediately on implementation/policy drift, rather than quietly leaving a rule unchecked.
  const expected = POLICY.method_turns[policy_id].post_checks.map(rule => rule.id);
  if (failed.some(id => !expected.some(expectedId => expectedId === id))) throw new Error('Unknown text post-check id');
  return { pass: failed.length === 0, failed };
}
