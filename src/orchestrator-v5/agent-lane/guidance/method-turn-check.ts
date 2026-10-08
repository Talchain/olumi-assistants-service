import { textAssertsLeadingOption } from '../../compose/leading-option-egress-guard.js';
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
/**
 * shared.label_masking, PER BAN: does Olumi's OWN text hit `ban`? A label is blanked only for a ban it trips itself (it
 * is the user's word), and never when it is nothing but banned words ('Odds', 'Leads': fails closed). An unrelated
 * common-word label ('Will') can never hide Olumi's claim 'This plan will fail' (CEE #2480 CR P1 #4).
 */
function maskedFor(text: string, ban: RegExp, labels: readonly (string | undefined)[]): string {
  const whole = new RegExp(`^[^\\p{L}\\p{N}]*(?:${ban.source})[^\\p{L}\\p{N}]*$`, 'iu');
  const own = labels.filter((label): label is string => typeof label === 'string'
    && ban.test(foldQuotes(label)) && !whole.test(foldQuotes(label).trim()));
  return masked(text, own);
}
function banned(text: string, ban: RegExp, labels: readonly (string | undefined)[]): boolean {
  return ban.test(maskedFor(text, ban, labels));
}
const INTERNAL_VALUE = /\b(internal scale|normali[sz]ed (value|values|scale|figures?)|unit interval)\b/iu;
/**
 * shared.internal_value_terms: the internal/normalised value terms Olumi's own text uses, after per-ban label masking
 * (a user label such as 'Internal scale-up plan' is the user's word). REPORTS lower-cased unique terms in order and never
 * edits: AI HARNESS's first-run explanation guard replaces the WHOLE explanation on any hit (backstop; RC 5945450369).
 * Deliberately NOT a RERUN-EXPLANATION post-check: that list is live on the served M2 path (HARNESS CR on #2505).
 */
export function internalValueTerms(text: string, labels: readonly (string | undefined)[] = []): string[] {
  const hits = [...maskedFor(text, INTERNAL_VALUE, labels).matchAll(new RegExp(INTERNAL_VALUE.source, 'giu'))].map(match => match[0].toLowerCase());
  return [...new Set(hits)];
}
/**
 * RX-NO-CONTRARY-SAME: every "nothing / no input changed" claim (seven forms passed the two-phrase ban once M2 relied on
 * this checker, CODEX CEE BUDDY 5940259670). "Nothing else changed." is the honest control ONLY with complete coverage
 * and no unsaid changes. The same claim class includes "else" when a recorded or possible change goes unsaid.
 */
const contrarySame = (nothing: string): RegExp => new RegExp(String.raw`\b(${nothing}(?:'s| has| had)? changed|${nothing} (?:was|has been|had been) changed`
  + String.raw`|${nothing} in (?:your|the) model(?:'s| has| had)? changed|same inputs?`
  + String.raw`|inputs?(?: values)? (?:were|was|are|is|stayed|remained|have stayed|have remained) (?:unchanged|the same)`
  + String.raw`|unchanged inputs?|(?:no|none of the) inputs? (?:were |was |have been |has been )?changed`
  + String.raw`|no changes? (?:were|was|have been|has been) made`
  + String.raw`|(?:didn'?t|did not|haven't|have not|hasn't|has not) changed? anything)\b`, 'iu');
const CONTRARY_SAME = contrarySame('nothing');
const CONTRARY_SAME_WITH_UNSAID = contrarySame('nothing(?: else)?');
/** Qualify each claim separately: uncertainty about one claim cannot license a later contrary assertion. */
function assertsContrarySame(text: string, ban: RegExp, labels: readonly (string | undefined)[]): boolean {
  const own = maskedFor(text, ban, labels);
  for (const match of own.matchAll(new RegExp(ban.source, 'giu'))) {
    const prefix = own.slice(0, match.index);
    if (!/\b(?:(?:cannot|can't)\s+confirm(?:\s+that)?|isn't\s+sure\s+whether)\s+$/iu.test(prefix)) return true;
  }
  return false;
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
  const body = reply.replace(/^[ \t]*[1-9]\.\s/gmu, '');
  return [...body.matchAll(/(?<![A-Za-z])[£$€]?\d[\d,]*(?:\.\d+)?\s*(?:%|k|m|bn)?/giu)].map(m => m[0].trim());
}
// These are claim predicates, never bare ranking words ("team leader", "ranked price above features").
const LEADER_WORDS = /\b(?:leaders?|leading|rank(?:ed|s|ing|ings)?|top|stronger|strongest|beats?|outperformed|front[- ]runner|favou?rite|preferred|wins?|winners?|best|ahead|leads?|recommend\w*)\b/iu;
const DECISION_CLAIM = /\b(?:(?:is|are|was|were|as)\s+(?:the\s+)?leader|(?:is|was)\s+leading(?!\s+(?:to|indicators?)\b)|rank(?:ed|s)\s+(?:first|top|highest)|top[- ]ranked|(?:the\s+)?ranking\s+favou?rs|(?:stronger|strongest|preferred)\s+option|beats?\s+\S+|outperformed\s+\S+|(?:the\s+)?front[- ]runner|(?:the\s+)?favou?rite|edged\s+ahead)\b/iu;
const DURATION = /\b\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/giu;
const NUMBER_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)';
const WORD_FIGURE = new RegExp(`\\b(?:about\\s+half|one\\s+in\\stwo|${NUMBER_WORD}(?:[- ]${NUMBER_WORD}){0,8}\\s+(?:percent|per\\s+cent))\\b`, 'iu');
const digits = (text: string) => text.replace(/\D/gu, '');
function supplied(token: string, figures: readonly string[]): boolean {
  const value = digits(token);
  return value !== '' && figures.some(figure => value === digits(figure));
}

