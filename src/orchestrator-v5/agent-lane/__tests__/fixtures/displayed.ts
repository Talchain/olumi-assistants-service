/**
 * What the client SHOWS after a reply (DGAI `displayedProposals`; Codex BLOCK on #3420, 18 Oct): each card the reply lists in
 * `_proposal_fields`, at the revision it rendered, and any other approve button it carries. A typed turn sends this as
 * `displayed_proposals`; typed words bind only to a card in it (`shownAsHeldNow`). No imports: any harness may use it.
 */
type Rec = Record<string, any>;
const APPROVE = 'agent-approve-proposal:';
export const shownBy = (body: Rec): Rec[] => {
  const listed = ((body?._proposal_fields?.proposals ?? []) as Rec[]).map((p) => ({ proposal_id: p.proposal_id, revision: p.revision }));
  const buttons = ((body?.suggested_actions ?? []) as Rec[]).map((c) => String(c.id)).filter((id) => id.startsWith(APPROVE))
    .map((id) => id.slice(APPROVE.length)).filter((id) => !listed.some((p) => p.proposal_id === id)).map((id) => ({ proposal_id: id }));
  return [...listed, ...buttons];
};
