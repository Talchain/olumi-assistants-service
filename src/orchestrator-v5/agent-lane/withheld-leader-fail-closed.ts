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
 * THE PERMISSION IS READ, NEVER RE-DERIVED. "Withheld" is the negation of what the Agent was
 * told: `claimPermissionsFrom` — the one producer of `claim_permissions` — over the body's own
 * `analysis_state`, conjoined with the caller's `mayNameLeadingOption` (the same readback). A
 * turn is permitted only when both say so.
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
 * a designation that uses no ranking word at all ("directional support for £59", "the ordering
 * switches towards keeping £49", "go with the first one"). Those sentences are kept.
 */
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { log } from '../../utils/telemetry.js';
import { permittedAnalysisModeFromAnalysisReady } from '../admission/analysis-admission.js';
import {
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
  /** A NEGATED recommendation is a disclaimer ("…, not a recommendation"). The verb stays ranking. */
  /\b(?:not|no|never|rather\s+than)\s+(?:a\s+|any\s+)?recommendations?\b/gi,
  /** Ranking ASSUMPTIONS by sensitivity is sanctioned content; the route's instruction asks for it. */
  /\b(?:highest|strongest|biggest|largest)\s+(?:sensitivity|influence|drivers?|levers?|dependency|uncertainty|elasticity)\b/gi,
  /\bhighest\s+(?:plausible|possible|credible)\b/gi,
  /\bmost\s+likely\s+(?:values?|estimates?|figures?|ranges?|levels?)\b/gi,
  /** Questions or assumptions "most likely to determine the result" — ranking what matters, not options. */
  /\bmost\s+likely\s+to\s+(?:determine|affect|change|shift|move|matter|drive|influence|decide|flip|alter)\b/gi,
  /** "on top of that", "top-line", "top-down". */
  /\b(?<!\bout\s+)on\s+top\s+of\b/gi,
  /\btop[\s-]+(?:line|down)\b/gi,
];

/** A probability-like percentage: "83.28%", "15 %". */
const PCT = String.raw`(?<![\w.])\d+(?:[.,]\d+)?\s?%`;

/**
 * Ranking language. Each entry is ONE question — "does this sentence order the options or single
 * one out?" — asked of a sentence whose idioms and ranking-shaped labels have been blanked.
 */
const RANKING_PATTERNS: ReadonlyArray<{ readonly code: string; readonly re: RegExp }> = [
  { code: 'lead', re: /\b(?:lead|leads|leading|led|leaders?)\b/i },
  { code: 'favour', re: /\b(?:favou?rs?|favou?red|favou?ring|favou?rites?|(?:more|most)\s+favou?rable)\b/i },
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
    re: /\bbetter\s+than\b|\bbetter\s+(?:option|choice|bet|path|route|outcome|result|performer|pick|alternative|fit|candidate|position)s?\b|\b(?:perform(?:s|ed|ing)?|do|does|did|doing|fare[sd]?|faring|scor(?:e|es|ed|ing)|comes?\s+out|came\s+out|fits?|fitted|works?|worked)\s+better\b/i,
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
  { code: 'clear_choice', re: /\b(?:clear|obvious|natural|safest|smartest)\s+(?:choice|pick|option|bet)\b/i },
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
  return { rankingShapedLabels: labels, rankingShapedLabelWords: [...words] };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  return rankingCodesInBlanked(blankIdioms(text));
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

/** The ONE sentence appended when something was dropped. Typed reason first, then the admission's, then "not recorded". */
export function agentNoLeaderSentence(withheldReason: string | undefined, analysisReady: unknown): string {
  if (withheldReason !== undefined && BY_WITHHELD_REASON[withheldReason] !== undefined) return sentence(BY_WITHHELD_REASON[withheldReason]!);
  const mode = permittedAnalysisModeFromAnalysisReady(analysisReady);
  if (withheldReason === undefined && mode !== null && mode !== 'comparative_leader') {
    const code = admissionModeReasonCode(analysisReady);
    if (code !== undefined && BY_ADMISSION_REASON[code] !== undefined) return sentence(BY_ADMISSION_REASON[code]!);
  }
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
    if (last !== undefined && 'units' in last) last.units.push(unit);
    else segs.push({ units: [unit] });
  }

  let dropped = 0;
  const lines: Array<Seg | null> = segs.map((seg) => {
    if ('sep' in seg) return seg;
    const drop = seg.units.map((u) => /\S/.test(u) && !PROTECTED_SENTENCES.has(u.trim()) && sentenceRanksOptions(u, labels));
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

/** Is the leader withheld on this Agent turn? The negation of what the Agent was told — never re-derived. */
export function agentLaneLeaderWithheld(response: OlumiResponse, opts: Pick<WireLeaderClaimEnforcementOpts, 'mayNameLeadingOption' | 'analysisReady'>): boolean {
  if (opts.mayNameLeadingOption !== true) return true;
  const analysisState = (response as { analysis_state?: unknown }).analysis_state;
  return claimPermissionsFrom(analysisState, opts.analysisReady).leader_may_be_named !== true;
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
    if (typeof text === 'string' && text.length > 0 && agentLaneLeaderWithheld(response, opts)) {
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
