/**
 * Replacement conversation layer — proposing a RUN.
 *
 * WHY THIS IS A PROPOSAL AND NOT A READ
 * -------------------------------------
 * Every other tool in this layer that costs nothing is a read. This one costs
 * real compute and real seconds, on someone else's bill, and a model that can
 * trigger that on any turn it feels like is a spend incident waiting to
 * happen — the kind that is invisible until the invoice, because each
 * individual run looks reasonable.
 *
 * So it is `kind: 'propose'`, and the staged operation is `{ kind:
 * 'run_analysis' }` — no graph mutation, nothing to merge, nothing to
 * reconcile against a revision. It carries no payload because there is
 * nothing to choose: the run is of the model as it stands.
 *
 * ⭐ THE POINT OF STAGING AN OPERATION THAT MUTATES NOTHING is that it then
 * travels the SAME single consent path as every other change —
 * `accept_proposal` → `operationsToApply` → the injected `ApplyOperations`.
 * A second effect path ("reads are free, runs are special, so runs get their
 * own trigger") would be a second place where a human yes is checked, and two
 * places where consent is decided is how one of them ends up not checking.
 * There is exactly one gate, and a run goes through it.
 *
 * WHY READINESS IS CHECKED BEFORE THE OFFER, NOT AFTER THE YES
 * -------------------------------------------------------------
 * A user who agrees to a run that the engine will refuse has been charged a
 * decision for nothing and is then told, after the fact, that their model was
 * never analysable. The gate is already written, shared, pure and total
 * (`analysis-ready-core.ts`), so the honest place to run it is before the
 * offer exists.
 *
 * ⚠ AND A BARE "NOT READY" IS THE DEFECT, NOT THE FIX. Measured 2026-08-20:
 * a refusal printed the blocker COUNT and discarded all six prompts, having
 * just told the user to ask in the chat what was needed — CEE was holding the
 * answer at the moment it said it could not name it. `readinessQuestions`
 * exists because of that, and this tool returns its prompts so the
 * conversation can resolve them instead of stopping.
 *
 * ⚠⚠ `blockedNextStep`, NEVER `strict.nextStep`. The two answer different
 * questions and it is measured, not theoretical: on a graph with one
 * un-encoded option this file's own fixtures give `willProceed: true` with
 * `strict.nextStep` = *"Factor … needs a numeric value for option …"*. That
 * sentence is the STRICT term's prescription — what would have to be fixed for
 * the WHOLE model to be analysable — and rendering it while the run is about
 * to proceed anyway manufactures an obligation the system does not impose.
 * `blockedNextStep` is `null` exactly then, which is why it is the field to
 * read.
 *
 * ONE AUTHORITY, ONE ANSWER — AND A CORRECTED PREMISE
 * ---------------------------------------------------
 * The brief asked for `assessAnalysisReadiness` AND `resolveRunAdmission`.
 * Calling both would be two assessments of one graph, which
 * `analysis-ready-core.ts` explicitly forbids in its own doc blocks: *"a
 * module whose entire purpose is 'one authority, one answer' must not contain
 * two calls to the authority"*. It does not have to: `resolveRunAdmission`
 * computes `assessAnalysisReadiness`'s verdict internally and exposes it as
 * `admission.strict`. So this file calls the admission once and reads the
 * strict verdict off it. Nothing is reimplemented and nothing is assessed
 * twice.
 *
 * FRESHNESS IS THE SECOND GATE, AND ITS FOUR VERDICTS STAY APART
 * --------------------------------------------------------------
 * Re-running an unchanged model buys nothing, so a CURRENT analysis is a
 * refusal that points at `read_results`. Everything else is a legitimate
 * reason to run, but for different reasons that the user is owed: `stale`
 * is a positive finding (the model moved), `unknown` is an absence of proof
 * either way, `none` contradicts holding an analysis at all. Flattening those
 * into "might be out of date" is the same flattening `read-tools.ts` refuses
 * one layer down.
 *
 * NOTHING HERE TOUCHES THE ENGINE
 * --------------------------------
 * No PLoT, no ISL, no HTTP, no clock, no env. The tool RETURNS a staged
 * operation; whatever the caller injects as `ApplyOperations` executes it
 * later, after a human yes. Every input arrives through `deps`, so the whole
 * tool tests offline — no network, no credentials, no spend.
 */

import {
  readinessQuestions as defaultReadinessQuestions,
  resolveRunAdmission as defaultResolveRunAdmission,
  type ReadinessResult,
  type RunAdmission,
} from '../tools/handlers/analysis-ready-core.js';

