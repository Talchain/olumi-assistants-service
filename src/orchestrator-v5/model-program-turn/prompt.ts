/**
 * THE CANONICAL DRAFTER'S FIXED TEXT (prompts v2, 29 Oct 2026: outbox/prompts-v2, with the DL's amendments D1–D4, R1, S1–S2
 * and Paul's B1, B2 and B4 as the PL revised them). The instructions and the schemas (from `model-program/canonical.ts`) are
 * constants, the same bytes on every call (the cached prefix):
 *  · a first draft is sent all of DRAFTING_INSTRUCTIONS; an update and a repair only its MODELLING RULES (never the FIRST
 *    DRAFT ONLY section);
 *  · an update's task (UPDATE_INSTRUCTIONS) and a repair's (REPAIR_INSTRUCTIONS) are Olumi's, sent in the developer role with
 *    the change request, the permitted removals or the compiler's errors, apart from the person's verified words;
 *  · the date context (`todayLine`) is a developer message: facts for reading stated time, never arithmetic for the AI.
 * No exam, journey or brief text is in any of them.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod-v4';
import { CanonicalModel, HOST_OWNED_FIELDS } from '../model-program/canonical.js';

export const DRAFTING_INSTRUCTIONS = [
  'MODELLING RULES',
  'Represent the scenario as a provisional Living Model that helps people understand, challenge and improve their reasoning. People own conclusions and actions. Preserve material qualitative reasoning as well as the calculable subset; a goal or numerical result is not required.',
  '',
  'Preserve every supplied figure, including totals and components, with its unit, period, reference, qualifiers, conditions and source words. Retain aims, options, commitments, evidence, assumptions, uncertainty, dissent and causal beliefs. Distinguish a tentative idea from a commitment and an unknown from zero. Keep each label, basis and question to one short sentence without losing meaning.',
  '',
  'Use person for content the person supplied, including reported statements, such as what a supplier, colleague or customer told them; Olumi\'s reading of it, such as a date, stays Olumi\'s; retain the reported speaker in party and an unbroken verbatim supporting span in quote. Use olumi for additions, estimates and interpretations, with quote null. Keep added reasoning on separately attributed records. An approximate point remains their point; an added uncertainty range is Olumi\'s separate proposal. Corrections supersede the relevant statement without redrafting unrelated reasoning. Represent each distinct assertion once; reuse references rather than paraphrase it across families.',
  '',
  'Keep every aim, including avoiding a loss; distinguish an outcome sought, a hard limit and a preference about how to proceed. A measure must track the actual aim, with the stated comparator, level or change, reference, aggregation and time window. Propose a measure only where it tracks the actual aim, preserving other causes and exclusions; do not count changes unrelated to success (such as cancellations shrinking a queue) as progress toward it. Attribute a suggested measure to Olumi and identify what it excludes. Retain unmeasured aims and limits without invented scores. Never estimate the person\'s target, limit, budget, deadline or choice; ask only for what is missing. A decision date is context, not an outcome measure.',
  '',
  'Name factors clearly enough that someone with the facts could identify their values. Retain supported units even when values are unknown. Use unit 1 only for a genuinely dimensionless quantity; ask for a missing physical or currency unit. Preserve a stated score without inventing ordinal arithmetic. Do not turn an amount into an unsupported rate or treat a target as a baseline.',
  '',
  'When the calculation needs a figure they did not supply, give a provisional Olumi estimate only where a reasonable basis and range exist: author olumi, status estimated, plausible low/high and, when supportable, a most likely value inside them. Start from a credible reference class, adjust for the stated context, apply the same standard across options and briefly name the basis without inventing evidence. The range expresses Olumi\'s rough intended uncertainty, about eight chances in ten, not measured calibration; widen it when knowledge is weak. This permission includes missing situation figures, mechanism sizes, risk chances and severities, and start times needed by a supported temporal mechanism. It excludes the person\'s target, limit, budget, deadline and choice. Where no responsible range exists, retain unknown or asked and identify the evidence that could size it. Never force a number to obtain a chance.',
  '',
  'Use influence links for causal beliefs without defensible sizes, preserving direction, confidence, conditions and disagreement. For supported arithmetic, use signed-sum or product definitions; for a sized causal mechanism, use an effect with separately attributed coefficients; for a level carrying over, use a stock. Keep supported calculations through to the quantities measured by aims and limits, even when another dependency cannot be calculated. Preserve supported numerical option effects, including reported claims with their qualifiers. Distinguish the claim\'s source, the causal interpretation and any added range. Link options through the inputs they change or their qualitative influences; preserve consequential drivers, capacity, baselines, losses and interactions. Retain supported feedback; unsupported execution remains explicit. Never add a connection just to make an option comparable, drop an unsized dependency, or use a qualitative link in place of supported arithmetic. Never add a switch, a zero or an intermediate total the calculation does not use.',
  '',
  'Count a one-off payment once; distinguish lasting capacity from recurring spending. Use stocks for cumulative spending against a limit. Exact structural constants may define mathematics or no additional activity, never an unknown current level. Carrying on does not establish that a reference or outcome stays unchanged. Put real prerequisites and challenges on the affected option or record, not in place of missing numerical inputs.',
  '',
  'Choose week, month or year from the supplied figures and mechanism, retaining the units they supplied. For a stated date or span that supplies a window length or origin/timing offset, write stated_time as a date in YYYY-MM-DD or the original span and its day/week/month/year unit. A span is counted from the day they say it; for a span from another point, write the date if they give one, otherwise ask. Leave said_on null for a date or span stated in this message; keep the saved said_on when you return a record whose time is not restated. Keep the person\'s words in quote; the host sets who the count is from. Leave value null: the host counts and discloses model periods. Use the supplied date context to interpret date wording; ask only when the date or convention is genuinely ambiguous. Do not subtract dates, convert spans, round periods, compute a missing endpoint or ask for a span the stated dates imply. Keep an immediate start as 0; do not send it through positive-duration conversion. Preserve delays and ask for a genuinely missing horizon. Keep a supplied decide-by date in decide_by with its quote; if the date is unresolved, keep their words in quote with date null. Do not substitute it for an outcome deadline.',
  '',
  'Risks are possible future events, not current facts. Attach each to what it affects and preserve its direction. Use the supplied or responsibly estimated chance over the whole model horizon and its effect if it occurs. If either cannot be sized, retain the risk and the affected withholding; never delete it to make a result calculable.',
  '',
  'Keep claims, evidence and sources, assumptions, dissent, conditions and exclusions on the records they concern. An unsupported mechanism or measure stays visible with why it cannot be calculated and what would enable it. Do not invent evidence, consensus or a party\'s position.',
  '',
  'Put each missing input\'s question on its item. Select up to three coaching_questions, using a selected item question\'s exact words: clarify an ambiguous aim or measure first, then a consequential uncertainty, rival explanation, feasibility issue or premise separating options, then arithmetic-only detail. Name the card in the question. Seek observable evidence or the person\'s figure, not invented causal sizes; avoid quoting Olumi\'s estimate in the question. Ask for a range when their approximate point feeds an aim or limit. Do not re-ask supplied information.',
  '',
  'FIRST DRAFT ONLY',
  'This section applies only when creating a model, never during an update or repair. Draft one compact model with a plain question and short title. Retain every named option with its actual qualifier and include carrying on, with carry_on true only there. Add one or two useful, materially different Olumi alternatives that fit the stated scope, budgets and exclusions; make them concrete, including feasible divisions for allocations. Do not invent feasibility where a prerequisite is unresolved. Add material missing factors, outcomes and risks without a record quota. With no stated aim, propose one Olumi working aim for confirmation, leaving its target asked. Return only the canonical object required by the supplied schema.',
].join('\n');
/** The section only a first draft is sent (INTEGRATION §1–2): an update and a repair stop before it. */
export const FIRST_DRAFT_ONLY = 'FIRST DRAFT ONLY';
/** The rules every drafting call is sent: DRAFTING_INSTRUCTIONS up to, never including, its FIRST DRAFT ONLY section. */
export const MODELLING_RULES = DRAFTING_INSTRUCTIONS.slice(0, DRAFTING_INSTRUCTIONS.indexOf(`\n\n${FIRST_DRAFT_ONLY}\n`));
/** An update's task, in the developer role after the saved model (`draft.ts` proposePostimage). */
export const UPDATE_INSTRUCTIONS = [
  'Update the supplied saved model for the requested change, using the modelling rules. Return only added or changed records, each complete with its id, and remove ids from the permitted removal list; [] for unchanged families. Keep existing ids and unaffected fields, sources, wording and references. Give new records new ids. Return null for unchanged nullable top-level fields. Return a replacement coaching_questions list only when questions were answered, no longer apply or a more consequential question is now supported; [] clears it.',
  '',
  'Apply each answer to the item it answers, including an option-specific answer on that option\'s item. Interpret yes, no, all or none numerically only when the question makes the meaning unambiguous; preserve the actual words and explain the reading separately. Never treat an unanswered or unknown figure as zero. Do not ask the same answered question again. For “I don\'t know”, retain their uncertainty separately from any responsible Olumi estimate; if no reasonable range exists, leave the input open and ask for evidence that could size it. When asked to estimate, provide ranged, visibly Olumi estimates where supportable under the modelling rules, never their target, limit, budget, deadline or choice.',
  '',
  'Follow explicit corrections, retractions and representation changes only within their scope. Do not turn a discussion, answer or what-if into a wider redraft. A new aim or limit includes the supported relations from options and their inputs, with consequential unknowns retained; do not connect merely for appearance.',
  '',
  'For simplification, re-express the same consequential meaning in fewer records. Preserve supplied figures and their ids, units, periods and quotes; useful options, measures, supported calculations, qualitative causes, risks, conditions, uncertainty, dissent and attribution. Fold only redundant scaffolding; do not add a summary beside unchanged records or replace supported arithmetic with influences. If lossless reduction is unavailable, return no edits. A requested size does not authorize losing meaning.',
  '',
  'For new or corrected dates and spans, write stated_time and leave value null; the host counts from the saved period-zero context. Keep decide-by separate from outcome timing. For decide_by, null keeps the saved value; an object replaces it; {"date":null,"quote":null} explicitly clears it only when requested.',
  '',
  'The change request below is Olumi\'s instruction, not the person\'s words. Quotes may come only from the supplied verified human messages or unchanged saved human quotes, never from Olumi\'s request, model labels or compiler feedback.',
].join('\n');
/**
 * How an update names its change and its permitted removals (C6, "Source quote, contributor and approval actor stay
 * distinct"): Olumi's own material, in the developer role with UPDATE_INSTRUCTIONS, never in a user-role message, which holds
 * only the person's verified words.
 */
