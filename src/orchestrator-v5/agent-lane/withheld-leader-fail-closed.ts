/**
 * ⛔ AGENT LANE — WHEN THE LEADER IS WITHHELD, NO RANKING SENTENCE REACHES THE USER.
 *
 * WHY THIS EXISTS (AI Quality corpus, #63 5823028488; Codex direction 5823210765).
 * On the Agent lane the canonical permission can withhold a leader
 * (`leader_claim.permitted === false`, or `claim_permissions.leader_may_be_named === false`)
 * while the Agent's reply still names or ranks one. Measured on 17 real gpt-5.6-terra replies
 * to one withheld Run (13 leaking, 4 clean), the shared wire gate
 * (`compose/leading-option-wire-enforcement.ts`) caught 1 of 13: it needs the EXACT option label
 * beside its vocabulary, and the model paraphrases labels ("the £59-at-release path…").
 *
 * WHAT THIS DOES INSTEAD — it does not try to recognise which option a sentence names.
 *   1. On a withheld turn, every sentence of the Agent's reply that RANKS options or asserts a
 *      leader is dropped, whatever it calls the option. The test is ranking LANGUAGE, not names.
 *   2. Every other sentence is kept byte-identical.
 *   3. If anything was dropped, ONE deterministic no-leader sentence is appended: why no option
 *      can be put forward (from the typed reason, when one exists) and one next action.
 *   4. On a permitted turn this module returns its input BY REFERENCE. Over-suppression is the
 *      worse defect; the permit is the first line.
 *
 * SCOPE, stated rather than implied: Agent-lane `assistant_text` only, and only where the route
 * already runs the wire gate (analysis-bearing turns). The shared Conventional gate is unchanged
 * and still runs afterwards, on the text this module returns.
 *
 * THE PERMISSION IS READ, NEVER RE-DERIVED. "Withheld" is exactly the shared gate's withhold arm,
 * from the same inputs and the same exported predicates (`agentLaneLeaderWithheld`): this module
 * changes only how much ranking prose is RECOGNISED there, never whether a turn is withheld. The
 * separable-provisional population keeps the shared gate's caveat (Paul's "caveat, not withhold").
 *
 * WHAT IS KEPT on a withheld turn (leader-safety policy #63 5824816357; AI Quality corpus v6):
 * a scoped metric comparison that names its metric (class C2), and a sentence explaining why NO
 * option is put forward ("favours neither…, because…"). Only class C1 — an overall leader, a
 * ranking, a hint, a recommendation, win shares as ranking evidence — is removed.
 *
 * ⚠ THE CLASSIFIER'S RULE, so the next reader does not widen or narrow it by feel:
 *   - SUPERLATIVES and explicit ranking verbs single out one option, so they are BROAD:
 *     lead/leads/leading/led/leader, favours/favoured/favourite, strongest, highest, best, ahead,
 *     top (ranked forms), wins/winner, most likely, "N% chance/likely/probability", "N% of
 *     simulations", ranks/outperforms/superior/preferable/front-runner, edges out, recommend*.
 *   - COMPARATIVES (higher, better, stronger) are ordinary in mechanism and evidence prose
 *     ("higher MRR is the goal direction", "better data"), so they count only in ranking forms
 *     ("scores higher", "higher than the alternatives", "better option", "stronger than").
 *   - A short list of FIXED-SENSE IDIOMS is blanked first ("leads to", "lead time", "go ahead",
 *     "quick wins", "at best", "not a recommendation", "highest sensitivity"…). Each is replaced by
 *     a non-word, non-space token, so blanking can only REMOVE a match, never create one.
 *   - A model label that itself reads as ranking vocabulary ("Hire a Lead Engineer", "Tech leads
 *     hired") is blanked the same way, so naming it is not mistaken for ranking.
 *   - The shared alarm vocabulary (`textNamesLeadingOption`) is one arm, so this is never narrower
 *     than the words the estate already treats as a leader claim.
 *
 * ⚠ RESIDUAL — what a vocabulary classifier cannot see, stated so nobody quotes a stronger claim:
 * a designation that uses no ranking word at all ("directional support for £59", "go with the first
 * one", a bare "£59 comes first."), and win shares written as running prose with no ranking word
 * ("the £59 path at 71% and holding at 29%"). Those sentences are kept. Win shares ARE removed as
 * lists ("label: N%" / "label — N%", per contiguous list summing to ~100, under a ranking heading, or
 * on an option's own label) and as tables (a share header, an option row with a %, or a ranking row). Measured recall is corpus recall (AI
 * Quality v6: 43 real replies plus 6 authored controls), not a general guarantee.
 */
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { log } from '../../utils/telemetry.js';
import { analysisReadyPermitsLeaderNaming, permittedAnalysisModeFromAnalysisReady } from '../admission/analysis-admission.js';
import {
  leaderClaimReasonKind,
  WITHHELD_CONSTRAINT_VERDICT,
  WITHHELD_NEAR_TIE,
  WITHHELD_RUN_IDENTITY_CONFLICT,
  WITHHELD_RUN_IDENTITY_UNCONFIRMED,
  WITHHELD_SEPARATION_UNAVAILABLE,
} from '../compose/analysis-state-v1.js';
import {
  neutraliseEnforcementFalsePositiveSpans,
  optionLabelPattern,
  textNamesLeadingOption,
} from '../compose/leading-option-egress-guard.js';
import {
  enforceLeadingOptionClaimsAtWire,
  PROVISIONAL_FIGURES_CAVEAT,
  WIRE_ENFORCED_PROSE_FIELDS,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
  type WireLeaderClaimEnforcementOpts,
  type WireLeaderClaimEnforcementResult,
} from '../compose/leading-option-wire-enforcement.js';
import { splitIntoRedactableUnits } from '../compose/redactable-units.js';
import { WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL } from '../compose/withheld-explanation-answer.js';
import { claimPermissionsFrom } from './first-analysis.js';

/** The blanking token — the shared enforcer's own choice: not a word character, not whitespace. */
const BLANK = '#';

