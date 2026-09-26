/**
 * The tool context of the user's NEXT request — the one that approves what an earlier request proposed.
 *
 * ⛔ AN APPROVAL IS NEVER THE REQUEST THAT PREPARED THE CHANGE (`agent-cannot-approve-its-own-proposal.test.ts`).
 * `authoriseChange` refuses, as `awaiting_your_approval`, any id a proposer minted under the same `request_id`:
 * the user has not seen that change yet. On the served route every approval — the approve chip, or a typed "yes"
 * the Agent resolves — is a later request with its own id, so a unit test that proposes and then applies with ONE
 * capability set authorises under this context: same scenario, same subject, the next request.
 */
export function nextRequest<T extends { readonly request_id: string }>(ctx: T): T {
  return { ...ctx, request_id: `${ctx.request_id}:next` };
}