export const UPDATE_CHANGE_LABEL = 'Olumi\'s change request:';
export const UPDATE_REMOVALS_LABEL = 'Permitted removal ids:';
/** The saved model an update edits, and the retained candidate a repair edits: data, labelled, never instructions. */
export const SAVED_MODEL_LABEL = 'Saved model (data):';
export const BASE_MODEL_LABEL = 'Retained base model (data):';
/** The ONE edit-only repair's task (INTEGRATION §3), sent with the compiler's errors in the developer role. */
export const REPAIR_INSTRUCTIONS = [
  'Repair the retained base model only for the compiler errors supplied in developer feedback. Return only the changed or added records, each complete with its existing or new id, in the edit schema; [] for unchanged families. Return null for unchanged nullable top-level fields. Never return the whole model.',
  'Preserve all unaffected content, figures, units, quotes, sources and qualitative reasoning. Do not invent values, estimates, units or meaning to silence an error; keep an unresolved input open. Never estimate the person\'s target, limit, budget, deadline or choice, replace an unknown with zero, drop a dependency to expose a chance, or relabel Olumi content as theirs. Use stated_time for dates and spans; leave its value null for the host. Do no calendar counting or conversion.',
  'Remove only ids a compiler error names as removable, without losing protected person-authored figures or consequential meaning. Otherwise return remove []. Include any directly required reference repairs. The host merges these edits onto the retained base; do not resend earlier edits unless they are absent from that base.',
].join('\n');
export const REPAIR_ERRORS_LABEL = 'Compiler errors:';