/** Fixed-sense idioms that use ranking words without ranking anything. Blanked before matching. */
const NON_RANKING_IDIOMS: readonly RegExp[] = [
  /** Mechanism: "price leads to churn", "which led to a drop". */
  /\b(?:lead|leads|leading|led)\s+(?:to|into|towards?)\b/gi,
  /** Noun senses of "lead". */
  /\blead[\s-]+(?:times?|generation|magnets?|sources?|scoring|lists?|nurturing|conversion|volumes?|pipelines?)\b/gi,
  /\bleading\s+indicators?\b/gi,
  /\b(?:sales|qualified|inbound|outbound|warm|cold|new|marketing)\s+leads?\b/gi,
  /**
   * Job titles, HYPHENATED too. The shared carve-out spares "tech lead" but not "tech-lead capacity",
   * which all 9 real run-blocked hiring replies use (10 of the 12 false positives in a 43-reply
   * survey of AI Quality's paired runs, branch aiq/agent-reply-paired-evidence @7b68d8bd).
   */
  /\b(?:team|tech|technical|engineering|project|squad|product|design|dev|development|delivery)[\s-]+leads?\b/gi,
  /**
   * ⭐ THE ROLE, not a margin (served survey over 37 witness logs: "the current lead's week", "another lead
   * remove a bottleneck", "effective lead capacity", "a slow-ramping lead:"). A margin reads "a lead FOR/OVER
   * X", "the £59 lead"; a person reads "the lead's", "the lead is/would …", "lead capacity/role".
   */
  /\blead(?:'s|s')/gi,
  /\blead\s+(?:capacity|capacities|role|roles|hire|hires|hiring|engineers?|developers?|positions?|availability|effectiveness|coverage|salary|salaries|ramp[\s-]?up|onboarding|candidates?|case|cases|headcount)\b/gi,
  // ⚠ NOT "the lead is …" in general — "the current lead is the £59 path" is a MARGIN (review of #1871,
  // 5825898337). "is/was" count as the role only with a role predicate.
  /\b(?:the|a|an|another|new|current|dedicated|senior|second|one|that|this)\s+lead\s+(?:would|could|will|might|may|provides?|removes?|creates?|adds?|reduces?|improves?|brings?|consumes?|arrives?|joins?|spends?|needs?)\b/gi,
  /\b(?:the|a|an|another|new|current|dedicated|senior|second|one|that|this)\s+lead\s+(?:is|was)\s+(?:not\s+)?(?:unavailable|available|stretched|overloaded|busy|empowered|hired|absent|part[\s-]time|full[\s-]time|effective|ineffective|a\s+(?:person|hire|role|senior|junior|manager))\b/gi,
  // A hyphenated-adjective role only as a HEADING ("Slow-ramping lead:"); "the price-rise lead is …" is a margin.
  /\b[a-z]+-[a-z]+\s+lead(?=\s*:)/gi,
  /^[\s\-+•*\d.)#]*lead\s+as\b/gi,
  /** "evidence-led", "feature-led": a compound adjective, never a ranking. */
  /\b[\w£]+-led\b/gi,
  /** The managerial verb: "will mainly lead and unblock work", "leads the team". */
  /\b(?:lead|leads|leading|led)\s+and\s+(?:unblock|mentor|manage|coordinate|support|coach|guide|deliver|review|grow|hire)\w*\b/gi,
  /\b(?:lead|leads|leading|led)\s+(?:(?:the|a|an|this|that|their|your|our|its|new)\s+)*(?:teams?|squads?|projects?|work|rollout|migration|effort|initiative|delivery|engineers?|developers?|hires?|hiring|people|staff|onboarding|mentoring)\b/gi,
  /** Time, not rank: "go ahead", "ahead of the release", "the months ahead". */
  /\b(?:go|goes|going|went)\s+ahead\b(?!\s+of\b)/gi,
  /\bahead\s+of\s+(?:(?:the|any|a|its|your)\s+)?(?:schedule|time|plan|launch|release|rollout|deadline|renewal|decision|next\s+run)\b(?![\s-]+(?:timed|aligned|paths?|options?|routes?|scenarios?|increases?|rises?)\b)/gi,
  /\b(?:look|looks|looking|plan|plans|planning|think|thinking)\s+ahead\b/gi,
  /\b(?:months?|weeks?|years?|quarters?|days?|period|road|steps?)\s+ahead\b/gi,
  /** "quick wins", "win back customers". */
  /\b(?:quick|easy|early|small)\s+wins?\b/gi,
  /\bwin(?:s|ning)?[\s-]+back\b/gi,
  /\bwin(?:s|ning)?\s+(?:(?:new|more)\s+)?(?:customers?|clients?|deals?|business|subscribers?|users?)\b/gi,
  /**
   * Estimation, not rank: "at best", "your best estimate", "best-case". ⚠ "the best way to…", "it is best
   * to…" and "the best next step is…" are deliberately NOT here: each can carry a recommendation
   * ("the best next step is to raise Pro to £59"), so on a withheld turn they are dropped.
   */
  /\b(?:at\s+best|best\s+practices?|best\s+guess(?:es)?|best\s+estimates?|best\s+available|as\s+best|best[\s-]+case)\b/gi,
  /\b(?:better\s+understand\w*|understand\w*\s+(?:it\s+|this\s+)?better|better\s+(?:evidence|data|baseline|measurements?|information|picture|sense))\b/gi,
  /** A NEGATED recommendation is a disclaimer ("…, not a recommendation", "not yet a final recommendation"). The verb stays ranking. */
  /\b(?:not|no|never|rather\s+than)\s+(?:yet\s+|really\s+|intended\s+as\s+|meant\s+as\s+)?(?:a\s+|any\s+)?(?:final\s+|firm\s+|formal\s+|definitive\s+)?recommendations?\b/gi,
  /** The product WITHHOLDING a leader is the reason there is none ("so the model withholds an overall leader"). */
  /\bwithh(?:olds?|eld|olding)\s+(?:an?\s+|the\s+|any\s+)?(?:overall\s+|full\s+|final\s+)?leader(?:\s+verdict)?\b/gi,
  /\bno\s+(?:overall\s+|single\s+|clear\s+)?leader\b/gi,
  /** Method, not result: "the engine has not been told to rank …", "it ranks relative MRR instead". */
  // Only when someone TOLD it how to rank; "appears to rank first" is a result (review of #1871).
  /\b(?:told|asked|set|configured|instructed|meant|supposed)\s+to\s+rank\b/gi,
  // "ranks relative MRR", "ranks by" — never "ranks on top".
  /\branks?\s+(?:relative|by)\b/gi,
  /** The GOAL'S direction, not an option: "assumed that a higher waiting-list-reduction score is preferable". */
  // A SCORE's direction only, and never "preferable TO/THAN" an option (review of #1871).
  /\b(?:higher|lower|more|less)\s+[\w-]+(?:\s+[\w-]+){0,2}\s+(?:scores?|values?|outcomes?|figures?|levels?|numbers?)\s+(?:is|are)\s+(?:preferable|better)\b(?!\s+(?:to|than)\b)/gi,
  /** Sensitivity without a named option: "changing either can change which option leads". */
  /\b(?:change|changes|changing|alter|alters|altering|affect|affects|determine|determines|decide|decides|flip|flips|switch|switches)\s+which\s+(?:option|path|plan|choice|alternative)s?\s+(?:leads?|comes?\s+out\s+ahead|wins?|is\s+(?:ahead|best))\b/gi,
  /** A NEGATED choice: "the model cannot distinguish a clear choice between …", "no clear winner". */
  /\b(?:cannot|can't|could\s+not|does\s+not|did\s+not|do\s+not)\s+(?:yet\s+)?(?:distinguish|identify|establish|name|pick|make|offer|give)\s+(?:a\s+|any\s+|the\s+)?clear\s+(?:choice|pick|winner|leader|option)\b/gi,
  /\bno\s+clear\s+(?:choice|pick|winner|leader|option)\b/gi,
  /** Sales vocabulary, not a result: "win/loss data". */
  /\bwin\s*[/-]\s*loss\b/gi,
  /** Method: "the goal should be ranked as more reduction is better" — never "should be ranked first". */
  /\bshould\s+be\s+ranked\s+as\s+(?:more|less|higher|lower)\b/gi,
  /** Time, not rank: "behind schedule". */
  /\bbehind\s+(?:schedule|plan|target|time)\b/gi,
  /** Ranking ASSUMPTIONS by sensitivity is sanctioned content; the route's instruction asks for it. */
  /\b(?:highest|strongest|biggest|largest|greatest)\s+(?:(?:modelled|model|mrr|arr|revenue|simulated|key|main|single|cost|price)\s+){0,2}(?:sensitivity|influence|drivers?|levers?|dependency|uncertainty|elasticity|risks?)\b/gi,
  // Only a piece of EVIDENCE to get ("the highest-priority correction"); "the highest-priority move" recommends.
  /\b(?:highest|top)[\s-]+priority\s+(?:corrections?|questions?|checks?|inputs?|gaps?|unknowns?|assumptions?|measurements?|evidence|tests?|data|fix(?:es)?)\b/gi,
  /**
   * Only a VALUE's plausible top, never an option's (Codex challenge on #1871: "The highest plausible MRR belongs
   * to the £59-at-release path" names the strongest option by paraphrase, so the noun must be a value word).
   */
  /\bhighest\s+(?:plausible|possible|credible)\s+(?:values?|estimates?|figures?|levels?|bounds?|cases?|ranges?)\b/gi,
  /\bmost\s+likely\s+(?:values?|estimates?|figures?|ranges?|levels?)\b/gi,
  /** Questions or assumptions "most likely to determine the result" — ranking what matters, not options. */
  /\bmost\s+likely\s+to\s+(?:determine|affect|change|shift|move|matter|drive|influence|decide|flip|alter)\b/gi,
  /**
   * ⭐ A DECLINED DESIGNATION EXPLAINS WHY THERE IS NO LEADER — often the most useful sentence on a withheld
   * turn (AI Quality v6; review of #1871: "The current model favours neither hiring plan as a decision,
   * because it could not test your strict salary constraint"). Negated forms only: the NEGATION is part of
   * each pattern, so a positive designation can never be blanked by one of these.
   */
  /\b(?:favou?r(?:s|ed|ing)?|prefer(?:s|red|ring)?|backs?|picks?|supports?|recommends?)\s+neither\b/gi,
  /\bedge\s+to\s+neither\b/gi,
  /\b(?:no|neither|none\s+of\s+the)\s+(?:single\s+)?(?:options?|plans?|choices?|paths?|alternatives?)\s+(?:can|could|should|may|is|was)\s+(?:yet\s+|now\s+)?(?:be\s+)?(?:(?:treated|described|shown|named|called|put\s+forward|presented|read)\s+as\s+)?(?:the\s+)?(?:leading|leader|lead|ahead|best|winner|winning|favou?red|strongest)\b/gi,
  /\b(?:(?:does|do|did|can|could|would|will)\s*(?:not|n't)|cannot)\s+(?:yet\s+)?(?:establish|show|tell(?:\s+you)?|say|settle|determine|prove|mean|imply|indicate|decide)\s+(?:which|whether|that)\s+(?:\S+\s+){0,3}?(?:leads?|leading|is\s+(?:ahead|best|better|stronger)|wins?|comes?\s+out\s+ahead)\b/gi,
  /** Describing the METHOD, not the result: "it ranked by 'larger MRR outcome'". */
  /\b(?:ranked|ranks|ranking)\s+(?:them\s+|the\s+options\s+)?by\b/gi,
  /** "on top of that", "top-line", "top-down". */
  /\b(?<!\bout\s+)on\s+top\s+of\b/gi,
  /\btop[\s-]+(?:line|down)\b/gi,
];

/** A probability-like percentage: "83.28%", "15 %". */
const PCT = String.raw`(?<![\w.])\d+(?:[.,]\d+)?\s?%`;

/** A factor's own likelihood VALUE, not a win share: "the current 30% product-market-fit likelihood assumption" (served survey). */
const LIKELIHOOD_INPUT = new RegExp(String.raw`${PCT}\s+(?:[\w'-]+\s+){0,3}?likel(?:y|ihood)\s+(?:assumption|estimate|input|parameter|value|figure)s?\b`, 'gi');

/**
 * Ranking language. Each entry is ONE question — "does this sentence order the options or single
 * one out?" — asked of a sentence whose idioms and ranking-shaped labels have been blanked.
 */
const RANKING_PATTERNS: ReadonlyArray<{ readonly code: string; readonly re: RegExp }> = [
  { code: 'lead', re: /\b(?:lead|leads|leading|led|leaders?)\b/i },
  { code: 'favour', re: /\b(?:favou?rs?|favou?red|favou?ring|favou?rites?|favou?rably|(?:more|most)\s+favou?rable)\b/i },
  /** v6 real replies: "the current model leans towards hiring two seniors". */
  { code: 'lean', re: /\b(?:lean(?:s|ed|ing)?|tilt(?:s|ed|ing)?|nudg(?:es|ed|ing)?)\s+(?:(?:more|slightly|clearly|somewhat|provisionally|marginally)\s+)*(?:towards?|in\s+favou?r\s+of)\b/i },
  /** v6 real replies: "the apparent £59 advantage". */
  {
    code: 'advantage',
    re: /\badvantages?\s+(?:over|to|for)\b|\b(?:has|have|had|holds?|held|gives?|gave|keeps?|kept|with|shows?|showed)\s+(?:an?|the|its)\s+(?:\w+\s+)?advantage\b|(?:£\s?\d[\d,.]*k?|\d+\s?%)\s+advantage\b|\b(?:apparent|clear|slight|modest|small|narrow|provisional|overall|decisive|consistent)\s+(?:\S+\s+)?advantage\b|\w's\s+(?:\w+\s+)?advantage\b/i,
  },
  /** v6 real replies: "the model-relative case for £59 is promising on MRR alone"; served: "the case for raising strengthens". */
  { code: 'promising', re: /\bcase\s+for\b[^.;!?]{0,80}\b(?:promising|strong|stronger|strengthens|compelling|attractive|persuasive|convincing)\b|\b(?:more|most)\s+promising\b|\bbecomes?\s+more\s+(?:competitive|attractive|favou?rable|promising)\b/i },
  /** Served: "The other paths are materially behind", "two developers are close behind". */
  {
    code: 'behind',
    re: /\b(?:is|are|was|were|trails?|trailed|came|comes?|fell|falls?|lags?|lagged)\s+(?:\w+\s+)?behind\b(?!\s+(?:this|that|these|those|it|the\s+(?:result|ordering|comparison|finding|analysis|model|assumption|shift|change|scenes)))|\b(?:close|materially|well|far|just|narrowly)\s+behind\b/i,
  },
  /** v6 real replies: "could switch the ordering to holding at £49" — names where the order goes. */
  {
    code: 'ordering',
    re: /\b(?:switch|flip|revers|chang|swap|tip|turn)\w*\s+(?:the\s+)?(?:ordering|ranking|order|comparison|result)\s+(?:to|towards|in\s+favou?r\s+of)\b|\b(?:ordering|ranking)\s+(?:would\s+|could\s+|may\s+|might\s+)?(?:switch|flip|revers|chang|swap|tip|turn)\w*\s+(?:to|towards|in\s+favou?r\s+of)\b/i,
  },
  {
    code: 'greatest',
    re: /\b(?:greatest|largest|biggest)\s+(?:(?:modelled|expected|median|mean|projected|simulated|overall|average|net)\s+)*(?:mrr|revenue|outcomes?|results?|returns?|gains?|upside|value|payoff|benefits?|chances?|probabilit(?:y|ies)|win\s+shares?)\b/i,
  },
  { code: 'came_out_at', re: new RegExp(String.raw`\b(?:came|comes|coming)\s+out\s+(?:at|on)\s+${PCT}`, 'i') },
  { code: 'more_than', re: /\b(?:delivers?|delivered|produces?|produced|yields?|yielded|gives?|gave|generates?|generated|returns?|returned|achieves?|achieved|earns?|earned|brings?|brought)\s+more\s+(?:[\w£$%-]+\s+){0,3}?than\b/i },
  /** Only over another OPTION ("dominates keeping £49"); "which bottleneck dominates today" is mechanism (served survey). */
  { code: 'dominates', re: /\bdominat(?:es|ed|ing)\s+(?:the\s+)?(?:other|others|alternatives?|rest|field|comparison|keeping|holding|raising|hiring|phasing|staying|launching|building|buying|£)|\bdominant\s+(?:option|choice|path|strategy|plan)\b/i },
  { code: 'robust_pick', re: /\bmost\s+(?:robust|resilient|reliable|dependable)\s+(?:option|choice|path|plan|bet|route|alternative|candidate|of\s+the)\b|\b(?:is|was|looks|comes\s+out\s+as)\s+(?:the\s+)?most\s+(?:robust|resilient|reliable)\b/i },
  { code: 'first', re: /\b(?:comes?|came|coming)\s+out\s+first\b|\b(?:comes?|came)\s+first\s+(?:in|on|among|across|overall|of\s+the)\b|\b(?:finish(?:es|ed)?|placed?|places|ranks?|ranked)\s+first\b/i },
  { code: 'pick', re: /\b(?:my|our|olumi's|the\s+model's)\s+(?:top\s+)?(?:pick|choice|recommendation|preference|favourite|favorite)\b/i },
  { code: 'strongest', re: /\bstrongest\b/i },
  {
    code: 'stronger',
    re: /\bstronger\s+(?:than|option|choice|case|candidate|result|outcome|performer|position|bet|path|route|contender)\b|\b(?:perform(?:s|ed|ing)?|comes?\s+out|came\s+out|looks?|scor(?:e|es|ed|ing))\s+stronger\b/i,
  },
  { code: 'highest', re: /\bhighest\b/i },
  {
    code: 'higher',
    re: /\b(?:ranks?|ranked|scor(?:e|es|ed|ing)|perform(?:s|ed|ing)?|comes?\s+out|came\s+out|finish(?:es|ed)?|rated?|sits?)\s+higher\b|\b(?:produces?|produced|producing|gives?|gave|delivers?|delivered|yields?|yielded|generates?|generated|achieves?|achieved|has|had|shows?|showed|returns?|returned|reaches|reached)\s+(?:a\s+|the\s+)?higher\b|\bhigher\s+(?:(?:modelled|expected|median|mean|projected|simulated|overall|#)\s+)*(?:mrr\s+)?(?:outcomes?|results?|scores?|chances?|probabilit(?:y|ies)|likelihood|win\s+(?:rates?|shares?))\b|\bhigher\s+than\s+(?:#|(?:the\s+)?(?:other|others|alternatives?|rest|both|either|all|keeping|phasing|raising|holding|staying))\b/i,
  },
  { code: 'best', re: /\bbest\b/i },
  {
    code: 'better',
    re: /\bbetter\s+than\b|\bbetter\s+(?:option|choice|bet|path|route|outcome|result|performer|pick|alternative|fit|candidate|position|odds|chances?|prospects?)s?\b|\b(?:perform(?:s|ed|ing)?|do|does|did|doing|fare[sd]?|faring|scor(?:e|es|ed|ing)|comes?\s+out|came\s+out|fits?|fitted|works?|worked)\s+better\b/i,
  },
  { code: 'ahead', re: /\bahead\b/i },
  { code: 'win', re: /\b(?:wins?|winners?|winning)\b/i },
  {
    code: 'top',
    re: /\b(?:comes?|came|coming)\s+out\s+(?:on\s+)?top\b|\bon\s+top\b|\btop[\s-]+(?:ranked|rated|scoring|performing|options?|choices?|picks?|performers?|spot|place|position|candidates?|results?|outcomes?)\b|\btops?\s+the\s+(?:comparison|ranking|ordering|list|table|chart|results?|field)\b|\b(?:ranked|ranks|placed|sits|sat|finish(?:es|ed)?)\s+(?:at\s+the\s+)?top\b|\bat\s+the\s+top\b/i,
  },
  { code: 'most_likely', re: /\bmost\s+likely\b/i },
  { code: 'more_likely_than', re: /\b(?:more|less)\s+likely\b[^.!?]*\bthan\b/i },
  {
    code: 'probability',
    re: new RegExp(
      String.raw`${PCT}\s+(?:[a-z'-]+\s+){0,2}?(?:chance|likel(?:y|ihood)|probab(?:ility|le|ly)|odds)\b` +
        String.raw`|\b(?:chance|probability|likelihood|odds)\s+of\s+(?:about\s+|around\s+|roughly\s+|approximately\s+)?(?:\d+(?:[.,]\d+)?\s?%|0?\.\d+)`,
      'i',
    ),
  },
  {
    code: 'share_of_runs',
    re: new RegExp(
      String.raw`${PCT}\s+of\s+(?:(?:the|all|its|model's|sampled|simulated|modelled)\s+)*` +
        String.raw`(?:simulations?|simulated\s+\w+|sampled\s+\w+|samples?|runs?|draws?|iterations?|trials?|scenarios|cases|worlds|the\s+time)\b`,
      'i',
    ),
  },
  {
    code: 'rank_verb',
    re: /\b(?:ranks?|ranked|outrank\w*|outperform\w*|outscor\w*|outstrip\w*|outpac\w*|superior|inferior|preferable|front[\s-]?runners?|runners?[\s-]up|first\s+place|second\s+place)\b/i,
  },
  {
    code: 'edge',
    re: /\bedg(?:es|ed|ing)\s+(?:out|ahead)\b|\b(?:has|have|had|holds?|held|gives?|gave|keeps?|kept|with)\s+(?:the|an|a(?:\s+\w+)?)\s+edge\b(?!\s+(?:from|between|weight|strength))|\ban\s+edge\s+over\b/i,
  },
  {
    code: 'beats',
    re: /\bbeat(?:s|ing)?\b(?!\s+(?:the|your|its|our|a|that)\s+(?:\S+\s+)?(?:target|goal|limit|threshold|baseline|constraint|budget|benchmark))/i,
  },
  { code: 'model_prefers', re: /\b(?:model|analysis|comparison|results?|simulations?)\s+(?:clearly\s+|slightly\s+|strongly\s+)?prefers?\b/i },
  { code: 'clear_choice', re: /\b(?:clear|obvious|natural|safest|smartest|safer|surer|wiser|wisest)\s+(?:choice|pick|option|bet)\b/i },
  { code: 'most_positive', re: /\bmost\s+(?:promising|attractive|competitive|profitable|compelling|lucrative)\b/i },
  { code: 'recommend', re: /\brecommend\w*\b/i },
];

/** Strip what does not change what a sentence claims: emphasis, quote style, odd spaces, dashes. */
function classificationCopy(text: string): string {
  return text
    .replace(/[*_`]+/g, '')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-');
}

function blankIdioms(text: string): string {
  let out = neutraliseEnforcementFalsePositiveSpans(text);
  for (const re of NON_RANKING_IDIOMS) out = out.replace(re, BLANK);
  out = out.replace(LIKELIHOOD_INPUT, BLANK);
  return out;
}

/** Ranking codes present in text that has ALREADY been normalised and blanked. */
function rankingCodesInBlanked(blanked: string): string[] {
  const codes = RANKING_PATTERNS.filter(({ re }) => re.test(blanked)).map(({ code }) => code);
  if (textNamesLeadingOption(blanked)) codes.push('shared_leader_vocabulary');
  return codes;
}

/**
 * The model's names that would themselves read as ranking vocabulary — and ONLY those. A label
 * with no ranking word is left alone, so blanking never changes the adjacency a pattern reads.
 */
export interface RankingLabelContext {
  readonly rankingShapedLabels: readonly string[];
  /** Capitalised single words from those labels that trip the vocabulary alone ("Lead" in "Hire a Lead Engineer"). */
  readonly rankingShapedLabelWords: readonly string[];
  /** The OPTIONS' own labels — a lone "<option>: 71%" row is that option's share (Codex 5825866849). */
  readonly optionLabels?: readonly string[];
}

const NO_LABELS: RankingLabelContext = { rankingShapedLabels: [], rankingShapedLabelWords: [] };

const MIN_LABEL_LENGTH = 3;

function labelsFrom(graph: unknown, analysisReady: unknown): string[] {
  const out: string[] = [];
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const label = (n as { label?: unknown } | null)?.label;
      if (typeof label === 'string' && label.trim().length >= MIN_LABEL_LENGTH) out.push(label.trim());
    }
  }
  const options = (analysisReady as { options?: unknown } | null | undefined)?.options;
  if (Array.isArray(options)) {
    for (const o of options) {
      const label = (o as { label?: unknown } | null)?.label;
      if (typeof label === 'string' && label.trim().length >= MIN_LABEL_LENGTH) out.push(label.trim());
    }
  }
  return [...new Set(out)];
}

/** Which of the model's own names would be mistaken for ranking language. Reads names only, never a verdict. */
export function rankingLabelContext(graph: unknown, analysisReady: unknown): RankingLabelContext {
  const labels = labelsFrom(graph, analysisReady).filter(
    (label) => rankingCodesInBlanked(blankIdioms(classificationCopy(label))).length > 0,
  );
  const words = new Set<string>();
  for (const label of labels) {
    for (const word of classificationCopy(label).split(/[^\p{L}\p{N}']+/u)) {
      if (word.length >= MIN_LABEL_LENGTH && /^\p{Lu}/u.test(word) && rankingCodesInBlanked(word).length > 0) words.add(word);
    }
  }
  const options = new Set<string>();
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const o = n as { kind?: unknown; label?: unknown } | null;
      if (o?.kind === 'option' && typeof o.label === 'string' && o.label.trim().length >= MIN_LABEL_LENGTH) options.add(o.label.trim());
    }
  }
  const readyOptions = (analysisReady as { options?: unknown } | null | undefined)?.options;
  if (Array.isArray(readyOptions)) {
    for (const o of readyOptions) {
      const label = (o as { label?: unknown } | null)?.label;
      if (typeof label === 'string' && label.trim().length >= MIN_LABEL_LENGTH) options.add(label.trim());
    }
  }
  return { rankingShapedLabels: labels, rankingShapedLabelWords: [...words], optionLabels: [...options] };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ⭐ A SCOPED METRIC COMPARISON IS KEPT (leader-safety policy #63 5824816357, class C2; AI Quality v6).
 * "On the supplied MRR outcome, Raise Pro to £59 has a higher modelled median than Hold Pro at £49
 * (0.285 against 0.270); the churn condition was not scored, so this does not establish which option
 * leads overall" states what the run measured, on a named metric, without an overall preference.
 * Deleting it deletes honest science.
 *
 * Narrow by construction: the sentence must OPEN by naming its metric scope ("On the supplied …
 * outcome,", "On the model's internal normalised outcome scale,"), and only the statistic comparison
 * itself ("has a higher modelled median", "produced the highest average outcome") is blanked. Every
 * other ranking word in the sentence still counts, so "On the supplied MRR outcome, £59 is the best
 * option" is still dropped, and an unscoped "has a higher median" is still dropped (fail-safe).
 */
const METRIC_SCOPE_OPENING =
  /^[\s\-+•*\d.)]*(?:on|for|in\s+terms\s+of|measured\s+on)\s+(?:the\s+)?(?:supplied|modelled|model's|model|internal|simulated|this\s+run's)\b[^,;:]{0,120}?\b(?:outcome|scale|metric|measure|mrr|revenue|median|mean|average)\b[^,;:]{0,40}[,:]/i;
const SCOPED_STAT_COMPARISON =
  /\b(?:has|had|have|produced|produces|shows?|showed|gave|gives|reached|returns?|returned)\s+(?:a|the)\s+(?:higher|highest|lower|lowest)\s+(?:(?:modelled|average|mean|median|expected|simulated|normalised)\s+)*(?:median|mean|average|outcome|value|score)s?\b/gi;

function blankScopedMetricComparison(text: string): string {
  return METRIC_SCOPE_OPENING.test(text) ? text.replace(SCOPED_STAT_COMPARISON, BLANK) : text;
}

/** Which ranking patterns a sentence trips, after idioms and ranking-shaped labels are blanked. */
export function rankingCodesIn(sentence: string, labels: RankingLabelContext = NO_LABELS): string[] {
  if (typeof sentence !== 'string' || sentence.trim() === '') return [];
  let text = classificationCopy(sentence);
  for (const label of labels.rankingShapedLabels) text = text.replace(optionLabelPattern(classificationCopy(label)), BLANK);
  for (const word of labels.rankingShapedLabelWords) {
    // Case-SENSITIVE: the capitalised name, never the lower-case verb ("leads the comparison").
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(word)}(?![\\p{L}\\p{N}_])`, 'gu'), BLANK);
  }
  return rankingCodesInBlanked(blankIdioms(blankScopedMetricComparison(text)));
}

/** Does this sentence rank options or assert a leader? */
export function sentenceRanksOptions(sentence: string, labels: RankingLabelContext = NO_LABELS): boolean {
  return rankingCodesIn(sentence, labels).length > 0;
}

// ── the no-leader sentence ─────────────────────────────────────────────────────────────────────

/** The estate's own words, "No single option can be put forward yet", reused rather than restated. */
const NO_LEADER_OPENING = WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL.trim().replace(/[.!?]+$/, '');

/** One clause of why, one next action — keyed by the typed `leader_claim.withheld_reason`. */
const BY_WITHHELD_REASON: Readonly<Record<string, string>> = {
  [WITHHELD_CONSTRAINT_VERDICT]:
    'because a limit on your model was not shown to be met on this run; tell me whether that limit is right as it stands, then run the analysis again',
  [WITHHELD_NEAR_TIE]:
    'because the options came out too close together on this run to tell apart; tell me what matters most to you between them',
  [WITHHELD_SEPARATION_UNAVAILABLE]:
    'because how far apart the options are was not established on this run; ask me to run the analysis and I will measure it',
  [WITHHELD_RUN_IDENTITY_UNCONFIRMED]:
    'because this result could not be confirmed as an analysis of the model as it stands; run the analysis again',
  [WITHHELD_RUN_IDENTITY_CONFLICT]:
    'because this result could not be confirmed as an analysis of the model as it stands; run the analysis again',
};

/** Keyed by the admission's `permitted_analysis_mode` reason code, when the claim itself did not withhold. */
const BY_ADMISSION_REASON: Readonly<Record<string, string>> = {
  CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED:
    'because every estimate this comparison rests on is still Olumi’s, not yours; set one of them yourself, then run the analysis again',
  USER_STATED_PARAMETERS_NOT_MATERIAL:
    'because the values you have set sit outside what this comparison turns on; set a value on a factor one of the options changes, then run the analysis again',
  NO_COMPARISON_SUBSTRATE:
    'because nothing in this model connects the options to your goal; link them to your goal, then run the analysis again',
  NOTHING_TO_COMPARE:
    'because there is nothing to compare yet; name at least two different options you are weighing',
  MODEL_HAS_BLOCKERS: 'because this model cannot be analysed yet; ask me what it still needs',
};

const REASON_NOT_RECORDED =
  'and the reason is not recorded, so I will not guess at one; ask me to run the analysis and I can tell you then';

const sentence = (clause: string): string => `${NO_LEADER_OPENING}, ${clause}.`;

/** Every sentence this module can append — the build-time probe and the idempotence check read this. */
export const AGENT_NO_LEADER_SENTENCES: readonly string[] = [
  ...new Set([...Object.values(BY_WITHHELD_REASON), ...Object.values(BY_ADMISSION_REASON), REASON_NOT_RECORDED].map(sentence)),
];

function admissionModeReasonCode(analysisReady: unknown): string | undefined {
  const reasons = (analysisReady as { analysis_admission?: { reasons?: unknown } } | null | undefined)?.analysis_admission?.reasons;
  if (!Array.isArray(reasons)) return undefined;
  const r = reasons.find((x) => (x as { field?: unknown } | null)?.field === 'permitted_analysis_mode') as { code?: unknown } | undefined;
  return typeof r?.code === 'string' ? r.code : undefined;
}

/**
 * The ONE sentence appended when something was dropped: the ADMISSION's reason first when the
 * admission refused the comparison, then the typed claim reason, then "not recorded".
 *
 * ⚠ Admission first, because the claim token is not specific (Panel, #63 5825404689):
 * `composeLeaderClaim` writes `constraint_verdict_withheld` for ANY unentitled verdict — including the
 * automatic first run's "every estimate is Olumi's" — so reading the token first told a user with no
 * limits in their brief that "a limit on your model was not shown to be met".
 */
export function agentNoLeaderSentence(withheldReason: string | undefined, analysisReady: unknown): string {
  const mode = permittedAnalysisModeFromAnalysisReady(analysisReady);
  if (mode !== null && mode !== 'comparative_leader') {
    const code = admissionModeReasonCode(analysisReady);
    if (code !== undefined && BY_ADMISSION_REASON[code] !== undefined) return sentence(BY_ADMISSION_REASON[code]!);
  }
  if (withheldReason !== undefined && BY_WITHHELD_REASON[withheldReason] !== undefined) return sentence(BY_WITHHELD_REASON[withheldReason]!);
  return sentence(REASON_NOT_RECORDED);
}

// ── the projection ─────────────────────────────────────────────────────────────────────────────

/**
 * Server-authored sentences kept by IDENTITY, never by a language test: the shared gate's own
 * replacement and provisional caveat ("…fitted your goal better than the alternatives…" is a
 * definition of the figures, not a ranking), and this module's own sentences.
 */
const PROTECTED_SENTENCES: ReadonlySet<string> = new Set(
  [WIRE_WITHHELD_LEADER_REPLACEMENT, ...splitIntoRedactableUnits(PROVISIONAL_FIGURES_CAVEAT), ...AGENT_NO_LEADER_SENTENCES].map((s) => s.trim()),
);

const LIST_MARKER = /^(\s*(?:[-+•]|\*(?=\s)|\d+[.)])\s+)/;

/**
 * A sentence boundary the shared splitter keeps inside one unit when the full stop is wrapped in
 * emphasis or a bracket — "…£49 (**0.204**). That comparison reflects…" is ONE shared unit, so
 * dropping its ranking sentence took the explanation after it too (AI Quality v6, pricing-2).
 * Whitespace stays with the piece it precedes, so the pieces join back to the unit byte for byte.
 */
const FINER_BOUNDARY = /(?<=[.!?][*_)\]"'\u2019\u201D]*)(?=\s+[*_("'\u2018\u201C]*[A-Z£$])/g;

function finerSentences(unit: string): string[] {
  // Never cut after a piece with no letter in it: "1. **The link…**" is one list item, not two sentences.
  const cuts = [...unit.matchAll(FINER_BOUNDARY)].map((m) => m.index!).filter((i, k, all) => i > 0 && i < unit.length
    && /\p{L}/u.test(unit.slice(k === 0 ? 0 : all[k - 1]!, i)));
  if (cuts.length === 0) return [unit];
  const out: string[] = [];
  let from = 0;
  for (const c of cuts) { out.push(unit.slice(from, c)); from = c; }
  out.push(unit.slice(from));
  return out;
}

/** A table header that names a share of runs ("| Option | Share |"), with or without a ranking word. */
const TABLE_SHARE_HEADER = /^\s*\|\s*(?:options?|paths?|choices?|alternatives?|plans?|scenarios?)\s*\|.*\b(?:share|chance|likelihood|probability|odds)\b/i;

const optionKeysOf = (labels: RankingLabelContext): Set<string> => new Set((labels.optionLabels ?? []).map(labelKey));

/** A row that is only "label: number" — its meaning comes from whatever introduced it. */
const VALUE_ROW = /^[\s\-+•*\d.)]*[^:|\n]{2,80}?(?::|\s-)\s*[£$€]?\s?\d[\d,.]*\s?(?:%|k|m|bn|x|pp)?[\s.;,)]*$/i;

const labelKey = (s: string): string => classificationCopy(s).replace(/\s+/g, ' ').trim().toLowerCase();

/** "Raise to £59: 71%." — one option's share, as the whole unit. */
const SHARE_UNIT = /^[\s\-+•*\d.)]*[^:|\n]{2,80}?(?::|\s-)\s*(\d+(?:[.,]\d+)?)\s?%[\s.;,)]*$/;

