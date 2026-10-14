import { expect } from 'vitest';

export const WORDS = 'Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’, less ‘MRR lost to price-driven churn’. Is that how you work it out?';

/** Shared identity-card Yes witness: the route and guided-path rows use the same assertions. */
export async function assertIdentityYes(
  card: Record<string, any>,
  press: (id: string, message: string, parameters?: Record<string, unknown>) => Promise<Record<string, any>>,
  proposalAt: (id: string) => { readonly operations: readonly unknown[] } | undefined,
  graphWrites: () => number,
  readGraph: () => Record<string, any>,
  tools: readonly string[] = ['propose_identity'],
  // The Yes commits the identity; where the saved model's readiness admits a Run, the route's automatic Run is this turn's Run too.
  yesTools: readonly string[] = ['authorise_change'],
): Promise<Record<string, any>> {
  expect(card._agent?.tool_calls?.map((call: { name: string }) => call.name)).toEqual(tools);
  const approve = card.suggested_actions.find((a: { id: string }) => a.id.startsWith('agent-approve-proposal:'));
  expect(approve, 'press must expose the held identity card').toBeDefined();
  expect(approve.detail).toBe(WORDS); expect(graphWrites()).toBe(0);
  const held = proposalAt(approve.id.slice('agent-approve-proposal:'.length));
  expect(held?.operations).toEqual([expect.objectContaining({ op: 'confirm_identity', path: 'mrr', value: expect.objectContaining({
    factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], words: WORDS,
  }) })]);
  const yes = await press(approve.id, approve.message);
  expect(yes._agent?.tool_calls?.map((call: { name: string }) => call.name)).toEqual(yesTools);
  expect(graphWrites(), `identity Yes response: ${JSON.stringify(yes)}`).toBe(1);
  expect(readGraph().nodes.find((n: { id: string }) => n.id === 'mrr').nonlinear_identity).toEqual({
    operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: true,
  });
  return yes;
}