/**
 * AN UPDATE'S OUTPUT (DL 24 Oct, DoD-G classes 12 and 4), derived from the canonical schema, never a second copy: in each
 * family only the records the update changes or adds, each in its family's own record schema; the question and the time
 * step null unless the change is to them; the ids it removes in remove; no history (the host's); no title (the first draft's,
 * kept as drafted). Olumi's coaching questions (Box 2, Paul Q1/Q2, 28 Oct): null keeps the saved list; the whole new list,
 * [] included, replaces it, only when this change makes it out of date. The host merges it onto the
 * saved model by id (`draft.ts` mergeUpdate). The families' "every ..." descriptions are a first draft's, so they are left off.
 */
export const CanonicalUpdate = CanonicalModel.omit({ history: true, title: true }).extend({
  question: CanonicalModel.shape.question.nullable().describe('Null keeps the saved question; otherwise its explicitly requested replacement in one plain sentence.'),
  period: CanonicalModel.shape.period.nullable().describe('Null keeps the saved time step; otherwise the explicitly requested new supported step, with all affected records updated consistently.'),
  decide_by: CanonicalModel.shape.decide_by.describe('Null keeps the saved decide-by value. An object replaces it; {date:null, quote:null} clears it only on an explicit request. Preserve an unresolved supplied date as {date:null, quote:their exact words}.'),
  coaching_questions: CanonicalModel.shape.coaching_questions.nullable().describe('Null keeps the saved list; otherwise replace the whole list when this change answers, invalidates or changes the priority of questions. [] clears it. Apply the canonical question rules.'),
  goals: z.array(CanonicalModel.shape.goals.element),
  limits: z.array(CanonicalModel.shape.limits.element),
  preferences: z.array(CanonicalModel.shape.preferences.element),
  options: z.array(CanonicalModel.shape.options.element),
  remove: z.array(z.string()).describe('Only ids the change request permits removing, or that a compiler error names as removable, and that this edit actually removes. Preserve protected human figures and consequential meaning; [] for none.'),
}).describe('Only added or changed records, each complete in its existing family with its stable id; [] for unchanged families. Unchanged nullable top-level fields are null. Do not return the whole model or duplicate unaffected records.');
export type CanonicalUpdateT = z.infer<typeof CanonicalUpdate>;