/**
 * Units that rank only AS A WHOLE, so no single sentence test sees them (review of #1871):
 *   - a markdown TABLE any row of which ranks ("| Win share |" as its header) is dropped whole — dropping
 *     only the header left "| Raise to £59 | 71% |" standing without its label;
 *   - a win-share DISTRIBUTION — two or more "label: N%" units whose percentages sum to about 100 — is
 *     dropped whole. A factor's own percentage ("Monthly churn: 4%") never sums to 100 with another.
 * Returned as `${segIndex}:${unitIndex}` keys.
 */
function unitsRankingAsAWhole(segs: ReadonlyArray<{ sep: string } | { units: string[] }>, labels: RankingLabelContext): Set<string> {
  const forced = new Set<string>();
  const unitsOf = (k: number): string[] | undefined => {
    const g = segs[k];
    return g !== undefined && 'units' in g ? g.units : undefined;
  };
  const isRow = (k: number): boolean => /^\s*\|/.test(unitsOf(k)?.join('') ?? '');
  for (let i = 0; i < segs.length; ) {
    if (!isRow(i)) { i += 1; continue; }
    const rows: number[] = [];
    let k = i;
    while (k < segs.length) {
      if (isRow(k)) { rows.push(k); k += 1; continue; }
      const g = segs[k];
      if (g !== undefined && 'sep' in g && g.sep === '\n' && isRow(k + 1)) { k += 1; continue; }
      break;
    }
    const header = unitsOf(rows[0]!)!.join('');
    const optionShareRow = rows.some((r) => {
      const cells = unitsOf(r)!.join('').split('|').map((c) => c.trim()).filter((c) => c !== '');
      return cells.length >= 2 && optionKeysOf(labels).has(labelKey(cells[0]!)) && cells.slice(1).some((c) => new RegExp(PCT).test(classificationCopy(c)));
    });
    if (optionShareRow || TABLE_SHARE_HEADER.test(classificationCopy(header)) || rows.some((r) => unitsOf(r)!.some((u) => sentenceRanksOptions(u, labels)))) {
      for (const r of rows) unitsOf(r)!.forEach((_, j) => forced.add(`${r}:${j}`));
    }
    i = k;
  }
  /**
   * ⛔ ROWS WHOSE MEANING IS THEIR HEADING (Codex 5825866849: "Win share in the modelled runs:" then
   * "- Raise to £59: 71%."). Dropping the ranking heading left the bare "71%" row. So when a unit ending
   * in ":" is dropped as ranking, the VALUE rows beneath it ("label: number") go with it. A full-sentence
   * item under it is still judged on its own, so a caveat list survives its heading.
   */
  for (let i = 0; i < segs.length; i += 1) {
    const us = unitsOf(i);
    const heading = us?.filter((u) => /\S/.test(u)).at(-1);
    if (heading === undefined || !/:\s*$/.test(classificationCopy(heading).trim()) || !sentenceRanksOptions(heading, labels)) continue;
    let k = i + 1;
    if (segs[k] !== undefined && 'sep' in segs[k]!) k += 1;
    while (k < segs.length) {
      const row = unitsOf(k);
      if (row === undefined) {
        const g = segs[k];
        if (g !== undefined && 'sep' in g && g.sep === '\n') { k += 1; continue; }
        break;
      }
      if (!VALUE_ROW.test(classificationCopy(row.join('')).trim())) break;
      row.forEach((_, j) => forced.add(`${k}:${j}`));
      k += 1;
    }
  }
  /** A lone "<option label>: N%" row is that option's share, heading or not. */
  const optionKeys = optionKeysOf(labels);
  if (optionKeys.size > 0) {
    segs.forEach((g, r) => {
      if (!('units' in g)) return;
      g.units.forEach((u, j) => {
        const copy = classificationCopy(u);
        if (SHARE_UNIT.exec(copy) === null) return;
        const head = copy.replace(/^[\s\-+•*\d.)]*/, '').split(/:|\s-\s/)[0] ?? '';
        if (optionKeys.has(labelKey(head))) forced.add(`${r}:${j}`);
      });
    });
  }
  // Grouped per CONTIGUOUS run (served: a win-share list and an ownership list in one reply summed to
  // 317 together, so neither was recognised). A run ends at anything but a share unit or a single newline.
  let run: Array<{ key: string; pct: number }> = [];
  const close = (): void => {
    const total = run.reduce((a, b) => a + b.pct, 0);
    if (run.length >= 2 && total >= 97 && total <= 103) for (const x of run) forced.add(x.key);
    run = [];
  };
  segs.forEach((g, r) => {
    if ('sep' in g) { if (g.sep !== '\n') close(); return; }
    g.units.forEach((u, j) => {
      if (!/\S/.test(u)) return;
      const m = SHARE_UNIT.exec(classificationCopy(u));
      if (m === null) { close(); return; }
      run.push({ key: `${r}:${j}`, pct: Number(m[1]!.replace(',', '.')) });
    });
  });
  close();
  return forced;
}