import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { AgentTool, AgentToolOutcome } from './agent-loop.js';
import type { AnalysisSnapshot } from './read-tools.js';

/** The tool's name, exported so a caller can advertise it without a literal. */
export const RUN_ANALYSIS_TOOL_NAME = 'run_analysis';

/**
 * The staged operation's kind.
 *
 * The whole operation. There is no `detail`, because a run takes no
 * parameters: it analyses the model as it stands, at the revision the
 * proposal is bound to. An operation with nothing to vary cannot be
 * mis-applied into a different change than the one shown.
 */
export const RUN_ANALYSIS_OPERATION_KIND = 'run_analysis';

export interface RunAnalysisToolDeps {
  /** The graph as it stands. `null`/`undefined` when the session has none. */
  readonly getGraph: () => GraphStateIngress | null | undefined;
  /**
   * The latest analysis, same accessor `read_results` is given.
   *
   * Deliberately the SAME type and the SAME dep, so the tool that decides
   * whether to re-run and the tool that reads the results cannot disagree
   * about what analysis exists.
   */
  readonly getAnalysis: () => AnalysisSnapshot | null | undefined;
  /** The admission authority. Injected only so tests can drive the branches
   *  without hand-building a graph for every one; production takes the
   *  default, which is the same function the run path itself uses. */
  readonly resolveAdmission?: (graph: unknown) => RunAdmission;
  /** The open-questions projection. Injected for the same reason. */
  readonly readinessQuestionsFor?: (verdict: ReadinessResult) => readonly string[];
}

/**
 * The last-resort sentence, and it should be unreachable.
 *
 * `resolveRunAdmission` derives `blockedNextStep` so that a refusal can never
 * be silent — every `willProceed: false` return carries a sentence. This
 * exists because "should be unreachable" is a claim about another module, and
 * a refusal that degraded into an empty string would be exactly the bare
 * "not ready" this tool was built to end.
 */
export const RUN_ANALYSIS_UNSPECIFIED_BLOCKER =
  'The model is not ready to analyse and the check did not say which part is missing. ' +
  'Ask the user to walk you through the options and what each one changes, and check again.';

export const RUN_ANALYSIS_ALREADY_CURRENT =
  'THE ANALYSIS IS ALREADY CURRENT for the model as it stands, so running it again would ' +
  'compute the same answer at the same cost in time and compute. Use read_results instead — ' +
  'it returns the full figures and recomputes nothing. If the user wants a different answer, ' +
  'the thing to change is the model: propose that change, and a re-run is worth offering once ' +
  'it has been made.';

/** What the model is told to do with the open questions. Never a bare count. */
function refusalForBlockedModel(
  admission: RunAdmission,
  questions: readonly string[],
): string {
  const head =
    'THIS MODEL CANNOT BE ANALYSED YET, so there is nothing worth running and nothing has been ' +
    'offered to the user.';

  if (questions.length > 0) {
    return [
      head,
      '',
      'What is missing, in the checker\'s own words:',
      ...questions.map((q) => `  · ${q}`),
      '',
      'Put these to the user as questions, in your own words and one at a time if that reads ' +
        'better. Do not answer them yourself and do not estimate a value to get past them — ' +
        'the missing judgements are theirs. Once they are answered the run can be offered again.',
    ].join('\n');
  }

  // No per-question breakdown exists for this verdict. Measured: a single
  // blocker, `NO_GRAPH` and `SCHEMA_INVALID` all reach here, and each still
  // carries its own specific sentence — so this branch is specific too, it is
  // simply specific at the level of the model rather than per question.
  const step =
    admission.blockedNextStep === null || admission.blockedNextStep.trim().length === 0
      ? RUN_ANALYSIS_UNSPECIFIED_BLOCKER
      : admission.blockedNextStep;
  return `${head}\n\nWhat needs to happen first: ${step}\n\nPut that to the user as the next move.`;
}

/**
 * What the run will do to options the user has left unconfigured.
 *
 * ⭐ A CONSENT-RELEVANT FACT, WHICH IS WHY IT IS HERE AND NOT LEFT TO THE
 * RESULTS. The admission may proceed while excluding or holding options whose
 * blockers the exclusion answers. A user agreeing to spend on "the analysis"
 * is entitled to know before they agree that it will not compare everything
 * on their screen. Reported as a COUNT: `plan.option_count` means, in its own
 * author's words, *"options the run will not send exactly as the user left
 * them"*, and naming raw ids at a user-facing seam is the failure this layer
 * replaced.
 */