/**
 * The canonical schema as OpenAI's strict json_schema. `z.toJSONSchema` is the shape S1 checks for strict output
 * (`compile.test.ts`, closed objects, every key required, anyOf only); dropped at this boundary: `$schema`, the safe-integer
 * bounds `.int()` adds (S1: "no number carries a bound"; the compiler checks bounds in sentences), and the host's own fields
 * (`HOST_OWNED_FIELDS`, from every object's properties and required), which the drafter never writes (Paul 26 Oct).
 */
function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const host: ReadonlySet<string> = new Set(HOST_OWNED_FIELDS);
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (n === null || typeof n !== 'object') return n;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === '$schema') continue;
      if ((k === 'minimum' || k === 'maximum') && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
      if (k === 'properties' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([p]) => !host.has(p)).map(([p, s]) => [p, walk(s)]));
      } else if (k === 'required' && Array.isArray(v)) {
        out[k] = v.filter((p) => !host.has(String(p)));
      } else out[k] = walk(v);
    }
    return out;
  };
  return walk(z.toJSONSchema(schema)) as Record<string, unknown>;
}
/** The first draft's strict output: the canonical model without its history (the host's: none yet, `draft.ts` withHostFields). */
export const CANONICAL_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(strictSchema(CanonicalModel.omit({ history: true }).describe(CanonicalModel.description ?? '')));
/** The update's strict output: the same records, by the same walk. */
export const UPDATE_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(strictSchema(CanonicalUpdate));
export const CANONICAL_SCHEMA_NAME = 'canonical_model';
/**
 * The date context, a developer message on every drafting call (INTEGRATION §1, adopted as written): today and the saved
 * period 0 (the first draft's day, `drafted_on`; today on a first draft; "not recorded" for a model saved before it was kept,
 * never today: PL HOLD a), facts for reading the dates they state. No date subtraction, span conversion or rounding is asked
 * of the AI: the host counts (`stated-time.ts`).
 */
export const todayLine = (today: string, periodZero: string | null = today): string =>
  `Today: ${today}. Time zone: Europe/London. Saved period-zero date: ${periodZero ?? 'not recorded'}. These dates are context for interpreting stated time; the host counts model periods.`;
export const DRAFTING_PROMPT_SHA256 = createHash('sha256').update(DRAFTING_INSTRUCTIONS, 'utf8').digest('hex');
export const CANONICAL_SCHEMA_SHA256 = createHash('sha256').update(JSON.stringify(CANONICAL_JSON_SCHEMA), 'utf8').digest('hex');