export interface FailClosedProseResult {
  /** The input REFERENCE when nothing was dropped. */
  readonly text: string;
  readonly droppedSentences: number;
}

/**
 * Drop every ranking sentence and keep every other sentence byte-identical. A line left empty is
 * removed with the SHORTER of its two separators, so a list or paragraph break survives; a list
 * marker whose first sentence was dropped is kept for the sentence that follows it.
 */
export function dropRankingSentences(text: string, labels: RankingLabelContext = NO_LABELS): FailClosedProseResult {
  if (typeof text !== 'string' || text.length === 0) return { text, droppedSentences: 0 };
  type Seg = { sep: string } | { units: string[] };
  const segs: Seg[] = [];
  for (const unit of splitIntoRedactableUnits(text)) {
    if (/^\n+$/.test(unit)) { segs.push({ sep: unit }); continue; }
    const last = segs[segs.length - 1];
    if (last !== undefined && 'units' in last) last.units.push(...finerSentences(unit));
    else segs.push({ units: finerSentences(unit) });
  }

  const forced = unitsRankingAsAWhole(segs, labels);
  let dropped = 0;
  const lines: Array<Seg | null> = segs.map((seg, r) => {
    if ('sep' in seg) return seg;
    const drop = seg.units.map((u, j) => forced.has(`${r}:${j}`) || (/\S/.test(u) && !PROTECTED_SENTENCES.has(u.trim()) && sentenceRanksOptions(u, labels)));
    const n = drop.filter(Boolean).length;
    if (n === 0) return seg;
    dropped += n;
    const kept = seg.units.filter((_, i) => !drop[i]);
    if (!kept.some((u) => /\S/.test(u))) return null;
    let line = kept.join('');
    if (drop[0] === true) {
      const lead = LIST_MARKER.exec(seg.units[0]!)?.[1] ?? /^\s*/.exec(seg.units[0]!)![0];
      line = lead + line.replace(/^\s+/, '');
    }
    if (drop[drop.length - 1] === true) line = line.replace(/[ \t]+$/, '');
    return { units: [line] };
  });
  if (dropped === 0) return { text, droppedSentences: 0 };

  const leading = segs[0] !== undefined && 'sep' in segs[0] ? segs[0].sep : '';
  let body = '';
  let pending: string | null = null;
  let started = false;
  for (const seg of lines) {
    if (seg === null) continue;
    if ('sep' in seg) {
      if (started && (pending === null || seg.sep.length > pending.length)) pending = seg.sep;
      continue;
    }
    if (started) body += pending ?? '\n';
    body += seg.units.join('');
    pending = null;
    started = true;
  }
  return { text: started ? leading + body : '', droppedSentences: dropped };
}