function exclusionDisclosure(admission: RunAdmission): string | null {
  if (!admission.plan.will_scaffold_options) return null;
  const n = admission.plan.option_count;
  if (n < 1) return null;
  return (
    `⚠ ${n === 1 ? 'One option' : `${n} options`} will not be sent exactly as the user left ` +
    `${n === 1 ? 'it' : 'them'}, because ${n === 1 ? 'it has' : 'they have'} nothing set to ` +
    'compare. Tell the user that before they agree, and name ' +
    `${n === 1 ? 'the option' : 'them'} from read_workspace rather than guessing.`
  );
}

const PROPOSAL_TAIL =
  'Say what running it will tell them that they do not already know, and that it takes a short ' +
  'while to compute. Do not describe it as running, started, or done — it is an offer, and only ' +
  'the user can turn it into a run.';

interface RunReason {
  readonly summary: string;
  readonly why: string;
}

/**
 * Why this run is worth its cost, by currency verdict.
 *
 * Four verdicts, four answers. `fresh` never reaches here — it is refused
 * above — so this function has no branch for it, which is the shape that
 * makes the refusal structural rather than a message someone remembered to
 * write.
 */
function reasonForRerun(snapshot: AnalysisSnapshot): RunReason {
  const currency = snapshot.freshness;
  if (currency === 'stale') {
    return {
      summary: 'Re-run the analysis — the results on record pre-date the latest changes',
      why:
        'THE MODEL HAS MOVED SINCE IT WAS LAST ANALYSED. The figures on record are real ' +
        'measurements of an earlier version of this model, so they still describe something — ' +
        'they just do not describe what is on screen now. That is why the re-run is worth its ' +
        'time, and it is the reason to give the user.',
    };
  }
  if (currency === 'none') {
    return {
      summary: 'Re-run the analysis — the results on record cannot be accounted for',
      why:
        'THE RECORD IS INCONSISTENT: an analysis payload is present while the caller reports ' +
        'no analysis on record. Nothing here can say which is right, so the figures cannot be ' +
        'relied on. Say that plainly — do not present it as a routine refresh.',
    };
  }
  return {
    summary: 'Re-run the analysis — the results on record cannot be confirmed as up to date',
    why:
      'CURRENCY COULD NOT BE ESTABLISHED. Nothing proves the figures on record are current for ' +
      'the model as it stands, and nothing proves they are not. Report that as the reason — ' +
      'not that they are out of date, which would be a claim nobody has made.',
  };
}

/**
 * The record could not be read, so nothing is known about what exists.
 *
 * Kept apart from {@link FIRST_RUN} for the same reason `read_results` keeps
 * its two no-figures sentences apart: FIRST_RUN asserts "NO ANALYSIS HAS EVER
 * BEEN RUN on this model", and offering to SPEND on that basis when the record
 * was simply unreadable is the product charging for an answer it may already
 * hold. Running is still a legitimate offer here — it is the justification that
 * has to be true.
 */
const RECORD_UNREADABLE: RunReason = {
  summary: 'Run the analysis — what is on record could not be read on this turn',
  why:
    'THE ANALYSIS RECORD COULD NOT BE READ. That is not a finding that nothing has been ' +
    'computed — an analysis may exist and may even be current; nothing here establishes ' +
    'either way. Say that plainly. Running it would produce a result that is certainly ' +
    'current, and that is the only thing running it guarantees here.',
};

/**
 * A run is on record and holds no usable results. Distinct from FIRST_RUN
 * because the user has already paid for one, and from RECORD_UNREADABLE
 * because the read succeeded — see `READ_RESULTS_NO_FIGURES_ON_RECORD`.
 */
const NO_FIGURES_ON_RECORD: RunReason = {
  summary: 'Re-run the analysis — the run on record holds no readable results',
  why:
    'AN ANALYSIS IS ON RECORD FOR THIS MODEL AND IT CARRIES NO READABLE RESULTS. Do not say ' +
    'nothing has ever been computed — a run exists, it simply holds no figures anyone can read. ' +
    'That is what running it again would fix, and it is the reason to give the user.',
};

/**
 * No success in the readable window, and the window says there is more.
 * FIRST_RUN would assert "NO ANALYSIS HAS EVER BEEN RUN" from a partial view.
 */
const NONE_IN_READABLE_HISTORY: RunReason = {
  summary: 'Run the analysis — no current result, and the older history is not fully readable',
  why:
    'NO SUCCESSFUL ANALYSIS APPEARS IN THE PART OF THIS HISTORY I CAN READ, and that history is ' +
    'incomplete — older runs may exist beyond it. Do not say the model has never been analysed. ' +
    'Running it now produces a result that is certainly current, which is the honest reason to ' +
    'offer it here.',
};

