/**
 * The truthful answer to "what is stopping my analysis".
 *
 * ── WHY A DETERMINISTIC ANSWER AND NOT A ROUTED ONE ────────────────────────
 * The question is about ADMISSION, and admission has exactly one authority:
 * the canonical readiness payload the turn already computed
 * (`analysisReadyForTurn`). A routing model asked the same question chose
 * `adjust_edge_strength` and moved a number that could never satisfy the
 * obligation — measured on staging, 23 Sep, scenario `399c2814`.
 *
 * ⛔ EVERY SENTENCE HERE IS DERIVED FROM THAT PAYLOAD. The blocker text is the
 * readiness issue's OWN `message`, quoted, never a paraphrase and never a
 * second opinion about what is wrong. Two authorities on "what blocks this"
 * is exactly the defect that sent the user to configure an option that was
 * already configured.
 *
 * ⛔ IT PROMISES NOTHING IT HAS NOT DONE. This module answers; it does not
 * repair. Where the user authorised estimates, it says plainly that it has not
 * made changes yet rather than implying it has — a receipt for work not done
 * is the failure class this whole lane exists to remove.
 */

/** The readiness shape this reads — a narrow view of the canonical payload. */
export interface UnblockReadinessIssue {
  readonly code?: string;
  readonly message?: string;
  readonly option_label?: string;
  readonly repairability?: string;
  readonly obligation?: string;
}

export interface UnblockReadinessView {
  readonly status?: string;
  readonly readiness_issues?: readonly UnblockReadinessIssue[];
}

export interface UnblockAnalysisAnswer {
  readonly assistant_text: string;
  readonly offer_run_analysis: boolean;
}

/**
 * An issue the user must resolve. `offered` obligations must never be
 * presented as blocking — a standing ruling, and presenting one as a blocker
 * would manufacture work the product does not actually require.
 */
function isBlocking(issue: UnblockReadinessIssue): boolean {
  return issue.obligation !== 'offered';
}

function issueSentence(issue: UnblockReadinessIssue): string {
  const message = typeof issue.message === 'string' ? issue.message.trim() : '';
  if (message.length > 0) return message;
  // No message on the issue: name the code rather than invent prose for it.
  const code = typeof issue.code === 'string' && issue.code.length > 0 ? issue.code : 'unknown';
  const label = typeof issue.option_label === 'string' ? ` (${issue.option_label})` : '';
  return `${code}${label}`;
}

export function buildUnblockAnalysisAnswer(
  readiness: UnblockReadinessView | undefined,
  input: { readonly authorises_repair: boolean },
): UnblockAnalysisAnswer {
  // No readiness computed for this turn — say so rather than guess.
  if (readiness === undefined) {
    return {
      assistant_text:
        'I could not read the model state for this turn, so I cannot say what is blocking the analysis. Try again, and if it persists tell me and I will look further.',
      offer_run_analysis: false,
    };
  }

  const blocking = (readiness.readiness_issues ?? []).filter(isBlocking);

  if (readiness.status === 'ready' || blocking.length === 0) {
    return {
      assistant_text:
        'Nothing is blocking the analysis — the model is ready to run.',
      offer_run_analysis: true,
    };
  }

  const head =
    blocking.length === 1
      ? 'One thing is blocking the analysis:'
      : `${blocking.length} things are blocking the analysis:`;

  const body =
    blocking.length === 1
      ? ` ${issueSentence(blocking[0] as UnblockReadinessIssue)}`
      : '\n' + blocking.map((i) => `- ${issueSentence(i)}`).join('\n');

  // ⚠ THE TAIL IS ABOUT WHAT HAPPENS NEXT, AND IT MUST NOT OVERSTATE.
  // `human_input_required` means exactly that: no estimate the product could
  // supply would resolve it, so promising to "put good assumptions in" there
  // would be a promise it cannot keep.
  const allNeedHuman = blocking.every((i) => i.repairability === 'human_input_required');
  const tail = input.authorises_repair
    ? allNeedHuman
      ? ' I have not changed anything yet. This one needs your answer rather than an assumption from me — tell me the mechanism and I will write it in.'
      : ' I have not changed anything yet. Tell me to go ahead and I will fill in the parts that can be estimated, and come back to you for the rest.'
    : '';

  return { assistant_text: `${head}${body}${tail}`, offer_run_analysis: false };
}