/**
 * Is the leader WITHHELD on this turn — exactly where the shared gate withholds, never wider?
 *
 * ⛔ It mirrors the shared gate's own three arms (`enforceLeadingOptionClaimsAtWire`), from the same
 * inputs, through the same exported predicates, so the two gates cannot disagree about WHETHER; this
 * module only recognises more of WHAT. In particular the separable-provisional population (entitled,
 * separated, `quantified_provisional`) is PERMIT-WITH-CAVEAT there — Paul's "caveat, not withhold"
 * (programme-docs#38 5576895511) — so it is never withheld here. The first version read
 * `claimPermissionsFrom(...).leader_may_be_named`, which is false for every mode but
 * `comparative_leader`, and withheld that whole population (review of #1871: 16/16).
 */
export function agentLaneLeaderWithheld(
  opts: Pick<WireLeaderClaimEnforcementOpts, 'mayNameLeadingOption' | 'analysisReady' | 'separationEstablished' | 'leaderClaimWithheldReason'>,
): boolean {
  if (opts.mayNameLeadingOption !== true) return true;
  const separableProvisional =
    opts.separationEstablished === true && permittedAnalysisModeFromAnalysisReady(opts.analysisReady) === 'quantified_provisional';
  if (separableProvisional) return false;
  const separationDeclined = leaderClaimReasonKind(opts.leaderClaimWithheldReason) === 'withheld';
  return !(analysisReadyPermitsLeaderNaming(opts.analysisReady) && !separationDeclined);
}

