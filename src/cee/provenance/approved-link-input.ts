import { AsyncLocalStorage } from 'node:async_hooks';

/** Host-verified origin bound to one approved link write, never supplied on the event wire. */
export interface LinkInputClaim {
  origin: 'human' | 'ai' | 'unknown';
  basis: string;
  source_quote: string;
  subject: { from: string; to: string };
}
/** Structural source stays schema-valid; an unknown size carries no magnitude authorship stamp. */
export function sourceForLinkInput(claim: LinkInputClaim): 'user_specified' | 'cee_hypothesis' {
  return claim.origin === 'human' ? 'user_specified' : 'cee_hypothesis';
}
interface ApprovedLinkInput {
  scenario: string; turn: string; from: string; to: string;
  claim: LinkInputClaim; previous: unknown;
}
const approved = new AsyncLocalStorage<ApprovedLinkInput>();
export function withApprovedLinkInput<T>(value: ApprovedLinkInput, write: () => Promise<T>): Promise<T> {
  return approved.run(value, write);
}
export function approvedLinkInputFor(scenario: string, turn: string, from: string, to: string): ApprovedLinkInput | undefined {
  const value = approved.getStore();
  return value?.scenario === scenario && value.turn === turn && value.from === from && value.to === to ? value : undefined;
}