const FIRST_RUN: RunReason = {
  summary: 'Run the analysis — nothing has been computed for this model yet',
  why:
    'NO ANALYSIS HAS EVER BEEN RUN on this model. There are no outcome ranges, no comparison ' +
    'between the options and no measure of which uncertainties matter — not withheld, simply ' +
    'never computed. That is what running it would produce.',
};

/**
 * Propose running the analysis.
 *
 * Refuses in two circumstances and they are kept distinct on purpose: the
 * model cannot be analysed (the user has work to do), and the answer is
 * already current (there is nothing to buy). Collapsing them into one
 * "cannot run now" would lose the only thing that tells the user which of the
 * two they are in.
 */
export function createRunAnalysisTool(deps: RunAnalysisToolDeps): AgentTool {
  const resolveAdmission = deps.resolveAdmission ?? defaultResolveRunAdmission;
  const questionsFor = deps.readinessQuestionsFor ?? defaultReadinessQuestions;

  const execute = (): AgentToolOutcome => {
    // ONE assessment of this graph, and the strict verdict is read off it
    // rather than derived a second time.
    const admission = resolveAdmission(deps.getGraph());

    if (!admission.willProceed) {
      return {
        type: 'refused',
        content: refusalForBlockedModel(admission, questionsFor(admission.strict)),
      };
    }

    const snapshot = deps.getAnalysis();
    const hasAnalysis =
      snapshot !== null && snapshot !== undefined && snapshot.enrichment !== null;

    if (hasAnalysis && snapshot.freshness === 'fresh') {
      return { type: 'refused', content: RUN_ANALYSIS_ALREADY_CURRENT };
    }

    // "We could not look" is not "nothing is there". Offering to spend real
    // compute on the grounds that nothing has ever been computed, when the read
    // simply failed, is the paid-for half of the same false claim
    // `read_results` used to make.
    const recordUnreadable =
      snapshot !== null && snapshot !== undefined && snapshot.recordReadOk === false;
    // A run IS on record but carries no readable figures — the fifth state.
    // `FIRST_RUN` would assert "NO ANALYSIS HAS EVER BEEN RUN", which is false
    // here, and it is the paid half of that false claim: offering to spend on a
    // first run when what is actually needed is a re-run.
    // Same narrowing as `read_results`: only a real currency verdict over a
    // SELECTED fact supports "a run exists". `none` means none was selected.
    const runOnRecordWithoutFigures =
      snapshot !== null &&
      snapshot !== undefined &&
      snapshot.recordReadOk !== false &&
      !hasAnalysis &&
      snapshot.freshness !== null &&
      snapshot.freshness !== 'none';
    const historyIncomplete =
      snapshot !== null && snapshot !== undefined && snapshot.historyComplete === false;
    const reason = hasAnalysis
      ? reasonForRerun(snapshot)
      : recordUnreadable
        ? RECORD_UNREADABLE
        : historyIncomplete
          ? NONE_IN_READABLE_HISTORY
          : runOnRecordWithoutFigures
            ? NO_FIGURES_ON_RECORD
            : FIRST_RUN;
    const exclusion = exclusionDisclosure(admission);

    return {
      type: 'proposed',
      summary: reason.summary,
      operations: [{ kind: RUN_ANALYSIS_OPERATION_KIND }],
      content: [reason.why, exclusion, PROPOSAL_TAIL]
        .filter((part): part is string => part !== null)
        .join('\n\n'),
    };
  };

  return {
    kind: 'propose',
    definition: {
      name: RUN_ANALYSIS_TOOL_NAME,
      description:
        'Propose running the analysis — the computation that produces each option\'s outcome ' +
        'range, whether the top options are genuinely separated, which causal links would change ' +
        'the answer if they were wrong, and what resolving the uncertainties would be worth. ' +
        'Reach for it when there are no results yet, or when the model has changed since the ' +
        'last run. Do NOT reach for it to look at results that already exist — read_results ' +
        'does that and recomputes nothing; this tool refuses when the analysis is already ' +
        'current. Running is not free: it costs real compute and takes real time, so it is the ' +
        'user\'s call, and nothing runs until they agree. If the model is not ready to be ' +
        'analysed this refuses and tells you exactly what is missing — put those questions to ' +
        'the user rather than filling the gaps in yourself.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    execute,
  };
}