type WireField = (typeof WIRE_ENFORCED_PROSE_FIELDS)[number];

/**
 * THE AGENT LANE'S WIRE GATE: the fail-closed ranking drop on a withheld turn, then the shared
 * gate on what remains. Same signature and result shape as `enforceLeadingOptionClaimsAtWire`.
 * On a permitted turn this is exactly the shared gate — the Agent's text is untouched by this module.
 *
 * NEVER THROWS: a failure here is logged and the shared gate still runs on the original text.
 */
export function enforceAgentLaneLeaderClaimsAtWire(
  response: OlumiResponse,
  opts: WireLeaderClaimEnforcementOpts,
): WireLeaderClaimEnforcementResult {
  let next = response;
  let droppedSentences = 0;
  try {
    const text = response.assistant_text;
    if (typeof text === 'string' && text.length > 0 && agentLaneLeaderWithheld(opts)) {
      const projected = dropRankingSentences(text, rankingLabelContext(opts.graph, opts.analysisReady));
      if (projected.droppedSentences > 0) {
        droppedSentences = projected.droppedSentences;
        const withheldReason = claimPermissionsFrom((response as { analysis_state?: unknown }).analysis_state, opts.analysisReady).withheld_reason
          ?? opts.leaderClaimWithheldReason;
        const closing = agentNoLeaderSentence(withheldReason, opts.analysisReady);
        const body = projected.text.trimEnd();
        next = { ...response, assistant_text: body.length === 0 ? closing : `${body}\n\n${closing}` } as OlumiResponse;
        log.info(
          {
            event: 'agent_lane.withheld_leader_ranking_dropped',
            request_id: opts.requestId,
            exit_path: opts.exitPath,
            dropped_sentences: droppedSentences,
            withheld_reason: withheldReason ?? null,
            // Lengths only, never the prose: this is the user's own decision content.
            original_length: text.length,
            projected_length: next.assistant_text.length,
          },
          'agent-lane: the leader is withheld, so ranking sentences were dropped from the reply',
        );
      }
    }
  } catch (err) {
    next = response;
    droppedSentences = 0;
    log.error(
      { event: 'agent_lane.withheld_leader_fail_closed_failed', request_id: opts.requestId, err: err instanceof Error ? err.message : String(err) },
      'agent-lane: the withheld-leader ranking drop threw; the shared wire gate still runs on the original text',
    );
  }

  const shared = enforceLeadingOptionClaimsAtWire(next, opts);
  if (droppedSentences === 0) return shared;
  const edited = new Set<WireField>(['assistant_text', ...shared.editedFields]);
  return {
    response: shared.response,
    changed: true,
    editedFields: WIRE_ENFORCED_PROSE_FIELDS.filter((f) => edited.has(f)),
    blocksProjected: shared.blocksProjected,
  };
}