/** Exactly the text post-checks; no mechanism judgement and no fallback generation. */
export function checkMethodTurn(policy_id: MethodTurnId, reply: string, inputs: MethodInputs, decisionStories = true): MethodTurnCheck {
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
    const labels = [...model, ...(inputs.supplied_items ?? []).flatMap(item => item.labels ?? []), inputs.plan_label, ...(inputs.current_option_labels ?? [])];
    check('PM-NO-PROB', !banned(reply, /%|\b(likely|likelihood|chance|probability|probable|odds)\b/iu, labels));
    check('PM-NO-PREDICTION', !banned(reply, /\b(will|is going to|are going to) fail\b/iu, labels));
    const otherOptions = (inputs.current_option_labels ?? []).filter(label => normalise(label) !== normalise(inputs.plan_label ?? ''));
    check('PM-PLAN-ONLY', inputs.decision_level === true
      ? items.every(item => new Set((inputs.current_option_labels ?? []).filter(label => labelMatches(item, [label])).map(normalise)).size <= 1)
      : !labelMatches(reply, otherOptions));
    // Use the shared assertion classifier; per-ban masking cannot let a label called 'Leader' hide a claim.
    // Collapse whitespace before the shared scanner: its multiline top-claim pattern otherwise rescans newline runs.
    // The noun "lead time" is never a leader claim (the shared classifier reads "The lead time … doubled" as one).
    const claimText = maskedFor(reply, LEADER_WORDS, labels).replace(/\s+/gu, ' ').replace(/\blead(?=[ -]{1,2}times?\b)/giu, 'lag');
    const unlicensedClaim = decisionStories && inputs.decision_level === true
      && (textAssertsLeadingOption(claimText) || DECISION_CLAIM.test(claimText));
    check('PM-NO-WINNER', inputs.decision_level !== true
      || !banned(reply, /\b(?:(?<!\b(?:quick|small|early|easy)\s)wins?(?![\s-]+(?:back|over)\b)(?!\s+(?:(?:new|more)\s+)?(?:customers?|clients?|deals?|business|subscribers?|users?)\b)|winners?|winning|recommend\w*|(?<!\b(?:at|our|your|their|its)\s)best(?![\s-]+(?:case|practice|effort)\b)|(?:comes?|came|is|are|was|pulls?|stays?|moves?)(?:\s+out)?\s+ahead(?!\s+of\b)|leads?(?!\s+(?:to|time)\b))\b/iu, labels) && !unlicensedClaim);
    // Story markers and own-label digits are exempt; durations are not Run figures.
    const figureText = masked(reply, labels).replace(DURATION, ' ');
    check('PM-NO-FIGURES', !decisionStories || inputs.decision_level !== true
      || numberTokens(figureText).length === 0 && !banned(reply, WORD_FIGURE, labels));
    check('PM-BLINDSPOT', blindspotOk(reply));
  } else if (policy_id === 'RERUN-EXPLANATION') {
    check('RX-NAMES-CHANGES', (inputs.change_labels ?? []).slice(0, 3).every(label => labelMatches(reply, [label])));
    const labels = [...model, ...(inputs.change_labels ?? []), ...(inputs.current_option_labels ?? [])];
    check('RX-NO-CAUSE-UNPAIRED', inputs.attribution_case === 'C1_attributable'
      || !banned(reply, /\b(because (you|of your)|caused|due to your|as a result of your|led to|held (the|its) comparison back)\b/iu, labels));
    const sentences = reply.split(/(?<=[.!?])\s+|\n/u);
    check('RX-NO-LEADER-UNLICENSED', inputs.leader_licensed === true || !sentences.some(sentence =>
      labelMatches(sentence, inputs.current_option_labels ?? []) && banned(sentence, /\b(leads|ahead|best|wins|now first)\b/iu, labels)));
    check('RX-NOISE', inputs.noise_verdict !== 'not_noise_qualified'
      || !banned(reply, /\b(significant|meaningful(ly)? (better|worse)|clearly (better|worse))\b/iu, labels));
    // The earlier run had no figures to move from (prior_withheld), or no option has figures in both runs.
    check('RX-NO-MOVEMENT-WITHOUT-PRIOR', !(inputs.prior_withheld === true || inputs.no_matched_figures === true)
      || !banned(reply, /\b(rose|fell|moved|increased|decreased|went (up|down)|up from|down from|jumped|dropped|climbed)\b/iu, labels));
    // A named OR unsaid change is never "no change". Incomplete coverage also cannot license "nothing else changed".
    const changesUnsaid = inputs.changes_unsaid === true;
    check('RX-NO-CONTRARY-SAME', (inputs.change_labels ?? []).length === 0 && !changesUnsaid
      || !assertsContrarySame(reply, changesUnsaid ? CONTRARY_SAME_WITH_UNSAID : CONTRARY_SAME, labels));
    // The un-withheld transition must say so (MG 5939414835).
    check('RX-UNWITHHELD-LINE', inputs.prior_withheld !== true || labelMatches(reply, ['can now compare the options']));
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
    const tipping = inputs.tipping_point;
    check('WC-NAMES-FACTOR', labelMatches(reply, [inputs.factor_label ?? '']));
    const prefixMatches = tipping !== undefined && (reply === tipping.say || reply.startsWith(`${tipping.say} `)
      || reply.startsWith(`${tipping.say}\n`));
    const elaboration = prefixMatches ? reply.slice(tipping!.say.length) : reply;
    const figures = [...(inputs.user_figures ?? []), ...(inputs.user_messages ?? []).flatMap(numberTokens),
      ...(inputs.factor_current_value === undefined ? [] : [String(inputs.factor_current_value)]),
      ...(tipping === undefined ? [] : [String(tipping.threshold), ...numberTokens(tipping.say)])];
    check('WC-NO-NEW-FIGURES', tipping === undefined ? numberTokens(reply).every(token => supplied(token, figures))
      : prefixMatches && numberTokens(elaboration).length === 0);
    // The threshold sentence is code-owned. Additional prose cannot restate a crossing, change units or name a winner.
    check('WC-TIPPING-FACT', tipping === undefined || inputs['run.kind'] === 'complete_current'
      && inputs.factor_label === tipping.label && prefixMatches
      && !/\b(cross(?:es|ing)?|above|below|rises?|falls?|threshold|leads?|ahead|wins?|favou?rs?|best)\b/iu.test(elaboration)
      && numberTokens(elaboration).length === 0);
    const labels = [...model, inputs.factor_label];
    check('WC-NO-NOTHING', !banned(reply, /nothing would change|no single (assumption|factor)/iu, labels));
    check('WC-BANNED', !banned(reply, /\b(EVPI|EVPPI|sensitivity score|elasticity)\b/iu, labels)
      && !banned(tipping === undefined ? reply : elaboration,
        tipping === undefined ? /%/u : /%|\b(probability|odds|chance)\b/iu, labels));
  } else if (policy_id === 'RC-STRENGTHEN-ITEM') {
    const labels = inputs.item_labels ?? [];
    check('ST-NAMES-ITEM', labels.length > 0 && labels.every(label => labelMatches(reply, [label])));
    check('ST-BANNED', !banned(reply, /\b(placeholder|edge|node|default strength)\b/iu, [...model, ...labels]));
    const figures = [...(inputs.user_figures ?? []), ...(inputs.user_messages ?? []).flatMap(numberTokens),
      ...(inputs.item_current_value === undefined ? [] : [String(inputs.item_current_value)])];
    check('ST-NO-NEW-FIGURES', numberTokens(reply).every(token => supplied(token, figures)));
  } else {
    const labels = (inputs.edited_labels ?? []).slice(0, 3);
    check('CE-NAMES-EDITS', labels.length > 0 && labels.every(label => labelMatches(reply, [label])));
    check('CE-STALE-IFF', /out of date/iu.test(reply) === (inputs['run.kind'] === 'complete_stale'));
    check('CE-NO-RESULT-CLAIM', !banned(reply, /\b(the result (has )?changed|now leads|is now ahead|the answer is now)\b/iu, [...model, ...(inputs.edited_labels ?? [])]));
  }
  // Fail immediately on implementation/policy drift, rather than quietly leaving a rule unchecked.
  const expected = POLICY.method_turns[policy_id].post_checks.map(rule => rule.id);
  if (failed.some(id => !expected.some(expectedId => expectedId === id))) throw new Error('Unknown text post-check id');
  return { pass: failed.length === 0, failed, targets };
}
