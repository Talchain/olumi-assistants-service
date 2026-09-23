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
  /** Named by the refusal producers (e.g. `NO_PATH_TO_GOAL`) with no issue list. */
  readonly blocked_reason?: string;
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

  // ⛔ "NOTHING IS BLOCKING" IS ONLY SAYABLE ON AN EXPLICIT `ready`.
  //
  // This read `status === 'ready' || blocking.length === 0`, so an EMPTY issue
  // list alone produced the claim. Measured against a real producer:
  // `buildAnalysisRefusalReadiness('NO_PATH_TO_GOAL')` returns
  // `{ status: 'blocked', blocked_reason: 'NO_PATH_TO_GOAL' }` and carries NO
  // `readiness_issues` — a payload that says it is blocked AND names its
  // blocker, answered with "the model is ready to run". The absence of a
  // detailed list is not evidence of readiness; only `ready` is.
  const explicitlyReady = readiness.status === 'ready';
  if (explicitlyReady) {
    return {
      assistant_text:
        'Nothing is blocking the analysis — the model is ready to run.',
      offer_run_analysis: true,
    };
  }

  if (blocking.length === 0) {
    // Not ready, and no itemised issues. Say what the payload says and nothing
    // more — naming a cause it did not give is how the previous notice came to
    // tell a user an option had no effect values when it had two.
    const reason =
      typeof readiness.blocked_reason === 'string' && readiness.blocked_reason.trim().length > 0
        ? ` The model reports: ${readiness.blocked_reason.trim()}.`
        : '';
    const state =
      typeof readiness.status === 'string' && readiness.status.trim().length > 0
        ? readiness.status.trim()
        : 'not ready';
    return {
      assistant_text: `The analysis cannot run yet — the model is ${state}.${reason} I do not have an itemised list of what to change for this one.`,
      offer_run_analysis: false,
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
  // ⛔ THE TAIL MUST NOT PRESCRIBE A REMEDY. It was the one sentence here not
  // derived from the payload, and it was wrong on the commonest blocked shape.
  // Measured on a real captured graph (`scenario-graph-base-capture.json`)
  // through `buildCanonicalAnalysisReadyFromGraph`: 10 issues — ORPHAN_NODE ×5,
  // OPTION_NO_FACTOR_EDGES ×2, OPTION_NOT_LINKED_TO_DECISION ×2, NO_PATH_TO_GOAL
  // — every one `human_input_required`. The old tail answered "**This one**
  // needs your answer … tell me **the mechanism** and I will write it in":
  // singular for ten items, and a MAPPING remedy for issues that are not
  // mapping obligations (their own messages say "Add at least one factor edge",
  // "Link the decision to it"). That is a second opinion about what is wrong —
  // exactly what this module's header forbids, and what its compose-site
  // register entry claims it does not do.
  //
  // It now says only what the payload supports: that nothing was changed, and
  // whether the outstanding items can be estimated or need the user. The
  // REMEDY is already in each issue's own quoted message above.
  const allNeedHuman = blocking.every((i) => i.repairability === 'human_input_required');
  const those = blocking.length === 1 ? 'That one needs' : 'Those need';
  const tail = input.authorises_repair
    ? allNeedHuman
      ? ` I have not changed anything yet. ${those} your input rather than an assumption from me.`
      : ' I have not changed anything yet. Tell me to go ahead and I will fill in the parts that can be estimated, and come back to you for the rest.'
    : '';

  // ⚠ THE TAIL GOES ON ITS OWN LINE AFTER A LIST. Glued to the final bullet it
  // reads as a property of that one item — measured: "This one needs your
  // answer" appeared appended to the third of three bullets.
  const joined = blocking.length === 1 ? `${head}${body}${tail}` : `${head}${body}${tail === '' ? '' : `\n${tail.trim()}`}`;
  return { assistant_text: joined, offer_run_analysis: false };
}
