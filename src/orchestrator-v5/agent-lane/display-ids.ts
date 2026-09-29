/**
 * ⛔ A PROPOSAL ID IS A BINDING FOR `authorise_change`, NEVER SOMETHING A USER READS OR TYPES.
 *
 * Measured on served builds (output/paul-test-20260923/construction-witness/raw and
 * output/openai-agent-lane): 49 reply lines printed a raw 32-hex `prop_…` id, and
 * several told the user to TYPE it — *say “approve `prop_b44af6f69a85…`”*. The
 * UI's own chip rules already ban that token (the 08:13 measurement on #63), and
 * approval never needed it: the Agent resolves "yes" against
 * `awaiting_your_approval` in its own tool results, which this rewrite does not
 * touch (history is the model's item list, not the text returned here).
 *
 * So the text the user sees names a proposal in words:
 *   - one id in the reply → "this proposal";
 *   - several → "proposal 1", "proposal 2", … in order of first mention;
 *   - a line that is ONLY a label for the id ("**Proposal ID:** `prop_…`") is
 *     dropped when there is one proposal, and becomes "**Proposal N**" when there
 *     are several, so the separation between them survives.
 *
 * Every shape handled here is one the corpus above actually contains; the
 * fixture in `__tests__/fixtures/served-proposal-id-lines.json` is that corpus.
 */

const ID = 'prop_[0-9a-f]{6,}';
const ANY_ID = new RegExp(ID, 'g');

/** A whole line whose only content is the id, optionally labelled "Proposal (ID):", in any bold/backtick wrapping. */
const LABEL_ONLY = new RegExp(
  String.raw`^(\s*(?:[-*•>]\s+|\d+\.\s+)?)(?:\*\*)?(?:Proposal(?:\s+ID)?\s*:?\s*)?(?:\*\*)?\s*` +
    String.raw`(?:\*\*)?` + '`?' + String.raw`(?:\*\*)?(` + ID + String.raw`)(?:\*\*)?` + '`?' + String.raw`(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$`,
  'i',
);

/** "proposal[ ID][:] [**]`prop_…`[**]" → one name. Bold that wrapped only the id is dropped with it. */
const LABELLED = new RegExp(
  String.raw`\b([Pp])roposal(?:\s+ID)?(?:\s*:)?\s*(\*\*)?\s*` + '`?(' + ID + ')`?' + String.raw`(\*\*)?`,
  'g',
);

/** A bare id, with its backticks. */
const BARE = new RegExp('`?(' + ID + ')`?', 'g');

export function withoutProposalIds(text: string): string {
  const ids = [...new Set(text.match(ANY_ID) ?? [])];
  if (ids.length === 0) return text;
  const single = ids.length === 1;
  const nameOf = (id: string, capital: boolean): string => {
    const base = single ? 'this proposal' : `proposal ${ids.indexOf(id) + 1}`;
    return capital ? base.charAt(0).toUpperCase() + base.slice(1) : base;
  };

  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const label = LABEL_ONLY.exec(line);
    if (label !== null) {
      if (!single) lines.push(`${label[1] ?? ''}**${nameOf(label[2]!, true)}**`);
      continue;
    }
    lines.push(
      line
        .replace(LABELLED, (_m, p: string, lead: string | undefined, id: string, trail: string | undefined) => {
          const name = nameOf(id, p === 'P');
          // `**`prop_…`**` bold wrapped the id alone: it goes with the id.
          return lead !== undefined && trail !== undefined ? name : `${lead ?? ''}${name}${trail ?? ''}`;
        })
        .replace(BARE, (_m, id: string) => nameOf(id, false))
        // "proposals proposal 1 and proposal 2" → "proposals 1 and 2"
        .replace(/\bproposals\s+proposal (\d+)(\s*(?:,|and)\s*)proposal (\d+)/gi, 'proposals $1$2$3'),
    );
  }
  // A dropped label line must not leave a doubled blank line behind.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