/**
 * BUILD-TIME PROBE — this module's own copy must survive its own classifier and the shared
 * vocabulary, be one sentence, and the classifier must SEE a claim (positive control), or every
 * absence above is vacuous.
 */
function assertCopyIsInertAndClassifierIsLive(): void {
  for (const s of AGENT_NO_LEADER_SENTENCES) {
    if (sentenceRanksOptions(s)) throw new Error(`withheld-leader-fail-closed: the no-leader sentence reads as ranking: ${s}`);
    if (textNamesLeadingOption(s)) throw new Error(`withheld-leader-fail-closed: the no-leader sentence trips the shared leader vocabulary: ${s}`);
    if (splitIntoRedactableUnits(s).length !== 1) throw new Error(`withheld-leader-fail-closed: the no-leader sentence is not ONE sentence: ${s}`);
  }
  if (!sentenceRanksOptions('The £59-at-release path produces the strongest MRR outcome.')) {
    throw new Error('withheld-leader-fail-closed: the classifier cannot see a paraphrased leader claim (positive control).');
  }
  const idempotent = `Kept.\n\n${AGENT_NO_LEADER_SENTENCES[0]!}`;
  if (dropRankingSentences(idempotent).text !== idempotent) {
    throw new Error('withheld-leader-fail-closed: a second pass edits the first pass’s output.');
  }
}

assertCopyIsInertAndClassifierIsLive();
