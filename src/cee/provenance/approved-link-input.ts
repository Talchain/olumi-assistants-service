import { AsyncLocalStorage } from 'node:async_hooks';
import type { InputClaim } from '../../schemas/assist.js';

interface ApprovedLinkInput {
  scenario: string; turn: string; from: string; to: string;
  claim: InputClaim; previous: unknown;
}
const approved = new AsyncLocalStorage<ApprovedLinkInput>();
export function withApprovedLinkInput<T>(value: ApprovedLinkInput, write: () => Promise<T>): Promise<T> {
  return approved.run(value, write);
}
export function approvedLinkInputFor(scenario: string, turn: string, from: string, to: string): ApprovedLinkInput | undefined {
  const value = approved.getStore();
  return value?.scenario === scenario && value.turn === turn && value.from === from && value.to === to ? value : undefined;
}
